import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { pushNotifications, userIdsWithPermission } from "@/server/services/notifications";
import type { SessionUser } from "@/server/permissions";

/**
 * Shepherd AI — crisis / safeguarding classifier (backend only).
 * Runs on EVERY user message BEFORE the main response. Deterministic
 * keyword+pattern heuristics (cheap, auditable, no model dependency).
 *
 * On trigger:
 *  1. an ai_crisis_flags row is written (append-only trail),
 *  2. a safeguarding care case is opened for the USER'S OWN person record
 *     (tier "staff", urgency high, isSafeguarding — visible only to care.view
 *     roles, mirroring the Care module's confidentiality model),
 *  3. care-role holders get a bell notification,
 *  4. the user is TOLD in the same reply — never silently flagged.
 */

export type CrisisCategory = "self_harm" | "abuse_disclosure" | "other";

export interface CrisisDetection {
  triggered: boolean;
  category?: CrisisCategory;
  matched?: string;
}

// Kept deliberately precise — false positives would erode trust, false
// negatives are caught by the LLM layer's own boundary instructions.
const PATTERNS: { category: CrisisCategory; re: RegExp; label: string }[] = [
  // self-harm / suicidal ideation
  { category: "self_harm", re: /\b(kill(ing)?\s+(myself|me)|suicid\w*|end(ing)?\s+my\s+life|want\s+to\s+die|better\s+off\s+dead|take\s+my\s+(own\s+)?life)\b/i, label: "self-harm ideation" },
  { category: "self_harm", re: /\b(hurt(ing)?|harm(ing)?)\s+(myself|me)\b|\bself[-\s]?harm\w*\b|\bcutting\s+myself\b|\boverdos\w*\b/i, label: "self-harm disclosure" },
  { category: "self_harm", re: /\bno\s+reason\s+to\s+(live|go\s+on)\b|\bnot\s+worth\s+living\b|\bdon'?t\s+want\s+to\s+(live|be\s+alive|wake\s+up)\b/i, label: "hopelessness language" },
  // abuse disclosures
  { category: "abuse_disclosure", re: /\b(molest\w*|sexually\s+abus\w*|rap\w+|incest)\b/i, label: "abuse disclosure" },
  { category: "abuse_disclosure", re: /\b(he|she|they|my\s+(husband|wife|partner|father|mother|step-?\w+|boyfriend|girlfriend|ex)|someone)\s+(is\s+|was\s+|has\s+been\s+)?(beating|beats|hit(s|ting)?|hits\s+me|hurting\s+me|abus\w+)\s*(me|us|him|her|the\s+child\w*|my\s+child\w*)?/i, label: "violence disclosure" },
  { category: "abuse_disclosure", re: /\b(domestic\s+violence|child\s+abuse|being\s+abused|is\s+being\s+hurt)\b/i, label: "abuse keywords" },
];

export function classifyCrisis(content: string): CrisisDetection {
  const text = (content ?? "").slice(0, 4000);
  for (const p of PATTERNS) {
    const m = text.match(p.re);
    if (m) return { triggered: true, category: p.category, matched: p.label };
  }
  return { triggered: false };
}

export interface CrisisEscalation {
  flagId: string;
  careCaseId: string | null;
  category: CrisisCategory;
}

/**
 * System-initiated safeguarding escalation. Deliberately NOT behind
 * care.create: the platform (not the user) raises the flag. The created case
 * is still confidentiality-tier protected and only surfaces to care.view roles.
 */
export async function escalateCrisis(
  user: SessionUser,
  conversationId: string,
  detection: CrisisDetection,
  excerpt: string,
): Promise<CrisisEscalation> {
  const category = detection.category ?? "other";

  // 1) append-only flag row
  const flag = await db.aiCrisisFlag.create({
    data: {
      orgId: user.orgId,
      conversationId,
      flaggedPersonId: user.personId,
      category,
      excerpt: excerpt.slice(0, 500),
    },
  });

  // 2) linked safeguarding care case (requires a person record to attach to)
  let careCaseId: string | null = null;
  if (user.personId) {
    const person = await db.person.findFirst({ where: { id: user.personId, orgId: user.orgId, deletedAt: null } });
    if (person) {
      const c = await db.careCase.create({
        data: {
          orgId: user.orgId,
          personId: person.id,
          type: "safeguarding",
          summary: `Auto-flagged by Shepherd AI (${detection.matched ?? category}) — open for pastoral review. Trigger excerpt: "${excerpt.slice(0, 240)}"`,
          urgency: "high",
          confidentialityTier: "staff",
          ownerName: "Shepherd (AI) — needs owner",
          isSafeguarding: true,
        },
      });
      careCaseId = c.id;
      await db.aiCrisisFlag.update({ where: { id: flag.id }, data: { careCaseId: c.id } });
      await db.careNote.create({
        data: {
          orgId: user.orgId,
          careCaseId: c.id,
          authorName: "Shepherd (AI)",
          kind: "note",
          body: `Safeguarding auto-flag raised during an AI conversation (${category}). The user was informed transparently. Please review the conversation context with the person and assign an owner.`,
          visibility: "staff",
        },
      }).catch(() => {});
    }
  }

  await audit({
    orgId: user.orgId,
    actor: { membershipId: user.membershipId, name: user.name },
    actorType: "system",
    action: "ai.crisis_flag",
    entityType: "ai_crisis_flag",
    entityId: flag.id,
    after: { category, careCaseId, conversationId },
  });

  // 3) bell notification for care viewers (best-effort)
  try {
    const userIds = await userIdsWithPermission(user.orgId, "care.view");
    if (userIds.length) {
      await pushNotifications({
        orgId: user.orgId,
        userIds,
        module: "care",
        type: "care.case.urgent",
        title: "AI safeguarding flag needs review",
        body: `Shepherd flagged a conversation (${category.replace("_", " ")}) — ${careCaseId ? "a safeguarding care case was opened" : "no person record was linked"}.`,
        entityType: "ai_crisis_flag",
        entityId: flag.id,
        linkModule: "care",
      });
    }
  } catch {
    // notifications are best-effort
  }

  return { flagId: flag.id, careCaseId, category };
}
