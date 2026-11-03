import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { badRequest, conflict, forbidden, notFound } from "@/server/http";
import type { SessionUser } from "@/server/permissions";

/**
 * Groups service (backend only — no HTTP, no React).
 * Business rules honored:
 *  • tenant isolation: every query filters orgId
 *  • self-service ceiling: users whose ONLY roles are member/parent can list
 *    and open ONLY groups they belong to (or lead) — enforced here regardless
 *    of what the access matrix grants, so the directory never leaks to members
 *  • ministry_leader scope: leaders may only view/manage groups they lead or belong to
 *    (owner / campus_admin bypass)
 *  • group attendance rows are immutable-ish upserts keyed (personId, eventId)
 *  • attendanceRate = avg present/memberCount over the last 6 meetings
 *  • absentees = active members absent 3+ consecutive meetings
 */

const HEADCOUNT_STATUSES = ["present", "late", "checked_in", "checked_out"];
const MAX_MEETINGS = 6;
const ABSENCE_THRESHOLD = 3;

export interface Meta {
  ip?: string;
  userAgent?: string;
}

export interface GroupListQuery {
  search?: string;
  type?: string;
  leaderPersonId?: string;
  mine?: boolean;
}

export interface CreateGroupInput {
  name: string;
  type?: string;
  campusId?: string;
  leaderPersonId?: string;
  meetingDay?: string;
  meetingTime?: string;
  locationText?: string;
  capacity?: number;
  description?: string;
  isOpen?: boolean;
  isConfidential?: boolean;
}

function toGroupDTO(g: any, leaderName: string | null, memberCount: number) {
  return {
    id: g.id,
    name: g.name,
    type: g.type,
    campusId: g.campusId,
    leaderPersonId: g.leaderPersonId,
    leaderName: leaderName ?? null,
    meetingDay: g.meetingDay,
    meetingTime: g.meetingTime,
    locationText: g.locationText,
    capacity: g.capacity,
    description: g.description,
    isOpen: g.isOpen,
    isConfidential: g.isConfidential,
    status: g.status,
    memberCount,
  };
}

function personName(p?: { firstName: string; lastName: string } | null): string | null {
  return p ? `${p.firstName} ${p.lastName}` : null;
}

async function leaderNameFor(leaderPersonId: string | null | undefined): Promise<string | null> {
  if (!leaderPersonId) return null;
  const leader = await db.person.findUnique({
    where: { id: leaderPersonId },
    select: { firstName: true, lastName: true },
  });
  return personName(leader);
}

async function memberCountFor(groupId: string): Promise<number> {
  return db.groupMember.count({ where: { groupId, status: "active" } });
}

/** owner / campus_admin bypass; everyone else is scope-checked only for ministry_leader. */
function hasBypass(user: SessionUser): boolean {
  return user.roleKeys.includes("owner") || user.roleKeys.includes("campus_admin");
}

/** Self-service roles — hold ONLY these and group visibility is capped at
 * "groups you belong to (or lead)", no matter what the matrix says. Any
 * additional staff role (volunteer, pastor, …) opts the user out of this
 * ceiling; those roles' own matrices decide what they may browse. */
const SELF_SERVICE_ROLE_KEYS = new Set(["member", "parent"]);
function isSelfServiceMember(user: SessionUser): boolean {
  return user.roleKeys.length > 0 && user.roleKeys.every((k) => SELF_SERVICE_ROLE_KEYS.has(k));
}

/** The "groups I belong to (or lead)" filter applied for self-service members. */
function ownGroupsScope(personId: string) {
  return [
    { leaderPersonId: personId },
    { members: { some: { personId, status: "active" } } },
  ];
}

async function assertGroupAccess(user: SessionUser, group: { id: string; leaderPersonId: string | null }) {
  if (hasBypass(user)) return;
  if (!user.roleKeys.includes("ministry_leader")) return;
  if (user.personId && group.leaderPersonId === user.personId) return;
  if (user.personId) {
    const membership = await db.groupMember.findFirst({
      where: { groupId: group.id, personId: user.personId, status: "active" },
      select: { id: true },
    });
    if (membership) return;
  }
  throw forbidden("You can only manage groups you lead or belong to.");
}

export async function listGroups(user: SessionUser, q: GroupListQuery) {
  const where: any = { orgId: user.orgId, deletedAt: null };
  if (q.type) where.type = q.type;
  if (q.leaderPersonId) where.leaderPersonId = q.leaderPersonId;
  if (q.search) where.name = { contains: q.search.trim().toLowerCase() };

  // Self-service ceiling FIRST: members/parents only ever see their own groups,
  // even if the query asks for the full directory (mine is forced to true).
  if (isSelfServiceMember(user)) {
    if (!user.personId) return { items: [] }; // no linked person → no possible membership
    where.OR = ownGroupsScope(user.personId);
  } else if (q.mine && user.personId) {
    where.OR = ownGroupsScope(user.personId);
  }

  const rows = await db.group.findMany({ where, orderBy: { name: "asc" }, take: 500 });

  const ids = rows.map((r) => r.id);
  const counts = ids.length
    ? await db.groupMember.groupBy({
        by: ["groupId"],
        where: { orgId: user.orgId, groupId: { in: ids }, status: "active" },
        _count: { _all: true },
      })
    : [];
  const countMap = new Map(counts.map((c) => [c.groupId, c._count._all]));

  const leaderIds = [...new Set(rows.map((r) => r.leaderPersonId).filter((v): v is string => !!v))];
  const leaders = leaderIds.length
    ? await db.person.findMany({
        where: { id: { in: leaderIds } },
        select: { id: true, firstName: true, lastName: true },
      })
    : [];
  const leaderMap = new Map(leaders.map((l) => [l.id, personName(l)]));

  return {
    items: rows.map((g) => toGroupDTO(g, leaderMap.get(g.leaderPersonId ?? "") ?? null, countMap.get(g.id) ?? 0)),
  };
}

export async function createGroup(user: SessionUser, input: CreateGroupInput, meta?: Meta) {
  if (!input?.name?.trim()) throw badRequest("Group name is required.");
  const group = await db.group.create({
    data: {
      orgId: user.orgId,
      name: input.name.trim(),
      type: input.type || "small_group",
      campusId: input.campusId || user.campusId || undefined,
      leaderPersonId: input.leaderPersonId || undefined,
      meetingDay: input.meetingDay || undefined,
      meetingTime: input.meetingTime || undefined,
      locationText: input.locationText || undefined,
      capacity: input.capacity ?? undefined,
      description: input.description ?? undefined,
      isOpen: input.isOpen ?? true,
      isConfidential: input.isConfidential ?? false,
    },
  });
  await audit({
    orgId: user.orgId, actor: user, action: "group.create",
    entityType: "group", entityId: group.id,
    after: { name: group.name, type: group.type, leaderPersonId: group.leaderPersonId },
    ip: meta?.ip, userAgent: meta?.userAgent,
  });
  return toGroupDTO(group, await leaderNameFor(group.leaderPersonId), 0);
}

export async function getGroupDetail(user: SessionUser, groupId: string) {
  const group = await db.group.findFirst({ where: { id: groupId, orgId: user.orgId, deletedAt: null } });
  if (!group) throw notFound("Group not found.");

  // Self-service ceiling: members/parents can only open groups they belong to
  // or lead — notFound (not forbidden) so other groups' existence never leaks.
  if (isSelfServiceMember(user)) {
    let belongs = false;
    if (user.personId) {
      if (group.leaderPersonId === user.personId) {
        belongs = true;
      } else {
        const membership = await db.groupMember.findFirst({
          where: { groupId: group.id, personId: user.personId, status: "active" },
          select: { id: true },
        });
        belongs = !!membership;
      }
    }
    if (!belongs) throw notFound("Group not found.");
  }

  await assertGroupAccess(user, group);

  const memberRows = await db.groupMember.findMany({
    where: { groupId, status: "active" },
    orderBy: { joinedAt: "asc" },
  });
  const memberPersonIds = [...new Set(memberRows.map((m) => m.personId))];
  const memberPeople = memberPersonIds.length
    ? await db.person.findMany({
        where: { id: { in: memberPersonIds }, orgId: user.orgId },
        select: { id: true, firstName: true, lastName: true, email: true, phone: true },
      })
    : [];
  const peopleMap = new Map(memberPeople.map((p) => [p.id, p]));

  const members = memberRows.map((m) => {
    const p = peopleMap.get(m.personId);
    return {
      personId: m.personId,
      name: personName(p) ?? m.personId,
      email: p?.email ?? null,
      phone: p?.phone ?? null,
      role: m.role,
      status: m.status,
      joinedAt: m.joinedAt,
    };
  });
  const memberCount = members.length;

  const joinRequestRows = await db.joinRequest.findMany({
    where: { groupId, orgId: user.orgId, status: "pending" },
    orderBy: { createdAt: "asc" },
  });
  const jrPersonIds = [...new Set(joinRequestRows.map((r) => r.personId))];
  const jrPeople = jrPersonIds.length
    ? await db.person.findMany({
        where: { id: { in: jrPersonIds } },
        select: { id: true, firstName: true, lastName: true },
      })
    : [];
  const jrMap = new Map(jrPeople.map((p) => [p.id, personName(p)]));

  const joinRequests = joinRequestRows.map((r) => ({
    id: r.id,
    person: { id: r.personId, name: jrMap.get(r.personId) ?? r.personId },
    message: r.message,
    createdAt: r.createdAt,
  }));

  // last 6 group_meeting events + per-meeting present counts
  const meetingEvents = await db.event.findMany({
    where: { orgId: user.orgId, groupId, kind: "group_meeting" },
    orderBy: { startsAt: "desc" },
    take: MAX_MEETINGS,
  });
  const meetingIds = meetingEvents.map((e) => e.id);
  const attRows = meetingIds.length
    ? await db.attendanceRecord.findMany({
        where: { orgId: user.orgId, eventId: { in: meetingIds } },
        select: { eventId: true, personId: true, status: true },
      })
    : [];
  const presentByMeeting = new Map<string, Map<string, string>>();
  for (const row of attRows) {
    let perMeeting = presentByMeeting.get(row.eventId);
    if (!perMeeting) {
      perMeeting = new Map();
      presentByMeeting.set(row.eventId, perMeeting);
    }
    perMeeting.set(row.personId, row.status);
  }
  const meetingsDesc = meetingEvents.map((e) => ({
    id: e.id,
    startsAt: e.startsAt,
    presentCount: [...(presentByMeeting.get(e.id)?.values() ?? [])].filter((s) => HEADCOUNT_STATUSES.includes(s)).length,
  }));
  const meetings = meetingsDesc; // newest first

  const attendanceRate =
    meetings.length && memberCount > 0
      ? Math.round(
          (meetings.reduce((acc, m) => acc + Math.min(1, m.presentCount / memberCount), 0) / meetings.length) * 100
        ) / 100
      : 0;

  // absentees: active members absent 3+ consecutive (most recent) meetings
  const absentees: { personId: string; name: string; weeksAbsent: number; lastSeen: Date | null }[] = [];
  for (const m of members) {
    let streak = 0;
    let lastSeen: Date | null = null;
    for (const meeting of meetingsDesc) {
      const status = presentByMeeting.get(meeting.id)?.get(m.personId);
      if (status && HEADCOUNT_STATUSES.includes(status)) {
        lastSeen = meeting.startsAt;
        break;
      }
      if (status === "excused") break; // excused absence does not count against the member
      streak++;
    }
    if (streak >= ABSENCE_THRESHOLD) {
      absentees.push({ personId: m.personId, name: m.name, weeksAbsent: streak, lastSeen });
    }
  }
  absentees.sort((a, b) => b.weeksAbsent - a.weeksAbsent);

  return {
    group: toGroupDTO(group, await leaderNameFor(group.leaderPersonId), memberCount),
    members,
    joinRequests,
    attendanceRate,
    absentees,
    meetings,
  };
}

export async function updateGroup(user: SessionUser, groupId: string, input: Partial<CreateGroupInput>, meta?: Meta) {
  const before = await db.group.findFirst({ where: { id: groupId, orgId: user.orgId, deletedAt: null } });
  if (!before) throw notFound("Group not found.");
  await assertGroupAccess(user, before);

  const data: any = {};
  for (const k of ["name", "type", "campusId", "leaderPersonId", "meetingDay", "meetingTime", "locationText", "description", "status"] as const) {
    if ((input as any)[k] !== undefined) data[k] = (input as any)[k];
  }
  if (input?.capacity !== undefined) data.capacity = input.capacity;
  if (input?.isOpen !== undefined) data.isOpen = input.isOpen;
  if (input?.isConfidential !== undefined) data.isConfidential = input.isConfidential;

  const group = await db.group.update({ where: { id: groupId }, data });
  await audit({
    orgId: user.orgId, actor: user, action: "group.update",
    entityType: "group", entityId: groupId,
    before: { name: before.name, type: before.type, status: before.status, leaderPersonId: before.leaderPersonId },
    after: { name: group.name, type: group.type, status: group.status, leaderPersonId: group.leaderPersonId },
    ip: meta?.ip, userAgent: meta?.userAgent,
  });
  return toGroupDTO(group, await leaderNameFor(group.leaderPersonId), await memberCountFor(groupId));
}

export async function addGroupMember(user: SessionUser, groupId: string, personId: string, role?: string, meta?: Meta) {
  const group = await db.group.findFirst({ where: { id: groupId, orgId: user.orgId, deletedAt: null } });
  if (!group) throw notFound("Group not found.");
  const person = await db.person.findFirst({ where: { id: personId, orgId: user.orgId, deletedAt: null } });
  if (!person) throw notFound("Person not found.");

  const member = await db.groupMember.upsert({
    where: { groupId_personId: { groupId, personId } },
    create: { orgId: user.orgId, groupId, personId, role: role || "member", status: "active", joinedAt: new Date() },
    update: { status: "active", leftAt: null, joinedAt: new Date(), ...(role ? { role } : {}) },
  });
  await audit({
    orgId: user.orgId, actor: user, action: "group.member_add",
    entityType: "group", entityId: groupId,
    after: { personId, role: member.role, status: member.status },
    ip: meta?.ip, userAgent: meta?.userAgent,
  });
  return { personId, groupId, role: member.role, status: member.status, joinedAt: member.joinedAt };
}

export async function removeGroupMember(user: SessionUser, groupId: string, personId: string, meta?: Meta) {
  const member = await db.groupMember.findFirst({ where: { groupId, personId, orgId: user.orgId } });
  if (!member) throw notFound("That person is not a member of this group.");
  await db.groupMember.update({ where: { id: member.id }, data: { status: "left", leftAt: new Date() } });
  await audit({
    orgId: user.orgId, actor: user, action: "group.member_remove",
    entityType: "group", entityId: groupId,
    before: { personId, status: member.status },
    after: { personId, status: "left" },
    ip: meta?.ip, userAgent: meta?.userAgent,
  });
  return { ok: true };
}

export async function decideJoinRequest(
  user: SessionUser,
  groupId: string,
  requestId: string,
  action: string,
  meta?: Meta
) {
  if (action !== "approve" && action !== "decline") throw badRequest(`action must be "approve" or "decline".`);
  const group = await db.group.findFirst({ where: { id: groupId, orgId: user.orgId, deletedAt: null } });
  if (!group) throw notFound("Group not found.");
  const request = await db.joinRequest.findFirst({ where: { id: requestId, groupId, orgId: user.orgId } });
  if (!request) throw notFound("Join request not found.");
  if (request.status !== "pending") throw conflict("That join request has already been decided.");

  const status = action === "approve" ? "approved" : "declined";
  await db.joinRequest.update({ where: { id: request.id }, data: { status, decidedAt: new Date() } });
  if (action === "approve") {
    await db.groupMember.upsert({
      where: { groupId_personId: { groupId, personId: request.personId } },
      create: { orgId: user.orgId, groupId, personId: request.personId, role: "member", status: "active" },
      update: { status: "active", leftAt: null },
    });
  }
  await audit({
    orgId: user.orgId, actor: user, action: "group.join_request_decided",
    entityType: "join_request", entityId: request.id,
    after: { action, status, personId: request.personId, groupId },
    ip: meta?.ip, userAgent: meta?.userAgent,
  });
  return { ok: true };
}

export async function saveGroupAttendance(
  user: SessionUser,
  groupId: string,
  eventId: string,
  records: { personId: string; status: string }[],
  meta?: Meta
) {
  const group = await db.group.findFirst({ where: { id: groupId, orgId: user.orgId, deletedAt: null } });
  if (!group) throw notFound("Group not found.");
  await assertGroupAccess(user, group);
  const event = await db.event.findFirst({ where: { id: eventId, orgId: user.orgId, groupId } });
  if (!event) throw notFound("Event not found for this group.");
  if (!Array.isArray(records) || records.length === 0) throw badRequest("records is required.");

  const now = new Date();
  let saved = 0;
  for (const rec of records) {
    if (!rec?.personId || !rec?.status) continue;
    const data: any = { status: String(rec.status), method: "roster" };
    if (rec.status === "present") data.checkedInAt = now;
    await db.attendanceRecord.upsert({
      where: { personId_eventId: { personId: rec.personId, eventId } },
      create: { orgId: user.orgId, personId: rec.personId, eventId, ...data },
      update: data,
    });
    saved++;
  }
  await audit({
    orgId: user.orgId, actor: user, action: "group.attendance_saved",
    entityType: "event", entityId: eventId,
    after: { groupId, saved, submitted: records.length },
    ip: meta?.ip, userAgent: meta?.userAgent,
  });
  return { saved };
}

export async function createGroupMeeting(user: SessionUser, groupId: string, date: string, meta?: Meta) {
  const group = await db.group.findFirst({ where: { id: groupId, orgId: user.orgId, deletedAt: null } });
  if (!group) throw notFound("Group not found.");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw badRequest("date must be a yyyy-mm-dd string.");

  const rawTime = group.meetingTime && /^\d{1,2}:\d{2}/.test(group.meetingTime) ? group.meetingTime : "19:00";
  const [hh, mm] = rawTime.split(":");
  const startsAt = new Date(`${date}T${hh.padStart(2, "0")}:${mm}:00Z`);
  if (isNaN(startsAt.getTime())) throw badRequest("Invalid meeting date/time.");
  const endsAt = new Date(startsAt.getTime() + 90 * 60 * 1000);

  // idempotent: one group_meeting event per group per slot
  const existing = await db.event.findFirst({
    where: { orgId: user.orgId, groupId, name: "Group meeting", startsAt },
    select: { id: true },
  });
  if (existing) return { eventId: existing.id };

  const event = await db.event.create({
    data: {
      orgId: user.orgId,
      campusId: group.campusId || user.campusId || "",
      groupId,
      name: "Group meeting",
      kind: "group_meeting",
      startsAt,
      endsAt,
      status: "scheduled",
      createdByName: user.name,
    },
  });
  await audit({
    orgId: user.orgId, actor: user, action: "group.meeting_created",
    entityType: "event", entityId: event.id,
    after: { groupId, startsAt },
    ip: meta?.ip, userAgent: meta?.userAgent,
  });
  return { eventId: event.id };
}
