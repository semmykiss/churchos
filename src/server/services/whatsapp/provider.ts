import { randomBytes } from "crypto";
import { db } from "@/server/db";
import { decryptField } from "@/server/services/tenant/crypto";
import { badRequest } from "@/server/http";

/**
 * WhatsApp provider layer (backend only).
 *
 *  • "meta"    — WhatsApp Business Platform (Meta Cloud API). Messages POST to
 *                graph.facebook.com; delivery/read receipts arrive on the
 *                webhook. No third-party wrapper, no per-message markup.
 *  • "sandbox" — local development provider. Outbound messages are persisted
 *                and instantly marked delivered so the whole two-way pipeline
 *                (router, flows, AI, broadcasts) is testable without a Meta
 *                business account. Inbound traffic is injected via
 *                POST /whatsapp/simulate/inbound.
 */

export interface OutboundPayload {
  to: string; // E.164
  kind: "text" | "template";
  text?: string;
  templateName?: string;
  templateLanguage?: string;
  templateVars?: string[];
}

export interface SendResult {
  waMessageId: string;
  status: "sent" | "failed";
  error?: string;
}

const GRAPH_VERSION = "v21.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

/** Send one outbound message through the account's provider. */
export async function sendOutbound(
  account: { id: string; orgId: string; provider: string; phoneNumberId: string; accessTokenEnc: string | null },
  payload: OutboundPayload,
): Promise<SendResult> {
  if (account.provider === "sandbox") return sandboxSend(payload);

  const token = decryptField(account.accessTokenEnc);
  if (!token) return { waMessageId: "", status: "failed", error: "Account has no access token configured." };

  const body =
    payload.kind === "template"
      ? {
          messaging_product: "whatsapp",
          to: payload.to,
          type: "template",
          template: {
            name: payload.templateName,
            language: { code: payload.templateLanguage || "en" },
            ...(payload.templateVars?.length
              ? { components: [{ type: "body", parameters: payload.templateVars.map((t) => ({ type: "text", text: t })) }] }
              : {}),
          },
        }
      : { messaging_product: "whatsapp", to: payload.to, type: "text", text: { body: payload.text ?? "" } };

  try {
    const res = await fetch(`${GRAPH_BASE}/${account.phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    const data = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string } };
    if (!res.ok) return { waMessageId: "", status: "failed", error: data?.error?.message ?? `Graph API ${res.status}` };
    return { waMessageId: data.messages?.[0]?.id ?? "", status: "sent" };
  } catch (err) {
    return { waMessageId: "", status: "failed", error: err instanceof Error ? err.message : "network_error" };
  }
}

async function sandboxSend(payload: OutboundPayload): Promise<SendResult> {
  if (!payload.text && payload.kind === "text") throw badRequest("Sandbox text message needs a body.");
  return { waMessageId: `wamid.sandbox-${randomBytes(10).toString("hex")}`, status: "sent" };
}

/**
 * Submit a template to Meta for approval (real provider) — sandbox provider
 * leaves it "pending" so the approval gate can be exercised locally via
 * the simulate-approval action (mirrors Meta's manual review).
 */
export async function submitTemplateToMeta(
  account: { provider: string; phoneNumberId: string; accessTokenEnc: string | null; businessAccountId?: string | null },
  tpl: { name: string; category: string; body: string; language: string },
): Promise<{ ok: boolean; info?: string }> {
  if (account.provider === "sandbox") {
    return { ok: true, info: "Sandbox: template queued for review. Use “Simulate Meta approval” to grant it." };
  }
  const token = decryptField(account.accessTokenEnc);
  if (!token) return { ok: false, info: "Account has no access token configured." };
  try {
    const res = await fetch(`${GRAPH_BASE}/${account.businessAccountId || account.phoneNumberId}/message_templates`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: tpl.name, category: tpl.category.toUpperCase(), language: tpl.language, components: [{ type: "BODY", text: tpl.body }] }),
      signal: AbortSignal.timeout(15000),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    if (!res.ok) return { ok: false, info: data?.error?.message ?? `Graph API ${res.status}` };
    return { ok: true, info: "Submitted to Meta for review." };
  } catch (err) {
    return { ok: false, info: err instanceof Error ? err.message : "network_error" };
  }
}

/** Look up the active WhatsApp account for an org (single-account model). */
export async function activeAccountFor(orgId: string) {
  return db.whatsAppAccount.findFirst({
    where: { orgId, status: "active" },
    orderBy: { createdAt: "desc" },
  });
}
