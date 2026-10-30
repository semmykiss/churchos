import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { badRequest, notFound, forbidden, conflict, ApiError, unauthorized } from "@/server/http";
import { can, type SessionUser } from "@/server/permissions";
import { pushNotifications, userIdsForPersons } from "@/server/services/notifications";
import { randomBytes } from "crypto";

/**
 * Volunteer scheduling service (backend only — no HTTP, no React).
 * Business rules honored:
 *  • blockout dates block assignment creation (403 with details.code = "blockout")
 *  • accept/decline works tokenized (PUBLIC sms link) or via schedule.respond
 *  • swaps re-validate clearance on the swap-in volunteer (safeguarding roles:
 *    minAge + no overlapping blockout) before the person is placed
 *  • reliability = served / (served + no_show)
 */

const CONFIRMED_STATUSES = ["accepted", "confirmed", "served"];
const DAY_MS = 86400000;

export function newResponseToken(): string {
  return "tok_" + randomBytes(12).toString("hex");
}

function nameOf(p?: { firstName: string; lastName: string } | null): string {
  return p ? `${p.firstName} ${p.lastName}` : "Unknown";
}

function ageOn(birthdate: Date | null, at: Date): number | null {
  if (!birthdate) return null;
  let a = at.getUTCFullYear() - birthdate.getUTCFullYear();
  const m = at.getUTCMonth() - birthdate.getUTCMonth();
  if (m < 0 || (m === 0 && at.getUTCDate() < birthdate.getUTCDate())) a--;
  return a;
}

/** Does a blockout overlap the event window? */
function overlapsBlockout(b: { startsOn: Date; endsOn: Date }, eventStartsAt: Date, eventEndsAt: Date): boolean {
  return b.startsOn.getTime() <= eventEndsAt.getTime() && b.endsOn.getTime() >= eventStartsAt.getTime();
}

async function assertNoBlockout(orgId: string, personId: string, eventStartsAt: Date, eventEndsAt: Date) {
  const blockouts = await db.blockoutDate.findMany({ where: { orgId, personId } });
  if (blockouts.some((b) => overlapsBlockout(b, eventStartsAt, eventEndsAt))) {
    // forbidden + machine-readable details flag (contract: "403 if person has blockout — details flag")
    throw new ApiError(403, "forbidden", "That volunteer is unavailable (blockout).", { code: "blockout" });
  }
}

// ── roles ────────────────────────────────────────────────────────────────────

export async function listVolunteerRoles(user: SessionUser) {
  const roles = await db.volunteerRole.findMany({
    where: { orgId: user.orgId },
    orderBy: [{ team: "asc" }, { name: "asc" }],
  });
  return {
    items: roles.map((r) => ({
      id: r.id, name: r.name, team: r.team, description: r.description,
      requiresBackgroundCheck: r.requiresBackgroundCheck, minAge: r.minAge,
      clearanceRequired: r.clearanceRequired, isActive: r.isActive,
    })),
  };
}

export async function createVolunteerRole(user: SessionUser, input: any, meta: { ip?: string; userAgent?: string }) {
  if (!input?.name?.trim()) throw badRequest("Role name is required.");
  const campusId = input.campusId || user.campusId || (await db.campus.findFirst({ where: { orgId: user.orgId }, select: { id: true } }))?.id;
  if (!campusId) throw badRequest("No campus available for this organization.");
  const role = await db.volunteerRole.create({
    data: {
      orgId: user.orgId,
      campusId,
      name: input.name.trim(),
      team: input.team || undefined,
      description: input.description || undefined,
      requiresBackgroundCheck: !!input.requiresBackgroundCheck,
      minAge: input.minAge ?? undefined,
      clearanceRequired: input.clearanceRequired || undefined,
    },
  });
  await audit({
    orgId: user.orgId, actor: user, action: "schedule.role_create", entityType: "volunteer_role", entityId: role.id,
    after: { name: role.name }, ip: meta.ip, userAgent: meta.userAgent,
  });
  return { id: role.id, name: role.name };
}

// ── plans ────────────────────────────────────────────────────────────────────

function parseDay(s?: string | null): Date | undefined {
  if (!s) return undefined;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00.000Z` : s);
  return isNaN(d.getTime()) ? undefined : d;
}

export async function listPlans(user: SessionUser, q: { from?: string; to?: string }) {
  const now = new Date();
  const from = parseDay(q.from) ?? new Date(now.getFullYear(), now.getMonth(), 1);
  const to = parseDay(q.to) ?? new Date(from.getTime() + 56 * DAY_MS);
  const events = await db.event.findMany({
    where: { orgId: user.orgId, kind: { in: ["service", "one_off"] }, startsAt: { gte: from, lte: to } },
    orderBy: { startsAt: "asc" },
    include: { assignments: { include: { role: true } } },
  });
  const personIds = [...new Set(events.flatMap((e) => e.assignments.map((a) => a.personId)))];
  const people = personIds.length ? await db.person.findMany({ where: { id: { in: personIds } } }) : [];
  const pMap = new Map(people.map((p) => [p.id, p] as const));

  return {
    items: events.map((e) => {
      const positions = e.assignments.map((a) => ({
        roleId: a.volunteerRoleId,
        roleName: a.role.name,
        person: { id: a.personId, name: nameOf(pMap.get(a.personId)) },
        status: a.status,
        callTime: a.callTime,
      }));
      const total = positions.length;
      const filled = positions.filter((p) => CONFIRMED_STATUSES.includes(p.status)).length;
      const needsAttention =
        positions.some((p) => p.status === "asked") && e.startsAt.getTime() <= now.getTime() + 7 * DAY_MS;
      return {
        eventId: e.id,
        eventName: e.name,
        startsAt: e.startsAt,
        positions,
        fillRate: total ? Math.round((filled / total) * 100) : 0,
        needsAttention,
      };
    }),
  };
}

// ── assignments ──────────────────────────────────────────────────────────────

export async function createAssignment(user: SessionUser, input: any, meta: { ip?: string; userAgent?: string }) {
  const { roleId, personId, eventId } = input ?? {};
  if (!roleId || !personId || !eventId) throw badRequest("roleId, personId and eventId are required.");
  const [role, event] = await Promise.all([
    db.volunteerRole.findFirst({ where: { id: roleId, orgId: user.orgId } }),
    db.event.findFirst({ where: { id: eventId, orgId: user.orgId } }),
  ]);
  if (!role) throw notFound("Volunteer role not found.");
  if (!event) throw notFound("Event not found.");

  await assertNoBlockout(user.orgId, personId, event.startsAt, event.endsAt ?? event.startsAt);

  let assignment;
  try {
    assignment = await db.assignment.create({
      data: {
        orgId: user.orgId,
        volunteerRoleId: roleId,
        personId,
        eventId,
        startsAt: event.startsAt,
        endsAt: event.endsAt ?? undefined,
        status: "asked",
        responseToken: newResponseToken(),
        callTime: input.callTime || undefined,
      },
    });
  } catch (err: any) {
    if (err?.code === "P2002") throw conflict("That person is already assigned to this role for the event.");
    throw err;
  }
  await audit({
    orgId: user.orgId, actor: user, action: "schedule.assign", entityType: "assignment", entityId: assignment.id,
    after: { roleId, personId, eventId, status: "asked" }, ip: meta.ip, userAgent: meta.userAgent,
  });

  // bell notification for the assigned volunteer (if they have a login)
  try {
    const userIds = await userIdsForPersons(user.orgId, [personId]);
    if (userIds.length) {
      const when = new Date(assignment.startsAt).toLocaleDateString("en-US", {
        month: "short", day: "numeric",
      });
      await pushNotifications({
        orgId: user.orgId,
        userIds,
        module: "volunteers",
        type: "schedule.assigned",
        title: `New volunteer assignment: ${role.name}`,
        body: `${event.name} — ${when}. Open Volunteers to respond.`,
        entityType: "assignment",
        entityId: assignment.id,
        linkModule: "volunteers",
      });
    }
  } catch {
    // notifications are best-effort
  }

  return {
    id: assignment.id,
    roleName: role.name,
    person: { id: personId, name: nameOf((await db.person.findUnique({ where: { id: personId } })) ?? null) },
    eventId,
    eventName: event.name,
    startsAt: assignment.startsAt,
    status: assignment.status,
    callTime: assignment.callTime,
    responseToken: assignment.responseToken,
  };
}

function toAssignmentDTO(a: any, roleName: string, personName: string, eventName: string) {
  return {
    id: a.id,
    roleName,
    person: { id: a.personId, name: personName },
    eventId: a.eventId,
    eventName,
    startsAt: a.startsAt,
    status: a.status,
    callTime: a.callTime,
    responseToken: a.responseToken,
  };
}

export async function deleteAssignment(user: SessionUser, id: string, meta: { ip?: string; userAgent?: string }) {
  const assignment = await db.assignment.findFirst({ where: { id, orgId: user.orgId } });
  if (!assignment) throw notFound("Assignment not found.");
  await db.assignment.delete({ where: { id } });
  await audit({
    orgId: user.orgId, actor: user, action: "schedule.unassign", entityType: "assignment", entityId: id,
    before: { personId: assignment.personId, status: assignment.status }, ip: meta.ip, userAgent: meta.userAgent,
  });
  return { ok: true };
}

/**
 * Accept/decline. With a token → PUBLIC sms-link path (no session).
 * Without a token → requires schedule.respond permission.
 */
export async function respondToAssignment(
  user: SessionUser | null,
  assignmentId: string,
  input: { token?: string; action?: string },
  meta: { ip?: string; userAgent?: string },
) {
  const assignment = await db.assignment.findFirst({ where: { id: assignmentId, orgId: user?.orgId ?? undefined } });
  if (!assignment) throw notFound("Assignment not found.");

  const viaToken = !!input.token;
  let respondedVia: string;
  if (viaToken) {
    if (input.token !== assignment.responseToken) throw forbidden("Invalid or expired response token.");
    respondedVia = "sms_link";
  } else {
    if (!user) throw unauthorized("Sign in required.");
    if (!can(user, "schedule.respond")) throw forbidden('Requires "schedule.respond" permission.');
    respondedVia = "portal";
  }

  const status = input.action === "accept" ? "accepted" : input.action === "decline" ? "declined" : null;
  if (!status) throw badRequest('action must be "accept" or "decline".');

  await db.assignment.update({
    where: { id: assignment.id },
    data: { status, respondedAt: new Date(), respondedVia },
  });
  await audit({
    orgId: assignment.orgId,
    actor: user,
    actorType: user ? "user" : "system",
    action: "schedule.respond",
    entityType: "assignment",
    entityId: assignment.id,
    after: { status, respondedVia: viaToken ? "sms_link" : "portal" },
    ip: meta.ip, userAgent: meta.userAgent,
  });
  return { ok: true };
}

export async function markNoShow(user: SessionUser, id: string, meta: { ip?: string; userAgent?: string }) {
  const assignment = await db.assignment.findFirst({ where: { id, orgId: user.orgId } });
  if (!assignment) throw notFound("Assignment not found.");
  await db.assignment.update({ where: { id }, data: { status: "no_show" } });
  await audit({
    orgId: user.orgId, actor: user, action: "schedule.no_show", entityType: "assignment", entityId: id,
    before: { status: assignment.status }, after: { status: "no_show" }, ip: meta.ip, userAgent: meta.userAgent,
  });
  return { ok: true };
}

// ── swaps ────────────────────────────────────────────────────────────────────

export async function requestSwap(user: SessionUser, assignmentId: string, input: { token?: string; withPersonId?: string }, meta: { ip?: string; userAgent?: string }) {
  const assignment = await db.assignment.findFirst({ where: { id: assignmentId, orgId: user.orgId } });
  if (!assignment) throw notFound("Assignment not found.");
  if (input.token && input.token !== assignment.responseToken) throw forbidden("Invalid response token.");
  if (!input.withPersonId) throw badRequest("withPersonId is required.");
  if (input.withPersonId === assignment.personId) throw badRequest("You cannot swap with yourself.");
  const incoming = await db.person.findFirst({ where: { id: input.withPersonId, orgId: user.orgId, deletedAt: null } });
  if (!incoming) throw notFound("Swap-in person not found.");
  if (assignment.swapStatus === "requested") throw conflict("A swap is already pending on this assignment.");

  await db.assignment.update({
    where: { id: assignment.id },
    data: { swapRequestedWithPersonId: input.withPersonId, swapStatus: "requested" },
  });
  await audit({
    orgId: user.orgId, actor: user, action: "schedule.swap_request", entityType: "assignment", entityId: assignment.id,
    after: { requestedWith: input.withPersonId }, ip: meta.ip, userAgent: meta.userAgent,
  });
  return { ok: true };
}

export async function listSwaps(user: SessionUser) {
  const swaps = await db.assignment.findMany({
    where: { orgId: user.orgId, swapStatus: { not: null } },
    orderBy: { startsAt: "asc" },
    include: { role: true, event: true },
    take: 100,
  });
  const personIds = [...new Set(swaps.flatMap((s) => [s.personId, s.swapRequestedWithPersonId].filter(Boolean) as string[]))];
  const people = personIds.length ? await db.person.findMany({ where: { id: { in: personIds } } }) : [];
  const pMap = new Map(people.map((p) => [p.id, p] as const));
  return {
    items: swaps.map((s) => ({
      id: s.id,
      assignment: {
        id: s.id,
        roleName: s.role.name,
        startsAt: s.startsAt,
        eventName: s.event.name,
        person: { id: s.personId, name: nameOf(pMap.get(s.personId)) },
      },
      requestedWith: { id: s.swapRequestedWithPersonId, name: nameOf(s.swapRequestedWithPersonId ? pMap.get(s.swapRequestedWithPersonId) : null) },
      status: s.swapStatus,
    })),
  };
}

export async function approveSwap(user: SessionUser, assignmentId: string, action: string, meta: { ip?: string; userAgent?: string }) {
  const assignment = await db.assignment.findFirst({
    where: { id: assignmentId, orgId: user.orgId },
    include: { role: true, event: true },
  });
  if (!assignment) throw notFound("Assignment not found.");
  if (!assignment.swapRequestedWithPersonId || assignment.swapStatus !== "requested") {
    throw badRequest("No pending swap request on this assignment.");
  }

  if (action === "reject") {
    await db.assignment.update({ where: { id: assignment.id }, data: { swapStatus: "rejected" } });
    await audit({
      orgId: user.orgId, actor: user, action: "schedule.swap", entityType: "assignment", entityId: assignment.id,
      after: { swapStatus: "rejected" }, ip: meta.ip, userAgent: meta.userAgent,
    });
    return { ok: true };
  }
  if (action !== "approve") throw badRequest('action must be "approve" or "reject".');

  const incoming = await db.person.findFirst({ where: { id: assignment.swapRequestedWithPersonId, orgId: user.orgId } });
  if (!incoming) throw notFound("Swap-in person not found.");

  // CRITICAL RULE: re-validate clearance on the swap-in volunteer
  if (assignment.role.clearanceRequired === "safeguarding") {
    const age = ageOn(incoming.birthdate, assignment.event.startsAt);
    const tooYoung = assignment.role.minAge != null && (age == null || age < assignment.role.minAge);
    const blockouts = await db.blockoutDate.findMany({ where: { orgId: user.orgId, personId: incoming.id } });
    const blocked = blockouts.some((b) => overlapsBlockout(b, assignment.event.startsAt, assignment.event.endsAt ?? assignment.event.startsAt));
    if (tooYoung || blocked) throw forbidden("Swap-in volunteer lacks required clearance.");
  }

  const updated = await db.assignment.update({
    where: { id: assignment.id },
    data: {
      personId: incoming.id,
      status: "accepted",
      swapStatus: "approved",
      responseToken: newResponseToken(),
      respondedAt: new Date(),
      respondedVia: "admin",
    },
  });
  await audit({
    orgId: user.orgId, actor: user, action: "schedule.swap", entityType: "assignment", entityId: assignment.id,
    before: { personId: assignment.personId },
    after: { personId: incoming.id, swapStatus: "approved", clearance: assignment.role.clearanceRequired ?? null },
    ip: meta.ip, userAgent: meta.userAgent,
  });
  return toAssignmentDTO(updated, assignment.role.name, nameOf(incoming), assignment.event.name);
}

// ── blockouts ────────────────────────────────────────────────────────────────

export async function listBlockouts(user: SessionUser, personId?: string) {
  const blockouts = await db.blockoutDate.findMany({
    where: { orgId: user.orgId, ...(personId ? { personId } : {}) },
    orderBy: { startsOn: "asc" },
  });
  const personIds = [...new Set(blockouts.map((b) => b.personId))];
  const people = personIds.length ? await db.person.findMany({ where: { id: { in: personIds } } }) : [];
  const pMap = new Map(people.map((p) => [p.id, p] as const));
  return {
    items: blockouts.map((b) => ({
      id: b.id,
      personId: b.personId,
      name: nameOf(pMap.get(b.personId)),
      startsOn: b.startsOn,
      endsOn: b.endsOn,
      reason: b.reason,
    })),
  };
}

export async function createBlockout(user: SessionUser, input: any, meta: { ip?: string; userAgent?: string }) {
  const personId = input?.personId || user.personId;
  if (!personId) throw badRequest("personId is required.");
  if (!input?.startsOn || !input?.endsOn) throw badRequest("startsOn and endsOn are required.");
  const startsOn = new Date(/^\d{4}-\d{2}-\d{2}$/.test(input.startsOn) ? `${input.startsOn}T00:00:00.000Z` : input.startsOn);
  const endsOn = new Date(/^\d{4}-\d{2}-\d{2}$/.test(input.endsOn) ? `${input.endsOn}T23:59:59.999Z` : input.endsOn);
  if (isNaN(startsOn.getTime()) || isNaN(endsOn.getTime())) throw badRequest("Invalid blockout dates.");
  await db.blockoutDate.create({ data: { orgId: user.orgId, personId, startsOn, endsOn, reason: input.reason || undefined } });
  await audit({
    orgId: user.orgId, actor: user, action: "schedule.blockout", entityType: "blockout", entityId: personId,
    after: { startsOn, endsOn, reason: input.reason ?? null }, ip: meta.ip, userAgent: meta.userAgent,
  });
  return { ok: true };
}

// ── health ───────────────────────────────────────────────────────────────────

async function healthRows(orgId: string) {
  const since = new Date(Date.now() - 90 * DAY_MS);
  const assignments = await db.assignment.findMany({
    where: { orgId, startsAt: { gte: since } },
    select: { personId: true, status: true },
  });
  const agg: Record<string, { served: number; declined: number; noShows: number }> = {};
  for (const a of assignments) {
    agg[a.personId] ??= { served: 0, declined: 0, noShows: 0 };
    if (a.status === "served") agg[a.personId].served += 1;
    if (a.status === "declined") agg[a.personId].declined += 1;
    if (a.status === "no_show") agg[a.personId].noShows += 1;
  }
  const personIds = Object.keys(agg);
  const people = personIds.length ? await db.person.findMany({ where: { id: { in: personIds } } }) : [];
  const pMap = new Map(people.map((p) => [p.id, p] as const));
  return personIds.map((personId) => {
    const s = agg[personId];
    const denom = s.served + s.noShows;
    return {
      personId,
      name: nameOf(pMap.get(personId)),
      servedLast90: s.served,
      declined: s.declined,
      noShows: s.noShows,
      reliability: denom ? Math.round((s.served / denom) * 100) : 100,
    };
  });
}

export async function volunteerHealth(user: SessionUser) {
  const rows = await healthRows(user.orgId);
  return { items: rows.sort((a, b) => a.name.localeCompare(b.name)) };
}

/** Shared computation for reports/volunteers. */
export async function healthStats(orgId: string) {
  return healthRows(orgId);
}
