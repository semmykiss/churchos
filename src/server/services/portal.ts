import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { badRequest, notFound } from "@/server/http";
import { can, type SessionUser } from "@/server/permissions";
import { startOfYear } from "date-fns";

/**
 * Member portal service (backend only — no HTTP, no React).
 * Everything is scoped to the signed-in user's own person record:
 *  • no personId on the session → 404 (portal needs a person)
 *  • giving block only visible with giving.view / owner / finance roles
 *  • gift creation is a simulated hosted-page flow — card data never touches us,
 *    only the method name and a demo fee calculation
 */

const DAY_MS = 86400000;

function requirePersonId(user: SessionUser): string {
  if (!user.personId) throw notFound("No person record is linked to this account.");
  return user.personId;
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

function roomForAge(age: number): string {
  if (age < 2) return "Nursery";
  if (age < 6) return "Preschool";
  if (age < 12) return "K–5th";
  return "Students";
}

/**
 * Portal giving is ALWAYS visible to the authenticated person — the data is
 * already scoped to their own personId (P6: members give and review history
 * without phoning the office; privacy is per-person, never household-wide).
 */
function canSeeGiving(user: SessionUser): boolean {
  return !!user.personId;
}

export async function getPortalMe(user: SessionUser) {
  const personId = requirePersonId(user);
  const person = await db.person.findFirst({ where: { id: personId, orgId: user.orgId, deletedAt: null } });
  if (!person) throw notFound("Person record not found.");
  const now = new Date();

  // household + members
  const link = await db.householdMember.findFirst({ where: { personId, endedAt: null }, include: { household: true } });
  let household: { id: string; name: string; members: { personId: string; name: string; role: string }[] } | null = null;
  let householdMemberLinks: { personId: string; role: string }[] = [];
  if (link?.household) {
    householdMemberLinks = (
      await db.householdMember.findMany({ where: { householdId: link.household.id, endedAt: null } })
    ).map((m) => ({ personId: m.personId, role: m.role }));
    const memberIds = householdMemberLinks.map((m) => m.personId);
    const members = memberIds.length ? await db.person.findMany({ where: { id: { in: memberIds }, deletedAt: null } }) : [];
    const mMap = new Map(members.map((m) => [m.id, m] as const));
    household = {
      id: link.household.id,
      name: link.household.name,
      members: memberIds
        .filter((id) => mMap.has(id))
        .map((id) => ({ personId: id, name: nameOf(mMap.get(id)), role: householdMemberLinks.find((l) => l.personId === id)?.role ?? "adult" })),
    };
  }

  // tags
  const tags = await db.personTag.findMany({ where: { personId }, include: { tag: true } });

  // giving (permissioned)
  const givingVisible = canSeeGiving(user);
  let giving: any = { visible: false, ytdCents: null, recent: [], recurring: [] };
  if (givingVisible) {
    const [recent, ytdAgg, recurring, activeFunds] = await Promise.all([
      db.donation.findMany({
        where: { orgId: user.orgId, personId, status: { in: ["posted", "pending"] } },
        orderBy: { receivedOn: "desc" },
        take: 10,
        include: { splits: true },
      }),
      db.donation.aggregate({
        where: { orgId: user.orgId, personId, status: "posted", receivedOn: { gte: startOfYear(now) } },
        _sum: { amountCents: true },
      }),
      db.recurringGift.findMany({ where: { orgId: user.orgId, personId } }),
      // Portal-scoped fund list (id + name only) so members can give without staff permission
      db.fund.findMany({ where: { orgId: user.orgId, isActive: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true, isActive: true } }),
    ]);
    const fundIds = [...new Set(recent.flatMap((d) => d.splits.map((s) => s.fundId)).concat(recurring.map((r) => r.fundId)))];
    const funds = fundIds.length ? await db.fund.findMany({ where: { id: { in: fundIds } } }) : [];
    const fMap = new Map(funds.map((f) => [f.id, f.name] as const));
    giving = {
      visible: true,
      ytdCents: ytdAgg._sum.amountCents ?? 0,
      funds: activeFunds.map((f) => ({ id: f.id, name: f.name })),
      recent: recent.map((d) => ({
        id: d.id,
        amountCents: d.amountCents,
        method: d.method,
        status: d.status,
        receivedOn: d.receivedOn,
        funds: d.splits.map((s) => ({ name: fMap.get(s.fundId) ?? "Fund", amountCents: s.amountCents })),
      })),
      recurring: recurring.map((r) => ({
        id: r.id,
        fund: fMap.get(r.fundId) ?? "Fund",
        amountCents: r.amountCents,
        frequency: r.frequency,
        nextRunAt: r.nextRunAt,
        status: r.status,
      })),
    };
  }

  // groups (active memberships)
  const memberships = await db.groupMember.findMany({
    where: { orgId: user.orgId, personId, status: "active" },
    include: { group: true },
  });

  // upcoming schedule (60 days)
  const assignments = await db.assignment.findMany({
    where: { orgId: user.orgId, personId, startsAt: { gte: now, lte: new Date(now.getTime() + 60 * DAY_MS) } },
    include: { role: { select: { name: true } }, event: { select: { name: true, startsAt: true } } },
    orderBy: { startsAt: "asc" },
  });

  // children in the household with a room guess
  const childIds = householdMemberLinks.map((m) => m.personId);
  const childPeople = childIds.length ? await db.person.findMany({ where: { id: { in: childIds }, deletedAt: null } }) : [];
  const children = childPeople
    .map((c) => ({ person: c, age: ageOn(c.birthdate, now) }))
    .filter((c) => c.age != null && c.age < 18)
    .map((c) => ({ personId: c.person.id, name: nameOf(c.person), age: c.age!, room: roomForAge(c.age!) }));

  const [prayerRequests, consents, upcomingEvents] = await Promise.all([
    db.prayerRequest.findMany({ where: { orgId: user.orgId, personId }, orderBy: { createdAt: "desc" }, take: 20 }),
    db.communicationPreference.findMany({ where: { orgId: user.orgId, personId }, orderBy: [{ channel: "asc" }, { category: "asc" }] }),
    db.event.findMany({
      where: { orgId: user.orgId, kind: "service", startsAt: { gte: now }, status: { not: "cancelled" } },
      orderBy: { startsAt: "asc" },
      take: 5,
      select: { id: true, name: true, startsAt: true },
    }),
  ]);

  return {
    person: {
      id: person.id,
      name: nameOf(person),
      firstName: person.firstName,
      lastName: person.lastName,
      preferredName: person.preferredName,
      email: person.email,
      phone: person.phone,
      household,
      tags: tags.map((t) => ({ id: t.tag.id, name: t.tag.name, color: t.tag.color })),
    },
    giving,
    groups: memberships.map((m) => ({
      id: m.group.id,
      name: m.group.name,
      role: m.role,
      meetingDay: m.group.meetingDay,
      meetingTime: m.group.meetingTime,
      locationText: m.group.locationText,
    })),
    schedule: assignments.map((a) => ({
      id: a.id,
      roleName: a.role.name,
      eventName: a.event.name,
      startsAt: a.event.startsAt,
      status: a.status,
      callTime: a.callTime,
    })),
    children,
    prayerRequests: prayerRequests.map((r) => ({
      id: r.id,
      body: r.body,
      audience: r.audience,
      status: r.status,
      isAnonymous: r.isAnonymous,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
    })),
    consents: consents.map((c) => ({ channel: c.channel, category: c.category, optedIn: c.optedIn })),
    upcomingEvents: upcomingEvents.map((e) => ({ id: e.id, name: e.name, startsAt: e.startsAt })),
  };
}

export async function updatePortalMe(user: SessionUser, input: { email?: string; phone?: string }, meta: { ip?: string; userAgent?: string }) {
  const personId = requirePersonId(user);
  const person = await db.person.findFirst({ where: { id: personId, orgId: user.orgId, deletedAt: null } });
  if (!person) throw notFound("Person record not found.");
  const data: any = {};
  if (input?.email !== undefined) data.email = input.email ? input.email.trim().toLowerCase() : null;
  if (input?.phone !== undefined) data.phone = input.phone ? input.phone.trim() : null;
  if (!Object.keys(data).length) throw badRequest("Nothing to update — provide email and/or phone.");
  await db.person.update({ where: { id: personId }, data });
  await audit({
    orgId: user.orgId, actor: user, action: "portal.profile_update", entityType: "person", entityId: personId,
    before: { email: person.email, phone: person.phone }, after: { email: data.email ?? person.email, phone: data.phone ?? person.phone },
    ip: meta.ip, userAgent: meta.userAgent,
  });
  return { ok: true };
}

export async function updatePortalConsent(
  user: SessionUser,
  input: { channel?: string; category?: string; optedIn?: boolean },
  meta: { ip?: string; userAgent?: string },
) {
  const personId = requirePersonId(user);
  const { channel, optedIn } = input ?? {};
  if (!channel || typeof optedIn !== "boolean") throw badRequest("channel and optedIn are required.");
  const category = input.category || "operational";
  await db.communicationPreference.upsert({
    where: { personId_channel_category: { personId, channel, category } },
    create: { orgId: user.orgId, personId, channel, category, optedIn, source: "portal", wordingVersion: "portal v1" },
    update: { optedIn, source: "portal", wordingVersion: "portal v1" },
  });
  await audit({
    orgId: user.orgId, actor: user, action: "consent.update", entityType: "person", entityId: personId,
    after: { channel, category, optedIn, source: "portal" }, ip: meta.ip, userAgent: meta.userAgent,
  });
  return { ok: true };
}

/** Simulated hosted-page gift — no card data is ever stored, just the method name. */
export async function createPortalGift(
  user: SessionUser,
  input: { amountCents?: number; fundId?: string; method?: string; frequency?: string },
  meta: { ip?: string; userAgent?: string },
) {
  const personId = requirePersonId(user);
  const amount = Math.round(Number(input?.amountCents));
  if (!Number.isFinite(amount) || amount <= 0) throw badRequest("amountCents must be a positive whole number of cents.");
  if (!input?.fundId) throw badRequest("fundId is required.");
  const fund = await db.fund.findFirst({ where: { id: input.fundId, orgId: user.orgId } });
  if (!fund) throw notFound("Fund not found.");
  const method = input.method || "card";
  // demo processor fees: card 2.9% + 30¢, ach 0.8% + 25¢, everything else free
  const feeCents = method === "card" ? Math.round(amount * 0.029) + 30 : method === "ach" ? Math.round(amount * 0.008) + 25 : 0;

  const donation = await db.donation.create({
    data: {
      orgId: user.orgId,
      personId,
      amountCents: amount,
      method,
      status: "posted",
      receivedOn: new Date(),
      source: "hosted_page",
      feeCents,
      netCents: amount - feeCents,
      memo: `Portal gift (${input.frequency || "one_time"})`,
      idempotencyKey: `portal:${personId}:${Date.now()}`,
      createdByName: user.name,
    },
  });
  await db.donationSplit.create({ data: { orgId: user.orgId, donationId: donation.id, fundId: fund.id, amountCents: amount } });
  await audit({
    orgId: user.orgId, actor: user, actorType: "user", action: "gift.create", entityType: "donation", entityId: donation.id,
    after: { amountCents: amount, method, source: "hosted_page", fundId: fund.id }, ip: meta.ip, userAgent: meta.userAgent,
  });
  return { ok: true, donationId: donation.id };
}
