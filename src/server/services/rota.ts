import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { badRequest, forbidden, notFound } from "@/server/http";
import { can, type SessionUser } from "@/server/permissions";
import { assertFeature } from "@/server/services/features";
import * as volunteers from "@/server/services/volunteers";

/**
 * Smart Volunteer Scheduling — deterministic constraint solver (backend only).
 *
 * NOT generative: the rota engine is a pure, explainable scoring function.
 * An LLM only (a) re-words why a slot is unfilled / why someone was or wasn't
 * chosen (explainAssignmentConflict — grounded 100% in this engine's output),
 * and (b) powers chat questions ("who's free on the 14th?") via the same
 * eligibility functions. It never assigns anyone by itself.
 *
 * Constraints honored per volunteer (ServingConfig + BlockoutDate):
 *  1. active status, opted into the roster (has a ServingConfig row)
 *  2. role match (roleIdsJson empty = any role)
 *  3. no overlapping blockout (reuses the exact BlockoutDate overlap rule)
 *  4. not served within minDaysBetweenServes
 *  5. not exceeded maxTimesPerMonth (calendar month of the target date)
 * Scoring: days since last served (higher first) → fairness (fewer serves in
 * trailing 90 days first) → then stable name order for determinism.
 * Unfilled roles are returned with per-person exclusion reasons — never silent.
 */

export interface EligibleVolunteer {
  personId: string;
  name: string;
  daysSinceLastServed: number | null;
  servesLast90: number;
  servesThisMonth: number;
  maxTimesPerMonth: number;
  score: number;
}

export interface SlotResult {
  roleId: string;
  roleName: string;
  team?: string | null;
  status: "filled" | "unfilled";
  chosen?: EligibleVolunteer;
  /** Why each candidate was NOT eligible/selected — the grounding for AI explanations. */
  exclusions: { personId: string; name: string; reason: string }[];
  eligibleCount: number;
}

export interface RotaPreviewEvent {
  eventId: string;
  eventName: string;
  startsAt: string;
  slots: SlotResult[];
  filledCount: number;
  totalCount: number;
}

const DAY_MS = 86400000;

function nameOf(p?: { firstName: string; lastName: string } | null): string {
  return p ? `${p.firstName} ${p.lastName}` : "Unknown";
}

function overlapsBlockout(b: { startsOn: Date; endsOn: Date }, eventStartsAt: Date, eventEndsAt: Date): boolean {
  return b.startsOn.getTime() <= eventEndsAt.getTime() && b.endsOn.getTime() >= eventStartsAt.getTime();
}

export async function assertRotaManage(user: SessionUser) {
  if (!can(user, "serving.schedule.manage") && !can(user, "schedule.assign")) {
    throw forbidden('Requires "serving.schedule.manage" or "schedule.assign" permission.');
  }
}

// ── per-volunteer serving config ─────────────────────────────────────────────

export async function listServingConfigs(user: SessionUser) {
  await assertRotaManage(user);
  const configs = await db.servingConfig.findMany({ where: { orgId: user.orgId }, orderBy: { createdAt: "asc" } });
  const people = await db.person.findMany({
    where: { id: { in: configs.map((c) => c.personId) }, status: "active" },
    select: { id: true, firstName: true, lastName: true, photoUrl: true },
  });
  const pMap = new Map(people.map((p) => [p.id, p] as const));
  const roles = await db.volunteerRole.findMany({ where: { orgId: user.orgId, isActive: true }, select: { id: true, name: true, team: true } });
  return {
    items: configs
      .filter((c) => pMap.has(c.personId))
      .map((c) => ({
        id: c.id,
        person: { id: c.personId, name: nameOf(pMap.get(c.personId)), photoUrl: pMap.get(c.personId)?.photoUrl ?? null },
        roleIds: JSON.parse(c.roleIdsJson) as string[],
        roleNames: (JSON.parse(c.roleIdsJson) as string[]).map((id) => roles.find((r) => r.id === id)?.name ?? "—"),
        maxTimesPerMonth: c.maxTimesPerMonth,
        minDaysBetweenServes: c.minDaysBetweenServes,
        status: c.status,
        note: c.note,
      })),
    roles,
  };
}

export async function upsertServingConfig(
  user: SessionUser,
  input: { personId: string; roleIds?: string[]; maxTimesPerMonth?: number; minDaysBetweenServes?: number; status?: string; note?: string },
  meta: { ip?: string; userAgent?: string },
) {
  await assertRotaManage(user);
  if (!input.personId) throw badRequest("personId is required.");
  const person = await db.person.findFirst({ where: { id: input.personId, orgId: user.orgId }, select: { id: true } });
  if (!person) throw notFound("Person not found in this church.");
  const status = ["active", "paused"].includes(input.status ?? "") ? input.status! : "active";
  const maxTimesPerMonth = Math.min(31, Math.max(0, Math.floor(input.maxTimesPerMonth ?? 4)));
  const minDaysBetweenServes = Math.min(60, Math.max(0, Math.floor(input.minDaysBetweenServes ?? 6)));
  const roleIds = (input.roleIds ?? []).filter(Boolean);

  await db.servingConfig.upsert({
    where: { orgId_personId: { orgId: user.orgId, personId: input.personId } },
    create: { orgId: user.orgId, personId: input.personId, roleIdsJson: JSON.stringify(roleIds), maxTimesPerMonth, minDaysBetweenServes, status, note: input.note ?? null },
    update: { roleIdsJson: JSON.stringify(roleIds), maxTimesPerMonth, minDaysBetweenServes, status, note: input.note ?? null },
  });
  await audit({ orgId: user.orgId, actor: user, action: "serving.config_save", entityType: "serving_config", entityId: input.personId, after: { status, maxTimesPerMonth, minDaysBetweenServes }, ip: meta.ip, userAgent: meta.userAgent });
  return { ok: true };
}

/** Volunteer self-service (portal): update OWN availability constraints. */
export async function updateMyServingConfig(
  user: SessionUser,
  input: { roleIds?: string[]; maxTimesPerMonth?: number; minDaysBetweenServes?: number; note?: string },
  meta: { ip?: string; userAgent?: string },
) {
  if (!can(user, "serving.view.own")) throw forbidden('Requires "serving.view.own" permission.');
  if (!user.personId) throw forbidden("Your account is not linked to a people record.");
  const existing = await db.servingConfig.findUnique({ where: { orgId_personId: { orgId: user.orgId, personId: user.personId } } });
  const data = {
    roleIdsJson: JSON.stringify((input.roleIds ?? []).filter(Boolean)),
    maxTimesPerMonth: Math.min(31, Math.max(0, Math.floor(input.maxTimesPerMonth ?? existing?.maxTimesPerMonth ?? 4))),
    minDaysBetweenServes: Math.min(60, Math.max(0, Math.floor(input.minDaysBetweenServes ?? existing?.minDaysBetweenServes ?? 6))),
    note: input.note ?? existing?.note ?? null,
  };
  await db.servingConfig.upsert({
    where: { orgId_personId: { orgId: user.orgId, personId: user.personId } },
    create: { orgId: user.orgId, personId: user.personId, ...data },
    update: data,
  });
  // Self-service blockouts (own availability).
  await audit({ orgId: user.orgId, actor: user, action: "serving.my_config_save", entityType: "serving_config", entityId: user.personId, after: { ...data, roleIds: JSON.parse(data.roleIdsJson) }, ip: meta.ip, userAgent: meta.userAgent });
  return { ok: true };
}


/** Self-service overview: the caller's OWN config + blockouts + selectable roles. */
export async function myServingOverview(user: SessionUser) {
  if (!can(user, "serving.view.own")) throw forbidden('Requires "serving.view.own" permission.');
  if (!user.personId) return { config: null, blockouts: [], roles: [] };
  const config = await db.servingConfig.findUnique({
    where: { orgId_personId: { orgId: user.orgId, personId: user.personId } },
  });
  const blockouts = await db.blockoutDate.findMany({
    where: { orgId: user.orgId, personId: user.personId, endsOn: { gte: new Date() } },
    orderBy: { startsOn: "asc" },
  });
  const roles = await db.volunteerRole.findMany({ where: { orgId: user.orgId, isActive: true }, orderBy: [{ team: "asc" }, { name: "asc" }], select: { id: true, name: true, team: true } });
  return {
    config: config
      ? {
          status: config.status,
          roleIds: JSON.parse(config.roleIdsJson) as string[],
          roleNames: (JSON.parse(config.roleIdsJson) as string[]).map((id) => roles.find((r) => r.id === id)?.name ?? "—"),
          maxTimesPerMonth: config.maxTimesPerMonth,
          minDaysBetweenServes: config.minDaysBetweenServes,
          note: config.note,
        }
      : null,
    blockouts: blockouts.map((b) => ({ id: b.id, startsOn: b.startsOn.toISOString(), endsOn: b.endsOn.toISOString(), reason: b.reason })),
    roles,
  };
}

export async function addMyBlockout(
  user: SessionUser,
  input: { startsOn: string; endsOn: string; reason?: string },
  meta: { ip?: string; userAgent?: string },
) {
  if (!can(user, "serving.view.own")) throw forbidden('Requires "serving.view.own" permission.');
  if (!user.personId) throw forbidden("Your account is not linked to a people record.");
  const startsOn = new Date(input.startsOn);
  const endsOn = new Date(input.endsOn);
  if (isNaN(startsOn.getTime()) || isNaN(endsOn.getTime()) || endsOn < startsOn) throw badRequest("Invalid availability dates.");
  await db.blockoutDate.create({ data: { orgId: user.orgId, personId: user.personId, startsOn, endsOn, reason: input.reason?.slice(0, 200) || null } });
  await audit({ orgId: user.orgId, actor: user, action: "serving.my_blockout_add", entityType: "blockout", entityId: user.personId, after: { startsOn: input.startsOn, endsOn: input.endsOn }, ip: meta.ip, userAgent: meta.userAgent });
  return { ok: true };
}

export async function removeMyBlockout(user: SessionUser, blockoutId: string, meta: { ip?: string; userAgent?: string }) {
  if (!can(user, "serving.view.own")) throw forbidden('Requires "serving.view.own" permission.');
  if (!user.personId) throw forbidden("Your account is not linked to a people record.");
  const b = await db.blockoutDate.findFirst({ where: { id: blockoutId, orgId: user.orgId, personId: user.personId } });
  if (!b) throw notFound("Blockout not found.");
  await db.blockoutDate.delete({ where: { id: blockoutId } });
  await audit({ orgId: user.orgId, actor: user, action: "serving.my_blockout_remove", entityType: "blockout", entityId: blockoutId, ip: meta.ip, userAgent: meta.userAgent });
  return { ok: true };
}

// ── the deterministic engine ─────────────────────────────────────────────────

interface Candidate {
  personId: string;
  name: string;
  config: { roleIds: string[]; maxTimesPerMonth: number; minDaysBetweenServes: number };
  lastServedAt: Date | null;
  servesLast90: number;
  servesThisMonth: number;
  blockouts: { startsOn: Date; endsOn: Date }[];
}

async function loadCandidates(orgId: string): Promise<Map<string, Candidate>> {
  const configs = await db.servingConfig.findMany({ where: { orgId, status: "active" } });
  const people = await db.person.findMany({
    where: { id: { in: configs.map((c) => c.personId) }, status: "active" },
    select: { id: true, firstName: true, lastName: true },
  });
  const personSet = new Set(people.map((p) => p.id));
  const relevant = configs.filter((c) => personSet.has(c.personId));
  if (!relevant.length) return new Map();

  const since90 = new Date(Date.now() - 90 * DAY_MS);
  const assignments = await db.assignment.findMany({
    where: { orgId, personId: { in: relevant.map((c) => c.personId) }, status: { in: ["asked", "accepted", "confirmed", "served"] } },
    select: { personId: true, startsAt: true, status: true },
  });
  const blockouts = await db.blockoutDate.findMany({ where: { orgId, personId: { in: relevant.map((c) => c.personId) } } });

  const now = new Date();
  const map = new Map<string, Candidate>();
  for (const c of relevant) {
    const mine = assignments.filter((a) => a.personId === c.personId);
    const last = mine.map((a) => a.startsAt).sort((x, y) => y.getTime() - x.getTime())[0] ?? null;
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    map.set(c.personId, {
      personId: c.personId,
      name: nameOf(people.find((p) => p.id === c.personId)),
      config: { roleIds: JSON.parse(c.roleIdsJson) as string[], maxTimesPerMonth: c.maxTimesPerMonth, minDaysBetweenServes: c.minDaysBetweenServes },
      lastServedAt: last,
      servesLast90: mine.filter((a) => a.startsAt >= since90).length,
      servesThisMonth: mine.filter((a) => a.startsAt >= monthStart && a.startsAt < monthEnd).length,
      blockouts: blockouts.filter((b) => b.personId === c.personId).map((b) => ({ startsOn: b.startsOn, endsOn: b.endsOn })),
    });
  }
  return map;
}

/**
 * Pure scoring for one role slot. Deterministic: same inputs → same output.
 * Every exclusion is captured with a human-readable reason.
 */
export function scoreSlot(
  role: { id: string; name: string; team?: string | null },
  eventStartsAt: Date,
  eventEndsAt: Date,
  candidates: Candidate[],
  alreadyPicked: Set<string>,
): SlotResult {
  const exclusions: { personId: string; name: string; reason: string }[] = [];
  const eligible: EligibleVolunteer[] = [];

  for (const c of candidates) {
    if (c.config.roleIds.length && !c.config.roleIds.includes(role.id)) {
      exclusions.push({ personId: c.personId, name: c.name, reason: "not enrolled for this role" });
      continue;
    }
    const blocked = c.blockouts.find((b) => overlapsBlockout(b, eventStartsAt, eventEndsAt));
    if (blocked) {
      exclusions.push({ personId: c.personId, name: c.name, reason: "unavailable (blockout over this date)" });
      continue;
    }
    if (c.lastServedAt) {
      const days = Math.floor((eventStartsAt.getTime() - c.lastServedAt.getTime()) / DAY_MS);
      if (days < 0) {
        exclusions.push({ personId: c.personId, name: c.name, reason: `already scheduled for a later service (${c.lastServedAt.toISOString().slice(0, 10)}) — order preserved` });
        continue;
      }
      if (days < c.config.minDaysBetweenServes) {
        exclusions.push({ personId: c.personId, name: c.name, reason: `rest window: served ${days} day(s) ago, needs ${c.config.minDaysBetweenServes} days between serves` });
        continue;
      }
    }
    if (c.servesThisMonth >= c.config.maxTimesPerMonth) {
      exclusions.push({ personId: c.personId, name: c.name, reason: `at monthly limit (${c.servesThisMonth}/${c.config.maxTimesPerMonth} this month)` });
      continue;
    }
    if (alreadyPicked.has(c.personId)) {
      exclusions.push({ personId: c.personId, name: c.name, reason: "already assigned to another role on this date" });
      continue;
    }

    const daysSince = c.lastServedAt ? Math.floor((eventStartsAt.getTime() - c.lastServedAt.getTime()) / DAY_MS) : 9999;
    // Score: days since last served dominates; fairness (fewer serves in 90d) breaks ties; name keeps it deterministic.
    eligible.push({
      personId: c.personId,
      name: c.name,
      daysSinceLastServed: c.lastServedAt ? daysSince : null,
      servesLast90: c.servesLast90,
      servesThisMonth: c.servesThisMonth,
      maxTimesPerMonth: c.config.maxTimesPerMonth,
      score: daysSince * 100 - c.servesLast90 * 10,
    });
  }

  eligible.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  if (!eligible.length) {
    return { roleId: role.id, roleName: role.name, team: role.team ?? null, status: "unfilled", exclusions, eligibleCount: 0 };
  }
  return { roleId: role.id, roleName: role.name, team: role.team ?? null, status: "filled", chosen: eligible[0], exclusions, eligibleCount: eligible.length };
}

/** Preview a rota for a date range (no writes). Optionally scope to a team name. */
export async function previewRota(user: SessionUser, q: { from?: string; to?: string; team?: string }): Promise<{ events: RotaPreviewEvent[]; rolesTotal: number; rolesFilled: number }> {
  await assertRotaManage(user);
  await assertFeature(user.orgId, "featureServingAi");
  return buildPreview(user.orgId, q);
}

async function buildPreview(orgId: string, q: { from?: string; to?: string; team?: string }) {
  const now = new Date();
  const from = q.from ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(q.from) ? `${q.from}T00:00:00.000Z` : q.from) : now;
  const to = q.to ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(q.to) ? `${q.to}T23:59:59.999Z` : q.to) : new Date(from.getTime() + 28 * DAY_MS);
  if (isNaN(from.getTime()) || isNaN(to.getTime()) || to <= from) throw badRequest("Invalid date range.");

  const events = await db.event.findMany({
    where: { orgId, kind: { in: ["service", "one_off"] }, startsAt: { gte: from, lte: to }, status: { not: "cancelled" } },
    orderBy: { startsAt: "asc" },
    include: { assignments: { include: { role: true } } },
  });
  const roles = await db.volunteerRole.findMany({
    where: { orgId, isActive: true, ...(q.team ? { team: q.team } : {}) },
    orderBy: [{ team: "asc" }, { name: "asc" }],
  });
  const candidates = await loadCandidates(orgId);
  // In-batch state: assignments made earlier in this preview MUST update the
  // candidate pool (lastServedAt / servesThisMonth) so later events respect
  // rest windows and monthly limits — otherwise one person could be double-
  // booked past their own cap within a single generated month.
  const pool: Candidate[] = [...candidates.values()].map((c) => ({ ...c, blockouts: [...c.blockouts] }));

  const out: RotaPreviewEvent[] = [];
  let rolesTotal = 0;
  let rolesFilled = 0;

  for (const e of events) {
    const startsAt = e.startsAt;
    const endsAt = e.endsAt ?? new Date(startsAt.getTime() + 2 * 3600000);
    const taken = new Set(e.assignments.filter((a) => ["asked", "accepted", "confirmed", "served"].includes(a.status)).map((a) => a.personId));
    const slots: SlotResult[] = [];
    for (const role of roles) {
      // Skip roles that already have a live assignment on this event.
      if (e.assignments.some((a) => a.volunteerRoleId === role.id && ["asked", "accepted", "confirmed", "served"].includes(a.status))) continue;
      const result = scoreSlot({ id: role.id, name: role.name, team: role.team }, startsAt, endsAt, pool, taken);
      slots.push(result);
      rolesTotal++;
      if (result.status === "filled") {
        rolesFilled++;
        taken.add(result.chosen!.personId);
        // update in-batch state for subsequent events
        const c = pool.find((x) => x.personId === result.chosen!.personId);
        if (c) {
          c.lastServedAt = startsAt;
          c.servesThisMonth += 1;
          c.servesLast90 += 1;
        }
      }
    }
    out.push({
      eventId: e.id,
      eventName: e.name,
      startsAt: startsAt.toISOString(),
      slots,
      filledCount: slots.filter((s) => s.status === "filled").length,
      totalCount: slots.length,
    });
  }
  return { events: out, rolesTotal, rolesFilled };
}

/**
 * Commit a reviewed draft: creates real Assignment rows (status "asked",
 * generatedBy "ai") by delegating to the EXISTING volunteers.createAssignment
 * so tokens, notifications, blockout validation and audit all apply unchanged.
 */
export async function commitRota(
  user: SessionUser,
  input: { assignments: { eventId: string; roleId: string; personId: string }[] },
  meta: { ip?: string; userAgent?: string },
) {
  await assertRotaManage(user);
  await assertFeature(user.orgId, "featureServingAi");
  if (!input.assignments?.length) throw badRequest("No assignments to commit.");
  const created: string[] = [];
  const errors: { eventId: string; roleId: string; message: string }[] = [];

  // Local overlay so constraints hold across the batch even before rows exist.
  const batchServed = new Map<string, Date[]>(); // personId → event dates assigned in this batch
  const candidates = await loadCandidates(user.orgId);

  for (const a of input.assignments.slice(0, 100)) {
    try {
      // Constraint re-validation against real data + in-batch overlay — a
      // violation here returns an error for that slot, never a silent assign.
      const c = candidates.get(a.personId);
      const event = await db.event.findFirst({ where: { id: a.eventId, orgId: user.orgId }, select: { startsAt: true, endsAt: true } });
      if (c && event) {
        const prior = [...(batchServed.get(a.personId) ?? []), ...(c.lastServedAt ? [c.lastServedAt] : [])].sort((x, y) => y.getTime() - x.getTime());
        const last = prior[0];
        if (last) {
          const days = Math.floor((event.startsAt.getTime() - last.getTime()) / DAY_MS);
          if (days >= 0 && days < c.config.minDaysBetweenServes) {
            errors.push({ eventId: a.eventId, roleId: a.roleId, message: `${c.name} violates rest window (${days}d < ${c.config.minDaysBetweenServes}d)` });
            continue;
          }
        }
        const monthStart = new Date(Date.UTC(event.startsAt.getUTCFullYear(), event.startsAt.getUTCMonth(), 1));
        const monthEnd = new Date(Date.UTC(event.startsAt.getUTCFullYear(), event.startsAt.getUTCMonth() + 1, 1));
        const monthServes = (batchServed.get(a.personId) ?? []).filter((d) => d >= monthStart && d < monthEnd).length + c.servesThisMonth;
        if (monthServes >= c.config.maxTimesPerMonth) {
          errors.push({ eventId: a.eventId, roleId: a.roleId, message: `${c.name} at monthly limit (${monthServes}/${c.config.maxTimesPerMonth})` });
          continue;
        }
      }
      // Reuse the existing assignment creation path so response tokens,
      // notifications, blockout validation and audit all apply unchanged,
      // then tag the row as engine-generated (additive column).
      const res = await volunteers.createAssignment(user, { roleId: a.roleId, personId: a.personId, eventId: a.eventId }, meta);
      await db.assignment.update({ where: { id: res.id }, data: { generatedBy: "ai" } });
      created.push(res.id);
      const evStart = event?.startsAt ?? new Date();
      batchServed.set(a.personId, [...(batchServed.get(a.personId) ?? []), evStart]);
    } catch (err) {
      errors.push({ eventId: a.eventId, roleId: a.roleId, message: err instanceof Error ? err.message : "assignment failed" });
    }
  }
  await audit({ orgId: user.orgId, actor: user, action: "serving.rota_commit", entityType: "rota", entityId: "batch", after: { created: created.length, failed: errors.length }, ip: meta.ip, userAgent: meta.userAgent });
  return { created: created.length, errors };
}

// ── explainability ───────────────────────────────────────────────────────────

export interface SlotExplanation {
  eventName: string;
  startsAt: string;
  roleName: string;
  status: "filled" | "unfilled";
  chosen?: { name: string; daysSinceLastServed: number | null; servesLast90: number; servesThisMonth: number; maxTimesPerMonth: number };
  exclusions: { name: string; reason: string }[];
  rosterSize: number;
  facts: string[];
}

/** Ground truth for the AI explanation tools — every string derives from real constraint data. */
export async function explainSlot(orgId: string, eventId: string, roleId: string): Promise<SlotExplanation> {
  const event = await db.event.findFirst({ where: { id: eventId, orgId }, include: { assignments: { include: { role: true } } } });
  if (!event) throw notFound("Event not found.");
  const role = await db.volunteerRole.findFirst({ where: { id: roleId, orgId } });
  if (!role) throw notFound("Role not found.");
  const candidates = await loadCandidates(orgId);
  const endsAt = event.endsAt ?? new Date(event.startsAt.getTime() + 2 * 3600000);
  const taken = new Set(event.assignments.filter((a) => ["asked", "accepted", "confirmed", "served"].includes(a.status)).map((a) => a.personId));
  const result = scoreSlot({ id: role.id, name: role.name, team: role.team }, event.startsAt, endsAt, [...candidates.values()], taken);

  const facts: string[] = [
    `${candidates.size} active volunteer(s) on the roster.`,
    result.status === "filled" && result.chosen
      ? `${result.chosen.name} selected: highest score (days since last served: ${result.chosen.daysSinceLastServed ?? "never"}, served ${result.chosen.servesLast90}× in last 90 days, ${result.chosen.servesThisMonth}/${result.chosen.maxTimesPerMonth} this month).`
      : `No eligible volunteer out of ${result.exclusions.length} candidate(s).`,
    ...result.exclusions.slice(0, 12).map((e) => `${e.name}: ${e.reason}.`),
  ];

  return {
    eventName: event.name,
    startsAt: event.startsAt.toISOString(),
    roleName: role.name,
    status: result.status,
    chosen: result.chosen
      ? {
          name: result.chosen.name,
          daysSinceLastServed: result.chosen.daysSinceLastServed,
          servesLast90: result.chosen.servesLast90,
          servesThisMonth: result.chosen.servesThisMonth,
          maxTimesPerMonth: result.chosen.maxTimesPerMonth ?? result.chosen.servesThisMonth,
        }
      : undefined,
    exclusions: result.exclusions.map((e) => ({ name: e.name, reason: e.reason })),
    rosterSize: candidates.size,
    facts,
  };
}

/** "Who's free to serve on <date>?" — same eligibility rules, grounded output. */
export async function whoIsFree(user: SessionUser, dateIso: string) {
  await assertRotaManage(user);
  await assertFeature(user.orgId, "featureServingAi");
  const day = new Date(/^\d{4}-\d{2}-\d{2}$/.test(dateIso) ? `${dateIso}T00:00:00.000Z` : dateIso);
  if (isNaN(day.getTime())) throw badRequest("Invalid date.");
  const dayEnd = new Date(day.getTime() + DAY_MS - 1);
  const candidates = await loadCandidates(user.orgId);

  const rows: { name: string; roleNames: string[]; available: boolean; reason: string }[] = [];
  for (const c of candidates.values()) {
    const blocked = c.blockouts.find((b) => overlapsBlockout(b, day, dayEnd));
    let available = true;
    let reason = blocked ? "unavailable (blockout)" : "available";
    if (!blocked && c.lastServedAt) {
      const days = Math.floor((day.getTime() - c.lastServedAt.getTime()) / DAY_MS);
      if (days >= 0 && days < c.config.minDaysBetweenServes) {
        available = false;
        reason = `rest window (${c.config.minDaysBetweenServes}d, served ${days}d ago)`;
      }
    }
    if (!blocked && available && c.servesThisMonth >= c.config.maxTimesPerMonth) {
      available = false;
      reason = `monthly limit reached (${c.servesThisMonth}/${c.config.maxTimesPerMonth})`;
    }
    const roleIds = c.config.roleIds;
    const roles = roleIds.length
      ? await db.volunteerRole.findMany({ where: { id: { in: roleIds } }, select: { name: true } })
      : [];
    rows.push({ name: c.name, roleNames: roles.map((r) => r.name), available, reason });
  }
  rows.sort((a, b) => Number(b.available) - Number(a.available) || a.name.localeCompare(b.name));
  return { date: day.toISOString().slice(0, 10), rosterSize: rows.length, items: rows };
}

// ── burnout indicator ────────────────────────────────────────────────────────

export async function burnoutReport(user: SessionUser) {
  await assertRotaManage(user);
  const candidates = await loadCandidates(user.orgId);
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const items = [...candidates.values()]
    .map((c) => {
      const load = c.servesThisMonth;
      const max = c.config.maxTimesPerMonth;
      const level = max === 0 ? "paused" : load >= max ? "at_limit" : load >= Math.max(1, max - 1) ? "warning" : "ok";
      return {
        person: { id: c.personId, name: c.name },
        servesThisMonth: load,
        maxTimesPerMonth: max,
        servesLast90: c.servesLast90,
        lastServedAt: c.lastServedAt,
        level,
      };
    })
    .sort((a, b) => b.servesThisMonth - a.servesThisMonth || a.person.name.localeCompare(b.person.name));
  return { month: monthStart.toISOString().slice(0, 7), items };
}

/** Merge an AI-generated slot into the per-event assignment suggestions used by the Volunteers UI. */
export async function previewForEvent(user: SessionUser, eventId: string) {
  await assertRotaManage(user);
  await assertFeature(user.orgId, "featureServingAi");
  const event = await db.event.findFirst({ where: { id: eventId, orgId: user.orgId } });
  if (!event) throw notFound("Event not found.");
  const roles = await db.volunteerRole.findMany({ where: { orgId: user.orgId, isActive: true }, orderBy: [{ team: "asc" }, { name: "asc" }] });
  const candidates = await loadCandidates(user.orgId);
  const endsAt = event.endsAt ?? new Date(event.startsAt.getTime() + 2 * 3600000);
  const existing = await db.assignment.findMany({ where: { eventId, orgId: user.orgId }, include: { role: true } });
  const taken = new Set(existing.filter((a) => ["asked", "accepted", "confirmed", "served"].includes(a.status)).map((a) => a.personId));
  const slots: SlotResult[] = [];
  for (const role of roles) {
    if (existing.some((a) => a.volunteerRoleId === role.id && ["asked", "accepted", "confirmed", "served"].includes(a.status))) continue;
    const r = scoreSlot({ id: role.id, name: role.name, team: role.team }, event.startsAt, endsAt, [...candidates.values()], taken);
    slots.push(r);
    if (r.status === "filled") taken.add(r.chosen!.personId);
  }
  return { eventId, eventName: event.name, startsAt: event.startsAt.toISOString(), slots };
}
