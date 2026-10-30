import ZAI from "z-ai-web-dev-sdk";

/**
 * GLM provider adapter (backend only) — the ONLY file that talks to the LLM.
 * Model-agnostic interface: swap the implementation without touching the
 * orchestrator. The upstream SDK exposes plain chat completions, so the
 * function-calling loop is implemented as a strict JSON protocol in the
 * orchestrator (two-call pattern) rather than native tool APIs.
 */

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** The SDK's documented convention: system-level prompts are sent with the
 * "assistant" role as the first message. Mapping happens here so the rest of
 * the codebase can speak standard roles. */
function toSdkMessages(messages: LlmMessage[]) {
  return messages.map((m, i) => ({
    // map leading system → assistant; keep later system messages as assistant too
    role: m.role === "system" ? (i === 0 ? "assistant" as const : "assistant" as const) : m.role,
    content: m.content,
  }));
}

export async function llmComplete(messages: LlmMessage[], opts?: { temperature?: number }): Promise<string> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const zai = await ZAI.create();
      const completion = await zai.chat.completions.create({
        messages: toSdkMessages(messages),
        thinking: { type: "disabled" },
        ...(opts?.temperature !== undefined ? { temperature: opts.temperature } : {}),
      } as Parameters<typeof zai.chat.completions.create>[0]);
      const text = completion.choices?.[0]?.message?.content ?? "";
      if (text.trim()) return text;
      lastError = new Error("Empty LLM response");
    } catch (err) {
      lastError = err;
    }
    if (attempt < 3) await new Promise((r) => setTimeout(r, 400 * attempt));
  }
  throw lastError instanceof Error ? lastError : new Error("LLM call failed");
}

/** Extract the first JSON object from a model reply (tolerates prose/fences). */
export function extractJson(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  if (start === -1) return null;
  // walk to the matching closing brace
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(cleaned.slice(start, i + 1)) as Record<string, unknown>;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
