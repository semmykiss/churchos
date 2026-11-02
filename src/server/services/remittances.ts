import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { badRequest, notFound, forbidden, conflict } from "@/server/http";
import { can, type SessionUser } from "@/server/permissions";
import { createJournalEntry } from "@/server/services/accounting";

/**
 * National / HQ / Diocesan Remittances engine.
 *   • destinations  — the Area / Province / National HQ bank accounts
 *   • rules         — % of a fund (or total unrestricted) or a fixed monthly amount
 *   • schedules     — computed monthly obligation, approved, then paid
 * Accrual: Dr 5800 Statutory Remittance Expense / Cr 2150 Remittance Payable.
 * Payment: Dr 2150 Remittance Payable / Cr 1010 Operating Bank.
 */

const TIERS = ["area", "province", "region", "national"] as const;
const RULE_SOURCE_TYPES = ["fund_percentage", "total_unrestricted_percentage", "fixed_monthly"] as const;

function assertView(user: SessionUser) {
  if (!can(user, "accounting.view") && !can(user, "accounting.manage")) {
    throw forbidden("Requires accounting.view permission.");
  }
}
function assertManage(user: SessionUser) {
  if (!can(user, "accounting.manage")) throw forbidden("Requires accounting.manage permission.");
}

function monthKey(d: Date = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// ── destinations ──────────────────────────────────────────────────────────────

export async function listDestinations(user: SessionUser) {
  assertView(user);
  const dests = await db.remittanceDestination.findMany({ where: { orgId: user.orgId }, orderBy: [{ tier: "asc" }, { name: "asc" }] });
  return { items: dests.map((d) => toDestinationDTO(d)) };
}

export async function createDestination(
  user: SessionUser,
  input: { name?: string; tier?: string; bankName?: string; accountNumberNuban?: string; accountName?: string; liabilityAccountId?: string; expenseAccountId?: string },
  meta: { ip?: string; userAgent?: string },
) {
  assertManage(user);
  if (!input?.name?.trim()) throw badRequest("Destination name is required.");
  const tier = input.tier || "national";
  if (!(TIERS as readonly string[]).includes(tier)) throw badRequest("Unknown tier.");
  if (input?.accountNumberNuban && !/^\d{10}$/.test(input.accountNumberNuban.trim())) throw badRequest("accountNumberNuban must be a 10-digit NUBAN.");
  const dest = await db.remittanceDestination.create({
    data: {
      orgId: user.orgId,
      name: input.name.trim(),
      tier,
      bankName: input.bankName?.trim() || null,
      accountNumberNuban: input.accountNumberNuban?.trim() || null,
      accountName: input.accountName?.trim() || null,
      liabilityAccountId: input.liabilityAccountId || null,
      expenseAccountId: input.expenseAccountId || null,
    },
  });
  await audit({ orgId: user.orgId, actor: user, action: "remittance.dest.create", entityType: "remittance_destination", entityId: dest.id, after: { name: dest.name, tier }, ip: meta.ip, userAgent: meta.userAgent });
  return { id: dest.id };
}

// ── rules ──────────────────────────────────────────────────────────────────────

export async function listRules(user: SessionUser) {
  assertView(user);
  const rules = await db.remittanceRule.findMany({ where: { orgId: user.orgId }, include: { destination: true }, orderBy: { name: "asc" } });
  const funds = await db.fund.findMany({ where: { orgId: user.orgId }, select: { id: true, name: true } });
  const fMap = new Map(funds.map((f) => [f.id, f] as const));
  return {
    items: rules.map((r) => ({
      id: r.id, name: r.name, destinationId: r.destinationId, destinationName: r.destination?.name ?? null,
      destinationTier: r.destination?.tier ?? null,
      sourceType: r.sourceType, fundId: r.fundId, fundName: r.fundId ? fMap.get(r.fundId)?.name ?? "Unknown" : null,
      percentageBps: r.percentageBps, fixedAmountCents: r.fixedAmountCents,
      accrueOnPosting: r.accrueOnPosting, isActive: r.isActive,
    })),
  };
}

export async function createRule(
  user: SessionUser,
  input: { name?: string; destinationId?: string; sourceType?: string; fundId?: string; percentageBps?: number; fixedAmountCents?: number; accrueOnPosting?: boolean; isActive?: boolean },
  meta: { ip?: string; userAgent?: string },
) {
  assertManage(user);
  if (!input?.name?.trim()) throw badRequest("Rule name is required.");
  if (!input?.destinationId) throw badRequest("destinationId is required.");
  const dest = await db.remittanceDestination.findFirst({ where: { id: input.destinationId, orgId: user.orgId } });
  if (!dest) throw notFound("Remittance destination not found.");
  const sourceType = input.sourceType || "fund_percentage";
  if (!(RULE_SOURCE_TYPES as readonly string[]).includes(sourceType)) throw badRequest("Unknown source type.");
  const percentageBps = Math.max(0, Math.min(10000, Math.round(Number(input.percentageBps) || 0)));
  const fixedAmountCents = Math.round(Number(input.fixedAmountCents) || 0);
  if (sourceType !== "fixed_monthly" && percentageBps <= 0) throw badRequest("percentageBps must be > 0 for percentage rules.");
  if (sourceType === "fixed_monthly" && fixedAmountCents <= 0) throw badRequest("fixedAmountCents must be > 0 for fixed rules.");
  const rule = await db.remittanceRule.create({
    data: {
      orgId: user.orgId,
      destinationId: dest.id,
      name: input.name.trim(),
      sourceType,
      fundId: input.fundId || null,
      percentageBps,
      fixedAmountCents: sourceType === "fixed_monthly" ? fixedAmountCents : null,
      accrueOnPosting: !!input.accrueOnPosting,
      isActive: input.isActive ?? true,
    },
  });
  await audit({ orgId: user.orgId, actor: user, action: "remittance.rule.create", entityType: "remittance_rule", entityId: rule.id, after: { name: rule.name, destination: dest.name, percentageBps, sourceType }, ip: meta.ip, userAgent: meta.userAgent });
  return { id: rule.id };
}

export async function updateRule(
  user: SessionUser,
  ruleId: string,
  input: { name?: string; percentageBps?: number; fixedAmountCents?: number; accrueOnPosting?: boolean; isActive?: boolean; fundId?: string | null },
  meta: { ip?: string; userAgent?: string },
) {
  assertManage(user);
  const rule = await db.remittanceRule.findFirst({ where: { id: ruleId, orgId: user.orgId } });
  if (!rule) throw notFound("Remittance rule not found.");
  const updated = await db.remittanceRule.update({
    where: { id: rule.id },
    data: {
      name: input.name?.trim() ?? rule.name,
      percentageBps: input.percentageBps != null ? Math.max(0, Math.min(10000, Math.round(Number(input.percentageBps) || 0))) : rule.percentageBps,
      fixedAmountCents: input.fixedAmountCents != null ? Math.max(0, Math.round(Number(input.fixedAmountCents) || 0)) : rule.fixedAmountCents,
      accrueOnPosting: input.accrueOnPosting ?? rule.accrueOnPosting,
      isActive: input.isActive ?? rule.isActive,
      fundId: input.fundId === null ? null : input.fundId ?? rule.fundId,
    },
  });
  await audit({ orgId: user.orgId, actor: user, action: "remittance.rule.update", entityType: "remittance_rule", entityId: rule.id, after: { percentageBps: updated.percentageBps, isActive: updated.isActive }, ip: meta.ip, userAgent: meta.userAgent });
  return { id: rule.id };
}

// ── monthly schedule ─────────────────────────────────────────────────────────

/**
 * Compute (or refresh) the remittance schedule for a month: sums all `posted`
 * Giving by fund, applies active rules, and upserts RemittanceSchedule rows.
 */
export async function computeSchedule(user: SessionUser, periodMonth?: string, meta: { ip?: string; userAgent?: string } = {}) {
  assertManage(user);
  const month = periodMonth?.trim() || monthKey();
  if (!/^\d{4}-\d{2}$/.test(month)) throw badRequest("periodMonth must be YYYY-MM.");
  const [year, mo] = month.split("-").map(Number);
  const from = new Date(Date.UTC(year, mo - 1, 1));
  const to = new Date(Date.UTC(year, mo, 1));

  const [rules, funds, donations] = await Promise.all([
    db.remittanceRule.findMany({ where: { orgId: user.orgId, isActive: true }, include: { destination: true } }),
    db.fund.findMany({ where: { orgId: user.orgId } }),
    db.donation.findMany({
      where: { orgId: user.orgId, status: "posted", receivedOn: { gte: from, lt: to } },
      include: { splits: true },
    }),
  ]);
  const fMap = new Map(funds.map((f) => [f.id, f] as const));
  // revenue by fund this month
  const revenueByFund = new Map<string, number>();
  let totalUnrestricted = 0;
  for (const d of donations) {
    for (const s of d.splits) {
      const fund = fMap.get(s.fundId);
      const amt = s.amountCents;
      revenueByFund.set(s.fundId, (revenueByFund.get(s.fundId) ?? 0) + amt);
      if (fund?.restriction === "unrestricted" || (!fund?.restriction)) totalUnrestricted += amt;
    }
  }

  const results: { destinationId: string; dueCents: number; grossBaseCents: number; rule: string }[] = [];
  for (const r of rules) {
    if (!r.destination?.id) continue;
    let base = 0;
    let due = 0;
    if (r.sourceType === "fund_percentage") {
      if (r.fundId) base = revenueByFund.get(r.fundId) ?? 0;
      else base = [...revenueByFund.values()].reduce((a, v) => a + v, 0);
      due = Math.round((base * r.percentageBps) / 10000);
    } else if (r.sourceType === "total_unrestricted_percentage") {
      base = totalUnrestricted;
      due = Math.round((base * r.percentageBps) / 10000);
    } else {
      base = r.fixedAmountCents ?? 0;
      due = base;
    }
    results.push({ destinationId: r.destination.id, dueCents: due, grossBaseCents: base, rule: r.name });
    // upsert the schedule row
    const existing = await db.remittanceSchedule.findUnique({ where: { orgId_periodMonth_destinationId: { orgId: user.orgId, periodMonth: month, destinationId: r.destination.id } } });
    if (existing && existing.status !== "draft") continue; // don't overwrite approved/paid
    if (existing) {
      await db.remittanceSchedule.update({
        where: { id: existing.id },
        data: { grossBaseCents: base, calculatedDueCents: due, netDueCents: due - existing.paidCents, balanceCents: Math.max(0, due - existing.paidCents) },
      });
    } else {
      await db.remittanceSchedule.create({
        data: { orgId: user.orgId, periodMonth: month, destinationId: r.destination.id, grossBaseCents: base, calculatedDueCents: due, netDueCents: due, paidCents: 0, balanceCents: due, status: "draft" },
      });
    }
  }
  await audit({ orgId: user.orgId, actor: user, action: "remittance.compute", entityType: "remittance_schedule", after: { month, rules: results.length }, ip: meta.ip, userAgent: meta.userAgent });
  return { month, computed: results };
}

export async function listSchedule(user: SessionUser, periodMonth?: string) {
  assertView(user);
  const month = periodMonth?.trim() || monthKey();
  const schedules = await db.remittanceSchedule.findMany({
    where: { orgId: user.orgId, periodMonth: month },
    include: { destination: true },
    orderBy: { destination: { tier: "asc" } },
  });
  return {
    month,
    items: schedules.map((s) => ({
      id: s.id, periodMonth: s.periodMonth,
      destinationId: s.destinationId, destinationName: s.destination?.name ?? null, tier: s.destination?.tier ?? null,
      bankName: s.destination?.bankName, accountNumberNuban: s.destination?.accountNumberNuban, accountName: s.destination?.accountName,
      grossBaseCents: s.grossBaseCents, calculatedDueCents: s.calculatedDueCents,
      adjustmentCents: s.adjustmentCents, adjustmentNote: s.adjustmentNote,
      netDueCents: s.netDueCents, paidCents: s.paidCents, balanceCents: s.balanceCents,
      status: s.status, paymentRef: s.paymentRef, journalEntryId: s.journalEntryId,
    })),
  };
}

/** Approve the month's schedule — books the accrual JE (Dr 5800 / Cr 2150). */
export async function approveSchedule(user: SessionUser, periodMonth: string, meta: { ip?: string; userAgent?: string }) {
  assertManage(user);
  const month = periodMonth?.trim();
  if (!month || !/^\d{4}-\d{2}$/.test(month)) throw badRequest("periodMonth must be YYYY-MM.");
  const schedules = await db.remittanceSchedule.findMany({ where: { orgId: user.orgId, periodMonth: month, status: "draft" }, include: { destination: true } });
  if (!schedules.length) throw badRequest("No draft schedules to approve for " + month + ".");
  let posted = 0;
  for (const s of schedules) {
    if (s.calculatedDueCents <= 0) continue;
    const expId = s.destination?.expenseAccountId ?? (await db.account.findFirst({ where: { orgId: user.orgId, code: "5800" } }))?.id;
    const liabId = s.destination?.liabilityAccountId ?? (await db.account.findFirst({ where: { orgId: user.orgId, code: "2150" } }))?.id;
    if (!expId || !liabId) throw badRequest("Remittance accounts (5800 / 2150) not found in the chart of accounts.");
    const entry = await createJournalEntry(user, {
      entryDate: new Date(),
      memo: `Remittance accrual — ${s.destination?.name ?? s.destinationId} (${month})`,
      sourceType: "remittance_accrual",
      sourceId: s.id,
      lines: [
        { accountId: expId, debitCents: s.calculatedDueCents, creditCents: 0 },
        { accountId: liabId, debitCents: 0, creditCents: s.calculatedDueCents },
      ],
    });
    await db.remittanceSchedule.update({ where: { id: s.id }, data: { status: "approved", journalEntryId: entry.id } });
    posted += 1;
  }
  await audit({ orgId: user.orgId, actor: user, action: "remittance.approve", entityType: "remittance_schedule", after: { month, posted }, ip: meta.ip, userAgent: meta.userAgent });
  return { month, posted };
}

/** Record a remittance payment — settles the payable (Dr 2150 / Cr 1010 Bank). */
export async function recordRemittancePayment(
  user: SessionUser,
  scheduleId: string,
  input: { bankAccountId?: string; amountCents?: number; paymentMethod?: string; paymentRef?: string; receiptUrl?: string },
  meta: { ip?: string; userAgent?: string },
) {
  assertManage(user);
  const s = await db.remittanceSchedule.findFirst({ where: { id: scheduleId, orgId: user.orgId }, include: { destination: true } });
  if (!s) throw notFound("Remittance schedule not found.");
  if (s.status === "paid") throw conflict("This schedule is already fully paid.");
  const amount = Math.round(Number(input?.amountCents));
  if (!Number.isFinite(amount) || amount <= 0) throw badRequest("amountCents must be positive.");
  if (amount > s.balanceCents) throw badRequest(`Payment ${amount} exceeds the outstanding balance ${s.balanceCents}.`);
  const bank = input.bankAccountId ? await db.bankAccount.findFirst({ where: { id: input.bankAccountId, orgId: user.orgId } }) : null;
  const cashAccountId = bank?.glAccountId ?? (await db.account.findFirst({ where: { orgId: user.orgId, code: "1010" } }))?.id ?? (await db.account.findFirst({ where: { orgId: user.orgId, code: "1000" } }))?.id;
  if (!cashAccountId) throw badRequest("No bank/cash account available for payment.");
  const liabId = s.destination?.liabilityAccountId ?? (await db.account.findFirst({ where: { orgId: user.orgId, code: "2150" } }))?.id;
  if (!liabId) throw badRequest("Remittance Payable account (2150) not found.");

  const entry = await createJournalEntry(user, {
    entryDate: new Date(),
    memo: `Remittance payment — ${s.destination?.name ?? s.destinationId} (${s.periodMonth})`,
    sourceType: "remittance_payment",
    sourceId: s.id,
    lines: [
      { accountId: liabId, debitCents: amount, creditCents: 0 },
      { accountId: cashAccountId, debitCents: 0, creditCents: amount },
    ],
  });
  const newPaid = s.paidCents + amount;
  const newBalance = Math.max(0, s.netDueCents - newPaid);
  await db.remittanceSchedule.update({
    where: { id: s.id },
    data: {
      paidCents: newPaid,
      balanceCents: newBalance,
      status: newBalance <= 0 ? "paid" : "part_paid",
      paymentRef: input.paymentRef?.trim() || s.paymentRef,
      receiptUrl: input.receiptUrl || s.receiptUrl,
    },
  });
  await audit({ orgId: user.orgId, actor: user, action: "remittance.pay", entityType: "remittance_schedule", entityId: s.id, after: { amountCents: amount, newBalance, journalEntryId: entry.id }, ip: meta.ip, userAgent: meta.userAgent });
  return { id: s.id, paidCents: newPaid, balanceCents: newBalance, status: newBalance <= 0 ? "paid" : "part_paid" };
}

function toDestinationDTO(d: any) {
  return {
    id: d.id, name: d.name, tier: d.tier, bankName: d.bankName,
    accountNumberNuban: d.accountNumberNuban, accountName: d.accountName,
    liabilityAccountId: d.liabilityAccountId, expenseAccountId: d.expenseAccountId,
    isActive: d.isActive,
  };
}

export { TIERS, RULE_SOURCE_TYPES, monthKey };
