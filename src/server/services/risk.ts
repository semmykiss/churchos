import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { badRequest, forbidden, notFound } from "@/server/http";
import { can, type SessionUser } from "@/server/permissions";
import { pickAssignee } from "@/server/services/pipeline";
import { assertFeature } from "@/server/services/features";
import { money } from "@/server/services/giving";

/**
 * Care Radar — deterministic, explainable at-risk member detection.
 *
 * ETHICAL CONTRACT (non-negotiable):
 *  • Detection is 100% deterministic (threshold rules over attendance, giving
 *    pattern and group engagement) — the LLM NEVER computes or infers risk.
 *    An optional Shepherd AI tool only re-words the structured signals.
 *  • Every flag ships with plain-language reasoning + the exact counts that
 *    triggered it. No opaque score without explanation.
 *  • No automated outreach/status changes: urgent flags only SUGGEST a
 *    follow-up task for a human; nothing is ever sent or changed automatically.
 *  • Giving-derived signals store a sanitized detail (shown to every care
 *    viewer) and a restricted detail with amounts (rendered ONLY to viewers
 *    holding `giving.view.all` — the same permission the normal Giving UI
 *    requires, honoring church.settings.pastorCanViewIndividualGiving which
 *    is applied at session build). No financial back-door.
 *  • Inputs: existing AttendanceRecord / Donation / GroupMember data only.
 *    No health, family or other special-category data is ever read.
 *  • Append-only RiskFlagHistory = full audit trail of computation + actions.
 */

export type RiskLevel = "watch" | "elevated" | "urgent";
export type SignalType = "attendance_decline" | "giving_decline" | "engagement_drop";

export interface RiskSignal {
  type: SignalType;
  severity: 1 | 2 | 3;
  /** Safe for ANY care.risk viewer (never contains amounts). */
  detail: string;
  /** Contains amounts — only ever rendered/returned to giving.view.all viewers. */
  detailRestricted?: string;
  /** Machine-readable grounding (counts/dates) — feeding explain tools & tests. */
  data?: Record<string, number | string | null>;
}

// ── default thresholds (sensible, church-tunable) ───────────────────────────

export interface AttendanceThresholds { lookbackEvents: number; maxAttended: number; priorMonths: number }
export interface GivingThresholds { trailingDays: number; baselineMonths: number; dropPct: number; floorCents: number }
export interface EngagementThresholds { missStreak: number }

export const DEFAULT_RULES: Record<SignalType, { thresholdJson: string; weight: number; enabled: boolean }> = {
  attendance_decline: {
    thresholdJson: JSON.stringify({ lookbackEvents: 6, maxAttended: 1, priorMonths: 6 } satisfies AttendanceThresholds),
    weight: 2,
    enabled: true,
  },
  giving_decline: {
    thresholdJson: JSON.stringify({ trailingDays: 30, baselineMonths: 3, dropPct: 50, floorCents: 50000 } satisfies GivingThresholds),
    weight: 1,
    enabled: true,
  },
  engagement_drop: {
    thresholdJson: JSON.stringify({ missStreak: 3 } satisfies EngagementThresholds),
    weight: 1,
    enabled: true,
  },
};

const DEFAULT_ATTENDANCE = JSON.parse(DEFAULT_RULES.attendance_decline.thresholdJson) as AttendanceThresholds;
const DEFAULT_GIVING = JSON.parse(DEFAULT_RULES.giving_decline.thresholdJson) as GivingThresholds;
const DEFAULT_ENGAGEMENT = JSON.parse(DEFAULT_RULES.engagement_drop.thresholdJson) as EngagementThresholds;

const LEVEL_BY_SEVERITY: Record<number, RiskLevel> = { 1: "watch", 2: "elevated", 3: "urgent" };
const SEVERITY_BY_LEVEL: Record<RiskLevel, number> = { watch: 1, elevated: 2, urgent: 3 };
const DAY_MS = 86400000;

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  try { return raw ? (JSON.parse(raw) as T) : fallback; } catch { return fallback; }
}

export function riskScope(user: SessionUser): "all" | "led_groups" {
  if (can(user, "care.risk.view.all")) return "all";
  if (can(user, "care.risk.view")) return "led_groups";
  throw forbidden('Requires "care.risk.view" or "care.risk.view.all" permission.');
}

async function ensureRules(orgId: string) {
  const existing = await db.riskScoringRule.findMany({ where: { orgId } });
  const missing = (Object.keys(DEFAULT_RULES) as SignalType[]).filter((t) => !existing.some((r) => r.signalType === t));
  if (missing.length) {
    await db.riskScoringRule.createMany({
      data: missing.map((signalType) => ({ orgId, signalType, ...DEFAULT_RULES[signalType] })),
    });
    return db.riskScoringRule.findMany({ where: { orgId } });
  }
  return existing;
}

// ── signal computation (pure, deterministic, unit-testable) ─────────────────

async function attendanceSignal(
  orgId: string,
  personId: string,
  t: AttendanceThresholds,
  now: Date,
): Promise<RiskSignal | null> {
  const services = await db.event.findMany({
    where: { orgId, kind: "service", startsAt: { lte: now }, status: { not: "cancelled" } },
    orderBy: { startsAt: "desc" },
    take: Math.max(t.lookbackEvents, 1),
    select: { id: true, name: true, startsAt: true },
  });
  if (services.length < t.lookbackEvents) return null; // not enough history yet

  const records = await db.attendanceRecord.findMany({
    where: { orgId, personId, eventId: { in: services.map((s) => s.id) } },
    select: { eventId: true, status: true },
  });
  const presentEvents = new Set(
    records.filter((r) => ["present", "checked_in", "checked_out", "late"].includes(r.status)).map((r) => r.eventId),
  );
  const attended = services.filter((s) => presentEvents.has(s.id)).length;

  // Only meaningful if the person was attending before the window.
  const priorFrom = new Date(services[services.length - 1].startsAt.getTime() - t.priorMonths * 30 * DAY_MS);
  const priorCount = await db.attendanceRecord.count({
    where: { orgId, personId, status: { in: ["present", "checked_in", "checked_out", "late"] }, checkedInAt: { gte: priorFrom, lt: services[services.length - 1].startsAt } },
  });
  if (attended > t.maxAttended || priorCount === 0) return null;

  const lastPresent = services.find((s) => presentEvents.has(s.id))?.startsAt ?? null;
  const severity: 2 | 3 = attended === 0 ? 3 : 2;
  return {
    type: "attendance_decline",
    severity,
    detail: `Attendance: present at ${attended} of the last ${services.length} Sunday services (they attended ${priorCount}× in the ${t.priorMonths} months before that window).`,
    data: {
      attended,
      lookback: services.length,
      priorCount,
      lastAttendedAt: lastPresent ? lastPresent.toISOString().slice(0, 10) : null,
    },
  };
}

async function givingSignal(
  orgId: string,
  personId: string,
  t: GivingThresholds,
  now: Date,
): Promise<RiskSignal | null> {
  const trailingFrom = new Date(now.getTime() - t.trailingDays * DAY_MS);
  const baselineTo = new Date(trailingFrom.getTime());
  const baselineFrom = new Date(baselineTo.getTime() - t.baselineMonths * 30 * DAY_MS);

  const [trailingAgg, baselineAgg] = await Promise.all([
    db.donation.aggregate({
      _sum: { amountCents: true },
      where: { orgId, personId, status: "posted", receivedOn: { gte: trailingFrom, lte: now } },
    }),
    db.donation.aggregate({
      _sum: { amountCents: true },
      where: { orgId, personId, status: "posted", receivedOn: { gte: baselineFrom, lt: baselineTo } },
    }),
  ]);
  const currentCents = trailingAgg._sum.amountCents ?? 0;
  const baselineTotalCents = baselineAgg._sum.amountCents ?? 0;
  if (baselineTotalCents < t.floorCents) return null; // too little history to judge

  const monthlyAvgCents = Math.round(baselineTotalCents / t.baselineMonths);
  const dropPct = monthlyAvgCents > 0 ? Math.round(((monthlyAvgCents - currentCents) / monthlyAvgCents) * 100) : 0;
  if (dropPct < t.dropPct) return null;

  const severity: 2 | 3 = currentCents === 0 || dropPct >= t.dropPct * 2 ? 3 : 2;
  return {
    type: "giving_decline",
    severity,
    detail: `Giving pattern changed: down ~${dropPct}% versus their prior ${t.baselineMonths}-month average.`,
    detailRestricted: `Giving: ${money(currentCents)} in the last ${t.trailingDays} days vs ${money(monthlyAvgCents)}/month average over the prior ${t.baselineMonths} months (down ${dropPct}%).`,
    data: { currentCents, monthlyAvgCents, dropPct, baselineTotalCents },
  };
}

async function engagementSignal(
  orgId: string,
  personId: string,
  t: EngagementThresholds,
): Promise<RiskSignal | null> {
  const memberships = await db.groupMember.findMany({
    where: { orgId, personId, status: "active", group: { type: "small_group", deletedAt: null } },
    include: { group: { select: { id: true, name: true } } },
  });
  if (!memberships.length) return null;

  for (const m of memberships) {
    const meetings = await db.event.findMany({
      where: { orgId, groupId: m.group.id, kind: "group_meeting", startsAt: { lte: new Date() }, status: { not: "cancelled" } },
      orderBy: { startsAt: "desc" },
      take: t.missStreak,
      select: { id: true, startsAt: true },
    });
    if (meetings.length < t.missStreak) continue;
    const recs = await db.attendanceRecord.findMany({
      where: { orgId, personId, eventId: { in: meetings.map((e) => e.id) } },
      select: { eventId: true, status: true },
    });
    const present = new Set(recs.filter((r) => ["present", "checked_in", "checked_out", "late"].includes(r.status)).map((r) => r.eventId));
    const missed = meetings.filter((e) => !present.has(e.id)).length;
    if (missed >= t.missStreak) {
      const severity: 2 | 3 = missed >= t.missStreak + 3 ? 3 : 2;
      return {
        type: "engagement_drop",
        severity,
        detail: `Small group "${m.group.name}": missed the last ${missed} meetings.`,
        data: { groupId: m.group.id, groupName: m.group.name, missed, checked: meetings.length },
      };
    }
  }
  return null;
}

export async function computeSignalsForPerson(
  orgId: string,
  personId: string,
  rules: Map<SignalType, { thresholdJson: string; enabled: boolean }>,
  now: Date,
): Promise<RiskSignal[]> {
  const signals: RiskSignal[] = [];
  const att = rules.get("attendance_decline");
  if (att?.enabled) {
    const s = await attendanceSignal(orgId, personId, parseJson<AttendanceThresholds>(att.thresholdJson, DEFAULT_ATTENDANCE), now);
    if (s) signals.push(s);
  }
  const giv = rules.get("giving_decline");
  if (giv?.enabled) {
    const s = await givingSignal(orgId, personId, parseJson<GivingThresholds>(giv.thresholdJson, DEFAULT_GIVING), now);
    if (s) signals.push(s);
  }
  const eng = rules.get("engagement_drop");
  if (eng?.enabled) {
    const s = await engagementSignal(orgId, personId, parseJson<EngagementThresholds>(eng.thresholdJson, DEFAULT_ENGAGEMENT));
    if (s) signals.push(s);
  }
  return signals;
}

function levelFor(signals: RiskSignal[]): RiskLevel {
  const max = signals.reduce((m, s) => Math.max(m, s.severity), 0);
  return LEVEL_BY_SEVERITY[max] ?? "watch";
}

// ── recalculation (request-driven, throttled — nightly-job surrogate) ───────

const RECALC_THROTTLE_MS = 6 * 60 * 60 * 1000; // 6h

export async function recalculateRiskFlags(
  actor: { orgId: string; membershipId?: string; name: string },
  opts: { force?: boolean } = {},
): Promise<{ ran: boolean; computed: number; created: number; escalated: number; deescalated: number; cleared: number; suggestedTasks: number }> {
  await assertFeature(actor.orgId, "featureCareRadar");
  const now = new Date();

  if (!opts.force) {
    const last = await db.riskFlagHistory.findFirst({
      where: { orgId: actor.orgId, action: { in: ["computed", "escalated", "deescalated", "recalc_cleared"] } },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    if (last && now.getTime() - last.createdAt.getTime() < RECALC_THROTTLE_MS) {
      return { ran: false, computed: 0, created: 0, escalated: 0, deescalated: 0, cleared: 0, suggestedTasks: 0 };
    }
  }

  const ruleRows = await ensureRules(actor.orgId);
  const rules = new Map(ruleRows.map((r) => [r.signalType as SignalType, { thresholdJson: r.thresholdJson, enabled: r.enabled }] as const));

  const people = await db.person.findMany({
    where: { orgId: actor.orgId, status: "active" },
    select: { id: true, firstName: true, lastName: true },
  });
  const existingFlags = await db.memberRiskFlag.findMany({ where: { orgId: actor.orgId } });
  const flagMap = new Map(existingFlags.map((f) => [f.personId, f] as const));

  const summary = { ran: true, computed: 0, created: 0, escalated: 0, deescalated: 0, cleared: 0, suggestedTasks: 0 };

  for (const person of people) {
    const signals = await computeSignalsForPerson(actor.orgId, person.id, rules, now);
    summary.computed++;
    const prev = flagMap.get(person.id);
    const signalsJson = JSON.stringify(signals);

    if (!signals.length) {
      if (prev && ["new", "acknowledged", "in_progress"].includes(prev.status)) {
        summary.cleared++;
        await db.riskFlagHistory.create({
          data: {
            orgId: actor.orgId, personId: person.id, flagId: prev.id, riskLevel: prev.riskLevel,
            signalsJson, action: "recalc_cleared",
            actorMembershipId: actor.membershipId ?? null, actorName: "Care Radar (system)",
            note: "Signals no longer meet thresholds — awaiting human review/resolution.",
          },
        });
      }
      continue;
    }

    const level = levelFor(signals);

    if (!prev) {
      const flag = await db.memberRiskFlag.create({
        data: { orgId: actor.orgId, personId: person.id, riskLevel: level, signalsJson, computedAt: now },
      });
      summary.created++;
      await db.riskFlagHistory.create({
        data: { orgId: actor.orgId, personId: person.id, flagId: flag.id, riskLevel: level, signalsJson, action: "computed", actorMembershipId: actor.membershipId ?? null, actorName: "Care Radar (system)" },
      });
      if (level === "urgent") summary.suggestedTasks += await ensureSuggestedTask(actor.orgId, person, now);
      continue;
    }

    if (prev.status === "resolved" || prev.status === "dismissed") continue; // human closed it — never reopen silently

    const changed = prev.riskLevel !== level || signalsJson !== prev.signalsJson;
    if (!changed) {
      await db.memberRiskFlag.update({ where: { id: prev.id }, data: { computedAt: now } });
      continue;
    }

    const action = SEVERITY_BY_LEVEL[level] > SEVERITY_BY_LEVEL[prev.riskLevel as RiskLevel] ? "escalated" : "deescalated";
    await db.memberRiskFlag.update({ where: { id: prev.id }, data: { riskLevel: level, signalsJson, computedAt: now } });
    await db.riskFlagHistory.create({
      data: { orgId: actor.orgId, personId: person.id, flagId: prev.id, riskLevel: level, signalsJson, action, actorMembershipId: actor.membershipId ?? null, actorName: "Care Radar (system)", note: `${prev.riskLevel} → ${level}` },
    });
    if (action === "escalated") summary.escalated++; else summary.deescalated++;
    if (level === "urgent" && prev.riskLevel !== "urgent") summary.suggestedTasks += await ensureSuggestedTask(actor.orgId, person, now);
  }

  await audit({
    orgId: actor.orgId,
    actor: { membershipId: actor.membershipId ?? "system", userId: "system", name: actor.name } as never,
    action: "risk.recalculate",
    entityType: "care_radar",
    entityId: actor.orgId,
    after: summary as unknown as Record<string, unknown>,
  });
  return summary;
}

/** Urgent flags SUGGEST a follow-up task (round-robin per existing pipeline logic) — a task for a human, never an automated message. */
async function ensureSuggestedTask(orgId: string, person: { id: string; firstName: string; lastName: string }, now: Date): Promise<number> {
  const open = await db.followUpTask.findFirst({
    where: { orgId, personId: person.id, status: { in: ["pending", "overdue"] }, title: { startsWith: "[Care Radar]" } },
    select: { id: true },
  });
  if (open) return 0;
  const assignee = await pickAssignee(orgId, null);
  await db.followUpTask.create({
    data: {
      orgId,
      personId: person.id,
      title: `[Care Radar] Reach out to ${person.firstName} ${person.lastName} (urgent risk flag)`,
      assignedToMembershipId: assignee?.membershipId ?? null,
      assignedToName: assignee?.name ?? null,
      dueDate: new Date(now.getTime() + 3 * DAY_MS),
    },
  });
  return 1;
}

// ── viewer-scoped reads ──────────────────────────────────────────────────────

/** Resolve the set of personIds the viewer may see flags for (scoped leaders see only their groups). */
async function visiblePersonFilter(user: SessionUser): Promise<Record<string, unknown>> {
  const scope = riskScope(user);
  if (scope === "all") return { orgId: user.orgId };
  const ledGroups = await db.group.findMany({
    where: { orgId: user.orgId, leaderPersonId: user.personId ?? "__none__", deletedAt: null },
    select: { id: true },
  });
  const members = ledGroups.length
    ? await db.groupMember.findMany({ where: { orgId: user.orgId, groupId: { in: ledGroups.map((g) => g.id) }, status: "active" }, select: { personId: true } })
    : [];
  return { orgId: user.orgId, personId: { in: members.map((m) => m.personId) } };
}

/**
 * Render signals for a viewer: strip amount-bearing restricted detail AND any
 * raw financial figures in the machine-readable grounding data unless the
 * viewer holds giving.view.all (same rule as the Giving UI itself).
 */
function renderSignals(signals: RiskSignal[], canSeeAmounts: boolean): RiskSignal[] {
  return signals.map((s) => {
    if (canSeeAmounts) return s;
    // Sanitize data: drop every cents-bearing field for giving signals; keep
    // only the non-financial grounding (percentages, counts, dates, names).
    const safeData = s.data
      ? Object.fromEntries(
          Object.entries(s.data).filter(
            ([k, v]) => !(k.toLowerCase().includes("cents") || (k === "floorCents" && typeof v === "number")) && k !== "amountCents",
          ),
        )
      : undefined;
    const { detailRestricted: _omit, ...rest } = s;
    return { ...rest, data: safeData } as RiskSignal;
  });
}

export async function listRiskFlags(
  user: SessionUser,
  q: { status?: string; level?: string } = {},
) {
  await assertFeature(user.orgId, "featureCareRadar");
  const where = (await visiblePersonFilter(user)) as { orgId: string; personId?: object; status?: string; riskLevel?: string };
  if (q.status && q.status !== "all") where.status = q.status;
  if (q.level && q.level !== "all") where.riskLevel = q.level;
  const flags = await db.memberRiskFlag.findMany({ where, orderBy: [{ computedAt: "desc" }], take: 300 });

  const personIds = [...new Set(flags.map((f) => f.personId))];
  const people = personIds.length
    ? await db.person.findMany({ where: { id: { in: personIds } }, select: { id: true, firstName: true, lastName: true, lifecycleStage: true, photoUrl: true } })
    : [];
  const pMap = new Map(people.map((p) => [p.id, p] as const));
  const canSeeAmounts = can(user, "giving.view.all");

  const items = flags
    .filter((f) => pMap.has(f.personId))
    .map((f) => {
      const signals = renderSignals(parseJson<RiskSignal[]>(f.signalsJson, []), canSeeAmounts);
      const p = pMap.get(f.personId)!;
      return {
        id: f.id,
        person: { id: p.id, name: `${p.firstName} ${p.lastName}`, lifecycleStage: p.lifecycleStage, photoUrl: p.photoUrl },
        riskLevel: f.riskLevel,
        status: f.status,
        computedAt: f.computedAt,
        acknowledgedAt: f.acknowledgedAt,
        topSignals: signals.slice(0, 2).map((s) => ({ type: s.type, severity: s.severity, detail: s.detail })),
        signalCount: signals.length,
      };
    });
  return { items, scope: riskScope(user) };
}

async function assertFlagVisible(user: SessionUser, flag: { orgId: string; personId: string }) {
  const scope = riskScope(user);
  if (scope === "all") return;
  const ledGroups = await db.group.findMany({
    where: { orgId: user.orgId, leaderPersonId: user.personId ?? "__none__", deletedAt: null },
    select: { id: true },
  });
  const member = ledGroups.length
    ? await db.groupMember.findFirst({ where: { orgId: user.orgId, groupId: { in: ledGroups.map((g) => g.id) }, personId: flag.personId, status: "active" }, select: { id: true } })
    : null;
  if (!member) throw forbidden("This person is not in a group you lead.");
}

export async function getRiskFlag(user: SessionUser, flagId: string) {
  await assertFeature(user.orgId, "featureCareRadar");
  const flag = await db.memberRiskFlag.findFirst({ where: { id: flagId, orgId: user.orgId } });
  if (!flag) throw notFound("Risk flag not found.");
  await assertFlagVisible(user, flag);

  const canSeeAmounts = can(user, "giving.view.all");
  const signals = renderSignals(parseJson<RiskSignal[]>(flag.signalsJson, []), canSeeAmounts);
  const person = await db.person.findUnique({
    where: { id: flag.personId },
    select: { id: true, firstName: true, lastName: true, lifecycleStage: true, photoUrl: true },
  });

  // Trend data — attendance always; group engagement always; giving ONLY with giving.view.all.
  const attendance = await db.attendanceRecord.findMany({
    where: { orgId: user.orgId, personId: flag.personId, status: { in: ["present", "absent", "late", "excused", "checked_in", "checked_out"] } },
    orderBy: { checkedInAt: "desc" },
    take: 12,
    select: { checkedInAt: true, status: true, firstTime: true },
  });
  const givingTrend: { month: string; totalCents: number }[] = [];
  if (canSeeAmounts) {
    const donations = await db.donation.findMany({
      where: { orgId: user.orgId, personId: flag.personId, status: "posted", receivedOn: { gte: new Date(Date.now() - 180 * DAY_MS) } },
      select: { receivedOn: true, amountCents: true },
    });
    const byMonth = new Map<string, number>();
    for (const d of donations) {
      const key = d.receivedOn.toISOString().slice(0, 7);
      byMonth.set(key, (byMonth.get(key) ?? 0) + d.amountCents);
    }
    for (const [month, totalCents] of [...byMonth.entries()].sort()) givingTrend.push({ month, totalCents });
  }

  const history = await db.riskFlagHistory.findMany({
    where: { orgId: user.orgId, personId: flag.personId },
    orderBy: { createdAt: "desc" },
    take: 25,
  });

  return {
    flag: {
      id: flag.id,
      person: person ? { id: person.id, name: `${person.firstName} ${person.lastName}`, lifecycleStage: person.lifecycleStage, photoUrl: person.photoUrl } : null,
      riskLevel: flag.riskLevel,
      status: flag.status,
      computedAt: flag.computedAt,
      acknowledgedAt: flag.acknowledgedAt,
      acknowledgedByName: flag.acknowledgedByName,
      resolutionNote: flag.resolutionNote,
      resolvedAt: flag.resolvedAt,
    },
    signals,
    showsAmounts: canSeeAmounts,
    trend: {
      attendance: attendance.reverse().map((a) => ({ at: a.checkedInAt, present: ["present", "checked_in", "checked_out", "late"].includes(a.status) })),
      giving: givingTrend,
    },
    history: history.map((h) => ({
      id: h.id, riskLevel: h.riskLevel, action: h.action, actorName: h.actorName, note: h.note, createdAt: h.createdAt,
    })),
  };
}

/** Person-scoped flags for the PersonDetailDialog "Risk Signals" section. */
export async function listFlagsForPerson(user: SessionUser, personId: string) {
  await assertFeature(user.orgId, "featureCareRadar");
  const flag = await db.memberRiskFlag.findUnique({
    where: { orgId_personId: { orgId: user.orgId, personId } },
  });
  if (!flag) return { flag: null, visible: true };
  await assertFlagVisible(user, flag);
  const signals = renderSignals(parseJson<RiskSignal[]>(flag.signalsJson, []), can(user, "giving.view.all"));
  return {
    flag: {
      id: flag.id, riskLevel: flag.riskLevel, status: flag.status, computedAt: flag.computedAt,
      topSignals: signals.slice(0, 3).map((s) => ({ type: s.type, severity: s.severity, detail: s.detail })),
    },
    visible: true,
  };
}

// ── human actions (the ONLY way a flag changes status) ───────────────────────

async function assertManage(user: SessionUser, flag: { orgId: string; personId: string }) {
  if (!can(user, "care.risk.manage")) throw forbidden('Requires "care.risk.manage" permission.');
  await assertFlagVisible(user, flag);
}

async function historyFor(user: SessionUser, flag: { orgId: string; personId: string; id: string; riskLevel: string }, action: string, note?: string) {
  await db.riskFlagHistory.create({
    data: {
      orgId: user.orgId, personId: flag.personId, flagId: flag.id, riskLevel: flag.riskLevel,
      signalsJson: "[]", action, actorMembershipId: user.membershipId, actorName: user.name, note: note ?? null,
    },
  });
}

export async function acknowledgeFlag(user: SessionUser, flagId: string, meta: { ip?: string; userAgent?: string }) {
  const flag = await db.memberRiskFlag.findFirst({ where: { id: flagId, orgId: user.orgId } });
  if (!flag) throw notFound("Risk flag not found.");
  await assertManage(user, flag);
  const updated = await db.memberRiskFlag.update({
    where: { id: flag.id },
    data: { status: "acknowledged", acknowledgedByMembershipId: user.membershipId, acknowledgedByName: user.name, acknowledgedAt: new Date() },
  });
  await historyFor(user, updated, "acknowledged");
  await audit({ orgId: user.orgId, actor: user, action: "risk.flag_acknowledge", entityType: "risk_flag", entityId: flag.id, ip: meta.ip, userAgent: meta.userAgent });
  return { ok: true, status: updated.status };
}

export async function startProgressFlag(user: SessionUser, flagId: string, meta: { ip?: string; userAgent?: string }) {
  const flag = await db.memberRiskFlag.findFirst({ where: { id: flagId, orgId: user.orgId } });
  if (!flag) throw notFound("Risk flag not found.");
  await assertManage(user, flag);
  const updated = await db.memberRiskFlag.update({ where: { id: flag.id }, data: { status: "in_progress" } });
  await historyFor(user, updated, "acknowledged", "Status set to in progress");
  await audit({ orgId: user.orgId, actor: user, action: "risk.flag_progress", entityType: "risk_flag", entityId: flag.id, ip: meta.ip, userAgent: meta.userAgent });
  return { ok: true, status: updated.status };
}

export async function resolveFlag(user: SessionUser, flagId: string, note: string, meta: { ip?: string; userAgent?: string }) {
  if (!note?.trim()) throw badRequest("A resolution note is required.");
  const flag = await db.memberRiskFlag.findFirst({ where: { id: flagId, orgId: user.orgId } });
  if (!flag) throw notFound("Risk flag not found.");
  await assertManage(user, flag);
  const updated = await db.memberRiskFlag.update({
    where: { id: flag.id },
    data: { status: "resolved", resolutionNote: note.trim(), resolvedAt: new Date() },
  });
  await historyFor(user, updated, "resolved", note.trim());
  await audit({ orgId: user.orgId, actor: user, action: "risk.flag_resolve", entityType: "risk_flag", entityId: flag.id, after: { note: note.slice(0, 500) }, ip: meta.ip, userAgent: meta.userAgent });
  return { ok: true, status: updated.status };
}

export async function dismissFlag(user: SessionUser, flagId: string, reason: string, meta: { ip?: string; userAgent?: string }) {
  if (!reason?.trim()) throw badRequest("A dismissal reason is required.");
  const flag = await db.memberRiskFlag.findFirst({ where: { id: flagId, orgId: user.orgId } });
  if (!flag) throw notFound("Risk flag not found.");
  await assertManage(user, flag);
  const updated = await db.memberRiskFlag.update({
    where: { id: flag.id },
    data: { status: "dismissed", resolutionNote: reason.trim(), resolvedAt: new Date() },
  });
  await historyFor(user, updated, "dismissed", reason.trim());
  await audit({ orgId: user.orgId, actor: user, action: "risk.flag_dismiss", entityType: "risk_flag", entityId: flag.id, after: { reason: reason.slice(0, 500) }, ip: meta.ip, userAgent: meta.userAgent });
  return { ok: true, status: updated.status };
}

export async function assignFollowUp(user: SessionUser, flagId: string, meta: { ip?: string; userAgent?: string }) {
  const flag = await db.memberRiskFlag.findFirst({ where: { id: flagId, orgId: user.orgId } });
  if (!flag) throw notFound("Risk flag not found.");
  await assertManage(user, flag);
  const person = await db.person.findUnique({ where: { id: flag.personId }, select: { firstName: true, lastName: true } });
  if (!person) throw notFound("Person not found.");
  const assignee = await pickAssignee(user.orgId, null);
  const task = await db.followUpTask.create({
    data: {
      orgId: user.orgId,
      personId: flag.personId,
      title: `[Care Radar] Reach out to ${person.firstName} ${person.lastName} (${flag.riskLevel} flag)`,
      assignedToMembershipId: assignee?.membershipId ?? null,
      assignedToName: assignee?.name ?? null,
      dueDate: new Date(Date.now() + 3 * DAY_MS),
    },
  });
  await historyFor(user, flag, "acknowledged", `Follow-up task assigned to ${assignee?.name ?? "unassigned"} (manual)`);
  await audit({ orgId: user.orgId, actor: user, action: "risk.flag_assign_task", entityType: "risk_flag", entityId: flag.id, after: { taskId: task.id }, ip: meta.ip, userAgent: meta.userAgent });
  return { ok: true, taskId: task.id, assignedTo: assignee?.name ?? null };
}

// ── rules config (admin) ─────────────────────────────────────────────────────

export async function getRules(user: SessionUser) {
  if (!can(user, "care.risk.manage") && !can(user, "care.risk.view.all")) {
    throw forbidden('Requires "care.risk.manage" permission.');
  }
  const rules = await ensureRules(user.orgId);
  return {
    items: rules.map((r) => ({
      id: r.id, signalType: r.signalType as SignalType, enabled: r.enabled, weight: r.weight,
      thresholds: parseJson<Record<string, number>>(r.thresholdJson, {}),
    })),
  };
}

const THRESHOLD_FIELDS: Record<SignalType, string[]> = {
  attendance_decline: ["lookbackEvents", "maxAttended", "priorMonths"],
  giving_decline: ["trailingDays", "baselineMonths", "dropPct", "floorCents"],
  engagement_drop: ["missStreak"],
};

export async function previewRules(user: SessionUser, incoming: { signalType: SignalType; enabled: boolean; thresholds: Record<string, number> }[]) {
  if (!can(user, "care.risk.manage")) throw forbidden('Requires "care.risk.manage" permission.');
  await assertFeature(user.orgId, "featureCareRadar");

  const rules = new Map<string, { thresholdJson: string; enabled: boolean }>();
  for (const item of incoming) {
    if (!THRESHOLD_FIELDS[item.signalType]) throw badRequest(`Unknown signal type "${item.signalType}".`);
    rules.set(item.signalType, { thresholdJson: JSON.stringify(item.thresholds), enabled: item.enabled });
  }

  const now = new Date();
  const people = await db.person.findMany({ where: { orgId: user.orgId, status: "active" }, select: { id: true } });
  const counts = { watch: 0, elevated: 0, urgent: 0 };
  for (const p of people) {
    const signals = await computeSignalsForPerson(user.orgId, p.id, rules as Map<SignalType, { thresholdJson: string; enabled: boolean }>, now);
    if (signals.length) counts[levelFor(signals)]++;
  }
  return { counts, peopleScanned: people.length };
}

export async function updateRules(
  user: SessionUser,
  incoming: { signalType: SignalType; enabled: boolean; thresholds: Record<string, number> }[],
  meta: { ip?: string; userAgent?: string },
) {
  if (!can(user, "care.risk.manage")) throw forbidden('Requires "care.risk.manage" permission.');
  await assertFeature(user.orgId, "featureCareRadar");
  await ensureRules(user.orgId);

  for (const item of incoming) {
    const fields = THRESHOLD_FIELDS[item.signalType];
    if (!fields) throw badRequest(`Unknown signal type "${item.signalType}".`);
    const clean: Record<string, number> = {};
    for (const f of fields) {
      const v = item.thresholds[f];
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0) throw badRequest(`"${f}" must be a non-negative number.`);
      clean[f] = Math.floor(v);
    }
    await db.riskScoringRule.update({
      where: { orgId_signalType: { orgId: user.orgId, signalType: item.signalType } },
      data: { enabled: !!item.enabled, thresholdJson: JSON.stringify(clean) },
    });
  }
  await audit({ orgId: user.orgId, actor: user, action: "risk.rules_update", entityType: "risk_rules", entityId: user.orgId, after: { rules: incoming.map((i) => ({ type: i.signalType, enabled: i.enabled, thresholds: i.thresholds })) }, ip: meta.ip, userAgent: meta.userAgent });

  const summary = await recalculateRiskFlags({ orgId: user.orgId, membershipId: user.membershipId, name: user.name }, { force: true });
  return { ok: true, recalc: summary };
}

// ── grounded AI explanation (re-wording ONLY — never invents reasons) ────────

/** Deterministic explanation text (used by the Shepherd AI tool `explainRiskFlag`). */
export function deterministicExplanation(signals: RiskSignal[], level: RiskLevel, withAmounts: boolean): string {
  const parts = signals.map((s) => (withAmounts && s.detailRestricted ? s.detailRestricted : s.detail));
  if (!parts.length) return "No signals currently meet the configured thresholds.";
  return `This flag is ${level.toUpperCase()} because of ${parts.length} signal${parts.length > 1 ? "s" : ""}: ${parts.join(" ")}`;
}

export async function loadFlagForExplanation(user: SessionUser, flagId: string) {
  const flag = await db.memberRiskFlag.findFirst({ where: { id: flagId, orgId: user.orgId } });
  if (!flag) throw notFound("Risk flag not found.");
  await assertFlagVisible(user, flag);
  const signals = renderSignals(parseJson<RiskSignal[]>(flag.signalsJson, []), can(user, "giving.view.all"));
  return {
    level: flag.riskLevel as RiskLevel,
    signals,
    explanation: deterministicExplanation(signals, flag.riskLevel as RiskLevel, can(user, "giving.view.all")),
  };
}
