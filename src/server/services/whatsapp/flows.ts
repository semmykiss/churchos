import { db } from "@/server/db";
import { can, type SessionUser } from "@/server/permissions";
import { badRequest, forbidden, notFound } from "@/server/http";
import { audit, j } from "@/server/audit";
import { activeAccountFor } from "./provider";
import { sendSessionText, sendTemplateMessage, ensureContact, normalizePhone } from "./core";

/**
 * WhatsApp conversation flows (backend only) — structured multi-step
 * sequences: first-timer follow-up, event RSVP, giving nudges.
 *
 * Step kinds (stepsJson):
 *   { kind: "message", text, delayHours? }            free-form (24h window applies)
 *   { kind: "template", templateName, vars?, delayHours? }  approved template (any time)
 *   { kind: "question", key, text, choices? }         wait for a reply → context[key]
 *   { kind: "rsvp", eventId, text }                   yes/no/maybe → AttendanceRecord
 *   { kind: "give_link", fundCode?, introText? }      single-use giving deep link
 *   { kind: "assign_followup", note?, assigneeMembershipId? }  human handoff → Care
 *
 * Scheduling model: delayed steps set flowRun.nextStepAt; the scheduler
 * (tick) fires due steps. In production a worker/cron calls tick every few
 * minutes; locally the Flows screen (and inbound traffic) can run it on
 * demand. new_visitor flows auto-start from firstTime attendance records.
 */

export interface FlowStep {
  kind: "message" | "template" | "question" | "rsvp" | "give_link" | "assign_followup";
  text?: string;
  templateName?: string;
  vars?: string[];
  delayHours?: number;
  key?: string;
  choices?: string[];
  eventId?: string;
  fundCode?: string;
  introText?: string;
  note?: string;
  assigneeMembershipId?: string;
}

function parseSteps(raw: string): FlowStep[] {
  return j<FlowStep[]>(raw, []).filter((s) => s && typeof s.kind === "string");
}

// ── flow CRUD ────────────────────────────────────────────────────────────────

export async function listFlows(user: SessionUser) {
  const rows = await db.whatsAppFlow.findMany({ where: { orgId: user.orgId }, orderBy: { createdAt: "desc" } });
  const runCounts = await db.whatsAppFlowRun.groupBy({ by: ["flowId"], where: { orgId: user.orgId }, _count: { _all: true } });
  const countMap = new Map(runCounts.map((r) => [r.flowId, r._count._all]));
  return {
    items: rows.map((f) => ({
      id: f.id,
      name: f.name,
      description: f.description,
      triggerType: f.triggerType,
      eventId: f.eventId,
      steps: parseSteps(f.stepsJson),
      isActive: f.isActive,
      runCount: countMap.get(f.id) ?? 0,
      createdAt: f.createdAt,
    })),
  };
}

function validateSteps(steps: unknown): FlowStep[] {
  if (!Array.isArray(steps)) throw badRequest("Steps must be an array.");
  const clean: FlowStep[] = [];
  for (const raw of steps) {
    const s = (raw ?? {}) as FlowStep;
    if (!["message", "template", "question", "rsvp", "give_link", "assign_followup"].includes(String(s.kind))) {
      throw badRequest(`Unknown step kind "${String(s.kind)}".`);
    }
    if (s.kind === "message" && !s.text?.trim()) throw badRequest("Message steps need text.");
    if (s.kind === "template" && !s.templateName?.trim()) throw badRequest("Template steps need a template name.");
    if (s.kind === "question" && (!s.key?.trim() || !s.text?.trim())) throw badRequest("Question steps need a key and text.");
    if (s.kind === "rsvp" && !s.eventId?.trim()) throw badRequest("RSVP steps need an event.");
    clean.push({
      kind: s.kind,
      text: s.text?.slice(0, 2000),
      templateName: s.templateName?.trim() || undefined,
      vars: Array.isArray(s.vars) ? s.vars.map(String) : undefined,
      delayHours: Number.isFinite(s.delayHours) && (s.delayHours ?? 0) > 0 ? Math.min(Number(s.delayHours), 24 * 30) : undefined,
      key: s.key?.trim() || undefined,
      choices: Array.isArray(s.choices) && s.choices.length ? s.choices.map(String).slice(0, 4) : undefined,
      eventId: s.eventId?.trim() || undefined,
      fundCode: s.fundCode?.trim() || undefined,
      introText: s.introText?.slice(0, 2000),
      note: s.note?.slice(0, 500),
      assigneeMembershipId: s.assigneeMembershipId?.trim() || undefined,
    });
  }
  return clean;
}

export async function saveFlow(
  user: SessionUser,
  body: { id?: string; name: string; description?: string; triggerType?: string; eventId?: string; steps: unknown; isActive?: boolean },
  meta: { ip?: string | null; userAgent?: string | null },
) {
  if (!can(user, "comms.whatsapp.send") && !can(user, "comms.send")) throw forbidden('Requires "comms.whatsapp.send" permission.');
  const name = String(body.name ?? "").trim();
  if (!name) throw badRequest("Flow name is required.");
  const steps = validateSteps(body.steps);
  const triggerType = ["manual", "new_visitor", "event_created"].includes(String(body.triggerType)) ? String(body.triggerType) : "manual";
  const data = {
    orgId: user.orgId,
    name,
    description: body.description?.slice(0, 500) || null,
    triggerType,
    eventId: triggerType === "event_created" ? body.eventId?.trim() || null : null,
    stepsJson: JSON.stringify(steps),
    isActive: body.isActive ?? true,
  };
  const flow = body.id
    ? await db.whatsAppFlow.update({ where: { id: body.id }, data }).catch(() => null)
    : await db.whatsAppFlow.create({ data });
  if (!flow) throw notFound("Flow not found.");
  await audit({
    orgId: user.orgId,
    actor: user,
    action: body.id ? "whatsapp.flow_updated" : "whatsapp.flow_created",
    entityType: "whatsapp_flow",
    entityId: flow.id,
    after: { name, triggerType, steps: steps.length },
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
  return { ok: true, id: flow.id };
}

export async function toggleFlow(user: SessionUser, id: string, isActive: boolean) {
  if (!can(user, "comms.whatsapp.send") && !can(user, "comms.send")) throw forbidden('Requires "comms.whatsapp.send" permission.');
  const flow = await db.whatsAppFlow.findFirst({ where: { id, orgId: user.orgId } });
  if (!flow) throw notFound("Flow not found.");
  await db.whatsAppFlow.update({ where: { id }, data: { isActive } });
  return { ok: true };
}

export async function deleteFlow(user: SessionUser, id: string) {
  if (!can(user, "comms.whatsapp.send") && !can(user, "comms.send")) throw forbidden('Requires "comms.whatsapp.send" permission.');
  const flow = await db.whatsAppFlow.findFirst({ where: { id, orgId: user.orgId } });
  if (!flow) throw notFound("Flow not found.");
  const activeRuns = await db.whatsAppFlowRun.count({ where: { flowId: id, status: { in: ["active", "waiting_reply", "scheduled"] } } });
  if (activeRuns > 0) throw badRequest(`This flow has ${activeRuns} active run(s) — let them finish or abandon them first.`);
  await db.whatsAppFlow.delete({ where: { id } });
  return { ok: true };
}

// ── runs ─────────────────────────────────────────────────────────────────────

export async function listRuns(user: SessionUser, filter?: string) {
  const statusFilter =
    filter === "followups"
      ? { in: ["needs_human"] }
      : filter === "active"
        ? { in: ["active", "waiting_reply", "scheduled"] }
        : undefined;
  const runs = await db.whatsAppFlowRun.findMany({
    where: { orgId: user.orgId, ...(statusFilter ? { status: statusFilter } : {}) },
    orderBy: { lastActivityAt: "desc" },
    take: 200,
  });
  const flowIds = [...new Set(runs.map((r) => r.flowId))];
  const contactIds = [...new Set(runs.map((r) => r.contactId))];
  const flows = flowIds.length ? await db.whatsAppFlow.findMany({ where: { id: { in: flowIds } } }) : [];
  const contacts = contactIds.length ? await db.whatsAppContact.findMany({ where: { id: { in: contactIds } } }) : [];
  const personIds = [...new Set(contacts.map((c) => c.personId).filter(Boolean))] as string[];
  const people = personIds.length ? await db.person.findMany({ where: { id: { in: personIds } } }) : [];
  const fMap = new Map(flows.map((f) => [f.id, f.name]));
  const cMap = new Map(contacts.map((c) => [c.id, c]));
  const pMap = new Map(people.map((p) => [p.id, `${p.firstName} ${p.lastName}`]));
  return {
    items: runs.map((r) => {
      const c = cMap.get(r.contactId);
      return {
        id: r.id,
        flowName: fMap.get(r.flowId) ?? "Unknown flow",
        status: r.status,
        needsHuman: r.needsHuman,
        currentStep: r.currentStep,
        context: j<Record<string, string>>(r.contextJson, {}),
        contactId: r.contactId,
        personName: c?.personId ? pMap.get(c.personId) ?? "Unknown" : c?.displayName ?? c?.phoneNumber ?? "Unknown",
        phoneNumber: c?.phoneNumber,
        nextStepAt: r.nextStepAt,
        startedAt: r.startedAt,
        lastActivityAt: r.lastActivityAt,
      };
    }),
  };
}

/** Manually resolve a needs-human run (follow-up handled by a human). */
export async function resolveRun(user: SessionUser, id: string, note?: string) {
  if (!can(user, "comms.whatsapp.send") && !can(user, "comms.send")) throw forbidden('Requires "comms.whatsapp.send" permission.');
  const run = await db.whatsAppFlowRun.findFirst({ where: { id, orgId: user.orgId } });
  if (!run) throw notFound("Flow run not found.");
  const steps = parseSteps((await db.whatsAppFlow.findUnique({ where: { id: run.flowId } }))?.stepsJson ?? "[]");
  const step = steps[run.currentStep];
  await db.whatsAppFlowRun.update({
    where: { id },
    data: { status: "completed", needsHuman: false, completedAt: new Date(), contextJson: JSON.stringify({ ...j<Record<string, string>>(run.contextJson, {}), followup_resolved_by: user.name, followup_note: note ?? "" }) },
  });
  if (step?.kind === "assign_followup") {
    // advance past the human step if the flow continues
    await advanceFrom(user.orgId, run.contactId, run.id, run.currentStep + 1);
  }
  await audit({ orgId: user.orgId, actor: user, action: "whatsapp.followup_resolved", entityType: "whatsapp_flow_run", entityId: id, after: { note: note ?? "" } });
  return { ok: true };
}

// ── engine ───────────────────────────────────────────────────────────────────

/** Start a flow run for a contact (manual trigger / system trigger). */
export async function startRun(orgId: string, flowId: string, contactId: string, context: Record<string, string> = {}) {
  const flow = await db.whatsAppFlow.findFirst({ where: { id: flowId, orgId, isActive: true } });
  if (!flow) throw badRequest("Flow not found or inactive.");
  const existing = await db.whatsAppFlowRun.findFirst({
    where: { flowId, contactId, status: { in: ["active", "waiting_reply", "scheduled", "needs_human"] } },
  });
  if (existing) return { ok: false, reason: "already_running", runId: existing.id };
  const run = await db.whatsAppFlowRun.create({
    data: { orgId, flowId, contactId, status: "active", contextJson: JSON.stringify(context), lastActivityAt: new Date() },
  });
  await advanceFrom(orgId, contactId, run.id, 0);
  return { ok: true, runId: run.id };
}

export async function triggerForContact(user: SessionUser, body: { flowId: string; contactId: string }) {
  if (!can(user, "comms.whatsapp.send") && !can(user, "comms.send")) throw forbidden('Requires "comms.whatsapp.send" permission.');
  const contact = await db.whatsAppContact.findFirst({ where: { id: body.contactId, orgId: user.orgId } });
  if (!contact) throw notFound("Contact not found.");
  const res = await startRun(user.orgId, body.flowId, contact.id, { triggered_by: user.name });
  if (!res.ok) throw badRequest("This contact already has an active run of this flow.");
  return res;
}

/** Execute steps starting at `stepIndex` until a wait/schedule/human step.
 *  `fireDue` (scheduler) executes the current delayed step immediately —
 *  it is already due, so re-applying delayHours would loop forever. */
async function advanceFrom(orgId: string, contactId: string, runId: string, stepIndex: number, fireDue = false) {
  const run = await db.whatsAppFlowRun.findUnique({ where: { id: runId } });
  if (!run || run.status === "completed" || run.status === "abandoned") return;
  const flow = await db.whatsAppFlow.findUnique({ where: { id: run.flowId } });
  if (!flow) return;
  const steps = parseSteps(flow.stepsJson);
  const contact = await db.whatsAppContact.findUnique({ where: { id: contactId } });
  if (!contact) return;
  const account = await activeAccountFor(orgId);
  const context = j<Record<string, string>>(run.contextJson, {});

  let i = stepIndex;
  while (i < steps.length) {
    const step = steps[i];

    if (step.delayHours && !fireDue && (step.kind === "message" || step.kind === "template")) {
      await db.whatsAppFlowRun.update({
        where: { id: runId },
        data: { currentStep: i, status: "scheduled", nextStepAt: new Date(Date.now() + step.delayHours * 3600_000), lastActivityAt: new Date(), contextJson: JSON.stringify(context) },
      });
      return;
    }

    if (step.kind === "message") {
      if (account) await sendSessionText(account, contact, step.text ?? "", { flowRunId: runId, source: "flow" });
      i += 1;
      continue;
    }

    if (step.kind === "template") {
      if (account) {
        const tpl = await db.whatsAppTemplate.findFirst({ where: { orgId, name: step.templateName ?? "" } });
        if (tpl) {
          await sendTemplateMessage(account, contact, tpl, (step.vars ?? []).map((v) => context[v] ?? v), { flowRunId: runId, source: "flow" });
        }
      }
      i += 1;
      continue;
    }

    if (step.kind === "question") {
      const prompt = step.choices?.length ? `${step.text}\n\nReply with: ${step.choices.join(" / ")}` : step.text ?? "";
      if (account) await sendSessionText(account, contact, prompt, { flowRunId: runId, source: "flow_question" });
      await db.whatsAppFlowRun.update({
        where: { id: runId },
        data: { currentStep: i, status: "waiting_reply", lastActivityAt: new Date(), contextJson: JSON.stringify(context) },
      });
      return;
    }

    if (step.kind === "rsvp") {
      const event = await db.event.findFirst({ where: { id: step.eventId ?? "", orgId } });
      const when = event ? event.startsAt.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "";
      const prompt = `${step.text ?? `Will you be at ${event?.name ?? "the event"}${when ? ` on ${when}` : ""}?`}\n\nReply with: Yes / No / Maybe`;
      if (account) await sendSessionText(account, contact, prompt, { flowRunId: runId, source: "flow_rsvp" });
      await db.whatsAppFlowRun.update({
        where: { id: runId },
        data: { currentStep: i, status: "waiting_reply", lastActivityAt: new Date(), contextJson: JSON.stringify(context) },
      });
      return;
    }

    if (step.kind === "give_link") {
      if (account) {
        const link = await createGivingLink(orgId, contact, step.fundCode ?? null);
        const intro = step.introText ?? "Ready to give? This secure, single-use link opens your giving portal with a suggested amount:";
        await sendSessionText(account, contact, `${intro}\n${link.url}\n(The link works once and expires in 7 days.)`, { flowRunId: runId, source: "flow_give_link" });
      }
      i += 1;
      continue;
    }

    if (step.kind === "assign_followup") {
      const personId = contact.personId;
      if (personId) {
        const caseRow = await db.careCase.create({
          data: {
            orgId,
            personId,
            type: "follow_up",
            stage: "new",
            ownerMembershipId: step.assigneeMembershipId ?? null,
            urgency: "normal",
            confidentialityTier: "staff",
            summary: `WhatsApp follow-up — ${flow.name}${step.note ? `: ${step.note}` : ""}`,
          },
        });
        await db.careNote.create({
          data: {
            orgId,
            careCaseId: caseRow.id,
            authorName: "WhatsApp Automation",
            kind: "note",
            body: `Automatically opened by WhatsApp flow “${flow.name}” after no/late response. Context: ${JSON.stringify(context).slice(0, 400)}`,
            visibility: "staff",
          },
        });
        context.followup_case_id = caseRow.id;
      }
      await db.whatsAppFlowRun.update({
        where: { id: runId },
        data: { currentStep: i, status: "needs_human", needsHuman: true, lastActivityAt: new Date(), contextJson: JSON.stringify(context) },
      });
      return;
    }

    i += 1;
  }

  await db.whatsAppFlowRun.update({
    where: { id: runId },
    data: { currentStep: steps.length, status: "completed", completedAt: new Date(), lastActivityAt: new Date(), contextJson: JSON.stringify(context) },
  });
}

/** An inbound reply while a run is waiting — store the answer and continue. */
export async function advanceOnReply(orgId: string, contactId: string, text: string): Promise<boolean> {
  const run = await db.whatsAppFlowRun.findFirst({
    where: { orgId, contactId, status: "waiting_reply" },
    orderBy: { lastActivityAt: "desc" },
  });
  if (!run) return false;
  const flow = await db.whatsAppFlow.findUnique({ where: { id: run.flowId } });
  if (!flow) return false;
  const steps = parseSteps(flow.stepsJson);
  const step = steps[run.currentStep];
  const context = j<Record<string, string>>(run.contextJson, {});
  const answer = text.trim();

  if (step?.kind === "rsvp") {
    const choice = /^(y|yes)/i.test(answer) ? "yes" : /^(n|no)/i.test(answer) ? "no" : /^m|maybe/i.test(answer) ? "maybe" : null;
    if (!choice) {
      // not an RSVP answer — re-prompt once and keep waiting
      const account = await activeAccountFor(orgId);
      const contact = await db.whatsAppContact.findUnique({ where: { id: contactId } });
      if (account && contact) await sendSessionText(account, contact, "Please reply with Yes, No or Maybe.", { flowRunId: run.id, source: "flow_rsvp_reprompt" });
      return true;
    }
    context[step.key ?? "rsvp"] = choice;
    if (step.eventId) {
      const event = await db.event.findFirst({ where: { id: step.eventId, orgId } });
      if (event && run.contactId) {
        const contact = await db.whatsAppContact.findUnique({ where: { id: contactId } });
        if (contact?.personId) {
          const status = choice === "yes" ? "present" : choice === "no" ? "absent" : "excused";
          const existing = await db.attendanceRecord.findFirst({ where: { orgId, eventId: event.id, personId: contact.personId } });
          if (existing) {
            await db.attendanceRecord.update({ where: { id: existing.id }, data: { status, method: "self", notes: `RSVP via WhatsApp: ${choice}`, checkedInAt: null } });
          } else {
            await db.attendanceRecord.create({
              data: { orgId, eventId: event.id, personId: contact.personId, status, method: "self", notes: `RSVP via WhatsApp: ${choice}`, firstTime: false },
            });
          }
        }
      }
    }
  } else if (step?.kind === "question") {
    context[step.key ?? "answer"] = answer;
  } else {
    context.last_reply = answer;
  }

  await db.whatsAppFlowRun.update({ where: { id: run.id }, data: { contextJson: JSON.stringify(context), lastActivityAt: new Date() } });
  await advanceFrom(orgId, contactId, run.id, run.currentStep + 1);
  return true;
}

// ── giving links (use case C) ────────────────────────────────────────────────

import { createHash, randomBytes } from "crypto";

export async function createGivingLink(orgId: string, contact: { personId: string | null }, fundCode: string | null) {
  if (!contact.personId) throw badRequest("Giving links need a matched person record.");
  const lastGift = await db.donation.findFirst({
    where: { orgId, personId: contact.personId, status: "posted" },
    orderBy: { receivedOn: "desc" },
    select: { amountCents: true },
  });
  const raw = randomBytes(24).toString("hex");
  const tokenHash = createHash("sha256").update(raw).digest("hex");
  await db.whatsAppGivingLink.create({
    data: {
      orgId,
      personId: contact.personId,
      tokenHash,
      amountCents: lastGift?.amountCents ?? null,
      fundCode: fundCode ?? null,
      expiresAt: new Date(Date.now() + 7 * 86400_000),
    },
  });
  const base = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "https://churchos.app";
  return { token: raw, url: `${base}/?wgive=${raw}`, amountCents: lastGift?.amountCents ?? null };
}

/** Public validation of a giving deep link (no session — token IS the secret). */
export async function validateGivingLink(token: string) {
  const tokenHash = createHash("sha256").update(String(token ?? "")).digest("hex");
  const link = await db.whatsAppGivingLink.findUnique({ where: { tokenHash } });
  if (!link) return { valid: false as const, reason: "not_found" };
  if (link.usedAt) return { valid: false as const, reason: "already_used" };
  if (link.expiresAt.getTime() < Date.now()) return { valid: false as const, reason: "expired" };
  const [person, org] = await Promise.all([
    db.person.findUnique({ where: { id: link.personId }, select: { firstName: true, lastName: true } }),
    db.organization.findUnique({ where: { id: link.orgId }, select: { name: true, currency: true } }),
  ]);
  const fund = link.fundCode ? await db.fund.findFirst({ where: { orgId: link.orgId, code: link.fundCode }, select: { name: true } }) : null;
  return {
    valid: true as const,
    orgName: org?.name ?? "Church",
    personName: person ? `${person.firstName} ${person.lastName}` : "Member",
    suggestedAmountCents: link.amountCents,
    fundName: fund?.name ?? null,
    expiresAt: link.expiresAt,
  };
}

export async function markGivingLinkUsed(token: string) {
  const tokenHash = createHash("sha256").update(String(token ?? "")).digest("hex");
  const link = await db.whatsAppGivingLink.findUnique({ where: { tokenHash } });
  if (!link || link.usedAt || link.expiresAt.getTime() < Date.now()) return { ok: false as const };
  await db.whatsAppGivingLink.update({ where: { id: link.id }, data: { usedAt: new Date() } });
  return { ok: true as const, id: link.id, orgId: link.orgId, personId: link.personId };
}

// ── scheduler ────────────────────────────────────────────────────────────────

/**
 * Fire due scheduled steps + auto-start new_visitor flows from recent
 * first-time attendance. Safe to call repeatedly (idempotent per run).
 */
export async function tick(user: SessionUser, nowOverride?: Date) {
  if (!can(user, "comms.whatsapp.send") && !can(user, "comms.send")) throw forbidden('Requires "comms.whatsapp.send" permission.');
  const now = nowOverride && !Number.isNaN(nowOverride.getTime()) ? nowOverride : new Date();

  const due = await db.whatsAppFlowRun.findMany({
    where: { orgId: user.orgId, status: "scheduled", nextStepAt: { lte: now } },
    take: 100,
  });
  let fired = 0;
  for (const run of due) {
    await db.whatsAppFlowRun.update({ where: { id: run.id }, data: { status: "active", nextStepAt: null } });
    await advanceFrom(user.orgId, run.contactId, run.id, run.currentStep, true);
    fired += 1;
  }

  // auto-trigger new_visitor flows for first-time attendees without a run
  const flows = await db.whatsAppFlow.findMany({ where: { orgId: user.orgId, isActive: true, triggerType: "new_visitor" } });
  let triggered = 0;
  for (const flow of flows) {
    const firstTimers = await db.attendanceRecord.findMany({
      where: { orgId: user.orgId, firstTime: true, checkedInAt: { gte: new Date(now.getTime() - 30 * 86400_000) } },
      select: { personId: true },
    });
    for (const rec of firstTimers) {
      const contact = await db.whatsAppContact.findFirst({ where: { orgId: user.orgId, personId: rec.personId } });
      if (!contact) continue; // no WhatsApp contact for this person yet
      const already = await db.whatsAppFlowRun.findFirst({ where: { flowId: flow.id, contactId: contact.id } });
      if (already) continue;
      const res = await startRun(user.orgId, flow.id, contact.id, { triggered_by: "new_visitor_automation" });
      if (res.ok) triggered += 1;
    }
  }

  await audit({ orgId: user.orgId, actor: user, action: "whatsapp.scheduler_tick", entityType: "whatsapp_flow_run", after: { fired, triggered, at: now.toISOString() } });
  return { fired, triggered, at: now.toISOString() };
}

// helper re-export used by inbound router
export { ensureContact, normalizePhone };
