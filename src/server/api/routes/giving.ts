import { route } from "@/server/api/router";
import * as giving from "@/server/services/giving";
import { badRequest } from "@/server/http";

/**
 * Giving routes (thin controllers — all logic in services).
 * Append-only money: donations are created and reversed, never edited.
 *
 * PERMISSION MODEL (least-privilege at the route, scoped in the service):
 *  • Read routes declare "giving.view.own" — the smallest grant any legitimate
 *    viewer holds. The service then either forces personId=self (member) or
 *    returns everything (giving.view.all). Never trust the client's personId.
 *  • Staff actions declare their exact grant: giving.record, giving.reverse,
 *    giving.batches.manage, giving.funds.manage, giving.pledges.manage,
 *    giving.statements.manage.
 *  • Member self-service writes declare "giving.give" and re-check ownership
 *    in the service (own recurring gifts, own pledges, own methods).
 */
export function registerGivingRoutes() {
  route({
    method: "GET", pattern: "funds", permission: "giving.view.own",
    handler: async (ctx) => giving.listFunds(ctx.user!),
  });

  route({
    method: "POST", pattern: "funds", permission: "giving.funds.manage",
    handler: async (ctx) => giving.createFund(ctx.user!, ctx.body, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined }),
  });

  route({
    method: "GET", pattern: "donations", permission: "giving.view.own",
    handler: async (ctx) =>
      giving.listDonations(ctx.user!, {
        search: ctx.query.get("search") ?? undefined,
        fundId: ctx.query.get("fundId") ?? undefined,
        method: ctx.query.get("method") ?? undefined,
        status: ctx.query.get("status") ?? undefined,
        from: ctx.query.get("from") ?? undefined,
        to: ctx.query.get("to") ?? undefined,
        batchId: ctx.query.get("batchId") ?? undefined,
        personId: ctx.query.get("personId") ?? undefined, // IGNORED for view.own users — service forces self
        page: Number(ctx.query.get("page") ?? 1),
        pageSize: Number(ctx.query.get("pageSize") ?? 25),
      }),
  });

  route({
    method: "POST", pattern: "donations", permission: "giving.record",
    handler: async (ctx) => giving.createDonation(ctx.user!, ctx.body, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined }),
  });

  route({
    method: "POST", pattern: "donations/:id/reverse", permission: "giving.reverse",
    handler: async (ctx) => {
      const reason = ctx.body?.reason;
      if (!reason) throw badRequest("reason is required.");
      return giving.reverseDonation(ctx.user!, ctx.params.id, reason, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined });
    },
  });

  route({
    method: "GET", pattern: "batches", permission: "giving.view.all",
    handler: async (ctx) => giving.listBatches(ctx.user!),
  });

  route({
    method: "POST", pattern: "batches", permission: "giving.batches.manage",
    handler: async (ctx) => giving.createBatch(ctx.user!, ctx.body, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined }),
  });

  route({
    method: "POST", pattern: "batches/:id/post", permission: "giving.batches.manage",
    handler: async (ctx) => {
      const countedByTwo = ctx.body?.countedByTwo;
      if (!countedByTwo) throw badRequest("countedByTwo is required (two-person control).");
      return giving.postBatch(ctx.user!, ctx.params.id, countedByTwo, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined });
    },
  });

  route({
    method: "GET", pattern: "pledges", permission: "giving.view.own",
    handler: async (ctx) =>
      giving.listPledges(ctx.user!, {
        fundId: ctx.query.get("fundId") ?? undefined,
        campaign: ctx.query.get("campaign") ?? undefined,
      }),
  });

  route({
    // staff create pledges FOR others (giving.pledges.manage, enforced in service);
    // members may pledge for THEMSELVES (giving.give, forced personId=self)
    method: "POST", pattern: "pledges", permission: "giving.view.own",
    handler: async (ctx) => giving.createPledge(ctx.user!, ctx.body, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined }),
  });

  route({
    method: "GET", pattern: "recurring-gifts", permission: "giving.view.own",
    handler: async (ctx) => giving.listRecurringGifts(ctx.user!),
  });

  const meta = (ctx: any) => ({ ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined });

  route({
    method: "POST", pattern: "recurring-gifts/:id/cancel", permission: "giving.give",
    handler: async (ctx) => giving.cancelRecurringGift(ctx.user!, ctx.params.id, meta(ctx)),
  });

  route({
    method: "POST", pattern: "recurring-gifts/:id/pause", permission: "giving.give",
    handler: async (ctx) => giving.pauseRecurringGift(ctx.user!, ctx.params.id, meta(ctx)),
  });

  route({
    method: "POST", pattern: "recurring-gifts/:id/resume", permission: "giving.give",
    handler: async (ctx) => giving.resumeRecurringGift(ctx.user!, ctx.params.id, meta(ctx)),
  });

  route({
    method: "GET", pattern: "statements", permission: "giving.view.own",
    handler: async (ctx) => {
      const taxYear = ctx.query.get("taxYear");
      return giving.listStatements(ctx.user!, taxYear ? Number(taxYear) : undefined);
    },
  });

  route({
    method: "POST", pattern: "statements/generate", permission: "giving.statements.manage",
    handler: async (ctx) => {
      const taxYear = Number(ctx.body?.taxYear);
      if (!taxYear) throw badRequest("taxYear is required.");
      return giving.generateStatements(ctx.user!, taxYear, meta(ctx));
    },
  });

  route({
    method: "GET", pattern: "statements/:id/preview", permission: "giving.view.own",
    handler: async (ctx) => giving.previewStatement(ctx.user!, ctx.params.id),
  });

  // ── member self-service (giving.give — ownership forced server-side) ───────
  route({
    method: "GET", pattern: "giving/me/payment-methods", permission: "giving.give",
    handler: async (ctx) => giving.listMyPaymentMethods(ctx.user!),
  });

  route({
    method: "POST", pattern: "giving/me/payment-methods", permission: "giving.give",
    handler: async (ctx) => giving.addMyPaymentMethod(ctx.user!, ctx.body ?? {}, meta(ctx)),
  });

  route({
    method: "POST", pattern: "giving/me/payment-methods/:id/default", permission: "giving.give",
    handler: async (ctx) => giving.setDefaultPaymentMethod(ctx.user!, ctx.params.id, meta(ctx)),
  });

  route({
    method: "DELETE", pattern: "giving/me/payment-methods/:id", permission: "giving.give",
    handler: async (ctx) => giving.removeMyPaymentMethod(ctx.user!, ctx.params.id, meta(ctx)),
  });

  route({
    method: "POST", pattern: "giving/me/give", permission: "giving.give",
    handler: async (ctx) => giving.giveNow(ctx.user!, ctx.body ?? {}, meta(ctx)),
  });

  // SetupIntent for saving a NEW payment method — Stripe mode returns a
  // clientSecret for Stripe.js; demo mode returns mode:"demo" (token stand-in).
  route({
    method: "POST", pattern: "giving/me/payment-methods/setup-intent", permission: "giving.give",
    handler: async (ctx) => giving.createMySetupIntent(ctx.user!),
  });

  // Stripe mode only: save a SetupIntent-confirmed token (pm_…). Raw card data
  // never travels here — the token was minted in-browser by Stripe.js.
  route({
    method: "POST", pattern: "giving/me/payment-methods/stripe", permission: "giving.give",
    handler: async (ctx) => giving.addStripePaymentMethod(ctx.user!, ctx.body ?? {}, meta(ctx)),
  });

  // ── tithe commitment / giving covenant (self-service) ──────────────────────
  route({
    method: "GET", pattern: "giving/me/commitment", permission: "giving.give",
    handler: async (ctx) => giving.getMyCommitment(ctx.user!),
  });

  route({
    method: "POST", pattern: "giving/me/commitment", permission: "giving.give",
    handler: async (ctx) => giving.upsertMyCommitment(ctx.user!, ctx.body ?? {}, meta(ctx)),
  });

  route({
    method: "DELETE", pattern: "giving/me/commitment", permission: "giving.give",
    handler: async (ctx) => giving.removeMyCommitment(ctx.user!, meta(ctx)),
  });
}
