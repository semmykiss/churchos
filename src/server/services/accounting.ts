import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { badRequest, notFound, forbidden, conflict } from "@/server/http";
import { can, type SessionUser } from "@/server/permissions";

/**
 * Accounting service (backend only) — double-entry GL for church finance.
 * Invariants:
 *  • every journal entry balances: Σ debits = Σ credits (service-enforced)
 *  • entries are APPEND-ONLY — corrections are reversing entries
 *  • posting a donation auto-creates Dr Cash / Cr Revenue per fund split
 *  • bills accrue Dr Expense / Cr AP on receipt; payments settle Dr AP / Cr Cash
 *  • report math reads journal_lines (single source of truth for the GL)
 */

// ── access helpers ───────────────────────────────────────────────────────────

function assertAccountingView(user: SessionUser) {
  if (!can(user, "accounting.view")) throw forbidden("Requires accounting.view permission.");
}
function assertAccountingManage(user: SessionUser) {
  if (!can(user, "accounting.manage")) throw forbidden("Requires accounting.manage permission.");
}

// ── chart of accounts ────────────────────────────────────────────────────────

const DEFAULT_CHART: { code: string; name: string; type: string; fundRestriction?: string; functionalClass?: string }[] = [
  // ── legacy core (kept for backward compat — existing demo data references these) ──
  { code: "1000", name: "Operating Cash", type: "asset" },
  { code: "1100", name: "Savings", type: "asset" },
  { code: "2000", name: "Accounts Payable", type: "liability" },
  { code: "3000", name: "Unrestricted Net Assets", type: "net_asset", fundRestriction: "unrestricted" },
  { code: "3100", name: "Temporarily Restricted Net Assets", type: "net_asset", fundRestriction: "temp_restricted" },
  { code: "3200", name: "Permanently Restricted Net Assets", type: "net_asset", fundRestriction: "perm_restricted" },
  { code: "4000", name: "Tithe Revenue", type: "revenue" },
  { code: "4100", name: "Offering Revenue", type: "revenue" },
  { code: "4200", name: "Designated Revenue", type: "revenue" },
  { code: "4300", name: "Building Fund Revenue", type: "revenue" },
  { code: "4400", name: "Missions Revenue", type: "revenue" },
  { code: "5000", name: "Program Expenses", type: "expense", functionalClass: "program" },
  { code: "5100", name: "Administrative Expenses", type: "expense", functionalClass: "admin" },
  { code: "5200", name: "Fundraising Expenses", type: "expense", functionalClass: "fundraising" },
  // ── Nigerian church chart (additive — seeded on first accounting read) ──
  // Assets: cash hierarchy (Bank → Safe → Petty Cash)
  { code: "1010", name: "Operating Bank Account", type: "asset" },
  { code: "1020", name: "Undeposited Cash / Church Safe", type: "asset" },
  { code: "1025", name: "Petty Cash Float", type: "asset" },
  // Liabilities: statutory remittance + WHT/PAYE payables
  { code: "2150", name: "National/HQ Remittance Payable", type: "liability" },
  { code: "2160", name: "WHT / PAYE Payable", type: "liability" },
  { code: "2165", name: "Pension Payable", type: "liability" },
  // Revenue: giving funds (each Giving Fund maps to one of these)
  { code: "4010", name: "Tithes Revenue", type: "revenue" },
  { code: "4020", name: "Sunday Love Offerings", type: "revenue" },
  { code: "4030", name: "Thanksgiving Offerings", type: "revenue" },
  { code: "4040", name: "Seed Faith / First Fruit", type: "revenue" },
  { code: "4050", name: "Children's Ministry Giving", type: "revenue" },
  { code: "4060", name: "Building / Project Fund Income", type: "revenue" },
  { code: "4070", name: "Welfare / Benevolence Income", type: "revenue" },
  { code: "4080", name: "Missions Income", type: "revenue" },
  { code: "4500", name: "Other Church Receipts", type: "revenue" },
  // Expenses: Nigerian church operations
  { code: "5110", name: "Ministry & Worship Expenses", type: "expense", functionalClass: "program" },
  { code: "5210", name: "Welfare & Benevolence Disbursements", type: "expense", functionalClass: "program" },
  { code: "5300", name: "Honoraria & Visiting Ministers", type: "expense", functionalClass: "program" },
  { code: "5400", name: "Pastoral & Staff Stipends", type: "expense", functionalClass: "admin" },
  { code: "5410", name: "Staff Payroll — Salaries", type: "expense", functionalClass: "admin" },
  { code: "5420", name: "Staff Allowances & Benefits", type: "expense", functionalClass: "admin" },
  { code: "5430", name: "Staff Bonuses", type: "expense", functionalClass: "admin" },
  { code: "5800", name: "Statutory HQ Remittances", type: "expense", functionalClass: "admin" },
  { code: "6100", name: "Generator Fuel, Power & Utilities", type: "expense", functionalClass: "admin" },
  { code: "6200", name: "Facility Maintenance & Security", type: "expense", functionalClass: "admin" },
  { code: "6300", name: "Bank Charges & Stamp Duty", type: "expense", functionalClass: "admin" },
  // Fixed assets (additive — asset module GL posting): one balance account per
  // asset category group, plus disposal gain/loss clearing accounts.
  { code: "1500", name: "Fixed Assets — Equipment & Instruments", type: "asset" },
  { code: "1510", name: "Fixed Assets — Furniture & IT", type: "asset" },
  { code: "1520", name: "Fixed Assets — Vehicles", type: "asset" },
  { code: "1530", name: "Fixed Assets — Buildings & Land", type: "asset" },
  { code: "4600", name: "Gain on Asset Disposal", type: "revenue" },
  { code: "5900", name: "Loss on Asset Disposal", type: "expense", functionalClass: "admin" },
];

/** Revenue account code for a fund (by its glAccountCode or fund type). */
const FUND_TYPE_REVENUE: Record<string, string> = {
  tithe: "4000", general: "4100", designated: "4200",
  restricted: "4200", building: "4300", missions: "4400",
};

export async function ensureChartOfAccounts(orgId: string) {
  const existing = await db.account.findFirst({ where: { orgId }, select: { id: true } });
  if (!existing) {
    await db.account.createMany({
      data: DEFAULT_CHART.map((a) => ({ orgId, code: a.code, name: a.name, type: a.type, fundRestriction: a.fundRestriction ?? "unrestricted", functionalClass: a.functionalClass ?? null })),
    }).catch(() => {}); // concurrent seed — harmless
    return;
  }
  // Additive: ensure the Nigerian chart rows exist even for orgs seeded before
  // the enterprise-accounting expansion. Never removes or renames anything.
  await ensureNigerianAccounts(orgId);
}

/** Add any missing Nigerian-coded accounts to an existing chart (additive). */
async function ensureNigerianAccounts(orgId: string) {
  const present = new Set((await db.account.findMany({ where: { orgId }, select: { code: true } })).map((a) => a.code));
  const missing = DEFAULT_CHART.filter((a) => !present.has(a.code));
  if (!missing.length) return;
  await db.account.createMany({
    data: missing.map((a) => ({ orgId, code: a.code, name: a.name, type: a.type, fundRestriction: a.fundRestriction ?? "unrestricted", functionalClass: a.functionalClass ?? null })),
  }).catch(() => {}); // race-safe
}

async function accountsByCode(orgId: string): Promise<Map<string, { id: string; code: string; name: string; type: string; functionalClass: string | null; fundRestriction: string }>> {
  await ensureChartOfAccounts(orgId);
  const accounts = await db.account.findMany({ where: { orgId } });
  return new Map(accounts.map((a) => [a.code, a] as const));
}

export async function listAccounts(user: SessionUser) {
  assertAccountingView(user);
  await ensureChartOfAccounts(user.orgId);
  const accounts = await db.account.findMany({ where: { orgId: user.orgId }, orderBy: { code: "asc" } });
  const usage = await db.journalLine.groupBy({
    by: ["accountId"], where: { orgId: user.orgId }, _sum: { debitCents: true, creditCents: true },
  });
  const usageMap = new Map(usage.map((u) => [u.accountId, u] as const));
  return {
    items: accounts.map((a) => {
      const u = usageMap.get(a.id);
      // natural balance: assets/expenses are debit-normal; the rest credit-normal
      const net = a.type === "asset" || a.type === "expense"
        ? (u?._sum.debitCents ?? 0) - (u?._sum.creditCents ?? 0)
        : (u?._sum.creditCents ?? 0) - (u?._sum.debitCents ?? 0);
      return { ...a, balanceCents: net };
    }),
  };
}

export async function createAccount(
  user: SessionUser,
  input: { code?: string; name?: string; type?: string; fundRestriction?: string; functionalClass?: string; parentAccountId?: string },
  meta: { ip?: string; userAgent?: string },
) {
  assertAccountingManage(user);
  const code = input?.code?.trim();
  const name = input?.name?.trim();
  const type = input?.type;
  if (!code || !name || !type) throw badRequest("code, name and type are required.");
  if (!["asset", "liability", "net_asset", "revenue", "expense"].includes(type)) throw badRequest("Unknown account type.");
  if (input?.functionalClass && !["program", "admin", "fundraising"].includes(input.functionalClass)) {
    throw badRequest("functionalClass must be program, admin or fundraising.");
  }
  const dupe = await db.account.findFirst({ where: { orgId: user.orgId, code } });
  if (dupe) throw conflict(`Account code ${code} already exists.`);
  const account = await db.account.create({
    data: {
      orgId: user.orgId, code, name, type,
      fundRestriction: input?.fundRestriction || "unrestricted",
      functionalClass: input?.functionalClass || null,
      parentAccountId: input?.parentAccountId || null,
    },
  });
  await audit({ orgId: user.orgId, actor: user, action: "account.create", entityType: "account", entityId: account.id, after: { code, name, type }, ip: meta.ip, userAgent: meta.userAgent });
  return { id: account.id };
}

/** Update a GL account (best practice: code is immutable once created). */
export async function updateAccount(
  user: SessionUser,
  accountId: string,
  input: { name?: string; type?: string; fundRestriction?: string; functionalClass?: string; parentAccountId?: string | null; description?: string | null; sortOrder?: number; isActive?: boolean },
  meta: { ip?: string; userAgent?: string },
) {
  assertAccountingManage(user);
  const account = await db.account.findFirst({ where: { id: accountId, orgId: user.orgId } });
  if (!account) throw notFound("Account not found.");
  if (input.type && !["asset", "liability", "net_asset", "revenue", "expense"].includes(input.type)) {
    throw badRequest("Unknown account type.");
  }
  if (input.functionalClass && !["program", "admin", "fundraising"].includes(input.functionalClass)) {
    throw badRequest("functionalClass must be program, admin or fundraising.");
  }
  // Guard: type can only change while the account has no journal activity,
  // otherwise historical report math (revenue vs expense buckets) would shift.
  if (input.type && input.type !== account.type) {
    const used = await db.journalLine.count({ where: { orgId: user.orgId, accountId: account.id } });
    if (used > 0) throw conflict("This account already has journal activity — its type cannot change. Post balances to a new account instead.");
  }
  const updated = await db.account.update({
    where: { id: account.id },
    data: {
      name: input.name?.trim() || account.name,
      type: input.type ?? account.type,
      fundRestriction: input.fundRestriction ?? account.fundRestriction,
      functionalClass: input.functionalClass !== undefined ? (input.functionalClass || null) : account.functionalClass,
      parentAccountId: input.parentAccountId !== undefined ? (input.parentAccountId || null) : account.parentAccountId,
      description: input.description !== undefined ? (input.description || null) : account.description,
      sortOrder: Number.isFinite(input.sortOrder) ? Math.round(input.sortOrder as number) : account.sortOrder,
      isActive: typeof input.isActive === "boolean" ? input.isActive : account.isActive,
    },
  });
  await audit({ orgId: user.orgId, actor: user, action: "account.update", entityType: "account", entityId: account.id, before: { name: account.name, type: account.type, isActive: account.isActive }, after: { name: updated.name, type: updated.type, isActive: updated.isActive }, ip: meta.ip, userAgent: meta.userAgent });
  return { id: updated.id };
}

/**
 * Delete a GL account — only allowed when it has NEVER been used:
 * no journal lines, no fund mapping, no bills/budgets/vouchers reference it.
 * Accounts with history must be archived (isActive=false) instead.
 */
export async function deleteAccount(
  user: SessionUser,
  accountId: string,
  meta: { ip?: string; userAgent?: string },
) {
  assertAccountingManage(user);
  const account = await db.account.findFirst({ where: { id: accountId, orgId: user.orgId } });
  if (!account) throw notFound("Account not found.");

  const [journalUses, billLineUses, budgetUses, voucherUses, receiptUses] = await Promise.all([
    db.journalLine.count({ where: { orgId: user.orgId, accountId: account.id } }),
    db.billLine.count({ where: { orgId: user.orgId, accountId: account.id } }),
    db.budget.count({ where: { orgId: user.orgId, accountId: account.id } }),
    db.paymentVoucher.count({ where: { orgId: user.orgId, expenseAccountId: account.id } }),
    db.otherReceipt.count({ where: { orgId: user.orgId, revenueAccountId: account.id } }),
  ]);
  const fundUses = await db.fund.count({
    where: { orgId: user.orgId, OR: [{ revenueAccountId: account.id }, { defaultCashAccountId: account.id }, { glAccountCode: account.code }] },
  });
  const bankUses = await db.bankAccount.count({ where: { orgId: user.orgId, glAccountId: account.id } });
  const childUses = await db.account.count({ where: { orgId: user.orgId, parentAccountId: account.id } });
  const remittanceUses = await db.remittanceDestination.count({
    where: { orgId: user.orgId, OR: [{ liabilityAccountId: account.id }, { expenseAccountId: account.id }] },
  });
  const pettyUses = await db.pettyCashDisbursement.count({ where: { orgId: user.orgId, expenseAccountId: account.id } });
  const totalUses = journalUses + billLineUses + budgetUses + voucherUses + receiptUses + fundUses + bankUses + childUses + remittanceUses + pettyUses;
  if (totalUses > 0) {
    throw conflict("This account has accounting activity or mappings and cannot be deleted. Archive it instead — history stays intact for audit.");
  }
  await db.account.delete({ where: { id: account.id } });
  await audit({ orgId: user.orgId, actor: user, action: "account.delete", entityType: "account", entityId: account.id, before: { code: account.code, name: account.name }, ip: meta.ip, userAgent: meta.userAgent });
  return { ok: true };
}

// ── journal core ─────────────────────────────────────────────────────────────

interface JournalLineInput { accountCode?: string; accountId?: string; fundId?: string | null; debitCents?: number; creditCents?: number }

/** Human-readable JE number per year, e.g. "JE-2026-0042". */
async function nextJournalReference(orgId: string, when: Date) {
  const prefix = `JE-${when.getFullYear()}-`;
  const count = await db.journalEntry.count({ where: { orgId, reference: { startsWith: prefix } } });
  return `${prefix}${String(count + 1).padStart(4, "0")}`;
}

/**
 * Create a balanced journal entry. Lines reference accounts by code or id.
 * Throws 400 when debits ≠ credits — an unbalanced entry never hits the book.
 */
export async function createJournalEntry(
  user: SessionUser,
  input: {
    entryDate?: string | Date; memo?: string; sourceType?: string; sourceId?: string;
    lines: JournalLineInput[];
  },
  opts?: { skipAudit?: boolean; actor?: SessionUser },
) {
  const actor = opts?.actor ?? user;
  const orgId = actor.orgId;
  const byCode = await accountsByCode(orgId);
  const lines: { accountId: string; fundId: string | null; debitCents: number; creditCents: number }[] = [];
  for (const l of input.lines ?? []) {
    // Resolve the account: an explicit accountId (validate it exists in THIS
    // org — never trust a client-supplied id) or a chart code. NOTE: when
    // accountId is given it is the raw id string, NOT an account object.
    let acct: { id: string } | undefined;
    if (l.accountId) {
      acct = await db.account.findFirst({ where: { orgId, id: l.accountId }, select: { id: true } }) ?? undefined;
      if (!acct) acct = byCode.get(l.accountId); // tolerate a code passed in the accountId slot
    } else if (l.accountCode) {
      acct = byCode.get(l.accountCode);
    }
    if (!acct) throw badRequest(`Unknown account ${l.accountCode ?? l.accountId}.`);
    const debit = Math.round(Number(l.debitCents) || 0);
    const credit = Math.round(Number(l.creditCents) || 0);
    if (debit < 0 || credit < 0) throw badRequest("Negative journal amounts are not allowed — post a reversing entry.");
    if (debit === 0 && credit === 0) continue;
    if (debit > 0 && credit > 0) throw badRequest("A journal line is either a debit or a credit, not both.");
    lines.push({ accountId: acct.id, fundId: l.fundId ?? null, debitCents: debit, creditCents: credit });
  }
  if (!lines.length) throw badRequest("A journal entry needs at least one non-zero line.");
  const debits = lines.reduce((a, l) => a + l.debitCents, 0);
  const credits = lines.reduce((a, l) => a + l.creditCents, 0);
  if (debits !== credits) throw badRequest(`Unbalanced entry: debits ${debits} kobo ≠ credits ${credits} kobo.`);

  const entryDate = input.entryDate ? new Date(input.entryDate) : new Date();
  const reference = await nextJournalReference(orgId, entryDate);

  const entry = await db.journalEntry.create({
    data: {
      orgId,
      entryDate,
      memo: input.memo ?? null,
      sourceType: input.sourceType ?? "manual",
      sourceId: input.sourceId ?? null,
      reference,
      createdByName: actor.name,
      lines: { create: lines.map((l) => ({ orgId, ...l })) },
    },
    include: { lines: true },
  });
  if (!opts?.skipAudit) {
    await audit({ orgId, actor, action: "journal.entry", entityType: "journal_entry", entityId: entry.id, after: { memo: entry.memo, debits, credits, lines: lines.length } });
  }
  return entry;
}

/**
 * Auto journal for a POSTED donation: Dr Cash, Cr Revenue per fund split.
 * Revenue account = the fund's glAccountCode, else by fund type, else 4100.
 */
export async function journalDonation(user: SessionUser, donationId: string) {
  const donation = await db.donation.findFirst({ where: { id: donationId, orgId: user.orgId }, include: { splits: true } });
  if (!donation || donation.status !== "posted") return null;
  const existing = await db.journalEntry.findFirst({ where: { orgId: user.orgId, sourceType: "donation", sourceId: donation.id } });
  if (existing) return existing;

  const byCode = await accountsByCode(user.orgId);
  const byId = await db.account.findMany({ where: { orgId: user.orgId } }).then((rs) => new Map(rs.map((a) => [a.id, a] as const)));
  const funds = await db.fund.findMany({ where: { orgId: user.orgId, id: { in: donation.splits.map((s) => s.fundId) } } });
  const fundMap = new Map(funds.map((f) => [f.id, f] as const));
  // Cash account: honor the fund's defaultCashAccountId, else legacy 1000 Operating Cash.
  const defaultCash = byCode.get("1000");

  // Aggregate credit (revenue) lines per (account, fund), and the debit (cash) side.
  const lineAgg = new Map<string, { accountId: string; accountCode: string; fundId: string | null; creditCents: number }>();
  let cashAccount: { id: string; code: string } | null = null;
  for (const s of donation.splits) {
    const fund = fundMap.get(s.fundId);
    // Revenue account: explicit fund.revenueAccountId (by id) → fund.glAccountCode (by code) → by type → 4100.
    let revAcct = fund?.revenueAccountId ? byId.get(fund.revenueAccountId) : undefined;
    if (!revAcct) {
      const code = fund?.glAccountCode ?? FUND_TYPE_REVENUE[fund?.type ?? "general"] ?? "4100";
      revAcct = byCode.get(code) ?? byCode.get("4100");
    }
    if (!revAcct) throw badRequest("Chart of accounts is missing a revenue account for fund " + (fund?.name ?? s.fundId));
    const key = `${revAcct.id}:${s.fundId}`;
    const agg = lineAgg.get(key) ?? { accountId: revAcct.id, accountCode: revAcct.code, fundId: s.fundId, creditCents: 0 };
    agg.creditCents += s.amountCents;
    lineAgg.set(key, agg);
    // Cash account for the debit side: fund.defaultCashAccountId (by id) → 1000.
    if (!cashAccount) {
      if (fund?.defaultCashAccountId) {
        const c = byId.get(fund.defaultCashAccountId);
        if (c) cashAccount = { id: c.id, code: c.code };
      }
      if (!cashAccount && defaultCash) cashAccount = { id: defaultCash.id, code: defaultCash.code };
    }
  }
  if (!cashAccount) throw badRequest("Chart of accounts is missing the 1000 Operating Cash account.");

  const revLines = [...lineAgg.values()];
  const debitTotal = donation.amountCents;

  // Statutory remittance accrual-on-posting: for each fund split with an active
  // accrueOnPosting rule, append Dr 5800 / Cr 2150 lines (proportional to the
  // gift's revenue credit per destination). Additive — only when rules exist.
  const accrualLines: { accountId: string; fundId: string | null; debitCents: number; creditCents: number }[] = [];
  const rules = await db.remittanceRule.findMany({
    where: { orgId: user.orgId, accrueOnPosting: true, isActive: true, sourceType: "fund_percentage" },
    include: { destination: true },
  });
  for (const r of rules) {
    if (!r.destination?.liabilityAccountId || !r.destination?.expenseAccountId) continue;
    // base = sum of revenue credits for this rule's fund (or all funds if fundId null)
    const base = revLines
      .filter((l) => !r.fundId || l.fundId === r.fundId)
      .reduce((a, l) => a + l.creditCents, 0);
    if (base <= 0 || r.percentageBps <= 0) continue;
    const due = Math.round((base * r.percentageBps) / 10000);
    if (due <= 0) continue;
    accrualLines.push({ accountId: r.destination.expenseAccountId, fundId: r.fundId, debitCents: due, creditCents: 0 });
    accrualLines.push({ accountId: r.destination.liabilityAccountId, fundId: r.fundId, debitCents: 0, creditCents: due });
  }
  // accrual debits must equal accrual credits; the cash debit + accrual debit
  // total must equal the revenue credit + accrual credit total for balance.
  const accrualDebit = accrualLines.reduce((a, l) => a + l.debitCents, 0);
  const accrualCredit = accrualLines.reduce((a, l) => a + l.creditCents, 0);
  // the donation's cash debit stays = donation.amountCents; accrual adds equal
  // Dr expense / Cr liability so the entry still balances (debitTotal + accrualDebit
  // === sum(rev credits) + accrualCredit). Since accrualDebit===accrualCredit and
  // debitTotal === sum(rev credits), the whole entry balances.
  void accrualDebit; void accrualCredit;

  return createJournalEntry(user, {
    entryDate: donation.receivedOn,
    memo: `Gift from ${donation.personId ?? "donor"} — ${donation.method}`,
    sourceType: "donation",
    sourceId: donation.id,
    lines: [
      { accountId: cashAccount.id, debitCents: debitTotal },
      ...revLines.map((l) => ({ accountId: l.accountId, fundId: l.fundId, creditCents: l.creditCents })),
      ...accrualLines.map((l) => ({ accountId: l.accountId, fundId: l.fundId, debitCents: l.debitCents, creditCents: l.creditCents })),
    ],
  }, { skipAudit: true });
}

/** One-off: create GL entries for donations that predate the accounting module. */
export async function backfillDonationJournal(user: SessionUser, meta: { ip?: string; userAgent?: string }) {
  assertAccountingManage(user);
  const donations = await db.donation.findMany({
    where: { orgId: user.orgId, status: "posted" },
    select: { id: true },
    take: 5000,
  });
  let created = 0;
  for (const d of donations) {
    const entry = await journalDonation(user, d.id);
    if (entry) created += 1;
  }
  await audit({ orgId: user.orgId, actor: user, action: "accounting.backfill", entityType: "journal_entry", after: { donations: donations.length, entriesCreated: created }, ip: meta.ip, userAgent: meta.userAgent });
  return { donations: donations.length, entriesCreated: created };
}

export async function listJournalEntries(user: SessionUser, q: { take?: number }) {
  assertAccountingView(user);
  const entries = await db.journalEntry.findMany({
    where: { orgId: user.orgId },
    orderBy: [{ entryDate: "desc" }, { createdAt: "desc" }],
    take: Math.min(200, Math.max(10, q.take ?? 50)),
    include: { lines: true },
  });
  const accountIds = [...new Set(entries.flatMap((e) => e.lines.map((l) => l.accountId)))];
  const accounts = accountIds.length ? await db.account.findMany({ where: { orgId: user.orgId, id: { in: accountIds } } }) : [];
  const aMap = new Map(accounts.map((a) => [a.id, a] as const));
  return {
    items: entries.map((e) => ({
      id: e.id, entryDate: e.entryDate, memo: e.memo, sourceType: e.sourceType, sourceId: e.sourceId,
      reference: e.reference, createdByName: e.createdByName, reversedByEntryId: e.reversedByEntryId,
      lines: e.lines.map((l) => ({
        accountCode: aMap.get(l.accountId)?.code ?? "?",
        accountName: aMap.get(l.accountId)?.name ?? "Unknown",
        fundId: l.fundId,
        debitCents: l.debitCents,
        creditCents: l.creditCents,
      })),
    })),
  };
}

// ── vendors & bills (accounts payable) ───────────────────────────────────────

export async function listVendors(user: SessionUser) {
  assertAccountingView(user);
  const vendors = await db.vendor.findMany({ where: { orgId: user.orgId }, orderBy: { name: "asc" }, take: 200 });
  const openBills = await db.bill.groupBy({ by: ["vendorId"], where: { orgId: user.orgId, status: { in: ["unpaid", "partial"] } }, _sum: { totalCents: true }, _count: true });
  const openMap = new Map(openBills.map((b) => [b.vendorId, b] as const));
  return {
    items: vendors.map((v) => ({
      ...v,
      openBillCount: openMap.get(v.id)?._count ?? 0,
      openTotalCents: openMap.get(v.id)?._sum.totalCents ?? 0,
    })),
  };
}

export async function createVendor(
  user: SessionUser,
  input: { name?: string; email?: string; phone?: string; address?: string; taxId?: string; defaultExpenseAccountId?: string },
  meta: { ip?: string; userAgent?: string },
) {
  assertAccountingManage(user);
  if (!input?.name?.trim()) throw badRequest("Vendor name is required.");
  const vendor = await db.vendor.create({
    data: {
      orgId: user.orgId,
      name: input.name.trim(),
      email: input.email?.trim() || null,
      phone: input.phone?.trim() || null,
      address: input.address?.trim() || null,
      taxId: input.taxId?.trim() || null,
      defaultExpenseAccountId: input.defaultExpenseAccountId || null,
    },
  });
  await audit({ orgId: user.orgId, actor: user, action: "vendor.create", entityType: "vendor", entityId: vendor.id, after: { name: vendor.name }, ip: meta.ip, userAgent: meta.userAgent });
  return { id: vendor.id };
}

export async function listBills(user: SessionUser) {
  assertAccountingView(user);
  const bills = await db.bill.findMany({
    where: { orgId: user.orgId },
    orderBy: [{ dueDate: "asc" }],
    take: 200,
    include: { vendor: true, lines: true, payments: true },
  });
  return {
    items: bills.map((b) => {
      const paid = b.payments.reduce((a, p) => a + p.amountCents, 0);
      return {
        id: b.id,
        vendor: { id: b.vendor.id, name: b.vendor.name },
        billNumber: b.billNumber,
        billDate: b.billDate,
        dueDate: b.dueDate,
        status: b.status,
        totalCents: b.totalCents,
        paidCents: paid,
        balanceCents: b.totalCents - paid,
        memo: b.memo,
        lines: b.lines.map((l) => ({ accountId: l.accountId, fundId: l.fundId, description: l.description, amountCents: l.amountCents })),
        payments: b.payments.map((p) => ({ id: p.id, paidOn: p.paidOn, method: p.method, checkNumber: p.checkNumber, amountCents: p.amountCents })),
      };
    }),
  };
}

export async function createBill(
  user: SessionUser,
  input: { vendorId?: string; billNumber?: string; billDate?: string; dueDate?: string; memo?: string; lines?: { accountId?: string; fundId?: string; description?: string; amountCents?: number }[] },
  meta: { ip?: string; userAgent?: string },
) {
  assertAccountingManage(user);
  if (!input?.vendorId) throw badRequest("vendorId is required.");
  const vendor = await db.vendor.findFirst({ where: { id: input.vendorId, orgId: user.orgId, isActive: true } });
  if (!vendor) throw notFound("Vendor not found.");
  const lines = (input.lines ?? []).filter((l) => Math.round(Number(l.amountCents) || 0) > 0);
  if (!lines.length) throw badRequest("At least one bill line is required.");
  const total = lines.reduce((a, l) => a + Math.round(Number(l.amountCents) || 0), 0);
  if (!Number.isFinite(total) || total <= 0) throw badRequest("Bill total must be positive.");

  const bill = await db.$transaction(async (tx) => {
    const b = await tx.bill.create({
      data: {
        orgId: user.orgId,
        vendorId: vendor.id,
        billNumber: input.billNumber?.trim() || null,
        billDate: input.billDate ? new Date(input.billDate) : new Date(),
        dueDate: input.dueDate ? new Date(input.dueDate) : new Date(),
        status: "unpaid",
        totalCents: total,
        memo: input.memo?.trim() || null,
        createdByName: user.name,
        lines: {
          create: lines.map((l) => ({
            orgId: user.orgId,
            accountId: l.accountId!,
            fundId: l.fundId || null,
            description: l.description?.trim() || null,
            amountCents: Math.round(Number(l.amountCents) || 0),
          })),
        },
      },
    });
    // accrual: Dr Expense (per line) / Cr Accounts Payable
    await tx.journalEntry.create({
      data: {
        orgId: user.orgId,
        entryDate: b.billDate,
        memo: `Bill ${b.billNumber ?? b.id} — ${vendor.name}`,
        sourceType: "bill",
        sourceId: b.id,
        createdByName: user.name,
        lines: {
          create: [
            ...lines.map((l) => ({ orgId: user.orgId, accountId: l.accountId!, fundId: l.fundId || null, debitCents: Math.round(Number(l.amountCents) || 0), creditCents: 0 })),
            { orgId: user.orgId, accountId: (await tx.account.findFirst({ where: { orgId: user.orgId, code: "2000" } }))?.id ?? "", debitCents: 0, creditCents: total },
          ].filter((l) => l.accountId),
        },
      },
    });
    return b;
  });
  await audit({ orgId: user.orgId, actor: user, action: "bill.create", entityType: "bill", entityId: bill.id, after: { vendor: vendor.name, totalCents: total }, ip: meta.ip, userAgent: meta.userAgent });
  return { id: bill.id, totalCents: total };
}

export async function payBill(
  user: SessionUser,
  billId: string,
  input: { paidOn?: string; method?: string; checkNumber?: string; amountCents?: number; bankAccountId?: string },
  meta: { ip?: string; userAgent?: string },
) {
  assertAccountingManage(user);
  const bill = await db.bill.findFirst({ where: { id: billId, orgId: user.orgId }, include: { vendor: true, payments: true, lines: true } });
  if (!bill) throw notFound("Bill not found.");
  if (bill.status === "void") throw conflict("This bill is void.");
  const amount = Math.round(Number(input?.amountCents));
  if (!Number.isFinite(amount) || amount <= 0) throw badRequest("amountCents must be positive.");
  const alreadyPaid = bill.payments.reduce((a, p) => a + p.amountCents, 0);
  const balance = bill.totalCents - alreadyPaid;
  if (amount > balance) throw badRequest(`Payment ${amount} kobo exceeds the remaining balance ${balance} kobo.`);

  const ap = await db.account.findFirst({ where: { orgId: user.orgId, code: "2000" } });
  if (!ap) throw badRequest("Chart of accounts is missing 2000 Accounts Payable.");
  let cashAccountId: string | null = null;
  if (input?.bankAccountId) {
    const bank = await db.bankAccount.findFirst({ where: { id: input.bankAccountId, orgId: user.orgId } });
    cashAccountId = bank?.glAccountId ?? null;
  }
  if (!cashAccountId) cashAccountId = (await db.account.findFirst({ where: { orgId: user.orgId, code: "1000" } }))?.id ?? null;
  if (!cashAccountId) throw badRequest("No cash account available.");

  const payment = await db.$transaction(async (tx) => {
    const p = await tx.billPayment.create({
      data: {
        orgId: user.orgId,
        billId: bill.id,
        paidOn: input.paidOn ? new Date(input.paidOn) : new Date(),
        method: input.method || "check",
        checkNumber: input.checkNumber?.trim() || null,
        amountCents: amount,
        bankAccountId: input.bankAccountId || null,
        createdByName: user.name,
      },
    });
    // settlement: Dr AP / Cr Cash (pro-rated across the bill's expense lines keeps fund attribution)
    const entry = await tx.journalEntry.create({
      data: {
        orgId: user.orgId,
        entryDate: p.paidOn,
        memo: `Payment — bill ${bill.billNumber ?? bill.id} (${bill.vendor.name})`,
        sourceType: "bill_payment",
        sourceId: p.id,
        createdByName: user.name,
        lines: {
          create: [
            ...bill.lines.map((l) => ({
              orgId: user.orgId,
              accountId: ap.id,
              fundId: l.fundId,
              debitCents: Math.round((l.amountCents / bill.totalCents) * amount),
              creditCents: 0,
            })),
            { orgId: user.orgId, accountId: cashAccountId!, debitCents: 0, creditCents: amount },
          ],
        },
      },
    });
    await tx.billPayment.update({ where: { id: p.id }, data: { journalEntryId: entry.id } });
    const newPaid = alreadyPaid + amount;
    await tx.bill.update({ where: { id: bill.id }, data: { status: newPaid >= bill.totalCents ? "paid" : "partial" } });
    return p;
  });
  await audit({ orgId: user.orgId, actor: user, action: "bill.pay", entityType: "bill", entityId: bill.id, after: { amountCents: amount, method: payment.method }, ip: meta.ip, userAgent: meta.userAgent });
  return { id: payment.id };
}

export async function voidBill(user: SessionUser, billId: string, meta: { ip?: string; userAgent?: string }) {
  assertAccountingManage(user);
  const bill = await db.bill.findFirst({ where: { id: billId, orgId: user.orgId }, include: { payments: true } });
  if (!bill) throw notFound("Bill not found.");
  if (bill.payments.length > 0) throw conflict("A bill with payments cannot be voided — reverse the payments first.");
  await db.bill.update({ where: { id: bill.id }, data: { status: "void" } });
  await audit({ orgId: user.orgId, actor: user, action: "bill.void", entityType: "bill", entityId: bill.id, ip: meta.ip, userAgent: meta.userAgent });
  return { ok: true };
}

// ── bank reconciliation ──────────────────────────────────────────────────────

export async function listBankAccounts(user: SessionUser) {
  assertAccountingView(user);
  const accounts = await db.bankAccount.findMany({ where: { orgId: user.orgId }, orderBy: { name: "asc" } });
  const glIds = accounts.map((a) => a.glAccountId).filter(Boolean) as string[];
  const glAccounts = glIds.length ? await db.account.findMany({ where: { orgId: user.orgId, id: { in: glIds } } }) : [];
  const glMap = new Map(glAccounts.map((a) => [a.id, a] as const));
  return {
    items: accounts.map((a) => ({
      id: a.id, name: a.name, accountType: a.accountType, isActive: a.isActive,
      glAccountCode: a.glAccountId ? glMap.get(a.glAccountId)?.code ?? null : null,
    })),
  };
}

export async function createBankAccount(
  user: SessionUser,
  input: { name?: string; accountType?: string; glAccountId?: string },
  meta: { ip?: string; userAgent?: string },
) {
  assertAccountingManage(user);
  if (!input?.name?.trim()) throw badRequest("Bank account name is required.");
  const bank = await db.bankAccount.create({
    data: {
      orgId: user.orgId,
      name: input.name.trim(),
      accountType: input.accountType || "checking",
      glAccountId: input.glAccountId || null,
    },
  });
  await audit({ orgId: user.orgId, actor: user, action: "bank_account.create", entityType: "bank_account", entityId: bank.id, after: { name: bank.name }, ip: meta.ip, userAgent: meta.userAgent });
  return { id: bank.id };
}

export async function getBankTransactions(user: SessionUser, bankAccountId: string) {
  assertAccountingView(user);
  const bank = await db.bankAccount.findFirst({ where: { id: bankAccountId, orgId: user.orgId } });
  if (!bank) throw notFound("Bank account not found.");
  const txns = await db.bankTransaction.findMany({
    where: { orgId: user.orgId, bankAccountId },
    orderBy: [{ postedDate: "desc" }],
    take: 300,
  });
  // unreconciled cash-side journal entries for the same GL account (candidates to match)
  let entries: { id: string; entryDate: Date; memo: string | null; amountCents: number }[] = [];
  if (bank.glAccountId) {
    const lines = await db.journalLine.findMany({
      where: { orgId: user.orgId, accountId: bank.glAccountId },
      include: { journalEntry: true },
      orderBy: { journalEntry: { entryDate: "desc" } },
      take: 1000,
    });
    const agg = new Map<string, { id: string; entryDate: Date; memo: string | null; amountCents: number }>();
    for (const l of lines) {
      if (l.journalEntry.reversedByEntryId) continue;
      const e = agg.get(l.journalEntryId) ?? { id: l.journalEntryId, entryDate: l.journalEntry.entryDate, memo: l.journalEntry.memo, amountCents: 0 };
      e.amountCents += l.debitCents - l.creditCents; // cash inflow positive
      agg.set(l.journalEntryId, e);
    }
    entries = [...agg.values()].sort((a, b) => b.entryDate.getTime() - a.entryDate.getTime()).slice(0, 100);
  }
  const reconciledCount = txns.filter((t) => t.reconciled).length;
  const bookBalance = entries.reduce((a, e) => a + e.amountCents, 0);
  const bankBalance = txns.reduce((a, t) => a + t.amountCents, 0);
  return {
    bankAccount: { id: bank.id, name: bank.name, glAccountCode: bank.glAccountId },
    transactions: txns.map((t) => ({
      id: t.id, postedDate: t.postedDate, description: t.description, amountCents: t.amountCents,
      reconciled: t.reconciled, matchedJournalEntryId: t.matchedJournalEntryId,
    })),
    entries: entries.map((e) => ({ id: e.id, entryDate: e.entryDate, memo: e.memo, amountCents: e.amountCents })),
    summary: { bookBalanceCents: bookBalance, bankBalanceCents: bankBalance, differenceCents: bookBalance - bankBalance, reconciledCount, totalCount: txns.length },
  };
}

/**
 * Parse an OFX/QBO/OFX-QFX statement (both OFX 1.x SGML and 2.x XML forms —
 * banks ship all of them). Extracts STMTTRN records: date, amount, name/memo.
 * Only safe, well-formed numeric fields are used; anything odd is skipped.
 */
function parseOfxStatement(content: string): { postedDate: Date; description: string | null; amountCents: number }[] {
  const rows: { postedDate: Date; description: string | null; amountCents: number }[] = [];
  const blocks = content.match(/<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi) ?? [];
  for (const block of blocks) {
    const tag = (t: string) => {
      const m = block.match(new RegExp(`<${t}>([^<\\r\\n]*)`, "i"));
      return m ? m[1].trim() : "";
    };
    // DTPOSTED forms: YYYYMMDD, YYYYMMDDHHMMSS, YYYYMMDDHHMMSS.XXX[gmt offset]
    const rawDate = tag("DTPOSTED").replace(/\D/g, "").slice(0, 8);
    if (!/^\d{8}$/.test(rawDate)) continue;
    const postedDate = new Date(`${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}T00:00:00Z`);
    if (isNaN(postedDate.getTime())) continue;
    const amountNum = Number(tag("TRNAMT").replace(/[₦$,\s]|NGN/g, ""));
    if (!Number.isFinite(amountNum)) continue;
    const description = (tag("NAME") || tag("PAYEE") || tag("MEMO")).slice(0, 300) || null;
    rows.push({ postedDate, description, amountCents: Math.round(amountNum * 100) });
  }
  return rows;
}

/**
 * Import a bank statement — CSV (date,description,amount rows, header
 * optional) or OFX/QFX (auto-detected). Re-imports are idempotent: rows are
 * deduped on (account, date, description, amount).
 */
export async function importBankStatement(
  user: SessionUser,
  bankAccountId: string,
  content: string,
  meta: { ip?: string; userAgent?: string },
) {
  assertAccountingManage(user);
  const bank = await db.bankAccount.findFirst({ where: { id: bankAccountId, orgId: user.orgId } });
  if (!bank) throw notFound("Bank account not found.");
  const isOfx = /<\s*(ofx|stmttrn)/i.test(content);
  const rows = isOfx
    ? parseOfxStatement(content)
    : parseCsvStatement(content);
  if (!rows.length) {
    throw badRequest(isOfx
      ? "No transactions found in the OFX file (expected <STMTTRN> blocks)."
      : "No valid rows found. Expected CSV: date,description,amount");
  }
  // SQLite has no skipDuplicates — dedupe on the natural key ourselves
  const existing = await db.bankTransaction.findMany({
    where: { orgId: user.orgId, bankAccountId },
    select: { postedDate: true, description: true, amountCents: true },
  });
  const seen = new Set(existing.map((t) => `${t.postedDate.toISOString()}|${t.description ?? ""}|${t.amountCents}`));
  const fresh = rows.filter((r) => !seen.has(`${r.postedDate.toISOString()}|${r.description ?? ""}|${r.amountCents}`));
  if (!fresh.length) return { imported: 0, parsed: rows.length, format: isOfx ? "ofx" : "csv" };
  const created = await db.bankTransaction.createMany({
    data: fresh.map((r) => ({ orgId: user.orgId, bankAccountId, postedDate: r.postedDate, description: r.description, amountCents: r.amountCents })),
  });
  await audit({ orgId: user.orgId, actor: user, action: "bank.import", entityType: "bank_account", entityId: bankAccountId, after: { format: isOfx ? "ofx" : "csv", rows: rows.length, imported: created.count }, ip: meta.ip, userAgent: meta.userAgent });
  return { imported: created.count, parsed: rows.length, format: isOfx ? "ofx" : "csv" };
}

/** CSV statement rows: date,description,amount (header tolerated). */
function parseCsvStatement(csv: string): { postedDate: Date; description: string | null; amountCents: number }[] {
  const rows: { postedDate: Date; description: string | null; amountCents: number }[] = [];
  const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    const parts = line.split(",").map((p) => p.trim().replace(/^"|"$/g, ""));
    if (parts.length < 3) continue;
    const datePart = parts[0];
    const amountPart = parts[parts.length - 1].replace(/[₦$,\s]|NGN/g, "");
    const date = new Date(datePart);
    const amount = Math.round(Number(amountPart) * 100);
    if (isNaN(date.getTime()) || !Number.isFinite(amount)) continue;
    if (/date/i.test(datePart) && isNaN(Number(amountPart[0]))) continue; // header row
    rows.push({ postedDate: date, description: parts.slice(1, parts.length - 1).join(", ") || null, amountCents: amount });
  }
  return rows;
}

export async function matchBankTransaction(
  user: SessionUser,
  transactionId: string,
  input: { journalEntryId?: string },
  meta: { ip?: string; userAgent?: string },
) {
  assertAccountingManage(user);
  const txn = await db.bankTransaction.findFirst({ where: { id: transactionId, orgId: user.orgId } });
  if (!txn) throw notFound("Bank transaction not found.");
  if (!input?.journalEntryId) throw badRequest("journalEntryId is required.");
  const entry = await db.journalEntry.findFirst({ where: { id: input.journalEntryId, orgId: user.orgId } });
  if (!entry) throw notFound("Journal entry not found.");
  await db.bankTransaction.update({ where: { id: txn.id }, data: { matchedJournalEntryId: entry.id, reconciled: true } });
  await audit({ orgId: user.orgId, actor: user, action: "bank.match", entityType: "bank_transaction", entityId: txn.id, after: { journalEntryId: entry.id }, ip: meta.ip, userAgent: meta.userAgent });
  return { ok: true };
}

// ── budgets ──────────────────────────────────────────────────────────────────

export async function getBudgets(user: SessionUser, fiscalYear?: number, kind?: "expense" | "revenue") {
  assertAccountingView(user);
  const year = fiscalYear ?? new Date().getFullYear();
  const accountType = kind === "revenue" ? "revenue" : "expense";
  const [budgets, accounts] = await Promise.all([
    db.budget.findMany({ where: { orgId: user.orgId, fiscalYear: year } }),
    db.account.findMany({ where: { orgId: user.orgId, type: accountType, isActive: true }, orderBy: { code: "asc" } }),
  ]);
  const actualLines = await db.journalLine.findMany({
    where: {
      orgId: user.orgId,
      accountId: { in: accounts.map((a) => a.id) },
      journalEntry: { entryDate: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) } },
    },
    select: { accountId: true, debitCents: true, creditCents: true },
  });
  const actual: Record<string, number[]> = {};
  for (const l of actualLines) {
    // attribute to the entry's month via a second pass — approximate with entry date join below
    actual[l.accountId] = actual[l.accountId] ?? [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  }
  const entries = await db.journalEntry.findMany({
    where: {
      orgId: user.orgId,
      entryDate: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) },
      lines: { some: { accountId: { in: accounts.map((a) => a.id) } } },
    },
    select: { id: true, entryDate: true, lines: { select: { accountId: true, debitCents: true, creditCents: true } } },
  });
  // revenue is credit-normal (credit − debit); expense is debit-normal (debit − credit)
  const creditNormal = accountType === "revenue";
  for (const e of entries) {
    const month = e.entryDate.getUTCMonth();
    for (const l of e.lines) {
      if (!(accounts.some((a) => a.id === l.accountId))) continue;
      const bucket = (actual[l.accountId] ??= [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
      bucket[month] += creditNormal ? l.creditCents - l.debitCents : l.debitCents - l.creditCents;
    }
  }
  return {
    fiscalYear: year,
    kind: accountType,
    accounts: accounts.map((a) => ({ id: a.id, code: a.code, name: a.name })),
    budgets: budgets.map((b) => ({ id: b.id, accountId: b.accountId, fundId: b.fundId, monthly: JSON.parse(b.monthlyCentsJson) as number[] })),
    actual,
  };
}

export async function upsertBudget(
  user: SessionUser,
  input: { fiscalYear?: number; accountId?: string; fundId?: string | null; monthly?: number[] },
  meta: { ip?: string; userAgent?: string },
) {
  assertAccountingManage(user);
  const year = Math.round(Number(input?.fiscalYear));
  if (!Number.isFinite(year) || year < 2000 || year > 2100) throw badRequest("A valid fiscalYear is required.");
  if (!input?.accountId) throw badRequest("accountId is required.");
  if (!Array.isArray(input.monthly) || input.monthly.length !== 12) throw badRequest("monthly must be 12 cent amounts (Jan..Dec).");
  const monthly = input.monthly.map((v) => Math.max(0, Math.round(Number(v) || 0)));
  const account = await db.account.findFirst({ where: { id: input.accountId, orgId: user.orgId } });
  if (!account) throw notFound("Account not found.");
  // SQLite compound-unique upsert cannot take fundId: null — resolve manually
  const existing = await db.budget.findFirst({
    where: { orgId: user.orgId, fiscalYear: year, accountId: input.accountId, fundId: input.fundId ?? null },
  });
  const budget = existing
    ? await db.budget.update({ where: { id: existing.id }, data: { monthlyCentsJson: JSON.stringify(monthly) } })
    : await db.budget.create({
        data: { orgId: user.orgId, fiscalYear: year, accountId: input.accountId, fundId: input.fundId ?? null, monthlyCentsJson: JSON.stringify(monthly) },
      });
  await audit({ orgId: user.orgId, actor: user, action: "budget.upsert", entityType: "budget", entityId: budget.id, after: { fiscalYear: year, accountId: input.accountId, total: monthly.reduce((a, b) => a + b, 0) }, ip: meta.ip, userAgent: meta.userAgent });
  return { id: budget.id };
}

// ── reports ──────────────────────────────────────────────────────────────────

async function journalTotals(orgId: string, from: Date, to: Date) {
  const entries = await db.journalEntry.findMany({
    where: { orgId, entryDate: { gte: from, lt: to }, reversedByEntryId: null },
    select: { id: true, lines: { select: { accountId: true, fundId: true, debitCents: true, creditCents: true } } },
  });
  // tag each line with its parent entry id so callers (e.g. receipts & payments)
  // can pair offsetting debit/credit lines within the same entry.
  return entries.flatMap((e) => e.lines.map((l) => ({ ...l, journalEntryId: e.id })));
}

/** Statement of Activities — revenue and expense by fund for a date range. */
export async function reportActivities(user: SessionUser, from?: string, to?: string) {
  assertAccountingView(user);
  const year = new Date().getUTCFullYear();
  const f = from ? new Date(from) : new Date(Date.UTC(year, 0, 1));
  const t = to ? new Date(to) : new Date(Date.UTC(year + 1, 0, 1));
  await ensureChartOfAccounts(user.orgId);
  const [accounts, funds, lines] = await Promise.all([
    db.account.findMany({ where: { orgId: user.orgId } }),
    db.fund.findMany({ where: { orgId: user.orgId } }),
    journalTotals(user.orgId, f, t),
  ]);
  const aMap = new Map(accounts.map((a) => [a.id, a] as const));
  const fMap = new Map(funds.map((x) => [x.id, x] as const));

  const revenue = new Map<string, { fundName: string; fundType: string; amountCents: number }>();
  const expense = new Map<string, { fundName: string; amountCents: number }>();
  const byFunctional: Record<string, number> = { program: 0, admin: 0, fundraising: 0 };
  for (const l of lines) {
    const acct = aMap.get(l.accountId);
    if (!acct) continue;
    const fundName = l.fundId ? fMap.get(l.fundId)?.name ?? "General" : "Unassigned";
    if (acct.type === "revenue" && l.creditCents > 0) {
      const key = l.fundId ?? "unassigned";
      const agg = revenue.get(key) ?? { fundName, fundType: l.fundId ? fMap.get(l.fundId)?.type ?? "general" : "unassigned", amountCents: 0 };
      agg.amountCents += l.creditCents;
      revenue.set(key, agg);
    }
    if (acct.type === "expense" && l.debitCents > 0) {
      const key = l.fundId ?? "unassigned";
      const agg = expense.get(key) ?? { fundName, amountCents: 0 };
      agg.amountCents += l.debitCents;
      expense.set(key, agg);
      byFunctional[acct.functionalClass ?? "program"] += l.debitCents;
    }
  }
  const totalRevenue = [...revenue.values()].reduce((a, r) => a + r.amountCents, 0);
  const totalExpense = [...expense.values()].reduce((a, e) => a + e.amountCents, 0);
  return {
    range: { from: f, to: t },
    revenue: [...revenue.entries()].map(([fundId, v]) => ({ fundId, ...v })),
    expenses: [...expense.entries()].map(([fundId, v]) => ({ fundId, ...v })),
    byFunctional,
    totalRevenueCents: totalRevenue,
    totalExpenseCents: totalExpense,
    netCents: totalRevenue - totalExpense,
  };
}

/** Statement of Financial Position — assets, liabilities, net assets as of a date. */
export async function reportPosition(user: SessionUser, asOf?: string) {
  assertAccountingView(user);
  const d = asOf ? new Date(asOf) : new Date();
  const to = new Date(d.getTime() + 24 * 3600 * 1000); // inclusive day
  await ensureChartOfAccounts(user.orgId);
  const [accounts, lines] = await Promise.all([
    db.account.findMany({ where: { orgId: user.orgId } }),
    journalTotals(user.orgId, new Date(0), to),
  ]);
  const aMap = new Map(accounts.map((a) => [a.id, a] as const));
  const assets: { code: string; name: string; balanceCents: number }[] = [];
  const liabilities: { code: string; name: string; balanceCents: number }[] = [];
  const netAssets: { code: string; name: string; restriction: string; balanceCents: number }[] = [];
  for (const a of accounts) {
    const linesFor = lines.filter((l) => l.accountId === a.id);
    const debits = linesFor.reduce((x, l) => x + l.debitCents, 0);
    const credits = linesFor.reduce((x, l) => x + l.creditCents, 0);
    const natural = a.type === "asset" || a.type === "expense" ? debits - credits : credits - debits;
    if (a.type === "asset" && natural !== 0) assets.push({ code: a.code, name: a.name, balanceCents: natural });
    if (a.type === "liability" && natural !== 0) liabilities.push({ code: a.code, name: a.name, balanceCents: natural });
    if (a.type === "net_asset" && natural !== 0) netAssets.push({ code: a.code, name: a.name, restriction: a.fundRestriction, balanceCents: natural });
  }
  const totalAssets = assets.reduce((x, a) => x + a.balanceCents, 0);
  const totalLiabilities = liabilities.reduce((x, l) => x + l.balanceCents, 0);
  // Revenue/expense accounts haven't "closed" into net assets (no year-end close
  // in this book), so Net Assets = NA accounts + undesignated surplus. In a
  // balanced double-entry book this makes A = L + NA hold exactly.
  const naAccountsTotal = netAssets.reduce((x, n) => x + n.balanceCents, 0);
  const revenueTotal = lines.reduce((x, l) => {
    const t = aMap.get(l.accountId)?.type;
    return t === "revenue" ? x + l.creditCents - l.debitCents : x;
  }, 0);
  const expenseTotal = lines.reduce((x, l) => {
    const t = aMap.get(l.accountId)?.type;
    return t === "expense" ? x + l.debitCents - l.creditCents : x;
  }, 0);
  const undesignatedSurplus = revenueTotal - expenseTotal;
  return {
    asOf: d,
    assets, liabilities, netAssets,
    undesignatedSurplusCents: undesignatedSurplus,
    totalAssetsCents: totalAssets,
    totalLiabilitiesCents: totalLiabilities,
    totalNetAssetsCents: naAccountsTotal + undesignatedSurplus,
    checkCents: totalAssets - totalLiabilities - naAccountsTotal - undesignatedSurplus,
  };
}

/** Functional expenses (Form 990 style) — program/admin/fundraising split. */
export async function reportFunctionalExpenses(user: SessionUser, from?: string, to?: string) {
  const activities = await reportActivities(user, from, to);
  return { range: activities.range, byFunctional: activities.byFunctional, totalCents: activities.totalExpenseCents };
}

/** Fund balances over time — net per fund (revenue − expenses charged to it). */
export async function reportFundBalances(user: SessionUser, asOf?: string) {
  assertAccountingView(user);
  const d = asOf ? new Date(asOf) : new Date();
  const to = new Date(d.getTime() + 24 * 3600 * 1000);
  const [funds, accounts, allLines] = await Promise.all([
    db.fund.findMany({ where: { orgId: user.orgId }, orderBy: { name: "asc" } }),
    db.account.findMany({ where: { orgId: user.orgId } }),
    journalTotals(user.orgId, new Date(0), to),
  ]);
  const typeOf = new Map(accounts.map((a) => [a.id, a.type] as const));
  // only revenue credits and expense debits move a fund balance — the cash
  // side of a gift entry is a movement between accounts, not fund activity
  const lines = allLines.filter((l) => {
    const t = typeOf.get(l.accountId);
    return (t === "revenue" && l.creditCents > 0) || (t === "expense" && l.debitCents > 0);
  });
  const fMap = new Map(funds.map((f) => [f.id, f] as const));
  const balances = new Map<string, { fundId: string; name: string; type: string; revenueCents: number; expenseCents: number }>();
  for (const l of lines) {
    const key = l.fundId ?? "unassigned";
    const fund = l.fundId ? fMap.get(l.fundId) : null;
    const agg = balances.get(key) ?? { fundId: key, name: fund?.name ?? "Unassigned", type: fund?.type ?? "general", revenueCents: 0, expenseCents: 0 };
    agg.revenueCents += l.creditCents;
    agg.expenseCents += l.debitCents;
    balances.set(key, agg);
  }
  return {
    asOf: d,
    items: [...balances.values()].map((b) => ({ ...b, balanceCents: b.revenueCents - b.expenseCents })),
  };
}

/** Giving breakdown — from the donations ledger (authoritative for giving). */
export async function reportGivingBreakdown(user: SessionUser, from?: string, to?: string) {
  assertAccountingView(user);
  const year = new Date().getUTCFullYear();
  const f = from ? new Date(from) : new Date(Date.UTC(year, 0, 1));
  const t = to ? new Date(to) : new Date(Date.UTC(year + 1, 0, 1));
  const donations = await db.donation.findMany({
    where: { orgId: user.orgId, status: "posted", receivedOn: { gte: f, lt: t } },
    include: { splits: true },
  });
  const reversalIds = new Set(
    (await db.donation.findMany({ where: { orgId: user.orgId, reversalOfId: { in: donations.map((d) => d.id) } }, select: { reversalOfId: true } })).map((r) => r.reversalOfId),
  );
  const eligible = donations.filter((d) => !reversalIds.has(d.id));
  const funds = await db.fund.findMany({ where: { orgId: user.orgId } });
  const fMap = new Map(funds.map((x) => [x.id, x] as const));
  const byType = new Map<string, { type: string; amountCents: number; count: number }>();
  for (const d of eligible) {
    for (const s of d.splits) {
      const type = fMap.get(s.fundId)?.type ?? "general";
      const agg = byType.get(type) ?? { type, amountCents: 0, count: 0 };
      agg.amountCents += s.amountCents;
      agg.count += 1;
      byType.set(type, agg);
    }
  }
  return {
    range: { from: f, to: t },
    items: [...byType.values()],
    totalCents: eligible.reduce((a, d) => a + d.amountCents, 0),
    giftCount: eligible.length,
  };
}

// ── manual journal entries + reversals + account ledger (enterprise) ────────

/** Create a balanced manual journal entry (multi-line Debit/Credit builder). */
export async function createManualJournal(
  user: SessionUser,
  input: { entryDate?: string; memo?: string; lines: { accountId?: string; accountCode?: string; fundId?: string | null; debitCents?: number; creditCents?: number }[] },
  meta: { ip?: string; userAgent?: string },
) {
  assertAccountingManage(user);
  if (!Array.isArray(input?.lines) || input.lines.length < 2) throw badRequest("A manual journal entry needs at least two lines.");
  const entry = await createJournalEntry(user, {
    entryDate: input.entryDate,
    memo: input.memo,
    sourceType: "manual_journal",
    lines: input.lines.map((l) => ({ accountId: l.accountId, accountCode: l.accountCode, fundId: l.fundId ?? null, debitCents: l.debitCents, creditCents: l.creditCents })),
  });
  await audit({ orgId: user.orgId, actor: user, action: "journal.manual", entityType: "journal_entry", entityId: entry.id, after: { memo: input.memo, lines: input.lines.length }, ip: meta.ip, userAgent: meta.userAgent });
  return { id: entry.id };
}

/** Reverse any journal entry (append-only reversing entry; original untouched). */
export async function reverseJournalEntry(
  user: SessionUser,
  entryId: string,
  reason: string,
  meta: { ip?: string; userAgent?: string },
) {
  assertAccountingManage(user);
  if (!reason?.trim()) throw badRequest("A reason is required to reverse a journal entry.");
  const original = await db.journalEntry.findFirst({ where: { id: entryId, orgId: user.orgId }, include: { lines: true } });
  if (!original) throw notFound("Journal entry not found.");
  if (original.reversedByEntryId) throw conflict("This entry has already been reversed.");
  if (original.sourceType === "reversal") throw badRequest("A reversing entry cannot itself be reversed — post a new correcting entry.");

  const reversing = await db.$transaction(async (tx) => {
    // swap debit/credit on every line; preserve fund attribution
    const rev = await tx.journalEntry.create({
      data: {
        orgId: user.orgId,
        entryDate: new Date(),
        memo: `Reversal of ${original.memo ?? original.id} — ${reason.trim()}`,
        sourceType: "reversal",
        sourceId: original.id,
        createdByName: user.name,
        lines: {
          create: original.lines.map((l) => ({
            orgId: user.orgId, accountId: l.accountId, fundId: l.fundId,
            debitCents: l.creditCents, creditCents: l.debitCents, // swapped
          })),
        },
      },
      include: { lines: true },
    });
    await tx.journalEntry.update({ where: { id: original.id }, data: { reversedByEntryId: rev.id } });
    return rev;
  });
  await audit({ orgId: user.orgId, actor: user, action: "journal.reverse", entityType: "journal_entry", entityId: reversing.id, before: { reversedEntryId: original.id }, after: { reason: reason.trim() }, ip: meta.ip, userAgent: meta.userAgent });
  return { id: reversing.id, reversedEntryId: original.id };
}

/** Account ledger drawer — every journal line + running balance for an account. */
export async function getAccountLedger(user: SessionUser, accountId: string, q: { from?: string; to?: string } = {}) {
  assertAccountingView(user);
  const account = await db.account.findFirst({ where: { id: accountId, orgId: user.orgId } });
  if (!account) throw notFound("Account not found.");
  const from = q.from ? new Date(q.from) : new Date(0);
  const to = q.to ? new Date(new Date(q.to).getTime() + 86400000) : new Date(Date.UTC(9999, 0, 1));
  const lines = await db.journalLine.findMany({
    where: { orgId: user.orgId, accountId, journalEntry: { entryDate: { gte: from, lt: to }, reversedByEntryId: null } },
    include: { journalEntry: { select: { id: true, entryDate: true, memo: true, sourceType: true, sourceId: true } } },
    orderBy: { journalEntry: { entryDate: "asc" } },
    take: 5000,
  });
  // running balance on the account's natural side
  const debitNormal = account.type === "asset" || account.type === "expense";
  let running = 0;
  const rows = lines.map((l) => {
    running += debitNormal ? l.debitCents - l.creditCents : l.creditCents - l.debitCents;
    return {
      id: l.id, entryId: l.journalEntryId, entryDate: l.journalEntry.entryDate, memo: l.journalEntry.memo,
      sourceType: l.journalEntry.sourceType, sourceId: l.journalEntry.sourceId,
      debitCents: l.debitCents, creditCents: l.creditCents, fundId: l.fundId, balanceCents: running,
    };
  });
  return { account: { id: account.id, code: account.code, name: account.name, type: account.type }, lines: rows, endingBalanceCents: running };
}

// ── bank reconciliation upgrades (auto-match + quick book charge) ────────────

/** Auto-match unreconciled bank lines to book entries with identical amount within ±5 days. */
export async function autoMatchBankTransactions(user: SessionUser, bankAccountId: string, meta: { ip?: string; userAgent?: string }) {
  assertAccountingManage(user);
  const bank = await db.bankAccount.findFirst({ where: { id: bankAccountId, orgId: user.orgId } });
  if (!bank) throw notFound("Bank account not found.");
  if (!bank.glAccountId) throw badRequest("This bank account is not linked to a GL account — link it first.");
  const unreconciled = await db.bankTransaction.findMany({ where: { orgId: user.orgId, bankAccountId, reconciled: false }, take: 500 });
  if (!unreconciled.length) return { matched: 0, considered: 0 };
  const glLines = await db.journalLine.findMany({
    where: { orgId: user.orgId, accountId: bank.glAccountId, journalEntry: { reversedByEntryId: null } },
    include: { journalEntry: { select: { id: true, entryDate: true, memo: true } } },
    take: 5000,
  });
  // bucket unreconciled book entries by amount for O(1) lookup
  const byAmount = new Map<number, { entryId: string; entryDate: Date }[]>();
  for (const l of glLines) {
    const amt = l.debitCents - l.creditCents; // cash inflow positive, outflow negative
    if (amt === 0) continue;
    const arr = byAmount.get(amt) ?? [];
    arr.push({ entryId: l.journalEntryId, entryDate: l.journalEntry.entryDate });
    byAmount.set(amt, arr);
  }
  const matchedIds = new Set<string>();
  let matched = 0;
  for (const t of unreconciled) {
    if (matchedIds.has(t.id)) continue;
    const candidates = byAmount.get(t.amountCents) ?? [];
    const hit = candidates.find((c) => Math.abs(c.entryDate.getTime() - t.postedDate.getTime()) <= 5 * 86400000);
    if (!hit) continue;
    await db.bankTransaction.update({ where: { id: t.id }, data: { matchedJournalEntryId: hit.entryId, reconciled: true } });
    matchedIds.add(t.id);
    matched += 1;
  }
  await audit({ orgId: user.orgId, actor: user, action: "bank.automatch", entityType: "bank_account", entityId: bankAccountId, after: { matched, considered: unreconciled.length }, ip: meta.ip, userAgent: meta.userAgent });
  return { matched, considered: unreconciled.length };
}

/** Quick-book a bank charge or interest on an unmatched bank line in one click. */
export async function quickBookBankCharge(
  user: SessionUser,
  transactionId: string,
  input: { expenseAccountId?: string; revenueAccountId?: string; memo?: string; kind?: "charge" | "interest" },
  meta: { ip?: string; userAgent?: string },
) {
  assertAccountingManage(user);
  const txn = await db.bankTransaction.findFirst({ where: { id: transactionId, orgId: user.orgId }, include: { bankAccount: true } });
  if (!txn) throw notFound("Bank transaction not found.");
  if (txn.reconciled) throw conflict("This bank transaction is already reconciled.");
  if (!txn.bankAccount?.glAccountId) throw badRequest("This bank account is not linked to a GL account.");
  const bank = txn.bankAccount;
  const kind = input.kind ?? (txn.amountCents < 0 ? "charge" : "interest");
  const isCharge = kind === "charge";
  const absAmt = Math.abs(txn.amountCents);
  // charge: Dr expense / Cr bank. interest: Dr bank / Cr revenue.
  const otherAcctId = isCharge
    ? input.expenseAccountId ?? (await db.account.findFirst({ where: { orgId: user.orgId, code: "6300" } }))?.id
    : input.revenueAccountId ?? (await db.account.findFirst({ where: { orgId: user.orgId, code: "4500" } }))?.id;
  if (!otherAcctId) throw badRequest(`No ${isCharge ? "bank-charge expense" : "interest revenue"} account found — create one (6300 / 4500).`);
  const entry = await createJournalEntry(user, {
    entryDate: txn.postedDate,
    memo: input.memo?.trim() || (isCharge ? "Bank charge" : "Bank interest"),
    sourceType: "bank_charge",
    sourceId: txn.id,
    lines: isCharge
      ? [{ accountId: otherAcctId, debitCents: absAmt }, { accountId: bank.glAccountId, debitCents: 0, creditCents: absAmt }]
      : [{ accountId: bank.glAccountId, debitCents: absAmt }, { accountId: otherAcctId, creditCents: absAmt }],
  });
  await db.bankTransaction.update({ where: { id: txn.id }, data: { matchedJournalEntryId: entry.id, reconciled: true } });
  await audit({ orgId: user.orgId, actor: user, action: "bank.quickbook", entityType: "bank_transaction", entityId: txn.id, after: { kind, amountCents: absAmt, journalEntryId: entry.id }, ip: meta.ip, userAgent: meta.userAgent });
  return { journalEntryId: entry.id };
}

// ── new reports: receipts & payments, remittances, trial balance ────────────

/** Receipts & Payments Account — cash-basis summary (the #1 Nigerian AGM report). */
export async function reportReceiptsPayments(user: SessionUser, from?: string, to?: string) {
  assertAccountingView(user);
  await ensureChartOfAccounts(user.orgId);
  const year = new Date().getUTCFullYear();
  const f = from ? new Date(from) : new Date(Date.UTC(year, 0, 1));
  const t = to ? new Date(new Date(to).getTime() + 86400000) : new Date(Date.UTC(year + 1, 0, 1));
  const [accounts, bankAccts, lines] = await Promise.all([
    db.account.findMany({ where: { orgId: user.orgId } }),
    db.bankAccount.findMany({ where: { orgId: user.orgId, isActive: true } }),
    journalTotals(user.orgId, f, t),
  ]);
  const aMap = new Map(accounts.map((a) => [a.id, a] as const));
  // opening = sum of all cash/bank asset balances before `from`
  const openingLines = await journalTotals(user.orgId, new Date(0), f);
  const cashAssetIds = new Set(accounts.filter((a) => a.type === "asset" && /^(1000|1010|1020|1025|1100)/.test(a.code)).map((a) => a.id));
  const glIds = new Set(bankAccts.map((b) => b.glAccountId).filter(Boolean) as string[]);
  for (const id of glIds) cashAssetIds.add(id);
  const openingCents = openingLines.filter((l) => cashAssetIds.has(l.accountId)).reduce((a, l) => a + (l.debitCents - l.creditCents), 0);
  // receipts = credits to cash/bank (money in); payments = debits to cash/bank (money out)
  const receiptsByCat = new Map<string, number>();
  const paymentsByCat = new Map<string, number>();
  for (const l of lines) {
    if (!cashAssetIds.has(l.accountId)) continue;
    const cashIn = l.debitCents, cashOut = l.creditCents;
    if (cashIn > 0) {
      // find the offsetting credit account in the same entry to categorise
      const offset = lines.find((o) => o.accountId !== l.accountId && o.creditCents > 0 && o.journalEntryId === l.journalEntryId);
      const cat = offset ? aMap.get(offset.accountId)?.name ?? "Other Receipts" : "Other Receipts";
      receiptsByCat.set(cat, (receiptsByCat.get(cat) ?? 0) + cashIn);
    }
    if (cashOut > 0) {
      const offset = lines.find((o) => o.accountId !== l.accountId && o.debitCents > 0 && o.journalEntryId === l.journalEntryId);
      const cat = offset ? aMap.get(offset.accountId)?.name ?? "Other Payments" : "Other Payments";
      paymentsByCat.set(cat, (paymentsByCat.get(cat) ?? 0) + cashOut);
    }
  }
  const totalReceipts = [...receiptsByCat.values()].reduce((a, v) => a + v, 0);
  const totalPayments = [...paymentsByCat.values()].reduce((a, v) => a + v, 0);
  return {
    range: { from: f, to: t },
    openingBalanceCents: openingCents,
    receipts: [...receiptsByCat.entries()].map(([category, amountCents]) => ({ category, amountCents })),
    payments: [...paymentsByCat.entries()].map(([category, amountCents]) => ({ category, amountCents })),
    totalReceiptsCents: totalReceipts,
    totalPaymentsCents: totalPayments,
    closingBalanceCents: openingCents + totalReceipts - totalPayments,
  };
}

/** National / HQ Remittance Report — gross income by fund, % accrued, paid, outstanding. */
export async function reportRemittances(user: SessionUser, from?: string, to?: string) {
  assertAccountingView(user);
  const year = new Date().getUTCFullYear();
  const f = from ? new Date(from) : new Date(Date.UTC(year, 0, 1));
  const t = to ? new Date(to) : new Date(Date.UTC(year + 1, 0, 1));
  const [schedules, funds] = await Promise.all([
    db.remittanceSchedule.findMany({
      where: { orgId: user.orgId, createdAt: { gte: f, lt: t } },
      include: { destination: true },
    }),
    db.fund.findMany({ where: { orgId: user.orgId } }),
  ]);
  const byDest = new Map<string, { destination: any; grossBaseCents: number; accruedCents: number; paidCents: number; outstandingCents: number; rules: any[] }>();
  for (const s of schedules) {
    const key = s.destinationId;
    const agg = byDest.get(key) ?? { destination: s.destination, grossBaseCents: 0, accruedCents: 0, paidCents: 0, outstandingCents: 0, rules: [] };
    agg.grossBaseCents += s.grossBaseCents;
    agg.accruedCents += s.calculatedDueCents;
    agg.paidCents += s.paidCents;
    agg.outstandingCents += s.balanceCents;
    byDest.set(key, agg);
  }
  return {
    range: { from: f, to: t },
    destinations: [...byDest.values()].map((d) => ({
      id: d.destination?.id, name: d.destination?.name, tier: d.destination?.tier,
      grossBaseCents: d.grossBaseCents, accruedCents: d.accruedCents,
      paidCents: d.paidCents, outstandingCents: d.outstandingCents,
    })),
    totalAccruedCents: [...byDest.values()].reduce((a, d) => a + d.accruedCents, 0),
    totalPaidCents: [...byDest.values()].reduce((a, d) => a + d.paidCents, 0),
    totalOutstandingCents: [...byDest.values()].reduce((a, d) => a + d.outstandingCents, 0),
    fundCount: funds.length,
  };
}

/** Trial Balance — all active GL accounts with Debit and Credit balances as of a date. */
export async function reportTrialBalance(user: SessionUser, asOf?: string) {
  assertAccountingView(user);
  await ensureChartOfAccounts(user.orgId);
  const d = asOf ? new Date(asOf) : new Date();
  const to = new Date(d.getTime() + 86400000);
  const [accounts, lines] = await Promise.all([
    db.account.findMany({ where: { orgId: user.orgId, isActive: true }, orderBy: { code: "asc" } }),
    journalTotals(user.orgId, new Date(0), to),
  ]);
  const items = accounts.map((a) => {
    const debits = lines.filter((l) => l.accountId === a.id).reduce((x, l) => x + l.debitCents, 0);
    const credits = lines.filter((l) => l.accountId === a.id).reduce((x, l) => x + l.creditCents, 0);
    const net = debits - credits;
    // Standard practice: an account's balance appears on the side it falls —
    // a debit-normal account overdrawn (net < 0, e.g. bank overdraft) shows
    // on the CREDIT side, and vice versa. Σ debits = Σ credits always holds.
    return {
      code: a.code, name: a.name, type: a.type,
      debitCents: net > 0 ? net : 0,
      creditCents: net < 0 ? -net : 0,
    };
  }).filter((i) => i.debitCents > 0 || i.creditCents > 0);
  const totalDebits = items.reduce((a, i) => a + i.debitCents, 0);
  const totalCredits = items.reduce((a, i) => a + i.creditCents, 0);
  return {
    asOf: d,
    items,
    totalDebitsCents: totalDebits,
    totalCreditsCents: totalCredits,
    checkCents: totalDebits - totalCredits,
  };
}

// ── modern reports: cash flow + income trend ─────────────────────────────────

/** Cash & bank asset accounts for this org (10xx/11xx codes + bank-linked GL). */
async function cashAccountIds(orgId: string): Promise<string[]> {
  const accounts = await db.account.findMany({
    where: { orgId, type: "asset", OR: [{ code: { startsWith: "10" } }, { code: { startsWith: "11" } }] },
    select: { id: true },
  });
  const bankLinked = await db.bankAccount.findMany({ where: { orgId, glAccountId: { not: null } }, select: { glAccountId: true } });
  const ids = new Set(accounts.map((a) => a.id));
  for (const b of bankLinked) if (b.glAccountId) ids.add(b.glAccountId);
  return [...ids];
}

function monthKeyOf(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Cash Flow Statement (cash basis on the cash/bank GL group):
 * opening balance → monthly inflows/outflows classified by offsetting
 * account type → closing balance. Reads journal_lines as source of truth.
 */
export async function reportCashFlow(user: SessionUser, from?: string, to?: string) {
  assertAccountingView(user);
  await ensureChartOfAccounts(user.orgId);
  const toDate = to ? new Date(`${to}T23:59:59`) : new Date();
  const fromDate = from ? new Date(`${from}T00:00:00`) : new Date(toDate.getFullYear(), 0, 1);
  const cashIds = await cashAccountIds(user.orgId);
  if (!cashIds.length) {
    return { fromDate, toDate, openingCents: 0, months: [], categories: [], closingCents: 0, checkCents: 0 };
  }

  // Opening: all movement on cash accounts before the window.
  const openingLines = await db.journalLine.findMany({
    where: { orgId: user.orgId, accountId: { in: cashIds }, journalEntry: { reversedByEntryId: null, entryDate: { lt: fromDate } } },
    select: { debitCents: true, creditCents: true },
  });
  const openingCents = openingLines.reduce((a, l) => a + l.debitCents - l.creditCents, 0);

  // Period: entries touching cash in the window, with all their lines.
  const entries = await db.journalEntry.findMany({
    where: {
      orgId: user.orgId, reversedByEntryId: null,
      entryDate: { gte: fromDate, lte: toDate },
      lines: { some: { accountId: { in: cashIds } } },
    },
    include: { lines: true },
    orderBy: { entryDate: "asc" },
  });
  const accounts = await db.account.findMany({ where: { orgId: user.orgId }, select: { id: true, type: true, name: true } });
  const typeById = new Map(accounts.map((a) => [a.id, a.type] as const));

  const monthsMap = new Map<string, { month: string; inflowsCents: number; outflowsCents: number; netCents: number }>();
  const catMap = new Map<string, { label: string; inflowsCents: number; outflowsCents: number }>();
  const CAT_LABEL: Record<string, string> = {
    revenue: "Giving & other income",
    expense: "Ministry & operations payments",
    liability: "Payables, remittances & loans",
    net_asset: "Transfers & fund movements",
    asset: "Transfers between cash accounts",
  };
  for (const e of entries) {
    const mk = monthKeyOf(e.entryDate);
    const m = monthsMap.get(mk) ?? { month: mk, inflowsCents: 0, outflowsCents: 0, netCents: 0 };
    const cashLines = e.lines.filter((l) => cashIds.includes(l.accountId));
    for (const cl of cashLines) {
      const inflow = cl.debitCents - cl.creditCents;
      m.inflowsCents += Math.max(0, inflow);
      m.outflowsCents += Math.max(0, -inflow);
      // classify by the dominant offsetting line of this entry
      const others = e.lines.filter((l) => !cashIds.includes(l.accountId));
      let kind = "asset";
      if (others.length) {
        const totals = new Map<string, number>();
        for (const o of others) {
          const t = typeById.get(o.accountId) ?? "asset";
          totals.set(t, (totals.get(t) ?? 0) + o.debitCents + o.creditCents);
        }
        kind = [...totals.entries()].sort((a, b) => b[1] - a[1])[0][0];
      }
      const label = CAT_LABEL[kind] ?? CAT_LABEL.asset;
      const c = catMap.get(label) ?? { label, inflowsCents: 0, outflowsCents: 0 };
      if (inflow >= 0) c.inflowsCents += Math.max(0, inflow);
      else c.outflowsCents += Math.max(0, -inflow);
      catMap.set(label, c);
    }
    m.netCents = m.inflowsCents - m.outflowsCents;
    monthsMap.set(mk, m);
  }
  const months = [...monthsMap.values()].sort((a, b) => a.month.localeCompare(b.month));
  const netChange = months.reduce((a, m) => a + m.netCents, 0);
  const closingCents = openingCents + netChange;
  return {
    fromDate, toDate, openingCents,
    months,
    categories: [...catMap.values()].sort((a, b) => b.inflowsCents + b.outflowsCents - (a.inflowsCents + a.outflowsCents)),
    closingCents,
    checkCents: openingCents + netChange - closingCents,
  };
}

/**
 * Income Statement Trend — monthly revenue / expense / net from the GL
 * (excludes reversed entries), plus top contributing accounts overall.
 */
export async function reportIncomeTrend(user: SessionUser, from?: string, to?: string) {
  assertAccountingView(user);
  await ensureChartOfAccounts(user.orgId);
  const toDate = to ? new Date(`${to}T23:59:59`) : new Date();
  const fromDate = from ? new Date(`${from}T00:00:00`) : new Date(toDate.getFullYear(), 0, 1);
  const accounts = await db.account.findMany({ where: { orgId: user.orgId }, select: { id: true, code: true, name: true, type: true } });
  const acctById = new Map(accounts.map((a) => [a.id, a] as const));
  const lines = await db.journalLine.findMany({
    where: {
      orgId: user.orgId,
      journalEntry: { reversedByEntryId: null, entryDate: { gte: fromDate, lte: toDate } },
    },
    select: { accountId: true, debitCents: true, creditCents: true, journalEntry: { select: { entryDate: true } } },
  });
  const monthsMap = new Map<string, { month: string; revenueCents: number; expenseCents: number; netCents: number }>();
  const revenueByAcct = new Map<string, number>();
  const expenseByAcct = new Map<string, number>();
  for (const l of lines) {
    const a = acctById.get(l.accountId);
    if (!a || (a.type !== "revenue" && a.type !== "expense")) continue;
    const mk = monthKeyOf(l.journalEntry.entryDate);
    const m = monthsMap.get(mk) ?? { month: mk, revenueCents: 0, expenseCents: 0, netCents: 0 };
    if (a.type === "revenue") {
      const amt = l.creditCents - l.debitCents;
      m.revenueCents += amt;
      revenueByAcct.set(a.id, (revenueByAcct.get(a.id) ?? 0) + amt);
    } else {
      const amt = l.debitCents - l.creditCents;
      m.expenseCents += amt;
      expenseByAcct.set(a.id, (expenseByAcct.get(a.id) ?? 0) + amt);
    }
    m.netCents = m.revenueCents - m.expenseCents;
    monthsMap.set(mk, m);
  }
  const nameOf = (id: string) => {
    const a = acctById.get(id);
    return a ? `${a.code} · ${a.name}` : id;
  };
  const topRevenue = [...revenueByAcct.entries()].sort((x, y) => y[1] - x[1]).slice(0, 8)
    .map(([id, cents]) => ({ account: nameOf(id), cents }));
  const topExpense = [...expenseByAcct.entries()].sort((x, y) => y[1] - x[1]).slice(0, 8)
    .map(([id, cents]) => ({ account: nameOf(id), cents }));
  const months = [...monthsMap.values()].sort((a, b) => a.month.localeCompare(b.month));
  const totalRevenue = months.reduce((s, m) => s + m.revenueCents, 0);
  const totalExpense = months.reduce((s, m) => s + m.expenseCents, 0);
  return { fromDate, toDate, months, topRevenue, topExpense, totalRevenueCents: totalRevenue, totalExpenseCents: totalExpense, netCents: totalRevenue - totalExpense };
}
