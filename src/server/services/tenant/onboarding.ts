import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { randomBytes } from "crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { hashPassword } from "@/server/auth";
import { ROLE_TEMPLATES } from "@/server/permissions";
import { audit } from "@/server/audit";
import { badRequest, conflict, forbidden, notFound } from "@/server/http";
import { encryptField, maskSensitive, decryptField } from "@/server/services/tenant/crypto";
import { firstAvailableSubdomain, reserveSubdomainInTx, slugifySubdomain, subdomainAvailable, tenantUrl, validateSubdomain } from "@/server/services/tenant/subdomain";
import { DPA_VERSION } from "@/lib/nigeria";
import { provisionDefaults } from "./defaults";

/**
 * Tenant onboarding service (backend only) — spec §4/§5.
 * The self-signup flow provisions EVERYTHING in ONE atomic transaction:
 * church record (Nigerian legal fields) → trustees → subdomain reservation →
 * owner account + owner role → trial license → default funds + chart of
 * accounts → redacted onboarding audit trail. Any failure rolls the whole
 * thing back — no orphaned subdomains, no orphaned users.
 */

const TENANT_TIMEZONE = "Africa/Lagos";
const TRIAL_DAYS = 60;
export const APP_PERMISSION = "admin.view"; // who can see onboarding status in-app

// ── input types ──────────────────────────────────────────────────────────────

export interface FilePayload {
  name: string;
  contentType: string; // application/pdf | image/png | image/jpeg
  dataBase64: string;
}

export interface TrusteeInput {
  fullName: string;
  trusteeRole?: string; // Chairman | Secretary | Treasurer | Trustee
  phone?: string;
  email?: string;
  residentialAddress?: string;
  idType?: string; // nin | international_passport | voters_card | drivers_license
  idNumber?: string;
  idDocument?: FilePayload | null;
}

export interface SignupInput {
  // Step 1 — church identity
  displayName: string;
  registeredLegalName: string;
  denomination?: string;
  foundedOn?: string; // ISO yyyy-mm-dd
  preferredSubdomain?: string; // editable suggestion from the wizard
  // Step 2 — legal & regulatory
  cacNumber?: string;
  cacRegistrationDate?: string;
  cacCertificate?: FilePayload | null;
  tin?: string;
  scumlNumber?: string;
  // Step 3 — trustees (CAC: minimum 2)
  trustees: TrusteeInput[];
  // Step 4 — address & leadership
  registeredAddressLine1?: string;
  registeredAddressLine2?: string;
  registeredState?: string;
  registeredLga?: string;
  worshipSameAsRegistered?: boolean;
  worshipAddress?: string;
  headPastorName?: string;
  headPastorPhone?: string;
  headPastorEmail?: string;
  headPastorNin?: string;
  // Step 5 — banking (optional at signup, required before online giving)
  bankName?: string;
  bankAccountNumber?: string;
  bankAccountName?: string;
  // Step 6 — NDPA acknowledgment
  ndpaAcknowledged: boolean;
  // Step 7 — owner account
  owner: {
    fullName: string;
    email: string;
    phone?: string;
    password: string;
    confirmAuthorized: boolean;
  };
  // Step 8 — extras
  memberCountEstimate?: number;
  // anti-bot
  honeypot?: string; // must stay empty (CAPTCHA stand-in for the sandbox)
}

export interface SignupResult {
  orgId: string;
  displayName: string;
  subdomain: string;
  url: string;
  status: string;
  ownerEmail: string;
  loginPath: string;
  checklist: VerificationChecklist;
}

export interface VerificationChecklist {
  cacComplete: boolean;
  certificateUploaded: boolean;
  trusteesComplete: boolean;
  bankingComplete: boolean;
  ndpaAccepted: boolean;
  missing: string[]; // human labels of what a compliance reviewer still needs
}

// ── validation ───────────────────────────────────────────────────────────────

const ALLOWED_DOC_TYPES = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);
const MAX_DOC_BYTES = 4 * 1024 * 1024;
const ID_TYPES = new Set(["nin", "international_passport", "voters_card", "drivers_license"]);
const TRUSTEE_ROLES = new Set(["Chairman", "Secretary", "Treasurer", "Trustee", "Member"]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function docBytes(file?: FilePayload | null): number {
  if (!file?.dataBase64) return 0;
  return Math.floor((file.dataBase64.length * 3) / 4);
}

function validateInput(input: SignupInput): void {
  if (input.honeypot?.trim()) throw badRequest("Signup could not be verified. Please try again."); // bot trap
  const displayName = input.displayName?.trim() ?? "";
  const legalName = input.registeredLegalName?.trim() ?? "";
  if (displayName.length < 3 || displayName.length > 150) throw badRequest("Church display name is required (3-150 characters).");
  if (legalName.length < 3 || legalName.length > 255) throw badRequest("The registered legal name (as on the CAC certificate) is required.");
  if (input.foundedOn && Number.isNaN(Date.parse(input.foundedOn))) throw badRequest("Founding date is not a valid date.");
  if (input.cacRegistrationDate && Number.isNaN(Date.parse(input.cacRegistrationDate))) throw badRequest("CAC registration date is not a valid date.");
  if (input.cacCertificate) {
    if (!ALLOWED_DOC_TYPES.has(input.cacCertificate.contentType)) throw badRequest("The CAC certificate must be a PDF, PNG or JPG file.");
    if (docBytes(input.cacCertificate) > MAX_DOC_BYTES) throw badRequest("The CAC certificate is too large (4 MB maximum).");
  }
  if (!Array.isArray(input.trustees)) throw badRequest("Trustee information is required.");
  if (input.trustees.length < 2) throw badRequest("CAC Incorporated Trustees registration requires at least 2 trustees.");
  if (input.trustees.length > 15) throw badRequest("Please list up to 15 trustees — contact support for larger boards.");
  const seenEmails = new Set<string>();
  for (const [i, t] of input.trustees.entries()) {
    if (!t.fullName?.trim()) throw badRequest(`Trustee ${i + 1}: full legal name is required.`);
    if (t.trusteeRole && !TRUSTEE_ROLES.has(t.trusteeRole)) throw badRequest(`Trustee ${i + 1}: unknown role.`);
    if (t.email?.trim() && !EMAIL_RE.test(t.email.trim())) throw badRequest(`Trustee ${i + 1}: email address is not valid.`);
    if (t.email?.trim() && seenEmails.has(t.email.trim().toLowerCase())) throw badRequest(`Trustee ${i + 1}: duplicate email address.`);
    if (t.email?.trim()) seenEmails.add(t.email.trim().toLowerCase());
    if (t.idType && !ID_TYPES.has(t.idType)) throw badRequest(`Trustee ${i + 1}: unknown ID type.`);
    if (t.idDocument) {
      if (!ALLOWED_DOC_TYPES.has(t.idDocument.contentType)) throw badRequest(`Trustee ${i + 1}: ID document must be a PDF, PNG or JPG file.`);
      if (docBytes(t.idDocument) > MAX_DOC_BYTES) throw badRequest(`Trustee ${i + 1}: ID document is too large (4 MB maximum).`);
    }
  }
  if (input.ndpaAcknowledged !== true) throw badRequest("The Nigeria Data Protection Act acknowledgment is required to create an account.");
  const owner = input.owner;
  if (!owner?.fullName?.trim()) throw badRequest("Owner's full name is required.");
  if (!owner.email?.trim() || !EMAIL_RE.test(owner.email.trim())) throw badRequest("A valid owner email address is required.");
  if (!owner.password || owner.password.length < 8) throw badRequest("Owner password must be at least 8 characters.");
  if (owner.confirmAuthorized !== true) throw badRequest("Please confirm you are authorized to act on behalf of the registered trustees.");
  if (input.memberCountEstimate != null && (!Number.isFinite(input.memberCountEstimate) || input.memberCountEstimate < 1 || input.memberCountEstimate > 500000)) {
    throw badRequest("Estimated member count looks incorrect.");
  }
}

// ── rate limiting (in-memory sliding window — CAPTCHA/Turnstile in production) ──

const buckets = new Map<string, number[]>();
export function checkSignupRateLimit(ip: string | null | undefined): void {
  const key = ip ?? "unknown";
  const now = Date.now();
  const window = 60 * 60 * 1000;
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < window);
  if (hits.length >= 5) throw forbidden("Too many signup attempts from this network. Please try again in an hour.");
  hits.push(now);
  buckets.set(key, hits);
}

// ── private document storage (never publicly readable — spec §6) ─────────────

const UPLOAD_ROOT = path.join(process.cwd(), "db", "uploads");

async function storeDocument(orgId: string, kind: string, file: FilePayload, txTx: Prisma.TransactionClient, uploadedBy: string): Promise<string> {
  const dir = path.join(UPLOAD_ROOT, orgId);
  await mkdir(dir, { recursive: true });
  const ext = file.contentType === "application/pdf" ? "pdf" : file.contentType.split("/")[1]?.replace("jpeg", "jpg") ?? "bin";
  const storageKey = path.join(orgId, `${kind}-${randomBytes(8).toString("hex")}.${ext}`);
  await writeFile(path.join(UPLOAD_ROOT, storageKey), Buffer.from(file.dataBase64, "base64"));
  const rec = await txTx.fileRecord.create({
    data: {
      orgId,
      ownerType: "organization",
      ownerId: orgId,
      kind,
      storageKey,
      contentType: file.contentType,
      byteSize: docBytes(file),
      visibility: "staff", // private — access only via permission-checked endpoints
      uploadedBy,
    },
  });
  return rec.id;
}

// ── default data (reusing seed.ts conventions) ───────────────────────────────

const ROLE_NAMES: Record<string, string> = {
  owner: "Owner", campus_admin: "Campus Admin", finance: "Finance",
  ministry_leader: "Ministry Leader", volunteer: "Volunteer", member: "Member",
};

// ── redacted audit snapshots (NO raw IDs/NINs/bank numbers — spec §6) ────────

function redactedSnapshot(input: SignupInput, subdomain: string): Record<string, unknown> {
  return {
    displayName: input.displayName.trim(),
    registeredLegalName: input.registeredLegalName.trim(),
    denomination: input.denomination?.trim() || null,
    foundedOn: input.foundedOn || null,
    subdomain,
    cac: {
      number: input.cacNumber?.trim() ? `…${input.cacNumber.trim().slice(-3)}` : null,
      date: input.cacRegistrationDate || null,
      certificateUploaded: !!input.cacCertificate,
    },
    tin: input.tin?.trim() ? `…${input.tin.trim().slice(-3)}` : null,
    scuml: input.scumlNumber?.trim() || null,
    registeredState: input.registeredState || null,
    registeredLga: input.registeredLga || null,
    headPastor: { name: input.headPastorName?.trim() || null, ninProvided: !!input.headPastorNin?.trim() },
    banking: { bank: input.bankName?.trim() || null, accountProvided: !!input.bankAccountNumber?.trim() },
    trustees: input.trustees.map((t) => ({ name: t.fullName.trim(), role: t.trusteeRole || "Trustee", idProvided: !!t.idNumber?.trim(), docUploaded: !!t.idDocument })),
    ndpa: { acknowledged: true, dpaVersion: DPA_VERSION },
    ownerEmail: input.owner.email.trim().toLowerCase(),
  };
}

// ── the atomic provisioning transaction (spec §5) ────────────────────────────

export async function createTenantFromSignup(
  input: SignupInput,
  meta: { ip?: string | null; userAgent?: string | null },
): Promise<SignupResult> {
  validateInput(input);

  const displayName = input.displayName.trim();
  const legalName = input.registeredLegalName.trim();
  const ownerEmail = input.owner.email.trim().toLowerCase();

  const emailTaken = await db.user.findUnique({ where: { email: ownerEmail }, select: { id: true } });
  if (emailTaken) throw conflict(`An account with email "${ownerEmail}" already exists. Try signing in instead.`);

  // subdomain: honor the wizard's (validated) preference, else auto-generate
  let subdomain: string;
  const preferred = (input.preferredSubdomain ?? "").toLowerCase().trim();
  if (preferred) {
    const check = validateSubdomain(preferred);
    if (!check.ok) throw badRequest(`Preferred URL is not usable: ${check.reason}`);
    if (!(await subdomainAvailable(preferred))) throw conflict(`The address "${preferred}" was just taken — please pick another suggestion.`);
    subdomain = preferred;
  } else {
    subdomain = await firstAvailableSubdomain(displayName);
  }

  const estimate = input.memberCountEstimate ?? null;
  const seats = Math.max(100, Math.min(10000, estimate ? Math.ceil(estimate * 1.5) : 100));
  const slugClash = await db.organization.findUnique({ where: { slug: subdomain }, select: { id: true } });
  if (slugClash) throw conflict(`The address "${subdomain}" was just taken — please pick another suggestion.`);

  const checklist: VerificationChecklist = {
    cacComplete: !!input.cacNumber?.trim() && !!input.cacRegistrationDate,
    certificateUploaded: !!input.cacCertificate,
    trusteesComplete: input.trustees.filter((t) => t.idNumber?.trim()).length >= 2,
    bankingComplete: !!input.bankName?.trim() && !!input.bankAccountNumber?.trim() && !!input.bankAccountName?.trim(),
    ndpaAccepted: true,
    missing: [],
  };
  if (!checklist.cacComplete) checklist.missing.push("CAC registration number & date");
  if (!checklist.certificateUploaded) checklist.missing.push("CAC certificate upload");
  if (!checklist.trusteesComplete) checklist.missing.push("Government ID numbers for at least 2 trustees");
  if (!checklist.bankingComplete) checklist.missing.push("Church settlement bank account");

  const created = await db.$transaction(async (tx) => {
    // 1) church record — pending_verification until a human verifies CAC docs
    const org = await tx.organization.create({
      data: {
        name: displayName,
        slug: subdomain, // final arbiter: unique constraint (race-safe)
        timezone: TENANT_TIMEZONE,
        currency: "NGN",
        locale: "en-NG",
        plan: "starter",
        status: "pending_verification",
        onboardedVia: "self_signup",
        registeredLegalName: legalName,
        cacNumber: input.cacNumber?.trim() || null,
        cacRegistrationDate: input.cacRegistrationDate ? new Date(input.cacRegistrationDate) : null,
        tin: input.tin?.trim() || null,
        scumlNumber: input.scumlNumber?.trim() || null,
        denomination: input.denomination?.trim() || null,
        foundedOn: input.foundedOn ? new Date(input.foundedOn) : null,
        registeredAddressLine1: input.registeredAddressLine1?.trim() || null,
        registeredAddressLine2: input.registeredAddressLine2?.trim() || null,
        registeredState: input.registeredState?.trim() || null,
        registeredLga: input.registeredLga?.trim() || null,
        registeredCountry: "NG",
        headPastorName: input.headPastorName?.trim() || null,
        headPastorPhone: input.headPastorPhone?.trim() || null,
        headPastorEmail: input.headPastorEmail?.trim() || null,
        headPastorNinEnc: encryptField(input.headPastorNin),
        bankName: input.bankName?.trim() || null,
        bankAccountNumberEnc: encryptField(input.bankAccountNumber),
        bankAccountName: input.bankAccountName?.trim() || null,
        memberCountEstimate: estimate,
        ndpaAcknowledgedAt: new Date(),
        ndpaAcknowledgedBy: ownerEmail,
        dpaVersionAccepted: DPA_VERSION,
        settings: JSON.stringify({ timezoneSource: "signup", aiAssistantEnabled: false }),
      },
    });

    // 2) subdomain reservation (registry row — rolls back with the tx)
    await reserveSubdomainInTx(tx as unknown as Parameters<typeof reserveSubdomainInTx>[0], org.id, subdomain);

    // 3) worship campus (registered address or the entered worship address)
    const worshipAddress = input.worshipSameAsRegistered ? input.registeredAddressLine1?.trim() : input.worshipAddress?.trim();
    const campus = await tx.campus.create({
      data: {
        orgId: org.id,
        name: `${displayName} — Main`,
        code: "MAIN",
        address: worshipAddress || null,
        region: input.registeredState?.trim() || null,
        isPrimary: true,
        timezone: TENANT_TIMEZONE,
      },
    });

    // 4) CAC certificate (private storage + FileRecord inside the tx)
    let certificateFileId: string | null = null;
    if (input.cacCertificate) {
      certificateFileId = await storeDocument(org.id, "cac_certificate", input.cacCertificate, tx, ownerEmail);
      await tx.organization.update({ where: { id: org.id }, data: { cacCertificateFileId: certificateFileId } });
    }

    // 5) trustees (≥2 enforced) — ID numbers encrypted, ID docs private
    for (const t of input.trustees) {
      let docFileId: string | null = null;
      if (t.idDocument) docFileId = await storeDocument(org.id, "trustee_id", t.idDocument, tx, ownerEmail);
      await tx.churchTrustee.create({
        data: {
          orgId: org.id,
          fullName: t.fullName.trim(),
          trusteeRole: t.trusteeRole?.trim() || "Trustee",
          phone: t.phone?.trim() || null,
          email: t.email?.trim() || null,
          residentialAddress: t.residentialAddress?.trim() || null,
          idType: t.idType?.trim() || null,
          idNumberEnc: encryptField(t.idNumber),
          idDocumentFileId: docFileId,
        },
      });
    }

    // 6) system roles + owner account (reuse the established RBAC seeding)
    for (const [key, permissions] of Object.entries(ROLE_TEMPLATES)) {
      await tx.role.create({
        data: {
          orgId: org.id, key, name: ROLE_NAMES[key] ?? key,
          description: `Default ${ROLE_NAMES[key] ?? key} role`,
          isSystem: true,
          permissions: { create: permissions.map((permission) => ({ permission })) },
        },
      });
    }
    const ownerRole = await tx.role.findFirst({ where: { orgId: org.id, key: "owner" } });
    const user = await tx.user.create({
      data: {
        email: ownerEmail,
        name: input.owner.fullName.trim(),
        passwordHash: hashPassword(input.owner.password),
        mustChangePassword: true,
        status: "active",
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

    // 7) trial license (licenseGateForOrg compatibility from day one)
    await tx.license.create({
      data: {
        orgId: org.id,
        key: `GCHMS-${randomBytes(2).toString("hex").toUpperCase().replace(/[OIL]/g, "X")}-${randomBytes(2).toString("hex").toUpperCase().replace(/[OIL]/g, "X")}-${randomBytes(2).toString("hex").toUpperCase().replace(/[OIL]/g, "X")}`,
        plan: "starter", seats, status: "trial",
        expiresAt: new Date(Date.now() + TRIAL_DAYS * 86400000),
        notes: `Self-signup trial — ${estimate ? `~${estimate} members` : "size not stated"}`,
      },
    });

    // 8) default funds + chart-of-accounts skeleton (shared provisioning)
    await provisionDefaults(tx, org.id);

    // 9) redacted onboarding audit trail (steps in order)
    const snap = redactedSnapshot(input, subdomain);
    await tx.tenantOnboardingAudit.create({ data: { orgId: org.id, step: "legal_info_submitted", payloadSnapshot: JSON.stringify(snap) } });
    await tx.tenantOnboardingAudit.create({ data: { orgId: org.id, step: "trustees_submitted", payloadSnapshot: JSON.stringify({ count: input.trustees.length, trustees: snap.trustees }) } });
    await tx.tenantOnboardingAudit.create({ data: { orgId: org.id, step: "subdomain_provisioned", payloadSnapshot: JSON.stringify({ subdomain, url: tenantUrl(subdomain) }) } });
    await tx.tenantOnboardingAudit.create({ data: { orgId: org.id, step: "owner_created", payloadSnapshot: JSON.stringify({ ownerEmail, mustChangePassword: true }) } });
    // welcome delivery — SMTP/email provider is not configured in this build;
    // the welcome pack (URL + checklist) is shown on-screen and logged here.
    await tx.tenantOnboardingAudit.create({ data: { orgId: org.id, step: "welcome_sent", payloadSnapshot: JSON.stringify({ channel: "on_screen", url: tenantUrl(subdomain), ownerEmail, missing: checklist.missing }) } });

    await tx.auditLog.create({
      data: {
        orgId: org.id,
        actorType: "system",
        actorLabel: "self-signup",
        action: "tenant.self_signup",
        entityType: "organization",
        entityId: org.id,
        after: JSON.stringify({ name: displayName, subdomain, status: "pending_verification", trustees: input.trustees.length }),
        ip: meta.ip ?? null,
        userAgent: meta.userAgent ?? null,
      },
    });

    return { org, membershipId: membership.id };
  });

  // platform-level audit entry (org-scoped trail exists inside the tx already)
  await audit({
    orgId: created.org.id,
    actor: { membershipId: created.membershipId, name: ownerEmail } as never,
    actorType: "system",
    action: "tenant.self_signup",
    entityType: "organization",
    entityId: created.org.id,
    after: { subdomain, status: "pending_verification" },
    ip: meta.ip ?? undefined,
    userAgent: meta.userAgent ?? undefined,
  }).catch(() => {});

  return {
    orgId: created.org.id,
    displayName,
    subdomain,
    url: tenantUrl(subdomain),
    status: "pending_verification",
    ownerEmail,
    loginPath: "/",
    checklist,
  };
}

// ── payment gating (spec §6): online giving needs verified status + bank KYC ──

export async function assertOnlineGivingAllowed(orgId: string): Promise<void> {
  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: { status: true, name: true, bankAccountNumberEnc: true, onboardedVia: true },
  });
  if (!org) throw notFound("Church account not found.");
  // Grandfathering: tenants that predate the onboarding flow keep working
  // exactly as before — the KYC gate applies to self-signup churches only.
  if (org.onboardedVia !== "self_signup") return;
  if (org.status !== "active") {
    throw forbidden(`${org.name}'s account is still pending verification — online giving unlocks once the platform verifies the church's CAC documentation. You can continue recording gifts in cash/check batches in the meantime.`);
  }
  if (!org.bankAccountNumberEnc) {
    throw forbidden("Online giving is locked until the church's settlement bank account is added. This protects funds until banking KYC is complete.");
  }
}

// ── in-app onboarding status (owner/admin — "complete your verification") ────

export async function onboardingStatusFor(orgId: string) {
  const org = await db.organization.findUnique({
    where: { id: orgId },
    include: { trustees: true, onboardingAudit: { orderBy: { performedAt: "desc" }, take: 20 }, license: true },
  });
  if (!org) throw notFound("Church not found.");
  const grandfathered = org.onboardedVia !== "self_signup";

  const checklist: VerificationChecklist = {
    cacComplete: !!org.cacNumber && !!org.cacRegistrationDate,
    certificateUploaded: !!org.cacCertificateFileId,
    trusteesComplete: org.trustees.filter((t) => t.idNumberEnc).length >= 2,
    bankingComplete: !!org.bankName && !!org.bankAccountNumberEnc && !!org.bankAccountName,
    ndpaAccepted: !!org.ndpaAcknowledgedAt,
    missing: [],
  };
  if (!checklist.cacComplete) checklist.missing.push("CAC registration number & date");
  if (!checklist.certificateUploaded) checklist.missing.push("CAC certificate upload");
  if (!checklist.trusteesComplete) checklist.missing.push("Government ID numbers for at least 2 trustees");
  if (!checklist.bankingComplete) checklist.missing.push("Church settlement bank account");

  return {
    orgId: org.id,
    displayName: org.name,
    legalName: org.registeredLegalName,
    subdomain: org.slug,
    url: tenantUrl(org.slug),
    status: org.status,
    paymentsEnabled: org.status === "active" && (grandfathered || !!org.bankAccountNumberEnc),
    bankAccountMasked: maskSensitive(decryptField(org.bankAccountNumberEnc)),
    dpaVersionAccepted: org.dpaVersionAccepted,
    ndpaAcknowledgedAt: org.ndpaAcknowledgedAt,
    trusteeCount: org.trustees.length,
    checklist,
    audit: org.onboardingAudit.map((a) => ({ step: a.step, at: a.performedAt, snapshot: a.payloadSnapshot ? safeParse(a.payloadSnapshot) : null })),
  };
}

function safeParse(json: string): unknown {
  try { return JSON.parse(json); } catch { return null; }
}

/** Public branding lookup used by the subdomain middleware / login page. */
export async function brandingForSubdomain(subdomain: string) {
  const clean = slugifySubdomain(subdomain);
  if (!clean) return { found: false as const };
  const org = await db.organization.findUnique({
    where: { slug: clean },
    select: { name: true, slug: true, status: true, denomination: true, settings: true },
  });
  if (!org) return { found: false as const };
  let logoUrl: string | null = null;
  try {
    const settings = org.settings ? (JSON.parse(org.settings) as Record<string, unknown>) : {};
    logoUrl = typeof settings.logoUrl === "string" ? settings.logoUrl : null;
  } catch { /* ignore */ }
  return {
    found: true as const,
    name: org.name,
    subdomain: org.slug,
    url: tenantUrl(org.slug),
    status: org.status,
    denomination: org.denomination,
    logoUrl,
  };
}
