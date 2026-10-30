import { db } from "@/server/db";
import { audit, j } from "@/server/audit";
import { badRequest, forbidden, notFound } from "@/server/http";
import { canSendChannel, CHANNEL_SEND_PERMISSION, type SessionUser } from "@/server/permissions";

/**
 * Communications service (backend only — no HTTP, no React).
 * Business rules honored:
 *  • audience resolution = people in org, not deleted/archived/deceased,
 *    not do_not_contact, opted-in per (channel, consent category), with
 *    optional stage/group/tag narrowing; deduped by personId
 *  • sending is a local simulation (no real email/SMS leaves the machine)
 *  • SMS quiet hours (21:00–08:00 UTC) are allowed but flagged in the response
 *  • consent ledger: newest state wins
 */

export interface Segment {
  stage?: string[];
  groupIds?: string[];
  tagIds?: string[];
  consentCategory?: string;
}

function isDoNotContact(person: { custom: string | null }): boolean {
  const custom = j<{ do_not_contact?: boolean }>(person.custom, {});
  return custom.do_not_contact === true;
}

/** Resolve an audience segment to distinct, contactable, consenting people. */
export async function resolveAudience(orgId: string, channel: string, segment: Segment) {
  const category = segment.consentCategory || "operational";

  // consent first (cheap) — only people with an opted-in preference row qualify
  const prefs = await db.communicationPreference.findMany({
    where: { orgId, channel, category, optedIn: true },
    select: { personId: true },
  });
  const optedIn = new Set(prefs.map((p) => p.personId));
  if (!optedIn.size) return [];

  // optional narrowing by group membership
  let ids: Set<string> | null = null;
  if (segment.groupIds?.length) {
    const members = await db.groupMember.findMany({
      where: { orgId, groupId: { in: segment.groupIds }, status: "active" },
      select: { personId: true },
    });
    ids = new Set(members.map((m) => m.personId));
    if (!ids.size) return [];
  }
  // optional narrowing by tag
  if (segment.tagIds?.length) {
    const tagged = await db.personTag.findMany({ where: { tagId: { in: segment.tagIds } }, select: { personId: true } });
    const tagSet = new Set(tagged.map((t) => t.personId));
    ids = ids ? new Set([...ids].filter((id) => tagSet.has(id))) : tagSet;
    if (!ids.size) return [];
  }

  const people = await db.person.findMany({
    where: {
      orgId,
      deletedAt: null,
      status: { notIn: ["archived", "deceased"] },
      ...(segment.stage?.length ? { lifecycleStage: { in: segment.stage } } : {}),
      ...(ids ? { id: { in: [...ids] } } : {}),
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });

  // consent + do-not-contact + addressability + dedupe by personId
  const seen = new Set<string>();
  return people.filter((p) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return optedIn.has(p.id) && !isDoNotContact(p) && (channel === "sms" ? !!p.phone : !!p.email);
  });
}

function messageAddress(p: { email: string | null; phone: string | null }, channel: string): string {
  return channel === "sms" ? p.phone ?? "" : p.email ?? "";
}

async function messageStats(orgId: string, messageIds: string[]) {
  const agg = messageIds.length
    ? await db.messageRecipient.groupBy({
        by: ["messageId", "status"],
        where: { orgId, messageId: { in: messageIds } },
        _count: true,
        _sum: { costCents: true },
      })
    : [];
  const stats: Record<string, { total: number; delivered: number; bounced: number; failed: number; costCents: number }> = {};
  for (const row of agg as any[]) {
    stats[row.messageId] ??= { total: 0, delivered: 0, bounced: 0, failed: 0, costCents: 0 };
    const s = stats[row.messageId];
    s.total += row._count;
    if (row.status === "delivered") s.delivered += row._count;
    if (row.status === "bounced") s.bounced += row._count;
    if (row.status === "failed") s.failed += row._count;
    s.costCents += row._sum.costCents ?? 0;
  }
  return stats;
}

function toMessageDTO(m: any, stats: { total: number; delivered: number; bounced: number; failed: number; costCents: number }) {
  return {
    id: m.id,
    channel: m.channel,
    subject: m.subject,
    bodyText: m.bodyText,
    status: m.status,
    audience: j(m.audience, {}),
    scheduledAt: m.scheduledAt,
    sentAt: m.sentAt,
    recipientCount: stats?.total ?? 0,
    deliveredCount: stats?.delivered ?? 0,
    bouncedCount: stats?.bounced ?? 0,
    failedCount: stats?.failed ?? 0,
    createdByName: m.createdByName,
    ...(m.channel === "sms" ? { costCents: stats?.costCents ?? 0 } : {}),
  };
}

export async function listMessages(user: SessionUser) {
  const messages = await db.message.findMany({
    where: { orgId: user.orgId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: 60,
  });
  const stats = await messageStats(user.orgId, messages.map((m) => m.id));
  return { items: messages.map((m) => toMessageDTO(m, stats[m.id])) };
}

export async function getMessage(user: SessionUser, id: string) {
  const message = await db.message.findFirst({ where: { id, orgId: user.orgId, deletedAt: null } });
  if (!message) throw notFound("Message not found.");
  const recipients = await db.messageRecipient.findMany({ where: { messageId: message.id }, orderBy: { id: "asc" } });
  const personIds = [...new Set(recipients.map((r) => r.personId))];
  const people = personIds.length ? await db.person.findMany({ where: { id: { in: personIds } } }) : [];
  const pMap = new Map(people.map((p) => [p.id, p] as const));
  const stats = (await messageStats(user.orgId, [message.id]))[message.id] ?? { total: 0, delivered: 0, bounced: 0, failed: 0, costCents: 0 };
  return {
    message: toMessageDTO(message, stats),
    recipients: recipients.map((r) => {
      const p = pMap.get(r.personId);
      return {
        personId: r.personId,
        name: p ? `${p.firstName} ${p.lastName}` : "Unknown",
        address: r.address,
        status: r.status,
        sentAt: r.sentAt,
        error: r.errorCode,
      };
    }),
  };
}

export async function createMessage(user: SessionUser, input: any, meta: { ip?: string; userAgent?: string }) {
  const channel = input?.channel;
  if (!["email", "sms"].includes(channel)) throw badRequest('channel must be "email" or "sms".');
  // STRICT channel gating: SMS and Email each require their own permission.
  if (!canSendChannel(user, channel)) {
    throw forbidden(`Sending ${channel.toUpperCase()} requires the "${CHANNEL_SEND_PERMISSION[channel]}" permission.`);
  }
  if (!input?.bodyText?.trim() && !input?.bodyHtml?.trim()) throw badRequest("bodyText (or bodyHtml) is required.");
  const segment: Segment = input.audience?.segment ?? {};

  const recipients = await resolveAudience(user.orgId, channel, segment);
  const audienceJson = JSON.stringify({ segment, resolvedCount: recipients.length });
  const message = await db.message.create({
    data: {
      orgId: user.orgId,
      channel,
      subject: input.subject || null,
      bodyText: input.bodyText || null,
      bodyHtml: input.bodyHtml || null,
      fromName: input.fromName || user.orgName,
      audience: audienceJson,
      scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
      status: input.scheduledAt ? "scheduled" : "draft",
      createdByName: user.name,
    },
  });
  if (recipients.length) {
    await db.messageRecipient.createMany({
      data: recipients.map((p) => ({
        orgId: user.orgId,
        messageId: message.id,
        personId: p.id,
        address: messageAddress(p, channel),
        status: "queued",
      })),
    });
  }
  await audit({
    orgId: user.orgId, actor: user, action: "message.create", entityType: "message", entityId: message.id,
    after: { channel, recipients: recipients.length }, ip: meta.ip, userAgent: meta.userAgent,
  });
  // SMS cost estimate: 1 kobo per recipient (demo pricing)
  const dto: any = toMessageDTO(message, { total: recipients.length, delivered: 0, bounced: 0, failed: 0, costCents: 0 });
  if (channel === "sms") dto.costCents = recipients.length * 1;
  return dto;
}

export async function sendMessage(user: SessionUser, id: string, meta: { ip?: string; userAgent?: string }) {
  const message = await db.message.findFirst({ where: { id, orgId: user.orgId, deletedAt: null } });
  if (!message) throw notFound("Message not found.");
  if (message.status === "sent") throw badRequest("Message has already been sent.");
  if (!canSendChannel(user, message.channel)) {
    throw forbidden(`Sending ${message.channel.toUpperCase()} requires the "${CHANNEL_SEND_PERMISSION[message.channel]}" permission.`);
  }

  const queued = await db.messageRecipient.findMany({ where: { messageId: message.id, status: "queued" } });
  // simulated delivery: 92% delivered / 4% sent / 2% bounced, 2% failed
  const buckets: Record<string, string[]> = { delivered: [], sent: [], bounced: [], failed: [] };
  for (const r of queued) {
    const roll = Math.random();
    const status = roll < 0.92 ? "delivered" : roll < 0.96 ? "sent" : roll < 0.98 ? "bounced" : "failed";
    buckets[status].push(r.id);
  }
  const now = new Date();
  for (const [status, ids] of Object.entries(buckets)) {
    if (!ids.length) continue;
    await db.messageRecipient.updateMany({
      where: { id: { in: ids } },
      data: {
        status,
        sentAt: now,
        deliveredAt: status === "delivered" ? now : null,
        costCents: message.channel === "sms" ? 1 : 0,
        errorCode: status === "bounced" ? "551: mailbox unavailable" : status === "failed" ? "timeout" : null,
      },
    });
  }
  const updated = await db.message.update({ where: { id: message.id }, data: { status: "sent", sentAt: now } });
  await audit({
    orgId: user.orgId, actor: user, action: "message.send", entityType: "message", entityId: message.id,
    after: { recipients: queued.length, channel: message.channel }, ip: meta.ip, userAgent: meta.userAgent,
  });

  // quiet hours (UTC): 21:00–08:00 — sending is allowed but flagged
  const hour = now.getUTCHours();
  const warning =
    message.channel === "sms" && (hour >= 21 || hour < 8)
      ? "Quiet hours (21:00–08:00 UTC): SMS sent during quiet hours — consider scheduling."
      : undefined;
  const stats = (await messageStats(user.orgId, [message.id]))[message.id] ?? { total: queued.length, delivered: 0, bounced: 0, failed: 0, costCents: 0 };
  const dto: any = toMessageDTO(updated, stats);
  if (warning) dto.warning = warning;
  return dto;
}

export async function cancelMessage(user: SessionUser, id: string, meta: { ip?: string; userAgent?: string }) {
  const message = await db.message.findFirst({ where: { id, orgId: user.orgId, deletedAt: null } });
  if (!message) throw notFound("Message not found.");
  if (message.status === "sent") throw badRequest("A sent message cannot be canceled.");
  if (!canSendChannel(user, message.channel)) {
    throw forbidden(`Managing ${message.channel.toUpperCase()} sends requires the "${CHANNEL_SEND_PERMISSION[message.channel]}" permission.`);
  }
  await db.message.update({ where: { id: message.id }, data: { deletedAt: new Date() } });
  await audit({
    orgId: user.orgId, actor: user, action: "message.cancel", entityType: "message", entityId: message.id,
    after: { canceled: true }, ip: meta.ip, userAgent: meta.userAgent,
  });
  return { ok: true };
}

export async function previewSegment(user: SessionUser, q: { stage?: string; groupIds?: string; tagIds?: string; consentCategory?: string; channel?: string }) {
  const segment: Segment = {
    stage: q.stage ? q.stage.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
    groupIds: q.groupIds ? q.groupIds.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
    tagIds: q.tagIds ? q.tagIds.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
    consentCategory: q.consentCategory || undefined,
  };
  const people = await resolveAudience(user.orgId, q.channel || "email", segment);
  return {
    count: people.length,
    sample: people.slice(0, 5).map((p) => ({ name: `${p.firstName} ${p.lastName}` })),
  };
}

// ── consent ledger ───────────────────────────────────────────────────────────

export async function listConsent(user: SessionUser, search?: string) {
  const where: any = { orgId: user.orgId, deletedAt: null, status: { notIn: ["archived", "deceased"] } };
  if (search?.trim()) {
    const s = search.trim();
    where.OR = [{ firstName: { contains: s } }, { lastName: { contains: s } }, { email: { contains: s } }];
  }
  const people = await db.person.findMany({ where, orderBy: [{ lastName: "asc" }, { firstName: "asc" }], take: 50 });
  const prefs = people.length
    ? await db.communicationPreference.findMany({ where: { orgId: user.orgId, personId: { in: people.map((p) => p.id) } } })
    : [];
  const byPerson = new Map<string, any[]>();
  for (const pref of prefs) {
    byPerson.set(pref.personId, [...(byPerson.get(pref.personId) ?? []), pref]);
  }
  return {
    items: people.map((p) => ({
      personId: p.id,
      name: `${p.firstName} ${p.lastName}`,
      email: p.email,
      phone: p.phone,
      prefs: (byPerson.get(p.id) ?? []).map((pref) => ({
        channel: pref.channel,
        category: pref.category,
        optedIn: pref.optedIn,
        source: pref.source,
        updatedAt: pref.updatedAt,
      })),
    })),
  };
}

export async function updateConsent(user: SessionUser, input: any, meta: { ip?: string; userAgent?: string }) {
  const { personId, channel, category, optedIn } = input ?? {};
  if (!personId || !channel || typeof optedIn !== "boolean") {
    throw badRequest("personId, channel and optedIn are required.");
  }
  const person = await db.person.findFirst({ where: { id: personId, orgId: user.orgId, deletedAt: null } });
  if (!person) throw notFound("Person not found.");
  await db.communicationPreference.upsert({
    where: { personId_channel_category: { personId, channel, category: category || "operational" } },
    create: {
      orgId: user.orgId, personId, channel,
      category: category || "operational", optedIn,
      source: input.source || "staff_update",
    },
    update: { optedIn, source: input.source || "staff_update" }, // append semantics: newest state wins
  });
  await audit({
    orgId: user.orgId, actor: user, action: "consent.update", entityType: "person", entityId: personId,
    after: { channel, category: category || "operational", optedIn }, ip: meta.ip, userAgent: meta.userAgent,
  });
  return { ok: true };
}
