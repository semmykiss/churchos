import { randomBytes } from "crypto";
import { db } from "@/server/db";
import { ROLE_TEMPLATES } from "@/server/permissions";
import { hashPassword } from "@/server/auth";
import { badRequest, conflict, notFound } from "@/server/http";

/**
 * Partner console service (backend only).
 * Tenant (church) lifecycle + license management for the SaaS vendor layer.
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

const ROLE_NAMES: Record<string, string> = {
  owner: "Owner",
  campus_admin: "Campus Admin",
  finance: "Finance",
  ministry_leader: "Ministry Leader",
  volunteer: "Volunteer",
  member: "Member",
};

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || `church-${Date.now()}`;
}

export function newLicenseKey(): string {
  const block = () => randomBytes(2).toString("hex").toUpperCase().replace(/[OIL]/g, "X");
  return `GCHMS-${block()}-${block()}-${block()}`;
}

// ── login gate: enforced when a church user signs in ────────────────────────

export interface LicenseGate {
  ok: boolean;
  code?: string;
  message?: string;
}

export async function licenseGateForOrg(orgId: string): Promise<LicenseGate> {
  const org = await db.organization.findUnique({ where: { id: orgId }, include: { license: true } });
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

// ── overview ─────────────────────────────────────────────────────────────────

export async function partnerOverview() {
  const [orgs, licenses, peopleByOrg, userCount] = await Promise.all([
    db.organization.findMany({ select: { id: true, status: true } }),
    db.license.findMany({ include: { org: { select: { name: true, status: true } } }, orderBy: { expiresAt: "asc" } }),
    db.person.groupBy({ by: ["orgId"], _count: { _all: true }, where: { deletedAt: null } }),
    db.user.count(),
  ]);

  const now = Date.now();
  const soonCutoff = now + 14 * 24 * 3600 * 1000;

  const licenseCount = (status: string) => licenses.filter((l) => l.status === status).length;
  const mrrCents = licenses
    .filter((l) => l.status === "active")
    .reduce((sum, l) => sum + (PLAN_PRICES_CENTS[l.plan] ?? 0), 0);

  const expiringSoon = licenses
    .filter((l) => (l.status === "active" || l.status === "trial") && l.expiresAt.getTime() <= soonCutoff)
    .map((l) => ({
      id: l.id,
      orgId: l.orgId,
      orgName: l.org.name,
      plan: l.plan,
      status: l.status,
      expiresAt: l.expiresAt,
      daysLeft: Math.max(0, Math.ceil((l.expiresAt.getTime() - now) / 86400000)),
    }));

  return {
    tenants: {
      total: orgs.length,
      active: orgs.filter((o) => o.status === "active").length,
      suspended: orgs.filter((o) => o.status !== "active").length,
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
    expiringSoon,
  };
}

// ── tenants ──────────────────────────────────────────────────────────────────

export async function listTenants(opts: { search?: string; status?: string }) {
  const search = opts.search?.trim().toLowerCase();
  const orgs = await db.organization.findMany({
    where: search ? { OR: [{ name: { contains: search } }, { slug: { contains: search } }] } : undefined,
    include: { license: true, _count: { select: { campuses: true, memberships: true } } },
    orderBy: { createdAt: "asc" },
  });
  const peopleCounts = await db.person.groupBy({ by: ["orgId"], _count: { _all: true }, where: { deletedAt: null } });
  const peopleMap = new Map(peopleCounts.map((p) => [p.orgId, p._count._all]));
  const now = Date.now();

  const rows = orgs.map((o) => ({
    id: o.id,
    name: o.name,
    slug: o.slug,
    status: o.status,
    createdAt: o.createdAt,
    plan: o.license?.plan ?? o.plan,
    licenseStatus: o.license?.status ?? "none",
    licenseKey: o.license?.key ?? null,
    seats: o.license?.seats ?? 0,
    seatsUsed: o._count.memberships,
    expiresAt: o.license?.expiresAt ?? null,
    daysLeft: o.license ? Math.ceil((o.license.expiresAt.getTime() - now) / 86400000) : null,
    campuses: o._count.campuses,
    people: peopleMap.get(o.id) ?? 0,
  }));

  if (opts.status === "suspended") return rows.filter((r) => r.status !== "active");
  if (opts.status === "active") return rows.filter((r) => r.status === "active");
  return rows;
}

export async function getTenant(id: string) {
  const org = await db.organization.findUnique({
    where: { id },
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
    license: org.license,
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
  owner: { name: string; email: string; password: string };
}

export async function createTenant(input: CreateTenantInput, actor: { label: string; ip?: string | null; userAgent?: string | null }) {
  const name = input.name?.trim();
  if (!name) throw badRequest("Church name is required.");
  if (!input.owner?.email?.trim() || !input.owner?.password || input.owner.password.length < 8) {
    throw badRequest("Owner email and a password of at least 8 characters are required.");
  }
  const plan = PLANS.includes((input.plan ?? "growth") as Plan) ? (input.plan as Plan) : "growth";
  const seats = Math.max(1, Math.min(10000, Math.floor(input.seats ?? (plan === "starter" ? 100 : plan === "growth" ? 250 : 1000))));
  const termMonths = Math.max(1, Math.min(60, Math.floor(input.termMonths ?? 12)));
  const licenseStatus = LICENSE_STATUSES.includes((input.licenseStatus ?? "trial") as LicenseStatus)
    ? (input.licenseStatus as LicenseStatus)
    : "trial";

  const email = input.owner.email.trim().toLowerCase();
  const slug = slugify(input.slug?.trim() || name);

  const [slugTaken, emailTaken] = await Promise.all([
    db.organization.findUnique({ where: { slug } }),
    db.user.findUnique({ where: { email } }),
  ]);
  if (slugTaken) throw conflict(`A church with slug "${slug}" already exists.`);
  if (emailTaken) throw conflict(`A user with email "${email}" already exists.`);

  const created = await db.$transaction(async (tx) => {
    const org = await tx.organization.create({
      data: {
        name,
        slug,
        timezone: input.timezone?.trim() || "America/Chicago",
        currency: input.currency?.trim() || "NGN",
        plan,
        status: "active",
      },
    });
    const campus = await tx.campus.create({
      data: { orgId: org.id, name: `${name} — Main`, code: "MAIN", isPrimary: true, timezone: org.timezone },
    });
    for (const [key, permissions] of Object.entries(ROLE_TEMPLATES)) {
      await tx.role.create({
        data: {
          orgId: org.id,
          key,
          name: ROLE_NAMES[key] ?? key,
          description: `Default ${ROLE_NAMES[key] ?? key} role`,
          isSystem: true,
          permissions: { create: permissions.map((permission) => ({ permission })) },
        },
      });
    }
    const ownerRole = await tx.role.findFirst({ where: { orgId: org.id, key: "owner" } });
    const user = await tx.user.create({
      data: { email, name: input.owner.name.trim() || email, passwordHash: hashPassword(input.owner.password) },
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
    await tx.auditLog.create({
      data: {
        orgId: org.id,
        actorType: "support",
        actorLabel: actor.label,
        action: "partner.tenant_created",
        entityType: "organization",
        entityId: org.id,
        after: JSON.stringify({ name, plan, seats, termMonths }),
        ip: actor.ip ?? null,
        userAgent: actor.userAgent ?? null,
      },
    });
    return { org, license };
  });

  return {
    id: created.org.id,
    name: created.org.name,
    slug: created.org.slug,
    licenseKey: created.license.key,
    plan: created.license.plan,
    seats: created.license.seats,
    status: created.license.status,
    expiresAt: created.license.expiresAt,
  };
}

export async function setTenantStatus(id: string, status: string, actor: { label: string; ip?: string | null; userAgent?: string | null }) {
  if (!["active", "suspended"].includes(status)) throw badRequest("Status must be active or suspended.");
  const org = await db.organization.findUnique({ where: { id }, include: { license: true } });
  if (!org) throw notFound("Church not found.");
  const updated = await db.organization.update({ where: { id }, data: { status } });
  await db.auditLog.create({
    data: {
      orgId: id,
      actorType: "support",
      actorLabel: actor.label,
      action: status === "suspended" ? "partner.tenant_suspended" : "partner.tenant_reactivated",
      entityType: "organization",
      entityId: id,
      after: JSON.stringify({ status }),
      ip: actor.ip ?? null,
      userAgent: actor.userAgent ?? null,
    },
  });
  return { id: updated.id, status: updated.status };
}

// ── licenses ─────────────────────────────────────────────────────────────────

export async function listLicenses(opts: { status?: string }) {
  const licenses = await db.license.findMany({
    where: opts.status ? { status: opts.status } : undefined,
    include: { org: { select: { name: true, slug: true, status: true } } },
    orderBy: { expiresAt: "asc" },
  });
  const now = Date.now();
  return licenses.map((l) => ({
    ...l,
    orgName: l.org.name,
    orgStatus: l.org.status,
    daysLeft: Math.ceil((l.expiresAt.getTime() - now) / 86400000),
    monthlyPriceCents: PLAN_PRICES_CENTS[l.plan] ?? 0,
  }));
}

export interface IssueLicenseInput {
  orgId: string;
  plan?: string;
  seats?: number;
  termMonths?: number;
  status?: LicenseStatus;
  notes?: string;
}

export async function issueLicense(input: IssueLicenseInput, actor: { label: string; ip?: string | null; userAgent?: string | null }) {
  const org = await db.organization.findUnique({ where: { id: input.orgId }, include: { license: true } });
  if (!org) throw notFound("Church not found.");
  const plan = PLANS.includes((input.plan ?? "growth") as Plan) ? (input.plan as Plan) : "growth";
  const seats = Math.max(1, Math.min(10000, Math.floor(input.seats ?? 250)));
  const termMonths = Math.max(1, Math.min(60, Math.floor(input.termMonths ?? 12)));
  const status = LICENSE_STATUSES.includes((input.status ?? "active") as LicenseStatus) ? (input.status as LicenseStatus) : "active";

  const license = await db.license.upsert({
    where: { orgId: input.orgId },
    create: {
      orgId: input.orgId,
      key: newLicenseKey(),
      plan,
      seats,
      status,
      expiresAt: new Date(Date.now() + termMonths * 30 * 86400000),
      notes: input.notes?.trim() || null,
    },
    update: { plan, seats, status, expiresAt: new Date(Date.now() + termMonths * 30 * 86400000), notes: input.notes?.trim() || null },
  });
  await db.organization.update({ where: { id: input.orgId }, data: { plan } });
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
  return license;
}

export interface UpdateLicenseInput {
  plan?: string;
  seats?: number;
  status?: LicenseStatus;
  extendMonths?: number;
  notes?: string;
}

export async function updateLicense(licenseId: string, input: UpdateLicenseInput, actor: { label: string; ip?: string | null; userAgent?: string | null }) {
  const license = await db.license.findUnique({ where: { id: licenseId }, include: { org: true } });
  if (!license) throw notFound("License not found.");

  const data: Record<string, unknown> = {};
  if (input.plan !== undefined) {
    if (!PLANS.includes(input.plan as Plan)) throw badRequest(`Plan must be one of ${PLANS.join(", ")}.`);
    data.plan = input.plan;
  }
  if (input.seats !== undefined) data.seats = Math.max(1, Math.min(10000, Math.floor(input.seats)));
  if (input.status !== undefined) {
    if (!LICENSE_STATUSES.includes(input.status)) throw badRequest(`Status must be one of ${LICENSE_STATUSES.join(", ")}.`);
    data.status = input.status;
  }
  if (input.notes !== undefined) data.notes = input.notes.trim() || null;
  if (input.extendMonths !== undefined) {
    const months = Math.max(1, Math.min(60, Math.floor(input.extendMonths)));
    const base = Math.max(license.expiresAt.getTime(), Date.now());
    data.expiresAt = new Date(base + months * 30 * 86400000);
    // renewing usually means money arrived
    if (input.status === undefined && (license.status === "past_due" || license.expiresAt.getTime() < Date.now())) {
      data.status = "active";
    }
  }
  if (Object.keys(data).length === 0) throw badRequest("Nothing to update.");

  const updated = await db.license.update({ where: { id: licenseId }, data });
  if (data.plan) await db.organization.update({ where: { id: license.orgId }, data: { plan: data.plan as string } });
  await db.auditLog.create({
    data: {
      orgId: license.orgId,
      actorType: "support",
      actorLabel: actor.label,
      action: "partner.license_updated",
      entityType: "license",
      entityId: licenseId,
      before: JSON.stringify({ plan: license.plan, seats: license.seats, status: license.status, expiresAt: license.expiresAt }),
      after: JSON.stringify({ ...data, expiresAt: data.expiresAt ?? license.expiresAt }),
      ip: actor.ip ?? null,
      userAgent: actor.userAgent ?? null,
    },
  });
  return updated;
}
