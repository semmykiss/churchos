import { db } from "@/server/db";
import { j } from "@/server/audit";
import type { SessionUser } from "@/server/permissions";
import {
  startOfWeek, addDays, subWeeks, subDays, startOfMonth, subMonths, addMonths, startOfYear, format, differenceInWeeks,
} from "date-fns";

/**
 * Reports service (backend only — no HTTP, no React).
 * Every number here is computed from real data (attendance, donations, assignments…).
 * Definitions live in reports/metric-dictionary so dashboards and the dictionary
 * can never drift apart silently.
 */

const PRESENT = ["present", "late", "checked_in", "checked_out"];
const CONFIRMED = ["accepted", "confirmed", "served"];
const DAY_MS = 86400000;
const MON = { weekStartsOn: 1 as const };

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

/** Confidentiality tiers (same rules as the care service, inlined for reports). */
function careVisibility(roleKeys: string[]) {
  if (roleKeys.includes("owner")) return { tiers: ["staff", "case_team", "pastors"], safeguarding: true };
  if (roleKeys.includes("campus_admin")) return { tiers: ["staff", "case_team"], safeguarding: true };
  if (roleKeys.includes("ministry_leader")) return { tiers: ["staff"], safeguarding: false };
  return { tiers: [] as string[], safeguarding: false };
}

async function countPresent(orgId: string, eventIds: string[]): Promise<number> {
  if (!eventIds.length) return 0;
  return db.attendanceRecord.count({ where: { orgId, eventId: { in: eventIds }, status: { in: PRESENT } } });
}

/** start (00:00) of the upcoming Sunday — today counts when today IS Sunday. */
function upcomingSunday(now: Date): Date {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() + ((7 - d.getUTCDay()) % 7));
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

async function orgSettings(orgId: string) {
  const org = await db.organization.findUnique({ where: { id: orgId } });
  return j<{ monthlyBudgetCents?: number; quietHours?: any }>(org?.settings, {});
}

/** followUpStatus for a first-time guest: first_visit workflow run completed? */
async function followUpStatuses(orgId: string, personIds: string[]) {
  const map: Record<string, string> = {};
  if (!personIds.length) return map;
  const wf = await db.workflow.findFirst({ where: { orgId, triggerType: "first_visit" }, select: { id: true } });
  if (!wf) {
    for (const id of personIds) map[id] = "pending";
    return map;
  }
  const runs = await db.workflowRun.findMany({ where: { orgId, workflowId: wf.id, subjectId: { in: personIds } } });
  const completed = new Set(runs.filter((r) => r.status === "completed").map((r) => r.subjectId));
  for (const id of personIds) map[id] = completed.has(id) ? "completed" : "pending";
  return map;
}

// ── this-week dashboard ──────────────────────────────────────────────────────

export async function thisWeekReport(user: SessionUser) {
  const orgId = user.orgId;
  const now = new Date();
  // Anchor "this week" on the most recent COMPLETED Sunday (the pastor's
  // Monday-morning question is "how was Sunday?" — mid-week, the calendar
  // week has no Sunday yet, which would show a misleading near-zero count).
  // Window = Mon..Sun containing the most recent Sunday that has started.
  const dow = now.getUTCDay(); // 0 = Sunday
  const mostRecentSunday = new Date(now);
  mostRecentSunday.setUTCHours(0, 0, 0, 0);
  mostRecentSunday.setUTCDate(mostRecentSunday.getUTCDate() - dow); // Sunday of this calendar week
  const thisSundayCompleted = mostRecentSunday.getTime() < now.getTime();
  const anchor = thisSundayCompleted ? mostRecentSunday : addDays(mostRecentSunday, -7);
  const weekStart = addDays(anchor, -6); // Monday of that Sunday's week
  const weekEnd = addDays(anchor, 1); // exclusive: Monday after that Sunday
  const lastStart = addDays(weekStart, -7);
  const lyStart = addDays(weekStart, -364); // same weekday alignment, one year back

  const [weekEvents, lastEvents, lyEvents] = await Promise.all([
    db.event.findMany({ where: { orgId, startsAt: { gte: weekStart, lt: weekEnd } }, select: { id: true } }),
    db.event.findMany({ where: { orgId, startsAt: { gte: lastStart, lt: weekStart } }, select: { id: true } }),
    db.event.findMany({ where: { orgId, startsAt: { gte: lyStart, lt: addDays(lyStart, 7) } }, select: { id: true } }),
  ]);
  const attendanceThisWeek = await countPresent(orgId, weekEvents.map((e) => e.id));
  const attendanceLastWeek = await countPresent(orgId, lastEvents.map((e) => e.id));
  const lyCount = await countPresent(orgId, lyEvents.map((e) => e.id));

  // first-time guests, last 7 days
  const ftRows = await db.attendanceRecord.findMany({
    where: { orgId, firstTime: true, checkedInAt: { gte: subDays(now, 7) } },
    include: { event: { select: { startsAt: true } } },
    orderBy: { checkedInAt: "desc" },
  });
  const seen = new Set<string>();
  const ftDistinct = ftRows.filter((r) => (seen.has(r.personId) ? false : (seen.add(r.personId), true)));
  const people = ftDistinct.length ? await db.person.findMany({ where: { id: { in: ftDistinct.map((r) => r.personId) } } }) : [];
  const pMap = new Map(people.map((p) => [p.id, p] as const));
  const followUps = await followUpStatuses(orgId, ftDistinct.map((r) => r.personId));
  const firstTimeGuests = ftDistinct.map((r) => ({
    id: r.personId,
    name: nameOf(pMap.get(r.personId)),
    date: r.checkedInAt ?? r.event.startsAt,
    followUpStatus: followUps[r.personId] ?? "pending",
  }));
  const followUpsPending = firstTimeGuests.filter((g) => g.followUpStatus !== "completed").length;

  // giving month-to-date (posted) + last month + budget from org settings
  const mtdStart = startOfMonth(now);
  const lastMonthStart = startOfMonth(subMonths(now, 1));
  const [mtd, lastMonth] = await Promise.all([
    db.donation.aggregate({ where: { orgId, status: "posted", receivedOn: { gte: mtdStart } }, _sum: { amountCents: true } }),
    db.donation.aggregate({
      where: { orgId, status: "posted", receivedOn: { gte: lastMonthStart, lt: mtdStart } },
      _sum: { amountCents: true },
    }),
  ]);
  const settings = await orgSettings(orgId);

  // open care cases (confidentiality-aware)
  const vis = careVisibility(user.roleKeys);
  const openCases = vis.tiers.length
    ? await db.careCase.findMany({
        where: {
          orgId,
          status: "open",
          confidentialityTier: { in: vis.tiers },
          ...(vis.safeguarding ? {} : { isSafeguarding: false }),
        },
        orderBy: [{ urgency: "desc" }, { dueDate: "asc" }],
        take: 12,
      })
    : [];
  const casePeople = openCases.length ? await db.person.findMany({ where: { id: { in: openCases.map((c) => c.personId) } } }) : [];
  const cpMap = new Map(casePeople.map((p) => [p.id, p] as const));

  // upcoming Sunday volunteering
  const sunday = upcomingSunday(now);
  const sundayEvents = await db.event.findMany({
    where: { orgId, kind: "service", startsAt: { gte: sunday, lt: addDays(sunday, 1) } },
    orderBy: { startsAt: "asc" },
    select: { id: true, name: true, startsAt: true },
  });
  const sundayAssignments = sundayEvents.length
    ? await db.assignment.findMany({ where: { orgId, eventId: { in: sundayEvents.map((e) => e.id) } }, select: { status: true } })
    : [];

  // new people, last 30 days
  const newPeople = await db.person.findMany({
    where: { orgId, deletedAt: null, firstVisitAt: { gte: subDays(now, 30) } },
    orderBy: { firstVisitAt: "desc" },
    take: 10,
  });

  return {
    attendanceThisWeek,
    attendanceLastWeek,
    attendanceSameWeekLastYear: lyCount > 0 ? lyCount : null,
    firstTimeGuests,
    followUpsPending,
    givingMtdCents: mtd._sum.amountCents ?? 0,
    givingBudgetCents: settings.monthlyBudgetCents ?? null,
    givingLastMonthCents: lastMonth._sum.amountCents ?? 0,
    openCareCases: openCases.map((c) => ({
      id: c.id,
      person: nameOf(cpMap.get(c.personId)),
      type: c.type,
      urgency: c.urgency,
      dueDate: c.dueDate,
    })),
    upcomingSunday: {
      volunteersConfirmed: sundayAssignments.filter((a) => CONFIRMED.includes(a.status)).length,
      volunteersNeeded: sundayAssignments.length,
      events: sundayEvents.map((e) => ({ name: e.name, startsAt: e.startsAt })),
    },
    newPeople30: {
      count: newPeople.length,
      items: newPeople.map((p) => ({ id: p.id, name: nameOf(p), firstVisitAt: p.firstVisitAt })),
    },
  };
}

// ── attendance trend ─────────────────────────────────────────────────────────

export async function attendanceReport(user: SessionUser, weeks = 12) {
  const orgId = user.orgId;
  const n = Math.min(52, Math.max(1, Math.round(Number(weeks) || 12)));
  const now = new Date();
  const rangeStart = startOfWeek(subWeeks(now, n - 1), MON);
  const rangeEnd = addDays(startOfWeek(now, MON), 7);

  const events = await db.event.findMany({
    where: { orgId, startsAt: { gte: rangeStart, lt: rangeEnd } },
    select: { id: true, startsAt: true, name: true, service: { select: { name: true } } },
  });
  const eventIds = events.map((e) => e.id);
  const attendance = eventIds.length
    ? await db.attendanceRecord.findMany({
        where: { orgId, eventId: { in: eventIds } },
        select: { personId: true, eventId: true, status: true, method: true },
      })
    : [];
  const personIds = [...new Set(attendance.map((a) => a.personId))];
  const people = personIds.length
    ? await db.person.findMany({ where: { id: { in: personIds } }, select: { id: true, birthdate: true } })
    : [];
  const ageMap = new Map(people.map((p) => [p.id, ageOn(p.birthdate, now)] as const));

  // weekly buckets (Mon–Sun by event date)
  const buckets = new Map<number, { headcount: number; checkedIn: number; adults: Set<string>; kids: Set<string> }>();
  const perEvent: Map<string, number> = new Map();
  for (const e of events) perEvent.set(e.id, 0);
  for (const a of attendance) {
    if (!PRESENT.includes(a.status)) continue;
    const ev = events.find((e) => e.id === a.eventId);
    if (!ev) continue;
    const wk = startOfWeek(ev.startsAt, MON).getTime();
    buckets.set(wk, buckets.get(wk) ?? { headcount: 0, checkedIn: 0, adults: new Set(), kids: new Set() });
    const b = buckets.get(wk)!;
    b.headcount += 1;
    if (a.method === "kiosk") b.checkedIn += 1;
    const age = ageMap.get(a.personId);
    if (age != null && age < 18) b.kids.add(a.personId);
    else b.adults.add(a.personId);
    perEvent.set(a.eventId, (perEvent.get(a.eventId) ?? 0) + 1);
  }

  const series = [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, b]) => ({
      weekStart: new Date(t),
      label: format(new Date(t), "MMM d"),
      headcount: b.headcount,
      checkedIn: b.checkedIn,
      uniqueAdults: b.adults.size,
      uniqueKids: b.kids.size,
    }));

  // avg headcount per recurring service
  const byService = new Map<string, { total: number; count: number }>();
  for (const e of events) {
    const key = e.service?.name ?? e.name;
    byService.set(key, { total: (byService.get(key)?.total ?? 0) + (perEvent.get(e.id) ?? 0), count: (byService.get(key)?.count ?? 0) + 1 });
  }
  const byCampusByService = [...byService.entries()]
    .map(([name, s]) => ({ name, avgHeadcount: Math.round((s.total / s.count) * 10) / 10 }))
    .sort((a, b) => b.avgHeadcount - a.avgHeadcount);

  return { series, byCampusByService };
}

// ── giving trend ─────────────────────────────────────────────────────────────

export async function givingReport(user: SessionUser, months = 12) {
  const orgId = user.orgId;
  const n = Math.min(36, Math.max(1, Math.round(Number(months) || 12)));
  const now = new Date();
  const rangeStart = startOfMonth(subMonths(now, n - 1));
  const rangeEnd = startOfMonth(addMonths(now, 1));

  const donations = await db.donation.findMany({
    where: { orgId, status: "posted", receivedOn: { gte: rangeStart, lt: rangeEnd } },
    include: { splits: true },
  });
  const reversalTargets = await db.donation.findMany({
    where: { orgId, reversalOfId: { in: donations.map((d) => d.id) } },
    select: { reversalOfId: true },
  });
  const reversedIds = new Set(reversalTargets.map((r) => r.reversalOfId));
  const gifts = donations.filter((d) => !reversedIds.has(d.id));

  const funds = await db.fund.findMany({ where: { orgId }, select: { id: true, name: true } });
  const fundName = new Map(funds.map((f) => [f.id, f.name] as const));

  // monthly buckets
  const monthBuckets = new Map<string, { label: string; totalCents: number; byFund: Map<string, number> }>();
  for (const d of gifts) {
    const key = `${d.receivedOn.getUTCFullYear()}-${String(d.receivedOn.getUTCMonth() + 1).padStart(2, "0")}`;
    monthBuckets.set(key, monthBuckets.get(key) ?? { label: format(d.receivedOn, "MMM yyyy"), totalCents: 0, byFund: new Map() });
    const b = monthBuckets.get(key)!;
    b.totalCents += d.amountCents;
    for (const s of d.splits) b.byFund.set(s.fundId, (b.byFund.get(s.fundId) ?? 0) + s.amountCents);
  }
  const series = [...monthBuckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, b]) => ({
      month: b.label,
      label: b.label,
      totalCents: b.totalCents,
      byFund: [...b.byFund.entries()]
        .map(([fundId, amountCents]) => ({ fund: fundName.get(fundId) ?? "Fund", amountCents }))
        .sort((x, y) => y.amountCents - x.amountCents),
    }));

  // YTD (calendar year) with week-normalized average
  const yearStart = startOfYear(now);
  const yearEnd = startOfYear(addMonths(yearStart, 12));
  const lyStart = startOfYear(subMonths(yearStart, 12));
  const [ytdAgg, ytdLyAgg] = await Promise.all([
    db.donation.aggregate({ where: { orgId, status: "posted", receivedOn: { gte: yearStart, lt: yearEnd } }, _sum: { amountCents: true } }),
    db.donation.aggregate({ where: { orgId, status: "posted", receivedOn: { gte: lyStart, lt: yearStart } }, _sum: { amountCents: true } }),
  ]);
  const ytdCents = ytdAgg._sum.amountCents ?? 0;
  const weeksElapsed = Math.max(1, differenceInWeeks(now, yearStart) + 1);

  // top funds YTD
  const ytdGifts = gifts.filter((d) => d.receivedOn.getTime() >= yearStart.getTime());
  const ytdByFund = new Map<string, number>();
  for (const d of ytdGifts) for (const s of d.splits) ytdByFund.set(s.fundId, (ytdByFund.get(s.fundId) ?? 0) + s.amountCents);
  const topFunds = [...ytdByFund.entries()]
    .map(([fundId, totalCents]) => ({ fund: fundName.get(fundId) ?? "Fund", totalCents }))
    .sort((a, b) => b.totalCents - a.totalCents)
    .slice(0, 5);

  // pledge progress per campaign (approximation: splits to the pledge funds by pledgers since start)
  const pledges = await db.pledge.findMany({ where: { orgId, status: { not: "canceled" } } });
  const campaigns = new Map<string, { pledgedCents: number; pledgers: Set<string>; funds: Set<string>; startsOn: Date }>();
  for (const p of pledges) {
    campaigns.set(p.campaign, campaigns.get(p.campaign) ?? { pledgedCents: 0, pledgers: new Set(), funds: new Set(), startsOn: p.startsOn });
    const c = campaigns.get(p.campaign)!;
    c.pledgedCents += p.amountCents;
    c.pledgers.add(p.personId);
    c.funds.add(p.fundId);
    if (p.startsOn.getTime() < c.startsOn.getTime()) c.startsOn = p.startsOn;
  }
  const allPledgers = [...new Set(pledges.map((p) => p.personId))];
  const pledgeDonations = allPledgers.length
    ? await db.donation.findMany({
        where: { orgId, status: "posted", personId: { in: allPledgers }, receivedOn: { gte: rangeStart } },
        include: { splits: true },
      })
    : [];
  const pledgeProgress = [...campaigns.entries()].map(([campaign, c]) => {
    const receivedCents = pledgeDonations
      .filter((d) => c.pledgers.has(d.personId!) && d.receivedOn.getTime() >= c.startsOn.getTime())
      .flatMap((d) => d.splits)
      .filter((s) => c.funds.has(s.fundId))
      .reduce((a, s) => a + s.amountCents, 0);
    return {
      campaign,
      pledgedCents: c.pledgedCents,
      receivedCents,
      pct: c.pledgedCents ? Math.min(999, Math.round((receivedCents / c.pledgedCents) * 100)) : 0,
    };
  }).sort((a, b) => b.pledgedCents - a.pledgedCents);

  return {
    series,
    ytdCents,
    ytdLastYearCents: ytdLyAgg._sum.amountCents ?? 0,
    avgWeeklyCents: Math.round(ytdCents / weeksElapsed),
    topFunds,
    pledgeProgress,
  };
}

// ── groups health ────────────────────────────────────────────────────────────

export async function groupsReport(user: SessionUser) {
  const orgId = user.orgId;
  const groups = await db.group.findMany({ where: { orgId, status: "active", deletedAt: null }, orderBy: { name: "asc" } });
  const groupIds = groups.map((g) => g.id);
  const members = groupIds.length
    ? await db.groupMember.findMany({ where: { orgId, groupId: { in: groupIds }, status: "active" }, select: { groupId: true, personId: true } })
    : [];
  const meetings = groupIds.length
    ? await db.event.findMany({
        where: { orgId, kind: "group_meeting", groupId: { in: groupIds }, startsAt: { gte: subDays(new Date(), 180) } },
        orderBy: { startsAt: "desc" },
        select: { id: true, groupId: true, startsAt: true },
      })
    : [];
  const meetingIds = meetings.map((m) => m.id);
  const attendance = meetingIds.length
    ? await db.attendanceRecord.findMany({ where: { orgId, eventId: { in: meetingIds }, status: { in: PRESENT } }, select: { personId: true, eventId: true } })
    : [];
  const presentByEvent = new Map<string, Set<string>>();
  for (const a of attendance) {
    presentByEvent.set(a.eventId, presentByEvent.get(a.eventId) ?? new Set());
    presentByEvent.get(a.eventId)!.add(a.personId);
  }
  const personIds = [...new Set(members.map((m) => m.personId))];
  const people = personIds.length ? await db.person.findMany({ where: { id: { in: personIds } } }) : [];
  const pMap = new Map(people.map((p) => [p.id, p] as const));

  const memberCountBy = new Map<string, number>();
  for (const m of members) memberCountBy.set(m.groupId, (memberCountBy.get(m.groupId) ?? 0) + 1);

  const groupRows = groups.map((g) => {
    const memberCount = memberCountBy.get(g.id) ?? 0;
    const gMeetings = meetings.filter((m) => m.groupId === g.id);
    const last6 = gMeetings.slice(0, 6);
    const last3 = gMeetings.slice(0, 3);
    const avgAttendance = last6.length
      ? Math.round((last6.reduce((a, m) => a + (presentByEvent.get(m.id)?.size ?? 0), 0) / last6.length) * 10) / 10
      : 0;
    const absenteeCount =
      last3.length
        ? members.filter((m) => {
            if (m.groupId !== g.id) return false;
            return last3.every((m2) => !presentByEvent.get(m2.id)?.has(m.personId));
          }).length
        : 0;
    const leader = g.leaderPersonId ? pMap.get(g.leaderPersonId) : null;
    return {
      id: g.id,
      name: g.name,
      leader: leader ? nameOf(leader) : null,
      memberCount,
      capacity: g.capacity,
      fillRate: g.capacity ? Math.round((memberCount / g.capacity) * 100) : null,
      avgAttendance,
      absenteeCount,
    };
  });

  const joinRequestsPending = await db.joinRequest.count({ where: { orgId, status: "pending" } });
  return {
    groups: groupRows,
    leaderless: groups.filter((g) => !g.leaderPersonId).map((g) => g.name),
    joinRequestsPending,
  };
}

// ── volunteers health ────────────────────────────────────────────────────────

export async function volunteersReport(user: SessionUser) {
  const orgId = user.orgId;
  const now = new Date();

  // fill rate over the next 4 Sundays
  const in4Weeks = addDays(now, 28);
  const upcoming = await db.event.findMany({
    where: { orgId, kind: "service", startsAt: { gte: now, lte: in4Weeks } },
    include: { assignments: { select: { status: true } } },
    orderBy: { startsAt: "asc" },
  });
  const seenWeeks = new Set<number>();
  const next4 = upcoming.filter((e) => {
    const wk = startOfWeek(e.startsAt, MON).getTime();
    if (seenWeeks.has(wk) || seenWeeks.size >= 4) return false;
    seenWeeks.add(wk);
    return true;
  });
  const fillRates = next4.map((e) => {
    const total = e.assignments.length;
    const filled = e.assignments.filter((a) => CONFIRMED.includes(a.status)).length;
    return total ? filled / total : 0;
  });
  const fillRateNext4 = fillRates.length ? Math.round((fillRates.reduce((a, b) => a + b, 0) / fillRates.length) * 100) : 0;

  // no-show rate, last 90 days
  const since90 = new Date(now.getTime() - 90 * DAY_MS);
  const recent = await db.assignment.findMany({
    where: { orgId, startsAt: { gte: since90 } },
    select: { status: true, startsAt: true, volunteerRoleId: true, role: { select: { name: true } }, eventId: true, event: { select: { startsAt: true } } },
  });
  const served = recent.filter((a) => a.status === "served").length;
  const noShows = recent.filter((a) => a.status === "no_show").length;
  const noShowRate90 = served + noShows ? Math.round((noShows / (served + noShows)) * 100) : 0;

  // needs for the next Sunday, per role
  const sunday = upcomingSunday(now);
  const sundayEvents = await db.event.findMany({
    where: { orgId, kind: "service", startsAt: { gte: sunday, lt: addDays(sunday, 1) } },
    select: { id: true },
  });
  const sundayAssignments = sundayEvents.length
    ? await db.assignment.findMany({
        where: { orgId, eventId: { in: sundayEvents.map((e) => e.id) } },
        include: { role: { select: { name: true } } },
      })
    : [];
  const byRole = new Map<string, { role: string; confirmed: number; needed: number }>();
  for (const a of sundayAssignments) {
    byRole.set(a.volunteerRoleId, byRole.get(a.volunteerRoleId) ?? { role: a.role.name, confirmed: 0, needed: 0 });
    const r = byRole.get(a.volunteerRoleId)!;
    r.needed += 1;
    if (CONFIRMED.includes(a.status)) r.confirmed += 1;
  }
  const needsByRole = [...byRole.values()].sort((a, b) => a.role.localeCompare(b.role));

  // health — worst reliability first
  const ninetyDaysAgo = subDays(now, 90);
  const assignments = await db.assignment.findMany({
    where: { orgId, startsAt: { gte: ninetyDaysAgo } },
    select: { personId: true, status: true },
  });
  const agg: Record<string, { served: number; declined: number; noShows: number }> = {};
  for (const a of assignments) {
    agg[a.personId] ??= { served: 0, declined: 0, noShows: 0 };
    if (a.status === "served") agg[a.personId].served += 1;
    if (a.status === "declined") agg[a.personId].declined += 1;
    if (a.status === "no_show") agg[a.personId].noShows += 1;
  }
  const hPeople = Object.keys(agg).length ? await db.person.findMany({ where: { id: { in: Object.keys(agg) } } }) : [];
  const hMap = new Map(hPeople.map((p) => [p.id, p] as const));
  const health = Object.entries(agg)
    .map(([personId, s]) => {
      const denom = s.served + s.noShows;
      return {
        name: nameOf(hMap.get(personId)),
        served90: s.served,
        declined: s.declined,
        noShows: s.noShows,
        reliability: denom ? Math.round((s.served / denom) * 100) : 100,
      };
    })
    .sort((a, b) => a.reliability - b.reliability)
    .slice(0, 10);

  return { fillRateNext4, noShowRate90, needsByRole, health };
}

// ── new people ───────────────────────────────────────────────────────────────

export async function newPeopleReport(user: SessionUser, days = 30) {
  const orgId = user.orgId;
  const n = Math.min(365, Math.max(1, Math.round(Number(days) || 30)));
  const now = new Date();
  const since = subDays(now, n);

  const newPeople = await db.person.findMany({
    where: { orgId, deletedAt: null, firstVisitAt: { gte: since } },
    orderBy: { firstVisitAt: "desc" },
    take: 100,
  });
  const ids = newPeople.map((p) => p.id);
  const memberships = ids.length
    ? await db.groupMember.findMany({ where: { orgId, personId: { in: ids }, status: "active" }, select: { personId: true } })
    : [];
  const inGroup = new Set(memberships.map((m) => m.personId));
  const followUps = await followUpStatuses(orgId, ids);
  const firstTime = newPeople.map((p) => ({
    id: p.id,
    name: nameOf(p),
    firstVisitAt: p.firstVisitAt,
    inGroup: inGroup.has(p.id),
    followUpStatus: followUps[p.id] ?? "pending",
  }));

  const moves = await db.stageHistory.findMany({
    where: { orgId, changedAt: { gte: since }, previousStage: { not: null } },
    orderBy: { changedAt: "desc" },
    take: 100,
  });
  const movePeople = moves.length ? await db.person.findMany({ where: { id: { in: [...new Set(moves.map((m) => m.personId))] } } }) : [];
  const mpMap = new Map(movePeople.map((p) => [p.id, p] as const));
  const movedStages = moves.map((m) => ({
    name: nameOf(mpMap.get(m.personId)),
    from: m.previousStage,
    to: m.stage,
    at: m.changedAt,
  }));

  const guestsToIntegrating = moves.filter((m) => ["attender", "member"].includes(m.stage)).length;

  return { firstTime, movedStages, guestsToIntegrating };
}

// ── metric dictionary ────────────────────────────────────────────────────────

export function metricDictionary() {
  return {
    items: [
      {
        key: "headcount",
        name: "Headcount",
        definition:
          "A number a human counted — ushers or a roster keeper tally everyone present in the room, including guests and children. No check-in system required, so it works for every gathering.",
        formula: "Σ attendance rows (any method) with present-like status, grouped by week (Mon–Sun)",
      },
      {
        key: "checked_in",
        name: "Checked-in",
        definition:
          "People who checked in through a kiosk or self check-in. The most precise number, but only counts rooms where check-in is enabled (usually kids).",
        formula: "Σ attendance rows where method = kiosk and status is present-like",
      },
      {
        key: "unique_attender",
        name: "Unique attender",
        definition: "Distinct people — not visits — present in the window. Someone who came twice counts once.",
        formula: "COUNT(DISTINCT personId) over present-like attendance in the period",
      },
      {
        key: "giving_gross",
        name: "Giving (gross)",
        definition:
          "All posted contributions before payment fees. Gifts are append-only: corrections are separate reversal records, so history is never rewritten.",
        formula: "Σ amountCents of posted donations (reversal records excluded)",
      },
      {
        key: "giving_net",
        name: "Giving (net)",
        definition: "Posted contributions after processor fees — what actually reaches the bank account.",
        formula: "Σ (amountCents − feeCents) of posted donations",
      },
      {
        key: "pledge_progress",
        name: "Pledge progress",
        definition: "How much of a campaign's pledged total has actually been received so far.",
        formula: "receivedCents ÷ pledgedCents × 100 (received = posted gift splits to the pledge funds by pledgers since the pledge start)",
      },
      {
        key: "fill_rate",
        name: "Fill rate",
        definition: "The share of volunteer positions that are staffed for a service or plan.",
        formula: "(accepted + confirmed + served) ÷ total positions × 100",
      },
      {
        key: "no_show_rate",
        name: "No-show rate",
        definition: "The share of scheduled volunteers who did not show up and did not decline beforehand.",
        formula: "no_shows ÷ (served + no_shows) × 100, over the trailing 90 days",
      },
    ],
  };
}
