/**
 * Shepherd AI — shared client types (FRONTEND ONLY).
 */

export interface AiToolInfo {
  name: string;
  label: string;
  description: string;
}

export interface AiInfoResp {
  enabled: boolean;
  assistantName: string;
  crisisResources: string[];
  tools: AiToolInfo[];
  prompts: string[];
  canReviewCrisis: boolean;
  canViewAudit: boolean;
}

export interface AiConversationItem {
  id: string;
  title: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface AiCardTable {
  columns: string[];
  rows: (string | number)[][];
}

export interface AiReportCard {
  kind: "giving_summary" | "fund_balances" | "financial_report" | "attendance" | "events" | "schedule" | "care_cases" | "bills" | "profile";
  title: string;
  subtitle?: string;
  stats?: { label: string; value: string }[];
  table?: AiCardTable;
  csv?: { name: string; columns: string[]; rows: (string | number)[][] };
}

export interface AiMsg {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  toolName?: string | null;
  toolCalls?: { tool: string; arguments?: Record<string, unknown> }[] | null;
  crisis?: boolean;
  createdAt?: string;
  /** client-side grouping results (not from the server) */
  pending?: boolean;
}

/** SSE events emitted by POST /ai/conversations/:id/messages */
export type AiStreamEvent =
  | { type: "meta"; conversationId: string; userMessageId: string }
  | { type: "crisis"; category: string; careCaseId?: string | null }
  | { type: "tools"; names: string[] }
  | { type: "token"; text: string }
  | { type: "done"; messageId: string; assistantMarkerId?: string | null; error?: string }
  | { type: "error"; message: string; code?: string };

export interface AiCrisisFlagRow {
  id: string;
  category: string;
  person: string | null;
  careCaseId: string | null;
  excerpt: string | null;
  createdAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
}

export interface AiAuditRow {
  id: string;
  toolName: string;
  arguments: string | null;
  permissionCheckResult: boolean;
  rowsReturned: number | null;
  user: string;
  executedAt: string;
}
