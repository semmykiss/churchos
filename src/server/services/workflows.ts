import { db } from "@/server/db";
import { audit, j } from "@/server/audit";
import { badRequest, notFound } from "@/server/http";
import type { SessionUser } from "@/server/permissions";

/**
 * Workflow automation service (backend only — no HTTP, no React).
 * Business rules honored:
 *  • templates carry a `steps` JSON array ({type: task|email|sms|tag|notify, …})
 *  • /test is a dry-run only — it NEVER creates a WorkflowRun
 *  • suppression: deceased person → suppressed:deceased; do_not_contact flag →
 *    suppressed:do_not_contact (whole run, every step)
 *  • stats are aggregated from all org runs in a single query
 */

function stepDetail(step: any, person: any): string {
  const fullName = `${person.firstName} ${person.lastName}`;
  switch (step.type) {
    case "email":
      return `email: "${step.subject ?? "(no subject)"}" → ${person.email ?? "(no email on file)"}`;
    case "sms":
      return `sms: "${step.body ?? step.subject ?? "(no text)"}" → ${person.phone ?? "(no phone on file)"}`;
    case "task":
      return `task: "${step.title ?? "Follow up"}" → owner ${step.owner ?? "unassigned"}`;
    case "tag":
      return `tag: add "${step.tag ?? step.name ?? "tag"}" → ${fullName}`;
    case "notify":
      return `notify: alert ${step.membership ?? step.role ?? "staff"}`;
    default:
      return `${step.type ?? "step"}: ${step.title ?? step.subject ?? ""}`.trim();
  }
}

/** Whole-run suppression check. Returns the firedReason or null when it may fire. */
function suppressionReason(person: { status: string; custom: string | null }): string | null {
  if (person.status === "deceased") return "suppressed:deceased";
  const custom = j<{ do_not_contact?: boolean }>(person.custom, {});
  if (custom.do_not_contact === true) return "suppressed:do_not_contact";
  return null;
}

export async function listWorkflows(user: SessionUser) {
  const [workflows, runs] = await Promise.all([
    db.workflow.findMany({ where: { orgId: user.orgId }, orderBy: { name: "asc" } }),
    // one query for the whole org; aggregate per workflow in JS
    db.workflowRun.findMany({
      where: { orgId: user.orgId },
      select: { workflowId: true, status: true, startedAt: true },
    }),
  ]);
  const stats: Record<string, { fired: number; suppressed: number; lastRunAt: Date | null }> = {};
  for (const r of runs) {
    stats[r.workflowId] ??= { fired: 0, suppressed: 0, lastRunAt: null };
    const s = stats[r.workflowId];
    if (r.status === "completed") s.fired += 1;
    if (r.status === "suppressed") s.suppressed += 1;
    if (!s.lastRunAt || r.startedAt.getTime() > s.lastRunAt.getTime()) s.lastRunAt = r.startedAt;
  }
  return {
    items: workflows.map((w) => ({
      id: w.id,
      name: w.name,
      triggerType: w.triggerType,
      isActive: w.isActive,
      version: w.version,
      steps: j<any[]>(w.steps, []),
      stats: {
        fired: stats[w.id]?.fired ?? 0,
        suppressed: stats[w.id]?.suppressed ?? 0,
        lastRunAt: stats[w.id]?.lastRunAt ?? null,
      },
    })),
  };
}

export async function toggleWorkflow(user: SessionUser, id: string, isActive: boolean, meta: { ip?: string; userAgent?: string }) {
  const wf = await db.workflow.findFirst({ where: { id, orgId: user.orgId } });
  if (!wf) throw notFound("Workflow not found.");
  if (typeof isActive !== "boolean") throw badRequest("isActive (boolean) is required.");
  await db.workflow.update({ where: { id: wf.id }, data: { isActive } });
  await audit({
    orgId: user.orgId, actor: user, action: "workflow.toggle", entityType: "workflow", entityId: wf.id,
    before: { isActive: wf.isActive }, after: { isActive }, ip: meta.ip, userAgent: meta.userAgent,
  });
  return { ok: true };
}

/** Dry-run: what WOULD fire for this person. No WorkflowRun is created. */
export async function testWorkflow(user: SessionUser, id: string, personId: string) {
  const wf = await db.workflow.findFirst({ where: { id, orgId: user.orgId } });
  if (!wf) throw notFound("Workflow not found.");
  if (!personId) throw badRequest("personId is required.");
  const person = await db.person.findFirst({ where: { id: personId, orgId: user.orgId } });
  if (!person) throw notFound("Person not found.");

  const steps = j<any[]>(wf.steps, []);
  const reason = suppressionReason(person);
  return {
    workflow: { id: wf.id, name: wf.name },
    person: { id: person.id, name: `${person.firstName} ${person.lastName}` },
    ...(reason ? { suppressed: reason } : {}),
    steps: steps.map((s) => ({
      type: s.type,
      detail: stepDetail(s, person),
      ...(reason ? { suppressed: true } : {}),
    })),
  };
}

export async function listWorkflowRuns(user: SessionUser, q: { workflowId?: string; limit?: number }) {
  const runs = await db.workflowRun.findMany({
    where: { orgId: user.orgId, ...(q.workflowId ? { workflowId: q.workflowId } : {}) },
    orderBy: { startedAt: "desc" },
    take: Math.min(200, Math.max(1, q.limit ?? 50)),
    include: { workflow: { select: { name: true } } },
  });
  return {
    items: runs.map((r) => ({
      id: r.id,
      workflow: { id: r.workflowId, name: r.workflow.name },
      subjectName: r.subjectName,
      status: r.status,
      firedReason: r.firedReason,
      detail: r.detail,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
    })),
  };
}
