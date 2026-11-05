import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { badRequest, notFound } from "@/server/http";
import type { SessionUser } from "@/server/permissions";
import { doorCheckinsFor } from "./event-registration";

/**
 * Events & services service (backend only — no HTTP, per-occurrence events).
 * Business rules honored:
 *  • tenant isolation: every query filters orgId
 *  • headcount = attendance rows with status present | late | checked_in | checked_out
 *    (computed with one groupBy per list, not N queries)
 *  • manual attendance corrections are attributed (correctedByName/Reason) + audited
 */

const HEADCOUNT_STATUSES = ["present", "late", "checked_in", "checked_out"];
const ATTENDANCE_METHODS = ["roster", "manual", "headcount"];

export interface Meta {
  ip?: string;
  userAgent?: string;
}

export interface EventListQuery {
  from?: string;
  to?: string;
  kind?: string;
  search?: string;
  serviceId?: string;
}

export interface CreateEventInput {
  name: string;
  kind?: string;
  campusId?: string;
  serviceId?: string;
  groupId?: string;
  startsAt: string;
  endsAt: string;
  roomText?: string;
  capacity?: number;
  checkinEnabled?: boolean;
}

function toEventDTO(e: any, headcount: number) {
  return {
    id: e.id,
    name: e.name,
    kind: e.kind,
    campusId: e.campusId,
    serviceId: e.serviceId,
    groupId: e.groupId,
    startsAt: e.startsAt,
    endsAt: e.endsAt,
    roomText: e.roomText,
    capacity: e.capacity,
    checkinEnabled: e.checkinEnabled,
    status: e.status,
    headcount,
  };
}

async function headcountsFor(orgId: string, eventIds: string[]): Promise<Map<string, number>> {
  if (!eventIds.length) return new Map();
  const grouped = await db.attendanceRecord.groupBy({
    by: ["eventId"],
    where: { orgId, eventId: { in: eventIds }, status: { in: HEADCOUNT_STATUSES } },
    _count: { _all: true },
  });
  return new Map(grouped.map((g) => [g.eventId, g._count._all]));
}

export async function listEvents(user: SessionUser, q: EventListQuery) {
  const now = Date.now();
  const from = q.from ? new Date(q.from) : new Date(now - 30 * 24 * 3600 * 1000);
  const to = q.to ? new Date(q.to) : new Date(now + 60 * 24 * 3600 * 1000);
  if (isNaN(from.getTime())) throw badRequest("from must be a valid ISO date.");
  if (isNaN(to.getTime())) throw badRequest("to must be a valid ISO date.");

  const where: any = { orgId: user.orgId, startsAt: { gte: from, lte: to } };
  if (q.kind) where.kind = q.kind;
  if (q.serviceId) where.serviceId = q.serviceId;
  if (q.search) where.name = { contains: q.search.trim().toLowerCase() };

  const rows = await db.event.findMany({ where, orderBy: { startsAt: "asc" }, take: 500 });
  const headcounts = await headcountsFor(user.orgId, rows.map((r) => r.id));

  return { items: rows.map((e) => toEventDTO(e, headcounts.get(e.id) ?? 0)) };
}

export async function createEvent(user: SessionUser, input: CreateEventInput, meta?: Meta) {
  if (!input?.name?.trim()) throw badRequest("Event name is required.");
  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(input.endsAt);
  if (isNaN(startsAt.getTime())) throw badRequest("startsAt must be a valid ISO datetime.");
  if (isNaN(endsAt.getTime())) throw badRequest("endsAt must be a valid ISO datetime.");
  if (endsAt <= startsAt) throw badRequest("endsAt must be after startsAt.");
  const campusId = input.campusId || user.campusId;
  if (!campusId) throw badRequest("campusId is required.");

  const event = await db.event.create({
    data: {
      orgId: user.orgId,
      name: input.name.trim(),
      kind: input.kind || "service",
      campusId,
      serviceId: input.serviceId || undefined,
      groupId: input.groupId || undefined,
      startsAt,
      endsAt,
      roomText: input.roomText || undefined,
      capacity: input.capacity ?? undefined,
      checkinEnabled: input.checkinEnabled ?? false,
      status: "scheduled",
      createdByName: user.name,
    },
  });
  await audit({
    orgId: user.orgId, actor: user, action: "event.create",
    entityType: "event", entityId: event.id,
    after: { name: event.name, kind: event.kind, startsAt, endsAt },
    ip: meta?.ip, userAgent: meta?.userAgent,
  });
  return toEventDTO(event, 0);
}

export async function getEventDetail(user: SessionUser, eventId: string) {
  const event = await db.event.findFirst({ where: { id: eventId, orgId: user.orgId } });
  if (!event) throw notFound("Event not found.");

  const records = await db.attendanceRecord.findMany({
    where: { orgId: user.orgId, eventId },
    orderBy: { checkedInAt: "asc" },
  });
  const personIds = [...new Set(records.map((r) => r.personId))];
  const people = personIds.length
    ? await db.person.findMany({
        where: { id: { in: personIds } },
        select: { id: true, firstName: true, lastName: true },
      })
    : [];
  const peopleMap = new Map(people.map((p) => [p.id, `${p.firstName} ${p.lastName}`]));

  const attendance = records
    .map((r) => ({
      personId: r.personId,
      name: peopleMap.get(r.personId) ?? r.personId,
      status: r.status,
      checkedInAt: r.checkedInAt,
      firstTime: r.firstTime,
      isVolunteer: r.isVolunteer,
      roomText: r.roomText,
      method: r.method,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const headcount = records.filter((r) => HEADCOUNT_STATUSES.includes(r.status)).length;

  const assignmentRows = await db.assignment.findMany({
    where: { orgId: user.orgId, eventId },
    include: { role: { select: { name: true } } },
    orderBy: { startsAt: "asc" },
  });
  const assigneeIds = [...new Set(assignmentRows.map((a) => a.personId))];
  const assignees = assigneeIds.length
    ? await db.person.findMany({
        where: { id: { in: assigneeIds } },
        select: { id: true, firstName: true, lastName: true },
      })
    : [];
  const assigneeMap = new Map(assignees.map((p) => [p.id, `${p.firstName} ${p.lastName}`]));

  const assignments = assignmentRows.map((a) => ({
    personId: a.personId,
    name: assigneeMap.get(a.personId) ?? a.personId,
    roleName: a.role.name,
    status: a.status,
  }));

  return { event: toEventDTO(event, headcount), attendance, headcount, assignments, doorCheckins: await doorCheckinsFor(user.orgId, eventId) };
}

export async function cancelEvent(user: SessionUser, eventId: string, reason?: string, meta?: Meta) {
  const before = await db.event.findFirst({ where: { id: eventId, orgId: user.orgId } });
  if (!before) throw notFound("Event not found.");
  await db.event.update({ where: { id: eventId }, data: { status: "cancelled", canceledReason: reason ?? null } });
  await audit({
    orgId: user.orgId, actor: user, action: "event.cancel",
    entityType: "event", entityId: eventId,
    before: { status: before.status },
    after: { status: "cancelled", reason: reason ?? null },
    ip: meta?.ip, userAgent: meta?.userAgent,
  });
  return { ok: true };
}

export async function saveEventAttendance(
  user: SessionUser,
  eventId: string,
  records: { personId: string; status: string }[],
  method?: string,
  reason?: string,
  meta?: Meta
) {
  const event = await db.event.findFirst({ where: { id: eventId, orgId: user.orgId } });
  if (!event) throw notFound("Event not found.");
  if (!Array.isArray(records) || records.length === 0) throw badRequest("records is required.");
  const m = method && ATTENDANCE_METHODS.includes(method) ? method : "roster";

  const now = new Date();
  let saved = 0;
  for (const rec of records) {
    if (!rec?.personId || !rec?.status) continue;
    const data: any = { status: String(rec.status), method: m };
    if (rec.status === "present") data.checkedInAt = now;
    if (m === "manual") {
      data.correctedByName = user.name;
      data.correctedReason = reason ?? null;
    }
    await db.attendanceRecord.upsert({
      where: { personId_eventId: { personId: rec.personId, eventId } },
      create: { orgId: user.orgId, personId: rec.personId, eventId, ...data },
      update: data,
    });
    saved++;
  }

  if (m === "manual") {
    await audit({
      orgId: user.orgId, actor: user, action: "attendance.corrected",
      entityType: "event", entityId: eventId,
      after: { saved, reason: reason ?? null, records: records.length },
      ip: meta?.ip, userAgent: meta?.userAgent,
    });
  }
  return { saved };
}

export async function listServices(user: SessionUser) {
  const rows = await db.service.findMany({
    where: { orgId: user.orgId, isActive: true },
    orderBy: [{ byDay: "asc" }, { timeOfDay: "asc" }],
  });
  return {
    items: rows.map((s) => ({
      id: s.id,
      name: s.name,
      timeOfDay: s.timeOfDay,
      byDay: s.byDay,
      durationMinutes: s.durationMinutes,
      checkinEnabled: s.checkinEnabled,
    })),
  };
}
