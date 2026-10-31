import { db } from "@/server/db";
import { badRequest } from "@/server/http";
import { audit } from "@/server/audit";
import type { WhatsAppAccount } from "@prisma/client";
import { activeAccountFor } from "./provider";
import {
  ensureContact,
  recordInbound,
  isOptOutWord,
  isOptInWord,
  optOut,
  optIn,
  sendSessionText,
  startOnboarding,
  handleNameReply,
} from "./core";
import { advanceOnReply } from "./flows";
import { aiTurn } from "./ai-channel";

/**
 * Inbound message router (backend only) — the heart of the two-way channel:
 *
 *   inbound message
 *     → STOP / START opt-out handling (Meta policy)
 *     → name-collection onboarding (unknown sender)
 *     → active flow run (structured conversation)
 *     → Shepherd AI (same RBAC as in-app, resolved via phone → person)
 *     → fallback human-handoff note
 */

export interface InboundPayload {
  phone: string;
  text: string;
  profileName?: string | null;
  waMessageId?: string | null;
  messageType?: string;
}

export async function processInbound(account: WhatsAppAccount, payload: InboundPayload) {
  const orgId = account.orgId;
  const text = String(payload.text ?? "").slice(0, 4000).trim();
  if (!text) return { handled: false, reason: "empty" };

  const contact = await ensureContact(orgId, payload.phone, payload.profileName ?? null);
  await recordInbound(orgId, contact.id, text, payload.waMessageId ?? null, payload.messageType ?? "text");
  const fresh = await db.whatsAppContact.findUnique({ where: { id: contact.id } });
  if (!fresh) return { handled: false, reason: "contact_missing" };

  const lower = text.toLowerCase();

  // 1) opt-out / opt-in — always wins, per WhatsApp policy requirements
  if (isOptOutWord(text)) {
    await optOut(orgId, fresh.id);
    await sendSessionText(account, { ...fresh }, "You've been unsubscribed from church WhatsApp messages. Reply START anytime to opt back in.", { source: "optout" });
    await audit({ orgId, actorType: "system", actorLabel: "whatsapp", action: "whatsapp.opt_out", entityType: "whatsapp_contact", entityId: fresh.id, after: { phone: fresh.phoneNumber } });
    return { handled: true, action: "opted_out" };
  }
  if (isOptInWord(text)) {
    await optIn(orgId, fresh.id);
    await sendSessionText(account, { ...fresh }, "Welcome back! ✅ You're subscribed to church WhatsApp messages again. Reply STOP anytime to opt out.", { source: "optin" });
    await audit({ orgId, actorType: "system", actorLabel: "whatsapp", action: "whatsapp.opt_in", entityType: "whatsapp_contact", entityId: fresh.id });
    return { handled: true, action: "opted_in" };
  }

  // 2) name-collection onboarding for unknown senders
  if (fresh.onboardState === "awaiting_name") {
    const res = await handleNameReply(account, { ...fresh }, text);
    return { handled: true, action: res.created ? "guest_created" : res.matched ? "matched" : "onboarding_continues" };
  }

  // 3) active structured flow (RSVP, follow-up questions…)
  const consumedByFlow = await advanceOnReply(orgId, fresh.id, text);
  if (consumedByFlow) return { handled: true, action: "flow_advanced" };

  // 4) unknown sender → start onboarding
  if (!fresh.personId) {
    await startOnboarding(account, { ...fresh });
    return { handled: true, action: "onboarding_started" };
  }

  // 5) Shepherd AI — same RBAC as the in-app assistant
  const aiHandled = await aiTurn({ ...fresh }, text);
  if (aiHandled) return { handled: true, action: "ai_reply" };

  // 6) fallback — never leave a member on read
  await sendSessionText(
    account,
    { ...fresh },
    "Thanks for your message! 🙏 Our team will read it and get back to you soon. For anything urgent, please call the church office.",
    { source: "fallback" },
  );
  return { handled: true, action: "fallback" };
}

/** Resolve the active account from a webhook phone-number id (or 404). */
export async function accountByPhoneNumberId(phoneNumberId: string) {
  const account = await db.whatsAppAccount.findUnique({ where: { phoneNumberId } });
  if (!account) throw badRequest("Unknown WhatsApp phone number id.");
  return account;
}

/** Convenience for simulate + internal callers: the org's active account. */
export async function requireActiveAccount(orgId: string) {
  const account = await activeAccountFor(orgId);
  if (!account) throw badRequest("WhatsApp is not connected for this church yet.");
  return account;
}

/**
 * Apply Meta delivery receipts (statuses) to outbound message rows.
 */
export async function applyStatuses(orgId: string, statuses: { id: string; status: string }[]) {
  let updated = 0;
  for (const s of statuses) {
    const status = ["sent", "delivered", "read", "failed"].includes(s.status) ? s.status : null;
    if (!status) continue;
    const res = await db.whatsAppMessage.updateMany({
      where: { orgId, waMessageId: s.id, direction: "outbound" },
      data: { status },
    });
    updated += res.count;
  }
  return { updated };
}
