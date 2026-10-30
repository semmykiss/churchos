import { db } from "@/server/db";
import { can, type SessionUser } from "@/server/permissions";
import { badRequest, forbidden, notFound } from "@/server/http";
import { audit, j } from "@/server/audit";
import { activeAccountFor, submitTemplateToMeta } from "./provider";
import { sendTemplateMessage, renderTemplate } from "./core";

/**
 * WhatsApp templates + broadcasts (backend only).
 * Templates are gated on Meta approval; broadcasts reuse the People module's
 * audience segment semantics (stage / groups / tags) intersected with the
 * WhatsApp opt-in ledger — the channel-native consent source.
 */

// ── templates ────────────────────────────────────────────────────────────────

export async function listTemplates(user: SessionUser) {
  const rows = await db.whatsAppTemplate.findMany({ where: { orgId: user.orgId }, orderBy: { updatedAt: "desc" } });
  return {
    items: rows.map((t) => ({
      id: t.id,
      name: t.name,
      language: t.language,
      category: t.category,
      body: t.body,
      variables: j<string[]>(t.variablesJson, []),
      status: t.status,
      statusInfo: t.statusInfo,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    })),
  };
}

export async function saveTemplate(
  user: SessionUser,
  body: { id?: string; name: string; category?: string; language?: string; body: string; variables?: string[] },
  meta: { ip?: string | null; userAgent?: string | null },
) {
  if (!can(user, "comms.whatsapp.send") && !can(user, "comms.send")) throw forbidden('Requires "comms.whatsapp.send" permission.');
  const name = String(body.name ?? "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
  if (!name) throw badRequest("Template name is required (lowercase_with_underscores).");
  const text = String(body.body ?? "").trim();
  if (!text) throw badRequest("Template body is required.");
  if (text.length > 1024) throw badRequest("Template body is limited to 1024 characters (Meta limit).");
  const varsInBody = [...text.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
  const maxVar = varsInBody.length ? Math.max(...varsInBody) : 0;
  const labels = (body.variables ?? []).map(String);
  const data = {
    orgId: user.orgId,
    name,
    category: ["utility", "marketing", "authentication"].includes(String(body.category)) ? String(body.category) : "utility",
    language: String(body.language ?? "en").trim() || "en",
    body: text,
    variablesJson: JSON.stringify(Array.from({ length: maxVar }, (_, i) => labels[i] ?? `Variable ${i + 1}`)),
  };
  const template = body.id
    ? await db.whatsAppTemplate.update({ where: { id: body.id }, data: { ...data, status: "draft", statusInfo: "Edited — resubmit for approval." } }).catch(() => null)
    : await db.whatsAppTemplate.create({ data });
  if (!template) throw notFound("Template not found.");
  await audit({
    orgId: user.orgId,
    actor: user,
    action: body.id ? "whatsapp.template_updated" : "whatsapp.template_created",
    entityType: "whatsapp_template",
    entityId: template.id,
    after: { name, category: data.category },
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
  return { ok: true, id: template.id };
}

export async function submitTemplate(user: SessionUser, id: string) {
  if (!can(user, "comms.whatsapp.send") && !can(user, "comms.send")) throw forbidden('Requires "comms.whatsapp.send" permission.');
  const template = await db.whatsAppTemplate.findFirst({ where: { id, orgId: user.orgId } });
  if (!template) throw notFound("Template not found.");
  const account = await activeAccountFor(user.orgId);
  if (!account) throw badRequest("Connect a WhatsApp number first (Settings).");
  const res = await submitTemplateToMeta(account, { name: template.name, category: template.category, body: template.body, language: template.language });
  if (!res.ok) throw badRequest(`Meta submission failed: ${res.info}`);
  await db.whatsAppTemplate.update({ where: { id }, data: { status: "pending", statusInfo: res.info ?? null } });
  await audit({ orgId: user.orgId, actor: user, action: "whatsapp.template_submitted", entityType: "whatsapp_template", entityId: id });
  return { ok: true, info: res.info };
}

/** Sandbox/dev action — mirrors Meta's manual review granting approval. */
export async function approveTemplate(user: SessionUser, id: string) {
  if (!can(user, "comms.whatsapp.send") && !can(user, "comms.send")) throw forbidden('Requires "comms.whatsapp.send" permission.');
  const template = await db.whatsAppTemplate.findFirst({ where: { id, orgId: user.orgId } });
  if (!template) throw notFound("Template not found.");
  const account = await activeAccountFor(user.orgId);
  if (account?.provider !== "sandbox") throw badRequest("Approval is granted by Meta review for live accounts.");
  await db.whatsAppTemplate.update({ where: { id }, data: { status: "approved", statusInfo: "Approved (sandbox review)." } });
  await audit({ orgId: user.orgId, actor: user, action: "whatsapp.template_approved", entityType: "whatsapp_template", entityId: id, after: { sandbox: true } });
  return { ok: true };
}

export async function deleteTemplate(user: SessionUser, id: string) {
  if (!can(user, "comms.whatsapp.send") && !can(user, "comms.send")) throw forbidden('Requires "comms.whatsapp.send" permission.');
  const template = await db.whatsAppTemplate.findFirst({ where: { id, orgId: user.orgId } });
  if (!template) throw notFound("Template not found.");
  const inUse = await db.whatsAppFlow.count({ where: { orgId: user.orgId, stepsJson: { contains: template.name } } });
  if (inUse > 0) throw badRequest(`This template is referenced by ${inUse} flow(s).`);
  await db.whatsAppTemplate.delete({ where: { id } });
  return { ok: true };
}

// ── audience (People segment semantics ∩ WhatsApp opt-in) ────────────────────

export interface AudienceSegment {
  stage?: string[];
  groupIds?: string[];
  tagIds?: string[];
}

export async function resolveWhatsAppAudience(orgId: string, segment: AudienceSegment) {
  // same narrowing order as Communications' resolveAudience — stage → groups → tags
  let ids: Set<string> | null = null;
  if (segment.groupIds?.length) {
    const members = await db.groupMember.findMany({ where: { orgId, groupId: { in: segment.groupIds }, status: "active" }, select: { personId: true } });
    ids = new Set(members.map((m) => m.personId));
    if (!ids.size) return [];
  }
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
    select: { id: true, firstName: true, lastName: true, lifecycleStage: true },
  });
  const contacts = await db.whatsAppContact.findMany({ where: { orgId, personId: { in: people.map((p) => p.id) }, optedIn: true } });
  const optedIn = new Set(contacts.map((c) => c.personId));
  return people.filter((p) => optedIn.has(p.id));
}

export async function previewAudience(user: SessionUser, body: AudienceSegment) {
  if (!can(user, "comms.view")) throw forbidden('Requires "comms.view" permission.');
  const people = await resolveWhatsAppAudience(user.orgId, body);
  return {
    count: people.length,
    sample: people.slice(0, 8).map((p) => ({ name: `${p.firstName} ${p.lastName}`, stage: p.lifecycleStage })),
  };
}

// ── broadcasts ───────────────────────────────────────────────────────────────

export async function listBroadcasts(user: SessionUser) {
  const rows = await db.whatsAppBroadcast.findMany({ where: { orgId: user.orgId }, orderBy: { createdAt: "desc" } });
  const templateIds = [...new Set(rows.map((r) => r.templateId).filter(Boolean))] as string[];
  const templates = templateIds.length ? await db.whatsAppTemplate.findMany({ where: { id: { in: templateIds } } }) : [];
  const tMap = new Map(templates.map((t) => [t.id, t.name]));
  return {
    items: rows.map((b) => ({
      id: b.id,
      name: b.name,
      templateId: b.templateId,
      templateName: b.templateId ? tMap.get(b.templateId) ?? null : null,
      audience: j<AudienceSegment>(b.audienceFilterJson, {}),
      scheduledAt: b.scheduledAt,
      status: b.status,
      sentCount: b.sentCount,
      failedCount: b.failedCount,
      skippedCount: b.skippedCount,
      createdByName: b.createdByName,
      sentAt: b.sentAt,
      createdAt: b.createdAt,
    })),
  };
}

export async function saveBroadcast(
  user: SessionUser,
  body: { id?: string; name: string; templateId: string; audience: AudienceSegment; scheduledAt?: string | null },
  meta: { ip?: string | null; userAgent?: string | null },
) {
  if (!can(user, "comms.whatsapp.send") && !can(user, "comms.send")) throw forbidden('Requires "comms.whatsapp.send" permission.');
  const name = String(body.name ?? "").trim();
  if (!name) throw badRequest("Broadcast name is required.");
  const template = await db.whatsAppTemplate.findFirst({ where: { id: body.templateId, orgId: user.orgId } });
  if (!template) throw badRequest("Pick a template for this broadcast.");
  const data = {
    orgId: user.orgId,
    name,
    templateId: template.id,
    audienceFilterJson: JSON.stringify({
      stage: (body.audience?.stage ?? []).map(String),
      groupIds: (body.audience?.groupIds ?? []).map(String),
      tagIds: (body.audience?.tagIds ?? []).map(String),
    }),
    scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : null,
    status: body.scheduledAt ? "scheduled" : "draft",
  };
  const broadcast = body.id
    ? await db.whatsAppBroadcast.update({ where: { id: body.id }, data }).catch(() => null)
    : await db.whatsAppBroadcast.create({ data: { ...data, createdByMembershipId: user.membershipId || null, createdByName: user.name } });
  if (!broadcast) throw notFound("Broadcast not found.");
  await audit({
    orgId: user.orgId,
    actor: user,
    action: body.id ? "whatsapp.broadcast_updated" : "whatsapp.broadcast_created",
    entityType: "whatsapp_broadcast",
    entityId: broadcast.id,
    after: { name, template: template.name, scheduled: !!body.scheduledAt },
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
  return { ok: true, id: broadcast.id };
}

/** Send (or immediately send a scheduled) broadcast through the provider. */
export async function sendBroadcast(user: SessionUser, id: string, meta: { ip?: string | null; userAgent?: string | null }) {
  if (!can(user, "comms.whatsapp.send") && !can(user, "comms.send")) throw forbidden('Requires "comms.whatsapp.send" permission.');
  const broadcast = await db.whatsAppBroadcast.findFirst({ where: { id, orgId: user.orgId } });
  if (!broadcast) throw notFound("Broadcast not found.");
  if (broadcast.status === "sent") throw badRequest("This broadcast has already been sent.");
  const template = broadcast.templateId
    ? await db.whatsAppTemplate.findFirst({ where: { id: broadcast.templateId, orgId: user.orgId } })
    : null;
  if (!template) throw badRequest("Broadcast template missing.");
  if (template.status !== "approved") throw badRequest("Template is not Meta-approved yet — approval is required before sending (Meta policy).");
  const account = await activeAccountFor(user.orgId);
  if (!account) throw badRequest("WhatsApp is not connected — connect a number in Settings first.");

  const audience = await resolveWhatsAppAudience(user.orgId, j<AudienceSegment>(broadcast.audienceFilterJson, {}));
  const contactRows = await db.whatsAppContact.findMany({ where: { orgId: user.orgId, personId: { in: audience.map((p) => p.id) } } });
  const contactByPerson = new Map(contactRows.map((c) => [c.personId, c]));

  await db.whatsAppBroadcast.update({ where: { id }, data: { status: "sending" } });
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (const person of audience) {
    const contact = contactByPerson.get(person.id);
    if (!contact) {
      skipped += 1;
      continue;
    }
    try {
      const res = await sendTemplateMessage(account, contact, template, [person.firstName], { broadcastId: broadcast.id, source: "broadcast" });
      if (res.skipped) skipped += 1;
      else if (res.status === "sent") sent += 1;
      else failed += 1;
    } catch {
      failed += 1;
    }
  }
  await db.whatsAppBroadcast.update({
    where: { id },
    data: { status: "sent", sentCount: sent, failedCount: failed, skippedCount: skipped, sentAt: new Date() },
  });
  await audit({
    orgId: user.orgId,
    actor: user,
    action: "whatsapp.broadcast_sent",
    entityType: "whatsapp_broadcast",
    entityId: id,
    after: { template: template.name, sent, failed, skipped },
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
  return { ok: true, sent, failed, skipped };
}

export async function deleteBroadcast(user: SessionUser, id: string) {
  if (!can(user, "comms.whatsapp.send") && !can(user, "comms.send")) throw forbidden('Requires "comms.whatsapp.send" permission.');
  const broadcast = await db.whatsAppBroadcast.findFirst({ where: { id, orgId: user.orgId } });
  if (!broadcast) throw notFound("Broadcast not found.");
  if (broadcast.status === "sent") throw badRequest("Sent broadcasts are kept for the compliance record.");
  await db.whatsAppBroadcast.delete({ where: { id } });
  return { ok: true };
}

/** Render preview of a template body with sample vars. */
export function previewTemplate(body: string, vars: string[]) {
  return { rendered: renderTemplate(body, vars) };
}
