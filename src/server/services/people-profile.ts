/**
 * People CRM (Phase 4) — Profile 360 service.
 *
 * ONE scoped endpoint for the profile page + peek drawer. Everything the
 * Profile 360 UI shows flows through the Phase 1 serializer
 * (serializePersonCore) so field visibility is decided ONCE per
 * (viewer, target) pair — fields the viewer cannot see are OMITTED from the
 * response entirely, never merely blanked in the UI.
 *
 * Also owns the Journey tab writes:
 *   • milestones (fixed in-code taxonomy) — staff-only (people.edit)
 *   • quick "Add note" — appends a timestamped line to the staff notes field
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
import { canEditPerson, canEditHousehold } from "@/server/services/people";

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

/** Quick "Add note" — appends a timestamped line to the staff notes field. */
export async function addProfileNote(
  user: SessionUser,
  personId: string,
  input: { note?: string },
  meta: { ip?: string; userAgent?: string }
) {
  if (!can(user, "people.edit")) throw forbidden('Requires "people.edit" permission.');
  const note = String(input.note ?? "").trim();
  if (!note) throw badRequest("Note text is required.");
  if (note.length > 2000) throw badRequest("Note is too long (2000 characters max).");
  const person = await db.person.findFirst({ where: { id: personId, orgId: user.orgId, deletedAt: null } });
  if (!person) throw notFound("Person not found.");

  const stamp = new Date().toISOString().slice(0, 10);
  const line = `[${stamp}] ${note}`;
  const updatedNotes = person.notes ? `${person.notes}\n${line}` : line;
  await db.person.update({ where: { id: personId }, data: { notes: updatedNotes } });

  await audit({
    orgId: user.orgId, actor: user, action: "person.note.add",
    entityType: "person", entityId: personId,
    after: { appended: note },
    ip: meta.ip, userAgent: meta.userAgent,
  });
  return { notes: updatedNotes };
}
