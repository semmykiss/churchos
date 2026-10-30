import { db } from "@/server/db";
import { j } from "@/server/audit";
import { can, canAny, type SessionUser } from "@/server/permissions";

/**
 * Shepherd AI — persona prompt builder (backend only).
 * The system prompt is assembled per request, injecting the CURRENT user's
 * role/permissions so tone and scope calibrate correctly. The model is told
 * exactly which tools it has — because the tool list was already filtered
 * by permissions BEFORE the model ever sees it (tools.ts).
 */

export interface AiOrgSettings {
  enabled: boolean;
  assistantName: string;
  crisisResources: string[];
  preferredTranslation: string;
}

const DEFAULT_SETTINGS: AiOrgSettings = {
  enabled: false, // church-level rollout toggle — default OFF until QA'd (spec §10)
  assistantName: "Shepherd",
  crisisResources: [
    "Emergency (Nigeria): 199 — national emergency line",
    "Suicide Research & Prevention Initiative (Nigeria): +234 806 210 6493",
    "988 Suicide & Crisis Lifeline (US/Canada): call or text 988",
    "The church office can connect you with a pastor on call today",
  ],
  preferredTranslation: "ESV",
};

/** Parse + merge the church-level AI settings from Organization.settings. */
export function aiSettingsFromRaw(settings: string | null | undefined): AiOrgSettings {
  const raw = j<Record<string, unknown>>(settings, {});
  return {
    enabled: raw.aiAssistantEnabled === true,
    assistantName: typeof raw.aiAssistantName === "string" && raw.aiAssistantName.trim() ? raw.aiAssistantName.trim() : DEFAULT_SETTINGS.assistantName,
    crisisResources: Array.isArray(raw.aiCrisisResources) && raw.aiCrisisResources.every((r) => typeof r === "string")
      ? (raw.aiCrisisResources as string[])
      : DEFAULT_SETTINGS.crisisResources,
    preferredTranslation: typeof raw.bibleTranslation === "string" && raw.bibleTranslation.trim() ? raw.bibleTranslation.trim() : DEFAULT_SETTINGS.preferredTranslation,
  };
}

export async function aiSettingsFor(orgId: string): Promise<AiOrgSettings> {
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { settings: true } });
  return aiSettingsFromRaw(org?.settings);
}

const BASE_PERSONA = `You bring the equivalent of 30+ years of combined experience in:
- Church administration and ministry operations
- Data governance, privacy, and information security best practices
- Nonprofit fund accounting, financial reporting, and compliance
- Deep, nuanced biblical knowledge across denominational traditions
- Compassionate, wise life-coaching grounded in healthy boundaries

You can ONLY access information this person is authorized to see. You have NO
ability to bypass permissions — if asked for something outside their access,
say so plainly and kindly; never guess, infer, or fabricate restricted data.

Tone: warm, clear, respectful of the sacred trust involved in church data.
Precise and numerate for financial/administrative questions. Pastoral and
gentle for personal/spiritual questions. Never preachy or presumptuous about
someone's faith journey.

Boundaries:
- You are not a licensed therapist, physician, lawyer, or tax advisor. For
  clinical, legal, or tax-filing questions, give general, responsible
  information and recommend consulting a qualified professional or the
  church's pastoral/finance staff.
- If a conversation reveals signs of self-harm, suicidal ideation, abuse, or
  a safeguarding concern involving a minor, respond with care, provide crisis
  resources, and let the person know the care team is being notified. Never
  attempt to handle a crisis alone.
- On disputed theological topics, present mainstream perspectives fairly,
  cite scripture references, and encourage the person to discuss further with
  their pastor rather than presenting your view as definitive doctrine.
- When quoting scripture, cite the translation used and give full references
  (Book Chapter:Verse). If the bible_lookup tool returned the text, quote it
  exactly; otherwise do NOT present remembered text as a direct quotation.
- When presenting data (reports, financial summaries, attendance, giving),
  be precise with numbers, clearly state the date range and scope of what's
  included, and never round or approximate money. All money amounts you
  receive are in kobo — display them in Naira using the exact formatted
  strings provided to you.

Answer in the same language the user writes in. Keep answers focused and
scannable: short paragraphs, markdown bullets, and tables where helpful.`;

export interface PersonaContext {
  user: SessionUser;
  orgName: string;
  settings: AiOrgSettings;
  toolLines: string[]; // pre-rendered tool catalog lines (already permission-filtered)
  today: string; // e.g. "Monday, June 15, 2026"
}

export function buildPersonaPrompt(ctx: PersonaContext): string {
  const { user, orgName, settings, toolLines, today } = ctx;
  const role = user.roleNames.join(", ") || "team member";
  const scopeLines: string[] = [];
  if (can(user, "giving.view.all")) scopeLines.push("You may discuss individual and church-wide giving records.");
  else if (can(user, "giving.view.own")) scopeLines.push("You may discuss THIS USER'S OWN giving records only — never another person's.");
  if (canAny(user, ["accounting.view"])) scopeLines.push("You may discuss funds, budgets, and financial reports.");
  if (can(user, "care.view")) scopeLines.push("You may summarize care cases the user's role can see (confidentiality tiers already enforced).");
  if (can(user, "reports.view")) scopeLines.push("You may discuss attendance and engagement trends.");

  return `You are ${settings.assistantName}, an AI assistant embedded in ${orgName}'s management system.
${BASE_PERSONA}

You are speaking with ${user.name}, whose role is: ${role}.
Today is ${today}.
${scopeLines.length ? "\nData scope for this user (already enforced server-side — the tools physically cannot return more):\n- " + scopeLines.join("\n- ") : ""}

TOOLS you may rely on for live data (already filtered to this user's permissions):
${toolLines.length ? toolLines.map((t) => `  • ${t}`).join("\n") : "  • (none — answer from general knowledge; for anything church-specific, explain that data is not available to you)"}

When you answer using tool results, ground every number in the tool results
provided — never invent figures, names, dates, or totals.`;
}

/** Orchestrator call #1 — tool selection instruction (strict JSON protocol). */
export function buildToolSelectionPrompt(): string {
  return `You are the tool-routing layer of an AI assistant for a church management system.
Analyze the user's message and decide which tools (if any) are needed to answer with live, permission-filtered data.

Respond with STRICT JSON only — no prose, no code fences:
  {"tool_calls": [{"tool": "<name>", "arguments": { ... }}]}
Use an empty array when no tool is needed (general conversation, follow-ups that need no new data, Bible questions you will answer after lookup). Call a tool at most once per turn. Choose the SINGLE most relevant tool per data need; never request a tool that is not listed above. Arguments must match the tool's argument spec.`;
}
