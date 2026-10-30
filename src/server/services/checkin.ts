import { randomBytes } from "crypto";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { badRequest, forbidden, notFound } from "@/server/http";
import type { SessionUser } from "@/server/permissions";

/**
 * Check-in service (backend only) — the kiosk differentiator.
 * Business rules honored:
 *  • kiosk principal = CheckinSession token (device); every kiosk query filters by its orgId
 *  • security code: 4-char numeric, per child per occurrence, unique within the room,
 *    reused while the child stays checked in, invalidated by checkout
 *  • room assignment by age: Nursery <2, Preschool 2–5, K–5th 6–11, Students 12–17;
 *    adults cannot check in through the kids kiosk
 *  • first visit: sets person.firstVisitAt, writes StageHistory, fires "first_visit"
 *    workflow once per (person, event) via idempotency key — best effort
 *  • checkout requires the 4-char code OR an authorized-pickup guardian
 */

export interface Meta {
  ip?: string;
  userAgent?: string;
}

/** Structural view of the router's kiosk principal (CheckinSession + included event). */
export interface KioskCtx {
  id: string;
  orgId: string;
  eventId: string;
  name: string;
  requirePickupCode: boolean;
  event: {
    id: string;
    name: string;
    campusId: string;
    startsAt: Date;
    endsAt: Date;
  };
}

const ROOM_ORDER = ["Nursery", "Preschool", "K–5th", "Students"];
const UNASSIGNED = "Unassigned";

export function getRooms(_user?: SessionUser) {
  return {
    items: [
      { name: "Nursery", ageGroups: ["0–24 months"] },
      { name: "Preschool", ageGroups: ["2–5 years"] },
      { name: "K–5th", ageGroups: ["6–11 years"] },
      { name: "Students", ageGroups: ["12–17 years"] },
    ],
  };
}

export function ageOf(person: { birthdate: Date | null }): number | null {
  if (!person.birthdate) return null;
  const b = person.birthdate;
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
  return age < 0 ? null : age;
}

/** Room by age; null for adults (18+) or unknown age — they cannot use the kids kiosk. */
export function assignRoom(person: { birthdate: Date | null }): string | null {
  const age = ageOf(person);
  if (age === null) return null;
  if (age < 2) return "Nursery";
  if (age < 6) return "Preschool";
  if (age < 12) return "K–5th";
  if (age < 18) return "Students";
  return null;
}

function nameOf(p?: { firstName: string; lastName: string } | null): string {
  return p ? `${p.firstName} ${p.lastName}` : "";
}

function roomSortKey(room: string): number {
  const idx = ROOM_ORDER.indexOf(room);
  return idx === -1 ? ROOM_ORDER.length : idx;
}

function digitsOnly(value: string): string {
  return (value ?? "").replace(/\D/g, "");
}

/** 4-char numeric code, unique among active check-ins in the same room + event. */
async function newSecurityCode(orgId: string, eventId: string, room: string): Promise<string> {
  const takenRows = await db.attendanceRecord.findMany({
    where: { orgId, eventId, status: "checked_in", roomText: room },
    select: { pickupCode: true },
  });
  const taken = new Set(takenRows.map((r) => r.pickupCode));
  for (let i = 0; i < 200; i++) {
    const code = String(Math.floor(1000 + Math.random() * 9000));
    if (!taken.has(code)) return code;
  }
  return String(Math.floor(1000 + Math.random() * 9000));
}

async function householdNameFor(personId: string): Promise<string | null> {
  const link = await db.householdMember.findFirst({
    where: { personId },
    include: { household: { select: { name: true } } },
  });
  return link?.household?.name ?? null;
}

/** Best-effort first_visit workflow trigger — never blocks the check-in. */
async function fireFirstVisitWorkflow(orgId: string, personId: string, subjectName: string, eventId: string) {
  try {
    const workflow = await db.workflow.findFirst({
      where: { orgId, triggerType: "first_visit", isActive: true },
      select: { id: true },
    });
    if (!workflow) return;
    await db.workflowRun.upsert({
      where: { idempotencyKey: `first_visit:${personId}:${eventId}` },
      create: {
        orgId,
        workflowId: workflow.id,
        subjectType: "person",
        subjectId: personId,
        subjectName,
        status: "completed",
        firedReason: "fired:first_visit",
        detail: "First visit recorded at kiosk",
        startedAt: new Date(),
        finishedAt: new Date(),
        idempotencyKey: `first_visit:${personId}:${eventId}`,
      },
      update: {},
    });
  } catch {
    // best effort only
  }
}

interface ActiveRow {
  personId: string;
  name: string;
  room: string;
  checkedInAt: Date | null;
  pickupCode: string | null;
  allergies: string | null;
}

async function fetchActiveCheckins(orgId: string, eventId: string): Promise<ActiveRow[]> {
  const records = await db.attendanceRecord.findMany({
    where: { orgId, eventId, status: "checked_in" },
    orderBy: { checkedInAt: "asc" },
  });
  const personIds = [...new Set(records.map((r) => r.personId))];
  const people = personIds.length
    ? await db.person.findMany({
        where: { id: { in: personIds }, orgId },
        select: { id: true, firstName: true, lastName: true, allergies: true },
      })
    : [];
  const peopleMap = new Map(people.map((p) => [p.id, p]));
  return records.map((r) => {
    const p = peopleMap.get(r.personId);
    return {
      personId: r.personId,
      name: nameOf(p) || r.personId,
      room: r.roomText || UNASSIGNED,
      checkedInAt: r.checkedInAt,
      pickupCode: r.pickupCode,
      allergies: p?.allergies ?? null,
    };
  });
}

function groupByRoom(rows: ActiveRow[]): { room: string; children: ActiveRow[] }[] {
  const map = new Map<string, ActiveRow[]>();
  for (const row of rows) {
    const list = map.get(row.room) ?? [];
    list.push(row);
    map.set(row.room, list);
  }
  return [...map.entries()]
    .sort((a, b) => roomSortKey(a[0]) - roomSortKey(b[0]) || a[0].localeCompare(b[0]))
    .map(([room, children]) => ({ room, children }));
}

// ─────────────────────────────── KIOSK ENDPOINTS ──────────────────────────────

export async function kioskFamilies(kiosk: KioskCtx, query: string) {
  const s = (query ?? "").trim();
  if (!s) return { items: [] };

  // active check-ins for this session's event (for hasActiveCheckin / activeCode)
  const active = await db.attendanceRecord.findMany({
    where: { orgId: kiosk.orgId, eventId: kiosk.eventId, status: "checked_in" },
    select: { personId: true, pickupCode: true },
  });
  const activeMap = new Map(active.map((a) => [a.personId, a.pickupCode]));

  // resolve matching people by phone digits (digits-stripped contains) or by name
  const digits = digitsOnly(s);
  const hasLetters = /[a-zA-Z]/.test(s);
  let matchedPersonIds: string[] = [];

  if (digits.length > 0) {
    const candidates = await db.person.findMany({
      where: { orgId: kiosk.orgId, deletedAt: null, mergedIntoId: null, phone: { not: null } },
      select: { id: true, phone: true },
      take: 5000,
    });
    matchedPersonIds = candidates.filter((p) => digitsOnly(p.phone ?? "").includes(digits)).map((p) => p.id);
    if (!matchedPersonIds.length && hasLetters) {
      // fall back to name search when the numeric query matched nothing
      const sl = s.toLowerCase();
      const byName = await db.person.findMany({
        where: {
          orgId: kiosk.orgId, deletedAt: null, mergedIntoId: null,
          OR: [{ firstName: { contains: sl } }, { lastName: { contains: sl } }],
        },
        select: { id: true },
        take: 50,
      });
      matchedPersonIds = byName.map((p) => p.id);
    }
  } else {
    const sl = s.toLowerCase();
    const byName = await db.person.findMany({
      where: {
        orgId: kiosk.orgId, deletedAt: null, mergedIntoId: null,
        OR: [{ firstName: { contains: sl } }, { lastName: { contains: sl } }],
      },
      select: { id: true },
      take: 50,
    });
    matchedPersonIds = byName.map((p) => p.id);
  }

  if (!matchedPersonIds.length) return { items: [] };

  // Person carries no household relation in the schema — join through HouseholdMember rows
  const linkRows = await db.householdMember.findMany({
    where: { personId: { in: matchedPersonIds }, endedAt: null },
    select: { householdId: true },
  });
  const householdIds = [...new Set(linkRows.map((l) => l.householdId))];
  if (!householdIds.length) return { items: [] };

  const households = await db.household.findMany({
    where: { orgId: kiosk.orgId, id: { in: householdIds } },
    orderBy: { name: "asc" },
    take: 10,
  });
  if (!households.length) return { items: [] };

  const memberRows = await db.householdMember.findMany({
    where: { householdId: { in: households.map((h) => h.id) } },
  });
  const memberPersonIds = [...new Set(memberRows.map((m) => m.personId))];
  const memberPeople = memberPersonIds.length
    ? await db.person.findMany({ where: { id: { in: memberPersonIds }, orgId: kiosk.orgId } })
    : [];
  const peopleMap = new Map(memberPeople.map((p) => [p.id, p]));

  // classify household members: adults (guardians for lookup) vs children (<18)
  const childIdsByHousehold = new Map<string, string[]>();
  const adultIdsByHousehold = new Map<string, string[]>();
  const allChildIds: string[] = [];
  for (const h of households) {
    const childIds: string[] = [];
    const adultIds: string[] = [];
    for (const row of memberRows.filter((r) => r.householdId === h.id)) {
      const p = peopleMap.get(row.personId);
      if (!p || p.deletedAt || p.mergedIntoId) continue;
      const age = ageOf(p);
      const isAdult = age === null ? ["head", "spouse", "adult"].includes(row.role) : age >= 18;
      if (isAdult) adultIds.push(p.id);
      else {
        childIds.push(p.id);
        allChildIds.push(p.id);
      }
    }
    childIdsByHousehold.set(h.id, childIds);
    adultIdsByHousehold.set(h.id, adultIds);
  }

  // authorized-pickup guardian relationships (guardians may live outside the household)
  const pickupRels = allChildIds.length
    ? await db.personRelationship.findMany({
        where: { orgId: kiosk.orgId, toPersonId: { in: allChildIds }, type: "guardian", authorizedPickup: true },
        select: { fromPersonId: true, toPersonId: true },
      })
    : [];
  const guardianIds = [...new Set(pickupRels.map((r) => r.fromPersonId))];
  const guardianPeople = guardianIds.length
    ? await db.person.findMany({
        where: { id: { in: guardianIds } },
        select: { id: true, firstName: true, lastName: true },
      })
    : [];
  const guardianMap = new Map(guardianPeople.map((g) => [g.id, nameOf(g)]));
  const nameFor = (id: string) => {
    const p = peopleMap.get(id);
    if (p) return nameOf(p);
    return guardianMap.get(id) ?? id;
  };

  const items = households.map((h) => {
    const childIds = childIdsByHousehold.get(h.id) ?? [];
    const guardianIdsForHousehold = [
      ...new Set([
        ...(adultIdsByHousehold.get(h.id) ?? []),
        ...pickupRels.filter((r) => childIds.includes(r.toPersonId)).map((r) => r.fromPersonId),
      ]),
    ];
    return {
      householdId: h.id,
      householdName: h.name,
      guardians: guardianIdsForHousehold.map((id) => ({ personId: id, name: nameFor(id) })),
      children: childIds
        .map((id) => {
          const p = peopleMap.get(id)!;
          return {
            personId: id,
            name: nameOf(p),
            age: ageOf(p) as number,
            room: assignRoom(p),
            allergies: p.allergies,
            hasActiveCheckin: activeMap.has(id),
            activeCode: activeMap.get(id) ?? null,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  });

  return { items };
}

export async function kioskCheckin(kiosk: KioskCtx, childIds: string[], _guardianPersonId?: string) {
  if (!Array.isArray(childIds) || childIds.length === 0) throw badRequest("childIds is required.");

  const now = new Date();
  const checkins: {
    personId: string;
    name: string;
    room: string;
    pickupCode: string | null;
    allergies: string | null;
    checkedInAt: Date | null;
  }[] = [];
  const checkedInIds: string[] = [];

  for (const childId of childIds) {
    const person = await db.person.findFirst({
      where: { id: childId, orgId: kiosk.orgId, deletedAt: null, mergedIntoId: null },
    });
    if (!person) continue;

    const room = assignRoom(person);
    if (!room) continue; // adults / unknown age cannot check in at the kids kiosk

    const existing = await db.attendanceRecord.findUnique({
      where: { personId_eventId: { personId: childId, eventId: kiosk.eventId } },
    });
    if (existing && existing.status === "checked_in") {
      // already checked in → return existing with the same code
      checkins.push({
        personId: childId,
        name: nameOf(person),
        room: existing.roomText || room,
        pickupCode: existing.pickupCode,
        allergies: person.allergies,
        checkedInAt: existing.checkedInAt,
      });
      continue;
    }

    const pickupCode = await newSecurityCode(kiosk.orgId, kiosk.eventId, room);
    const firstTime = person.firstVisitAt == null;
    const data = {
      status: "checked_in",
      method: "kiosk",
      checkedInAt: now,
      checkedOutAt: null,
      checkinSessionId: kiosk.id,
      roomText: room,
      pickupCode,
      firstTime,
    };
    const row = existing
      ? await db.attendanceRecord.update({ where: { id: existing.id }, data })
      : await db.attendanceRecord.create({
          data: { orgId: kiosk.orgId, personId: childId, eventId: kiosk.eventId, ...data },
        });

    await db.person.update({
      where: { id: childId },
      data: { lastActivityAt: now, ...(firstTime ? { firstVisitAt: now } : {}) },
    });
    if (firstTime) {
      await db.stageHistory.create({
        data: {
          orgId: kiosk.orgId,
          personId: childId,
          stage: person.lifecycleStage,
          changedByName: "Kiosk",
          note: "First visit recorded",
        },
      });
      await fireFirstVisitWorkflow(kiosk.orgId, childId, nameOf(person), kiosk.eventId);
    }

    checkins.push({
      personId: childId,
      name: nameOf(person),
      room,
      pickupCode: row.pickupCode,
      allergies: person.allergies,
      checkedInAt: row.checkedInAt,
    });
    checkedInIds.push(childId);
  }

  let householdName: string | null = null;
  if (_guardianPersonId) householdName = await householdNameFor(_guardianPersonId);
  if (!householdName && checkedInIds.length) householdName = await householdNameFor(checkedInIds[0]);

  return { checkins, householdName };
}

export async function kioskCheckout(kiosk: KioskCtx, childId: string, code?: string, guardianPersonId?: string) {
  if (!childId) throw badRequest("childId is required.");
  const row = await db.attendanceRecord.findFirst({
    where: { orgId: kiosk.orgId, eventId: kiosk.eventId, personId: childId, status: "checked_in" },
  });
  if (!row) throw notFound("No active check-in found for that child.");

  let authorized = false;
  if (code && row.pickupCode && code.trim().toLowerCase() === row.pickupCode.toLowerCase()) authorized = true;
  if (!authorized && guardianPersonId) {
    const rel = await db.personRelationship.findFirst({
      where: {
        orgId: kiosk.orgId,
        fromPersonId: guardianPersonId,
        toPersonId: childId,
        authorizedPickup: true,
      },
      select: { id: true },
    });
    if (rel) authorized = true;
  }
  if (!authorized) throw forbidden("That code doesn't match. Ask a room host for help.");

  const now = new Date();
  await db.attendanceRecord.update({
    where: { id: row.id },
    data: { status: "checked_out", checkedOutAt: now },
  });
  await audit({
    orgId: kiosk.orgId,
    // the kiosk is a device, not a user: system actor labeled "Kiosk"
    // (AuditEntry derives actorLabel from actor.name)
    actor: { membershipId: undefined as unknown as string, name: "Kiosk" },
    actorType: "system",
    action: "checkin.checkout",
    entityType: "attendance",
    entityId: row.id,
    after: { personId: childId, eventId: kiosk.eventId, matchedBy: code ? "code" : "guardian" },
  });

  const person = await db.person.findUnique({
    where: { id: childId },
    select: { firstName: true, lastName: true },
  });
  return { ok: true, child: { name: nameOf(person) || childId, checkedOutAt: now } };
}

export async function kioskRoster(kiosk: KioskCtx) {
  const rows = await fetchActiveCheckins(kiosk.orgId, kiosk.eventId);
  const children = rows.map((r) => ({
    name: r.name,
    room: r.room,
    checkedInAt: r.checkedInAt,
    code: r.pickupCode,
    allergies: r.allergies,
  }));
  const byRoom = groupByRoom(rows).map((g) => ({
    room: g.room,
    children: g.children.map((r) => ({
      name: r.name,
      room: r.room,
      checkedInAt: r.checkedInAt,
      code: r.pickupCode,
      allergies: r.allergies,
    })),
  }));
  return { children, byRoom };
}

// ─────────────────────────────── STAFF ENDPOINTS ──────────────────────────────

export async function staffRoster(user: SessionUser, eventId: string) {
  const rows = await fetchActiveCheckins(user.orgId, eventId);

  const rels = rows.length
    ? await db.personRelationship.findMany({
        where: { orgId: user.orgId, toPersonId: { in: rows.map((r) => r.personId) }, type: "guardian" },
        select: { fromPersonId: true, toPersonId: true, authorizedPickup: true },
      })
    : [];
  const guardianIds = [...new Set(rels.map((r) => r.fromPersonId))];
  const guardians = guardianIds.length
    ? await db.person.findMany({
        where: { id: { in: guardianIds } },
        select: { id: true, firstName: true, lastName: true, phone: true },
      })
    : [];
  const guardianMap = new Map(guardians.map((g) => [g.id, g]));

  const byRoom = groupByRoom(rows).map((g) => ({
    room: g.room,
    allergyCount: g.children.filter((c) => !!(c.allergies && c.allergies.trim())).length,
    children: g.children.map((c) => ({
      personId: c.personId,
      name: c.name,
      checkedInAt: c.checkedInAt,
      pickupCode: c.pickupCode,
      allergies: c.allergies,
      guardians: rels
        .filter((r) => r.toPersonId === c.personId)
        .map((r) => {
          const g = guardianMap.get(r.fromPersonId);
          return {
            name: nameOf(g) || r.fromPersonId,
            phone: g?.phone ?? null,
            authorizedPickup: r.authorizedPickup,
          };
        }),
    })),
  }));
  return { byRoom };
}

export async function staffOverrideCheckout(user: SessionUser, childId: string, eventId: string, reason?: string) {
  if (!childId || !eventId) throw badRequest("childId and eventId are required.");
  const row = await db.attendanceRecord.findFirst({
    where: { orgId: user.orgId, eventId, personId: childId, status: "checked_in" },
  });
  if (!row) throw notFound("No active check-in found for that child.");
  const now = new Date();
  await db.attendanceRecord.update({
    where: { id: row.id },
    data: { status: "checked_out", checkedOutAt: now, correctedByName: user.name, notes: reason ?? row.notes },
  });
  await audit({
    orgId: user.orgId, actor: user, action: "checkin.override",
    entityType: "attendance", entityId: row.id,
    before: { status: row.status },
    after: { personId: childId, eventId, status: "checked_out", reason: reason ?? null },
    ip: undefined, userAgent: undefined,
  });
  return { ok: true };
}

export async function openCheckinSession(user: SessionUser, eventId: string) {
  const event = await db.event.findFirst({ where: { id: eventId, orgId: user.orgId } });
  if (!event) throw notFound("Event not found.");

  // one open session per event — close any existing open sessions
  await db.checkinSession.updateMany({
    where: { orgId: user.orgId, eventId, closedAt: null },
    data: { closedAt: new Date() },
  });

  const session = await db.checkinSession.create({
    data: {
      orgId: user.orgId,
      eventId,
      name: event.name,
      opensAt: new Date(),
      closesAt: new Date(event.endsAt.getTime() + 60 * 60 * 1000),
      mode: "kiosk",
      requirePickupCode: true,
      kioskToken: "kiosk-" + randomBytes(12).toString("hex"),
      createdByName: user.name,
    },
  });
  await audit({
    orgId: user.orgId, actor: user, action: "checkin.session_open",
    entityType: "checkin_session", entityId: session.id,
    after: { eventId, kioskToken: session.kioskToken, closesAt: session.closesAt },
  });
  return session;
}

export async function closeCheckinSession(user: SessionUser, sessionId: string) {
  const session = await db.checkinSession.findFirst({ where: { id: sessionId, orgId: user.orgId } });
  if (!session) throw notFound("Check-in session not found.");
  if (!session.closedAt) {
    await db.checkinSession.update({ where: { id: sessionId }, data: { closedAt: new Date() } });
    await audit({
      orgId: user.orgId, actor: user, action: "checkin.session_close",
      entityType: "checkin_session", entityId: sessionId,
      after: { eventId: session.eventId },
    });
  }
  return { ok: true };
}

export async function listSessions(user: SessionUser) {
  const sessions = await db.checkinSession.findMany({
    where: { orgId: user.orgId, closedAt: null },
    include: { event: { select: { name: true, startsAt: true } } },
    orderBy: { opensAt: "desc" },
  });
  return {
    items: sessions.map((s) => ({
      id: s.id,
      eventId: s.eventId,
      name: s.name,
      opensAt: s.opensAt,
      closesAt: s.closesAt,
      mode: s.mode,
      requirePickupCode: s.requirePickupCode,
      kioskToken: s.kioskToken,
      closedAt: s.closedAt,
      createdByName: s.createdByName,
      eventName: s.event.name,
      eventStartsAt: s.event.startsAt,
    })),
  };
}
