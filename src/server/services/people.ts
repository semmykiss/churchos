import { db } from "@/server/db";
import { audit, j } from "@/server/audit";
import { ApiError, badRequest, notFound, forbidden, conflict } from "@/server/http";
import { can, type SessionUser } from "@/server/permissions";
import {
  buildViewerScope,
  serializePersonCore,
  serializePersonSummary,
  serializeDirectoryPrivacy,
  parseDirectoryPrivacy,
  tierForTarget,
  addressVisible,
  privacyEditableFor,
  type ViewerScope,
  type PersonRowLike,
  type DirectoryPrivacy,
} from "@/server/services/people-serializer";
import { formatPhoneDisplay, normalizeToE164, normalizePhoneForMatch } from "@/lib/phone";
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
    const phoneNorm = normalizeToE164(q.search);
    where.OR = [
      { firstName: { contains: s } },
      { lastName: { contains: s } },
      { email: { contains: s } },
      { phone: { contains: s } },
      // Phase 1: typing "0803 123 4567" or "+234803…" finds the normalized record
      ...(phoneNorm ? [{ phoneE164: phoneNorm }] : []),
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
  // ONE serializer for people reads — tiered visibility per (viewer, target).
  const scope = await buildViewerScope(user);
  return {
    total,
    page,
    pageSize,
    items: rows.map((p) => serializePersonSummary(scope, p as unknown as PersonRowLike)),
  };
}

export async function getPersonDetail(user: SessionUser, personId: string) {
  const scope = await buildViewerScope(user);
  const person = await db.person.findFirst({
    where: { id: personId, orgId: user.orgId, deletedAt: null },
    include: {
      householdLinks: { include: { household: { include: { members: { include: { person: true } } } } } },
      groupMemberships: { include: { group: true }, where: { status: "active" } },
      relationshipsFrom: true,
      relationshipsTo: true,
      stageHistory: { orderBy: { changedAt: "desc" }, take: 12 },
      tags: { include: { tag: true } },
      // People CRM (Phase 1) — invitation chain + assigned shepherd
      invitedBy: { select: { id: true, firstName: true, lastName: true, photoUrl: true } },
      assignedShepherd: { select: { id: true, firstName: true, lastName: true, photoUrl: true } },
    },
  });
  if (!person) throw notFound("Person not found.");
  const targetTier = tierForTarget(scope, { id: person.id, householdIds: person.householdLinks.map((l) => l.household.id) });
  const contactFull = targetTier === "staff" || targetTier === "finance" || targetTier === "self" || targetTier === "parent";

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
        phone: contactFull ? g.phone : null,
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

  // recent attendance — tiered: staff/finance/self/parent see all, leaders only
  // events of the groups THEY lead, members none
  let attendance = await db.attendanceRecord.findMany({
    where: { orgId: user.orgId, personId },
    orderBy: { checkedInAt: "desc" },
    take: 10,
    include: { event: { select: { name: true, startsAt: true, kind: true, groupId: true } } },
  });
  if (targetTier === "leader") {
    attendance = attendance.filter((a) => a.event.groupId && scope.ledGroupIds.has(a.event.groupId));
  } else if (!contactFull) {
    attendance = [];
  }

  // recent gifts — permissioned PER VIEWER (own ≠ all; pastors respect the
  // church setting via injected giving.view.all)
  let gifts: any[] = [];
  let givingTotal: number | null = null;
  const givingVisible = canSeeGivingOf(user, personId);
  if (givingVisible) {
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

  const canEdit = await canEditPerson(user, personId);
  const core = serializePersonCore(scope, person as unknown as PersonRowLike);
  const hh = person.householdLinks[0]?.household;
  const showAddress = addressVisible(targetTier);
  return {
    person: {
      ...core,
      // detail-only extras (shape preserved for existing screens)
      custom: j(person.custom, {}),
      // server-computed scoped edit rights — the single source of truth for the UI
      canEdit,
      canEditDirectoryPrivacy: privacyEditableFor(core.viewerTier),
    },
    household: hh
      ? {
          id: hh.id,
          name: hh.name,
          addressLine1: showAddress ? hh.addressLine1 : null,
          city: showAddress ? hh.city : null,
          region: showAddress ? hh.region : null,
          members: hh.members
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
    giving: { visible: givingVisible, total: givingTotal, gifts },
    care: { visible: careVisible, cases: careCases },
  };
}

export function canSeeGiving(user: SessionUser): boolean {
  return user.permissions.some((p) => p === "*" || p === "giving.view" || p.startsWith("giving."));
}
export function canSeeCare(user: SessionUser): boolean {
  return user.permissions.some((p) => p === "*" || p === "care.view" || p.startsWith("care."));
}

/**
 * Viewer-aware giving visibility for a person detail view:
 *  • giving.view.all (staff/finance, or pastor when the church setting
 *    pastorCanViewIndividualGiving has injected it) → see anyone's giving
 *  • giving.view.own → only your OWN giving (never someone else's, not even
 *    a placeholder that leaks existence)
 *  • otherwise → hidden
 */
export function canSeeGivingOf(user: SessionUser, targetPersonId: string): boolean {
  if (can(user, "giving.view.all")) return true;
  return !!user.personId && user.personId === targetPersonId && can(user, "giving.view.own");
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

/**
 * Parse a client-supplied date. Accepts "YYYY-MM-DD" (date inputs) and full
 * ISO timestamps (round-tripped from the API). Blank → null; garbage → 400.
 */
export function parseDateInput(v: unknown, label = "Date"): Date | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  const d = m
    ? new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`)
    : new Date(s);
  if (isNaN(d.getTime())) throw badRequest(`${label} must be a valid date (YYYY-MM-DD).`);
  return d;
}

export function parseBirthdateInput(v: unknown): Date | null {
  return parseDateInput(v, "Birthdate");
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
  if (input.phone) {
    or.push({ phone: { equals: input.phone.trim() } }); // legacy exact match — contract kept
    // Phase 1: also match the normalized E.164 so "0803 123 4567" and
    // "+2348031234567" (and stored-as-typed legacy values) collide correctly
    const phoneNorm = normalizePhoneForMatch(input.phone);
    if (phoneNorm) {
      or.push({ phoneE164: phoneNorm });
      or.push({ phone: { equals: phoneNorm } });
    }
  }
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
    phoneE164: p.phoneE164 ?? null,
    phoneDisplay: formatPhoneDisplay(p.phoneE164 ?? normalizeToE164(p.phone)),
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
  // ── People CRM (Phase 1) ──
  title?: string; maritalStatus?: string; weddingAnniversary?: string;
  occupation?: string; employer?: string;
  phoneE164?: string;              // pre-normalized (client may send raw `phone` too)
  whatsapp?: string; whatsappE164?: string;
  preferredChannel?: string;       // sms | email | whatsapp | call | any
  state?: string; lga?: string;
  homeCampusId?: string;
  membershipDate?: string; salvationDate?: string; baptismDate?: string;
  source?: string;                 // guest_card | referral | outreach | whatsapp | online | import | other
  invitedByPersonId?: string;      // must be a live person in the same org
  assignedShepherdId?: string;     // must be a live person in the same org
  directoryPrivacy?: Partial<DirectoryPrivacy> | null;
}

/** Trim a free-text field; undefined stays undefined (create) / null clears (update). */
function textOrNull(v?: string): string | null | undefined {
  if (v === undefined) return undefined;
  const s = v.trim();
  return s ? s : null;
}

/** Resolve invitedBy/assignedShepherd to a live same-org person, else 400. */
async function resolveRelatedPerson(orgId: string, id?: string): Promise<string | null | undefined> {
  if (id === undefined) return undefined;
  if (!id || !id.trim()) return null;
  const p = await db.person.findFirst({
    where: { id: id.trim(), orgId, deletedAt: null, mergedIntoId: null },
    select: { id: true },
  });
  if (!p) throw badRequest("Related person (invited by / assigned shepherd) was not found in this church.");
  return p.id;
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
  const minor = isMinorPerson({ birthdate: parseBirthdateInput(input.birthdate), householdRole });
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

  // ── People CRM (Phase 1): validate relation targets before the transaction ──
  const invitedById = await resolveRelatedPerson(user.orgId, input.invitedByPersonId);
  const shepherdId = await resolveRelatedPerson(user.orgId, input.assignedShepherdId);

  const person = await db.$transaction(async (tx) => {
    const created = await tx.person.create({
      data: {
        orgId: user.orgId,
        firstName: input.firstName.trim(),
        lastName: input.lastName.trim(),
        preferredName: input.preferredName?.trim() || undefined,
        email: input.email?.trim().toLowerCase() || undefined,
        phone: input.phone?.trim() || undefined,
        // Phase 1 — normalized companions (never guess: unparseable → null)
        phoneE164: normalizeToE164(input.phoneE164 ?? input.phone) ?? undefined,
        whatsappE164: normalizeToE164(input.whatsappE164 ?? input.whatsapp) ?? undefined,
        birthdate: parseBirthdateInput(input.birthdate) ?? undefined,
        gender: input.gender || undefined,
        lifecycleStage: input.lifecycleStage || "guest",
        notes: input.notes || undefined,
        allergies: input.allergies || undefined,
        homeCampusId: input.homeCampusId || user.campusId || undefined,
        firstVisitAt: (input.lifecycleStage ?? "guest") === "guest" ? new Date() : undefined,
        // Phase 1 — profile, location, milestones, provenance, privacy
        title: (textOrNull(input.title) as string | undefined) ?? undefined,
        maritalStatus: (textOrNull(input.maritalStatus) as string | undefined) ?? undefined,
        weddingAnniversary: parseDateInput(input.weddingAnniversary, "Wedding anniversary") ?? undefined,
        occupation: (textOrNull(input.occupation) as string | undefined) ?? undefined,
        employer: (textOrNull(input.employer) as string | undefined) ?? undefined,
        preferredChannel: (textOrNull(input.preferredChannel) as string | undefined) ?? undefined,
        state: (textOrNull(input.state) as string | undefined) ?? undefined,
        lga: (textOrNull(input.lga) as string | undefined) ?? undefined,
        membershipDate: parseDateInput(input.membershipDate, "Membership date") ?? undefined,
        salvationDate: parseDateInput(input.salvationDate, "Salvation date") ?? undefined,
        baptismDate: parseDateInput(input.baptismDate, "Baptism date") ?? undefined,
        source: (textOrNull(input.source) as string | undefined) ?? undefined,
        invitedByPersonId: invitedById ?? undefined,
        assignedShepherdId: shepherdId ?? undefined,
        directoryPrivacy: input.directoryPrivacy !== undefined ? serializeDirectoryPrivacy(input.directoryPrivacy) : undefined,
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
  // self-service scope must not touch staff-only fields
  const selfServiceOnly = !can(user, "people.edit");
  const data: any = {};
  // identity + contact — anyone with edit rights on this person (incl. scoped self-service)
  for (const k of ["firstName", "lastName", "preferredName", "email", "phone", "gender"] as const) {
    if (input[k] === undefined) continue;
    data[k] = input[k] === "" ? null : input[k];
  }
  // staff-visible notes/allergies — never writable from self-service scope
  if (!selfServiceOnly) {
    for (const k of ["notes", "allergies"] as const) {
      if (input[k] === undefined) continue;
      data[k] = input[k] === "" ? null : input[k];
    }
  }
  // People CRM (Phase 1) — personal profile fields (self-service allowed)
  for (const k of ["title", "maritalStatus", "occupation", "employer", "preferredChannel", "state", "lga"] as const) {
    if (input[k] === undefined) continue;
    data[k] = input[k] === "" ? null : String(input[k]).trim() || null;
  }
  if (input.weddingAnniversary !== undefined) data.weddingAnniversary = parseDateInput(input.weddingAnniversary, "Wedding anniversary");
  // directory privacy — the person, their household/guardian editor, or staff
  if (input.directoryPrivacy !== undefined) data.directoryPrivacy = serializeDirectoryPrivacy(input.directoryPrivacy);
  // normalized phones (Phase 1): raw stays as typed; E.164 derived, never guessed
  if (input.phone !== undefined || input.phoneE164 !== undefined) {
    if (input.phone !== undefined) data.phone = input.phone === "" ? null : input.phone;
    data.phoneE164 = normalizeToE164(input.phoneE164 ?? input.phone); // null when blank/unparseable
  }
  if (input.whatsapp !== undefined || input.whatsappE164 !== undefined) {
    const wRaw = input.whatsappE164 ?? input.whatsapp;
    data.whatsappE164 = wRaw === "" ? null : normalizeToE164(wRaw);
  }
  // Phase 1 — staff-only: milestones, provenance, campus, assignments
  if (!selfServiceOnly) {
    if (input.membershipDate !== undefined) data.membershipDate = parseDateInput(input.membershipDate, "Membership date");
    if (input.salvationDate !== undefined) data.salvationDate = parseDateInput(input.salvationDate, "Salvation date");
    if (input.baptismDate !== undefined) data.baptismDate = parseDateInput(input.baptismDate, "Baptism date");
    if (input.source !== undefined) data.source = input.source === "" ? null : String(input.source).trim() || null;
    if (input.homeCampusId !== undefined) data.homeCampusId = input.homeCampusId || null;
    if (input.lastContactedAt !== undefined) data.lastContactedAt = parseDateInput(input.lastContactedAt, "Last contacted");
    if (input.invitedByPersonId !== undefined) data.invitedByPersonId = (await resolveRelatedPerson(user.orgId, input.invitedByPersonId)) ?? null;
    if (input.assignedShepherdId !== undefined) data.assignedShepherdId = (await resolveRelatedPerson(user.orgId, input.assignedShepherdId)) ?? null;
  }
  if (input.email) data.email = input.email.trim().toLowerCase();
  if (input.birthdate !== undefined) {
    data.birthdate = parseBirthdateInput(input.birthdate);
    // child-safety: birthdate change must not leave a minor unguarded
    await assertGuardianInvariant(user.orgId, { id: personId, birthdate: data.birthdate });
  }
  const person = await db.person.update({ where: { id: personId }, data });
  await audit({
    orgId: user.orgId, actor: user, action: "person.update",
    entityType: "person", entityId: personId,
    before: { firstName: before.firstName, lastName: before.lastName, email: before.email, phone: before.phone, phoneE164: before.phoneE164, birthdate: before.birthdate },
    after: { firstName: person.firstName, lastName: person.lastName, email: person.email, phone: person.phone, phoneE164: person.phoneE164, birthdate: person.birthdate },
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
    data: {
      lifecycleStage: stage,
      membershipStatus: stage === "member" ? "member" : stage === "attender" || stage === "leader" ? "regular" : before.membershipStatus,
      // Phase 1: first time someone becomes a member, stamp the membership date
      ...(stage === "member" && !before.membershipDate ? { membershipDate: new Date() } : {}),
    },
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

  const mergeable = [
    "firstName", "lastName", "preferredName", "email", "phone", "birthdate", "gender", "allergies", "notes",
    // People CRM (Phase 1) — simple value fields the survivor choice can carry over
    "phoneE164", "whatsappE164", "title", "maritalStatus", "weddingAnniversary", "occupation", "employer",
    "preferredChannel", "state", "lga", "membershipDate", "salvationDate", "baptismDate", "source", "lastContactedAt",
  ];
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
  // People CRM (Phase 1): re-point invitation chain + shepherd assignments
  await db.person.updateMany({ where: { invitedByPersonId: merged.id }, data: { invitedByPersonId: survivor.id } });
  await db.person.updateMany({ where: { assignedShepherdId: merged.id }, data: { assignedShepherdId: survivor.id } });

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
  const scope = await buildViewerScope(user);
  return {
    items: households.map((h, i) => {
      // address block: staff/finance or the household's own editors only
      const addressFull = scope.isStaff || scope.isFinance || canEditFlags[i];
      return {
        id: h.id, name: h.name,
        addressLine1: addressFull ? h.addressLine1 : null,
        addressLine2: addressFull ? h.addressLine2 : null,
        city: addressFull ? h.city : null,
        region: addressFull ? h.region : null,
        postalCode: addressFull ? h.postalCode : null,
        deletedAt: h.deletedAt,
        canEdit: canEditFlags[i],
        members: h.members.filter((m) => !m.person.deletedAt && !m.endedAt).map((m) => {
          const tier = tierForTarget(scope, { id: m.person.id, householdIds: [h.id] });
          const full = tier === "staff" || tier === "finance" || tier === "self" || tier === "parent" || tier === "leader";
          const privacy = parseDirectoryPrivacy(m.person.directoryPrivacy);
          return {
            personId: m.person.id, name: `${m.person.firstName} ${m.person.lastName}`, photoUrl: m.person.photoUrl, role: m.role,
            email: full || privacy.email ? m.person.email : null,
            phone: full || privacy.phone ? m.person.phone : null,
            phoneDisplay: full || privacy.phone ? formatPhoneDisplay(m.person.phoneE164 ?? normalizeToE164(m.person.phone)) : null,
          };
        }),
      };
    }),
  };
}

export async function exportPeopleCsv(user: SessionUser, q: PersonListQuery, meta: { ip?: string; userAgent?: string }) {
  const { items } = await listPeople(user, { ...q, page: 1, pageSize: 100 });
  // route is people.edit-gated (staff) — serializer returns full contact
  const header = "first_name,last_name,email,phone,stage,member_status,household,phone_e164,whatsapp_e164,phone_display,state,lga";
  const lines = items.map((p) =>
    [p.firstName, p.lastName, p.email ?? "", p.phone ?? "", p.lifecycleStage, p.membershipStatus, p.household?.name ?? "", p.phoneE164 ?? "", p.whatsappE164 ?? "", p.phoneDisplay ?? "", p.state ?? "", p.lga ?? ""]
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
