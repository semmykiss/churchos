import { db } from "@/server/db";
import { can, type SessionUser } from "@/server/permissions";
import { badRequest, forbidden, notFound } from "@/server/http";
import { audit } from "@/server/audit";
import { changeStage } from "@/server/services/people";
import { activeAccountFor, sendOutbound } from "@/server/services/whatsapp/provider";
import { j } from "@/server/audit";

/**
 * Discipleship pipeline service (backend only) — visitor follow-up
 * automation built ON TOP of the fixed lifecycleStage enum.
 *
 *   pipeline stages (church-customized) → person positions (kanban) →
 *   sequences triggered by stage entry → steps executed by the daily tick:
 *     • auto_message  — WhatsApp send (sandbox/meta provider), or a manual
 *                       task when the channel is sms/email
 *     • assign_task   — round-robin assignment (least-recently-assigned)
 *     • move_stage    — auto-advance (which can chain the next sequence)
 *   plus: overdue flagging, stalled detection, connection notes (CRM log).
 */

export const STAGE_COLORS = ["emerald", "amber", "violet", "rose", "zinc", "teal"] as const;
const LIFECYCLE_STAGES = ["guest", "returning_guest", "attender", "member", "leader", "inactive"];

// ── helpers ──────────────────────────────────────────────────────────────────

function daysSince(date: Date, now = new Date()): number {
  return Math.floor((now.getTime() - date.getTime()) / 86400_000);
}

async function stageMap(orgId: string) {
  const stages = await db.pipelineStage.findMany({ where: { orgId }, orderBy: { sortOrder: "asc" } });
  return new Map(stages.map((s) => [s.id, s]));
}

/** Round-robin: pool by role key (default "volunteer"), least-recently-assigned wins. */
export async function pickAssignee(orgId: string, roleKey?: string | null): Promise<{ membershipId: string; name: string } | null> {
  const wanted = roleKey?.trim() || "volunteer";
  const pool = await db.membership.findMany({
    where: {
      orgId,
      status: "active",
      roleAssignments: { some: { role: { key: wanted } } },
    },
    include: { user: { select: { name: true, email: true, status: true } } },
  });
  const usable = pool.filter((m) => m.user.status === "active");
  const finalPool = usable.length
    ? usable
    : await db.membership.findMany({
        where: { orgId, status: "active", roleAssignments: { some: { role: { key: { in: ["ministry_leader", "campus_admin", "owner"] } } } } },
        include: { user: { select: { name: true, email: true, status: true } } },
      });
  if (!finalPool.length) return null;
  const lastAssigned = await db.followUpTask.groupBy({
    by: ["assignedToMembershipId"],
    where: { orgId, assignedToMembershipId: { not: null } },
    _max: { createdAt: true },
  });
  const lastMap = new Map(lastAssigned.map((r) => [r.assignedToMembershipId!, r._max.createdAt?.getTime() ?? 0]));
  const pick = [...finalPool].sort((a, b) => (lastMap.get(a.id) ?? 0) - (lastMap.get(b.id) ?? 0))[0];
  return { membershipId: pick.id, name: pick.user.name ?? pick.user.email };
}

// ── stages ───────────────────────────────────────────────────────────────────

export async function listStages(user: SessionUser) {
  const stages = await db.pipelineStage.findMany({ where: { orgId: user.orgId }, orderBy: { sortOrder: "asc" } });
  const counts = await db.personPipelinePosition.groupBy({ by: ["pipelineStageId"], where: { orgId: user.orgId }, _count: { _all: true } });
  const countMap = new Map(counts.map((c) => [c.pipelineStageId, c._count._all]));
  const now = new Date();
  return {
    items: stages.map((s) => ({
      id: s.id,
      name: s.name,
      sortOrder: s.sortOrder,
      mapsToLifecycleStage: s.mapsToLifecycleStage,
      color: s.color,
      stallThresholdDays: s.stallThresholdDays,
      isActive: s.isActive,
      peopleCount: countMap.get(s.id) ?? 0,
      stalledCount: 0, // filled by board()
    })),
  };
}

export async function saveStage(
  user: SessionUser,
  body: { id?: string; name: string; sortOrder?: number; mapsToLifecycleStage?: string | null; color?: string | null; stallThresholdDays?: number; isActive?: boolean },
  meta: { ip?: string | null; userAgent?: string | null },
) {
  if (!can(user, "pipeline.manage")) throw forbidden('Requires "pipeline.manage" permission.');
  const name = String(body.name ?? "").trim();
  if (!name) throw badRequest("Stage name is required.");
  if (body.mapsToLifecycleStage && !LIFECYCLE_STAGES.includes(body.mapsToLifecycleStage)) {
    throw badRequest("mapsToLifecycleStage must be one of the fixed lifecycle stages.");
  }
  const data = {
    orgId: user.orgId,
    name,
    sortOrder: Number.isFinite(body.sortOrder) ? Number(body.sortOrder) : 0,
    mapsToLifecycleStage: body.mapsToLifecycleStage || null,
    color: body.color || STAGE_COLORS[(body.sortOrder ?? 0) % STAGE_COLORS.length],
    stallThresholdDays: Number.isFinite(body.stallThresholdDays) && (body.stallThresholdDays ?? 0) > 0 ? Number(body.stallThresholdDays) : 14,
    isActive: body.isActive ?? true,
  };
  const stage = body.id
    ? await db.pipelineStage.update({ where: { id: body.id }, data }).catch(() => null)
    : await db.pipelineStage.create({ data: { ...data, sortOrder: data.sortOrder || (await db.pipelineStage.count({ where: { orgId: user.orgId } })) } });
  if (!stage) throw notFound("Stage not found.");
  await audit({ orgId: user.orgId, actor: user, action: body.id ? "pipeline.stage_updated" : "pipeline.stage_created", entityType: "pipeline_stage", entityId: stage.id, after: { name }, ip: meta.ip, userAgent: meta.userAgent });
  return { ok: true, id: stage.id };
}

export async function deleteStage(user: SessionUser, id: string) {
  if (!can(user, "pipeline.manage")) throw forbidden('Requires "pipeline.manage" permission.');
  const stage = await db.pipelineStage.findFirst({ where: { id, orgId: user.orgId } });
  if (!stage) throw notFound("Stage not found.");
  const occupants = await db.personPipelinePosition.count({ where: { pipelineStageId: id } });
  if (occupants > 0) throw badRequest(`${occupants} person(s) are in this stage — move them first.`);
  const inSeq = await db.followUpSequence.count({ where: { orgId: user.orgId, triggerStageId: id } });
  if (inSeq > 0) throw badRequest("A sequence is triggered by this stage — detach it first.");
  const inSteps = await db.followUpStep.count({ where: { orgId: user.orgId, moveTargetStageId: id } });
  if (inSteps > 0) throw badRequest("A sequence step moves people to this stage.");
  await db.pipelineStage.delete({ where: { id } });
  return { ok: true };
}

// ── kanban board ─────────────────────────────────────────────────────────────

export async function board(user: SessionUser) {
  if (!can(user, "pipeline.view")) throw forbidden('Requires "pipeline.view" permission.');
  const [stages, positions] = await Promise.all([
    db.pipelineStage.findMany({ where: { orgId: user.orgId, isActive: true }, orderBy: { sortOrder: "asc" } }),
    db.personPipelinePosition.findMany({ where: { orgId: user.orgId } }),
  ]);
  const personIds = positions.map((p) => p.personId);
  const people = personIds.length ? await db.person.findMany({ where: { id: { in: personIds }, deletedAt: null } }) : [];
  const pMap = new Map(people.map((p) => [p.id, p]));
  const now = new Date();

  const columns = stages.map((stage) => {
    const cards = positions
      .filter((pos) => pos.pipelineStageId === stage.id && pMap.has(pos.personId))
      .map((pos) => {
        const person = pMap.get(pos.personId)!;
        const daysInStage = daysSince(pos.enteredStageAt, now);
        return {
          personId: pos.personId,
          name: `${person.firstName} ${person.lastName}`,
          lifecycleStage: person.lifecycleStage,
          enteredStageAt: pos.enteredStageAt,
          daysInStage,
          stalled: daysInStage > stage.stallThresholdDays,
        };
      })
      .sort((a, b) => a.daysInStage - b.daysInStage);
    return {
      id: stage.id,
      name: stage.name,
      color: stage.color,
      mapsToLifecycleStage: stage.mapsToLifecycleStage,
      stallThresholdDays: stage.stallThresholdDays,
      stalledCount: cards.filter((c) => c.stalled).length,
      cards,
    };
  });
  return { columns };
}

/** Manual (drag-drop) or automated stage move — logs stage history + audit. */
export async function movePerson(
  actor: { orgId: string; name: string; membershipId: string },
  personId: string,
  toStageId: string,
  opts: { note?: string; via?: string; _depth?: number } = {},
) {
  const depth = opts._depth ?? 0;
  const person = await db.person.findFirst({ where: { id: personId, orgId: actor.orgId, deletedAt: null } });
  if (!person) throw notFound("Person not found.");
  const stage = await db.pipelineStage.findFirst({ where: { id: toStageId, orgId: actor.orgId, isActive: true } });
  if (!stage) throw notFound("Pipeline stage not found.");

  const existing = await db.personPipelinePosition.findUnique({ where: { personId } });
  if (existing?.pipelineStageId === toStageId) return { ok: true, unchanged: true };

  const before = existing ? await db.pipelineStage.findFirst({ where: { id: existing.pipelineStageId } }) : null;

  await db.$transaction(async (tx) => {
    await tx.personPipelinePosition.upsert({
      where: { personId },
      create: { orgId: actor.orgId, personId, pipelineStageId: toStageId, enteredStageAt: new Date(), enteredByName: actor.name },
      update: { pipelineStageId: toStageId, enteredStageAt: new Date(), enteredByName: actor.name },
    });
    // fresh execution ledger for the new stage's sequence
    if (existing) await tx.followUpExecution.deleteMany({ where: { positionId: existing.id } });
  });

  // lifecycle sync via the EXISTING stage-change API (writes StageHistory + audit)
  if (stage.mapsToLifecycleStage && stage.mapsToLifecycleStage !== person.lifecycleStage) {
    await changeStage(
      { orgId: actor.orgId, name: opts.via ? `Pipeline · ${actor.name}` : actor.name, membershipId: actor.membershipId } as unknown as Parameters<typeof changeStage>[0],
      personId,
      stage.mapsToLifecycleStage,
      `Pipeline: ${before?.name ?? "—"} → ${stage.name}${opts.note ? ` (${opts.note})` : ""}`,
      { ip: undefined, userAgent: undefined },
    );
  }

  await audit({
    orgId: actor.orgId,
    actorType: opts.via === "automation" ? "system" : "user",
    actorLabel: opts.via === "automation" ? "pipeline-automation" : actor.name,
    action: "pipeline.stage_move",
    entityType: "person_pipeline_position",
    entityId: personId,
    before: { stage: before?.name ?? null },
    after: { stage: stage.name, via: opts.via ?? "manual" },
  });

  // sequence trigger — armed here, executed by the tick at each step's day offset
  const sequence = await db.followUpSequence.findFirst({ where: { orgId: actor.orgId, triggerStageId: toStageId, isActive: true } });
  if (sequence && depth < 3) {
    const steps = await db.followUpStep.findMany({ where: { sequenceId: sequence.id }, orderBy: { sortOrder: "asc" } });
    for (const step of steps.filter((s) => s.actionType === "assign_task")) {
      const dueDate = new Date(Date.now() + step.dayOffset * 86400_000);
      const assignee = await pickAssignee(actor.orgId, step.assignToRole);
      await db.followUpTask.create({
        data: {
          orgId: actor.orgId,
          personId,
          sequenceId: sequence.id,
          stepId: step.id,
          title: `Follow up with ${person.firstName} ${person.lastName}${step.dayOffset ? ` (day ${step.dayOffset})` : ""}`,
          assignedToMembershipId: assignee?.membershipId ?? null,
          assignedToName: assignee?.name ?? null,
          dueDate,
        },
      });
      await db.followUpExecution.create({
        data: { orgId: actor.orgId, positionId: existing?.id ?? "pending", stepId: step.id, result: "task_created", detail: `assigned to ${assignee?.name ?? "—"}` },
      }).catch(() => {});
    }
  }
  return { ok: true, sequenceArmed: !!sequence };
}

export async function movePersonApi(user: SessionUser, personId: string, toStageId: string, note?: string) {
  if (!can(user, "pipeline.view")) throw forbidden('Requires "pipeline.view" permission.');
  const privileged = can(user, "pipeline.manage") || can(user, "pipeline.tasks.all") || can(user, "people.edit");
  if (!privileged) throw forbidden("Moving people between stages needs a leadership role.");
  return movePerson({ orgId: user.orgId, name: user.name, membershipId: user.membershipId }, personId, toStageId, { note, via: "manual" });
}

/** Journey-tab convenience: advance to the next active stage by sort order. */
export async function movePersonNext(user: SessionUser, personId: string) {
  const pos = await db.personPipelinePosition.findUnique({ where: { personId } });
  const stages = await db.pipelineStage.findMany({ where: { orgId: user.orgId, isActive: true }, orderBy: { sortOrder: "asc" } });
  if (!pos) {
    if (!stages.length) throw badRequest("No pipeline stages configured yet.");
    return movePersonApi(user, personId, stages[0].id, "Entered pipeline");
  }
  const idx = stages.findIndex((s) => s.id === pos.pipelineStageId);
  const next = stages[idx + 1];
  if (!next) throw badRequest("Already in the last pipeline stage.");
  return movePersonApi(user, personId, next.id, "Advanced to next stage");
}

// ── sequences ────────────────────────────────────────────────────────────────

export async function listSequences(user: SessionUser) {
  const rows = await db.followUpSequence.findMany({ where: { orgId: user.orgId }, orderBy: { createdAt: "desc" } });
  const seqIds = rows.map((r) => r.id);
  const steps = seqIds.length ? await db.followUpStep.findMany({ where: { sequenceId: { in: seqIds } }, orderBy: [{ sortOrder: "asc" }, { dayOffset: "asc" }] }) : [];
  const stages = await stageMap(user.orgId);
  return {
    items: rows.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      triggerStage: s.triggerStageId ? { id: s.triggerStageId, name: stages.get(s.triggerStageId)?.name ?? "—" } : null,
      isActive: s.isActive,
      steps: steps.filter((st) => st.sequenceId === s.id),
    })),
  };
}

export async function saveSequence(
  user: SessionUser,
  body: {
    id?: string;
    name: string;
    description?: string;
    triggerStageId?: string | null;
    isActive?: boolean;
    steps: { dayOffset: number; actionType: string; channel?: string | null; messageTemplate?: string | null; assignToRole?: string | null; moveTargetStageId?: string | null }[];
  },
  meta: { ip?: string | null; userAgent?: string | null },
) {
  if (!can(user, "pipeline.manage")) throw forbidden('Requires "pipeline.manage" permission.');
  const name = String(body.name ?? "").trim();
  if (!name) throw badRequest("Sequence name is required.");
  if (!Array.isArray(body.steps)) throw badRequest("Steps are required.");
  if (body.triggerStageId) {
    const stage = await db.pipelineStage.findFirst({ where: { id: body.triggerStageId, orgId: user.orgId } });
    if (!stage) throw badRequest("Trigger stage not found.");
  }
  const cleanSteps = body.steps.map((raw, i) => {
    const actionType = String(raw.actionType ?? "");
    if (!["auto_message", "assign_task", "move_stage"].includes(actionType)) throw badRequest(`Unknown step action "${actionType}".`);
    const dayOffset = Number(raw.dayOffset);
    if (!Number.isFinite(dayOffset) || dayOffset < 0 || dayOffset > 365) throw badRequest("Day offset must be 0–365.");
    return {
      orgId: user.orgId,
      sequenceId: "",
      dayOffset: Math.round(dayOffset),
      actionType,
      channel: actionType === "auto_message" ? (["whatsapp", "sms", "email"].includes(String(raw.channel)) ? String(raw.channel) : "whatsapp") : null,
      messageTemplate: actionType === "auto_message" ? String(raw.messageTemplate ?? "").slice(0, 1000) || null : null,
      assignToRole: actionType === "assign_task" ? String(raw.assignToRole ?? "volunteer").trim() || "volunteer" : null,
      moveTargetStageId: actionType === "move_stage" ? String(raw.moveTargetStageId ?? "") || null : null,
      sortOrder: i,
    };
  });
  for (const st of cleanSteps) {
    if (st.actionType === "auto_message" && !st.messageTemplate) throw badRequest("Message steps need a message template.");
    if (st.actionType === "move_stage" && !st.moveTargetStageId) throw badRequest("Move-stage steps need a target stage.");
  }

  const seq = body.id
    ? await db.followUpSequence.update({ where: { id: body.id }, data: { name, description: body.description?.slice(0, 500) || null, triggerStageId: body.triggerStageId || null, isActive: body.isActive ?? true } }).catch(() => null)
    : await db.followUpSequence.create({ data: { orgId: user.orgId, name, description: body.description?.slice(0, 500) || null, triggerStageId: body.triggerStageId || null, isActive: body.isActive ?? true } });
  if (!seq) throw notFound("Sequence not found.");
  await db.followUpStep.deleteMany({ where: { sequenceId: seq.id } });
  if (cleanSteps.length) {
    await db.followUpStep.createMany({ data: cleanSteps.map((st) => ({ ...st, sequenceId: seq.id })) });
  }
  await audit({ orgId: user.orgId, actor: user, action: body.id ? "pipeline.sequence_updated" : "pipeline.sequence_created", entityType: "follow_up_sequence", entityId: seq.id, after: { name, steps: cleanSteps.length }, ip: meta.ip, userAgent: meta.userAgent });
  return { ok: true, id: seq.id };
}

export async function deleteSequence(user: SessionUser, id: string) {
  if (!can(user, "pipeline.manage")) throw forbidden('Requires "pipeline.manage" permission.');
  const seq = await db.followUpSequence.findFirst({ where: { id, orgId: user.orgId } });
  if (!seq) throw notFound("Sequence not found.");
  await db.followUpStep.deleteMany({ where: { sequenceId: id } });
  await db.followUpTask.updateMany({ where: { sequenceId: id, status: "pending" }, data: { status: "skipped", outcomeNote: "Sequence deleted" } });
  await db.followUpSequence.delete({ where: { id } });
  return { ok: true };
}

// ── tasks ────────────────────────────────────────────────────────────────────

export async function listTasks(user: SessionUser, scope?: string) {
  const seeAll = can(user, "pipeline.tasks.all") || scope === "all" && can(user, "pipeline.tasks.all");
  const where: Record<string, unknown> = seeAll
    ? { orgId: user.orgId }
    : { orgId: user.orgId, assignedToMembershipId: user.membershipId };
  if (!seeAll && !can(user, "pipeline.tasks.own") && !can(user, "pipeline.tasks.all")) {
    throw forbidden('Requires "pipeline.tasks.own" permission.');
  }
  const rows = await db.followUpTask.findMany({ where, orderBy: [{ status: "desc" }, { dueDate: "asc" }], take: 300 });
  const personIds = [...new Set(rows.map((r) => r.personId))];
  const people = personIds.length ? await db.person.findMany({ where: { id: { in: personIds } } }) : [];
  const pMap = new Map(people.map((p) => [p.id, `${p.firstName} ${p.lastName}`]));
  const seqIds = [...new Set(rows.map((r) => r.sequenceId).filter(Boolean))] as string[];
  const seqs = seqIds.length ? await db.followUpSequence.findMany({ where: { id: { in: seqIds } } }) : [];
  const sMap = new Map(seqs.map((s) => [s.id, s.name]));
  const today = new Date().toISOString().slice(0, 10);
  return {
    scope: seeAll ? "all" : "own",
    items: rows.map((t) => ({
      id: t.id,
      personId: t.personId,
      personName: pMap.get(t.personId) ?? "Unknown",
      sequenceName: t.sequenceId ? sMap.get(t.sequenceId) ?? null : null,
      title: t.title,
      assignedToName: t.assignedToName,
      dueDate: t.dueDate,
      status: t.status === "pending" && t.dueDate.toISOString().slice(0, 10) < today ? "overdue" : t.status,
      completedAt: t.completedAt,
      outcomeNote: t.outcomeNote,
      createdAt: t.createdAt,
    })),
  };
}

export async function completeTask(user: SessionUser, id: string, outcomeNote?: string, skip = false) {
  const task = await db.followUpTask.findFirst({ where: { id, orgId: user.orgId } });
  if (!task) throw notFound("Task not found.");
  const allowed = task.assignedToMembershipId === user.membershipId || can(user, "pipeline.tasks.all");
  if (!allowed) throw forbidden("You can only complete your own tasks.");
  await db.followUpTask.update({
    where: { id },
    data: { status: skip ? "skipped" : "completed", completedAt: new Date(), outcomeNote: outcomeNote?.slice(0, 1000) || null },
  });
  if (!skip && task.personId && outcomeNote) {
    await db.connectionNote.create({
      data: { orgId: user.orgId, personId: task.personId, loggedByMembershipId: user.membershipId, loggedByName: user.name, method: "message", note: `[task outcome] ${outcomeNote}`.slice(0, 1000) },
    });
  }
  await audit({ orgId: user.orgId, actor: user, action: skip ? "pipeline.task_skipped" : "pipeline.task_completed", entityType: "follow_up_task", entityId: id, after: { outcome: outcomeNote ?? "" } });
  return { ok: true };
}

// ── connection notes + journey ───────────────────────────────────────────────

export async function listJourney(user: SessionUser, personId: string) {
  if (!can(user, "pipeline.view")) throw forbidden('Requires "pipeline.view" permission.');
  const person = await db.person.findFirst({ where: { id: personId, orgId: user.orgId, deletedAt: null } });
  if (!person) throw notFound("Person not found.");
  const pos = await db.personPipelinePosition.findUnique({ where: { personId } });
  const stage = pos ? await db.pipelineStage.findFirst({ where: { id: pos.pipelineStageId } }) : null;
  const now = new Date();
  const [notes, tasks] = await Promise.all([
    db.connectionNote.findMany({ where: { orgId: user.orgId, personId }, orderBy: { createdAt: "desc" }, take: 50 }),
    db.followUpTask.findMany({ where: { orgId: user.orgId, personId, status: { in: ["completed", "skipped"] } }, orderBy: { completedAt: "desc" }, take: 50 }),
  ]);
  const timeline = [
    ...notes.map((n) => ({ kind: "note" as const, id: n.id, at: n.createdAt, method: n.method, text: n.note, by: n.loggedByName ?? "—" })),
    ...tasks.map((t) => ({ kind: "task" as const, id: t.id, at: t.completedAt!, method: t.status === "skipped" ? "skipped" : "task", text: t.outcomeNote || t.title || "Follow-up task", by: t.assignedToName ?? "—" })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());
  return {
    position: pos
      ? {
          stageId: stage?.id ?? null,
          stageName: stage?.name ?? "—",
          stageColor: stage?.color ?? null,
          enteredStageAt: pos.enteredStageAt,
          daysInStage: daysSince(pos.enteredStageAt, now),
          stalled: stage ? daysSince(pos.enteredStageAt, now) > stage.stallThresholdDays : false,
          enteredBy: pos.enteredByName,
        }
      : null,
    personName: `${person.firstName} ${person.lastName}`,
    timeline,
  };
}

export async function logConnectionNote(
  user: SessionUser,
  body: { personId: string; method?: string; note: string },
) {
  if (!can(user, "pipeline.view")) throw forbidden('Requires "pipeline.view" permission.');
  const note = String(body.note ?? "").trim();
  if (!note) throw badRequest("Note cannot be empty.");
  const person = await db.person.findFirst({ where: { id: body.personId, orgId: user.orgId, deletedAt: null } });
  if (!person) throw notFound("Person not found.");
  const method = ["call", "visit", "message", "in_person"].includes(String(body.method)) ? String(body.method) : "call";
  const row = await db.connectionNote.create({
    data: { orgId: user.orgId, personId: body.personId, loggedByMembershipId: user.membershipId, loggedByName: user.name, method, note: note.slice(0, 1000) },
  });
  await audit({ orgId: user.orgId, actor: user, action: "pipeline.connection_logged", entityType: "connection_note", entityId: row.id, after: { personId: body.personId, method } });
  return { ok: true, id: row.id };
}

// ── widget + tick ────────────────────────────────────────────────────────────

export async function needsAttention(user: SessionUser) {
  if (!can(user, "pipeline.view")) throw forbidden('Requires "pipeline.view" permission.');
  const [stages, positions, overdueTasks] = await Promise.all([
    db.pipelineStage.findMany({ where: { orgId: user.orgId, isActive: true } }),
    db.personPipelinePosition.findMany({ where: { orgId: user.orgId } }),
    db.followUpTask.findMany({ where: { orgId: user.orgId, status: "pending", dueDate: { lt: new Date() } }, take: 50 }),
  ]);
  const stageMap_ = new Map(stages.map((s) => [s.id, s]));
  const personIds = positions.map((p) => p.personId);
  const people = personIds.length ? await db.person.findMany({ where: { id: { in: personIds }, deletedAt: null } }) : [];
  const pMap = new Map(people.map((p) => [p.id, p]));
  const stalled = positions
    .map((pos) => {
      const stage = stageMap_.get(pos.pipelineStageId);
      const person = pMap.get(pos.personId);
      if (!stage || !person) return null;
      const d = daysSince(pos.enteredStageAt);
      return d > stage.stallThresholdDays ? { personId: pos.personId, name: `${person.firstName} ${person.lastName}`, stageName: stage.name, daysInStage: d } : null;
    })
    .filter(Boolean) as { personId: string; name: string; stageName: string; daysInStage: number }[];
  const taskIds = overdueTasks.map((t) => t.personId);
  const taskPeople = taskIds.length ? await db.person.findMany({ where: { id: { in: taskIds } } }) : [];
  const tMap = new Map(taskPeople.map((p) => [p.id, `${p.firstName} ${p.lastName}`]));
  return {
    stalledCount: stalled.length,
    stalled: stalled.sort((a, b) => b.daysInStage - a.daysInStage).slice(0, 8),
    overdueCount: overdueTasks.length,
    overdueTasks: overdueTasks.slice(0, 8).map((t) => ({
      id: t.id,
      personName: tMap.get(t.personId) ?? "Unknown",
      title: t.title ?? "Follow-up task",
      dueDate: t.dueDate,
      assignedToName: t.assignedToName,
    })),
  };
}

/**
 * The automation tick — production: run daily via cron/worker; locally: the
 * Pipeline screen's "Run automation" button (and module load) call it.
 * Idempotent: each (position, step) executes at most once per stage entry.
 */
export async function tick(actor: { orgId: string; name: string; membershipId: string }, nowOverride?: Date) {
  const depth = 0; // chained move_stage steps recurse via movePerson's own guard
  const now = nowOverride && !Number.isNaN(nowOverride.getTime()) ? nowOverride : new Date();
  const [positions, steps, execs] = await Promise.all([
    db.personPipelinePosition.findMany({ where: { orgId: actor.orgId } }),
    db.followUpStep.findMany({ where: { orgId: actor.orgId } }),
    db.followUpExecution.findMany({ where: { orgId: actor.orgId } }),
  ]);
  const executedKeys = new Set(execs.map((e) => `${e.positionId}:${e.stepId}`));
  const stepBySeq = new Map<string, typeof steps>();
  for (const st of steps) {
    const list = stepBySeq.get(st.sequenceId) ?? [];
    list.push(st);
    stepBySeq.set(st.sequenceId, list);
  }
  const sequences = await db.followUpSequence.findMany({ where: { orgId: actor.orgId, isActive: true } });
  const activeByTrigger = new Map(sequences.filter((s) => s.triggerStageId).map((s) => [s.triggerStageId!, s]));
  const stageMap_ = await stageMap(actor.orgId);

  let messagesSent = 0;
  let tasksCreated = 0;
  let stageMoves = 0;

  for (const pos of positions) {
    const stage = stageMap_.get(pos.pipelineStageId);
    if (!stage) continue;
    const sequence = activeByTrigger.get(stage.id);
    if (!sequence) continue;
    const seqSteps = (stepBySeq.get(sequence.id) ?? []).sort((a, b) => a.dayOffset - b.dayOffset);
    const daysIn = daysSince(pos.enteredStageAt, now);

    for (const step of seqSteps) {
      if (step.dayOffset > daysIn) continue; // not due yet
      const key = `${pos.id}:${step.id}`;
      if (executedKeys.has(key)) continue;

      if (step.actionType === "auto_message") {
        let result = "skipped";
        let detail: string | null = null;
        if (step.channel === "whatsapp") {
          const person = await db.person.findUnique({ where: { id: pos.personId }, select: { firstName: true, lastName: true } });
          const contact = await db.whatsAppContact.findFirst({ where: { orgId: actor.orgId, personId: pos.personId, optedIn: true } });
          const account = await activeAccountFor(actor.orgId);
          if (!contact || !account || !person) {
            result = "skipped_no_contact";
            detail = "No opted-in WhatsApp contact for this person";
          } else {
            const text = (step.messageTemplate ?? "").replace(/\{\{\s*name\s*\}\}/gi, person.firstName).replace(/\{\{\s*1\s*\}\}/g, person.firstName);
            const res = await sendOutbound(account, { to: contact.phoneNumber, kind: "text", text });
            await db.whatsAppMessage.create({
              data: {
                orgId: actor.orgId, contactId: contact.id, direction: "outbound", messageType: "text",
                content: text.slice(0, 4000), status: res.status === "sent" ? "delivered" : "failed",
                waMessageId: res.waMessageId || null, errorReason: res.error ?? null,
                metaJson: JSON.stringify({ source: "pipeline", stepId: step.id, sequence: sequence.name }),
              },
            });
            result = res.status === "sent" ? "sent" : "failed";
            detail = res.error ?? null;
            if (res.status === "sent") messagesSent += 1;
          }
        } else {
          // sms/email: no direct provider wired — convert to a human task
          const assignee = await pickAssignee(actor.orgId, "volunteer");
          const person = await db.person.findUnique({ where: { id: pos.personId }, select: { firstName: true, lastName: true } });
          await db.followUpTask.create({
            data: {
              orgId: actor.orgId, personId: pos.personId, sequenceId: sequence.id, stepId: step.id,
              title: `Send ${step.channel?.toUpperCase() ?? "message"} to ${person?.firstName ?? "member"}: ${(step.messageTemplate ?? "").slice(0, 60)}`,
              assignedToMembershipId: assignee?.membershipId ?? null, assignedToName: assignee?.name ?? null,
              dueDate: now,
            },
          });
          result = "manual_task_created";
          tasksCreated += 1;
        }
        await db.followUpExecution.create({ data: { orgId: actor.orgId, positionId: pos.id, stepId: step.id, result, detail } });
        executedKeys.add(key);
      } else if (step.actionType === "assign_task") {
        // tasks are created at stage entry; this covers steps added later
        const existing = await db.followUpTask.findFirst({ where: { orgId: actor.orgId, stepId: step.id, personId: pos.personId } });
        if (!existing) {
          const assignee = await pickAssignee(actor.orgId, step.assignToRole);
          const person = await db.person.findUnique({ where: { id: pos.personId }, select: { firstName: true, lastName: true } });
          await db.followUpTask.create({
            data: {
              orgId: actor.orgId, personId: pos.personId, sequenceId: sequence.id, stepId: step.id,
              title: `Follow up with ${person?.firstName ?? "member"} (day ${step.dayOffset})`,
              assignedToMembershipId: assignee?.membershipId ?? null, assignedToName: assignee?.name ?? null,
              dueDate: new Date(pos.enteredStageAt.getTime() + step.dayOffset * 86400_000),
            },
          });
          tasksCreated += 1;
        }
        await db.followUpExecution.create({ data: { orgId: actor.orgId, positionId: pos.id, stepId: step.id, result: "task_created" } }).catch(() => {});
        executedKeys.add(key);
      } else if (step.actionType === "move_stage" && step.moveTargetStageId) {
        await db.followUpExecution.create({ data: { orgId: actor.orgId, positionId: pos.id, stepId: step.id, result: "moved" } }).catch(() => {});
        executedKeys.add(key);
        await movePerson({ orgId: actor.orgId, name: "pipeline-automation", membershipId: "" }, pos.personId, step.moveTargetStageId, { via: "automation", note: `Sequence: ${sequence.name}`, _depth: depth + 1 });
        stageMoves += 1;
        break; // position moved — remaining steps belong to the new stage's run
      }
    }
  }

  // overdue flagging
  const overdue = await db.followUpTask.updateMany({
    where: { orgId: actor.orgId, status: "pending", dueDate: { lt: new Date(now.getFullYear(), now.getMonth(), now.getDate()) } },
    data: { status: "overdue" },
  });

  await audit({ orgId: actor.orgId, actorType: "system", actorLabel: "pipeline-tick", action: "pipeline.tick", entityType: "pipeline", after: { messagesSent, tasksCreated, stageMoves, overdueFlagged: overdue.count, at: now.toISOString() } });
  return { messagesSent, tasksCreated, stageMoves, overdueFlagged: overdue.count, at: now.toISOString() };
}

export async function tickApi(user: SessionUser, now?: string) {
  if (!can(user, "pipeline.view")) throw forbidden('Requires "pipeline.view" permission.');
  return tick({ orgId: user.orgId, name: user.name, membershipId: user.membershipId }, now ? new Date(String(now)) : undefined);
}

export { j };
