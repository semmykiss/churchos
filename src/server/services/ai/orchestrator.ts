import { db } from "@/server/db";
import { can, type SessionUser } from "@/server/permissions";
import { badRequest, forbidden, notFound } from "@/server/http";
import { aiSettingsFor, buildPersonaPrompt, buildToolSelectionPrompt } from "@/server/services/ai/persona";
import { filterToolsFor, toolCatalogLines, executeTool, suggestedPromptsFor, toolInfosFor } from "@/server/services/ai/tools";
import { classifyCrisis, escalateCrisis } from "@/server/services/ai/crisis";
import { llmComplete, extractJson, type LlmMessage } from "@/server/services/ai/provider";

/**
 * Shepherd AI — orchestrator (backend only). The two-call loop:
 *
 *   user message
 *     → crisis classifier (every message, before anything else)
 *     → LLM call #1 (tool selection — strict JSON, permission-filtered catalog)
 *     → orchestrator executes ONLY the requested tools; each tool re-validates
 *       the user's permissions server-side and writes to ai_tool_audit_log
 *     → tool results (scoped, minimal fields) fed back as context
 *     → LLM call #2 — grounded natural-language answer, streamed to the UI
 *
 * Conversation rules (spec §5): conversation.userId === session user, hard,
 * no admin override. Ended conversations reject new messages.
 */

const HISTORY_WINDOW = 16; // recent messages kept verbatim in the LLM context
const SUMMARIZE_THRESHOLD = 8; // compact older turns once this many fall out of the window
const MAX_TOOL_CALLS_PER_TURN = 4;
const MAX_USER_MSG_CHARS = 4000;

export interface StreamEvent {
  type: "meta" | "crisis" | "tools" | "token" | "done" | "error";
  [k: string]: unknown;
}

export async function ownConversation(user: SessionUser, conversationId: string) {
  const convo = await db.aiConversation.findUnique({ where: { id: conversationId } });
  if (!convo || convo.orgId !== user.orgId) throw notFound("Conversation not found.");
  // HARD RULE — owner check; no permission can bypass this
  if (convo.userId !== user.userId) throw notFound("Conversation not found.");
  return convo;
}

export async function startConversation(user: SessionUser) {
  const settings = await aiSettingsFor(user.orgId);
  if (!settings.enabled) throw forbidden("The AI assistant is not enabled for your church yet.");
  if (!can(user, "ai.use")) throw forbidden("Your role does not include Shepherd AI access. Ask an admin to enable it (Administration → Access levels → Shepherd AI).");
  const convo = await db.aiConversation.create({
    data: { orgId: user.orgId, userId: user.userId, membershipId: user.membershipId },
  });
  return { id: convo.id, title: convo.title, status: convo.status, createdAt: convo.createdAt, updatedAt: convo.updatedAt };
}

export async function listConversations(user: SessionUser) {
  const items = await db.aiConversation.findMany({
    where: { userId: user.userId, orgId: user.orgId }, // own only — hard rule
    orderBy: { updatedAt: "desc" },
    take: 50,
    include: { _count: { select: { messages: true } } },
  });
  return {
    items: items.map((c) => ({
      id: c.id,
      title: c.title,
      status: c.status,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      messageCount: c._count.messages,
    })),
  };
}

export async function listMessages(user: SessionUser, conversationId: string) {
  await ownConversation(user, conversationId);
  const items = await db.aiMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
    take: 500,
  });
  return {
    items: items.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      toolName: m.toolName,
      toolCalls: m.toolCalls ? JSON.parse(m.toolCalls) : null,
      crisis: m.crisis,
      createdAt: m.createdAt,
    })),
  };
}

export async function clearConversation(user: SessionUser, conversationId: string) {
  const convo = await ownConversation(user, conversationId);
  if (convo.status === "ended") throw badRequest("This conversation has ended. Start a new chat.");
  await db.aiMessage.deleteMany({ where: { conversationId } });
  await db.aiConversation.update({
    where: { id: conversationId },
    data: { title: "New conversation", contextSummary: null, summarizedUpTo: 0, updatedAt: new Date() },
  });
  return { ok: true };
}

export async function endConversation(user: SessionUser, conversationId: string) {
  const convo = await ownConversation(user, conversationId);
  if (convo.status !== "ended") {
    await db.aiConversation.update({
      where: { id: conversationId },
      data: { status: "ended", endedAt: new Date(), updatedAt: new Date() },
    });
  }
  return { ok: true };
}

export async function deleteConversation(user: SessionUser, conversationId: string) {
  const convo = await ownConversation(user, conversationId);
  await db.aiMessage.deleteMany({ where: { conversationId: convo.id } });
  await db.aiConversation.delete({ where: { id: convo.id } });
  // crisis flags intentionally survive deletion (compliance trail, spec §4)
  return { ok: true };
}

export async function infoFor(user: SessionUser) {
  const settings = await aiSettingsFor(user.orgId);
  return {
    enabled: settings.enabled,
    assistantName: settings.assistantName,
    crisisResources: settings.crisisResources,
    tools: settings.enabled ? toolInfosFor(user) : [],
    prompts: settings.enabled ? suggestedPromptsFor(user) : [],
    canReviewCrisis: settings.enabled && (can(user, "care.view") || can(user, "ai.admin")),
    canViewAudit: settings.enabled && (can(user, "audit.view") || can(user, "ai.admin")),
  };
}

// ── context-window management ────────────────────────────────────────────────

function compactLine(m: { role: string; content: string }): string {
  const text = m.content.replace(/\s+/g, " ").trim();
  return `- ${m.role === "user" ? "User" : "Assistant"}: ${text.length > 160 ? text.slice(0, 160) + "…" : text}`;
}

/** Deterministic compaction of older turns — a server-side summary system-note
 * so follow-ups stay coherent without unbounded token growth (spec §6). */
async function rollContextSummary(conversationId: string): Promise<void> {
  const convo = await db.aiConversation.findUnique({ where: { id: conversationId } });
  if (!convo) return;
  const all = await db.aiMessage.findMany({ where: { conversationId, role: { in: ["user", "assistant"] } }, orderBy: { createdAt: "asc" } });
  const overflow = all.length - HISTORY_WINDOW;
  if (overflow < SUMMARIZE_THRESHOLD) return;

  const older = all.slice(0, overflow);
  const prior = convo.contextSummary ? `Previous summary:\n${convo.contextSummary}\n\n` : "";
  const transcript = older.map(compactLine).join("\n");
  let summary: string;
  try {
    summary = await llmComplete([
      { role: "system", content: "Summarize this AI-assistant conversation fragment for context continuity. Keep it under 150 words. Preserve the user's key questions, any decisions, and any sensitive context (e.g. pastoral situations) needed to continue naturally. Plain text only." },
      { role: "user", content: prior + transcript },
    ], { temperature: 0.2 });
  } catch {
    summary = transcript.split("\n").slice(-6).join("\n"); // deterministic fallback
  }
  await db.aiConversation.update({
    where: { id: conversationId },
    data: { contextSummary: summary.slice(0, 2000), summarizedUpTo: older.length },
  });
}

// ── the main turn ────────────────────────────────────────────────────────────

interface TurnInput {
  user: SessionUser;
  conversationId: string;
  content: string;
  ip?: string | null;
  userAgent?: string | null;
  emit: Emit;
}

export async function runTurn({ user, conversationId, content, ip, userAgent, emit }: TurnInput): Promise<void> {
  const convo = await ownConversation(user, conversationId);
  if (convo.status !== "active") {
    throw badRequest("This conversation has ended. Start a new chat to continue.");
  }
  const settings = await aiSettingsFor(user.orgId);
  if (!settings.enabled) throw forbidden("The AI assistant is not enabled for your church yet.");
  if (!can(user, "ai.use")) throw forbidden("Your role does not include Shepherd AI access. Ask an admin to enable it (Administration → Access levels → Shepherd AI).");

  const text = String(content ?? "").trim().slice(0, MAX_USER_MSG_CHARS);
  if (!text) throw badRequest("Message cannot be empty.");

  // 0) persist the user message
  const userMsg = await db.aiMessage.create({
    data: { conversationId, role: "user", content: text },
  });
  if (convo.title === "New conversation") {
    const title = text.replace(/\s+/g, " ").trim().slice(0, 60);
    await db.aiConversation.update({ where: { id: conversationId }, data: { title } });
  }
  emit({ type: "meta", conversationId, userMessageId: userMsg.id });

  // 1) crisis classifier — runs on EVERY message, before anything else
  const detection = classifyCrisis(text);
  let crisisInfo: { category: string; careCaseId: string | null } | null = null;
  if (detection.triggered) {
    try {
      const esc = await escalateCrisis(user, conversationId, detection, text);
      crisisInfo = { category: esc.category, careCaseId: esc.careCaseId };
      emit({ type: "crisis", category: esc.category, careCaseId: esc.careCaseId });
    } catch {
      // escalation is critical but must not break the reply entirely
      crisisInfo = { category: detection.category ?? "other", careCaseId: null };
      emit({ type: "crisis", category: detection.category ?? "other", careCaseId: null });
    }
  }

  // 2) LLM call #1 — tool selection (schema already filtered by permissions)
  const tools = filterToolsFor(user);
  const catalog = toolCatalogLines(tools);
  let toolCalls: { tool: string; arguments: Record<string, unknown> }[] = [];
  try {
    const history = await loadNarrativeHistory(conversationId);
    const selectionMessages: LlmMessage[] = [
      {
        role: "system",
        content:
          buildToolSelectionPrompt() +
          "\n\nAvailable tools:\n" +
          (catalog.length ? catalog.map((l) => `  • ${l}`).join("\n") : "  (none available)") +
          "\n\nConversation so far:\n" +
          history.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content.slice(0, 400)}`).join("\n"),
      },
      { role: "user", content: text },
    ];
    const raw = await llmComplete(selectionMessages, { temperature: 0 });
    const parsed = extractJson(raw);
    const calls = (parsed?.tool_calls as unknown) ?? [];
    if (Array.isArray(calls)) {
      for (const c of calls.slice(0, MAX_TOOL_CALLS_PER_TURN)) {
        const name = typeof (c as any)?.tool === "string" ? (c as any).tool : null;
        if (!name || !tools.some((t) => t.name === name)) continue; // only allow tools the user's permissions exposed
        toolCalls.push({
          tool: name,
          arguments: ((c as any)?.arguments && typeof (c as any).arguments === "object" ? (c as any).arguments : {}) as Record<string, unknown>,
        });
      }
    }
  } catch {
    toolCalls = []; // selection failure → answer without tools rather than fail
  }

  // 3) execute the requested tools (each re-validates permissions + audits)
  const toolResults: { tool: string; ok: boolean; denied: boolean; forModel: string; card?: unknown }[] = [];
  if (toolCalls.length) {
    for (const call of toolCalls) {
      const result = await executeTool(call.tool, call.arguments, {
        user,
        conversationId,
        ip,
        userAgent,
      });
      toolResults.push({
        tool: call.tool,
        ok: result.ok,
        denied: !!result.denied,
        forModel: result.forModel,
        card: result.card,
      });
    }
    emit({ type: "tools", names: toolResults.map((t) => t.tool) });
  }

  // 4) persist assistant tool-call marker + tool rows (the thread's audit trail)
  let assistantMsgId: string | null = null;
  if (toolCalls.length) {
    const marker = await db.aiMessage.create({
      data: { conversationId, role: "assistant", content: "", toolCalls: JSON.stringify(toolCalls) },
    });
    assistantMsgId = marker.id;
    for (const r of toolResults) {
      await db.aiMessage.create({
        data: { conversationId, role: "tool", toolName: r.tool, content: JSON.stringify({ ok: r.ok, denied: r.denied, card: r.card ?? null }) },
      });
    }
  }

  // 5) LLM call #2 — grounded answer, streamed
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const persona = buildPersonaPrompt({ user, orgName: user.orgName, settings, toolLines: catalog, today });
  const history = await loadNarrativeHistory(conversationId);
  const convoRow = await db.aiConversation.findUnique({ where: { id: conversationId } });

  const contextBlocks: string[] = [];
  if (convoRow?.contextSummary) contextBlocks.push(`Summary of earlier turns in this conversation:\n${convoRow.contextSummary}`);
  if (toolResults.length) {
    contextBlocks.push(
      "TOOL RESULTS (live, permission-filtered data for THIS user — ground every number here):\n" +
        toolResults.map((r) => `[${r.tool}] ${r.forModel}`).join("\n"),
    );
  }
  if (crisisInfo) {
    contextBlocks.push(
      `CRISIS PROTOCOL ACTIVE (${crisisInfo.category}). You MUST:\n` +
        `1. Respond with warmth first — validate the person, do not lecture.\n` +
        `2. Provide these crisis resources verbatim as a short list:\n` +
        settings.crisisResources.map((r) => `   - ${r}`).join("\n") +
        `\n3. Transparently tell the user you are letting the church's care team know so someone can reach out — consent-forward, never secret.\n` +
        `4. Encourage contact with a human (pastor, crisis line, emergency services) and keep the reply short and stabilizing. Do NOT attempt extended counseling.`,
    );
  }

  const finalMessages: LlmMessage[] = [
    { role: "system", content: persona },
    ...(contextBlocks.length ? [{ role: "system" as const, content: contextBlocks.join("\n\n") }] : []),
    ...history.map((m) => ({ role: m.role === "user" ? ("user" as const) : ("assistant" as const), content: m.content })),
    { role: "user", content: text },
  ];

  let answer = "";
  try {
    answer = await llmComplete(finalMessages, { temperature: 0.6 });
  } catch (err) {
    const fallback =
      crisisInfo
        ? "I'm here with you, and I want to make sure you get support. Please consider reaching out to the crisis resources above or the church office right now — you matter, and you don't have to carry this alone."
        : "I'm sorry — I couldn't reach my reasoning service just now. Please try again in a moment.";
    emit({ type: "token", text: fallback });
    const errRow = await db.aiMessage.create({
      data: { conversationId, role: "assistant", content: fallback, crisis: !!crisisInfo },
    });
    emit({ type: "done", messageId: errRow.id, error: err instanceof Error ? err.message : "llm_failed" });
    return;
  }

  // 6) stream the answer out token-ish chunks (transport-level streaming)
  for (const chunk of chunkForStream(answer)) {
    emit({ type: "token", text: chunk });
  }

  const finalRow = await db.aiMessage.create({
    data: { conversationId, role: "assistant", content: answer, crisis: !!crisisInfo },
  });
  await db.aiConversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
  void rollContextSummary(conversationId); // best-effort, async
  emit({ type: "done", messageId: finalRow.id, assistantMarkerId: assistantMsgId });
}

function chunkForStream(text: string): string[] {
  // split into small word groups so the UI can render a typing cadence
  const parts = text.match(/\S+\s*/g) ?? [text];
  const chunks: string[] = [];
  let buf = "";
  for (const p of parts) {
    buf += p;
    if (buf.length >= 12) {
      chunks.push(buf);
      buf = "";
    }
  }
  if (buf) chunks.push(buf);
  return chunks.length ? chunks : [text];
}

/** Narrative history for the LLM (user/assistant rows only, windowed). */
async function loadNarrativeHistory(conversationId: string): Promise<{ role: string; content: string }[]> {
  const rows = await db.aiMessage.findMany({
    where: { conversationId, role: { in: ["user", "assistant"] } },
    orderBy: { createdAt: "asc" },
  });
  return rows
    .slice(-HISTORY_WINDOW)
    .filter((m) => m.content.trim().length > 0)
    .map((m) => ({ role: m.role, content: m.content }));
}

// ── compliance review surfaces (care.view / audit.view holders) ─────────────

export async function listCrisisFlags(user: SessionUser, onlyOpen: boolean) {
  if (!can(user, "care.view") && !can(user, "ai.admin")) throw forbidden('Requires "care.view" permission or AI administration (ai.admin).');
  const items = await db.aiCrisisFlag.findMany({
    where: { orgId: user.orgId, ...(onlyOpen ? { reviewedAt: null } : {}) },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const personIds = [...new Set(items.map((i) => i.flaggedPersonId).filter(Boolean))] as string[];
  const people = personIds.length ? await db.person.findMany({ where: { id: { in: personIds } } }) : [];
  const pMap = new Map(people.map((p) => [p.id, `${p.firstName} ${p.lastName}`] as const));
  return {
    items: items.map((f) => ({
      id: f.id,
      category: f.category,
      person: f.flaggedPersonId ? pMap.get(f.flaggedPersonId) ?? "Unknown" : null,
      careCaseId: f.careCaseId,
      excerpt: f.excerpt,
      createdAt: f.createdAt,
      reviewedAt: f.reviewedAt,
      reviewedBy: f.reviewedBy,
    })),
  };
}

export async function reviewCrisisFlag(user: SessionUser, flagId: string) {
  if (!can(user, "care.view") && !can(user, "ai.admin")) throw forbidden('Requires "care.view" permission or AI administration (ai.admin).');
  const flag = await db.aiCrisisFlag.findFirst({ where: { id: flagId, orgId: user.orgId } });
  if (!flag) throw notFound("Flag not found.");
  await db.aiCrisisFlag.update({
    where: { id: flagId },
    data: { reviewedAt: new Date(), reviewedBy: user.name },
  });
  return { ok: true };
}

export async function listToolAudit(user: SessionUser) {
  if (!can(user, "audit.view") && !can(user, "ai.admin")) throw forbidden('Requires "audit.view" permission or AI administration (ai.admin).');
  const items = await db.aiToolAuditLog.findMany({
    where: { orgId: user.orgId },
    orderBy: { executedAt: "desc" },
    take: 100,
  });
  const userIds = [...new Set(items.map((i) => i.userId))];
  const users = userIds.length ? await db.user.findMany({ where: { id: { in: userIds } } }) : [];
  const uMap = new Map(users.map((u) => [u.id, u.name ?? u.email] as const));
  return {
    items: items.map((i) => ({
      id: i.id,
      toolName: i.toolName,
      arguments: i.arguments,
      permissionCheckResult: i.permissionCheckResult,
      rowsReturned: i.rowsReturned,
      user: uMap.get(i.userId) ?? "unknown",
      executedAt: i.executedAt,
    })),
  };
}
