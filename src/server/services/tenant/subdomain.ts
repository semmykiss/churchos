import { db } from "@/server/db";

/**
 * Subdomain service (backend only) — tenant URL generation per spec §3.
 * • Slugify: DNS-safe labels (3-63 chars, a-z 0-9 hyphen)
 * • Reserved words can never be issued (app, api, admin, www, …)
 * • Collision handling via deterministic -2/-3 suffixes against the
 *   SubdomainRegistry — and the DB unique constraint is the final arbiter
 *   inside the creation transaction (race-safe).
 * • Organization.slug remains the LIVE subdomain; the registry is the
 *   reservation/history layer (released names are never re-issued).
 */

export const TENANT_URL_BASE = "churchos.app";

const RESERVED_SUBDOMAINS = new Set([
  // infrastructure
  "app", "api", "admin", "www", "mail", "support", "status", "auth", "cdn", "assets",
  "blog", "help", "docs", "dashboard", "login", "signup", "billing", "shop", "store",
  // internal routes / surfaces
  "partner", "portal", "kiosk", "kiosks", "checkin", "giving", "pay", "payments",
  "webhook", "webhooks", "static", "media", "files", "backup", "db", "sql", "root",
  "smtp", "ftp", "ns1", "ns2", "vpn", "dev", "staging", "test", "demo", "beta",
  "gracechms", "chms", "churchos", "console", "compliance", "security", "legal",
]);

export class SubdomainError extends Error {
  constructor(message: string) { super(message); this.name = "SubdomainError"; }
}

/** Slugify a display name into a DNS-safe subdomain label. */
export function slugifySubdomain(name: string): string {
  const base = (name ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return base;
}

/** Charset/shape validation for a candidate label (user-editable too). */
export function validateSubdomain(candidate: string): { ok: boolean; reason?: string } {
  const value = (candidate ?? "").toLowerCase().trim();
  if (value.length < 3) return { ok: false, reason: "Too short — use at least 3 characters." };
  if (value.length > 63) return { ok: false, reason: "Too long — 63 characters maximum." };
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(value)) {
    return { ok: false, reason: "Use lowercase letters, numbers and hyphens only (no leading/trailing hyphen)." };
  }
  if (RESERVED_SUBDOMAINS.has(value)) {
    return { ok: false, reason: `"${value}" is a reserved system name and cannot be used.` };
  }
  return { ok: true };
}

async function existsInRegistry(candidate: string): Promise<boolean> {
  const row = await db.subdomainRegistry.findUnique({ where: { subdomain: candidate } });
  return !!row && !row.releasedAt;
}

async function existsAsOrgSlug(candidate: string): Promise<boolean> {
  // Soft-deleted tenants don't count as live orgs — their slug stays blocked
  // by the SubdomainRegistry reservation until the purge releases it.
  return !!(await db.organization.findFirst({ where: { slug: candidate, deletedAt: null }, select: { id: true } }));
}

export async function subdomainAvailable(candidate: string): Promise<boolean> {
  const check = validateSubdomain(candidate);
  if (!check.ok) return false;
  return !(await existsInRegistry(candidate)) && !(await existsAsOrgSlug(candidate));
}

/** Deterministic collision walk: base → base-2 → base-3 … (first free wins). */
export async function firstAvailableSubdomain(displayName: string): Promise<string> {
  const base = slugifySubdomain(displayName) || `church-${Date.now().toString(36)}`;
  let candidate = base;
  let suffix = 1;
  while (!(await subdomainAvailable(candidate))) {
    suffix += 1;
    candidate = `${base}-${suffix}`;
    if (suffix > 50) {
      // astronomically unlikely; guarantee termination with a random tail
      candidate = `${base}-${randomSuffix()}`;
      break;
    }
  }
  return candidate;
}

/** Up to `count` friendly suggestions for the wizard's live availability UI. */
export async function suggestSubdomains(displayName: string, count = 3): Promise<string[]> {
  const base = slugifySubdomain(displayName);
  const out: string[] = [];
  if (base && (await subdomainAvailable(base))) out.push(base);
  for (let s = 2; out.length < count && s < 60; s++) {
    const c = `${base}-${s}`;
    if (base && (await subdomainAvailable(c))) out.push(c);
  }
  return out;
}

export function tenantUrl(subdomain: string): string {
  return `https://${subdomain}.${TENANT_URL_BASE}`;
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 7);
}

/**
 * Reserve inside the creation transaction: writes the registry row AND is the
 * uniqueness backstop together with Organization.slug @unique. Called with a
 * Prisma transaction client so a failed tenant creation rolls the
 * reservation back too (no orphaned names — spec §5).
 */
export async function reserveSubdomainInTx(
  tx: { subdomainRegistry: { create: (args: any) => Promise<unknown> } },
  orgId: string,
  candidate: string,
): Promise<string> {
  const check = validateSubdomain(candidate);
  if (!check.ok) throw new SubdomainError(check.reason ?? "Invalid subdomain.");
  await tx.subdomainRegistry.create({ data: { subdomain: candidate, orgId } });
  return candidate;
}

/**
 * One-time backfill for pre-existing tenants (spec acceptance: "existing
 * tenants are backfilled with a generated subdomain without disrupting
 * access"). Existing slugs are already live — they just get registry rows.
 * Idempotent: safe to run repeatedly.
 */
export async function backfillSubdomainRegistry(): Promise<{ reserved: number; skipped: number }> {
  const orgs = await db.organization.findMany({
    where: { subdomain: null },
    select: { id: true, slug: true },
  });
  let reserved = 0;
  let skipped = 0;
  for (const org of orgs) {
    const clash = await db.subdomainRegistry.findUnique({ where: { subdomain: org.slug } });
    if (clash) { skipped += 1; continue; }
    await db.subdomainRegistry.create({ data: { subdomain: org.slug, orgId: org.id } });
    reserved += 1;
  }
  return { reserved, skipped };
}
