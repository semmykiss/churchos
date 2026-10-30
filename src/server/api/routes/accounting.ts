import { route } from "@/server/api/router";
import * as accounting from "@/server/services/accounting";
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
      const csv = ctx.body?.csv;
      if (!csv || typeof csv !== "string") throw badRequest("csv is required.");
      return accounting.importBankStatement(ctx.user!, ctx.params.id, csv, meta(ctx));
    },
  });
  route({
    method: "POST", pattern: "bank-transactions/:id/match", permission: "accounting.manage",
    handler: async (ctx) => accounting.matchBankTransaction(ctx.user!, ctx.params.id, ctx.body ?? {}, meta(ctx)),
  });

  // ── budgets ─────────────────────────────────────────────────────────────────
  route({
    method: "GET", pattern: "budgets", permission: "accounting.view",
    handler: async (ctx) => accounting.getBudgets(ctx.user!, ctx.query.get("fiscalYear") ? Number(ctx.query.get("fiscalYear")) : undefined),
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
}
