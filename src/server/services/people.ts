import { db } from "@/server/db";
import { audit, j } from "@/server/audit";
import { ApiError, badRequest, notFound, forbidden, conflict } from "@/server/http";
import { can, type SessionUser } from "@/server/permissions";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

/**
 * People & households service (backend only — no HTTP, no React).
 * Business rules honored:
 *  • soft delete only; hard delete blocked when financial/attendance records exist
 *  • duplicate check on create (exact email/phone + name+DOB)
 *  • merge = first-class op with field-level survivor choice + alias redirect + audit
 *  • lifecycle stage changes recorded in stage history
 *  • timeline composes attendance/groups/giving/care with per-domain permission checks
 *  • CHILD SAFETY: a minor (age < 18, or household role child/dependent) must
 *    always have ≥1 linked guardian — enforced on create/update/unlink (422)
 *  • SCOPED self-service: "people.edit.own_household" unlocks edits ONLY on the
 *    user's own profile, their household members and their linked dependents.
 *    Every write path re-checks server-side; never trust the client.
 */

export interface PersonListQuery {
  search?: string;
  stage?: string;
  status?: string;
  tagId?: string;
  groupId?: string;
  campusId?: string;
  page?: number;
  pageSize?: number;
}

interface GuardianDTO {
  personId: string;
  name: string;
  photoUrl: string | null;
  phone: string | null;
  relationshipType: GuardianRelType;
  authorizedPickup: boolean;
  custodyRestricted: boolean;
  isPrimary: boolean;
}

interface DependentDTO {
  personId: string;
  name: string;
  photoUrl: string | null;
  birthdate: Date | null;
  relationshipType: GuardianRelType;
  isPrimary: boolean;
}

export async function listPeople(user: SessionUser, q: PersonListQuery) {
  const where: any = { orgId: user.orgId, deletedAt: null, mergedIntoId: null };
  if (q.status === "archived") where.status = "archived";
  else if (q.status) where.status = q.status;
  else where.status = { not: "archived" };
  if (q.stage) where.lifecycleStage = q.stage;
  if (q.campusId) where.homeCampusId = q.campusId;

  if (q.search) {
    const s = q.search.trim().toLowerCase();
    where.OR = [
      { firstName: { contains: s } },
      { lastName: { contains: s } },
      { email: { contains: s } },
      { phone: { contains: s } },
    ];
  }
  if (q.groupId) {
    where.groupMemberships = { some: { groupId: q.groupId, status: "active" } };
  }
  if (q.tagId) {
    where.tags = { some: { tagId: q.tagId } };
  }

  const page = Math.max(1, q.page ?? 1);
  const pageSize = Math.min(100, Math.max(10, q.pageSize ?? 25));
  const [total, rows] = await Promise.all([
    db.person.count({ where }),
    db.person.findMany({
      where,
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        householdLinks: { include: { household: true } },
        tags: { include: { tag: true } },
      },
    }),
  ]);
  return {
    total,
    page,
    pageSize,
    items: rows.map((p) => ({
      id: p.id,
      firstName: p.firstName,
      lastName: p.lastName,
      preferredName: p.preferredName,
      email: p.email,
      phone: p.phone,
      birthdate: p.birthdate,
      gender: p.gender,
      status: p.status,
      lifecycleStage: p.lifecycleStage,
      membershipStatus: p.membershipStatus,
      allergies: p.allergies,
      photoUrl: p.photoUrl,
      firstVisitAt: p.firstVisitAt,
      lastActivityAt: p.lastActivityAt,
      household: p.householdLinks[0]?.household
        ? { id: p.householdLinks[0].household.id, name: p.householdLinks[0].household.name, role: p.householdLinks[0].role }
        : null,
      tags: p.tags.map((t) => ({ id: t.tag.id, name: t.tag.name, color: t.tag.color })),
    })),
  };
}

export async function getPersonDetail(user: SessionUser, personId: string) {
  const person = await db.person.findFirst({
    where: { id: personId, orgId: user.orgId, deletedAt: null },
    include: {
      householdLinks: { include: { household: { include: { members: { include: { person: true } } } } } },
      groupMemberships: { include: { group: true }, where: { status: "active" } },
      relationshipsFrom: true,
      relationshipsTo: true,
      stageHistory: { orderBy: { changedAt: "desc" }, take: 12 },
      tags: { include: { tag: true } },
    },
  });
  if (!person) throw notFound("Person not found.");

  // guardians of this person (for children) — with display relationship type
  const guardianRels = await db.personRelationship.findMany({
    where: { orgId: user.orgId, toPersonId: personId, type: "guardian" },
    orderBy: { id: "asc" },
  });
  const guardianPeople = guardianRels.length
    ? await db.person.findMany({ where: { id: { in: guardianRels.map((g) => g.fromPersonId) } } })
    : [];
  const guardians = guardianRels
    .map((rel, idx) => {
      const g = guardianPeople.find((p) => p.id === rel.fromPersonId);
      if (!g || g.deletedAt) return null;
      return {
        personId: g.id,
        name: `${g.firstName} ${g.lastName}`,
        photoUrl: g.photoUrl,
        phone: g.phone,
        relationshipType: relationshipTypeOf(rel),
        authorizedPickup: rel.authorizedPickup,
        custodyRestricted: rel.custodyRestricted,
        isPrimary: idx === 0,
      };
    })
    .filter(Boolean) as GuardianDTO[];

  // dependents (reciprocal) — children this person guards, shown on a PARENT's profile
  const dependentRels = await db.personRelationship.findMany({
    where: { orgId: user.orgId, fromPersonId: personId, type: "guardian" },
    orderBy: { id: "asc" },
  });
  const dependentPeople = dependentRels.length
    ? await db.person.findMany({ where: { id: { in: dependentRels.map((r) => r.toPersonId) } } })
    : [];
  const dependents = dependentRels
    .map((rel, idx) => {
      const c = dependentPeople.find((p) => p.id === rel.toPersonId);
      if (!c || c.deletedAt || c.mergedIntoId) return null;
      return {
        personId: c.id,
        name: `${c.firstName} ${c.lastName}`,
        photoUrl: c.photoUrl,
        birthdate: c.birthdate,
        relationshipType: relationshipTypeOf(rel),
        isPrimary: idx === 0,
      };
    })
    .filter(Boolean) as DependentDTO[];

  // recent attendance
  const attendance = await db.attendanceRecord.findMany({
    where: { orgId: user.orgId, personId },
    orderBy: { checkedInAt: "desc" },
    take: 10,
    include: { event: { select: { name: true, startsAt: true, kind: true } } },
  });

  // recent gifts — permissioned (P4 rule: leaders must not see giving)
  let gifts: any[] = [];
  let givingTotal: number | null = null;
  if (canSeeGiving(user)) {
    const donations = await db.donation.findMany({
      where: { orgId: user.orgId, personId, status: { in: ["posted", "pending"] } },
      orderBy: { receivedOn: "desc" },
      take: 10,
      include: { splits: { include: { fund: true } } },
    });
    gifts = donations.map((d) => ({
      id: d.id, amountCents: d.amountCents, receivedOn: d.receivedOn, method: d.method, status: d.status,
      funds: d.splits.map((s) => ({ name: s.fund.name, amountCents: s.amountCents })),
    }));
    const agg = await db.donation.aggregate({
      where: { orgId: user.orgId, personId, status: "posted" },
      _sum: { amountCents: true },
    });
    givingTotal = agg._sum.amountCents;
  }

  // care cases — permissioned by tier
  const careVisible = canSeeCare(user);
  const careCases = careVisible
    ? await db.careCase.findMany({
        where: { orgId: user.orgId, personId, ...(user.roleKeys.includes("owner") ? {} : { confidentialityTier: { in: ["staff", ...(user.roleKeys.includes("campus_admin") ? ["case_team"] : [])] } }) },
        orderBy: { openedAt: "desc" },
        take: 5,
        select: { id: true, type: true, stage: true, status: true, urgency: true, confidentialityTier: true, summary: true, openedAt: true },
      })
    : [];

  return {
    person: {
      id: person.id,
      firstName: person.firstName,
      lastName: person.lastName,
      preferredName: person.preferredName,
      email: person.email,
      phone: person.phone,
      birthdate: person.birthdate,
      gender: person.gender,
      status: person.status,
      lifecycleStage: person.lifecycleStage,
      membershipStatus: person.membershipStatus,
      allergies: person.allergies,
      notes: person.notes,
      photoUrl: person.photoUrl,
      firstVisitAt: person.firstVisitAt,
      lastActivityAt: person.lastActivityAt,
      custom: j(person.custom, {}),
      // server-computed scoped edit right — the single source of truth for the UI
      canEdit: await canEditPerson(user, personId),
    },
    household: person.householdLinks[0]?.household
      ? {
          id: person.householdLinks[0].household.id,
          name: person.householdLinks[0].household.name,
          addressLine1: person.householdLinks[0].household.addressLine1,
          city: person.householdLinks[0].household.city,
          region: person.householdLinks[0].household.region,
          members: person.householdLinks[0].household.members
            .filter((m) => !m.person.deletedAt && !m.person.mergedIntoId)
            .map((m) => ({
              personId: m.person.id,
              name: `${m.person.firstName} ${m.person.lastName}`,
              photoUrl: m.person.photoUrl,
              role: m.role,
              isThisPerson: m.personId === personId,
            })),
        }
      : null,
    guardians,
    dependents,
    groups: person.groupMemberships.map((gm) => ({
      id: gm.group.id, name: gm.group.name, role: gm.role, meetingDay: gm.group.meetingDay, meetingTime: gm.group.meetingTime,
    })),
    stageHistory: person.stageHistory.map((s) => ({ stage: s.stage, previousStage: s.previousStage, changedAt: s.changedAt, changedByName: s.changedByName, note: s.note })),
    tags: person.tags.map((t) => ({ id: t.tag.id, name: t.tag.name, color: t.tag.color })),
    attendance: attendance.map((a) => ({
      id: a.id, eventName: a.event.name, eventStartsAt: a.event.startsAt, kind: a.event.kind,
      status: a.status, method: a.method, firstTime: a.firstTime,
    })),
    giving: { visible: canSeeGiving(user), total: givingTotal, gifts },
    care: { visible: careVisible, cases: careCases },
  };
}

export function canSeeGiving(user: SessionUser): boolean {
  return user.permissions.some((p) => p === "*" || p === "giving.view" || p.startsWith("giving."));
}
export function canSeeCare(user: SessionUser): boolean {
  return user.permissions.some((p) => p === "*" || p === "care.view" || p.startsWith("care."));
}

// ── scoped self-service permissions (server-side, per resource) ─────────────

export type GuardianRelType = "parent" | "guardian" | "foster" | "other";
const GUARDIAN_REL_TYPES: GuardianRelType[] = ["parent", "guardian", "foster", "other"];
const HOUSEHOLD_MEMBER_ROLES = ["head", "spouse", "adult", "child", "dependent", "other"];

interface GuardianRelLike {
  relationshipType: string | null;
  isGuardian: boolean;
  type: string;
}

export function relationshipTypeOf(rel: GuardianRelLike): GuardianRelType {
  if (rel.relationshipType && (GUARDIAN_REL_TYPES as string[]).includes(rel.relationshipType)) {
    return rel.relationshipType as GuardianRelType;
  }
  return rel.isGuardian ? "guardian" : "other";
}

function relationshipData(relType: string) {
  switch (relType) {
    case "parent": return { relationshipType: "parent", type: "guardian", isGuardian: true };
    case "foster": return { relationshipType: "foster", type: "guardian", isGuardian: true };
    case "other": return { relationshipType: "other", type: "relative", isGuardian: false };
    default: return { relationshipType: "guardian", type: "guardian", isGuardian: true };
  }
}

function ageFromBirthdate(bd?: Date | null): number | null {
  if (!bd) return null;
  const now = new Date();
  let a = now.getFullYear() - bd.getFullYear();
  const m = now.getMonth() - bd.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < bd.getDate())) a--;
  return a;
}

/** Minor = age < 18, or (unknown age and) household role child/dependent. */
function isMinorPerson(p: { birthdate?: Date | null; householdRole?: string | null }): boolean {
  const a = ageFromBirthdate(p.birthdate ?? null);
  return (a != null && a < 18) || p.householdRole === "child" || p.householdRole === "dependent";
}

export async function isGuardianOf(orgId: string, guardianPersonId: string, targetPersonId: string): Promise<boolean> {
  const rel = await db.personRelationship.findFirst({
    where: { orgId, fromPersonId: guardianPersonId, toPersonId: targetPersonId, isGuardian: true },
    select: { id: true },
  });
  return !!rel;
}

export async function isSameHousehold(orgId: string, personAId: string, personBId: string): Promise<boolean> {
  const a = await db.householdMember.findFirst({
    where: { personId: personAId, endedAt: null, household: { orgId, deletedAt: null } },
    select: { householdId: true },
  });
  if (!a) return false;
  const b = await db.householdMember.findFirst({
    where: { personId: personBId, householdId: a.householdId, endedAt: null },
    select: { id: true },
  });
  return !!b;
}

/**
 * Scoped edit check — the ONLY gate for person-level writes.
 *  • people.edit            → global edit (staff/admin)
 *  • people.edit.own_household → own profile + own household members + linked dependents only
 */
export async function canEditPerson(user: SessionUser, targetPersonId: string): Promise<boolean> {
  if (can(user, "people.edit")) return true;
  if (!can(user, "people.edit.own_household") || !user.personId) return false;
  if (user.personId === targetPersonId) return true;
  if (await isGuardianOf(user.orgId, user.personId, targetPersonId)) return true;
  if (await isSameHousehold(user.orgId, user.personId, targetPersonId)) return true;
  return false;
}

/** Scoped household-management check (add/remove members, change roles, edit details). */
export async function canEditHousehold(user: SessionUser, householdId: string): Promise<boolean> {
  if (can(user, "people.edit")) return true;
  if (!can(user, "people.edit.own_household") || !user.personId) return false;
  const m = await db.householdMember.findFirst({
    where: { householdId, personId: user.personId, endedAt: null, household: { orgId: user.orgId, deletedAt: null } },
    select: { id: true },
  });
  return !!m;
}

/** Child-safety invariant — throws 422 needsGuardian when a minor would end up with zero guardians. */
async function assertGuardianInvariant(
  orgId: string,
  person: { id: string; birthdate: Date | null },
  opts?: { excludeRelationshipId?: string },
) {
  const link = await db.householdMember.findFirst({ where: { personId: person.id, endedAt: null }, select: { role: true } });
  if (!isMinorPerson({ birthdate: person.birthdate, householdRole: link?.role })) return;
  const count = await db.personRelationship.count({ where: { orgId, toPersonId: person.id, isGuardian: true, ...(opts?.excludeRelationshipId ? { id: { not: opts.excludeRelationshipId } } : {}) } });
  if (count <= 0) {
    throw new ApiError(422, "needs_guardian", "Minors must keep at least one linked guardian.", { needsGuardian: true });
  }
}

export async function checkDuplicates(orgId: string, input: { email?: string; phone?: string; firstName?: string; lastName?: string; birthdate?: string }) {
  const or: any[] = [];
  if (input.email) or.push({ email: { equals: input.email.trim().toLowerCase() } });
  if (input.phone) or.push({ phone: { equals: input.phone.trim() } });
  let exact: any[] = or.length ? await db.person.findMany({ where: { orgId, deletedAt: null, mergedIntoId: null, OR: or } }) : [];
  let fuzzy: any[] = [];
  if (input.firstName && input.lastName) {
    fuzzy = await db.person.findMany({
      where: {
        orgId, deletedAt: null, mergedIntoId: null,
        firstName: { contains: input.firstName.trim() },
        lastName: { contains: input.lastName.trim() },
      },
    });
    if (input.birthdate) fuzzy = fuzzy.filter((p) => !p.birthdate || p.birthdate.toISOString().slice(0, 10) === input.birthdate);
  }
  return {
    exact: exact.map(toDup),
    fuzzy: fuzzy.filter((p) => !exact.find((e) => e.id === p.id)).map(toDup),
  };
}

function toDup(p: any) {
  return {
    id: p.id, name: `${p.firstName} ${p.lastName}`, email: p.email, phone: p.phone,
    birthdate: p.birthdate, lifecycleStage: p.lifecycleStage,
  };
}

export interface GuardianLinkInput {
  guardianId: string;
  relationshipType?: string; // parent | guardian | foster | other
  authorizedPickup?: boolean;
  custodyRestricted?: boolean;
}

export interface CreatePersonInput {
  firstName: string; lastName: string; preferredName?: string; email?: string; phone?: string;
  birthdate?: string; gender?: string; lifecycleStage?: string; notes?: string; allergies?: string;
  householdName?: string; householdRole?: string; force?: boolean;
  // ── household step (Add person flow) ──
  householdMode?: "none" | "existing" | "new";
  householdId?: string;           // householdMode === "existing"
  newHousehold?: { name?: string; addressLine1?: string; city?: string; region?: string; postalCode?: string };
  guardians?: GuardianLinkInput[]; // required when creating a minor (server-enforced)
}

export async function createPerson(user: SessionUser, input: CreatePersonInput, meta: { ip?: string; userAgent?: string }) {
  if (!input.firstName?.trim() || !input.lastName?.trim()) throw badRequest("First and last name are required.");
  if (!input.email && !input.phone) {
    // PPL-1: allow name-only from a connection card, but flag it
    if (!input.force) throw badRequest("Provide at least one contact method (email or phone), or confirm creation without contact info.", { needsForce: true });
  }
  const dups = await checkDuplicates(user.orgId, input);
  if ((dups.exact.length > 0 || dups.fuzzy.length > 0) && !input.force) {
    return { duplicates: dups, created: null };
  }

  // ── child-safety invariant: minors need a guardian (hard block, no force bypass) ──
  const guardianInputs = (input.guardians ?? []).filter((g) => g?.guardianId?.trim());
  const householdRole = input.householdRole?.trim() || undefined;
  const minor = isMinorPerson({ birthdate: input.birthdate ? new Date(input.birthdate + "T00:00:00Z") : null, householdRole });
  if (minor && guardianInputs.length === 0) {
    throw new ApiError(422, "needs_guardian", "Minors must have at least one linked guardian.", { needsGuardian: true });
  }

  // ── resolve household target ──
  let householdId: string | null = null;
  if (input.householdMode === "existing") {
    if (!input.householdId) throw badRequest("Pick a household or choose a different household option.");
    const hh = await db.household.findFirst({ where: { id: input.householdId, orgId: user.orgId, deletedAt: null } });
    if (!hh) throw notFound("Household not found.");
    householdId = hh.id;
  } else if (input.householdMode === "new") {
    if (!input.newHousehold?.name?.trim()) throw badRequest("Household name is required to create a new household.");
  }

  const person = await db.$transaction(async (tx) => {
    const created = await tx.person.create({
      data: {
        orgId: user.orgId,
        firstName: input.firstName.trim(),
        lastName: input.lastName.trim(),
        preferredName: input.preferredName?.trim() || undefined,
        email: input.email?.trim().toLowerCase() || undefined,
        phone: input.phone?.trim() || undefined,
        birthdate: input.birthdate ? new Date(input.birthdate + "T00:00:00Z") : undefined,
        gender: input.gender || undefined,
        lifecycleStage: input.lifecycleStage || "guest",
        notes: input.notes || undefined,
        allergies: input.allergies || undefined,
        homeCampusId: user.campusId ?? undefined,
        firstVisitAt: (input.lifecycleStage ?? "guest") === "guest" ? new Date() : undefined,
      },
    });
    await tx.stageHistory.create({
      data: { orgId: user.orgId, personId: created.id, stage: created.lifecycleStage, changedByName: user.name, note: "Created" },
    });

    // household membership (existing or newly created)
    if (householdId || input.householdMode === "new") {
      let hhId = householdId;
      if (!hhId) {
        const hh = await tx.household.create({
          data: {
            orgId: user.orgId,
            name: input.newHousehold!.name!.trim(),
            addressLine1: input.newHousehold?.addressLine1?.trim() || null,
            city: input.newHousehold?.city?.trim() || null,
            region: input.newHousehold?.region?.trim() || null,
            postalCode: input.newHousehold?.postalCode?.trim() || null,
            campusId: user.campusId ?? undefined,
          },
        });
        hhId = hh.id;
      }
      await tx.householdMember.create({
        data: { householdId: hhId, personId: created.id, role: householdRole ?? "adult", isPrimaryContact: householdRole === "head" },
      });
      if (householdRole === "head") {
        await tx.household.update({ where: { id: hhId }, data: { headPersonId: created.id } });
      }
      householdId = hhId;
    }

    // guardian links (validated: same org, alive, not self)
    for (const g of guardianInputs) {
      if (g.guardianId === created.id) throw badRequest("A person cannot be their own guardian.");
      const gp = await tx.person.findFirst({ where: { id: g.guardianId, orgId: user.orgId, deletedAt: null, mergedIntoId: null } });
      if (!gp) throw notFound("One of the selected guardians was not found.");
      await tx.personRelationship.create({
        data: {
          orgId: user.orgId,
          fromPersonId: g.guardianId,
          toPersonId: created.id,
          ...relationshipData(g.relationshipType ?? "guardian"),
          authorizedPickup: g.authorizedPickup ?? true,
          custodyRestricted: g.custodyRestricted ?? false,
        },
      });
    }
    return created;
  });

  await audit({
    orgId: user.orgId, actor: user, action: "person.create",
    entityType: "person", entityId: person.id,
    after: {
      firstName: person.firstName, lastName: person.lastName, email: person.email,
      householdId, guardians: guardianInputs.length, minor,
    },
    ip: meta.ip, userAgent: meta.userAgent,
  });
  return { duplicates: null, created: { id: person.id, name: `${person.firstName} ${person.lastName}` } };
}

export async function updatePerson(user: SessionUser, personId: string, input: Partial<CreatePersonInput>, meta: { ip?: string; userAgent?: string }) {
  const before = await db.person.findFirst({ where: { id: personId, orgId: user.orgId, deletedAt: null } });
  if (!before) throw notFound("Person not found.");
  // scoped self-service: own household + dependents only (staff bypass via people.edit)
  if (!(await canEditPerson(user, personId))) {
    throw forbidden("You can only edit your own profile, household members and dependents.");
  }
  // self-service scope must not touch staff-only notes field
  const selfServiceOnly = !can(user, "people.edit");
  const data: any = {};
  for (const k of ["firstName", "lastName", "preferredName", "email", "phone", "gender", "notes", "allergies"] as const) {
    if (input[k] === undefined) continue;
    if (selfServiceOnly && (k === "notes" || k === "allergies")) continue; // staff-visible fields
    data[k] = input[k] === "" ? null : input[k];
  }
  if (input.email) data.email = input.email.trim().toLowerCase();
  if (input.birthdate !== undefined) {
    data.birthdate = input.birthdate ? new Date(input.birthdate + "T00:00:00Z") : null;
    // child-safety: birthdate change must not leave a minor unguarded
    await assertGuardianInvariant(user.orgId, { id: personId, birthdate: data.birthdate });
  }
  const person = await db.person.update({ where: { id: personId }, data });
  await audit({
    orgId: user.orgId, actor: user, action: "person.update",
    entityType: "person", entityId: personId,
    before: { firstName: before.firstName, lastName: before.lastName, email: before.email, phone: before.phone, birthdate: before.birthdate },
    after: { firstName: person.firstName, lastName: person.lastName, email: person.email, phone: person.phone, birthdate: person.birthdate },
    ip: meta.ip, userAgent: meta.userAgent,
  });
  return { id: person.id };
}

export async function changeStage(user: SessionUser, personId: string, stage: string, note?: string, meta?: { ip?: string; userAgent?: string }) {
  const allowed = ["guest", "returning_guest", "attender", "member", "leader", "inactive", "archived"];
  if (!allowed.includes(stage)) throw badRequest(`Unknown stage "${stage}".`);
  const before = await db.person.findFirst({ where: { id: personId, orgId: user.orgId, deletedAt: null } });
  if (!before) throw notFound("Person not found.");
  const person = await db.person.update({
    where: { id: personId },
    data: { lifecycleStage: stage, membershipStatus: stage === "member" ? "member" : stage === "attender" || stage === "leader" ? "regular" : before.membershipStatus },
  });
  await db.stageHistory.create({
    data: { orgId: user.orgId, personId, stage, previousStage: before.lifecycleStage, changedByName: user.name, note },
  });
  await audit({
    orgId: user.orgId, actor: user, action: "person.stage_change", entityType: "person", entityId: personId,
    before: { lifecycleStage: before.lifecycleStage }, after: { lifecycleStage: stage },
    ...(meta ?? {}),
  });
  return { id: person.id, lifecycleStage: stage };
}

export async function archivePerson(user: SessionUser, personId: string, meta: { ip?: string; userAgent?: string }) {
  const person = await db.person.findFirst({ where: { id: personId, orgId: user.orgId, deletedAt: null } });
  if (!person) throw notFound("Person not found.");
  // hard delete blocked when financial or attendance records exist (foundation rule)
  const [giftCount, attendanceCount] = await Promise.all([
    db.donation.count({ where: { personId } }),
    db.attendanceRecord.count({ where: { personId } }),
  ]);
  await db.person.update({ where: { id: personId }, data: { status: "archived", lifecycleStage: "archived" } });
  await db.stageHistory.create({ data: { orgId: user.orgId, personId, stage: "archived", previousStage: person.lifecycleStage, changedByName: user.name, note: "Archived" } });
  await audit({
    orgId: user.orgId, actor: user, action: "person.archive", entityType: "person", entityId: personId,
    before: { status: person.status },
    after: { status: "archived", retainedRecords: { gifts: giftCount, attendance: attendanceCount } },
    ip: meta.ip, userAgent: meta.userAgent,
  });
  return { id: personId, archived: true, retainedRecords: { gifts: giftCount, attendance: attendanceCount } };
}

export interface MergeInput {
  survivorId: string;
  mergedId: string;
  survivors: Record<string, any>; // field-level survivor choice: {firstName: "survivor"|"merged", ...}
}

export async function mergePeople(user: SessionUser, input: MergeInput, meta: { ip?: string; userAgent?: string }) {
  if (input.survivorId === input.mergedId) throw badRequest("Cannot merge a person into themselves.");
  const survivor = await db.person.findFirst({ where: { id: input.survivorId, orgId: user.orgId } });
  const merged = await db.person.findFirst({ where: { id: input.mergedId, orgId: user.orgId } });
  if (!survivor || !merged) throw notFound("Both records must exist.");
  if (merged.mergedIntoId) throw badRequest("That record has already been merged.");

  const mergeable = ["firstName", "lastName", "preferredName", "email", "phone", "birthdate", "gender", "allergies", "notes"];
  const data: any = {};
  for (const field of mergeable) {
    const choice = input.survivors?.[field] ?? (survivor[field as keyof typeof survivor] != null ? "survivor" : "merged");
    if (choice === "merged" && (merged as any)[field] != null) data[field] = (merged as any)[field];
  }

  const updated = await db.person.update({ where: { id: survivor.id }, data });
  // alias redirect + archive the merged record
  await db.person.update({ where: { id: merged.id }, data: { mergedIntoId: survivor.id, status: "archived", lifecycleStage: "archived" } });
  // re-point live references (attendance, groups, household, guardians, care, pledges)
  await db.attendanceRecord.updateMany({ where: { personId: merged.id }, data: { personId: survivor.id } });
  await db.groupMember.updateMany({ where: { personId: merged.id }, data: { personId: survivor.id } });
  await db.householdMember.updateMany({ where: { personId: merged.id }, data: { personId: survivor.id } });
  await db.personRelationship.updateMany({ where: { fromPersonId: merged.id }, data: { fromPersonId: survivor.id } });
  await db.personRelationship.updateMany({ where: { toPersonId: merged.id }, data: { toPersonId: survivor.id } });
  await db.careCase.updateMany({ where: { personId: merged.id }, data: { personId: survivor.id } });
  await db.pledge.updateMany({ where: { personId: merged.id }, data: { personId: survivor.id } });
  await db.donation.updateMany({ where: { personId: merged.id }, data: { personId: survivor.id } });
  await db.communicationPreference.updateMany({ where: { personId: merged.id }, data: { personId: survivor.id } });
  await db.prayerRequest.updateMany({ where: { personId: merged.id }, data: { personId: survivor.id } });
  await db.assignment.updateMany({ where: { personId: merged.id }, data: { personId: survivor.id } });

  await audit({
    orgId: user.orgId, actor: user, action: "person.merge", entityType: "person", entityId: survivor.id,
    before: { merged: merged.id }, after: { survivor: survivor.id, survivors: input.survivors },
    ip: meta.ip, userAgent: meta.userAgent,
  });
  return { survivorId: survivor.id, mergedId: merged.id, unmergeableUntil: new Date(Date.now() + 30 * 24 * 3600 * 1000) };
}

export async function listHouseholds(user: SessionUser, search?: string) {
  const households = await db.household.findMany({
    where: { orgId: user.orgId, deletedAt: null, ...(search ? { name: { contains: search.toLowerCase() } } : {}) },
    include: { members: { include: { person: true } } },
    orderBy: { name: "asc" },
    take: 100,
  });
  const canEditFlags = await Promise.all(households.map((h) => canEditHousehold(user, h.id)));
  return {
    items: households.map((h, i) => ({
      id: h.id, name: h.name, addressLine1: h.addressLine1, addressLine2: h.addressLine2, city: h.city, region: h.region, postalCode: h.postalCode,
      deletedAt: h.deletedAt,
      canEdit: canEditFlags[i],
      members: h.members.filter((m) => !m.person.deletedAt && !m.endedAt).map((m) => ({
        personId: m.person.id, name: `${m.person.firstName} ${m.person.lastName}`, photoUrl: m.person.photoUrl, role: m.role,
        email: m.person.email, phone: m.person.phone,
      })),
    })),
  };
}

export async function exportPeopleCsv(user: SessionUser, q: PersonListQuery, meta: { ip?: string; userAgent?: string }) {
  const { items } = await listPeople(user, { ...q, page: 1, pageSize: 100 });
  const header = "first_name,last_name,email,phone,stage,member_status,household";
  const lines = items.map((p) =>
    [p.firstName, p.lastName, p.email ?? "", p.phone ?? "", p.lifecycleStage, p.membershipStatus, p.household?.name ?? ""]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(",")
  );
  await audit({
    orgId: user.orgId, actor: user, action: "export.people", entityType: "people",
    after: { rows: items.length, filters: q as any }, ip: meta.ip, userAgent: meta.userAgent,
  });
  return header + "\n" + lines.join("\n");
}

// ═════════════════════ HOUSEHOLD CRUD ═══════════════════════════════════════

export interface HouseholdInput {
  name?: string; addressLine1?: string; addressLine2?: string; city?: string; region?: string; postalCode?: string;
}

export async function createHousehold(user: SessionUser, input: HouseholdInput, meta: { ip?: string; userAgent?: string }) {
  if (!input.name?.trim()) throw badRequest("Household name is required.");
  const hh = await db.household.create({
    data: {
      orgId: user.orgId,
      name: input.name.trim(),
      addressLine1: input.addressLine1?.trim() || null,
      addressLine2: input.addressLine2?.trim() || null,
      city: input.city?.trim() || null,
      region: input.region?.trim() || null,
      postalCode: input.postalCode?.trim() || null,
      campusId: user.campusId ?? undefined,
    },
  });
  await audit({
    orgId: user.orgId, actor: user, action: "household.create",
    entityType: "household", entityId: hh.id, after: { name: hh.name },
    ip: meta.ip, userAgent: meta.userAgent,
  });
  return { id: hh.id, name: hh.name };
}

export async function updateHousehold(user: SessionUser, householdId: string, input: HouseholdInput, meta: { ip?: string; userAgent?: string }) {
  const hh = await db.household.findFirst({ where: { id: householdId, orgId: user.orgId, deletedAt: null } });
  if (!hh) throw notFound("Household not found.");
  if (!(await canEditHousehold(user, householdId))) {
    throw forbidden("You can only manage your own household.");
  }
  const data: any = {};
  for (const k of ["name", "addressLine1", "addressLine2", "city", "region", "postalCode"] as const) {
    if (input[k] === undefined) continue;
    data[k] = String(input[k]).trim() || null;
  }
  if (data.name === null || data.name === "") delete data.name; // name can be edited but never cleared
  const updated = await db.household.update({ where: { id: householdId }, data });
  await audit({
    orgId: user.orgId, actor: user, action: "household.update",
    entityType: "household", entityId: householdId,
    before: { name: hh.name, addressLine1: hh.addressLine1 }, after: { name: updated.name, addressLine1: updated.addressLine1 },
    ip: meta.ip, userAgent: meta.userAgent,
  });
  return { id: updated.id, name: updated.name };
}

export async function archiveHousehold(user: SessionUser, householdId: string, meta: { ip?: string; userAgent?: string }) {
  const hh = await db.household.findFirst({ where: { id: householdId, orgId: user.orgId, deletedAt: null } });
  if (!hh) throw notFound("Household not found.");
  const memberCount = await db.householdMember.count({ where: { householdId, endedAt: null } });
  if (memberCount > 0) {
    throw conflict("Remove all members before archiving this household.", { memberCount });
  }
  await db.household.update({ where: { id: householdId }, data: { deletedAt: new Date() } });
  await audit({
    orgId: user.orgId, actor: user, action: "household.archive",
    entityType: "household", entityId: householdId, after: { name: hh.name, archived: true },
    ip: meta.ip, userAgent: meta.userAgent,
  });
  return { id: householdId, archived: true };
}

export async function addHouseholdMember(user: SessionUser, householdId: string, input: { personId?: string; role?: string }, meta: { ip?: string; userAgent?: string }) {
  if (!input.personId) throw badRequest("personId is required.");
  const hh = await db.household.findFirst({ where: { id: householdId, orgId: user.orgId, deletedAt: null } });
  if (!hh) throw notFound("Household not found.");
  if (!(await canEditHousehold(user, householdId))) {
    throw forbidden("You can only manage your own household.");
  }
  const person = await db.person.findFirst({ where: { id: input.personId, orgId: user.orgId, deletedAt: null, mergedIntoId: null } });
  if (!person) throw notFound("Person not found.");
  const existing = await db.householdMember.findFirst({ where: { householdId, personId: person.id, endedAt: null } });
  if (existing) throw conflict(`${person.firstName} ${person.lastName} is already in this household.`);
  const role = HOUSEHOLD_MEMBER_ROLES.includes(input.role ?? "") ? input.role! : "adult";
  const m = await db.householdMember.create({
    data: { householdId, personId: person.id, role, isPrimaryContact: role === "head" },
  });
  if (role === "head" && !hh.headPersonId) {
    await db.household.update({ where: { id: householdId }, data: { headPersonId: person.id } });
  }
  await audit({
    orgId: user.orgId, actor: user, action: "household.member_add",
    entityType: "household", entityId: householdId,
    after: { personId: person.id, name: `${person.firstName} ${person.lastName}`, role: m.role },
    ip: meta.ip, userAgent: meta.userAgent,
  });
  return { ok: true, personId: person.id, role: m.role };
}

export async function updateHouseholdMemberRole(user: SessionUser, householdId: string, personId: string, input: { role?: string }, meta: { ip?: string; userAgent?: string }) {
  const hh = await db.household.findFirst({ where: { id: householdId, orgId: user.orgId, deletedAt: null } });
  if (!hh) throw notFound("Household not found.");
  if (!(await canEditHousehold(user, householdId))) {
    throw forbidden("You can only manage your own household.");
  }
  const m = await db.householdMember.findFirst({ where: { householdId, personId, endedAt: null } });
  if (!m) throw notFound("That person is not in this household.");
  if (!HOUSEHOLD_MEMBER_ROLES.includes(input.role ?? "")) throw badRequest("Unknown household role.");
  await db.householdMember.update({ where: { id: m.id }, data: { role: input.role!, isPrimaryContact: input.role === "head" } });
  if (input.role === "head" && hh.headPersonId !== personId) {
    await db.household.update({ where: { id: householdId }, data: { headPersonId: personId } });
  } else if (input.role !== "head" && hh.headPersonId === personId) {
    await db.household.update({ where: { id: householdId }, data: { headPersonId: null } });
  }
  await audit({
    orgId: user.orgId, actor: user, action: "household.member_role",
    entityType: "household", entityId: householdId,
    before: { personId, role: m.role }, after: { personId, role: input.role },
    ip: meta.ip, userAgent: meta.userAgent,
  });
  return { ok: true, role: input.role };
}

export async function removeHouseholdMember(user: SessionUser, householdId: string, personId: string, meta: { ip?: string; userAgent?: string }) {
  const hh = await db.household.findFirst({ where: { id: householdId, orgId: user.orgId, deletedAt: null } });
  if (!hh) throw notFound("Household not found.");
  if (!(await canEditHousehold(user, householdId))) {
    throw forbidden("You can only manage your own household.");
  }
  const m = await db.householdMember.findFirst({ where: { householdId, personId, endedAt: null } });
  if (!m) throw notFound("That person is not in this household.");
  await db.householdMember.update({ where: { id: m.id }, data: { endedAt: new Date() } });
  if (hh.headPersonId === personId) {
    await db.household.update({ where: { id: householdId }, data: { headPersonId: null } });
  }
  await audit({
    orgId: user.orgId, actor: user, action: "household.member_remove",
    entityType: "household", entityId: householdId,
    before: { personId, role: m.role },
    ip: meta.ip, userAgent: meta.userAgent,
  });
  return { ok: true };
}

// ═════════════════════ GUARDIAN LINKS ═══════════════════════════════════════

export async function linkGuardian(user: SessionUser, personId: string, input: GuardianLinkInput, meta: { ip?: string; userAgent?: string }) {
  if (!input.guardianId) throw badRequest("guardianId is required.");
  const child = await db.person.findFirst({ where: { id: personId, orgId: user.orgId, deletedAt: null } });
  if (!child) throw notFound("Person not found.");
  if (!(await canEditPerson(user, personId))) {
    throw forbidden("You can only manage guardians for your own household and dependents.");
  }
  if (input.guardianId === personId) throw badRequest("A person cannot be their own guardian.");
  const guardian = await db.person.findFirst({ where: { id: input.guardianId, orgId: user.orgId, deletedAt: null, mergedIntoId: null } });
  if (!guardian) throw notFound("Guardian not found.");
  const dupe = await db.personRelationship.findFirst({
    where: { orgId: user.orgId, fromPersonId: guardian.id, toPersonId: personId, type: "guardian" },
  });
  if (dupe) throw conflict(`${guardian.firstName} ${guardian.lastName} is already linked to ${child.firstName}.`);
  const rel = await db.personRelationship.create({
    data: {
      orgId: user.orgId,
      fromPersonId: guardian.id,
      toPersonId: personId,
      ...relationshipData(input.relationshipType ?? "guardian"),
      authorizedPickup: input.authorizedPickup ?? true,
      custodyRestricted: input.custodyRestricted ?? false,
    },
  });
  await audit({
    orgId: user.orgId, actor: user, action: "person.guardian_link",
    entityType: "person", entityId: personId,
    after: { guardianId: guardian.id, guardianName: `${guardian.firstName} ${guardian.lastName}`, relationshipType: relationshipTypeOf(rel), authorizedPickup: rel.authorizedPickup, custodyRestricted: rel.custodyRestricted },
    ip: meta.ip, userAgent: meta.userAgent,
  });
  return { ok: true, guardianId: guardian.id, relationshipType: relationshipTypeOf(rel) };
}

export async function updateGuardianLink(user: SessionUser, personId: string, guardianId: string, input: { relationshipType?: string; authorizedPickup?: boolean; custodyRestricted?: boolean }, meta: { ip?: string; userAgent?: string }) {
  const child = await db.person.findFirst({ where: { id: personId, orgId: user.orgId, deletedAt: null } });
  if (!child) throw notFound("Person not found.");
  if (!(await canEditPerson(user, personId))) {
    throw forbidden("You can only manage guardians for your own household and dependents.");
  }
  const rel = await db.personRelationship.findFirst({ where: { orgId: user.orgId, fromPersonId: guardianId, toPersonId: personId } });
  if (!rel) throw notFound("Guardian link not found.");
  const data: any = {};
  if (input.relationshipType !== undefined) Object.assign(data, relationshipData(input.relationshipType));
  if (input.authorizedPickup !== undefined) data.authorizedPickup = !!input.authorizedPickup;
  if (input.custodyRestricted !== undefined) data.custodyRestricted = !!input.custodyRestricted;
  const updated = await db.personRelationship.update({ where: { id: rel.id }, data });
  await audit({
    orgId: user.orgId, actor: user, action: "person.guardian_update",
    entityType: "person", entityId: personId,
    before: { guardianId, authorizedPickup: rel.authorizedPickup, custodyRestricted: rel.custodyRestricted },
    after: { guardianId, authorizedPickup: updated.authorizedPickup, custodyRestricted: updated.custodyRestricted, relationshipType: relationshipTypeOf(updated) },
    ip: meta.ip, userAgent: meta.userAgent,
  });
  return { ok: true, relationshipType: relationshipTypeOf(updated) };
}

export async function unlinkGuardian(user: SessionUser, personId: string, guardianId: string, meta: { ip?: string; userAgent?: string }) {
  const child = await db.person.findFirst({ where: { id: personId, orgId: user.orgId, deletedAt: null } });
  if (!child) throw notFound("Person not found.");
  if (!(await canEditPerson(user, personId))) {
    throw forbidden("You can only manage guardians for your own household and dependents.");
  }
  const rel = await db.personRelationship.findFirst({
    where: { orgId: user.orgId, fromPersonId: guardianId, toPersonId: personId, type: "guardian" },
  });
  if (!rel) throw notFound("Guardian link not found.");
  // child-safety: this must not leave a minor with zero guardians
  await assertGuardianInvariant(user.orgId, { id: personId, birthdate: child.birthdate }, { excludeRelationshipId: rel.id });
  await db.personRelationship.delete({ where: { id: rel.id } });
  await audit({
    orgId: user.orgId, actor: user, action: "person.guardian_unlink",
    entityType: "person", entityId: personId,
    before: { guardianId },
    ip: meta.ip, userAgent: meta.userAgent,
  });
  return { ok: true };
}

// ═════════════════════ TAGS (inline from person detail) ═════════════════════

export async function listTags(user: SessionUser, search?: string) {
  const tags = await db.tag.findMany({
    where: { orgId: user.orgId, ...(search ? { name: { contains: search.toLowerCase() } } : {}) },
    orderBy: { name: "asc" },
    take: 50,
  });
  return { items: tags.map((t) => ({ id: t.id, name: t.name, color: t.color })) };
}

export async function createTag(user: SessionUser, input: { name?: string }, meta: { ip?: string; userAgent?: string }) {
  if (!input.name?.trim()) throw badRequest("Tag name is required.");
  const name = input.name.trim();
  const existing = await db.tag.findFirst({ where: { orgId: user.orgId, name } });
  if (existing) return { id: existing.id, name: existing.name, color: existing.color };
  const tag = await db.tag.create({ data: { orgId: user.orgId, name } });
  await audit({
    orgId: user.orgId, actor: user, action: "tag.create",
    entityType: "tag", entityId: tag.id, after: { name: tag.name },
    ip: meta.ip, userAgent: meta.userAgent,
  });
  return { id: tag.id, name: tag.name, color: tag.color };
}

export async function attachTag(user: SessionUser, personId: string, input: { tagId?: string }, meta: { ip?: string; userAgent?: string }) {
  if (!input.tagId) throw badRequest("tagId is required.");
  const person = await db.person.findFirst({ where: { id: personId, orgId: user.orgId, deletedAt: null } });
  if (!person) throw notFound("Person not found.");
  const tag = await db.tag.findFirst({ where: { id: input.tagId, orgId: user.orgId } });
  if (!tag) throw notFound("Tag not found.");
  const existing = await db.personTag.findUnique({ where: { personId_tagId: { personId, tagId: tag.id } } });
  if (existing) return { ok: true };
  await db.personTag.create({ data: { personId, tagId: tag.id } });
  await audit({
    orgId: user.orgId, actor: user, action: "person.tag_add",
    entityType: "person", entityId: personId, after: { tagId: tag.id, tagName: tag.name },
    ip: meta.ip, userAgent: meta.userAgent,
  });
  return { ok: true };
}

export async function detachTag(user: SessionUser, personId: string, tagId: string, meta: { ip?: string; userAgent?: string }) {
  const tag = await db.tag.findFirst({ where: { id: tagId, orgId: user.orgId } });
  await db.personTag.deleteMany({ where: { personId, tagId } });
  await audit({
    orgId: user.orgId, actor: user, action: "person.tag_remove",
    entityType: "person", entityId: personId, after: { tagId, tagName: tag?.name ?? null },
    ip: meta.ip, userAgent: meta.userAgent,
  });
  return { ok: true };
}

// ═════════════════ GROUP ROSTER (scoped to leaders) ═════════════════════════

async function isLeaderOfGroup(user: SessionUser, groupId: string): Promise<boolean> {
  if (!user.personId) return false;
  const gm = await db.groupMember.findFirst({
    where: { groupId, personId: user.personId, role: { in: ["leader", "co_leader"] }, status: "active" },
    select: { id: true },
  });
  if (gm) return true;
  const g = await db.group.findFirst({ where: { id: groupId, orgId: user.orgId, leaderPersonId: user.personId, deletedAt: null }, select: { id: true } });
  return !!g;
}

export async function canManageGroupMembership(user: SessionUser, groupId: string): Promise<boolean> {
  if (can(user, "people.edit") || can(user, "groups.manage") || can(user, "people.groups.manage")) return true;
  return isLeaderOfGroup(user, groupId);
}

export async function addPersonToGroup(user: SessionUser, personId: string, input: { groupId?: string; role?: string }, meta: { ip?: string; userAgent?: string }) {
  if (!input.groupId) throw badRequest("groupId is required.");
  const person = await db.person.findFirst({ where: { id: personId, orgId: user.orgId, deletedAt: null, mergedIntoId: null } });
  if (!person) throw notFound("Person not found.");
  const group = await db.group.findFirst({ where: { id: input.groupId, orgId: user.orgId, deletedAt: null } });
  if (!group) throw notFound("Group not found.");
  if (!(await canManageGroupMembership(user, group.id))) {
    throw forbidden("You can only manage rosters for groups you lead.");
  }
  const role = ["leader", "co_leader", "member", "apprentice"].includes(input.role ?? "") ? input.role! : "member";
  const existing = await db.groupMember.findFirst({ where: { groupId: group.id, personId } });
  if (existing && existing.status === "active") throw conflict(`${person.firstName} ${person.lastName} is already in ${group.name}.`);
  if (existing) {
    await db.groupMember.update({ where: { id: existing.id }, data: { status: "active", role, leftAt: null, joinedAt: new Date() } });
  } else {
    await db.groupMember.create({ data: { orgId: user.orgId, groupId: group.id, personId, role } });
  }
  await audit({
    orgId: user.orgId, actor: user, action: "person.group_add",
    entityType: "person", entityId: personId,
    after: { groupId: group.id, groupName: group.name, role },
    ip: meta.ip, userAgent: meta.userAgent,
  });
  return { ok: true };
}

export async function removePersonFromGroup(user: SessionUser, personId: string, groupId: string, meta: { ip?: string; userAgent?: string }) {
  const group = await db.group.findFirst({ where: { id: groupId, orgId: user.orgId, deletedAt: null } });
  if (!group) throw notFound("Group not found.");
  if (!(await canManageGroupMembership(user, groupId))) {
    throw forbidden("You can only manage rosters for groups you lead.");
  }
  const gm = await db.groupMember.findFirst({ where: { groupId, personId, status: "active" } });
  if (!gm) throw notFound("That person is not in this group.");
  await db.groupMember.update({ where: { id: gm.id }, data: { status: "left", leftAt: new Date() } });
  await audit({
    orgId: user.orgId, actor: user, action: "person.group_remove",
    entityType: "person", entityId: personId,
    before: { groupId, groupName: group.name, role: gm.role },
    ip: meta.ip, userAgent: meta.userAgent,
  });
  return { ok: true };
}

// ═════════════════════ PHOTO UPLOAD (local, DB-backed) ══════════════════════
// The client downscales to ≤256px and PATCHes a base64 data URL. Files are
// written to db/uploads (local disk, git-ignored) and indexed in FileRecord;
// photoUrl points at /api/v1/files/:id served by the files route.

const PHOTO_MAX_BYTES = 512 * 1024;
const PHOTO_EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

function uploadsDir(): string {
  return path.join(process.cwd(), "db", "uploads");
}

async function retirePreviousPhoto(orgId: string, photoUrl: string | null) {
  if (!photoUrl?.startsWith("/api/v1/files/")) return;
  const fileId = photoUrl.split("/").pop();
  if (!fileId) return;
  await db.fileRecord.updateMany({ where: { id: fileId, orgId }, data: { deletedAt: new Date() } }).catch(() => {});
}

export async function setPersonPhoto(user: SessionUser, personId: string, input: { dataUrl?: string | null }, meta: { ip?: string; userAgent?: string }) {
  const person = await db.person.findFirst({ where: { id: personId, orgId: user.orgId, deletedAt: null } });
  if (!person) throw notFound("Person not found.");
  if (!(await canEditPerson(user, personId))) {
    throw forbidden("You can only edit photos for your own household and dependents.");
  }

  if (!input.dataUrl) {
    await retirePreviousPhoto(user.orgId, person.photoUrl);
    await db.person.update({ where: { id: personId }, data: { photoUrl: null } });
    await audit({
      orgId: user.orgId, actor: user, action: "person.photo_remove",
      entityType: "person", entityId: personId, ip: meta.ip, userAgent: meta.userAgent,
    });
    return { ok: true, photoUrl: null };
  }

  const m = /^data:([a-zA-Z0-9/+.-]+);base64,(.+)$/.exec(input.dataUrl.trim());
  if (!m) throw badRequest("Photo must be a base64 data URL.");
  const contentType = m[1].toLowerCase();
  if (!PHOTO_EXT[contentType]) throw badRequest("Photo must be a PNG, JPEG or WebP image.");
  const buf = Buffer.from(m[2], "base64");
  if (buf.length === 0) throw badRequest("Photo is empty.");
  if (buf.length > PHOTO_MAX_BYTES) throw badRequest("Photo is too large (max 512 KB). Pick a smaller image.");

  const dir = uploadsDir();
  await fs.promises.mkdir(dir, { recursive: true });
  const storageKey = `photo-${randomUUID()}.${PHOTO_EXT[contentType]}`;
  await fs.promises.writeFile(path.join(dir, storageKey), buf);
  const rec = await db.fileRecord.create({
    data: {
      orgId: user.orgId, ownerType: "person", ownerId: personId, kind: "photo",
      storageKey, contentType, byteSize: buf.length, visibility: "member", uploadedBy: user.membershipId,
    },
  });
  await retirePreviousPhoto(user.orgId, person.photoUrl);
  await db.person.update({ where: { id: personId }, data: { photoUrl: `/api/v1/files/${rec.id}` } });
  await audit({
    orgId: user.orgId, actor: user, action: "person.photo_update",
    entityType: "person", entityId: personId,
    after: { fileId: rec.id, bytes: buf.length },
    ip: meta.ip, userAgent: meta.userAgent,
  });
  return { ok: true, photoUrl: `/api/v1/files/${rec.id}` };
}

export async function servePersonPhoto(user: SessionUser, fileId: string): Promise<Response> {
  const rec = await db.fileRecord.findFirst({
    where: { id: fileId, orgId: user.orgId, deletedAt: null, kind: "photo" },
  });
  if (!rec) throw notFound("File not found.");
  let buf: Buffer;
  try {
    buf = await fs.promises.readFile(path.join(uploadsDir(), rec.storageKey));
  } catch {
    throw notFound("File content is missing.");
  }
  return new Response(new Uint8Array(buf), {
    headers: {
      "content-type": rec.contentType ?? "application/octet-stream",
      "cache-control": "private, max-age=3600",
    },
  });
}
