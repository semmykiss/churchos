import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { badRequest, notFound, conflict, forbidden } from "@/server/http";
import { can, type SessionUser } from "@/server/permissions";
import { startOfYear } from "date-fns";
import { randomBytes } from "node:crypto";
import { processorFeeCents } from "@/lib/giving-fees";
import { journalDonation } from "@/server/services/accounting";

/**
 * Giving service (backend only — no HTTP, no React).
 * Business rules honored:
 *  • donations are APPEND-ONLY — corrections happen as reversal records, never edits
 *  • splits must sum exactly to the gift amount
 *  • open batch ⇒ pending donation; posting a batch = two-person control
 *  • statements group by statement unit (household, falling back to person) with
 *    the required IRS "no goods or services" language
 *  • every mutation is audited in the same logical step
 */

function parseDay(s?: string | null): Date | undefined {
  if (!s) return undefined;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00.000Z` : s);
  return isNaN(d.getTime()) ? undefined : d;
}

function dayEnd(s?: string | null): Date | undefined {
  if (!s) return undefined;
  const d = parseDay(s);
  if (!d) return undefined;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(d.getTime() + 86400000 - 1) : d;
}

export function money(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

// ── ROLE-BASED DATA SCOPING (server-side, never trust the client) ───────────
// giving.view.all        → unrestricted
// giving.view.own        → every query is FORCED to personId = viewer's own
//                          person record; any client-supplied personId is ignored
// neither                → 403
export function givingScope(user: SessionUser): "all" | "own" {
  if (can(user, "giving.view.all")) return "all";
  if (can(user, "giving.view.own")) return "own";
  throw forbidden("You do not have permission to view giving records.");
}

function scopedPersonId(user: SessionUser): string {
  givingScope(user);
  return user.personId ?? "__none__"; // member with no linked person record sees nothing
}

/** Enforce the scoping rule on any list query. Mutates/returns the scoped where. */
export function scopeGivingQuery(user: SessionUser, where: Record<string, unknown>, personField = "personId"): Record<string, unknown> {
  if (givingScope(user) === "all") return where;
  where[personField] = user.personId ?? "__none__";
  return where;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ── funds ────────────────────────────────────────────────────────────────────

const FUND_TYPES = ["tithe", "general", "designated", "restricted", "building", "missions"] as const;

/**
 * Every church gets a non-deletable "Tithes" fund (isSystemFund) — tithing is
 * the dominant revenue stream and must always exist for the Give-now flow.
 * Idempotent; runs on first funds read per process.
 */
async function ensureSystemFunds(orgId: string) {
  const existing = await db.fund.findFirst({ where: { orgId, type: "tithe" }, select: { id: true } });
  if (existing) return;
  await db.fund.create({
    data: { orgId, name: "Tithes", code: "100-T", type: "tithe", isSystemFund: true, isTaxDeductible: true, sortOrder: -10 },
  }).catch(() => {}); // race with another request seeding it — harmless
}

export async function listFunds(user: SessionUser) {
  await ensureSystemFunds(user.orgId);
  const yearStart = startOfYear(new Date());
  const [funds, splits] = await Promise.all([
    db.fund.findMany({ where: { orgId: user.orgId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    db.donationSplit.findMany({
      where: { orgId: user.orgId, donation: { status: "posted", receivedOn: { gte: yearStart } } },
      select: { fundId: true, amountCents: true },
    }),
  ]);
  const ytd: Record<string, number> = {};
  for (const s of splits) ytd[s.fundId] = (ytd[s.fundId] ?? 0) + s.amountCents;
  return {
    items: funds.map((f) => ({
      id: f.id,
      name: f.name,
      code: f.code,
      type: f.type,
      isSystemFund: f.isSystemFund,
      isTaxDeductible: f.isTaxDeductible,
      goalCents: f.goalCents,
      isActive: f.isActive,
      receivedCentsYTD: ytd[f.id] ?? 0,
    })),
  };
}

export async function createFund(user: SessionUser, input: any, meta: { ip?: string; userAgent?: string }) {
  if (!input?.name?.trim() || !input?.code?.trim()) throw badRequest("Fund name and code are required.");
  const type = input.type || "general";
  if (!(FUND_TYPES as readonly string[]).includes(type)) throw badRequest(`Unknown fund type "${type}".`);
  const fund = await db.fund.create({
    data: {
      orgId: user.orgId,
      name: input.name.trim(),
      code: input.code.trim(),
      type,
      isTaxDeductible: input.isTaxDeductible ?? true,
      goalCents: input.goalCents ?? undefined,
    },
  });
  await audit({
    orgId: user.orgId, actor: user, action: "fund.create", entityType: "fund", entityId: fund.id,
    after: { name: fund.name, code: fund.code }, ip: meta.ip, userAgent: meta.userAgent,
  });
  return { id: fund.id, name: fund.name, code: fund.code, type: fund.type, isTaxDeductible: fund.isTaxDeductible, goalCents: fund.goalCents, isActive: fund.isActive };
}

// ── donations ────────────────────────────────────────────────────────────────

interface DonationListQuery {
  search?: string; fundId?: string; method?: string; status?: string;
  from?: string; to?: string; batchId?: string; personId?: string; page?: number; pageSize?: number;
}

async function donationMapContext(donations: any[]) {
  const personIds = [...new Set(donations.map((d) => d.personId).filter(Boolean))] as string[];
  const householdIds = [...new Set(donations.map((d) => d.householdId).filter(Boolean))] as string[];
  const batchIds = [...new Set(donations.map((d) => d.batchId).filter(Boolean))] as string[];
  const fundIds = [...new Set(donations.flatMap((d) => ((d.splits ?? []) as any[]).map((s) => s.fundId)))] as string[];
  const [persons, households, batches, funds] = await Promise.all([
    personIds.length ? db.person.findMany({ where: { id: { in: personIds } } }) : Promise.resolve([] as any[]),
    householdIds.length ? db.household.findMany({ where: { id: { in: householdIds } } }) : Promise.resolve([] as any[]),
    batchIds.length ? db.batch.findMany({ where: { id: { in: batchIds } } }) : Promise.resolve([] as any[]),
    fundIds.length ? db.fund.findMany({ where: { id: { in: fundIds } } }) : Promise.resolve([] as any[]),
  ]);
  return {
    persons: new Map(persons.map((p) => [p.id, p] as const)),
    households: new Map(households.map((h) => [h.id, h] as const)),
    batches: new Map(batches.map((b) => [b.id, b] as const)),
    funds: new Map(funds.map((f) => [f.id, f] as const)),
  };
}

function toDonationDTO(d: any, ctx: Awaited<ReturnType<typeof donationMapContext>>) {
  const person = d.personId ? ctx.persons.get(d.personId) : null;
  const batch = d.batchId ? ctx.batches.get(d.batchId) : null;
  return {
    id: d.id,
    person: person ? { id: person.id, name: `${person.firstName} ${person.lastName}` } : null,
    householdName: d.householdId ? ctx.households.get(d.householdId)?.name ?? null : null,
    amountCents: d.amountCents,
    currency: d.currency,
    method: d.method,
    status: d.status,
    receivedOn: d.receivedOn,
    source: d.source,
    feeCents: d.feeCents,
    netCents: d.netCents,
    checkNumber: d.checkNumber,
    memo: d.memo,
    isAnonymous: d.isAnonymous,
    batch: batch ? { id: batch.id, name: batch.name, status: batch.status } : null,
    splits: ((d.splits ?? []) as any[]).map((s) => ({
      fundId: s.fundId,
      fundName: ctx.funds.get(s.fundId)?.name ?? "Unknown fund",
      amountCents: s.amountCents,
    })),
    reversalOfId: d.reversalOfId,
    createdByName: d.createdByName,
  };
}

export async function listDonations(user: SessionUser, q: DonationListQuery) {
  const where: any = { orgId: user.orgId };
  if (givingScope(user) === "own") {
    // FORCE self-scope — ignore any personId/search the client passes
    where.personId = user.personId ?? "__none__";
  } else if (q.personId) {
    where.personId = q.personId;
  }
  if (q.fundId) where.splits = { some: { fundId: q.fundId } };
  if (q.method) where.method = q.method;
  if (q.status) where.status = q.status;
  if (q.batchId) where.batchId = q.batchId;
  if (q.from || q.to) {
    where.receivedOn = {
      ...(parseDay(q.from) ? { gte: parseDay(q.from) } : {}),
      ...(dayEnd(q.to) ? { lte: dayEnd(q.to) } : {}),
    };
  }
  if (q.search?.trim() && givingScope(user) === "all") {
    const s = q.search.trim();
    const matchedPeople = await db.person.findMany({
      where: {
        orgId: user.orgId,
        OR: [{ firstName: { contains: s } }, { lastName: { contains: s } }, { email: { contains: s } }],
      },
      select: { id: true },
      take: 60,
    });
    where.OR = [
      { checkNumber: { contains: s } },
      { memo: { contains: s } },
      { personId: { in: matchedPeople.map((p) => p.id) } },
    ];
  }

  const page = Math.max(1, q.page ?? 1);
  const pageSize = Math.min(100, Math.max(10, q.pageSize ?? 25));
  const [total, rows] = await Promise.all([
    db.donation.count({ where }),
    db.donation.findMany({
      where,
      orderBy: { receivedOn: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { splits: true },
    }),
  ]);
  const ctx = await donationMapContext(rows);
  return { total, page, pageSize, items: rows.map((d) => toDonationDTO(d, ctx)) };
}

export async function createDonation(user: SessionUser, input: any, meta: { ip?: string; userAgent?: string }) {
  const amount = Math.round(Number(input?.amountCents));
  if (!Number.isFinite(amount) || amount <= 0) throw badRequest("amountCents must be a positive whole number of cents.");
  const splits = Array.isArray(input?.splits) ? input.splits : [];
  if (!splits.length) throw badRequest("At least one fund split is required.");
  const splitSum = splits.reduce((a: number, s: any) => a + Math.round(Number(s.amountCents) || 0), 0);
  if (splitSum !== amount) throw badRequest(`Fund splits total ${splitSum}¢ but the gift is ${amount}¢ — they must match exactly.`);

  // open batch ⇒ pending; anything else ⇒ posted
  let status = "posted";
  if (input.batchId) {
    const batch = await db.batch.findFirst({ where: { id: input.batchId, orgId: user.orgId } });
    if (!batch) throw notFound("Batch not found.");
    if (batch.status === "open") status = "pending";
  }

  const donation = await db.donation.create({
    data: {
      orgId: user.orgId,
      personId: input.personId || null,
      householdId: input.householdId || null,
      batchId: input.batchId || null,
      amountCents: amount,
      method: input.method || "card",
      status,
      receivedOn: input.receivedOn ? new Date(input.receivedOn) : new Date(),
      source: input.source || "admin",
      checkNumber: input.checkNumber || undefined,
      memo: input.memo || undefined,
      isAnonymous: !!input.isAnonymous,
      createdByName: user.name,
    },
  });
  await db.donationSplit.createMany({
    data: splits.map((s: any) => ({
      orgId: user.orgId,
      donationId: donation.id,
      fundId: s.fundId,
      amountCents: Math.round(Number(s.amountCents)),
    })),
  });
  await audit({
    orgId: user.orgId, actor: user, action: "gift.create", entityType: "donation", entityId: donation.id,
    after: { amountCents: amount, method: donation.method, status, splits }, ip: meta.ip, userAgent: meta.userAgent,
  });
  // posted gifts hit the GL immediately (Dr Cash / Cr Revenue per fund);
  // batch-pending gifts journal when the batch posts
  if (status === "posted") {
    await journalDonation(user, donation.id).catch(() => {});
  }
  return { id: donation.id };
}

export async function reverseDonation(user: SessionUser, donationId: string, reason: string, meta: { ip?: string; userAgent?: string }) {
  if (!reason?.trim()) throw badRequest("A reason is required to reverse a gift.");
  const original = await db.donation.findFirst({ where: { id: donationId, orgId: user.orgId }, include: { splits: true } });
  if (!original) throw notFound("Donation not found.");
  if (original.reversalOfId) throw badRequest("That record is already a reversal entry.");
  const existing = await db.donation.findUnique({ where: { reversalOfId: donationId } });
  if (existing) throw conflict("This gift has already been reversed.");

  // APPEND-ONLY: the original is never touched — a new reversal record is created.
  const reversal = await db.donation.create({
    data: {
      orgId: user.orgId,
      personId: original.personId,
      householdId: original.householdId,
      amountCents: original.amountCents,
      currency: original.currency,
      method: original.method,
      status: "reversed",
      receivedOn: new Date(),
      source: "admin",
      memo: reason.trim(),
      reversalOfId: original.id,
      reversalReason: reason.trim(),
      createdByName: user.name,
    },
  });
  if (original.splits.length) {
    await db.donationSplit.createMany({
      data: original.splits.map((s) => ({ orgId: user.orgId, donationId: reversal.id, fundId: s.fundId, amountCents: s.amountCents })),
    });
  }
  await audit({
    orgId: user.orgId, actor: user, action: "gift.reverse", entityType: "donation", entityId: reversal.id,
    before: { id: original.id, amountCents: original.amountCents, status: original.status },
    after: { reversalId: reversal.id, reason: reason.trim() },
    ip: meta.ip, userAgent: meta.userAgent,
  });
  return { reversalId: reversal.id };
}

// ── batches ──────────────────────────────────────────────────────────────────

function toBatchDTO(b: any, donationCount: number, pendingCount: number) {
  return {
    id: b.id, name: b.name, kind: b.kind, serviceDate: b.serviceDate, status: b.status,
    totalCents: b.totalCents, donationCount, pendingCount, depositAccount: b.depositAccount,
    countedByOne: b.countedByOne, countedByTwo: b.countedByTwo, postedByName: b.postedByName, postedAt: b.postedAt,
  };
}

export async function listBatches(user: SessionUser) {
  const batches = await db.batch.findMany({ where: { orgId: user.orgId }, orderBy: { serviceDate: "desc" }, take: 60 });
  const donations = batches.length
    ? await db.donation.findMany({
        where: { orgId: user.orgId, batchId: { in: batches.map((b) => b.id) } },
        select: { batchId: true, amountCents: true, status: true },
      })
    : [];
  const agg: Record<string, { count: number; pending: number }> = {};
  for (const d of donations) {
    if (!d.batchId) continue;
    agg[d.batchId] ??= { count: 0, pending: 0 };
    agg[d.batchId].count += 1;
    if (d.status === "pending") agg[d.batchId].pending += 1;
  }
  return { items: batches.map((b) => toBatchDTO(b, agg[b.id]?.count ?? 0, agg[b.id]?.pending ?? 0)) };
}

export async function createBatch(user: SessionUser, input: any, meta: { ip?: string; userAgent?: string }) {
  if (!input?.name?.trim()) throw badRequest("Batch name is required.");
  if (!input?.serviceDate) throw badRequest("serviceDate is required.");
  const campusId = input.campusId || user.campusId || (await db.campus.findFirst({ where: { orgId: user.orgId }, select: { id: true } }))?.id;
  if (!campusId) throw badRequest("No campus available for this organization.");
  const batch = await db.batch.create({
    data: {
      orgId: user.orgId,
      campusId,
      name: input.name.trim(),
      kind: input.kind || "offering",
      serviceDate: new Date(input.serviceDate),
      depositAccount: input.depositAccount || undefined,
    },
  });
  await audit({
    orgId: user.orgId, actor: user, action: "batch.create", entityType: "batch", entityId: batch.id,
    after: { name: batch.name }, ip: meta.ip, userAgent: meta.userAgent,
  });
  return toBatchDTO(batch, 0, 0);
}

export async function postBatch(user: SessionUser, batchId: string, countedByTwo: string, meta: { ip?: string; userAgent?: string }) {
  const batch = await db.batch.findFirst({ where: { id: batchId, orgId: user.orgId } });
  if (!batch) throw notFound("Batch not found.");
  if (batch.status !== "open") throw badRequest("Only open batches can be posted.");
  if (!countedByTwo?.trim()) throw badRequest("A second counter is required (two-person control).");
  if (batch.countedByOne && countedByTwo.trim() === batch.countedByOne) {
    throw badRequest("The second counter must be a different person than the first (two-person control).");
  }
  const donations = await db.donation.findMany({
    where: { batchId: batch.id, orgId: user.orgId },
    select: { amountCents: true, status: true },
  });
  const issues = donations.filter((d) => d.status === "failed");
  if (issues.length) throw badRequest(`Batch has ${issues.length} donation(s) with issues — resolve them before posting.`);

  await db.donation.updateMany({ where: { batchId: batch.id, status: "pending" }, data: { status: "posted" } });
  // journal the newly-posted gifts (Dr Cash / Cr Revenue per fund)
  const postedIds = await db.donation.findMany({ where: { batchId: batch.id, status: "posted" }, select: { id: true } });
  for (const d of postedIds) {
    await journalDonation(user, d.id).catch(() => {});
  }
  const totalCents = donations.reduce((a, d) => a + d.amountCents, 0);
  const updated = await db.batch.update({
    where: { id: batch.id },
    data: { status: "posted", countedByTwo: countedByTwo.trim(), postedByName: user.name, postedAt: new Date(), totalCents },
  });
  await audit({
    orgId: user.orgId, actor: user, action: "batch.post", entityType: "batch", entityId: batch.id,
    before: { status: batch.status },
    after: { status: "posted", donationCount: donations.length, totalCents, countedByOne: batch.countedByOne, countedByTwo: countedByTwo.trim() },
    ip: meta.ip, userAgent: meta.userAgent,
  });
  return toBatchDTO(updated, donations.length, 0);
}

// ── pledges & recurring ──────────────────────────────────────────────────────

export async function listPledges(user: SessionUser, q: { fundId?: string; campaign?: string }) {
  const where: any = { orgId: user.orgId };
  if (givingScope(user) === "own") {
    where.personId = user.personId ?? "__none__"; // FORCE self-scope
  }
  if (q.fundId) where.fundId = q.fundId;
  if (q.campaign) where.campaign = { contains: q.campaign };
  const pledges = await db.pledge.findMany({ where, orderBy: { startsOn: "desc" }, take: 100 });
  const personIds = [...new Set(pledges.map((p) => p.personId))];
  const fundIds = [...new Set(pledges.map((p) => p.fundId))];
  const [persons, funds, donations] = await Promise.all([
    personIds.length ? db.person.findMany({ where: { id: { in: personIds } } }) : Promise.resolve([] as any[]),
    fundIds.length ? db.fund.findMany({ where: { id: { in: fundIds } } }) : Promise.resolve([] as any[]),
    personIds.length
      ? db.donation.findMany({
          where: { orgId: user.orgId, personId: { in: personIds }, status: "posted" },
          include: { splits: true },
        })
      : Promise.resolve([] as any[]),
  ]);
  const pMap = new Map(persons.map((p) => [p.id, p] as const));
  const fMap = new Map(funds.map((f) => [f.id, f] as const));
  return {
    items: pledges.map((pl) => {
      const progressCents = donations
        .filter((d) => d.personId === pl.personId && d.receivedOn.getTime() >= pl.startsOn.getTime())
        .flatMap((d) => d.splits)
        .filter((s) => s.fundId === pl.fundId)
        .reduce((a, s) => a + s.amountCents, 0);
      const fund = fMap.get(pl.fundId);
      return {
        id: pl.id,
        person: pMap.has(pl.personId)
          ? { id: pl.personId, name: `${pMap.get(pl.personId)!.firstName} ${pMap.get(pl.personId)!.lastName}` }
          : null,
        fund: fund ? { id: fund.id, name: fund.name } : null,
        campaign: pl.campaign,
        amountCents: pl.amountCents,
        frequency: pl.frequency,
        startsOn: pl.startsOn,
        endsOn: pl.endsOn,
        status: pl.status,
        progressCents,
        progressPct: pl.amountCents > 0 ? Math.min(999, Math.round((progressCents / pl.amountCents) * 100)) : 0,
      };
    }),
  };
}

export async function createPledge(user: SessionUser, input: any, meta: { ip?: string; userAgent?: string }) {
  const amount = Math.round(Number(input?.amountCents));
  if (!input?.fundId) throw badRequest("fundId is required.");
  if (!Number.isFinite(amount) || amount <= 0) throw badRequest("amountCents must be a positive whole number of cents.");
  // staff (giving.pledges.manage) may pledge FOR anyone; a member may only
  // pledge for themselves and must hold giving.give — never trust client personId
  let personId = input.personId;
  if (!can(user, "giving.pledges.manage")) {
    if (!can(user, "giving.give")) throw forbidden("You do not have permission to create pledges.");
    if (!user.personId) throw forbidden("Your account is not linked to a people record.");
    personId = user.personId; // FORCE self
  }
  if (!personId) throw badRequest("personId is required.");
  const fund = await db.fund.findFirst({ where: { id: input.fundId, orgId: user.orgId, isActive: true } });
  if (!fund) throw notFound("Fund not found.");
  const pledge = await db.pledge.create({
    data: {
      orgId: user.orgId,
      personId,
      fundId: input.fundId,
      campaign: input.campaign ? String(input.campaign) : "General",
      amountCents: amount,
      frequency: input.frequency || "one_time",
      startsOn: input.startsOn ? new Date(input.startsOn) : new Date(),
      endsOn: input.endsOn ? new Date(input.endsOn) : undefined,
    },
  });
  await audit({
    orgId: user.orgId, actor: user, action: "pledge.create", entityType: "pledge", entityId: pledge.id,
    after: { campaign: pledge.campaign, amountCents: pledge.amountCents }, ip: meta.ip, userAgent: meta.userAgent,
  });
  return { id: pledge.id };
}

export async function listRecurringGifts(user: SessionUser) {
  const where: any = { orgId: user.orgId };
  if (givingScope(user) === "own") {
    where.personId = user.personId ?? "__none__"; // FORCE self-scope
  }
  const gifts = await db.recurringGift.findMany({ where, orderBy: { startedOn: "desc" }, take: 100 });
  const personIds = [...new Set(gifts.map((g) => g.personId))];
  const fundIds = [...new Set(gifts.map((g) => g.fundId))];
  const [persons, funds] = await Promise.all([
    personIds.length ? db.person.findMany({ where: { id: { in: personIds } } }) : Promise.resolve([] as any[]),
    fundIds.length ? db.fund.findMany({ where: { id: { in: fundIds } } }) : Promise.resolve([] as any[]),
  ]);
  const pMap = new Map(persons.map((p) => [p.id, p] as const));
  const fMap = new Map(funds.map((f) => [f.id, f] as const));
  return {
    items: gifts.map((g) => {
      const p = pMap.get(g.personId);
      const fund = fMap.get(g.fundId);
      return {
        id: g.id,
        person: p ? { id: p.id, name: `${p.firstName} ${p.lastName}` } : null,
        fund: fund ? { id: fund.id, name: fund.name } : null,
        amountCents: g.amountCents,
        frequency: g.frequency,
        nextRunAt: g.nextRunAt,
        status: g.status,
        failureCount: g.failureCount,
      };
    }),
  };
}

function addFrequency(from: Date, frequency: string): Date {
  const d = new Date(from);
  switch (frequency) {
    case "weekly": d.setDate(d.getDate() + 7); break;
    case "biweekly": d.setDate(d.getDate() + 14); break;
    case "quarterly": d.setMonth(d.getMonth() + 3); break;
    case "annual": d.setFullYear(d.getFullYear() + 1); break;
    default: d.setMonth(d.getMonth() + 1); // monthly
  }
  return d;
}

/** Shared ownership rule for self-service recurring-gift management. */
function assertRecurringOwnership(user: SessionUser, gift: { personId: string }) {
  if (can(user, "giving.view.all")) return; // staff may manage any
  if (can(user, "giving.give") && gift.personId === user.personId) return;
  throw forbidden("You can only manage your own recurring gifts.");
}

export async function pauseRecurringGift(user: SessionUser, id: string, meta: { ip?: string; userAgent?: string }) {
  const gift = await db.recurringGift.findFirst({ where: { id, orgId: user.orgId } });
  if (!gift) throw notFound("Recurring gift not found.");
  assertRecurringOwnership(user, gift);
  if (gift.status !== "active") throw badRequest("Only active recurring gifts can be paused.");
  await db.recurringGift.update({ where: { id: gift.id }, data: { status: "paused" } });
  await audit({
    orgId: user.orgId, actor: user, action: "recurring.pause", entityType: "recurring_gift", entityId: gift.id,
    before: { status: gift.status }, after: { status: "paused" }, ip: meta.ip, userAgent: meta.userAgent,
  });
  return { ok: true, status: "paused" };
}

export async function resumeRecurringGift(user: SessionUser, id: string, meta: { ip?: string; userAgent?: string }) {
  const gift = await db.recurringGift.findFirst({ where: { id, orgId: user.orgId } });
  if (!gift) throw notFound("Recurring gift not found.");
  assertRecurringOwnership(user, gift);
  if (gift.status !== "paused") throw badRequest("Only paused recurring gifts can be resumed.");
  // if the next run lapsed while paused, roll it forward one cadence from now
  const nextRunAt = gift.nextRunAt && gift.nextRunAt.getTime() > Date.now() ? gift.nextRunAt : addFrequency(new Date(), gift.frequency);
  await db.recurringGift.update({ where: { id: gift.id }, data: { status: "active", nextRunAt } });
  await audit({
    orgId: user.orgId, actor: user, action: "recurring.resume", entityType: "recurring_gift", entityId: gift.id,
    before: { status: gift.status }, after: { status: "active" }, ip: meta.ip, userAgent: meta.userAgent,
  });
  return { ok: true, status: "active", nextRunAt };
}

export async function cancelRecurringGift(user: SessionUser, id: string, meta: { ip?: string; userAgent?: string }) {
  const gift = await db.recurringGift.findFirst({ where: { id, orgId: user.orgId } });
  if (!gift) throw notFound("Recurring gift not found.");
  // self-service: a member may cancel their OWN recurring gift; staff (view.all) may cancel any
  if (!(can(user, "giving.view.all") || (can(user, "giving.give") && gift.personId === user.personId))) {
    throw forbidden("You can only manage your own recurring gifts.");
  }
  await db.recurringGift.update({ where: { id: gift.id }, data: { status: "canceled", canceledAt: new Date() } });
  await audit({
    orgId: user.orgId, actor: user, action: "recurring.cancel", entityType: "recurring_gift", entityId: gift.id,
    before: { status: gift.status }, after: { status: "canceled" }, ip: meta.ip, userAgent: meta.userAgent,
  });
  return { ok: true };
}

// ── giving statements ────────────────────────────────────────────────────────

export async function listStatements(user: SessionUser, taxYear?: number) {
  const where: any = { orgId: user.orgId, ...(taxYear ? { taxYear } : {}) };
  if (givingScope(user) === "own") {
    // a member's statements are keyed by the STATEMENT UNIT (household head's
    // personId) — scope to their personId OR the household they belong to
    if (user.personId) {
      const memberships = await db.householdMember.findFirst({
        where: { personId: user.personId, endedAt: null },
        select: { householdId: true },
      });
      where.OR = [{ personId: user.personId }, ...(memberships ? [{ householdId: memberships.householdId }] : [])];
    } else {
      where.personId = "__none__";
    }
  }
  const statements = await db.givingStatement.findMany({ where, orderBy: [{ taxYear: "desc" }, { totalCents: "desc" }], take: 200 });
  const personIds = [...new Set(statements.map((s) => s.personId))];
  const householdIds = [...new Set(statements.map((s) => s.householdId).filter(Boolean))] as string[];
  const [persons, households] = await Promise.all([
    personIds.length ? db.person.findMany({ where: { id: { in: personIds } } }) : Promise.resolve([] as any[]),
    householdIds.length ? db.household.findMany({ where: { id: { in: householdIds } } }) : Promise.resolve([] as any[]),
  ]);
  const pMap = new Map(persons.map((p) => [p.id, p] as const));
  const hMap = new Map(households.map((h) => [h.id, h] as const));
  return {
    items: statements.map((s) => {
      const p = pMap.get(s.personId);
      return {
        id: s.id,
        personId: s.personId,
        personName: p ? `${p.firstName} ${p.lastName}` : "Unknown",
        householdName: s.householdId ? hMap.get(s.householdId)?.name ?? null : null,
        taxYear: s.taxYear,
        totalCents: s.totalCents,
        status: s.status,
        generatedAt: s.generatedAt,
        sentAt: s.sentAt,
      };
    }),
  };
}

/** Group the year's posted, non-reversed donations per statement unit and upsert statements. */
export async function generateStatements(user: SessionUser, taxYear: number, meta: { ip?: string; userAgent?: string }) {
  const year = Math.round(Number(taxYear));
  if (!Number.isFinite(year) || year < 1990 || year > 2100) throw badRequest("A valid taxYear is required.");
  const from = new Date(Date.UTC(year, 0, 1));
  const to = new Date(Date.UTC(year + 1, 0, 1));

  const donations = await db.donation.findMany({
    where: { orgId: user.orgId, status: "posted", receivedOn: { gte: from, lt: to } },
    select: { id: true, personId: true, householdId: true, amountCents: true },
  });
  const reversalTargets = await db.donation.findMany({
    where: { orgId: user.orgId, reversalOfId: { in: donations.map((d) => d.id) } },
    select: { reversalOfId: true },
  });
  const reversedIds = new Set(reversalTargets.map((r) => r.reversalOfId));
  const eligible = donations.filter((d) => !reversedIds.has(d.id));

  const personIds = [...new Set(eligible.map((d) => d.personId).filter(Boolean))] as string[];
  const links = personIds.length
    ? await db.householdMember.findMany({ where: { personId: { in: personIds }, endedAt: null } })
    : [];
  const householdOf = new Map(links.map((l) => [l.personId, l.householdId] as const));
  const householdIds = [...new Set(eligible.map((d) => d.householdId ?? householdOf.get(d.personId ?? "") ?? null).filter(Boolean))] as string[];
  const households = householdIds.length ? await db.household.findMany({ where: { id: { in: householdIds } } }) : [];
  const hMap = new Map(households.map((h) => [h.id, h] as const));

  // group by statement unit: household when known, else the individual person
  const units = new Map<string, { householdId: string | null; personId: string; totalCents: number }>();
  for (const d of eligible) {
    const householdId = d.householdId ?? householdOf.get(d.personId ?? "") ?? null;
    const key = householdId ? `h:${householdId}` : `p:${d.personId}`;
    const unit = units.get(key);
    if (unit) {
      unit.totalCents += d.amountCents;
    } else {
      let statementPersonId = d.personId ?? "";
      if (householdId) {
        const h = hMap.get(householdId);
        statementPersonId = h?.headPersonId ?? d.personId ?? "";
      }
      units.set(key, { householdId, personId: statementPersonId, totalCents: d.amountCents });
    }
  }

  let created = 0;
  for (const unit of units.values()) {
    if (!unit.personId) continue;
    await db.givingStatement.upsert({
      where: { orgId_personId_taxYear_kind: { orgId: user.orgId, personId: unit.personId, taxYear: year, kind: "annual" } },
      create: {
        orgId: user.orgId, personId: unit.personId, householdId: unit.householdId,
        taxYear: year, kind: "annual", totalCents: unit.totalCents, status: "generated",
      },
      update: { totalCents: unit.totalCents, householdId: unit.householdId },
    });
    created += 1;
  }
  await audit({
    orgId: user.orgId, actor: user, action: "statements.generate", entityType: "giving_statement",
    after: { taxYear: year, created }, ip: meta.ip, userAgent: meta.userAgent,
  });
  return { created };
}

/** Printable HTML statement with per-gift lines + the required IRS language. */
export async function previewStatement(user: SessionUser, statementId: string) {
  const stmt = await db.givingStatement.findFirst({ where: { id: statementId, orgId: user.orgId } });
  if (!stmt) throw notFound("Statement not found.");
  // staff with statements.manage may preview any; everyone else only their own
  // household/unit (statements are keyed to the household head's personId)
  if (!can(user, "giving.statements.manage")) {
    let allowed = user.personId != null && stmt.personId === user.personId;
    if (!allowed && user.personId) {
      const link = await db.householdMember.findFirst({
        where: { personId: user.personId, endedAt: null, householdId: stmt.householdId ?? "__none__" },
        select: { id: true },
      });
      allowed = !!link;
    }
    if (!allowed) throw forbidden("You can only view your own giving statements.");
  }
  const org = await db.organization.findUnique({ where: { id: user.orgId } });

  const year = stmt.taxYear;
  const from = new Date(Date.UTC(year, 0, 1));
  const to = new Date(Date.UTC(year + 1, 0, 1));

  let memberIds: string[] = [stmt.personId];
  let issuedTo = "";
  if (stmt.householdId) {
    const links = await db.householdMember.findMany({ where: { householdId: stmt.householdId, endedAt: null } });
    memberIds = links.map((l) => l.personId);
    const h = await db.household.findUnique({ where: { id: stmt.householdId } });
    issuedTo = h?.name ?? "";
  }
  const people = await db.person.findMany({ where: { id: { in: memberIds } } });
  if (!issuedTo) {
    const primary = people.find((p) => p.id === stmt.personId) ?? people[0];
    issuedTo = primary ? `${primary.firstName} ${primary.lastName}` : "Giving statement";
  }

  const donations = await db.donation.findMany({
    where: { orgId: user.orgId, status: "posted", receivedOn: { gte: from, lt: to }, personId: { in: memberIds } },
    include: { splits: true },
    orderBy: { receivedOn: "asc" },
  });
  const reversalTargets = await db.donation.findMany({
    where: { orgId: user.orgId, reversalOfId: { in: donations.map((d) => d.id) } },
    select: { reversalOfId: true },
  });
  const reversedIds = new Set(reversalTargets.map((r) => r.reversalOfId));
  const gifts = donations.filter((d) => !reversedIds.has(d.id));

  const fundIds = [...new Set(gifts.flatMap((d) => d.splits.map((s) => s.fundId)))];
  const funds = fundIds.length ? await db.fund.findMany({ where: { id: { in: fundIds } } }) : [];
  const fMap = new Map(funds.map((f) => [f.id, f] as const));

  const total = gifts.reduce((a, d) => a + d.amountCents, 0);
  const rows = gifts
    .map((d) => {
      const fundNames = [...new Set(d.splits.map((s) => fMap.get(s.fundId)?.name ?? "Fund"))].join(", ");
      return `<tr><td>${escapeHtml(d.receivedOn.toISOString().slice(0, 10))}</td><td>${escapeHtml(fundNames)}</td><td class="amt">${escapeHtml(money(d.amountCents))}</td></tr>`;
    })
    .join("\n");

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Giving Statement ${year} — ${escapeHtml(issuedTo)}</title>
<style>
  body { font-family: Georgia, "Times New Roman", serif; margin: 40px auto; max-width: 680px; color: #1a1a1a; }
  h1 { font-size: 22px; margin: 0; }
  h2 { font-size: 16px; font-weight: normal; color: #444; margin: 4px 0 24px; }
  table { width: 100%; border-collapse: collapse; margin: 16px 0; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #ddd; font-size: 14px; }
  th { border-bottom: 2px solid #999; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
  td.amt, th.amt { text-align: right; }
  tfoot td { font-weight: bold; border-top: 2px solid #999; border-bottom: none; }
  .irs { margin-top: 28px; font-size: 13px; color: #333; border-top: 1px solid #ccc; padding-top: 12px; }
  @media print { body { margin: 0; } }
</style>
</head>
<body>
  <h1>${escapeHtml(org?.name ?? "Church")}</h1>
  <h2>Annual Giving Statement — Tax Year ${year}</h2>
  <p>Issued to: <strong>${escapeHtml(issuedTo)}</strong></p>
  <table>
    <thead><tr><th>Date received</th><th>Fund</th><th class="amt">Amount</th></tr></thead>
    <tbody>
      ${rows || `<tr><td colspan="3">No contributions recorded for ${year}.</td></tr>`}
    </tbody>
    <tfoot><tr><td colspan="2">Total contributions for ${year}</td><td class="amt">${escapeHtml(money(total))}</td></tr></tfoot>
  </table>
  <p class="irs">No goods or services were provided in exchange for this contribution.</p>
</body>
</html>`;
  return { html };
}

// ═════════════════════ MEMBER SELF-SERVICE GIVING (giving.give) ═════════════
// Demo payment processor: tokens only, never PAN. The seam mirrors Stripe —
// payment methods tokenize client-side (SetupIntent equivalent), gifts go
// through an intent (PaymentIntent equivalent) with an idempotency key, and
// only SETTLED payments create rows in the immutable donations ledger.

interface PaymentMethodDTO {
  id: string;
  type: string;
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
  isDefault: boolean;
  provider: string;
}

function toPaymentMethodDTO(pm: {
  id: string; type: string; brand: string | null; last4: string | null;
  expMonth: number | null; expYear: number | null; isDefault: boolean; provider: string;
}): PaymentMethodDTO {
  return {
    id: pm.id, type: pm.type, brand: pm.brand, last4: pm.last4,
    expMonth: pm.expMonth, expYear: pm.expYear, isDefault: pm.isDefault, provider: pm.provider,
  };
}

export async function listMyPaymentMethods(user: SessionUser) {
  if (!user.personId) return { items: [] as PaymentMethodDTO[] };
  const methods = await db.paymentMethod.findMany({
    where: { orgId: user.orgId, personId: user.personId, status: "active" },
    orderBy: [{ isDefault: "desc" }, { id: "asc" }],
  });
  return { items: methods.map(toPaymentMethodDTO) };
}

/**
 * Tokenize a new payment method. The client (Elements equivalent) sends ONLY
 * display metadata + a processor token — raw card/bank numbers never reach
 * this server. The demo provider generates the token server-side from the
 * display fields, exactly like a SetupIntent would.
 */
export async function addMyPaymentMethod(
  user: SessionUser,
  input: { type?: string; brand?: string; last4?: string; expMonth?: number; expYear?: number; makeDefault?: boolean },
  meta: { ip?: string; userAgent?: string },
) {
  if (!can(user, "giving.give")) throw forbidden("You do not have permission to manage payment methods.");
  if (!user.personId) throw forbidden("Your account is not linked to a people record.");
  const type = input?.type === "ach" ? "ach" : "card";
  const brand = String(input?.brand ?? "").trim().toLowerCase();
  const last4 = String(input?.last4 ?? "").trim();
  if (type === "card" && !["visa", "mastercard", "amex", "discover"].includes(brand)) {
    throw badRequest("Card brand must be visa, mastercard, amex or discover.");
  }
  if (!/^\d{4}$/.test(last4)) throw badRequest("Provide exactly the last 4 digits — full card numbers are never sent to the server.");
  if (type === "card") {
    const m = Math.round(Number(input?.expMonth));
    let y = Math.round(Number(input?.expYear));
    if (Number.isFinite(y) && y > 0 && y < 100) y += 2000; // tolerate 2-digit years
    if (!Number.isFinite(m) || m < 1 || m > 12 || !Number.isFinite(y) || y < 2024 || y > 2100) {
      throw badRequest("A valid expiry month and year are required.");
    }
  }
  const count = await db.paymentMethod.count({ where: { orgId: user.orgId, personId: user.personId, status: "active" } });
  const makeDefault = input?.makeDefault || count === 0;
  if (makeDefault) {
    await db.paymentMethod.updateMany({ where: { orgId: user.orgId, personId: user.personId, status: "active" }, data: { isDefault: false } });
  }
  const pm = await db.paymentMethod.create({
    data: {
      orgId: user.orgId,
      personId: user.personId,
      provider: "demo",
      providerMethodId: `pm_demo_${randomBytes(10).toString("hex")}`,
      type,
      brand: type === "card" ? brand : null,
      last4,
      expMonth: type === "card" ? Math.round(Number(input?.expMonth)) : null,
      expYear: type === "card"
        ? (Math.round(Number(input?.expYear)) < 100
          ? Math.round(Number(input?.expYear)) + 2000
          : Math.round(Number(input?.expYear)))
        : null,
      isDefault: makeDefault,
    },
  });
  await audit({
    orgId: user.orgId, actor: user, action: "payment_method.add", entityType: "payment_method", entityId: pm.id,
    after: { type, brand: pm.brand, last4 }, ip: meta.ip, userAgent: meta.userAgent,
  });
  return toPaymentMethodDTO(pm);
}

export async function setDefaultPaymentMethod(user: SessionUser, id: string, meta: { ip?: string; userAgent?: string }) {
  if (!can(user, "giving.give")) throw forbidden("You do not have permission to manage payment methods.");
  const pm = await db.paymentMethod.findFirst({ where: { id, orgId: user.orgId, personId: user.personId ?? "__none__", status: "active" } });
  if (!pm) throw notFound("Payment method not found.");
  await db.paymentMethod.updateMany({ where: { orgId: user.orgId, personId: user.personId, status: "active" }, data: { isDefault: false } });
  await db.paymentMethod.update({ where: { id: pm.id }, data: { isDefault: true } });
  await audit({ orgId: user.orgId, actor: user, action: "payment_method.default", entityType: "payment_method", entityId: pm.id, ip: meta.ip, userAgent: meta.userAgent });
  return { ok: true };
}

export async function removeMyPaymentMethod(user: SessionUser, id: string, meta: { ip?: string; userAgent?: string }) {
  if (!can(user, "giving.give")) throw forbidden("You do not have permission to manage payment methods.");
  const pm = await db.paymentMethod.findFirst({ where: { id, orgId: user.orgId, personId: user.personId ?? "__none__", status: "active" } });
  if (!pm) throw notFound("Payment method not found.");
  await db.paymentMethod.update({ where: { id: pm.id }, data: { status: "archived", isDefault: false } });
  await audit({ orgId: user.orgId, actor: user, action: "payment_method.remove", entityType: "payment_method", entityId: pm.id, ip: meta.ip, userAgent: meta.userAgent });
  return { ok: true };
}

export interface GiveNowInput {
  amountCents?: number;
  splits?: { fundId: string; amountCents: number }[];
  paymentMethodId?: string;
  coverFee?: boolean;
  idempotencyKey?: string;
  memo?: string;
  recurring?: { frequency: string; anchorDay?: number } | null;
}

/**
 * Give now — the member-facing gift flow.
 * • Idempotency: a repeated key returns the SAME result instead of double-charging.
 * • Splits must balance to the cent (same rule as the staff ledger).
 * • Only a settled payment creates a donation row; the OnlinePayment row keeps
 *   the processor-side lifecycle (failed attempts never touch the ledger).
 * • Optional recurring setup creates a RecurringGift alongside the first gift.
 */
export async function giveNow(user: SessionUser, input: GiveNowInput, meta: { ip?: string; userAgent?: string }) {
  if (!can(user, "giving.give")) throw forbidden("You do not have permission to give online.");
  if (!user.personId) throw forbidden("Your account is not linked to a people record.");
  const amount = Math.round(Number(input?.amountCents));
  if (!Number.isFinite(amount) || amount < 100) throw badRequest("Minimum online gift is $1.00.");
  const splits = Array.isArray(input?.splits) ? input.splits.filter((s: any) => s?.fundId) : [];
  if (!splits.length) throw badRequest("Choose at least one fund.");
  const splitSum = splits.reduce((a: number, s: any) => a + Math.round(Number(s.amountCents) || 0), 0);
  if (splitSum !== amount) throw badRequest(`Fund splits total ${splitSum}¢ but the gift is ${amount}¢ — they must match exactly.`);
  const funds = await db.fund.findMany({ where: { orgId: user.orgId, id: { in: splits.map((s: any) => s.fundId) }, isActive: true } });
  if (funds.length !== new Set(splits.map((s: any) => s.fundId)).size) throw badRequest("One or more funds are unavailable.");
  if (!input?.idempotencyKey?.trim()) throw badRequest("idempotencyKey is required.");

  const key = input.idempotencyKey.trim();
  const existing = await db.onlinePayment.findUnique({ where: { idempotencyKey: key } });
  if (existing) {
    return {
      paymentId: existing.id, status: existing.status, donationId: existing.donationId,
      feeCents: existing.feeCents, amountCents: existing.amountCents, duplicate: true,
    };
  }

  const pm = await db.paymentMethod.findFirst({
    where: { id: input.paymentMethodId ?? "", orgId: user.orgId, personId: user.personId, status: "active" },
  });
  if (!pm) throw notFound("Pick a saved payment method.");

  const coverFee = !!input.coverFee;
  const baseFee = processorFeeCents(amount);
  // donor covers the fee on top of the gift; charge total = amount + (coverFee ? fee : 0)
  const fee = coverFee ? baseFee : 0;
  const chargeTotal = amount + fee;

  // demo processor intent — a real integration creates this via the provider SDK
  const intentId = `pi_demo_${randomBytes(12).toString("hex")}`;
  const payment = await db.onlinePayment.create({
    data: {
      orgId: user.orgId,
      personId: user.personId,
      provider: "demo",
      providerIntentId: intentId,
      paymentMethodId: pm.id,
      amountCents: chargeTotal,
      feeCents: fee,
      donorCoveredFee: coverFee,
      status: "processing",
      splitsJson: JSON.stringify(splits.map((s: any) => ({ fundId: s.fundId, amountCents: Math.round(Number(s.amountCents)) }))),
      idempotencyKey: key,
    },
  });

  try {
    // ── demo processor "settlement" — succeeds synchronously ──
    const donation = await db.$transaction(async (tx) => {
      const d = await tx.donation.create({
        data: {
          orgId: user.orgId,
          personId: user.personId,
          amountCents: amount, // the GIFT amount; processor fee is recorded separately
          method: pm.type === "ach" ? "ach" : "card",
          status: "posted",
          receivedOn: new Date(),
          source: input.recurring ? "recurring" : "hosted_page",
          externalId: intentId,
          feeCents: fee,
          netCents: amount - (coverFee ? 0 : baseFee), // net after effective fee
          memo: input.memo?.trim() || undefined,
          idempotencyKey: key,
          createdByName: user.name,
        },
      });
      await tx.donationSplit.createMany({
        data: splits.map((s: any) => ({
          orgId: user.orgId,
          donationId: d.id,
          fundId: s.fundId,
          amountCents: Math.round(Number(s.amountCents)),
        })),
      });
      if (input.recurring) {
        const freq = input.recurring.frequency;
        const validFreqs = ["weekly", "biweekly", "monthly", "quarterly", "annual"];
        if (!validFreqs.includes(freq)) throw badRequest("Unknown recurring frequency.");
        const anchor = Math.min(28, Math.max(1, Math.round(Number(input.recurring.anchorDay) || 1)));
        await tx.recurringGift.create({
          data: {
            orgId: user.orgId,
            personId: user.personId,
            paymentMethodId: pm.id,
            fundId: splits[0].fundId,
            amountCents: amount,
            frequency: freq,
            anchorDay: anchor,
            nextRunAt: addFrequency(new Date(), freq),
            status: "active",
            startedOn: new Date(),
          },
        });
      }
      return d;
    });

    await db.onlinePayment.update({
      where: { id: payment.id },
      data: { status: "succeeded", donationId: donation.id, settledAt: new Date() },
    });
    await audit({
      orgId: user.orgId, actor: user, action: "gift.online", entityType: "donation", entityId: donation.id,
      after: { amountCents: amount, method: donation.method, feeCents: fee, coverFee, paymentId: payment.id },
      ip: meta.ip, userAgent: meta.userAgent,
    });
    // bridge to the GL — online gifts journal automatically (Dr Cash / Cr Revenue)
    await journalDonation(user, donation.id).catch(() => {});
    return { paymentId: payment.id, status: "succeeded", donationId: donation.id, amountCents: chargeTotal, feeCents: fee };
  } catch (err) {
    // failed attempts NEVER create donation rows — ledger stays clean
    await db.onlinePayment.update({
      where: { id: payment.id },
      data: { status: "failed", failureReason: err instanceof Error ? err.message.slice(0, 400) : "processing error" },
    });
    throw err;
  }
}
