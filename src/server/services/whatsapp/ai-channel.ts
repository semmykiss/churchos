import { db } from "@/server/db";
import { expandPermissions } from "@/server/auth";
import { DEFAULT_MEMBER_PERMISSIONS } from "@/server/services/whatsapp/member-scope";
import type { SessionUser } from "@/server/permissions";
import { aiSettingsFor, buildPersonaPrompt, buildToolSelectionPrompt } from "@/server/services/ai/persona";
import { filterToolsFor, toolCatalogLines, executeTool } from "@/server/services/ai/tools";
import { classifyCrisis } from "@/server/services/ai/crisis";
import { llmComplete, extractJson, type LlmMessage } from "@/server/services/ai/provider";
import { j } from "@/server/audit";
import { activeAccountFor } from "./provider";
import { sendSessionText } from "./core";

/**
 * Shepherd AI over WhatsApp (backend only) — use case E.
 *
 * The SAME orchestrator pipeline as the in-app assistant runs here:
 * crisis classifier → permission-filtered tool catalog → tool execution
 * (each tool re-validates permissions server-side and writes the AI audit
 * log) → grounded answer. The ONLY difference is the principal: resolved
 * from phone-number → WhatsAppContact → Person → Membership, so a member
 * gets exactly the member permission set (giving.view.own forces
 * personId=self), and a staff member gets their real role permissions.
 */

const MAX_AI_CHARS = 1200;
const HISTORY_TURNS = 8;

/**
 * Build the RBAC principal for a WhatsApp contact. Members without a user
 * account get the same default bundle the member role template grants —
 * nothing more. Staff resolve through their real membership roles.
 */
export async function principalForContact(contact: {
  id: string;
  orgId: string;
  personId: string | null;
  phoneNumber: string;
}): Promise<SessionUser> {
  const org = await db.organization.findUnique({ where: { id: contact.orgId }, select: { name: true, settings: true } });
  const campus = await db.campus.findFirst({ where: { orgId: contact.orgId, isPrimary: true } });
  const person = contact.personId
    ? await db.person.findUnique({ where: { id: contact.personId }, select: { firstName: true, lastName: true, email: true } })
    : null;

  let membership = null as null | {
    id: string;
    userId: string;
    user: { email: string; name: string | null; status: string };
    roleAssignments: { role: { key: string; name: string; permissions: { permission: string }[] } }[];
  };
  if (contact.personId) {
    membership = (await db.membership.findFirst({
      where: { orgId: contact.orgId, personId: contact.personId, status: "active" },
      include: { user: true, roleAssignments: { include: { role: { include: { permissions: true } } } } },
    })) as typeof membership;
    if (membership && membership.user.status !== "active") membership = null;
  }

  const permissions = membership
    ? expandPermissions(membership.roleAssignments.map((ra) => ra.role.permissions.map((p) => p.permission)))
    : [...DEFAULT_MEMBER_PERMISSIONS];

  return {
    sessionId: `wa:${contact.id}`,
    userId: membership?.userId ?? `wa-contact:${contact.id}`,
    membershipId: membership?.id ?? "",
    orgId: contact.orgId,
    orgName: org?.name ?? "Church",
    campusId: campus?.id ?? null,
    campusName: campus?.name ?? null,
    email: membership?.user.email ?? person?.email ?? `wa-${contact.phoneNumber}@whatsapp.local`,
    name: person ? `${person.firstName} ${person.lastName}` : (membership?.user.name ?? "WhatsApp member"),
    personId: contact.personId,
    roleKeys: membership?.roleAssignments.map((ra) => ra.role.key) ?? [],
    roleNames: [...new Set((membership?.roleAssignments ?? []).map((ra) => ra.role.name))] as string[],
    permissions,
    amr: "whatsapp",
  };
}

/** Narrative history for the LLM from the WhatsApp thread itself. */
async function loadHistory(orgId: string, contactId: string) {
  const rows = await db.whatsAppMessage.findMany({
    where: { orgId, contactId, messageType: { in: ["text", "template"] }, status: { in: ["received", "delivered"] }, content: { not: null } },
    orderBy: { createdAt: "desc" },
    take: HISTORY_TURNS,
  });
  return rows
    .reverse()
    .filter((m) => (m.content ?? "").trim().length > 0 && !(m.content ?? "").startsWith("👋"))
    .map((m) => ({ role: m.direction === "inbound" ? "user" : "assistant", content: (m.content ?? "").slice(0, 600) }));
}

/**
 * Route a free-text inbound message through the AI assistant.
 * Returns true if handled (reply sent), false when AI is unavailable and a
 * fallback should be used by the caller.
 */
export async function aiTurn(
  contact: { id: string; orgId: string; personId: string | null; phoneNumber: string; optedIn: boolean; lastInboundAt: Date | null },
  text: string,
): Promise<boolean> {
  const settings = await aiSettingsFor(contact.orgId);
  const account = await activeAccountFor(contact.orgId);
  if (!account) return false;

  if (!settings.enabled) {
    await sendSessionText(account, contact, "The AI assistant isn't enabled for our church yet — but a real human reads every message here. Ask your question and we'll get back to you. 🙏", { source: "ai_fallback" });
    return true;
  }

  const user = await principalForContact(contact);

  // 1) crisis classifier — identical policy to the in-app assistant
  const detection = classifyCrisis(text);
  if (detection.triggered) {
    const resources = settings.crisisResources.map((r) => `• ${r}`).join("\n");
    const personId = contact.personId;
    if (personId) {
      const caseRow = await db.careCase.create({
        data: {
          orgId: contact.orgId,
          personId,
          type: "counseling",
          stage: "new",
          urgency: "urgent",
          confidentialityTier: "pastors",
          isSafeguarding: detection.category === "self_harm",
          summary: `Crisis signal via WhatsApp (${detection.category}) — automatic escalation from Shepherd AI`,
        },
      });
      await db.careNote.create({
        data: {
          orgId: contact.orgId,
          careCaseId: caseRow.id,
          authorName: "Shepherd AI (WhatsApp)",
          kind: "note",
          body: `Crisis classifier triggered (${detection.category}). Message excerpt: “${text.slice(0, 300)}”. The member received crisis resources automatically; a pastor should reach out personally.`,
          visibility: "pastors",
        },
      });
    }
    await sendSessionText(
      account,
      contact,
      `I'm really glad you reached out, and I want to make sure you get real support right now.\n\n${resources}\n\nI've also let our care team know so someone can check in on you personally — you're not alone. 🙏`,
      { source: "ai_crisis" },
    );
    return true;
  }

  // 2) tool selection — catalog filtered by the resolved principal's permissions
  const tools = filterToolsFor(user);
  const catalog = toolCatalogLines(tools);
  const history = await loadHistory(contact.orgId, contact.id);
  let toolCalls: { tool: string; arguments: Record<string, unknown> }[] = [];
  try {
    const selectionMessages: LlmMessage[] = [
      {
        role: "system",
        content:
          buildToolSelectionPrompt() +
          "\n\nAvailable tools:\n" +
          (catalog.length ? catalog.map((l) => `  • ${l}`).join("\n") : "  (none available)") +
          "\n\nConversation so far (WhatsApp):\n" +
          history.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n"),
      },
      { role: "user", content: text },
    ];
    const raw = await llmComplete(selectionMessages, { temperature: 0 });
    const parsed = extractJson(raw);
    const calls = (parsed?.tool_calls as unknown) ?? [];
    if (Array.isArray(calls)) {
      for (const c of calls.slice(0, 3)) {
        const name = typeof (c as { tool?: unknown })?.tool === "string" ? (c as { tool: string }).tool : null;
        if (!name || !tools.some((t) => t.name === name)) continue;
        toolCalls.push({ tool: name, arguments: ((c as { arguments?: unknown })?.arguments ?? {}) as Record<string, unknown> });
      }
    }
  } catch {
    toolCalls = [];
  }

  // 3) execute tools — same re-validation + AI audit trail as in-app
  const toolResults: string[] = [];
  for (const call of toolCalls) {
    const result = await executeTool(call.tool, call.arguments, { user, conversationId: `wa:${contact.id}` });
    if (result.ok) toolResults.push(`[${call.tool}] ${result.forModel}`);
  }

  // 4) grounded answer
  const today = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const persona =
    buildPersonaPrompt({ user, orgName: user.orgName, settings, toolLines: catalog, today }) +
    "\n\nCHANNEL: You are replying over WhatsApp. Keep answers SHORT (under 150 words), warm and conversational — no markdown headings, minimal lists, no URLs unless a tool returned one. Money is in Naira.";
  const contextBlocks: string[] = [];
  if (toolResults.length) contextBlocks.push(`TOOL RESULTS (live, permission-filtered data for THIS member — ground every number here):\n${toolResults.join("\n")}`);

  let answer = "";
  try {
    answer = await llmComplete(
      [
        { role: "system", content: persona },
        ...(contextBlocks.length ? [{ role: "system" as const, content: contextBlocks.join("\n\n") }] : []),
        ...history.map((m) => ({ role: m.role === "user" ? ("user" as const) : ("assistant" as const), content: m.content })),
        { role: "user", content: text },
      ],
      { temperature: 0.6 },
    );
  } catch {
    return false; // caller falls back to the human-handoff message
  }

  await sendSessionText(account, contact, answer.slice(0, MAX_AI_CHARS), { source: "ai" });
  return true;
}

export { j };
