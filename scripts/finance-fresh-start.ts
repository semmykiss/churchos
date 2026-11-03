/**
 * Finance fresh-start + chart alignment (idempotent, tenant-scoped).
 *  1. Ensures the org chart contains every DEFAULT_CHART account (incl. new
 *     payroll accounts 2165/5410/5420/5430) — additive, never renames/removes.
 *  2. Pins giving funds to their revenue GL accounts (Tithe→4000, Offering→4100…).
 *  3. Wipes ALL finance transactions for the org (fresh books) — child-first.
 * Usage: bun scripts/finance-fresh-start.ts
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const ORG = "cmvu5zyeo0000rcc602zcnf83"; // Grace Chapel demo only

const CHART: { code: string; name: string; type: string; fundRestriction?: string; functionalClass?: string }[] = [
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
  { code: "1010", name: "Operating Bank Account", type: "asset" },
  { code: "1020", name: "Undeposited Cash / Church Safe", type: "asset" },
  { code: "1025", name: "Petty Cash Float", type: "asset" },
  { code: "2150", name: "National/HQ Remittance Payable", type: "liability" },
  { code: "2160", name: "WHT / PAYE Payable", type: "liability" },
  { code: "2165", name: "Pension Payable", type: "liability" },
  { code: "4010", name: "Tithes Revenue", type: "revenue" },
  { code: "4020", name: "Sunday Love Offerings", type: "revenue" },
  { code: "4030", name: "Thanksgiving Offerings", type: "revenue" },
  { code: "4040", name: "Seed Faith / First Fruit", type: "revenue" },
  { code: "4050", name: "Children's Ministry Giving", type: "revenue" },
  { code: "4060", name: "Building / Project Fund Income", type: "revenue" },
  { code: "4070", name: "Welfare / Benevolence Income", type: "revenue" },
  { code: "4080", name: "Missions Income", type: "revenue" },
  { code: "4500", name: "Other Church Receipts", type: "revenue" },
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
];

/** Fund name → revenue GL code mapping (explicit, best practice). */
const FUND_GL: Record<string, string> = {
  "Tithe": "4000",
  "Offering": "4100",
  "General Fund": "4100",
  "Building Fund": "4300",
  "Missions": "4400",
};

async function main() {
  const existing = await db.account.findMany({ where: { orgId: ORG }, select: { id: true, code: true } });
  const byCode = new Map(existing.map((a) => [a.code, a.id] as const));

  // 1. Additive chart seed
  const missing = CHART.filter((a) => !byCode.has(a.code));
  for (const a of missing) {
    const created = await db.account.create({
      data: { orgId: ORG, code: a.code, name: a.name, type: a.type, fundRestriction: a.fundRestriction ?? "unrestricted", functionalClass: a.functionalClass ?? null },
    });
    byCode.set(created.code, created.id);
    console.log(`+ account ${created.code} ${created.name}`);
  }
  console.log(`chart: ${existing.length} existing, ${missing.length} added`);

  // 2. Pin fund → revenue GL mappings
  const funds = await db.fund.findMany({ where: { orgId: ORG } });
  for (const f of funds) {
    const code = FUND_GL[f.name];
    const accountId = code ? byCode.get(code) : undefined;
    if (accountId && f.revenueAccountId !== accountId) {
      await db.fund.update({ where: { id: f.id }, data: { revenueAccountId: accountId } });
      console.log(`~ fund "${f.name}" → GL ${code}`);
    }
  }

  // 3. Wipe all finance transactions (child-first, tenant-scoped)
  const del = async (label: string, fn: () => Promise<unknown>) => {
    const r = await fn();
    const n = typeof r === "object" && r && "count" in (r as Record<string, unknown>) ? Number((r as { count: number }).count) : 0;
    if (n) console.log(`- ${label}: ${n}`);
    return n;
  };
  await del("bankTransactions", () => db.bankTransaction.deleteMany({ where: { orgId: ORG } }));
  await del("billPayments", () => db.billPayment.deleteMany({ where: { orgId: ORG } }));
  await del("billLines", () => db.billLine.deleteMany({ where: { orgId: ORG } }));
  await del("bills", () => db.bill.deleteMany({ where: { orgId: ORG } }));
  await del("paymentVouchers", () => db.paymentVoucher.deleteMany({ where: { orgId: ORG } }));
  await del("payrollLines", () => db.payrollLine.deleteMany({ where: { orgId: ORG } }));
  await del("payrollRuns", () => db.payrollRun.deleteMany({ where: { orgId: ORG } }));
  await del("stipendLines", () => db.stipendLine.deleteMany({ where: { orgId: ORG } }));
  await del("stipendBatches", () => db.stipendBatch.deleteMany({ where: { orgId: ORG } }));
  await del("remittanceSchedules", () => db.remittanceSchedule.deleteMany({ where: { orgId: ORG } }));
  await del("pettyCashDisbursements", () => db.pettyCashDisbursement.deleteMany({ where: { orgId: ORG } }));
  await del("pettyCashReplenishes", () => db.pettyCashReplenish.deleteMany({ where: { orgId: ORG } }));
  await del("otherReceipts", () => db.otherReceipt.deleteMany({ where: { orgId: ORG } }));
  await del("cashDeposits", () => db.cashDeposit.deleteMany({ where: { orgId: ORG } }));
  await del("givingStatements", () => db.givingStatement.deleteMany({ where: { orgId: ORG } }));
  await del("donationSplits", () => db.donationSplit.deleteMany({ where: { orgId: ORG } }));
  await del("donations", () => db.donation.deleteMany({ where: { orgId: ORG } }));
  await del("batches", () => db.batch.deleteMany({ where: { orgId: ORG } }));
  await del("onlinePayments", () => db.onlinePayment.deleteMany({ where: { orgId: ORG } }));
  await del("journalLines", () => db.journalLine.deleteMany({ where: { orgId: ORG } }));
  await del("journalEntries", () => db.journalEntry.deleteMany({ where: { orgId: ORG } }));
  await del("notifications(giving/accounting)", () => db.notification.deleteMany({ where: { orgId: ORG, module: { in: ["giving", "accounting"] } } }));
  console.log("fresh start complete — books are clean, chart & fund mappings aligned.");
}

main().finally(() => db.$disconnect());
