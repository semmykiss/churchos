import { route } from "@/server/api/router";
import * as giving from "@/server/services/giving";
import { badRequest } from "@/server/http";

/**
 * Giving routes (thin controllers — all logic in services).
 * Append-only money: donations are created and reversed, never edited.
 */
export function registerGivingRoutes() {
  route({
    method: "GET", pattern: "funds", permission: "giving.view",
    handler: async (ctx) => giving.listFunds(ctx.user!),
  });

  route({
    method: "POST", pattern: "funds", permission: "giving.manage",
    handler: async (ctx) => giving.createFund(ctx.user!, ctx.body, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined }),
  });

  route({
    method: "GET", pattern: "donations", permission: "giving.view",
    handler: async (ctx) =>
      giving.listDonations(ctx.user!, {
        search: ctx.query.get("search") ?? undefined,
        fundId: ctx.query.get("fundId") ?? undefined,
        method: ctx.query.get("method") ?? undefined,
        status: ctx.query.get("status") ?? undefined,
        from: ctx.query.get("from") ?? undefined,
        to: ctx.query.get("to") ?? undefined,
        batchId: ctx.query.get("batchId") ?? undefined,
        page: Number(ctx.query.get("page") ?? 1),
        pageSize: Number(ctx.query.get("pageSize") ?? 25),
      }),
  });

  route({
    method: "POST", pattern: "donations", permission: "giving.manage",
    handler: async (ctx) => giving.createDonation(ctx.user!, ctx.body, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined }),
  });

  route({
    method: "POST", pattern: "donations/:id/reverse", permission: "giving.manage",
    handler: async (ctx) => {
      const reason = ctx.body?.reason;
      if (!reason) throw badRequest("reason is required.");
      return giving.reverseDonation(ctx.user!, ctx.params.id, reason, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined });
    },
  });

  route({
    method: "GET", pattern: "batches", permission: "batches.manage",
    handler: async (ctx) => giving.listBatches(ctx.user!),
  });

  route({
    method: "POST", pattern: "batches", permission: "batches.manage",
    handler: async (ctx) => giving.createBatch(ctx.user!, ctx.body, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined }),
  });

  route({
    method: "POST", pattern: "batches/:id/post", permission: "batches.manage",
    handler: async (ctx) => {
      const countedByTwo = ctx.body?.countedByTwo;
      if (!countedByTwo) throw badRequest("countedByTwo is required (two-person control).");
      return giving.postBatch(ctx.user!, ctx.params.id, countedByTwo, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined });
    },
  });

  route({
    method: "GET", pattern: "pledges", permission: "giving.view",
    handler: async (ctx) =>
      giving.listPledges(ctx.user!, {
        fundId: ctx.query.get("fundId") ?? undefined,
        campaign: ctx.query.get("campaign") ?? undefined,
      }),
  });

  route({
    method: "POST", pattern: "pledges", permission: "giving.manage",
    handler: async (ctx) => giving.createPledge(ctx.user!, ctx.body, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined }),
  });

  route({
    method: "GET", pattern: "recurring-gifts", permission: "giving.view",
    handler: async (ctx) => giving.listRecurringGifts(ctx.user!),
  });

  route({
    method: "POST", pattern: "recurring-gifts/:id/cancel", permission: "giving.manage",
    handler: async (ctx) => giving.cancelRecurringGift(ctx.user!, ctx.params.id, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined }),
  });

  route({
    method: "GET", pattern: "statements", permission: "statements.manage",
    handler: async (ctx) => {
      const taxYear = ctx.query.get("taxYear");
      return giving.listStatements(ctx.user!, taxYear ? Number(taxYear) : undefined);
    },
  });

  route({
    method: "POST", pattern: "statements/generate", permission: "statements.manage",
    handler: async (ctx) => {
      const taxYear = Number(ctx.body?.taxYear);
      if (!taxYear) throw badRequest("taxYear is required.");
      return giving.generateStatements(ctx.user!, taxYear, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined });
    },
  });

  route({
    method: "GET", pattern: "statements/:id/preview", permission: "statements.manage",
    handler: async (ctx) => giving.previewStatement(ctx.user!, ctx.params.id),
  });
}
