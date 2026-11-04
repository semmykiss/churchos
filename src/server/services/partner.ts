import { randomBytes } from "crypto";
import path from "path";
import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { ROLE_TEMPLATES, SYSTEM_ROLES, serializeAccessMatrix } from "@/server/permissions";
import { hashPassword, sha256 } from "@/server/auth";
import { ApiError, badRequest, conflict, notFound } from "@/server/http";
import {
  reserveSubdomainInTx, subdomainAvailable, validateSubdomain,
} from "@/server/services/tenant/subdomain";

/**
 * Partner console service (backend only).
 * Tenant (church) lifecycle + license management for the SaaS vendor layer.
 *
 * Security upgrade (partner console hardening):
 * • Tenants are SOFT-deleted: 30-day recoverable archive, then purged by the
 *   hard-delete pipeline (purgeExpiredDeletions). Every partner-facing query
 *   filters deletedAt: null so archived tenants disappear everywhere at once.
 * • Onboarding is passwordless: the owner gets a single-use 24h magic link
 *   (consumed by the existing auth magic-verify flow); no password is ever
 *   generated for a human or shown to the partner.
 * • License keys are masked in all list/detail views; the full key is shown
 *   once at onboarding and only via the audited reveal endpoint afterwards.
 * • License status changes go through an explicit state machine with an
 *   optimistic-concurrency token (updatedAt) and mandatory reasons.
 */

export const PLANS = ["starter", "growth", "multisite"] as const;
export type Plan = (typeof PLANS)[number];

/** List price per plan, charged monthly (minor units / cents). */
export const PLAN_PRICES_CENTS: Record<string, number> = {
  starter: 9900,
  growth: 24900,
  multisite: 49900,
};

export const LICENSE_STATUSES = ["trial", "active", "past_due", "suspended", "cancelled"] as const;
export type LicenseStatus = (typeof LICENSE_STATUSES)[number];

/** Plan metadata for the partner console plan picker (money = integer kobo). */
export interface PartnerPlanInfo {
  key: Plan;
  label: string;
  monthlyPriceCents: number;
  defaultSeats: number;
}

export const PLAN_META: readonly PartnerPlanInfo[] = [
  { key: "starter", label: "Starter", monthlyPriceCents: PLAN_PRICES_CENTS.starter, defaultSeats: 100 },
  { key: "growth", label: "Growth", monthlyPriceCents: PLAN_PRICES_CENTS.growth, defaultSeats: 250 },
  { key: "multisite", label: "Multisite", monthlyPriceCents: PLAN_PRICES_CENTS.multisite, defaultSeats: 1000 },
];

export function partnerPlans(): { plans: PartnerPlanInfo[] } {
  return { plans: PLAN_META.map((p) => ({ ...p })) };
}

const ROLE_NAMES: Record<string, string> = {
  owner: "Owner",
  campus_admin: "Campus Admin",
  finance: "Finance",
  ministry_leader: "Ministry Leader",
  volunteer: "Volunteer",
  member: "Member",
};

/** Shared actor shape — populated from the partner session by the route layer. */
export interface PartnerActor {
  label: string;
  ip?: string | null;
  userAgent?: string | null;
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || `church-${Date.now()}`;
}

export function newLicenseKey(): string {
  const block = () => randomBytes(2).toString("hex").toUpperCase().replace(/[OIL]/g, "X");
  return `GCHMS-${block()}-${block()}-${block()}`;
}

/** Mask a license key for list/detail views: keep the first group and the last, bullets in between. */
export function maskLicenseKey(key: string): string {
  const groups = key.split("-");
  if (groups.length < 2) return key;
  return [groups[0], ...groups.slice(1, -1).map(() => "••••"), groups[groups.length - 1]].join("-");
}

/**
 * Clamp an untrusted numeric input into a safe integer range. NaN/Infinity/
 * non-numeric values fall back to `fallback` instead of poisoning Prisma
 * with NaN (which surfaces as a 500).
 */
function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

// ── login gate: enforced when a church user signs in ────────────────────────

export interface LicenseGate {
  ok: boolean;
  code?: string;
  message?: string;
}

export async function licenseGateForOrg(orgId: string): Promise<LicenseGate> {
  // Soft-deleted tenants must never pass the gate (deletedAt: null).
  const org = await db.organization.findFirst({ where: { id: orgId, deletedAt: null }, include: { license: true } });
  if (!org) return { ok: false, code: "org_missing", message: "Church account not found." };
  if (!["active", "pending_verification"].includes(org.status)) {
    return { ok: false, code: "org_suspended", message: "This church account is suspended. Contact your Grace ChMS partner." };
  }
  const lic = org.license;
  if (!lic) return { ok: true }; // grandfathered tenant without a license record
  if (lic.status === "suspended" || lic.status === "cancelled") {
    return { ok: false, code: "license_suspended", message: "The license for this church is not active. Contact your Grace ChMS partner." };
  }
  if (lic.status === "past_due") {
    return { ok: false, code: "license_past_due", message: "Payment is past due for this church. Contact your Grace ChMS partner." };
  }
  if (lic.expiresAt.getTime() < Date.now()) {
    return {
      ok: false,
      code: "license_expired",
      message: `License expired ${lic.expiresAt.toISOString().slice(0, 10)}. Contact your Grace ChMS partner to renew.`,
    };
  }
  return { ok: true };
}

// ── soft-delete purge (lazy scheduled job) ───────────────────────────────────

let purgeInFlight = false;

/**
 * Hard-deletes tenants whose 30-day recovery window has passed. There is no
 * cron/scheduler in this deployment, so the purge runs LAZILY: it is invoked
 * fire-and-forget at the start of listTenants() and partnerOverview() (the
 * two endpoints the partner console always hits). The in-flight flag keeps
 * parallel API requests from racing duplicate purges, and per-org failures
 * are logged without blocking the triggering request.
 */
export async function purgeExpiredDeletions(): Promise<void> {
  if (purgeInFlight) return;
  purgeInFlight = true;
  try {
    // Deterministic order + bounded batch — oldest recoverUntil first, so a
    // backlog drains FIFO across runs instead of starving random orgs.
    const expired = await db.organization.findMany({
      where: { deletedAt: { not: null }, recoverUntil: { lt: new Date() } },
      select: { id: true },
      orderBy: { recoverUntil: "asc" },
      take: 20,
    });
    const systemActor: PartnerActor = { label: "system:purge", ip: null, userAgent: null };
    for (const org of expired) {
      try {
        await hardDeleteOrgById(org.id, systemActor);
      } catch (err) {
        // Failures must be OBSERVABLE — record a system audit row (AuditLog.orgId
        // carries no FK, safe even mid-purge) + console.error.
        const message = err instanceof Error ? err.message : String(err);
        console.error("[partner] purge failed for org", org.id, err);
        await db.auditLog
          .create({
            data: {
              orgId: org.id,
              actorType: "system",
              actorLabel: "system:purge",
              action: "partner.tenant_purge_failed",
              entityType: "organization",
              entityId: org.id,
              after: JSON.stringify({ error: message.slice(0, 300) }),
            },
          })
          .catch(() => {}); // never let observability break the sweep
      }
    }
  } finally {
    purgeInFlight = false;
  }
}

// ── overview ─────────────────────────────────────────────────────────────────

export async function partnerOverview() {
  void purgeExpiredDeletions().catch(() => {}); // lazy purge — see above

  const [orgs, licenses, peopleByOrg, userCount] = await Promise.all([
    db.organization.findMany({
      where: { deletedAt: null },
      select: { id: true, status: true },
    }),
    db.license.findMany({
      where: { org: { deletedAt: null } },
      include: { org: { select: { name: true, status: true } } },
      orderBy: { expiresAt: "asc" },
    }),
    db.person.groupBy({ by: ["orgId"], _count: { _all: true }, where: { deletedAt: null } }),
    db.user.count(),
  ]);

  const now = Date.now();
  // 30-day expiry window (contract pin) — raised from the previous 14 days.
  const soonCutoff = now + 30 * 24 * 3600 * 1000;

  const licenseCount = (status: string) => licenses.filter((l) => l.status === status).length;
  const mrrCents = licenses
    .filter((l) => l.status === "active")
    .reduce((sum, l) => sum + (PLAN_PRICES_CENTS[l.plan] ?? 0), 0);

  const expiringSoonRows = licenses.filter(
    (l) => (l.status === "active" || l.status === "trial") && l.expiresAt.getTime() <= soonCutoff,
  );

  const expiringSoon = expiringSoonRows.map((l) => ({
    id: l.id,
    orgId: l.orgId,
    orgName: l.org.name,
    plan: l.plan,
    status: l.status,
    expiresAt: l.expiresAt,
    daysLeft: Math.max(0, Math.ceil((l.expiresAt.getTime() - now) / 86400000)),
    updatedAt: l.updatedAt?.toISOString() ?? null,
  }));

  return {
    tenants: {
      total: orgs.length,
      active: orgs.filter((o) => o.status === "active").length,
      pending: orgs.filter((o) => o.status === "pending_verification").length,
      suspended: orgs.filter((o) => o.status === "suspended").length,
    },
    licenses: {
      total: licenses.length,
      active: licenseCount("active"),
      trial: licenseCount("trial"),
      pastDue: licenseCount("past_due"),
      suspended: licenseCount("suspended") + licenseCount("cancelled"),
    },
    mrrCents,
    totalPeople: peopleByOrg.reduce((s, p) => s + p._count._all, 0),
    totalUsers: userCount,
    // Full 30-day count (the expiringSoon list may be truncated; total always
    // reflects every license inside the window).
    expiringSoonTotal: expiringSoonRows.length,
    expiringSoon,
  };
}

// ── tenants ──────────────────────────────────────────────────────────────────

export interface PartnerTenantRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  createdAt: Date;
  plan: string;
  licenseStatus: string;
  licenseId: string | null;
  licenseKey: string | null;
  seats: number;
  seatsUsed: number;
  expiresAt: Date | null;
  daysLeft: number | null;
  campuses: number;
  people: number;
}

export interface ListTenantsResult {
  rows: PartnerTenantRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export async function listTenants(opts: { search?: string; status?: string; page?: number; pageSize?: number } = {}): Promise<ListTenantsResult> {
  void purgeExpiredDeletions().catch(() => {}); // lazy purge — no scheduler in this deployment

  const page = Math.max(1, Math.floor(Number(opts.page)) || 1);
  const pageSize = Math.min(50, Math.max(1, Math.floor(Number(opts.pageSize)) || 10));
  const search = opts.search?.trim().toLowerCase();

  // Fixed allow-list status filter — no client-controlled sort/filter expressions.
  const statusFilter =
    opts.status === "active" ? "active"
    : opts.status === "pending" ? "pending_verification"
    : opts.status === "suspended" ? "suspended"
    : undefined;

  const where: Prisma.OrganizationWhereInput = {
    deletedAt: null, // soft-deleted tenants never appear in the console
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(search ? { OR: [{ name: { contains: search } }, { slug: { contains: search } }] } : {}),
  };

  const [orgs, total, peopleCounts] = await Promise.all([
    db.organization.findMany({
      where,
      include: { license: true, _count: { select: { campuses: true, memberships: true } } },
      orderBy: { createdAt: "desc" }, // newest first (fixed sort)
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.organization.count({ where }),
    db.person.groupBy({ by: ["orgId"], _count: { _all: true }, where: { deletedAt: null } }),
  ]);
  const peopleMap = new Map(peopleCounts.map((p) => [p.orgId, p._count._all]));
  const now = Date.now();

  const rows: PartnerTenantRow[] = orgs.map((o) => ({
    id: o.id,
    name: o.name,
    slug: o.slug,
    status: o.status,
    createdAt: o.createdAt,
    plan: o.license?.plan ?? o.plan,
    licenseStatus: o.license?.status ?? "none",
    licenseId: o.license?.id ?? null,
    licenseKey: o.license ? maskLicenseKey(o.license.key) : null,
    seats: o.license?.seats ?? 0,
    seatsUsed: o._count.memberships,
    expiresAt: o.license?.expiresAt ?? null,
    daysLeft: o.license ? Math.ceil((o.license.expiresAt.getTime() - now) / 86400000) : null,
    campuses: o._count.campuses,
    people: peopleMap.get(o.id) ?? 0,
  }));

  return {
    rows,
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getTenant(id: string) {
  const org = await db.organization.findFirst({
    where: { id, deletedAt: null },
    include: {
      license: true,
      campuses: { where: { deletedAt: null } },
      memberships: {
        include: {
          user: { select: { email: true, name: true, status: true, lastLoginAt: true } },
          roleAssignments: { include: { role: { select: { name: true } } } },
        },
      },
    },
  });
  if (!org) throw notFound("Church not found.");
  const peopleCount = await db.person.count({ where: { orgId: id, deletedAt: null } });
  const audit = await db.auditLog.findMany({
    where: { orgId: id },
    orderBy: { createdAt: "desc" },
    take: 8,
    select: { action: true, actorLabel: true, actorType: true, createdAt: true },
  });

  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    status: org.status,
    timezone: org.timezone,
    currency: org.currency,
    plan: org.license?.plan ?? org.plan,
    createdAt: org.createdAt,
    license: org.license
      ? { ...org.license, key: maskLicenseKey(org.license.key) }
      : null,
    campuses: org.campuses.map((c) => ({ id: c.id, name: c.name, code: c.code, isPrimary: c.isPrimary })),
    users: org.memberships.map((m) => ({
      membershipId: m.id,
      email: m.user.email,
      name: m.user.name ?? m.user.email,
      status: m.status,
      roles: m.roleAssignments.map((ra) => ra.role.name),
      lastLoginAt: m.user.lastLoginAt,
    })),
    peopleCount,
    audit,
  };
}

export interface CreateTenantInput {
  name: string;
  slug?: string;
  timezone?: string;
  currency?: string;
  plan?: string;
  seats?: number;
  termMonths?: number;
  licenseStatus?: LicenseStatus;
  notes?: string;
  /** Passwordless onboarding — the owner signs in via a one-time magic link. */
  owner: { name: string; email: string };
}

/**
 * Creates a tenant on behalf of a partner. Passwordless: the owner User gets
 * an unusable random password (never sent to anyone) plus a single-use 24h
 * magic-login token whose PLAINTEXT is returned exactly once in inviteLink —
 * `/?magic=<token>` is verified by the existing auth magic-verify flow. The
 * route wraps this call in withIdempotency so a retried request replays the
 * same response instead of creating a second church.
 */
export async function createTenant(input: CreateTenantInput, actor: PartnerActor) {
  const name = input.name?.trim();
  if (!name) throw badRequest("Church name is required.");
  const ownerEmail = input.owner?.email?.trim().toLowerCase();
  if (!ownerEmail) throw badRequest("Owner email is required.");

  const plan = PLANS.includes((input.plan ?? "growth") as Plan) ? (input.plan as Plan) : "growth";
  // seats NaN/absent → plan default; termMonths NaN → 12 (existing behavior).
  const seats = clampInt(input.seats, 1, 10000, plan === "starter" ? 100 : plan === "growth" ? 250 : 1000);
  const termMonths = clampInt(input.termMonths, 1, 60, 12);
  const licenseStatus = LICENSE_STATUSES.includes((input.licenseStatus ?? "trial") as LicenseStatus)
    ? (input.licenseStatus as LicenseStatus)
    : "trial";

  // slug — an explicit candidate must pass format + reserved-word validation;
  // otherwise slugify the display name.
  const slugCandidate = input.slug?.trim().toLowerCase() || slugify(name);
  if (input.slug?.trim()) {
    const check = validateSubdomain(slugCandidate);
    if (!check.ok) throw badRequest(check.reason ?? "Invalid subdomain.");
  }

  // Uniqueness — registry + live org slug via the subdomain service; existing
  // credentials are NEVER touched (that was the account-takeover path).
  if (!(await subdomainAvailable(slugCandidate))) {
    throw conflict(`The church address "${slugCandidate}" is already taken — choose another subdomain.`);
  }
  const emailTaken = await db.user.findUnique({ where: { email: ownerEmail }, select: { id: true } });
  if (emailTaken) {
    throw conflict("A user with this email already exists. Invitations cannot overwrite existing accounts.");
  }

  const created = await db.$transaction(async (tx) => {
    const org = await tx.organization.create({
      data: {
        name,
        slug: slugCandidate,
        timezone: input.timezone?.trim() || "Africa/Lagos",
        currency: input.currency?.trim() || "NGN",
        plan,
        status: "active",
        onboardedVia: "partner",
      },
    });
    // Reserve the subdomain inside the tx — rolls back with the org on failure.
    await reserveSubdomainInTx(tx, org.id, slugCandidate);
    const campus = await tx.campus.create({
      data: { orgId: org.id, name: `${name} — Main`, code: "MAIN", isPrimary: true, timezone: org.timezone },
    });
    for (const [key, permissions] of Object.entries(ROLE_TEMPLATES)) {
      const preset = SYSTEM_ROLES[key];
      await tx.role.create({
        data: {
          orgId: org.id,
          key,
          name: preset?.name ?? ROLE_NAMES[key] ?? key,
          description: preset?.description ?? `Default ${ROLE_NAMES[key] ?? key} role`,
          isSystem: true,
          accessMatrix: preset ? serializeAccessMatrix(preset.matrix) : null,
          permissions: { create: permissions.map((permission) => ({ permission })) },
        },
      });
    }
    const ownerRole = await tx.role.findFirst({ where: { orgId: org.id, key: "owner" } });
    // Unusable random password — nobody ever learns it; sign-in is magic-link only.
    const user = await tx.user.create({
      data: {
        email: ownerEmail,
        name: input.owner.name?.trim() || ownerEmail,
        passwordHash: hashPassword(randomBytes(32).toString("hex")),
        mustChangePassword: true,
      },
    });
    const membership = await tx.membership.create({
      data: { orgId: org.id, userId: user.id, status: "active", defaultCampusId: campus.id },
    });
    if (ownerRole) {
      await tx.roleAssignment.create({
        data: { orgId: org.id, membershipId: membership.id, roleId: ownerRole.id, scopeType: "campus", scopeId: campus.id },
      });
    }
    const license = await tx.license.create({
      data: {
        orgId: org.id,
        key: newLicenseKey(),
        plan,
        seats,
        status: licenseStatus,
        expiresAt: new Date(Date.now() + termMonths * 30 * 86400000),
        notes: input.notes?.trim() || null,
      },
    });
    return { org, license, ownerId: user.id };
  }).catch((err: unknown) => {
    // Race backstop — the pre-checks above can lose to a concurrent creation;
    // the DB unique constraints are the final arbiter.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw conflict("That church address or owner email was just taken — please retry.");
    }
    throw err;
  });

  // AFTER commit: issue the owner's one-time invite token (24h, single-use,
  // sha256-hashed at rest — same scheme as auth.ts magic links).
  const inviteToken = randomBytes(24).toString("hex");
  await db.authToken.create({
    data: {
      userId: created.ownerId,
      purpose: "magic_login",
      tokenHash: sha256(inviteToken),
      expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
    },
  });
  const inviteLink = `/?magic=${inviteToken}`;

  await db.tenantOnboardingAudit.create({
    data: { orgId: created.org.id, step: "partner_invite_issued", payloadSnapshot: JSON.stringify({ issuedBy: actor.label }) },
  });

  // Audit AFTER commit — never includes the token or any credential.
  await db.auditLog.create({
    data: {
      orgId: created.org.id,
      actorType: "support",
      actorLabel: actor.label,
      action: "partner.tenant_created",
      entityType: "organization",
      entityId: created.org.id,
      after: JSON.stringify({ name, plan, seats, termMonths, inviteIssued: true }),
      ip: actor.ip ?? null,
      userAgent: actor.userAgent ?? null,
    },
  });

  return {
    id: created.org.id,
    name: created.org.name,
    slug: created.org.slug,
    licenseKey: created.license.key, // FULL key — shown exactly once at onboarding
    plan: created.license.plan,
    seats: created.license.seats,
    status: created.license.status,
    expiresAt: created.license.expiresAt,
    inviteLink,
  };
}

export async function setTenantStatus(
  id: string,
  status: string,
  actor: PartnerActor,
  reason?: string,
) {
  if (!["active", "suspended"].includes(status)) throw badRequest("Status must be active or suspended.");
  const trimmedReason = (reason ?? "").trim();
  if (trimmedReason.length < 10) throw badRequest("A reason of at least 10 characters is required.");

  const org = await db.organization.findFirst({ where: { id, deletedAt: null }, include: { license: true } });
  if (!org) throw notFound("Tenant not found.");
  if (org.status === "pending_verification" && status === "active") {
    // activation of a self-signup church MUST go through compliance verification
    // (CAC checks, trustees, documents) — never a plain status toggle.
    throw badRequest("This church is awaiting compliance verification. Use Verify & activate in the Compliance queue.");
  }
  const updatedCount = await db.organization.updateMany({ where: { id, deletedAt: null }, data: { status } });
  // Conditional write — an archived tenant can never be resurrected by a
  // status toggle (count 0 → it vanished between the read and the write).
  if (updatedCount.count === 0) throw notFound("Tenant not found.");
  await db.auditLog.create({
    data: {
      orgId: id,
      actorType: "support",
      actorLabel: actor.label,
      action: status === "suspended" ? "partner.tenant_suspended" : "partner.tenant_reactivated",
      entityType: "organization",
      entityId: id,
      before: JSON.stringify({ status: org.status }),
      after: JSON.stringify({ status, reason: trimmedReason }),
      ip: actor.ip ?? null,
      userAgent: actor.userAgent ?? null,
    },
  });
  return { id, status };
}

// ── tenant deletion (soft archive → recoverable → purge) ─────────────────────

/** Private document storage root — mirrors tenant/onboarding.ts. */
const UPLOAD_ROOT = path.join(process.cwd(), "db", "uploads");

export interface TenantDeletePreview {
  id: string;
  name: string;
  slug: string;
  status: string;
  people: number;
  users: number;
  donations: number;
  documents: number;
}

export async function tenantDeletePreview(id: string): Promise<TenantDeletePreview> {
  const org = await db.organization.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, name: true, slug: true, status: true },
  });
  if (!org) throw notFound("Tenant not found.");
  const [people, users, donations, documents] = await Promise.all([
    db.person.count({ where: { orgId: id, deletedAt: null } }),
    db.membership.count({ where: { orgId: id } }),
    db.donation.count({ where: { orgId: id } }),
    db.fileRecord.count({ where: { orgId: id } }),
  ]);
  return { id: org.id, name: org.name, slug: org.slug, status: org.status, people, users, donations, documents };
}

const DELETE_RATE_MAX = 3;
const DELETE_RATE_WINDOW_MS = 10 * 60 * 1000;
const deleteAttempts = new Map<string, number[]>();

/** In-memory burst guard: max 3 validated deletion attempts per partner+IP per 10 min. */
const RATE_MAP_MAX = 5000;

/** Bound a limiter map — unbounded keys are a memory-DoS vector. On insert,
 *  prune the oldest ~1000 entries (Map preserves insertion order). */
function boundRateMap(map: Map<string, number[]>): void {
  if (map.size <= RATE_MAP_MAX) return;
  let n = 1000;
  for (const key of map.keys()) {
    if (n-- <= 0) break;
    map.delete(key);
  }
}

function checkDeleteRateLimit(key: string): void {
  const now = Date.now();
  const hits = (deleteAttempts.get(key) ?? []).filter((t) => now - t < DELETE_RATE_WINDOW_MS);
  if (hits.length >= DELETE_RATE_MAX) {
    throw new ApiError(429, "rate_limited", "Too many tenant deletions. Try again later.");
  }
  hits.push(now);
  deleteAttempts.set(key, hits);
  boundRateMap(deleteAttempts);
}

/**
 * SOFT delete: archives the tenant for 30 days (recoverable) instead of
 * destroying it. Inside one transaction the org is marked
 * { deletedAt, deletionReason, recoverUntil, status: "archived" } — archived
 * makes licenseGateForOrg and the church session resolver block sign-in
 * immediately — and the "partner.tenant_delete_scheduled" tombstone audit is
 * written BEFORE any destructive step. Church sessions are deliberately NOT
 * revoked: they are user-level across orgs and the gate kills them on next
 * use. The confirmation is the tenant's slug (server-checked), and deletion
 * attempts are rate-limited per partner+IP.
 */
export async function softDeleteTenant(
  id: string,
  input: { confirmSlug?: unknown; reason?: unknown },
  actor: PartnerActor,
  rateKey: string,
) {
  const confirmSlug = typeof input.confirmSlug === "string" ? input.confirmSlug.trim().toLowerCase() : "";
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (!confirmSlug) throw badRequest("Slug confirmation is required to delete a tenant.");
  if (reason.length < 10) throw badRequest("A reason of at least 10 characters is required to delete a tenant.");

  const org = await db.organization.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, name: true, slug: true },
  });
  if (!org) throw notFound("Tenant not found.");
  if (confirmSlug !== org.slug) throw badRequest("Slug confirmation does not match.");

  // Counted only after validation — honest typo retries don't burn the budget.
  checkDeleteRateLimit(rateKey);

  const now = new Date();
  const recoverUntil = new Date(now.getTime() + 30 * 24 * 3600 * 1000);

  await db.$transaction(async (tx) => {
    // Conditional archive — a concurrent second delete must not overwrite the
    // first tombstone (or reset recoverUntil). count 0 → already archived →
    // conflict rolls the whole tx (tombstone included) back.
    const archived = await tx.organization.updateMany({
      where: { id: org.id, deletedAt: null },
      data: { deletedAt: now, deletionReason: reason, recoverUntil, status: "archived" },
    });
    if (archived.count === 0) throw conflict("This tenant is already scheduled for deletion.");
    // Tombstone FIRST (same tx) — survives the eventual purge (AuditLog.orgId has no FK).
    await tx.auditLog.create({
      data: {
        orgId: org.id,
        actorType: "support",
        actorLabel: actor.label,
        action: "partner.tenant_delete_scheduled",
        entityType: "organization",
        entityId: org.id,
        after: JSON.stringify({ name: org.name, slug: org.slug, reason, recoverUntil: recoverUntil.toISOString() }),
        ip: actor.ip ?? null,
        userAgent: actor.userAgent ?? null,
      },
    });
  });

  return { name: org.name, recoverUntil };
}

/**
 * The ORIGINAL hard-delete pipeline, now private and used exclusively by
 * purgeExpiredDeletions(). Every org-scoped record (people, giving,
 * accounting, check-in, comms, chat, AI, onboarding documents), the reserved
 * subdomain (URL becomes claimable again), and user accounts that no longer
 * belong to any other tenant (their sessions are revoked). One transaction —
 * any failure rolls the whole wipe back. The tombstone audit entry (written
 * after the org row is gone — AuditLog.orgId carries no FK) survives the wipe
 * so the action remains provable.
 */
async function hardDeleteOrgById(
  id: string,
  actor: PartnerActor,
): Promise<{ ok: true; id: string; name: string; releasedSubdomain: string; usersRemoved: number; documentsRemoved: number }> {
  const org = await db.organization.findUnique({ where: { id }, include: { license: true } });
  if (!org) throw notFound("Church not found.");

  const memberships = await db.membership.findMany({ where: { orgId: id }, select: { userId: true } });
  const userIds = [...new Set(memberships.map((m) => m.userId))];
  const fileKeys = await db.fileRecord.findMany({ where: { orgId: id }, select: { storageKey: true } });

  await db.$transaction(async (tx) => {
    // Dynamic model dispatch — Prisma exposes no union-wide delegate type, so
    // the wipe helper narrows the transaction client to the one method it needs.
    type DeleteManyDelegate = { deleteMany: (args: { where: Record<string, unknown> }) => Promise<unknown> };
    const wipe = (model: keyof Prisma.TransactionClient, where: Record<string, unknown>): Promise<unknown> => {
      const delegate = tx[model] as unknown as DeleteManyDelegate;
      return delegate.deleteMany({ where });
    };
    const orgScope = { orgId: id };

    // COMPLETE, FK-SAFE wipe list — derived from prisma/schema.prisma: every
    // model with an `orgId String` column plus the org-less join rows that
    // reference wiped parents, ordered children-before-parents so no FK
    // restriction (P2003) can abort the purge:
    //   1) rows referencing Person/Household (incl. join tables without orgId,
    //      wiped via their parent relation) — DonationSplit/CareNote precede
    //      Donation/CareCase (required FKs)
    //   2) Person / Household
    //   3) every remaining orgId table (FK children before their parents,
    //      e.g. checkinSession→event, billLine/billPayment/bill→vendor)
    //   4) membership / role* / campus / license / fileRecord /
    //      subdomainRegistry / tenantOnboardingAudit / churchTrustee / auditLog
    //   5) the organization itself (last — real FK target of the tables above)
    const wipePlan: Array<[keyof Prisma.TransactionClient, Record<string, unknown>]> = [
      // 1) person/household children (+ conversation/document join rows first)
      ["aiMessage", { conversation: { orgId: id } }], // join rows have no orgId — via parent
      ["personRelationship", orgScope],
      ["stageHistory", orgScope],
      ["personMilestone", orgScope],
      ["personNote", orgScope],
      ["personConsent", orgScope],
      ["groupMember", orgScope],
      ["attendanceRecord", orgScope],
      ["donationSplit", orgScope], // references Donation (restrict) — precede it
      ["donation", orgScope],
      ["pledge", orgScope],
      ["communicationPreference", orgScope],
      ["assignment", orgScope],
      ["careNote", orgScope], // references CareCase (restrict) — precede it
      ["careCase", orgScope],
      ["prayerRequest", orgScope],
      ["chatParticipant", orgScope],
      ["householdMember", { household: { orgId: id } }],
      ["personTag", { person: { orgId: id } }],
      // 2) the people & households themselves
      ["household", orgScope],
      ["person", orgScope],
      // 3) remaining orgId tables (children → parents)
      ["savedView", orgScope],
      ["joinRequest", orgScope],
      ["group", orgScope], // after joinRequest + chatParticipant
      ["chatMessage", orgScope],
      ["chatConversation", orgScope],
      ["messageRecipient", orgScope],
      ["message", orgScope],
      ["customFieldDefinition", orgScope],
      ["tag", orgScope], // after personTag (person-join table has no orgId)
      ["service", orgScope],
      ["checkinSession", orgScope], // references Event (restrict) — precede it
      ["event", orgScope],
      ["fund", orgScope], // after donationSplit
      ["paymentMethod", orgScope],
      ["onlinePayment", orgScope],
      ["recurringGift", orgScope],
      ["batch", orgScope],
      ["givingStatement", orgScope],
      ["givingCommitment", orgScope],
      ["volunteerRole", orgScope],
      ["blockoutDate", orgScope],
      ["workflowRun", orgScope],
      ["workflow", orgScope],
      ["importJob", orgScope],
      ["importRow", orgScope],
      ["importMappingTemplate", orgScope],
      ["personExportLog", orgScope],
      ["publicForm", orgScope],
      ["publicFormSubmission", orgScope],
      ["notification", orgScope],
      ["account", orgScope],
      ["journalLine", orgScope],
      ["journalEntry", orgScope],
      ["billLine", orgScope],
      ["billPayment", orgScope],
      ["bill", orgScope], // references Vendor (restrict) — precede it
      ["vendor", orgScope],
      ["bankTransaction", orgScope],
      ["bankAccount", orgScope],
      ["budget", orgScope],
      ["aiToolAuditLog", orgScope],
      ["aiCrisisFlag", orgScope],
      ["aiConversation", orgScope], // after aiMessage
      ["whatsAppMessage", orgScope],
      ["whatsAppContact", orgScope],
      ["whatsAppAccount", orgScope],
      ["whatsAppTemplate", orgScope],
      ["whatsAppBroadcast", orgScope],
      ["whatsAppFlowRun", orgScope],
      ["whatsAppFlow", orgScope],
      ["whatsAppGivingLink", orgScope],
      ["personPipelinePosition", orgScope],
      ["pipelineStage", orgScope],
      ["followUpTask", orgScope],
      ["followUpStep", orgScope],
      ["followUpSequence", orgScope],
      ["connectionNote", orgScope],
      ["followUpExecution", orgScope],
      ["sermonDraft", orgScope],
      ["sermonSongSuggestion", orgScope],
      ["sermon", orgScope], // after sermonDraft + sermonSongSuggestion
      ["sermonSeries", orgScope],
      ["worshipSong", orgScope], // after sermonSongSuggestion
      ["riskScoringRule", orgScope],
      ["riskFlagHistory", orgScope],
      ["memberRiskFlag", orgScope],
      ["servingConfig", orgScope],
      ["reportTemplate", orgScope],
      ["reportGeneration", orgScope],
      ["paymentVoucher", orgScope],
      ["remittanceRule", orgScope],
      ["remittanceSchedule", orgScope],
      ["remittanceDestination", orgScope], // after rule + schedule
      ["otherReceipt", orgScope],
      ["cashDeposit", orgScope],
      ["pettyCashDisbursement", orgScope],
      ["pettyCashReplenish", orgScope],
      ["stipendLine", orgScope],
      ["stipendBatch", orgScope],
      ["staffPayProfile", orgScope],
      ["payrollLine", orgScope],
      ["payrollRun", orgScope],
      ["assetMaintenanceLog", orgScope],
      ["assetBooking", orgScope],
      ["asset", orgScope],
      ["documentTag", { document: { orgId: id } }], // join rows have no orgId — via parent
      ["documentFavorite", { document: { orgId: id } }],
      ["documentVersion", orgScope],
      ["documentAcl", orgScope],
      ["shareLink", orgScope],
      ["documentComment", orgScope],
      ["documentView", orgScope],
      ["documentSettings", orgScope],
      ["document", orgScope],
      ["folder", orgScope], // after document (self-parenting folder tree)
      // 4) structural tables (real FKs into Organization) + audit history
      ["rolePermission", { role: { orgId: id } }],
      ["roleAssignment", orgScope],
      ["membership", orgScope],
      ["role", orgScope],
      ["campus", orgScope],
      ["license", orgScope],
      ["fileRecord", orgScope],
      ["subdomainRegistry", orgScope], // deleting the registry row frees the URL
      ["tenantOnboardingAudit", orgScope],
      ["churchTrustee", orgScope],
      ["auditLog", orgScope], // tombstone re-inserted below, after the org row
    ];
    for (const [model, where] of wipePlan) {
      await wipe(model, where);
    }

    // memberships are gone above → revoke + delete user accounts that belong
    // nowhere else (their sessions/authTokens go with them)
    for (const uid of userIds) {
      const remaining = await tx.membership.count({ where: { userId: uid } });
      if (remaining === 0) {
        await tx.session.deleteMany({ where: { userId: uid } });
        await tx.user.delete({ where: { id: uid } });
      }
    }

    // 5) the tenant itself
    await tx.organization.delete({ where: { id } });

    // tombstone — AuditLog.orgId has no FK constraint, so it survives the wipe
    await tx.auditLog.create({
      data: {
        orgId: id,
        actorType: "support",
        actorLabel: actor.label,
        action: "partner.tenant_deleted",
        entityType: "organization",
        entityId: id,
        after: JSON.stringify({
          name: org.name,
          slug: org.slug,
          subdomainReleased: org.slug,
          usersRemoved: userIds.length,
          licenseKey: org.license ? maskLicenseKey(org.license.key) : null, // never store the full key
        }),
        ip: actor.ip ?? null,
        userAgent: actor.userAgent ?? null,
      },
    });
  });

  // physical documents live outside the DB — best-effort cleanup after commit
  try {
    const fs = await import("fs/promises");
    await fs.rm(path.join(UPLOAD_ROOT, id), { recursive: true, force: true });
  } catch {
    /* storage dir may not exist — nothing to clean */
  }

  return {
    ok: true,
    id,
    name: org.name,
    releasedSubdomain: org.slug,
    usersRemoved: userIds.length,
    documentsRemoved: fileKeys.length,
  };
}

// ── licenses ─────────────────────────────────────────────────────────────────

type LicenseWithOrg = Prisma.LicenseGetPayload<{ include: { org: { select: { id: true; name: true; slug: true; status: true; deletedAt: true } } } }>;

/** Standard license-row shape shared by list / detail / update responses. */
function licenseRow(l: LicenseWithOrg) {
  const now = Date.now();
  return {
    ...l,
    key: maskLicenseKey(l.key),
    org: { id: l.org.id, name: l.org.name, slug: l.org.slug, status: l.org.status },
    orgName: l.org.name,
    orgStatus: l.org.status,
    daysLeft: Math.ceil((l.expiresAt.getTime() - now) / 86400000),
    monthlyPriceCents: PLAN_PRICES_CENTS[l.plan] ?? 0,
    updatedAt: l.updatedAt?.toISOString() ?? null,
  };
}

const LICENSE_ORG_INCLUDE = { org: { select: { id: true, name: true, slug: true, status: true, deletedAt: true } } } satisfies Prisma.LicenseInclude;

export async function listLicenses(opts: { status?: string }) {
  const licenses = await db.license.findMany({
    where: { ...(opts.status ? { status: opts.status } : {}), org: { deletedAt: null } },
    include: LICENSE_ORG_INCLUDE,
    orderBy: { expiresAt: "asc" },
  });
  return licenses.map(licenseRow);
}

export async function getLicense(id: string) {
  const license = await db.license.findUnique({ where: { id }, include: LICENSE_ORG_INCLUDE });
  if (!license || license.org.deletedAt) throw notFound("License not found.");
  return licenseRow(license);
}

/** Full license key — audited, only for partners, never for deleted tenants. */
export async function revealLicenseKey(id: string, actor: PartnerActor) {
  const license = await db.license.findUnique({
    where: { id },
    include: { org: { select: { name: true, deletedAt: true } } },
  });
  if (!license || license.org.deletedAt) throw notFound("License not found.");
  await db.auditLog.create({
    data: {
      orgId: license.orgId,
      actorType: "support",
      actorLabel: actor.label,
      action: "partner.license_key_revealed",
      entityType: "license",
      entityId: license.id,
      after: JSON.stringify({ licenseId: license.id, orgName: license.org.name }),
      ip: actor.ip ?? null,
      userAgent: actor.userAgent ?? null,
    },
  });
  return { key: license.key };
}

export interface IssueLicenseInput {
  orgId: string;
  plan?: string;
  seats?: number;
  termMonths?: number;
  status?: LicenseStatus;
  notes?: string;
}

export async function issueLicense(input: IssueLicenseInput, actor: PartnerActor) {
  const org = await db.organization.findFirst({ where: { id: input.orgId, deletedAt: null }, include: { license: true } });
  if (!org) throw notFound("Church not found.");
  // CREATE-ONLY — the old upsert's update branch could silently resurrect a
  // cancelled license and skipped the reason/concurrency rules of the state
  // machine. Changes go through Manage license (updateLicense) instead.
  if (org.license) throw conflict("A license already exists for this church. Use Manage license to change it.");
  const plan = PLANS.includes((input.plan ?? "growth") as Plan) ? (input.plan as Plan) : "growth";
  const seats = clampInt(input.seats, 1, 10000, 250);
  const termMonths = clampInt(input.termMonths, 1, 60, 12);
  const status = LICENSE_STATUSES.includes((input.status ?? "active") as LicenseStatus) ? (input.status as LicenseStatus) : "active";

  const license = await db.license
    .create({
      data: {
        orgId: input.orgId,
        key: newLicenseKey(),
        plan,
        seats,
        status,
        expiresAt: new Date(Date.now() + termMonths * 30 * 86400000),
        notes: input.notes?.trim() || null,
      },
      include: LICENSE_ORG_INCLUDE,
    })
    .catch((err: unknown) => {
      // Race backstop — License.orgId is unique; a concurrent issuance loses here.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw conflict("A license already exists for this church. Use Manage license to change it.");
      }
      throw err;
    });
  // Plan sync — conditional so an org archived mid-flight is never resurrected
  // (count deliberately ignored: the license is the source of truth).
  await db.organization.updateMany({ where: { id: input.orgId, deletedAt: null }, data: { plan } });
  await db.auditLog.create({
    data: {
      orgId: input.orgId,
      actorType: "support",
      actorLabel: actor.label,
      action: "partner.license_issued",
      entityType: "license",
      entityId: license.id,
      after: JSON.stringify({ plan, seats, status, termMonths }),
      ip: actor.ip ?? null,
      userAgent: actor.userAgent ?? null,
    },
  });
  // The issuance response carries the full key exactly once — audit it like a
  // reveal so every unmasked-key event is provable.
  await db.auditLog.create({
    data: {
      orgId: input.orgId,
      actorType: "support",
      actorLabel: actor.label,
      action: "partner.license_key_revealed",
      entityType: "license",
      entityId: license.id,
      after: JSON.stringify({ licenseId: license.id, orgName: license.org.name, via: "issuance" }),
      ip: actor.ip ?? null,
      userAgent: actor.userAgent ?? null,
    },
  });
  // full key shown exactly once at issuance (key is masked everywhere else)
  return { ...licenseRow(license), key: license.key };
}

export interface UpdateLicenseInput {
  plan?: string;
  seats?: number;
  status?: LicenseStatus;
  extendMonths?: number;
  notes?: string | null;
  /** Required (≥10 chars) when transitioning to suspended/cancelled — audited, never stored in notes. */
  statusReason?: string;
  /** Optimistic-concurrency token — must match license.updatedAt when that exists. */
  expectedUpdatedAt?: string | null;
}

/** Explicit status machine — anything not listed (and not a same-status no-op) is rejected. */
const ALLOWED_TRANSITIONS: Record<LicenseStatus, readonly LicenseStatus[]> = {
  trial: ["active", "past_due", "suspended", "cancelled"],
  active: ["past_due", "suspended", "cancelled"],
  past_due: ["active", "suspended", "cancelled"],
  suspended: ["active", "cancelled"],
  cancelled: [], // FINAL
};

export async function updateLicense(licenseId: string, input: UpdateLicenseInput, actor: PartnerActor) {
  const license = await db.license.findUnique({ where: { id: licenseId }, include: LICENSE_ORG_INCLUDE });
  if (!license || license.org.deletedAt) throw notFound("License not found.");

  // Optimistic concurrency — a stale manage dialog must never silently
  // overwrite a change another partner just made. Licenses that have never
  // been edited (updatedAt null, pre-migration rows) skip the check.
  if (license.updatedAt && input.expectedUpdatedAt !== license.updatedAt.toISOString()) {
    throw new ApiError(409, "stale_write", "This license was just changed by someone else. Reload and try again.");
  }

  const statusReason = input.statusReason?.trim() || undefined;

  if (input.status !== undefined) {
    if (!LICENSE_STATUSES.includes(input.status)) throw badRequest(`Status must be one of ${LICENSE_STATUSES.join(", ")}.`);
    if (input.status !== license.status) {
      if (license.status === "cancelled") {
        throw badRequest("Cancelled licenses are final and cannot be reactivated.");
      }
      const allowed = ALLOWED_TRANSITIONS[license.status as LicenseStatus] ?? [];
      if (!allowed.includes(input.status)) {
        throw badRequest(`Cannot change license status from "${license.status}" to "${input.status}".`);
      }
      if (input.status === "suspended" || input.status === "cancelled") {
        if (!statusReason || statusReason.length < 10) {
          throw badRequest(
            `A reason of at least 10 characters is required to ${input.status === "suspended" ? "suspend" : "cancel"} a license.`,
          );
        }
      }
    }
  }

  const data: Record<string, unknown> = {};
  if (input.plan !== undefined) {
    if (!PLANS.includes(input.plan as Plan)) throw badRequest(`Plan must be one of ${PLANS.join(", ")}.`);
    data.plan = input.plan;
  }
  if (input.seats !== undefined) data.seats = clampInt(input.seats, 1, 10000, 250);
  if (input.status !== undefined) data.status = input.status;
  if (input.notes !== undefined) data.notes = input.notes?.trim() || null;
  if (input.extendMonths !== undefined) {
    // Strict parse — a caller that SENDS extendMonths must send a number;
    // silently extending on "abc" would mislead the partner about the new
    // expiry (contrast with seats, where a plan-ish default is harmless).
    const parsed = Math.floor(Number(input.extendMonths));
    if (!Number.isFinite(parsed)) throw badRequest("extendMonths must be a number.");
    const months = Math.max(1, Math.min(60, parsed));
    const base = Math.max(license.expiresAt.getTime(), Date.now());
    data.expiresAt = new Date(base + months * 30 * 86400000);
    // Renewing usually means money arrived — auto-reactivate ONLY when the
    // caller did not make an explicit status choice.
    if (input.status === undefined && (license.status === "past_due" || license.expiresAt.getTime() < Date.now())) {
      data.status = "active";
    }
  }
  if (Object.keys(data).length === 0) throw badRequest("Nothing to update.");

  // Conditional write — the optimistic token is enforced IN the UPDATE (not
  // just the early check) so a change landing between check and write cannot
  // be silently overwritten. Prisma bumps @updatedAt on updateMany too.
  const res = await db.license.updateMany({
    where: { id: licenseId, ...(license.updatedAt ? { updatedAt: license.updatedAt } : {}) },
    data,
  });
  if (res.count === 0) {
    throw new ApiError(409, "stale_write", "This license was just changed by someone else. Reload and try again.");
  }
  // Plan sync — conditional so an archived tenant is never resurrected
  // (count deliberately ignored: informational denormalization only).
  if (data.plan) {
    await db.organization.updateMany({ where: { id: license.orgId, deletedAt: null }, data: { plan: data.plan as string } });
  }
  await db.auditLog.create({
    data: {
      orgId: license.orgId,
      actorType: "support",
      actorLabel: actor.label,
      action: "partner.license_updated",
      entityType: "license",
      entityId: licenseId,
      before: JSON.stringify({
        plan: license.plan,
        seats: license.seats,
        status: license.status,
        expiresAt: license.expiresAt,
        statusReason: statusReason ?? null,
      }),
      after: JSON.stringify({
        ...data,
        expiresAt: (data.expiresAt as Date | undefined) ?? license.expiresAt,
        statusReason: statusReason ?? null,
      }),
      ip: actor.ip ?? null,
      userAgent: actor.userAgent ?? null,
    },
  });

  // Respond with the fresh row in the standard license shape.
  const fresh = await db.license.findUnique({ where: { id: licenseId }, include: LICENSE_ORG_INCLUDE });
  if (!fresh) throw notFound("License not found.");
  return licenseRow(fresh);
}
