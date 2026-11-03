import { route } from "@/server/api/router";
import * as accounting from "@/server/services/accounting";
import * as vouchers from "@/server/services/payment-vouchers";
import * as remittances from "@/server/services/remittances";
import * as receipts from "@/server/services/church-receipts";
import * as petty from "@/server/services/petty-cash";
import * as payroll from "@/server/services/payroll";
import { badRequest } from "@/server/http";

/**
 * Accounting routes — GETs require accounting.view, writes require
 * accounting.manage (the pastor's read-only oversight lands on the view side).
 */
const meta = (ctx: any) => ({ ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined });

export function registerAccountingRoutes() {
  // ── chart of accounts ───────────────────────────────────────────────────────
  route({
    method: "GET", pattern: "accounts", permission: "accounting.view",
    handler: async (ctx) => accounting.listAccounts(ctx.user!),
  });
  route({
    method: "POST", pattern: "accounts", permission: "accounting.manage",
    handler: async (ctx) => accounting.createAccount(ctx.user!, ctx.body ?? {}, meta(ctx)),
  });
  route({
    method: "PATCH", pattern: "accounts/:id", permission: "accounting.manage",
    handler: async (ctx) => accounting.updateAccount(ctx.user!, ctx.params.id, ctx.body ?? {}, meta(ctx)),
  });
  route({
    method: "DELETE", pattern: "accounts/:id", permission: "accounting.manage",
    handler: async (ctx) => accounting.deleteAccount(ctx.user!, ctx.params.id, meta(ctx)),
  });
  route({
    method: "GET", pattern: "journal-entries", permission: "accounting.view",
    handler: async (ctx) => accounting.listJournalEntries(ctx.user!, { take: Number(ctx.query.get("take") ?? 50) }),
  });
  route({
    method: "POST", pattern: "accounting/backfill-donations", permission: "accounting.manage",
    handler: async (ctx) => accounting.backfillDonationJournal(ctx.user!, meta(ctx)),
  });

  // ── vendors ─────────────────────────────────────────────────────────────────
  route({
    method: "GET", pattern: "vendors", permission: "accounting.view",
    handler: async (ctx) => accounting.listVendors(ctx.user!),
  });
  route({
    method: "POST", pattern: "vendors", permission: "accounting.manage",
    handler: async (ctx) => accounting.createVendor(ctx.user!, ctx.body ?? {}, meta(ctx)),
  });

  // ── bills (accounts payable) ────────────────────────────────────────────────
  route({
    method: "GET", pattern: "bills", permission: "accounting.view",
    handler: async (ctx) => accounting.listBills(ctx.user!),
  });
  route({
    method: "POST", pattern: "bills", permission: "accounting.manage",
    handler: async (ctx) => accounting.createBill(ctx.user!, ctx.body ?? {}, meta(ctx)),
  });
  route({
    method: "POST", pattern: "bills/:id/payments", permission: "accounting.manage",
    handler: async (ctx) => accounting.payBill(ctx.user!, ctx.params.id, ctx.body ?? {}, meta(ctx)),
  });
  route({
    method: "POST", pattern: "bills/:id/void", permission: "accounting.manage",
    handler: async (ctx) => accounting.voidBill(ctx.user!, ctx.params.id, meta(ctx)),
  });

  // ── bank reconciliation ─────────────────────────────────────────────────────
  route({
    method: "GET", pattern: "bank-accounts", permission: "accounting.view",
    handler: async (ctx) => accounting.listBankAccounts(ctx.user!),
  });
  route({
    method: "POST", pattern: "bank-accounts", permission: "accounting.manage",
    handler: async (ctx) => accounting.createBankAccount(ctx.user!, ctx.body ?? {}, meta(ctx)),
  });
  route({
    method: "GET", pattern: "bank-accounts/:id/transactions", permission: "accounting.view",
    handler: async (ctx) => accounting.getBankTransactions(ctx.user!, ctx.params.id),
  });
  route({
    method: "POST", pattern: "bank-accounts/:id/import", permission: "accounting.manage",
    handler: async (ctx) => {
      const content = ctx.body?.content ?? ctx.body?.csv; // content: CSV or OFX/QFX text
      if (!content || typeof content !== "string") throw badRequest("content (CSV or OFX text) is required.");
      return accounting.importBankStatement(ctx.user!, ctx.params.id, content, meta(ctx));
    },
  });
  route({
    method: "POST", pattern: "bank-transactions/:id/match", permission: "accounting.manage",
    handler: async (ctx) => accounting.matchBankTransaction(ctx.user!, ctx.params.id, ctx.body ?? {}, meta(ctx)),
  });

  // ── budgets ─────────────────────────────────────────────────────────────────
  route({
    method: "GET", pattern: "budgets", permission: "accounting.view",
    handler: async (ctx) => accounting.getBudgets(ctx.user!, ctx.query.get("fiscalYear") ? Number(ctx.query.get("fiscalYear")) : undefined, (ctx.query.get("kind") as "expense" | "revenue") || undefined),
  });
  route({
    method: "POST", pattern: "budgets", permission: "accounting.manage",
    handler: async (ctx) => accounting.upsertBudget(ctx.user!, ctx.body ?? {}, meta(ctx)),
  });

  // ── reports ─────────────────────────────────────────────────────────────────
  route({
    method: "GET", pattern: "reports/statement-of-activities", permission: "accounting.view",
    handler: async (ctx) => accounting.reportActivities(ctx.user!, ctx.query.get("from") ?? undefined, ctx.query.get("to") ?? undefined),
  });
  route({
    method: "GET", pattern: "reports/statement-of-financial-position", permission: "accounting.view",
    handler: async (ctx) => accounting.reportPosition(ctx.user!, ctx.query.get("asOf") ?? undefined),
  });
  route({
    method: "GET", pattern: "reports/functional-expenses", permission: "accounting.view",
    handler: async (ctx) => accounting.reportFunctionalExpenses(ctx.user!, ctx.query.get("from") ?? undefined, ctx.query.get("to") ?? undefined),
  });
  route({
    method: "GET", pattern: "reports/fund-balances", permission: "accounting.view",
    handler: async (ctx) => accounting.reportFundBalances(ctx.user!, ctx.query.get("asOf") ?? undefined),
  });
  route({
    method: "GET", pattern: "reports/giving-breakdown", permission: "accounting.view",
    handler: async (ctx) => accounting.reportGivingBreakdown(ctx.user!, ctx.query.get("from") ?? undefined, ctx.query.get("to") ?? undefined),
  });
  route({
    method: "GET", pattern: "reports/receipts-payments", permission: "accounting.view",
    handler: async (ctx) => accounting.reportReceiptsPayments(ctx.user!, ctx.query.get("from") ?? undefined, ctx.query.get("to") ?? undefined),
  });
  route({
    method: "GET", pattern: "reports/remittances", permission: "accounting.view",
    handler: async (ctx) => accounting.reportRemittances(ctx.user!, ctx.query.get("from") ?? undefined, ctx.query.get("to") ?? undefined),
  });
  route({
    method: "GET", pattern: "reports/trial-balance", permission: "accounting.view",
    handler: async (ctx) => accounting.reportTrialBalance(ctx.user!, ctx.query.get("asOf") ?? undefined),
  });
  route({
    method: "GET", pattern: "reports/cash-flow", permission: "accounting.view",
    handler: async (ctx) => accounting.reportCashFlow(ctx.user!, ctx.query.get("from") ?? undefined, ctx.query.get("to") ?? undefined),
  });
  route({
    method: "GET", pattern: "reports/income-trend", permission: "accounting.view",
    handler: async (ctx) => accounting.reportIncomeTrend(ctx.user!, ctx.query.get("from") ?? undefined, ctx.query.get("to") ?? undefined),
  });
  route({
    method: "GET", pattern: "reports/payroll-register", permission: "accounting.view",
    handler: async (ctx) => payroll.reportPayrollRegister(ctx.user!, { from: ctx.query.get("from") ?? undefined, to: ctx.query.get("to") ?? undefined, kind: ctx.query.get("kind") ?? undefined }),
  });

  // ── manual journal entries, reversals, account ledger (enterprise) ──────────
  route({
    method: "POST", pattern: "journal-entries/manual", permission: "accounting.manage",
    handler: async (ctx) => accounting.createManualJournal(ctx.user!, ctx.body ?? {}, meta(ctx)),
  });
  route({
    method: "POST", pattern: "journal-entries/:id/reverse", permission: "accounting.manage",
    handler: async (ctx) => {
      const reason = ctx.body?.reason;
      if (!reason) throw badRequest("reason is required.");
      return accounting.reverseJournalEntry(ctx.user!, ctx.params.id, reason, meta(ctx));
    },
  });
  route({
    method: "GET", pattern: "accounts/:id/ledger", permission: "accounting.view",
    handler: async (ctx) => accounting.getAccountLedger(ctx.user!, ctx.params.id, { from: ctx.query.get("from") ?? undefined, to: ctx.query.get("to") ?? undefined }),
  });

  // ── bank reconciliation upgrades ─────────────────────────────────────────────
  route({
    method: "POST", pattern: "bank-accounts/:id/automatch", permission: "accounting.manage",
    handler: async (ctx) => accounting.autoMatchBankTransactions(ctx.user!, ctx.params.id, meta(ctx)),
  });
  route({
    method: "POST", pattern: "bank-transactions/:id/quickbook", permission: "accounting.manage",
    handler: async (ctx) => accounting.quickBookBankCharge(ctx.user!, ctx.params.id, ctx.body ?? {}, meta(ctx)),
  });

  // ── payment vouchers (request → approve → pay) ───────────────────────────────
  route({
    method: "GET", pattern: "payment-vouchers", permission: "accounting.view",
    handler: async (ctx) => vouchers.listPaymentVouchers(ctx.user!, { status: ctx.query.get("status") ?? undefined }),
  });
  route({
    method: "GET", pattern: "payment-vouchers/:id", permission: "accounting.view",
    handler: async (ctx) => vouchers.getPaymentVoucher(ctx.user!, ctx.params.id),
  });
  route({
    method: "POST", pattern: "payment-vouchers", permission: "accounting.vouchers.request",
    handler: async (ctx) => vouchers.createPaymentVoucher(ctx.user!, ctx.body ?? {}, meta(ctx)),
  });
  route({
    method: "POST", pattern: "payment-vouchers/:id/approve", permission: "accounting.vouchers.approve",
    handler: async (ctx) => vouchers.approvePaymentVoucher(ctx.user!, ctx.params.id, meta(ctx)),
  });
  route({
    method: "POST", pattern: "payment-vouchers/:id/confirm", permission: "accounting.manage",
    handler: async (ctx) => vouchers.confirmPaymentVoucher(ctx.user!, ctx.params.id, meta(ctx)),
  });
  route({
    method: "POST", pattern: "payment-vouchers/:id/reject", permission: "accounting.vouchers.approve",
    handler: async (ctx) => {
      const note = ctx.body?.note;
      if (!note) throw badRequest("note is required.");
      return vouchers.rejectPaymentVoucher(ctx.user!, ctx.params.id, note, meta(ctx));
    },
  });
  route({
    method: "POST", pattern: "payment-vouchers/:id/pay", permission: "accounting.manage",
    handler: async (ctx) => vouchers.payPaymentVoucher(ctx.user!, ctx.params.id, ctx.body ?? {}, meta(ctx)),
  });
  route({
    method: "POST", pattern: "payment-vouchers/:id/void", permission: "accounting.manage",
    handler: async (ctx) => vouchers.voidPaymentVoucher(ctx.user!, ctx.params.id, meta(ctx)),
  });

  // ── remittances (destinations, rules, schedule) ──────────────────────────────
  route({
    method: "GET", pattern: "remittance-destinations", permission: "accounting.view",
    handler: async (ctx) => remittances.listDestinations(ctx.user!),
  });
  route({
    method: "POST", pattern: "remittance-destinations", permission: "accounting.manage",
    handler: async (ctx) => remittances.createDestination(ctx.user!, ctx.body ?? {}, meta(ctx)),
  });
  route({
    method: "GET", pattern: "remittance-rules", permission: "accounting.view",
    handler: async (ctx) => remittances.listRules(ctx.user!),
  });
  route({
    method: "POST", pattern: "remittance-rules", permission: "accounting.manage",
    handler: async (ctx) => remittances.createRule(ctx.user!, ctx.body ?? {}, meta(ctx)),
  });
  route({
    method: "PATCH", pattern: "remittance-rules/:id", permission: "accounting.manage",
    handler: async (ctx) => remittances.updateRule(ctx.user!, ctx.params.id, ctx.body ?? {}, meta(ctx)),
  });
  route({
    method: "POST", pattern: "remittance-schedule/compute", permission: "accounting.manage",
    handler: async (ctx) => remittances.computeSchedule(ctx.user!, ctx.body?.periodMonth, meta(ctx)),
  });
  route({
    method: "GET", pattern: "remittance-schedule", permission: "accounting.view",
    handler: async (ctx) => remittances.listSchedule(ctx.user!, ctx.query.get("month") ?? undefined),
  });
  route({
    method: "POST", pattern: "remittance-schedule/approve", permission: "accounting.manage",
    handler: async (ctx) => {
      const periodMonth = ctx.body?.periodMonth;
      if (!periodMonth) throw badRequest("periodMonth is required.");
      return remittances.approveSchedule(ctx.user!, periodMonth, meta(ctx));
    },
  });
  route({
    method: "POST", pattern: "remittance-schedule/:id/payment", permission: "accounting.manage",
    handler: async (ctx) => remittances.recordRemittancePayment(ctx.user!, ctx.params.id, ctx.body ?? {}, meta(ctx)),
  });

  // ── other receipts + cash deposits ──────────────────────────────────────────
  route({
    method: "GET", pattern: "other-receipts", permission: "accounting.view",
    handler: async (ctx) => receipts.listOtherReceipts(ctx.user!, { from: ctx.query.get("from") ?? undefined, to: ctx.query.get("to") ?? undefined }),
  });
  route({
    method: "POST", pattern: "other-receipts", permission: "accounting.manage",
    handler: async (ctx) => receipts.createOtherReceipt(ctx.user!, ctx.body ?? {}, meta(ctx)),
  });
  route({
    method: "GET", pattern: "cash-deposits", permission: "accounting.view",
    handler: async (ctx) => receipts.listCashDeposits(ctx.user!),
  });
  route({
    method: "POST", pattern: "cash-deposits", permission: "accounting.manage",
    handler: async (ctx) => receipts.recordCashDeposit(ctx.user!, ctx.body ?? {}, meta(ctx)),
  });

  // ── petty cash ────────────────────────────────────────────────────────────────
  route({
    method: "GET", pattern: "petty-cash", permission: "accounting.view",
    handler: async (ctx) => petty.getPettyCashStatus(ctx.user!),
  });
  route({
    method: "GET", pattern: "petty-cash/disbursements", permission: "accounting.view",
    handler: async (ctx) => petty.listPettyCashDisbursements(ctx.user!),
  });
  route({
    method: "POST", pattern: "petty-cash/disburse", permission: "accounting.manage",
    handler: async (ctx) => petty.disbursePettyCash(ctx.user!, ctx.body ?? {}, meta(ctx)),
  });
  route({
    method: "POST", pattern: "petty-cash/replenish", permission: "accounting.manage",
    handler: async (ctx) => petty.replenishPettyCash(ctx.user!, ctx.body ?? {}, meta(ctx)),
  });

  // ── stipends & payroll ────────────────────────────────────────────────────────
  route({
    method: "GET", pattern: "stipend-batches", permission: "accounting.view",
    handler: async (ctx) => payroll.listStipendBatches(ctx.user!),
  });
  route({
    method: "GET", pattern: "stipend-batches/:id", permission: "accounting.view",
    handler: async (ctx) => payroll.getStipendBatch(ctx.user!, ctx.params.id),
  });
  route({
    method: "POST", pattern: "stipend-batches", permission: "accounting.manage",
    handler: async (ctx) => payroll.createStipendBatch(ctx.user!, ctx.body ?? {}, meta(ctx)),
  });
  route({
    method: "POST", pattern: "stipend-batches/:id/post", permission: "accounting.manage",
    handler: async (ctx) => payroll.postStipendBatch(ctx.user!, ctx.params.id, ctx.body ?? {}, meta(ctx)),
  });

  // ── payroll system (payroll | stipend | honoraria runs + staff profiles) ─────
  route({
    method: "GET", pattern: "payroll/profiles", permission: "accounting.view",
    handler: async (ctx) => payroll.listStaffProfiles(ctx.user!),
  });
  route({
    method: "POST", pattern: "payroll/profiles", permission: "accounting.manage",
    handler: async (ctx) => payroll.upsertStaffProfile(ctx.user!, ctx.body ?? {}, meta(ctx)),
  });
  route({
    method: "PATCH", pattern: "payroll/profiles/:id", permission: "accounting.manage",
    handler: async (ctx) => payroll.upsertStaffProfile(ctx.user!, { ...(ctx.body ?? {}), id: ctx.params.id }, meta(ctx)),
  });
  route({
    method: "GET", pattern: "payroll/runs", permission: "accounting.view",
    handler: async (ctx) => payroll.listPayrollRuns(ctx.user!, { kind: ctx.query.get("kind") ?? undefined }),
  });
  route({
    method: "GET", pattern: "payroll/runs/:id", permission: "accounting.view",
    handler: async (ctx) => payroll.getPayrollRun(ctx.user!, ctx.params.id),
  });
  route({
    method: "POST", pattern: "payroll/runs", permission: "accounting.manage",
    handler: async (ctx) => payroll.createPayrollRun(ctx.user!, ctx.body ?? {}, meta(ctx)),
  });
  route({
    method: "PATCH", pattern: "payroll/runs/:id", permission: "accounting.manage",
    handler: async (ctx) => payroll.updatePayrollRun(ctx.user!, ctx.params.id, ctx.body ?? {}, meta(ctx)),
  });
  route({
    method: "POST", pattern: "payroll/runs/:id/submit", permission: "accounting.manage",
    handler: async (ctx) => payroll.submitPayrollRun(ctx.user!, ctx.params.id, meta(ctx)),
  });
  route({
    method: "POST", pattern: "payroll/runs/:id/approve", permission: "accounting.vouchers.approve",
    handler: async (ctx) => payroll.approvePayrollRun(ctx.user!, ctx.params.id, meta(ctx)),
  });
  route({
    method: "POST", pattern: "payroll/runs/:id/reject", permission: "accounting.vouchers.approve",
    handler: async (ctx) => {
      const note = ctx.body?.note;
      if (!note) throw badRequest("note is required.");
      return payroll.rejectPayrollRun(ctx.user!, ctx.params.id, note, meta(ctx));
    },
  });
  route({
    method: "POST", pattern: "payroll/runs/:id/post", permission: "accounting.manage",
    handler: async (ctx) => payroll.postPayrollRun(ctx.user!, ctx.params.id, ctx.body ?? {}, meta(ctx)),
  });
}
