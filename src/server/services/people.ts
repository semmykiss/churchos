import { db } from "@/server/db";
import { audit, j } from "@/server/audit";
import { badRequest, notFound, forbidden } from "@/server/http";
import type { SessionUser } from "@/server/permissions";

/**
 * People & households service (backend only — no HTTP, no React).
 * Business rules honored:
 *  • soft delete only; hard delete blocked when financial/attendance records exist
 *  • duplicate check on create (exact email/phone + name+DOB)
 *  • merge = first-class op with field-level survivor choice + alias redirect + audit
 *  • lifecycle stage changes recorded in stage history
 *  • timeline composes attendance/groups/giving/care with per-domain permission checks
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

  // guardians of this person (for children)
  const guardians = await db.personRelationship.findMany({
    where: { orgId: user.orgId, toPersonId: personId, type: "guardian" },
  });
  const guardianPeople = guardians.length
    ? await db.person.findMany({ where: { id: { in: guardians.map((g) => g.fromPersonId) } } })
    : [];

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
      firstVisitAt: person.firstVisitAt,
      lastActivityAt: person.lastActivityAt,
      custom: j(person.custom, {}),
    },
    household: person.householdLinks[0]?.household
      ? {
          id: person.householdLinks[0].household.id,
          name: person.householdLinks[0].household.name,
          addressLine1: person.householdLinks[0].household.addressLine1,
          city: person.householdLinks[0].household.city,
          region: person.householdLinks[0].household.region,
          members: person.householdLinks[0].household.members.map((m) => ({
            personId: m.person.id,
            name: `${m.person.firstName} ${m.person.lastName}`,
            role: m.role,
            isThisPerson: m.personId === personId,
          })),
        }
      : null,
    guardians: guardianPeople.map((g) => {
      const rel = guardians.find((x) => x.fromPersonId === g.id);
      return { personId: g.id, name: `${g.firstName} ${g.lastName}`, phone: g.phone, authorizedPickup: rel?.authorizedPickup ?? false, custodyRestricted: rel?.custodyRestricted ?? false };
    }),
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

export interface CreatePersonInput {
  firstName: string; lastName: string; preferredName?: string; email?: string; phone?: string;
  birthdate?: string; gender?: string; lifecycleStage?: string; notes?: string; allergies?: string;
  householdName?: string; householdRole?: string; force?: boolean;
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

  const person = await db.person.create({
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
  await db.stageHistory.create({
    data: { orgId: user.orgId, personId: person.id, stage: person.lifecycleStage, changedByName: user.name, note: "Created" },
  });
  await audit({
    orgId: user.orgId, actor: user, action: "person.create",
    entityType: "person", entityId: person.id,
    after: { firstName: person.firstName, lastName: person.lastName, email: person.email },
    ip: meta.ip, userAgent: meta.userAgent,
  });
  return { duplicates: null, created: { id: person.id, name: `${person.firstName} ${person.lastName}` } };
}

export async function updatePerson(user: SessionUser, personId: string, input: Partial<CreatePersonInput>, meta: { ip?: string; userAgent?: string }) {
  const before = await db.person.findFirst({ where: { id: personId, orgId: user.orgId, deletedAt: null } });
  if (!before) throw notFound("Person not found.");
  const data: any = {};
  for (const k of ["firstName", "lastName", "preferredName", "email", "phone", "gender", "notes", "allergies"] as const) {
    if (input[k] !== undefined) data[k] = input[k] === "" ? null : input[k];
  }
  if (input.email) data.email = input.email.trim().toLowerCase();
  if (input.birthdate !== undefined) data.birthdate = input.birthdate ? new Date(input.birthdate + "T00:00:00Z") : null;
  const person = await db.person.update({ where: { id: personId }, data });
  await audit({
    orgId: user.orgId, actor: user, action: "person.update",
    entityType: "person", entityId: personId,
    before: { firstName: before.firstName, lastName: before.lastName, email: before.email, phone: before.phone, birthdate: before.birthdate },
    after: { firstName: person.firstName, lastName: person.lastName, email: person.email, phone: person.phone, birthdate: person.birthdate },
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
    where: { orgId: user.orgId, ...(search ? { name: { contains: search.toLowerCase() } } : {}) },
    include: { members: { include: { person: true } } },
    orderBy: { name: "asc" },
    take: 100,
  });
  return {
    items: households.map((h) => ({
      id: h.id, name: h.name, addressLine1: h.addressLine1, city: h.city, region: h.region, postalCode: h.postalCode,
      members: h.members.filter((m) => !m.person.deletedAt).map((m) => ({
        personId: m.person.id, name: `${m.person.firstName} ${m.person.lastName}`, role: m.role,
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
