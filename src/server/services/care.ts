import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { badRequest, notFound } from "@/server/http";
import type { SessionUser } from "@/server/permissions";
import { pushNotifications, userIdsForPersons, userIdsWithPermission } from "@/server/services/notifications";

/**
 * Pastoral care service (backend only — no HTTP, no React).
 * Business rules honored:
 *  • confidentiality tiers: owner sees all; campus_admin sees staff + case_team
 *    (never pastors tier); ministry_leader sees staff tier only
 *  • safeguarding cases are restricted to owner + campus_admin and surface a
 *    mandatory-reporting banner
 *  • reading a case is audited; reading notes in a pastors-tier case requires owner
 *  • cases and notes are NEVER deletable — cases are closed, not removed
 */

export const SAFEGUARDING_BANNER = "Safeguarding case — mandatory reporting rules apply. This record cannot be deleted.";

/** Which confidentiality tiers + safeguarding visibility a set of role keys grants. */
export function careVisibility(roleKeys: string[]) {
  if (roleKeys.includes("owner")) return { tiers: ["staff", "case_team", "pastors"], safeguarding: true };
  if (roleKeys.includes("campus_admin")) return { tiers: ["staff", "case_team"], safeguarding: true };
  if (roleKeys.includes("ministry_leader")) return { tiers: ["staff"], safeguarding: false };
  return { tiers: [] as string[], safeguarding: false };
}

function tierWhere(roleKeys: string[]) {
  const vis = careVisibility(roleKeys);
  if (!vis.tiers.length) return { id: "__none__" }; // no care visibility at all
  return {
    confidentialityTier: { in: vis.tiers },
    ...(vis.safeguarding ? {} : { isSafeguarding: false }),
  };
}

function toCaseDTO(c: any, person?: { firstName: string; lastName: string } | null) {
  return {
    id: c.id,
    person: person ? { id: c.personId, name: `${person.firstName} ${person.lastName}` } : { id: c.personId, name: "Unknown" },
    type: c.type,
    stage: c.stage,
    ownerName: c.ownerName,
    urgency: c.urgency,
    dueDate: c.dueDate,
    confidentialityTier: c.confidentialityTier,
    status: c.status,
    closeReason: c.closeReason,
    summary: c.summary,
    openedAt: c.openedAt,
    isSafeguarding: c.isSafeguarding,
    noteCount: c._count?.notes ?? 0,
  };
}

async function personMap(ids: string[]) {
  const people = ids.length ? await db.person.findMany({ where: { id: { in: ids } } }) : [];
  return new Map(people.map((p) => [p.id, p] as const));
}

export async function listCases(user: SessionUser, q: { status?: string; stage?: string; type?: string; urgency?: string; mine?: boolean }) {
  const where: any = {
    orgId: user.orgId,
    ...tierWhere(user.roleKeys),
    ...(q.status ? { status: q.status } : {}),
    ...(q.stage ? { stage: q.stage } : {}),
    ...(q.type ? { type: q.type } : {}),
    ...(q.urgency ? { urgency: q.urgency } : {}),
    ...(q.mine ? { ownerMembershipId: user.membershipId } : {}),
  };
  const cases = await db.careCase.findMany({
    where,
    orderBy: [{ status: "asc" }, { openedAt: "desc" }],
    take: 200,
    include: { _count: { select: { notes: true } } },
  });
  const people = await personMap([...new Set(cases.map((c) => c.personId))]);
  return { items: cases.map((c) => toCaseDTO(c, people.get(c.personId))) };
}

export async function createCase(user: SessionUser, input: any, meta: { ip?: string; userAgent?: string }) {
  if (!input?.personId || !input?.type) throw badRequest("personId and type are required.");
  const person = await db.person.findFirst({ where: { id: input.personId, orgId: user.orgId, deletedAt: null } });
  if (!person) throw notFound("Person not found.");
  const isSafeguarding = input.type === "safeguarding" || !!input.isSafeguarding;
  const c = await db.careCase.create({
    data: {
      orgId: user.orgId,
      personId: input.personId,
      type: input.type,
      summary: input.summary || undefined,
      urgency: input.urgency || "normal",
      confidentialityTier: input.confidentialityTier || "staff",
      dueDate: input.dueDate ? new Date(input.dueDate) : undefined,
      ownerName: input.ownerName || user.name,
      ownerMembershipId: user.membershipId,
      isSafeguarding,
    },
  });
  await audit({
    orgId: user.orgId, actor: user, action: "care.case.open", entityType: "care_case", entityId: c.id,
    after: { type: c.type, personId: c.personId, confidentialityTier: c.confidentialityTier, isSafeguarding },
    ip: meta.ip, userAgent: meta.userAgent,
  });

  // urgent / high-urgency cases ping every care viewer's bell (creator excepted)
  if (c.urgency === "urgent" || c.urgency === "high") {
    try {
      const targets = await userIdsWithPermission(user.orgId, "care.view");
      const creatorIds = await userIdsForPersons(user.orgId, user.personId ? [user.personId] : []);
      const userIds = targets.filter((id) => !creatorIds.includes(id));
      if (userIds.length) {
        const CASE_TYPE_LABEL: Record<string, string> = {
          hospital: "Hospital visit", bereavement: "Bereavement", counseling: "Counseling",
          food_assistance: "Food assistance", safeguarding: "Safeguarding",
          new_believer: "New believer", follow_up: "Follow-up", other: "Care need",
        };
        await pushNotifications({
          orgId: user.orgId,
          userIds,
          module: "care",
          type: "care.case.urgent",
          title: `${c.urgency === "urgent" ? "Urgent" : "High-priority"} care case opened`,
          body: `${person.firstName} ${person.lastName} — ${CASE_TYPE_LABEL[c.type] ?? c.type}`,
          entityType: "care_case",
          entityId: c.id,
          linkModule: "care",
        });
      }
    } catch {
      // notifications are best-effort
    }
  }

  return toCaseDTO({ ...c, _count: { notes: 0 } }, person);
}

export async function getCase(user: SessionUser, id: string, meta: { ip?: string; userAgent?: string }) {
  const c = await db.careCase.findFirst({
    where: { id, orgId: user.orgId },
    include: { notes: { orderBy: { occurredAt: "desc" } }, _count: { select: { notes: true } } },
  });
  if (!c) throw notFound("Case not found.");

  // enforce confidentiality tier — hidden cases look like missing cases (no leak)
  const vis = careVisibility(user.roleKeys);
  const tierOk = vis.tiers.includes(c.confidentialityTier);
  const safeguardingOk = !c.isSafeguarding || vis.safeguarding;
  if (!tierOk || !safeguardingOk) throw notFound("Case not found.");

  await audit({
    orgId: user.orgId, actor: user, action: "care.case.view", entityType: "care_case", entityId: c.id,
    after: { confidentialityTier: c.confidentialityTier }, ip: meta.ip, userAgent: meta.userAgent,
  });

  // pastors-tier notes require the owner role; everyone else gets an empty set
  const notesVisible = c.confidentialityTier !== "pastors" || user.roleKeys.includes("owner");
  const notes = notesVisible ? c.notes : [];
  if (notesVisible && c.confidentialityTier === "pastors") {
    await audit({
      orgId: user.orgId, actor: user, action: "care.note.read", entityType: "care_case", entityId: c.id,
      after: { notes: notes.length }, ip: meta.ip, userAgent: meta.userAgent,
    });
  }

  const person = (await personMap([c.personId])).get(c.personId);
  return {
    case: { ...toCaseDTO(c, person), ...(c.isSafeguarding ? { safeguardingBanner: SAFEGUARDING_BANNER } : {}) },
    notes: notes.map((n) => ({
      id: n.id, authorName: n.authorName, kind: n.kind, body: n.body, visibility: n.visibility, occurredAt: n.occurredAt,
    })),
    notesVisible,
    timeline: (notesVisible ? c.notes : []).map((n) => ({
      at: n.occurredAt,
      kind: n.kind,
      authorName: n.authorName,
      summary: n.body.length > 100 ? `${n.body.slice(0, 100)}…` : n.body,
    })),
  };
}

export async function addNote(user: SessionUser, caseId: string, input: any, meta: { ip?: string; userAgent?: string }) {
  const c = await db.careCase.findFirst({ where: { id: caseId, orgId: user.orgId } });
  if (!c) throw notFound("Case not found.");
  const vis = careVisibility(user.roleKeys);
  if (!vis.tiers.includes(c.confidentialityTier) || (c.isSafeguarding && !vis.safeguarding)) throw notFound("Case not found.");
  if (!input?.body?.trim()) throw badRequest("Note body is required.");
  const note = await db.careNote.create({
    data: {
      orgId: user.orgId,
      careCaseId: c.id,
      authorName: input.authorName || user.name,
      authorMembershipId: user.membershipId,
      kind: input.kind || "note",
      body: input.body.trim(),
      visibility: input.visibility || c.confidentialityTier,
    },
  });
  await audit({
    orgId: user.orgId, actor: user, action: "care.note.create", entityType: "care_case", entityId: c.id,
    after: { noteId: note.id, kind: note.kind, visibility: note.visibility }, ip: meta.ip, userAgent: meta.userAgent,
  });
  return { id: note.id, authorName: note.authorName, kind: note.kind, body: note.body, visibility: note.visibility, occurredAt: note.occurredAt };
}

export async function closeCase(user: SessionUser, caseId: string, closeReason: string, meta: { ip?: string; userAgent?: string }) {
  if (!closeReason?.trim()) throw badRequest("A close reason is required.");
  const c = await db.careCase.findFirst({ where: { id: caseId, orgId: user.orgId } });
  if (!c) throw notFound("Case not found.");
  if (c.status === "closed") throw badRequest("Case is already closed.");
  // cases are never deletable — closing is the only exit
  await db.careCase.update({
    where: { id: c.id },
    data: { status: "closed", stage: "closed", closeReason: closeReason.trim(), closedAt: new Date() },
  });
  await audit({
    orgId: user.orgId, actor: user, action: "care.case.close", entityType: "care_case", entityId: c.id,
    before: { status: c.status }, after: { status: "closed", closeReason }, ip: meta.ip, userAgent: meta.userAgent,
  });
  return { ok: true };
}

// ── prayer requests ──────────────────────────────────────────────────────────

export async function listPrayerRequests(user: SessionUser) {
  const isPrivileged = user.roleKeys.includes("owner") || user.roleKeys.includes("campus_admin");
  const requests = await db.prayerRequest.findMany({
    where: {
      orgId: user.orgId,
      ...(isPrivileged
        ? {}
        : { OR: [{ audience: { in: ["staff", "church"] } }, ...(user.personId ? [{ personId: user.personId }] : [])] }),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const people = await personMap([...new Set(requests.map((r) => r.personId).filter(Boolean) as string[])]);
  return {
    items: requests.map((r) => {
      const p = r.personId ? people.get(r.personId) : null;
      return {
        id: r.id,
        person: r.isAnonymous || !p ? null : { id: p.id, name: `${p.firstName} ${p.lastName}` },
        audience: r.audience,
        status: r.status,
        isAnonymous: r.isAnonymous,
        expiresAt: r.expiresAt,
        createdAt: r.createdAt,
        body: r.body,
      };
    }),
  };
}

export async function createPrayerRequest(user: SessionUser, input: any, meta: { ip?: string; userAgent?: string }) {
  const personId = input?.personId || user.personId;
  if (!input?.body?.trim()) throw badRequest("Prayer request body is required.");
  const audience = input.audience || "staff";
  if (!["private", "group", "staff", "church"].includes(audience)) throw badRequest("Unknown prayer audience.");
  if (personId) {
    const person = await db.person.findFirst({ where: { id: personId, orgId: user.orgId, deletedAt: null } });
    if (!person) throw notFound("Person not found.");
  }
  await db.prayerRequest.create({
    data: {
      orgId: user.orgId,
      personId: personId || null,
      body: input.body.trim(),
      audience,
      isAnonymous: !!input.isAnonymous,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
    },
  });
  await audit({
    orgId: user.orgId, actor: user, action: "prayer.create", entityType: "prayer_request",
    after: { audience, isAnonymous: !!input.isAnonymous }, ip: meta.ip, userAgent: meta.userAgent,
  });
  return { ok: true };
}

export async function approvePrayerRequest(user: SessionUser, id: string, action: string, meta: { ip?: string; userAgent?: string }) {
  const r = await db.prayerRequest.findFirst({ where: { id, orgId: user.orgId } });
  if (!r) throw notFound("Prayer request not found.");
  if (action === "approve") {
    await db.prayerRequest.update({
      where: { id: r.id },
      data: { status: "approved", approvedByName: user.name },
    });
  } else if (action === "reject") {
    await db.prayerRequest.update({ where: { id: r.id }, data: { status: "expired", approvedByName: user.name } });
  } else {
    throw badRequest('action must be "approve" or "reject".');
  }
  await audit({
    orgId: user.orgId, actor: user, action: "prayer.approve", entityType: "prayer_request", entityId: r.id,
    before: { status: r.status }, after: { action }, ip: meta.ip, userAgent: meta.userAgent,
  });
  return { ok: true };
}
