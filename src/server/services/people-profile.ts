/**
 * People CRM (Phase 4/5) — Profile 360 service.
 *
 * ONE scoped endpoint for the profile page + peek drawer. Everything the
 * Profile 360 UI shows flows through the Phase 1 serializer
 * (serializePersonCore) so field visibility is decided ONCE per
 * (viewer, target) pair — fields the viewer cannot see are OMITTED from the
 * response entirely, never merely blanked in the UI.
 *
 * Also owns the Journey tab writes and the Phase 5 profile datasets:
 *   • milestones (fixed in-code taxonomy) — staff-only (people.edit)
 *   • notes (PersonNote table, Phase 5) — people.notes.view/create;
 *     confidential rows are filtered out SERVER-SIDE for viewers without
 *     "people.notes.confidential" (never in any response, activity included)
 *   • attendance & engagement (12-month buckets, streak, last seen)
 *   • communication history (existing Message/MessageRecipient rows + the
 *     existing WhatsApp contact/thread services — no new comms tables)
 *   • activity feed — read-only aggregation over EXISTING sources with a
 *     per-event-type permission filter (no events table is created)
 *   • rule-based (NOT LLM) "Next best step" — staff-only, computed from data
 *     the staff viewer is already allowed to see
 */
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { badRequest, notFound, forbidden } from "@/server/http";
import { can, type SessionUser } from "@/server/permissions";
import {
  buildViewerScope,
  serializePersonCore,
  tierForTarget,
  addressVisible,
  profileVisible,
  privacyEditableFor,
  type PersonRowLike,
} from "@/server/services/people-serializer";
import { canEditPerson, canEditHousehold, canSeeGivingOf, isGuardianOf } from "@/server/services/people";
import { listDonations } from "@/server/services/giving";
import * as whatsappCore from "@/server/services/whatsapp/core";

// ── milestone taxonomy (fixed in code — mirrors schema comment) ─────────────

export const MILESTONE_TYPES = [
  "salvation",
  "water_baptism",
  "holy_spirit_baptism",
  "foundation_school",
  "membership_class",
  "marriage",
  "child_dedication",
  "workers_training",
  "leadership_appointment",
] as const;
export type MilestoneType = (typeof MILESTONE_TYPES)[number];

/** Phase 1 columns a milestone of this type can stamp when still empty. */
const MILESTONE_DATE_COLUMN: Partial<Record<MilestoneType, "salvationDate" | "baptismDate">> = {
  salvation: "salvationDate",
  water_baptism: "baptismDate",
};

// ── helpers ───────────────────────────────────────────────────────────────────

function ageFromBirthdate(bd?: Date | null): number | null {
  if (!bd) return null;
  const now = new Date();
  let a = now.getFullYear() - bd.getFullYear();
  const m = now.getMonth() - bd.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < bd.getDate())) a--;
  return a;
}

function daysSince(d: Date): number {
  return Math.floor((Date.now() - d.getTime()) / 86_400_000);
}

function daysUntilNextBirthday(bd: Date): number {
  const now = new Date();
  const thisYear = new Date(now.getFullYear(), bd.getMonth(), bd.getDate());
  const next = thisYear.getTime() > now.getTime() ? thisYear : new Date(now.getFullYear() + 1, bd.getMonth(), bd.getDate());
  return Math.round((next.getTime() - now.getTime()) / 86_400_000);
}

/**
 * Remove gated keys from a serialized core so the JSON genuinely OMITS them.
 * `privacyHidden` already names exactly which fields the tier lost; profile
 * extras (title…source) ride on the profileVisible tier rule.
 */
function omitGated(core: ReturnType<typeof serializePersonCore>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...core };
  const hidden = new Set(core.privacyHidden);
  if (hidden.has("phone")) {
    for (const k of ["phone", "phoneE164", "phoneDisplay", "whatsappE164", "whatsappDisplay"]) delete out[k];
  }
  if (hidden.has("email")) delete out.email;
  if (hidden.has("birthday")) delete out.birthdate;
  if (hidden.has("attendance")) delete out.lastAttendedAt;
  if (hidden.has("allergies")) delete out.allergies;
  if (hidden.has("notes")) delete out.notes;
  if (!profileVisible(core.viewerTier)) {
    for (const k of [
      "title", "maritalStatus", "weddingAnniversary", "occupation", "employer",
      "preferredChannel", "state", "lga", "campusId", "membershipDate",
      "salvationDate", "baptismDate", "source", "lastContactedAt",
    ]) delete out[k];
  }
  if (out.directoryPrivacy == null) delete out.directoryPrivacy;
  return out;
}

// ── rule-based next best step (staff only — deterministic, no LLM) ──────────

export interface NextStepSuggestion {
  id: string;
  title: string;
  reason: string;
}

function computeNextStep(
  p: {
    status: string;
    lifecycleStage: string;
    phone: string | null;
    phoneE164: string | null;
    email: string | null;
    firstVisitAt: Date | null;
    lastAttendedAt: Date | null;
    birthdate: Date | null;
    salvationDate: Date | null;
    baptismDate: Date | null;
    assignedShepherdId: string | null;
  },
  ctx: { groupCount: number; milestoneTypes: Set<string> }
): NextStepSuggestion | null {
  if (p.status === "archived") return null;
  const stage = p.lifecycleStage;
  const discplingStage = stage === "attender" || stage === "member" || stage === "leader";

  // 1 — no way to follow up at all
  if (!p.phone && !p.phoneE164 && !p.email) {
    return { id: "collect_contact", title: "Collect contact details", reason: "No phone or email on file — you can't follow up until one is captured." };
  }
  // 2 — fresh guest, keep the visit warm
  if ((stage === "guest" || stage === "returning_guest") && p.firstVisitAt && daysSince(p.firstVisitAt) <= 30) {
    return { id: "follow_up_visit", title: "Follow up on their visit", reason: `First visit was ${daysSince(p.firstVisitAt)} day${daysSince(p.firstVisitAt) === 1 ? "" : "s"} ago — send a welcome call or message.` };
  }
  // 3 — drifting away
  if (p.lastAttendedAt && daysSince(p.lastAttendedAt) >= 28) {
    return { id: "absent_4w", title: "Reach out — not seen in 4+ weeks", reason: `Last attended ${daysSince(p.lastAttendedAt)} days ago.` };
  }
  // 4 — cheap, time-sensitive win
  if (p.birthdate) {
    const d = daysUntilNextBirthday(p.birthdate);
    if (d <= 7) return { id: "birthday_soon", title: "Send birthday wishes", reason: d === 0 ? "Birthday is today." : `Birthday is in ${d} day${d === 1 ? "" : "s"}.` };
  }
  // 5 — belonging
  if (ctx.groupCount === 0 && discplingStage) {
    return { id: "no_group", title: "Connect them to a group", reason: "Active in church but not part of any group yet." };
  }
  // 6 — discipleship ladder
  if (discplingStage && !ctx.milestoneTypes.has("salvation") && !p.salvationDate) {
    return { id: "salvation", title: "Start a salvation conversation", reason: "No salvation milestone recorded yet for an active attender." };
  }
  if (discplingStage && (ctx.milestoneTypes.has("salvation") || p.salvationDate) && !ctx.milestoneTypes.has("water_baptism") && !p.baptismDate) {
    return { id: "water_baptism", title: "Invite to water baptism", reason: "Salvation recorded but no water baptism milestone yet." };
  }
  if ((stage === "member" || stage === "leader") && !ctx.milestoneTypes.has("workers_training")) {
    return { id: "workers_training", title: "Invite to workers' training", reason: "A committed member who hasn't been through workers' training." };
  }
  // 7 — pastoral coverage
  if (!p.assignedShepherdId && stage !== "leader" && stage !== "inactive") {
    return { id: "assign_shepherd", title: "Assign a shepherd", reason: "No shepherd assigned for pastoral follow-up." };
  }
  return null;
}

// ── the ONE scoped profile read ──────────────────────────────────────────────

export async function getPersonProfile(user: SessionUser, personId: string) {
  const scope = await buildViewerScope(user);
  const person = await db.person.findFirst({
    where: { id: personId, orgId: user.orgId, deletedAt: null },
    include: {
      householdLinks: { include: { household: { include: { members: { include: { person: true } } } } } },
      groupMemberships: { include: { group: true }, where: { status: "active" } },
      stageHistory: { orderBy: { changedAt: "desc" }, take: 20 },
      tags: { include: { tag: true } },
      milestones: { orderBy: [{ date: "desc" }, { createdAt: "desc" }] },
      invitedBy: { select: { id: true, firstName: true, lastName: true, photoUrl: true } },
      assignedShepherd: { select: { id: true, firstName: true, lastName: true, photoUrl: true } },
    },
  });
  if (!person) throw notFound("Person not found.");

  const tier = tierForTarget(scope, { id: person.id, householdIds: person.householdLinks.map((l) => l.household.id) });
  const core = serializePersonCore(scope, person as unknown as PersonRowLike);
  const personOut = omitGated(core) as Record<string, unknown>;

  // campus display name rides only when the campus id itself is visible
  const showProfile = profileVisible(tier);
  if (showProfile && person.homeCampusId) {
    const campus = await db.campus.findFirst({ where: { id: person.homeCampusId, orgId: user.orgId }, select: { name: true } });
    personOut.campusName = campus?.name ?? null;
  }

  const canEdit = await canEditPerson(user, personId);
  personOut.canEdit = canEdit;
  personOut.canEditDirectoryPrivacy = privacyEditableFor(core.viewerTier);
  personOut.createdAt = person.createdAt;

  // ── family ────────────────────────────────────────────────────────────────
  // Full contact gating (same rule the classic detail uses for guardian phones)
  const contactFull = tier === "staff" || tier === "finance" || tier === "self" || tier === "parent";
  const showAddress = addressVisible(tier);

  const hh = person.householdLinks[0]?.household;
  const household = hh
    ? {
        id: hh.id,
        name: hh.name,
        addressLine1: showAddress ? hh.addressLine1 : null,
        addressLine2: showAddress ? hh.addressLine2 : null,
        city: showAddress ? hh.city : null,
        region: showAddress ? hh.region : null,
        country: showAddress ? hh.country : null,
        canEdit: await canEditHousehold(user, hh.id),
        members: hh.members
          .filter((m) => !m.person.deletedAt && !m.person.mergedIntoId)
          .map((m) => ({
            personId: m.person.id,
            name: `${m.person.firstName} ${m.person.lastName}`,
            photoUrl: m.person.photoUrl,
            role: m.role,
            isThisPerson: m.person.id === personId,
            // ages of OTHERS only leak to tiers that may see birthdates anyway
            age: contactFull ? ageFromBirthdate(m.person.birthdate) : null,
          })),
      }
    : null;

  // guardians of this person (prominent for minors) — names/photos are family
  // directory data; phone numbers follow the same tier gate as the classic view
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
        relationshipType: rel.relationshipType ?? (rel.isGuardian ? "guardian" : "other"),
        authorizedPickup: rel.authorizedPickup,
        custodyRestricted: rel.custodyRestricted,
        isPrimary: idx === 0,
      };
    })
    .filter(Boolean);

  // dependents (reciprocal) — shown on a parent's profile
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
        age: contactFull ? ageFromBirthdate(c.birthdate) : null,
        relationshipType: rel.relationshipType ?? (rel.isGuardian ? "guardian" : "other"),
        isPrimary: idx === 0,
      };
    })
    .filter(Boolean);

  // ── groups + tags (same shapes as the classic detail) ─────────────────────
  const groups = person.groupMemberships.map((gm) => ({
    id: gm.group.id, name: gm.group.name, role: gm.role,
    meetingDay: gm.group.meetingDay, meetingTime: gm.group.meetingTime,
  }));
  const tags = person.tags.map((t) => ({ id: t.tag.id, name: t.tag.name, color: t.tag.color }));

  // ── journey — gated wholesale, never blanked ─────────────────────────────
  const response: Record<string, unknown> = {
    person: personOut,
    household,
    guardians,
    dependents,
    groups,
    tags,
  };

  // emergency contacts — same direction as guardian links (contact → subject);
  // the key is OMITTED entirely for tiers without full contact access
  if (contactFull) {
    const emRels = await db.personRelationship.findMany({
      where: { orgId: user.orgId, toPersonId: personId, type: "emergency" },
      orderBy: { id: "asc" },
    });
    const emPeople = emRels.length
      ? await db.person.findMany({ where: { id: { in: emRels.map((r) => r.fromPersonId) } } })
      : [];
    response.emergencyContacts = emRels
      .map((rel) => {
        const c = emPeople.find((p) => p.id === rel.fromPersonId);
        if (!c || c.deletedAt || c.mergedIntoId) return null;
        return { personId: c.id, name: `${c.firstName} ${c.lastName}`, phone: c.phone, relationshipType: rel.relationshipType };
      })
      .filter(Boolean) as { personId: string; name: string; phone: string | null; relationshipType: string | null }[];
  }

  if (showProfile) {
    response.milestones = person.milestones.map((m) => ({
      id: m.id,
      type: m.type,
      date: m.date,
      notes: m.notes,
      certificateUrl: m.certificateUrl,
      createdAt: m.createdAt,
    }));
    response.stageHistory = person.stageHistory.map((s) => ({
      stage: s.stage,
      previousStage: s.previousStage,
      changedAt: s.changedAt,
      changedByName: s.changedByName,
      note: s.note,
    }));
  }

  // ── next best step — staff-only pastoral suggestion ───────────────────────
  if (tier === "staff") {
    response.nextStep = computeNextStep(person, {
      groupCount: groups.length,
      milestoneTypes: new Set(person.milestones.map((m) => m.type)),
    });
  }

  // ── Phase 5 tab flags — the UI only HIDES tabs; every sub-endpoint re-     
  // enforces the same rule server-side (hiding a tab is not a permission).
  const isSelf = scope.selfPersonId === personId;
  const isGuardian = !scope.isStaff && !!user.personId
    ? await isGuardianOf(user.orgId, user.personId, personId)
    : false;
  response.tabs = {
    attendance: scope.isStaff || isSelf || isGuardian,
    giving: canSeeGivingOf(user, personId),
    notes: can(user, "people.notes.view"),
    // the Add-note dialog shows the confidential toggle only when allowed
    notesConfidential: can(user, "people.notes.confidential"),
    comms: scope.isStaff,
    activity: profileVisible(tier) || isGuardian,
  };

  return response;
}

// ── writes (staff-only) ───────────────────────────────────────────────────────

function parseMilestoneDate(v: unknown): Date | null {
  if (v === undefined || v === null || v === "") return null;
  const s = String(v).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  const d = m ? new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`) : new Date(s);
  if (isNaN(d.getTime())) throw badRequest("Milestone date must be a valid date (YYYY-MM-DD).");
  return d;
}

export async function addMilestone(
  user: SessionUser,
  personId: string,
  input: { type?: string; date?: unknown; notes?: string; certificateUrl?: string },
  meta: { ip?: string; userAgent?: string }
) {
  if (!can(user, "people.edit")) throw forbidden('Requires "people.edit" permission.');
  const type = String(input.type ?? "").trim();
  if (!(MILESTONE_TYPES as readonly string[]).includes(type)) {
    throw badRequest(`Unknown milestone type "${type}".`);
  }
  const person = await db.person.findFirst({ where: { id: personId, orgId: user.orgId, deletedAt: null } });
  if (!person) throw notFound("Person not found.");

  const date = parseMilestoneDate(input.date);
  const notes = input.notes?.trim() || null;
  const certificateUrl = input.certificateUrl?.trim() || null;
  if (certificateUrl && !/^https?:\/\//i.test(certificateUrl)) {
    throw badRequest("Certificate link must start with http:// or https://.");
  }

  const milestone = await db.$transaction(async (tx) => {
    const created = await tx.personMilestone.create({
      data: { orgId: user.orgId, personId, type, date, notes, certificateUrl, recordedBy: user.userId },
    });
    // keep the Phase 1 columns in step so existing filters/insights work
    const column = MILESTONE_DATE_COLUMN[type as MilestoneType];
    if (column && date && person[column] == null) {
      await tx.person.update({ where: { id: personId }, data: { [column]: date } });
    }
    return created;
  });

  await audit({
    orgId: user.orgId, actor: user, action: "person.milestone.add",
    entityType: "person", entityId: personId,
    after: { milestoneId: milestone.id, type, date },
    ip: meta.ip, userAgent: meta.userAgent,
  });
  return {
    id: milestone.id, type: milestone.type, date: milestone.date,
    notes: milestone.notes, certificateUrl: milestone.certificateUrl, createdAt: milestone.createdAt,
  };
}

export async function removeMilestone(
  user: SessionUser,
  personId: string,
  milestoneId: string,
  meta: { ip?: string; userAgent?: string }
) {
  if (!can(user, "people.edit")) throw forbidden('Requires "people.edit" permission.');
  const row = await db.personMilestone.findFirst({ where: { id: milestoneId, orgId: user.orgId, personId } });
  if (!row) throw notFound("Milestone not found.");
  await db.personMilestone.delete({ where: { id: milestoneId } });
  await audit({
    orgId: user.orgId, actor: user, action: "person.milestone.remove",
    entityType: "person", entityId: personId,
    before: { milestoneId, type: row.type, date: row.date },
    ip: meta.ip, userAgent: meta.userAgent,
  });
  return { ok: true };
}

// ════════════════════════════════════════════════════════════════════════════
// Phase 5 — Notes & Care (PersonNote table)
// ════════════════════════════════════════════════════════════════════════════

export const NOTE_TYPES = ["General", "Call", "Visit", "Counseling", "Prayer"] as const;
export type NoteType = (typeof NOTE_TYPES)[number];

const NOTE_BODY_MAX = 2000;

interface NoteMeta { ip?: string; userAgent?: string }

function noteAdmin(user: SessionUser): boolean {
  // "admin" for edit/delete overrides = Administration managers (owner/campus admin)
  return can(user, "admin.manage");
}

/** A person must exist, be live and belong to the viewer's tenant. */
async function requireLivePerson(orgId: string, personId: string) {
  const person = await db.person.findFirst({
    where: { id: personId, orgId, deletedAt: null },
    select: { id: true, firstName: true, lastName: true },
  });
  if (!person) throw notFound("Person not found.");
  return person;
}

/** Author-or-admin edit/delete rule (server-side; the UI only hides buttons). */
function assertNoteAuthorOrAdmin(user: SessionUser, authorId: string | null) {
  if (noteAdmin(user)) return;
  if (authorId && authorId === user.userId) return;
  throw forbidden("Only the note's author or a church admin can change this note.");
}

export async function listPersonNotes(user: SessionUser, personId: string) {
  if (!can(user, "people.notes.view")) throw forbidden('Requires "people.notes.view" permission.');
  await requireLivePerson(user.orgId, personId);

  // CONFIDENTIAL OMSSION: rows above the viewer's clearance never leave the
  // server — they are filtered out here, before serialization (not blanked).
  const confidentialOk = can(user, "people.notes.confidential");
  const rows = await db.personNote.findMany({
    where: {
      orgId: user.orgId,
      personId,
      deletedAt: null,
      ...(confidentialOk ? {} : { confidentialityTier: "standard" }),
    },
    orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
    take: 200,
  });
  const admin = noteAdmin(user);
  return {
    notes: rows.map((n) => ({
      id: n.id,
      type: n.type,
      body: n.body,
      pinned: n.pinned,
      confidentialityTier: n.confidentialityTier,
      authorId: n.authorId,
      authorName: n.authorName,
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
      canEdit: admin || n.authorId === user.userId,
      canDelete: admin || n.authorId === user.userId,
    })),
  };
}

/**
 * Create a care note. The existing `POST /people/v2/:id/notes` contract is
 * preserved: legacy callers send `{ note }` (quick staff note → General),
 * the Phase 5 Notes tab sends `{ type, body, pinned, confidentialityTier }`.
 * Going forward structured notes live in the PersonNote table; the historical
 * `Person.notes` blob is left untouched (additive, no data loss).
 */
export async function createPersonNote(
  user: SessionUser,
  personId: string,
  input: { note?: string; body?: string; type?: string; pinned?: boolean; confidentialityTier?: string },
  meta: NoteMeta
) {
  // legacy callers hold people.edit (pre-Phase 5 contract); new callers gate
  // on people.notes.create — both route through here.
  if (!can(user, "people.notes.create") && !can(user, "people.edit")) {
    throw forbidden('Requires "people.notes.create" permission.');
  }
  await requireLivePerson(user.orgId, personId);

  const body = String(input.body ?? input.note ?? "").trim();
  if (!body) throw badRequest("Note text is required.");
  if (body.length > NOTE_BODY_MAX) throw badRequest(`Note is too long (${NOTE_BODY_MAX} characters max).`);

  const type = input.type === undefined || input.type === "" ? "General" : String(input.type).trim();
  if (!(NOTE_TYPES as readonly string[]).includes(type)) {
    throw badRequest(`Unknown note type "${type}".`);
  }
  const tier = input.confidentialityTier === undefined || input.confidentialityTier === ""
    ? "standard"
    : String(input.confidentialityTier).trim();
  if (tier !== "standard" && tier !== "confidential") {
    throw badRequest('Confidentiality tier must be "standard" or "confidential".');
  }
  if (tier === "confidential" && !can(user, "people.notes.confidential")) {
    throw forbidden('Requires "people.notes.confidential" permission to file a confidential note.');
  }
  const pinned = input.pinned === true;

  const note = await db.personNote.create({
    data: {
      orgId: user.orgId,
      personId,
      type,
      body,
      pinned,
      confidentialityTier: tier,
      authorId: user.userId,
      authorName: user.name,
    },
  });

  await audit({
    orgId: user.orgId, actor: user, action: "person.note.create",
    entityType: "person", entityId: personId,
    after: { noteId: note.id, type, pinned, confidentialityTier: tier },
    ip: meta.ip, userAgent: meta.userAgent,
  });
  return {
    id: note.id,
    type: note.type,
    body: note.body,
    pinned: note.pinned,
    confidentialityTier: note.confidentialityTier,
    authorId: note.authorId,
    authorName: note.authorName,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    canEdit: true,
    canDelete: true,
  };
}

/** Visible-or-404: a note above the viewer's clearance does not exist for them. */
async function requireVisibleNote(user: SessionUser, personId: string, noteId: string) {
  const row = await db.personNote.findFirst({
    where: { id: noteId, orgId: user.orgId, personId, deletedAt: null },
  });
  if (!row) throw notFound("Note not found.");
  if (row.confidentialityTier === "confidential" && !can(user, "people.notes.confidential")) {
    // never reveal existence to viewers without clearance
    throw notFound("Note not found.");
  }
  return row;
}

export async function updatePersonNote(
  user: SessionUser,
  personId: string,
  noteId: string,
  input: { body?: string; type?: string; pinned?: boolean; confidentialityTier?: string },
  meta: NoteMeta
) {
  if (!can(user, "people.notes.view")) throw forbidden('Requires "people.notes.view" permission.');
  await requireLivePerson(user.orgId, personId);
  const row = await requireVisibleNote(user, personId, noteId);
  assertNoteAuthorOrAdmin(user, row.authorId);

  const data: { body?: string; type?: string; pinned?: boolean; confidentialityTier?: string } = {};
  if (input.body !== undefined) {
    const body = String(input.body).trim();
    if (!body) throw badRequest("Note text is required.");
    if (body.length > NOTE_BODY_MAX) throw badRequest(`Note is too long (${NOTE_BODY_MAX} characters max).`);
    data.body = body;
  }
  if (input.type !== undefined) {
    const type = String(input.type).trim();
    if (!(NOTE_TYPES as readonly string[]).includes(type)) throw badRequest(`Unknown note type "${type}".`);
    data.type = type;
  }
  if (input.pinned !== undefined) data.pinned = input.pinned === true;
  if (input.confidentialityTier !== undefined) {
    const tier = String(input.confidentialityTier).trim();
    if (tier !== "standard" && tier !== "confidential") {
      throw badRequest('Confidentiality tier must be "standard" or "confidential".');
    }
    if (tier === "confidential" && !can(user, "people.notes.confidential")) {
      throw forbidden('Requires "people.notes.confidential" permission.');
    }
    data.confidentialityTier = tier;
  }
  if (Object.keys(data).length === 0) throw badRequest("Nothing to update.");

  const updated = await db.personNote.update({ where: { id: noteId }, data });
  await audit({
    orgId: user.orgId, actor: user, action: "person.note.update",
    entityType: "person", entityId: personId,
    before: { noteId, type: row.type, pinned: row.pinned, confidentialityTier: row.confidentialityTier },
    after: { noteId, ...data },
    ip: meta.ip, userAgent: meta.userAgent,
  });
  return {
    id: updated.id,
    type: updated.type,
    body: updated.body,
    pinned: updated.pinned,
    confidentialityTier: updated.confidentialityTier,
    authorId: updated.authorId,
    authorName: updated.authorName,
    createdAt: updated.createdAt,
    updatedAt: updated.updatedAt,
    canEdit: true,
    canDelete: true,
  };
}

export async function deletePersonNote(
  user: SessionUser,
  personId: string,
  noteId: string,
  meta: NoteMeta
) {
  if (!can(user, "people.notes.view")) throw forbidden('Requires "people.notes.view" permission.');
  await requireLivePerson(user.orgId, personId);
  const row = await requireVisibleNote(user, personId, noteId);
  assertNoteAuthorOrAdmin(user, row.authorId);

  await db.personNote.update({ where: { id: noteId }, data: { deletedAt: new Date() } });
  await audit({
    orgId: user.orgId, actor: user, action: "person.note.delete",
    entityType: "person", entityId: personId,
    before: { noteId, type: row.type, confidentialityTier: row.confidentialityTier },
    ip: meta.ip, userAgent: meta.userAgent,
  });
  return { ok: true };
}

// ════════════════════════════════════════════════════════════════════════════
// Phase 5 — Attendance & Engagement
// ════════════════════════════════════════════════════════════════════════════

/** Statuses that count as "was there". Absent/excused never count. */
const ATTENDED_STATUSES = ["present", "late", "checked_in", "checked_out"] as const;

/** Africa/Lagos is UTC+1 year-round (no DST) — day buckets for the heatmap. */
function lagosDay(d: Date): string {
  return new Date(d.getTime() + 3_600_000).toISOString().slice(0, 10);
}

export async function getPersonAttendance(user: SessionUser, personId: string) {
  const scope = await buildViewerScope(user);
  const isSelf = scope.selfPersonId === personId;
  const isGuardian = !scope.isStaff && !isSelf && !!user.personId
    ? await isGuardianOf(user.orgId, user.personId, personId)
    : false;
  if (!scope.isStaff && !isSelf && !isGuardian) {
    throw forbidden("You do not have permission to view this person's attendance.");
  }
  await requireLivePerson(user.orgId, personId);

  // 12-month window: first day of the month 11 months back (Lagos calendar).
  const nowLagos = lagosDay(new Date());
  const [y, m] = nowLagos.split("-").map(Number);
  const windowStart = new Date(Date.UTC(y, m - 1 - 11, 1));

  const rows = await db.attendanceRecord.findMany({
    where: {
      orgId: user.orgId,
      personId,
      status: { in: [...ATTENDED_STATUSES] },
      event: { startsAt: { gte: windowStart } },
    },
    orderBy: [{ checkedInAt: "desc" }],
    take: 1000,
    include: { event: { select: { name: true, startsAt: true, kind: true } } },
  });

  // effective moment of attendance (check-in time, else the event start)
  const moments = rows.map((r) => ({
    r,
    at: r.checkedInAt ?? r.event.startsAt,
  }));
  moments.sort((a, b) => b.at.getTime() - a.at.getTime());

  const daily: Record<string, number> = {};
  const months: Record<string, number> = {};
  let lastSeenAt: string | null = null;
  for (const { at } of moments) {
    const day = lagosDay(at);
    daily[day] = (daily[day] ?? 0) + 1;
    const month = day.slice(0, 7);
    months[month] = (months[month] ?? 0) + 1;
    if (!lastSeenAt || day > lastSeenAt) lastSeenAt = day;
  }

  // Streak = consecutive calendar months with ≥1 present attendance, counting
  // back from the current month (a mid-month gap today does not break it —
  // when the current month is still empty we start from the previous one).
  let streak = 0;
  {
    const cursor = new Date(Date.UTC(y, m - 1, 1));
    if (!months[keyOfMonth(cursor)]) cursor.setUTCMonth(cursor.getUTCMonth() - 1);
    while (months[keyOfMonth(cursor)] > 0) {
      streak++;
      cursor.setUTCMonth(cursor.getUTCMonth() - 1);
    }
  }

  return {
    daily,
    months,
    streak,
    lastSeenAt,
    total12m: rows.length,
    recent: moments.slice(0, 10).map(({ r, at }) => ({
      id: r.id,
      eventName: r.event.name,
      eventKind: r.event.kind,
      date: at.toISOString(),
      status: r.status,
      method: r.method,
      firstTime: r.firstTime,
    })),
  };
}

function keyOfMonth(d: Date): string {
  return d.toISOString().slice(0, 7);
}

// ════════════════════════════════════════════════════════════════════════════
// Phase 5 — Communication history (staff only)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Message history for one person, assembled from EXISTING comms data:
 *  • email/SMS — MessageRecipient rows (they already carry personId)
 *  • WhatsApp  — the existing WhatsApp contact/thread services, matched by
 *    the contact's personId link (no new comms tables, no new providers)
 */
export async function getPersonMessages(user: SessionUser, personId: string) {
  if (!can(user, "people.edit")) {
    throw forbidden("Communication history is visible to church staff only.");
  }
  await requireLivePerson(user.orgId, personId);

  const [recipients, waContact] = await Promise.all([
    db.messageRecipient.findMany({
      where: { orgId: user.orgId, personId },
      take: 100,
      include: { message: { select: { id: true, channel: true, subject: true, status: true, sentAt: true, fromName: true } } },
    }),
    db.whatsAppContact.findFirst({ where: { orgId: user.orgId, personId } }),
  ]);

  const emailSms = recipients
    .map((r) => ({
      id: r.id,
      channel: r.message.channel,
      subject: r.message.subject,
      messageStatus: r.message.status,
      recipientStatus: r.status,
      sentAt: (r.sentAt ?? r.message.sentAt)?.toISOString() ?? null,
      fromName: r.message.fromName,
    }))
    .sort((a, b) => (b.sentAt ?? "").localeCompare(a.sentAt ?? ""))
    .slice(0, 50);

  let whatsapp: {
    contactId: string;
    phoneNumber: string;
    optedIn: boolean;
    items: { id: string; direction: string; messageType: string; content: string | null; status: string; createdAt: string }[];
  } | null = null;
  if (waContact) {
    try {
      const thread = await whatsappCore.listMessages(user, waContact.id);
      whatsapp = {
        contactId: thread.contact.id,
        phoneNumber: thread.contact.phoneNumber,
        optedIn: thread.contact.optedIn,
        items: thread.items.slice(-100).reverse().map((m) => ({
          id: m.id,
          direction: m.direction,
          messageType: m.messageType,
          content: m.content,
          status: m.status,
          createdAt: m.createdAt.toISOString(),
        })),
      };
    } catch {
      whatsapp = null; // thread unreadable → graceful empty state
    }
  }

  return { emailSms, whatsapp };
}

// ════════════════════════════════════════════════════════════════════════════
// Phase 5 — Activity feed (read-only aggregation over EXISTING sources)
// ════════════════════════════════════════════════════════════════════════════

export interface ProfileActivityEvent {
  id: string;
  type: "stage" | "milestone" | "attendance" | "group_joined" | "note" | "gift";
  at: string;
  // per-type payload (only the fields that exist for that type)
  stage?: string;
  previousStage?: string | null;
  changedByName?: string | null;
  milestoneType?: string;
  eventName?: string;
  status?: string;
  groupName?: string;
  role?: string;
  noteType?: string;
  confidential?: boolean;
  excerpt?: string;
  amountCents?: number;
  method?: string;
}

const ACTIVITY_CAP = 50;

/**
 * One scoped read over the sources that ALREADY exist — stage changes,
 * milestones, attendance, group joins, notes and (only when the viewer may
 * see them) gifts. Per-event-type permission filter = that source is simply
 * not queried. No duplicate events table is created.
 */
export async function getPersonActivity(user: SessionUser, personId: string) {
  const scope = await buildViewerScope(user);
  const person = await db.person.findFirst({
    where: { id: personId, orgId: user.orgId, deletedAt: null },
    select: { id: true, householdLinks: { select: { householdId: true } } },
  });
  if (!person) throw notFound("Person not found.");
  const tier = tierForTarget(scope, { id: person.id, householdIds: person.householdLinks });
  const showJourney = profileVisible(tier); // staff / finance / self / parent
  const isSelf = scope.selfPersonId === personId;
  const isGuardian = !scope.isStaff && !isSelf && !!user.personId
    ? await isGuardianOf(user.orgId, user.personId, personId)
    : false;

  type Event = ProfileActivityEvent;
  const [stage, milestones, attendance, groupJoins, notes, gifts] = await Promise.all([
    // stage changes — same visibility as the Journey tab
    showJourney
      ? db.stageHistory.findMany({
          where: { orgId: user.orgId, personId },
          orderBy: { changedAt: "desc" }, take: 20,
          select: { id: true, stage: true, previousStage: true, changedAt: true, changedByName: true },
        })
      : Promise.resolve([] as { id: string; stage: string; previousStage: string | null; changedAt: Date; changedByName: string | null }[]),
    showJourney
      ? db.personMilestone.findMany({
          where: { orgId: user.orgId, personId },
          orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 20,
          select: { id: true, type: true, date: true, createdAt: true },
        })
      : Promise.resolve([] as { id: string; type: string; date: Date | null; createdAt: Date }[]),
    // attendance — same rule as the Attendance tab (staff / self / guardian)
    scope.isStaff || isSelf || isGuardian
      ? db.attendanceRecord.findMany({
          where: { orgId: user.orgId, personId, status: { in: [...ATTENDED_STATUSES] } },
          orderBy: [{ checkedInAt: "desc" }], take: 20,
          select: { id: true, status: true, checkedInAt: true, event: { select: { startsAt: true, name: true } } },
        })
      : Promise.resolve([] as { id: string; status: string; checkedInAt: Date | null; event: { startsAt: Date; name: string } }[]),
    // group joins — staff see everyone's; a person sees their own
    // (rows with no joinedAt are skipped below — Prisma+SQLite rejects { not: null })
    scope.isStaff || isSelf
      ? db.groupMember.findMany({
          where: { orgId: user.orgId, personId, status: "active", group: { deletedAt: null } },
          orderBy: { joinedAt: "desc" }, take: 20,
          select: { id: true, role: true, joinedAt: true, group: { select: { name: true } } },
        })
      : Promise.resolve([] as { id: string; role: string; joinedAt: Date | null; group: { name: string } }[]),
    // notes — only when the viewer holds people.notes.view; confidential rows
    // are excluded unless cleared (they never reach any response)
    can(user, "people.notes.view")
      ? db.personNote.findMany({
          where: {
            orgId: user.orgId, personId, deletedAt: null,
            ...(can(user, "people.notes.confidential") ? {} : { confidentialityTier: "standard" }),
          },
          orderBy: { createdAt: "desc" }, take: 20,
          select: { id: true, type: true, body: true, confidentialityTier: true, createdAt: true, authorName: true },
        })
      : Promise.resolve([] as { id: string; type: string; body: string; confidentialityTier: string; createdAt: Date; authorName: string | null }[]),
    // gifts — ONLY when canSeeGivingOf allows (own-scope self-forcing inside
    // the existing service keeps this leak-proof); otherwise not queried at all
    canSeeGivingOf(user, personId)
      ? listDonations(user, { personId, page: 1, pageSize: 10 }).then((r) => r.items)
      : Promise.resolve([] as { id: string; amountCents: number; receivedOn: Date | null; method: string }[]),
  ]);

  const events: Event[] = [];
  for (const s of stage) {
    events.push({ id: `stage:${s.id}`, type: "stage", at: s.changedAt.toISOString(), stage: s.stage, previousStage: s.previousStage, changedByName: s.changedByName });
  }
  for (const mi of milestones) {
    events.push({ id: `milestone:${mi.id}`, type: "milestone", at: (mi.date ?? mi.createdAt).toISOString(), milestoneType: mi.type });
  }
  for (const a of attendance) {
    events.push({ id: `att:${a.id}`, type: "attendance", at: (a.checkedInAt ?? a.event.startsAt).toISOString(), eventName: a.event.name, status: a.status });
  }
  for (const g of groupJoins) {
    if (!g.joinedAt) continue;
    events.push({ id: `grp:${g.id}`, type: "group_joined", at: g.joinedAt.toISOString(), groupName: g.group.name, role: g.role });
  }
  for (const n of notes) {
    events.push({
      id: `note:${n.id}`, type: "note", at: n.createdAt.toISOString(),
      noteType: n.type, confidential: n.confidentialityTier === "confidential",
      excerpt: n.body.length > 90 ? `${n.body.slice(0, 90)}…` : n.body,
    });
  }
  for (const g of gifts) {
    events.push({ id: `gift:${g.id}`, type: "gift", at: (g.receivedOn ?? new Date(0)).toISOString(), amountCents: g.amountCents, method: g.method });
  }

  events.sort((a, b) => b.at.localeCompare(a.at));
  return { events: events.slice(0, ACTIVITY_CAP), generatedAt: new Date().toISOString() };
}
