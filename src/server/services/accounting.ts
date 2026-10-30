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
];

/** Revenue account code for a fund (by its glAccountCode or fund type). */
const FUND_TYPE_REVENUE: Record<string, string> = {
  tithe: "4000", general: "4100", designated: "4200",
  restricted: "4200", building: "4300", missions: "4400",
};

async function ensureChartOfAccounts(orgId: string) {
  const existing = await db.account.findFirst({ where: { orgId }, select: { id: true } });
  if (existing) return;
  await db.account.createMany({
    data: DEFAULT_CHART.map((a) => ({ orgId, code: a.code, name: a.name, type: a.type, fundRestriction: a.fundRestriction ?? "unrestricted", functionalClass: a.functionalClass ?? null })),
  }).catch(() => {}); // concurrent seed — harmless
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

// ── journal core ─────────────────────────────────────────────────────────────

interface JournalLineInput { accountCode?: string; accountId?: string; fundId?: string | null; debitCents?: number; creditCents?: number }

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
    const acct = l.accountId ?? (l.accountCode ? byCode.get(l.accountCode) : undefined);
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
  if (debits !== credits) throw badRequest(`Unbalanced entry: debits ${debits}¢ ≠ credits ${credits}¢.`);

  const entry = await db.journalEntry.create({
    data: {
      orgId,
      entryDate: input.entryDate ? new Date(input.entryDate) : new Date(),
      memo: input.memo ?? null,
      sourceType: input.sourceType ?? "manual",
      sourceId: input.sourceId ?? null,
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
  if (existing) return existing; // idempotent

  const byCode = await accountsByCode(user.orgId);
  const funds = await db.fund.findMany({ where: { orgId: user.orgId, id: { in: donation.splits.map((s) => s.fundId) } } });
  const fundMap = new Map(funds.map((f) => [f.id, f] as const));
  const cash = byCode.get("1000");
  if (!cash) throw badRequest("Chart of accounts is missing the 1000 Operating Cash account.");

  const lineAgg = new Map<string, { accountCode: string; fundId: string | null; creditCents: number }>();
  for (const s of donation.splits) {
    const fund = fundMap.get(s.fundId);
    const code = fund?.glAccountCode ?? FUND_TYPE_REVENUE[fund?.type ?? "general"] ?? "4100";
    const key = `${code}:${s.fundId}`;
    const agg = lineAgg.get(key) ?? { accountCode: code, fundId: s.fundId, creditCents: 0 };
    agg.creditCents += s.amountCents;
    lineAgg.set(key, agg);
  }
  return createJournalEntry(user, {
    entryDate: donation.receivedOn,
    memo: `Gift from ${donation.personId ?? "donor"} — ${donation.method}`,
    sourceType: "donation",
    sourceId: donation.id,
    lines: [
      { accountCode: "1000", debitCents: donation.amountCents },
      ...[...lineAgg.values()].map((l) => ({ accountCode: l.accountCode, fundId: l.fundId, creditCents: l.creditCents })),
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
      reversedByEntryId: e.reversedByEntryId,
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
  if (amount > balance) throw badRequest(`Payment ${amount}¢ exceeds the remaining balance ${balance}¢.`);

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
 * Import a bank statement CSV: date,description,amount rows (header optional).
 * Dedupe on (account, date, description, amount) — re-imports are idempotent.
 */
export async function importBankStatement(
  user: SessionUser,
  bankAccountId: string,
  csv: string,
  meta: { ip?: string; userAgent?: string },
) {
  assertAccountingManage(user);
  const bank = await db.bankAccount.findFirst({ where: { id: bankAccountId, orgId: user.orgId } });
  if (!bank) throw notFound("Bank account not found.");
  const rows: { postedDate: Date; description: string | null; amountCents: number }[] = [];
  const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    const parts = line.split(",").map((p) => p.trim().replace(/^"|"$/g, ""));
    if (parts.length < 3) continue;
    const datePart = parts[0];
    const amountPart = parts[parts.length - 1].replace(/[$,\s]/g, "");
    const date = new Date(datePart);
    const amount = Math.round(Number(amountPart) * 100);
    if (isNaN(date.getTime()) || !Number.isFinite(amount)) continue;
    if (/date/i.test(datePart) && isNaN(Number(amountPart[0]))) continue; // header row
    rows.push({ postedDate: date, description: parts.slice(1, parts.length - 1).join(", ") || null, amountCents: amount });
  }
  if (!rows.length) throw badRequest("No valid rows found. Expected CSV: date,description,amount");
  // SQLite has no skipDuplicates — dedupe on the natural key ourselves
  const existing = await db.bankTransaction.findMany({
    where: { orgId: user.orgId, bankAccountId },
    select: { postedDate: true, description: true, amountCents: true },
  });
  const seen = new Set(existing.map((t) => `${t.postedDate.toISOString()}|${t.description ?? ""}|${t.amountCents}`));
  const fresh = rows.filter((r) => !seen.has(`${r.postedDate.toISOString()}|${r.description ?? ""}|${r.amountCents}`));
  if (!fresh.length) return { imported: 0, parsed: rows.length };
  const created = await db.bankTransaction.createMany({
    data: fresh.map((r) => ({ orgId: user.orgId, bankAccountId, postedDate: r.postedDate, description: r.description, amountCents: r.amountCents })),
  });
  await audit({ orgId: user.orgId, actor: user, action: "bank.import", entityType: "bank_account", entityId: bankAccountId, after: { rows: rows.length, imported: created.count }, ip: meta.ip, userAgent: meta.userAgent });
  return { imported: created.count, parsed: rows.length };
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

export async function getBudgets(user: SessionUser, fiscalYear?: number) {
  assertAccountingView(user);
  const year = fiscalYear ?? new Date().getFullYear();
  const [budgets, accounts] = await Promise.all([
    db.budget.findMany({ where: { orgId: user.orgId, fiscalYear: year } }),
    db.account.findMany({ where: { orgId: user.orgId, type: "expense", isActive: true }, orderBy: { code: "asc" } }),
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
  for (const e of entries) {
    const month = e.entryDate.getUTCMonth();
    for (const l of e.lines) {
      // only expense-account lines move budget actuals — a gift entry also
      // touches cash/revenue lines which must not count as spend
      if (!(accounts.some((a) => a.id === l.accountId))) continue;
      const bucket = (actual[l.accountId] ??= [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
      bucket[month] += l.debitCents - l.creditCents;
    }
  }
  return {
    fiscalYear: year,
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
  return entries.flatMap((e) => e.lines);
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
