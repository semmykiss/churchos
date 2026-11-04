import { route } from "@/server/api/router";
import { can } from "@/server/permissions";
import { badRequest, forbidden } from "@/server/http";
import { db } from "@/server/db";
import { createHmac, timingSafeEqual } from "crypto";
import { decryptField } from "@/server/services/tenant/crypto";
import * as core from "@/server/services/whatsapp/core";
import * as flows from "@/server/services/whatsapp/flows";
import * as broadcasts from "@/server/services/whatsapp/broadcasts";
import * as inboundSvc from "@/server/services/whatsapp/inbound";
import { activeAccountFor } from "@/server/services/whatsapp/provider";
import { audit } from "@/server/audit";
import { optArr, optBool, optObj, optStr, optStrArr } from "@/server/api/body";

/**
 * WhatsApp routes (thin controllers — all logic in services).
 * The webhook pair is PUBLIC (Meta calls it without a session) and is
 * authenticated by the verify token (GET) and optional X-Hub-Signature-256
 * (POST, when an app secret is configured).
 */
export function registerWhatsAppRoutes() {
  const canSend = (u: Parameters<typeof can>[0]) => can(u, "comms.whatsapp.send") || can(u, "comms.send");

  // ── Meta webhook (public) ────────────────────────────────────────────────
  route({
    method: "GET", pattern: "whatsapp/webhook/:phoneNumberId", isPublic: true,
    handler: async (ctx) => {
      const account = await inboundSvc.accountByPhoneNumberId(ctx.params.phoneNumberId);
      const mode = ctx.query.get("hub.mode");
      const token = ctx.query.get("hub.verify_token");
      const challenge = ctx.query.get("hub.challenge") ?? "";
      if (mode === "subscribe" && token && token === account.webhookVerifyToken) {
        return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
      }
      return new Response("Forbidden", { status: 403 });
    },
  });

  route({
    method: "POST", pattern: "whatsapp/webhook/:phoneNumberId", isPublic: true,
    handler: async (ctx) => {
      const account = await inboundSvc.accountByPhoneNumberId(ctx.params.phoneNumberId);
      const raw = await ctx.req.text();

      // optional signature verification (Meta: X-Hub-Signature-256)
      const secret = account.appSecretEnc ? decryptField(account.appSecretEnc) : null;
      if (secret) {
        const header = ctx.req.headers.get("x-hub-signature-256") ?? "";
        const expected = "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
        const a = Buffer.from(header);
        const b = Buffer.from(expected);
        if (a.length !== b.length || !timingSafeEqual(a, b)) {
          return new Response("Invalid signature", { status: 401 });
        }
      }

      let payload: any;
      try {
        payload = JSON.parse(raw);
      } catch {
        return new Response("EVENT_RECEIVED", { status: 200 });
      }

      const values: any[] = payload?.entry?.[0]?.changes?.map((c: any) => c?.value) ?? [];
      for (const value of values) {
        for (const m of value?.messages ?? []) {
          const text =
            m?.text?.body ??
            m?.interactive?.button_reply?.title ??
            m?.button?.text ??
            m?.image?.caption ??
            "";
          try {
            await inboundSvc.processInbound(account, {
              phone: String(m?.from ?? ""),
              text: String(text ?? ""),
              profileName: value?.contacts?.[0]?.profile?.name ?? null,
              waMessageId: m?.id ?? null,
              messageType: m?.type === "button" || m?.type === "interactive" ? "interactive" : m?.type ?? "text",
            });
          } catch (err) {
            console.error("[whatsapp] inbound processing failed:", err);
          }
        }
        const statuses: { id: string; status: string }[] = (value?.statuses ?? []).map((s: any) => ({ id: s?.id, status: s?.status }));
        if (statuses.length) await inboundSvc.applyStatuses(account.orgId, statuses);
      }

      // Meta requires a fast 200 regardless of processing outcome
      return new Response("EVENT_RECEIVED", { status: 200 });
    },
  });

  // ── sandbox: inject an inbound message (dev/testing) ─────────────────────
  route({
    method: "POST", pattern: "whatsapp/simulate/inbound", permission: "admin.manage",
    handler: async (ctx) => {
      const account = await inboundSvc.requireActiveAccount(ctx.user!.orgId);
      if (account.provider !== "sandbox") throw badRequest("Inbound simulation is only available for the sandbox provider.");
      const phone = String(ctx.body?.phoneNumber ?? "").trim();
      const text = String(ctx.body?.text ?? "").trim();
      if (!phone || !text) throw badRequest("phoneNumber and text are required.");
      const result = await inboundSvc.processInbound(account, { phone, text, profileName: optStr(ctx.body?.profileName) ?? null });
      return result;
    },
  });

  // ── overview / settings ──────────────────────────────────────────────────
  route({
    method: "GET", pattern: "whatsapp/overview", permission: "comms.view",
    handler: async (ctx) => {
      const user = ctx.user!;
      const [account, contacts, optedOut, messages24h, followups, templates, flows] = await Promise.all([
        activeAccountFor(user.orgId),
        db.whatsAppContact.count({ where: { orgId: user.orgId } }),
        db.whatsAppContact.count({ where: { orgId: user.orgId, optedIn: false } }),
        db.whatsAppMessage.count({ where: { orgId: user.orgId, createdAt: { gte: new Date(Date.now() - 86400_000) } } }),
        db.whatsAppFlowRun.count({ where: { orgId: user.orgId, needsHuman: true } }),
        db.whatsAppTemplate.count({ where: { orgId: user.orgId, status: "approved" } }),
        db.whatsAppFlow.count({ where: { orgId: user.orgId, isActive: true } }),
      ]);
      return {
        connected: !!account,
        provider: account?.provider ?? null,
        displayPhoneNumber: account?.displayPhoneNumber ?? null,
        accountStatus: account?.status ?? null,
        contacts,
        optedOut,
        messages24h,
        followups,
        approvedTemplates: templates,
        activeFlows: flows,
      };
    },
  });

  route({
    method: "GET", pattern: "whatsapp/accounts", permission: "comms.view",
    handler: async (ctx) => core.listAccounts(ctx.user!),
  });
  route({
    method: "POST", pattern: "whatsapp/accounts", permission: "admin.manage",
    handler: async (ctx) =>
      core.connectAccount(
        ctx.user!,
        {
          provider: optStr(ctx.body?.provider),
          phoneNumberId: optStr(ctx.body?.phoneNumberId) ?? "", // service 400s on empty
          displayPhoneNumber: optStr(ctx.body?.displayPhoneNumber),
          businessAccountId: optStr(ctx.body?.businessAccountId),
          accessToken: optStr(ctx.body?.accessToken),
          appSecret: optStr(ctx.body?.appSecret),
        },
        { ip: ctx.ip, userAgent: ctx.userAgent },
      ),
  });
  route({
    method: "POST", pattern: "whatsapp/accounts/:id/disconnect", permission: "admin.manage",
    handler: async (ctx) => core.disconnectAccount(ctx.user!, ctx.params.id, { ip: ctx.ip, userAgent: ctx.userAgent }),
  });

  // ── inbox ────────────────────────────────────────────────────────────────
  route({
    method: "GET", pattern: "whatsapp/conversations", permission: "comms.view",
    handler: async (ctx) => core.listConversations(ctx.user!),
  });
  route({
    method: "GET", pattern: "whatsapp/messages/:contactId", permission: "comms.view",
    handler: async (ctx) => core.listMessages(ctx.user!, ctx.params.contactId),
  });
  route({
    method: "POST", pattern: "whatsapp/send", permission: "comms.view", // channel permission re-checked in the service
    handler: async (ctx) => {
      const contactId = optStr(ctx.body?.contactId);
      if (!contactId) throw badRequest("contactId is required.");
      return core.sendReply(
        ctx.user!,
        { contactId, text: optStr(ctx.body?.text), templateId: optStr(ctx.body?.templateId), vars: optStrArr(ctx.body?.vars) },
        { ip: ctx.ip, userAgent: ctx.userAgent },
      );
    },
  });
  route({
    method: "GET", pattern: "whatsapp/contacts", permission: "comms.view",
    handler: async (ctx) => core.listContacts(ctx.user!, ctx.query.get("search") ?? undefined),
  });
  route({
    method: "POST", pattern: "whatsapp/contacts/:id/link", permission: "comms.view", // people.view re-checked in the service
    handler: async (ctx) => core.linkContact(ctx.user!, ctx.params.id, optStr(ctx.body?.personId) ?? null),
  });

  // ── templates ────────────────────────────────────────────────────────────
  route({
    method: "GET", pattern: "whatsapp/templates", permission: "comms.view",
    handler: async (ctx) => broadcasts.listTemplates(ctx.user!),
  });
  route({
    method: "POST", pattern: "whatsapp/templates", permission: "comms.view", // send permission re-checked in the service
    handler: async (ctx) =>
      broadcasts.saveTemplate(
        ctx.user!,
        {
          id: optStr(ctx.body?.id),
          name: optStr(ctx.body?.name) ?? "", // service 400s on empty
          category: optStr(ctx.body?.category),
          language: optStr(ctx.body?.language),
          body: optStr(ctx.body?.body) ?? "", // service 400s on empty
          variables: optStrArr(ctx.body?.variables),
        },
        { ip: ctx.ip, userAgent: ctx.userAgent },
      ),
  });
  route({
    method: "POST", pattern: "whatsapp/templates/:id/submit",
    handler: async (ctx) => {
      if (!canSend(ctx.user)) throw forbidden('Requires "comms.whatsapp.send" permission.');
      return broadcasts.submitTemplate(ctx.user!, ctx.params.id);
    },
  });
  route({
    method: "POST", pattern: "whatsapp/templates/:id/approve",
    handler: async (ctx) => {
      if (!canSend(ctx.user)) throw forbidden('Requires "comms.whatsapp.send" permission.');
      return broadcasts.approveTemplate(ctx.user!, ctx.params.id);
    },
  });
  route({
    method: "DELETE", pattern: "whatsapp/templates/:id",
    handler: async (ctx) => {
      if (!canSend(ctx.user)) throw forbidden('Requires "comms.whatsapp.send" permission.');
      return broadcasts.deleteTemplate(ctx.user!, ctx.params.id);
    },
  });

  // ── broadcasts ───────────────────────────────────────────────────────────
  route({
    method: "GET", pattern: "whatsapp/broadcasts", permission: "comms.view",
    handler: async (ctx) => broadcasts.listBroadcasts(ctx.user!),
  });
  route({
    method: "POST", pattern: "whatsapp/audience/preview", permission: "comms.view",
    handler: async (ctx) => broadcasts.previewAudience(ctx.user!, ctx.body ?? {}),
  });
  route({
    method: "POST", pattern: "whatsapp/broadcasts", permission: "comms.view", // send permission re-checked in the service
    handler: async (ctx) => {
      const templateId = optStr(ctx.body?.templateId);
      if (!templateId) throw badRequest("templateId is required.");
      const audience = optObj(ctx.body?.audience);
      return broadcasts.saveBroadcast(
        ctx.user!,
        {
          id: optStr(ctx.body?.id),
          name: optStr(ctx.body?.name) ?? "", // service 400s on empty
          templateId,
          audience: {
            stage: optStrArr(audience?.stage),
            groupIds: optStrArr(audience?.groupIds),
            tagIds: optStrArr(audience?.tagIds),
          },
          scheduledAt: optStr(ctx.body?.scheduledAt),
        },
        { ip: ctx.ip, userAgent: ctx.userAgent },
      );
    },
  });
  route({
    method: "POST", pattern: "whatsapp/broadcasts/:id/send",
    handler: async (ctx) => {
      if (!canSend(ctx.user)) throw forbidden('Requires "comms.whatsapp.send" permission.');
      return broadcasts.sendBroadcast(ctx.user!, ctx.params.id, { ip: ctx.ip, userAgent: ctx.userAgent });
    },
  });
  route({
    method: "DELETE", pattern: "whatsapp/broadcasts/:id",
    handler: async (ctx) => {
      if (!canSend(ctx.user)) throw forbidden('Requires "comms.whatsapp.send" permission.');
      return broadcasts.deleteBroadcast(ctx.user!, ctx.params.id);
    },
  });

  // ── flows ────────────────────────────────────────────────────────────────
  route({
    method: "GET", pattern: "whatsapp/flows", permission: "comms.view",
    handler: async (ctx) => flows.listFlows(ctx.user!),
  });
  route({
    method: "POST", pattern: "whatsapp/flows", permission: "comms.view", // send permission re-checked in the service
    handler: async (ctx) =>
      flows.saveFlow(
        ctx.user!,
        {
          id: optStr(ctx.body?.id),
          name: optStr(ctx.body?.name) ?? "", // service 400s on empty
          description: optStr(ctx.body?.description),
          triggerType: optStr(ctx.body?.triggerType),
          eventId: optStr(ctx.body?.eventId),
          steps: optArr(ctx.body?.steps), // service 400s "Steps must be an array."
          isActive: optBool(ctx.body?.isActive),
        },
        { ip: ctx.ip, userAgent: ctx.userAgent },
      ),
  });
  route({
    method: "POST", pattern: "whatsapp/flows/:id/toggle",
    handler: async (ctx) => {
      if (!canSend(ctx.user)) throw forbidden('Requires "comms.whatsapp.send" permission.');
      return flows.toggleFlow(ctx.user!, ctx.params.id, !!ctx.body?.isActive);
    },
  });
  route({
    method: "DELETE", pattern: "whatsapp/flows/:id",
    handler: async (ctx) => {
      if (!canSend(ctx.user)) throw forbidden('Requires "comms.whatsapp.send" permission.');
      return flows.deleteFlow(ctx.user!, ctx.params.id);
    },
  });
  route({
    method: "POST", pattern: "whatsapp/flows/trigger",
    handler: async (ctx) => {
      if (!canSend(ctx.user)) throw forbidden('Requires "comms.whatsapp.send" permission.');
      const flowId = optStr(ctx.body?.flowId);
      const contactId = optStr(ctx.body?.contactId);
      if (!flowId || !contactId) throw badRequest("flowId and contactId are required.");
      return flows.triggerForContact(ctx.user!, { flowId, contactId });
    },
  });
  route({
    method: "POST", pattern: "whatsapp/tick",
    handler: async (ctx) => {
      if (!canSend(ctx.user)) throw forbidden('Requires "comms.whatsapp.send" permission.');
      const now = ctx.body?.now ? new Date(String(ctx.body.now)) : undefined;
      return flows.tick(ctx.user!, now);
    },
  });
  route({
    method: "GET", pattern: "whatsapp/runs", permission: "comms.view",
    handler: async (ctx) => flows.listRuns(ctx.user!, ctx.query.get("filter") ?? undefined),
  });
  route({
    method: "POST", pattern: "whatsapp/runs/:id/resolve",
    handler: async (ctx) => {
      if (!canSend(ctx.user)) throw forbidden('Requires "comms.whatsapp.send" permission.');
      return flows.resolveRun(ctx.user!, ctx.params.id, optStr(ctx.body?.note));
    },
  });

  // ── giving deep links ────────────────────────────────────────────────────
  route({
    method: "GET", pattern: "whatsapp/giving-links/:token", isPublic: true,
    handler: async (ctx) => flows.validateGivingLink(ctx.params.token),
  });
  route({
    method: "POST", pattern: "whatsapp/giving-links/:token/use", isPublic: true,
    handler: async (ctx) => {
      const res = await flows.markGivingLinkUsed(ctx.params.token);
      if (!res.ok) throw badRequest("This giving link is no longer valid.");
      await audit({
        orgId: res.orgId,
        actorType: "system",
        actorLabel: "whatsapp",
        action: "whatsapp.giving_link_used",
        entityType: "whatsapp_giving_link",
        entityId: res.id,
      });
      return { ok: true };
    },
  });
}
