import { randomBytes } from "crypto";
import { db } from "@/server/db";
import { can, canSendChannel, type SessionUser } from "@/server/permissions";
import { badRequest, forbidden, notFound } from "@/server/http";
import { audit } from "@/server/audit";
import { encryptField, maskSensitive } from "@/server/services/tenant/crypto";
import { sendOutbound, activeAccountFor } from "./provider";

/**
 * WhatsApp core (backend only) — accounts, contacts, phone matching,
 * the 24h customer-service window, STOP opt-out and outbound recording.
 * The inbound ROUTER lives in inbound.ts (flows + AI plug in there).
 */

export const SESSION_WINDOW_HOURS = 24;
const OPT_OUT_WORDS = new Set(["stop", "unsubscribe", "end", "quit", "cancel"]);
const OPT_IN_WORDS = new Set(["start", "join", "resume"]);

// ── phone helpers ────────────────────────────────────────────────────────────

/** E.164-ish normalizer: keeps a leading + and digits. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  const plus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;
  return (plus ? "+" : "") + digits;
}

/** Match key: last 10 significant digits (Nigerian local formats fold onto E.164). */
function phoneKey(raw: string | null | undefined): string | null {
  const n = normalizePhone(raw);
  if (!n) return null;
  const digits = n.replace(/\D/g, "");
  return digits.slice(-10);
}

/** Find the org person whose phone matches (suffix-tolerant E.164 match). */
export async function matchPersonByPhone(orgId: string, phone: string) {
  const key = phoneKey(phone);
  if (!key) return null;
  const candidates = await db.person.findMany({
    where: { orgId, deletedAt: null, status: { notIn: ["archived", "deceased"] }, phone: { not: null } },
    select: { id: true, firstName: true, lastName: true, phone: true },
  });
  const hit = candidates.find((p) => phoneKey(p.phone) === key);
  return hit ?? null;
}

export function withinSessionWindow(contact: { lastInboundAt: Date | null }): boolean {
  if (!contact.lastInboundAt) return false;
  return Date.now() - contact.lastInboundAt.getTime() < SESSION_WINDOW_HOURS * 3600_000;
}

// ── accounts ─────────────────────────────────────────────────────────────────

export async function listAccounts(user: SessionUser) {
  const rows = await db.whatsAppAccount.findMany({ where: { orgId: user.orgId }, orderBy: { createdAt: "desc" } });
  return {
    items: rows.map((a) => ({
      id: a.id,
      provider: a.provider,
      phoneNumberId: a.phoneNumberId,
      displayPhoneNumber: a.displayPhoneNumber,
      businessAccountId: a.businessAccountId,
      status: a.status,
      tokenMasked: a.accessTokenEnc ? maskSensitive("token-token", 5) : null,
      hasToken: !!a.accessTokenEnc,
      webhookVerifyToken: a.webhookVerifyToken,
      webhookUrl: `/api/v1/whatsapp/webhook/${a.phoneNumberId}`,
      lastError: a.lastError,
      createdAt: a.createdAt,
    })),
  };
}

export async function connectAccount(
  user: SessionUser,
  body: {
    provider?: string;
    phoneNumberId: string;
    displayPhoneNumber?: string;
    businessAccountId?: string;
    accessToken?: string;
    appSecret?: string;
  },
  meta: { ip?: string | null; userAgent?: string | null },
) {
  if (!can(user, "admin.manage")) throw forbidden('Requires "admin.manage" permission.');
  const phoneNumberId = String(body.phoneNumberId ?? "").trim();
  if (!phoneNumberId) throw badRequest("Phone number ID is required.");
  const provider = body.provider === "meta" ? "meta" : "sandbox";
  if (provider === "meta" && !String(body.accessToken ?? "").trim()) {
    throw badRequest("Meta Cloud API accounts require a permanent access token.");
  }
  const existing = await db.whatsAppAccount.findUnique({ where: { phoneNumberId } });
  if (existing && existing.orgId !== user.orgId) throw badRequest("This phone number ID is already connected to another church.");

  const data = {
    orgId: user.orgId,
    provider,
    phoneNumberId,
    displayPhoneNumber: body.displayPhoneNumber?.trim() || null,
    businessAccountId: body.businessAccountId?.trim() || null,
    accessTokenEnc: provider === "meta" ? encryptField(String(body.accessToken)) : null,
    appSecretEnc: body.appSecret ? encryptField(String(body.appSecret)) : null,
    webhookVerifyToken: existing?.webhookVerifyToken ?? randomBytes(16).toString("hex"),
    status: "active",
    lastError: null,
  };
  const account = await db.whatsAppAccount.upsert({
    where: { phoneNumberId },
    create: data,
    update: { ...data, webhookVerifyToken: existing?.webhookVerifyToken ?? data.webhookVerifyToken },
  });
  await audit({
    orgId: user.orgId,
    actor: user,
    action: "whatsapp.account_connected",
    entityType: "whatsapp_account",
    entityId: account.id,
    after: { provider, phoneNumberId, status: account.status },
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
  return { ok: true, id: account.id, webhookVerifyToken: account.webhookVerifyToken, webhookUrl: `/api/v1/whatsapp/webhook/${phoneNumberId}` };
}

export async function disconnectAccount(user: SessionUser, id: string, meta: { ip?: string | null; userAgent?: string | null }) {
  if (!can(user, "admin.manage")) throw forbidden('Requires "admin.manage" permission.');
  const account = await db.whatsAppAccount.findFirst({ where: { id, orgId: user.orgId } });
  if (!account) throw notFound("Account not found.");
  await db.whatsAppAccount.update({ where: { id }, data: { status: "suspended" } });
  await audit({
    orgId: user.orgId,
    actor: user,
    action: "whatsapp.account_disconnected",
    entityType: "whatsapp_account",
    entityId: id,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
  return { ok: true };
}

// ── contacts & conversations ─────────────────────────────────────────────────

export async function listContacts(user: SessionUser, search?: string) {
  const where: Record<string, unknown> = { orgId: user.orgId };
  if (search?.trim()) where.phoneNumber = { contains: search.trim() };
  const rows = await db.whatsAppContact.findMany({ where, orderBy: { lastInboundAt: "desc" }, take: 500 });
  const personIds = [...new Set(rows.map((r) => r.personId).filter(Boolean))] as string[];
  const people = personIds.length ? await db.person.findMany({ where: { id: { in: personIds } } }) : [];
  const pMap = new Map(people.map((p) => [p.id, `${p.firstName} ${p.lastName}`]));
  return {
    items: rows.map((c) => ({
      id: c.id,
      phoneNumber: c.phoneNumber,
      displayName: c.displayName,
      personId: c.personId,
      personName: c.personId ? pMap.get(c.personId) ?? null : null,
      optedIn: c.optedIn,
      onboardState: c.onboardState,
      withinWindow: withinSessionWindow(c),
      lastInboundAt: c.lastInboundAt,
      createdAt: c.createdAt,
    })),
  };
}

export async function linkContact(user: SessionUser, id: string, personId: string | null) {
  if (!can(user, "people.view")) throw forbidden('Requires "people.view" permission.');
  const contact = await db.whatsAppContact.findFirst({ where: { id, orgId: user.orgId } });
  if (!contact) throw notFound("Contact not found.");
  if (personId) {
    const person = await db.person.findFirst({ where: { id: personId, orgId: user.orgId, deletedAt: null } });
    if (!person) throw badRequest("Person not found in this church.");
  }
  await db.whatsAppContact.update({ where: { id }, data: { personId, onboardState: null } });
  await audit({
    orgId: user.orgId,
    actor: user,
    action: "whatsapp.contact_linked",
    entityType: "whatsapp_contact",
    entityId: id,
    after: { personId },
  });
  return { ok: true };
}

/** Conversation list for the Inbox: contacts joined with their latest message. */
export async function listConversations(user: SessionUser) {
  const contacts = await listContacts(user);
  const latest = await db.whatsAppMessage.findMany({
    where: { orgId: user.orgId },
    orderBy: { createdAt: "desc" },
    take: 2000,
  });
  const byContact = new Map<string, (typeof latest)[number]>();
  for (const m of latest) if (!byContact.has(m.contactId)) byContact.set(m.contactId, m);
  return {
    items: contacts.items
      .map((c) => {
        const last = byContact.get(c.id);
        return {
          ...c,
          lastMessage: last ? { direction: last.direction, content: last.content?.slice(0, 120), status: last.status, messageType: last.messageType, createdAt: last.createdAt } : null,
        };
      })
      .sort((a, b) => (b.lastMessage?.createdAt?.getTime() ?? 0) - (a.lastMessage?.createdAt?.getTime() ?? 0)),
  };
}

export async function listMessages(user: SessionUser, contactId: string) {
  const contact = await db.whatsAppContact.findFirst({ where: { id: contactId, orgId: user.orgId } });
  if (!contact) throw notFound("Contact not found.");
  const rows = await db.whatsAppMessage.findMany({
    where: { orgId: user.orgId, contactId },
    orderBy: { createdAt: "asc" },
    take: 500,
  });
  return {
    contact: {
      id: contact.id,
      phoneNumber: contact.phoneNumber,
      personId: contact.personId,
      optedIn: contact.optedIn,
      withinWindow: withinSessionWindow(contact),
      lastInboundAt: contact.lastInboundAt,
    },
    items: rows.map((m) => ({
      id: m.id,
      direction: m.direction,
      messageType: m.messageType,
      content: m.content,
      templateName: m.templateName,
      status: m.status,
      errorReason: m.errorReason,
      createdAt: m.createdAt,
    })),
  };
}

// ── outbound (policy layer) ──────────────────────────────────────────────────

export interface OutboundMeta {
  broadcastId?: string;
  flowRunId?: string;
  source?: string;
}

/**
 * Free-form session message — only inside the 24h customer-service window
 * (Meta policy). Returns { skipped, reason } instead of throwing so bulk
 * callers (broadcasts/flows) can count skips.
 */
export async function sendSessionText(
  account: NonNullable<Awaited<ReturnType<typeof activeAccountFor>>>,
  contact: { id: string; orgId: string; phoneNumber: string; lastInboundAt: Date | null; optedIn: boolean },
  text: string,
  meta: OutboundMeta = {},
) {
  if (!contact.optedIn) return { skipped: true as const, reason: "not_opted_in" };
  if (!withinSessionWindow(contact)) return { skipped: true as const, reason: "outside_24h_window" };
  const res = await sendOutbound(account, { to: contact.phoneNumber, kind: "text", text });
  await db.whatsAppMessage.create({
    data: {
      orgId: contact.orgId,
      contactId: contact.id,
      direction: "outbound",
      messageType: "text",
      content: text.slice(0, 4000),
      status: res.status === "sent" ? "delivered" : "failed",
      waMessageId: res.waMessageId || null,
      errorReason: res.error ?? null,
      metaJson: JSON.stringify(meta),
    },
  });
  return { skipped: false as const, status: res.status, error: res.error };
}

/**
 * Template message — allowed outside the 24h window, but ONLY when the
 * template row is Meta-approved ("approved" status). This is the acceptance
 * gate: unapproved templates are not sendable, full stop.
 */
export async function sendTemplateMessage(
  account: NonNullable<Awaited<ReturnType<typeof activeAccountFor>>>,
  contact: { id: string; orgId: string; phoneNumber: string; optedIn: boolean },
  template: { id: string; name: string; language: string; status: string; body: string },
  vars: string[],
  meta: OutboundMeta = {},
) {
  if (template.status !== "approved") return { skipped: true as const, reason: "template_not_approved" };
  if (!contact.optedIn) return { skipped: true as const, reason: "not_opted_in" };
  const rendered = renderTemplate(template.body, vars);
  const res = await sendOutbound(account, {
    to: contact.phoneNumber,
    kind: "template",
    templateName: template.name,
    templateLanguage: template.language,
    templateVars: vars,
    text: rendered,
  });
  await db.whatsAppMessage.create({
    data: {
      orgId: contact.orgId,
      contactId: contact.id,
      direction: "outbound",
      messageType: "template",
      content: rendered,
      templateName: template.name,
      status: res.status === "sent" ? "delivered" : "failed",
      waMessageId: res.waMessageId || null,
      errorReason: res.error ?? null,
      metaJson: JSON.stringify(meta),
    },
  });
  return { skipped: false as const, status: res.status, error: res.error };
}

/** Positional {{1}}..{{n}} placeholder rendering (WhatsApp template convention). */
export function renderTemplate(body: string, vars: string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (_m, i) => vars[Number(i) - 1] ?? "");
}

/** Staff manual reply from the Inbox — free-form or a chosen template. */
export async function sendReply(
  user: SessionUser,
  body: { contactId: string; text?: string; templateId?: string; vars?: string[] },
  meta: { ip?: string | null; userAgent?: string | null },
) {
  if (!canSendChannel(user, "whatsapp")) throw forbidden('Requires "comms.whatsapp.send" (or legacy "comms.send") permission.');
  const account = await activeAccountFor(user.orgId);
  if (!account) throw badRequest("WhatsApp is not connected yet — connect a number in Settings first.");
  const contact = await db.whatsAppContact.findFirst({ where: { id: body.contactId, orgId: user.orgId } });
  if (!contact) throw notFound("Contact not found.");

  if (body.templateId) {
    const tpl = await db.whatsAppTemplate.findFirst({ where: { id: body.templateId, orgId: user.orgId } });
    if (!tpl) throw notFound("Template not found.");
    const res = await sendTemplateMessage(account, contact, tpl, (body.vars ?? []).map(String), { source: "inbox" });
    if (res.skipped) throw badRequest(res.reason === "template_not_approved" ? "Template is not Meta-approved yet." : "Contact has opted out of WhatsApp.");
    return { ok: true, mode: "template" };
  }

  const text = String(body.text ?? "").trim();
  if (!text) throw badRequest("Message cannot be empty.");
  const res = await sendSessionText(account, contact, text.slice(0, 4000), { source: "inbox" });
  if (res.skipped) {
    throw badRequest(
      res.reason === "outside_24h_window"
        ? "The 24-hour customer-service window is closed — send an approved template instead (Meta policy)."
        : "Contact has opted out of WhatsApp.",
    );
  }
  return { ok: true, mode: "text" };
}

// ── inbound recording + opt-out ──────────────────────────────────────────────

export async function ensureContact(orgId: string, phone: string, profileName?: string | null) {
  const normalized = normalizePhone(phone) ?? phone;
  const existing = await db.whatsAppContact.findUnique({ where: { orgId_phoneNumber: { orgId, phoneNumber: normalized } } });
  if (existing) {
    if (profileName && !existing.displayName) {
      return db.whatsAppContact.update({ where: { id: existing.id }, data: { displayName: profileName } });
    }
    return existing;
  }
  const matched = await matchPersonByPhone(orgId, normalized);
  return db.whatsAppContact.create({
    data: {
      orgId,
      phoneNumber: normalized,
      personId: matched?.id ?? null,
      displayName: profileName ?? null,
      // auto-opt-in when the number belongs to a known member; unknown numbers
      // opt in implicitly by messaging us (Meta requires an opt-out path — STOP)
      optedIn: true,
      optedInAt: new Date(),
    },
  });
}

export async function recordInbound(orgId: string, contactId: string, text: string, waMessageId?: string | null, messageType = "text") {
  const [message] = await Promise.all([
    db.whatsAppMessage.create({
      data: {
        orgId,
        contactId,
        direction: "inbound",
        messageType,
        content: text.slice(0, 4000),
        status: "received",
        waMessageId: waMessageId ?? null,
      },
    }),
    db.whatsAppContact.update({ where: { id: contactId }, data: { lastInboundAt: new Date() } }),
  ]);
  return message;
}

export function isOptOutWord(text: string) {
  return OPT_OUT_WORDS.has(text.trim().toLowerCase());
}
export function isOptInWord(text: string) {
  return OPT_IN_WORDS.has(text.trim().toLowerCase());
}

export async function optOut(orgId: string, contactId: string) {
  return db.whatsAppContact.update({
    where: { id: contactId },
    data: { optedIn: false, optedOutAt: new Date(), onboardState: null },
  });
}

export async function optIn(orgId: string, contactId: string) {
  return db.whatsAppContact.update({
    where: { id: contactId },
    data: { optedIn: true, optedInAt: new Date(), optedOutAt: null },
  });
}

// ── onboarding: name-collection for unknown numbers ──────────────────────────

export const ONBOARD_WELCOME =
  "👋 Welcome to our church on WhatsApp! We don't recognize this number yet — reply with your full name and we'll connect you to your church profile.";

/** Start the name-collection onboarding for an unmatched contact. */
export async function startOnboarding(account: NonNullable<Awaited<ReturnType<typeof activeAccountFor>>>, contact: { id: string; orgId: string; phoneNumber: string; personId: string | null; optedIn: boolean; lastInboundAt: Date | null }) {
  if (contact.personId) return false;
  await db.whatsAppContact.update({ where: { id: contact.id }, data: { onboardState: "awaiting_name" } });
  await sendSessionText(account, contact, ONBOARD_WELCOME, { source: "onboarding" });
  return true;
}

/** Handle "reply with your full name" — match, or create a guest record. */
export async function handleNameReply(
  account: NonNullable<Awaited<ReturnType<typeof activeAccountFor>>>,
  contact: { id: string; orgId: string; phoneNumber: string; optedIn: boolean; lastInboundAt: Date | null },
  text: string,
) {
  const cleaned = text.replace(/[^a-zA-Z' \-]/g, " ").replace(/\s+/g, " ").trim();
  const parts = cleaned.split(" ").filter(Boolean);
  // a name is 2–3 words — anything longer is a sentence, not a name
  if (parts.length < 2 || parts.length > 3 || cleaned.length < 4) {
    await sendSessionText(account, contact, "Please reply with just your first and last name (e.g. “Grace Okonkwo”) so we can find you.", { source: "onboarding" });
    return { matched: null, created: false };
  }

  const [first, ...rest] = parts;
  const last = rest.join(" ");
  const people = await db.person.findMany({
    where: {
      orgId: contact.orgId,
      deletedAt: null,
      status: { notIn: ["archived", "deceased"] },
      OR: [
        { AND: [{ firstName: { equals: first, }, lastName: { equals: last } }] },
        { AND: [{ firstName: { equals: last }, lastName: { equals: first } }] },
      ],
    },
    take: 5,
  });

  if (people.length === 1) {
    const person = people[0];
    await db.whatsAppContact.update({ where: { id: contact.id }, data: { personId: person.id, onboardState: null } });
    await sendSessionText(account, contact, `✅ You're connected, ${person.firstName}! You'll now receive church updates here. Reply STOP anytime to opt out.`, { source: "onboarding" });
    await audit({
      orgId: contact.orgId,
      actorType: "system",
      actorLabel: "whatsapp",
      action: "whatsapp.contact_matched",
      entityType: "whatsapp_contact",
      entityId: contact.id,
      after: { personId: person.id, phone: maskSensitive(contact.phoneNumber, 4) },
    });
    return { matched: person.id, created: false };
  }

  if (people.length > 1) {
    await sendSessionText(
      account,
      contact,
      `We found ${people.length} people with that name. Reply with your full name plus your phone number's last 4 digits (e.g. “${cleaned} 1234”) and we'll match you manually.`,
      { source: "onboarding" },
    );
    return { matched: null, created: false };
  }

  // no match — create a guest person record so engagement is not lost
  const person = await db.person.create({
    data: {
      orgId: contact.orgId,
      firstName: first,
      lastName: last,
      phone: contact.phoneNumber,
      lifecycleStage: "guest",
      status: "active",
    },
  });
  await db.whatsAppContact.update({ where: { id: contact.id }, data: { personId: person.id, onboardState: null } });
  await sendSessionText(account, contact, `Welcome, ${person.firstName}! 🎉 We've created your guest profile — a team member will follow up soon. Reply STOP anytime to opt out.`, { source: "onboarding" });
  await audit({
    orgId: contact.orgId,
    actorType: "system",
    actorLabel: "whatsapp",
    action: "whatsapp.guest_created",
    entityType: "person",
    entityId: person.id,
    after: { name: `${person.firstName} ${person.lastName}`, source: "whatsapp_onboarding" },
  });
  return { matched: person.id, created: true };
}
