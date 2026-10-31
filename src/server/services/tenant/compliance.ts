import { db } from "@/server/db";
import { badRequest, forbidden, notFound } from "@/server/http";
import { createReadStream } from "fs";
import { stat } from "fs/promises";
import path from "path";
import { maskSensitive, decryptField } from "@/server/services/tenant/crypto";
import { tenantUrl } from "@/server/services/tenant/subdomain";

/**
 * Compliance review service (backend only) — spec §5/§8. The human process on
 * the platform side: review pending_verification tenants, check CAC details +
 * trustees + documents, then activate. Access is partner-session guarded (the
 * router enforces this for partner/* routes) and every action is audit-logged.
 *
 * Privacy rules respected here:
 * • ID numbers / bank numbers are shown MASKED only — raw values never leave
 *   the server (decryption happens solely for the mask).
 * • Uploaded documents are streamed through a permission-checked endpoint,
 *   never served from a public path.
 */

const UPLOAD_ROOT = path.join(process.cwd(), "db", "uploads");

function safeParse(json: string | null | undefined): unknown {
  try { return json ? JSON.parse(json) : null; } catch { return null; }
}

/** Compliance checklist for one org (exported for Board Reporting — booleans only, no PII). */
export function checklistFor(org: {
  cacNumber: string | null; cacRegistrationDate: Date | null; cacCertificateFileId: string | null;
  bankName: string | null; bankAccountNumberEnc: string | null; bankAccountName: string | null;
  ndpaAcknowledgedAt: Date | null; trustees: { idNumberEnc: string | null }[];
}) {
  const items = [
    { key: "cac", label: "CAC registration number & date", done: !!org.cacNumber && !!org.cacRegistrationDate },
    { key: "certificate", label: "CAC certificate uploaded", done: !!org.cacCertificateFileId },
    { key: "trustees", label: "ID numbers for ≥2 trustees", done: org.trustees.filter((t) => t.idNumberEnc).length >= 2 },
    { key: "banking", label: "Settlement bank account", done: !!org.bankName && !!org.bankAccountNumberEnc && !!org.bankAccountName },
    { key: "ndpa", label: "NDPA/DPA acknowledgment", done: !!org.ndpaAcknowledgedAt },
  ];
  return { items, allDone: items.every((i) => i.done) };
}

export async function complianceQueue() {
  const [pending, recentlyVerified] = await Promise.all([
    db.organization.findMany({
      where: { status: "pending_verification" },
      include: {
        trustees: true, license: true,
        onboardingAudit: { orderBy: { performedAt: "desc" }, take: 1 },
      },
      orderBy: { createdAt: "asc" },
    }),
    db.organization.findMany({
      where: { status: "active", onboardedVia: "self_signup" },
      include: { trustees: true, license: true, onboardingAudit: { orderBy: { performedAt: "desc" }, take: 1 } },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);

  const row = (org: typeof pending[number] & { status: string }) => {
    const check = checklistFor(org);
    return {
      id: org.id,
      name: org.name,
      legalName: org.registeredLegalName,
      subdomain: org.slug,
      url: tenantUrl(org.slug),
      status: org.status,
      denomination: org.denomination,
      cacNumber: org.cacNumber,
      cacRegistrationDate: org.cacRegistrationDate,
      certificateUploaded: !!org.cacCertificateFileId,
      trusteeCount: org.trustees.length,
      state: org.registeredState,
      lga: org.registeredLga,
      estimate: org.memberCountEstimate,
      plan: org.license?.plan ?? "starter",
      licenseStatus: org.license?.status ?? "none",
      createdAt: org.createdAt,
      checklist: check.items,
      readyForReview: check.allDone,
    };
  };

  return {
    pending: pending.map(row),
    recentlyVerified: recentlyVerified.map(row),
  };
}

export async function complianceDetail(orgId: string) {
  const org = await db.organization.findUnique({
    where: { id: orgId },
    include: {
      trustees: { orderBy: { createdAt: "asc" } },
      campuses: { where: { deletedAt: null } },
      license: true,
      onboardingAudit: { orderBy: { performedAt: "asc" } },
      memberships: {
        where: { status: "active" },
        include: { user: { select: { email: true, name: true, lastLoginAt: true } }, roleAssignments: { include: { role: { select: { name: true, key: true } } } } },
      },
    },
  });
  if (!org) throw notFound("Church not found.");

  const check = checklistFor(org);
  const ownerMembership = org.memberships.find((m) => m.roleAssignments.some((ra) => ra.role.key === "owner")) ?? org.memberships[0] ?? null;

  return {
    id: org.id,
    name: org.name,
    legalName: org.registeredLegalName,
    subdomain: org.slug,
    url: tenantUrl(org.slug),
    status: org.status,
    onboardedVia: org.onboardedVia,
    denomination: org.denomination,
    foundedOn: org.foundedOn,
    cac: {
      number: org.cacNumber,
      date: org.cacRegistrationDate,
      certificateFileId: org.cacCertificateFileId,
    },
    tin: org.tin,
    scumlNumber: org.scumlNumber,
    registeredAddress: {
      line1: org.registeredAddressLine1,
      line2: org.registeredAddressLine2,
      state: org.registeredState,
      lga: org.registeredLga,
      country: org.registeredCountry,
    },
    worshipCampus: org.campuses[0] ? { name: org.campuses[0].name, address: org.campuses[0].address, region: org.campuses[0].region } : null,
    headPastor: { name: org.headPastorName, phone: org.headPastorPhone, email: org.headPastorEmail, ninMasked: maskSensitive(decryptField(org.headPastorNinEnc)) },
    banking: {
      bankName: org.bankName,
      accountName: org.bankAccountName,
      accountNumberMasked: maskSensitive(decryptField(org.bankAccountNumberEnc)),
    },
    ndpa: { acknowledgedAt: org.ndpaAcknowledgedAt, acknowledgedBy: org.ndpaAcknowledgedBy, dpaVersion: org.dpaVersionAccepted },
    memberCountEstimate: org.memberCountEstimate,
    license: org.license ? { plan: org.license.plan, status: org.license.status, expiresAt: org.license.expiresAt, seats: org.license.seats } : null,
    owner: ownerMembership ? { name: ownerMembership.user.name, email: ownerMembership.user.email, lastLoginAt: ownerMembership.user.lastLoginAt } : null,
    trustees: org.trustees.map((t) => ({
      id: t.id,
      fullName: t.fullName,
      role: t.trusteeRole,
      phone: t.phone,
      email: t.email,
      residentialAddress: t.residentialAddress,
      idType: t.idType,
      idNumberMasked: maskSensitive(decryptField(t.idNumberEnc)),
      idDocumentFileId: t.idDocumentFileId,
    })),
    checklist: check.items,
    readyForReview: check.allDone,
    audit: org.onboardingAudit.map((a) => ({ step: a.step, at: a.performedAt, snapshot: safeParse(a.payloadSnapshot) })),
  };
}

export async function verifyTenant(orgId: string, actor: { label: string; ip?: string | null; userAgent?: string | null }) {
  const org = await db.organization.findUnique({ where: { id: orgId }, include: { trustees: true } });
  if (!org) throw notFound("Church not found.");
  if (org.status === "active") throw badRequest("This church is already active.");
  if (org.status !== "pending_verification") throw badRequest(`Only pending_verification churches can be activated (current: ${org.status}).`);

  const check = checklistFor(org);
  if (!check.allDone) {
    throw forbidden(`Verification is blocked — incomplete items: ${check.items.filter((i) => !i.done).map((i) => i.label).join(", ")}. The church must complete these or the platform must waive them deliberately.`);
  }

  const updated = await db.organization.update({ where: { id: orgId }, data: { status: "active" } });
  await db.tenantOnboardingAudit.create({
    data: { orgId, step: "verified", payloadSnapshot: JSON.stringify({ verifiedBy: actor.label }) },
  });
  await db.tenantOnboardingAudit.create({
    data: { orgId, step: "activated", payloadSnapshot: JSON.stringify({ activatedBy: actor.label, at: new Date().toISOString() }) },
  });
  await db.auditLog.create({
    data: {
      orgId,
      actorType: "support",
      actorLabel: actor.label,
      action: "partner.tenant_verified",
      entityType: "organization",
      entityId: orgId,
      after: JSON.stringify({ status: "active" }),
      ip: actor.ip ?? null,
      userAgent: actor.userAgent ?? null,
    },
  });
  return { id: updated.id, status: updated.status };
}

/** Stream a compliance document (CAC cert / trustee ID) to a partner reviewer. */
export async function readDocument(fileId: string): Promise<{ stream: ReturnType<typeof createReadStream>; contentType: string; byteSize: number | null; kind: string }> {
  const rec = await db.fileRecord.findUnique({ where: { id: fileId } });
  if (!rec || rec.deletedAt) throw notFound("Document not found.");
  const full = path.join(UPLOAD_ROOT, rec.storageKey);
  try {
    const info = await stat(full);
    if (!info.isFile()) throw new Error("not a file");
  } catch {
    throw notFound("Document file is missing from storage.");
  }
  return {
    stream: createReadStream(full),
    contentType: rec.contentType ?? "application/octet-stream",
    byteSize: rec.byteSize,
    kind: rec.kind,
  };
}
