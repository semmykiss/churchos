"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, LifeBuoy, Sparkles, Wrench } from "lucide-react";
import MarkdownRenderer from "./MarkdownRenderer";
import ReportCard from "./ReportCard";
import type { AiInfoResp, AiMsg, AiReportCard } from "./types";

/**
 * MessageThread — grouped render of the conversation: user bubbles (gradient,
 * right), assistant turns (left, card background, gradient orb) with embedded
 * report cards, and a tool-transparency chip showing which data was consulted.
 */

interface AssistantTurn {
  kind: "assistant";
  id: string;
  text: string;
  tools: string[];
  cards: AiReportCard[];
  crisis: boolean;
}
interface UserTurn {
  kind: "user";
  id: string;
  text: string;
}
type Turn = AssistantTurn | UserTurn;

const TOOL_LABELS: Record<string, string> = {
  getMyProfile: "Your profile",
  getPersonProfile: "Person profile",
  getMyGivingSummary: "Your giving records",
  getGivingSummary: "Giving records",
  getFundBalances: "Fund balances",
  generateFinancialReport: "Financial report",
  getGivingTrend: "Giving trend",
  getAttendanceTrends: "Attendance records",
  getHouseholdFamily: "Household directory",
  getCareCaseSummary: "Care cases",
  createCareReferral: "Care referral",
  bibleLookup: "Scripture (WEB)",
  getUpcomingEvents: "Church calendar",
  getMyServingSchedule: "Your schedule",
  getBillsDue: "Bills",
};

function parseCard(content: string): { card?: AiReportCard; denied?: boolean } {
  try {
    const parsed = JSON.parse(content) as { card?: AiReportCard; denied?: boolean };
    return parsed;
  } catch {
    return {};
  }
}

function groupMessages(messages: AiMsg[]): Turn[] {
  const turns: Turn[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      turns.push({ kind: "user", id: m.id, text: m.content });
      continue;
    }
    if (m.role === "tool") {
      const { card } = parseCard(m.content);
      const last = turns[turns.length - 1];
      if (card && last?.kind === "assistant") {
        last.cards.push(card);
      }
      continue;
    }
    // assistant row: "" content = tool-call marker; final row carries the text
    const calls = (m.toolCalls ?? []).map((c) => c.tool);
    const existing = turns[turns.length - 1];
    if (!m.content && calls.length && existing?.kind === "assistant" && !existing.text) {
      existing.tools.push(...calls);
      continue;
    }
    if (!m.content && !calls.length) continue;
    if (existing?.kind === "assistant" && !existing.text && !calls.length) {
      // final text lands in the same turn as its tool marker
      existing.text = m.content;
      existing.crisis = existing.crisis || !!m.crisis;
      continue;
    }
    turns.push({ kind: "assistant", id: m.id, text: m.content, tools: [...calls], cards: [], crisis: !!m.crisis });
  }
  return turns;
}

function ToolTransparencyChip({ tools }: { tools: string[] }) {
  const [open, setOpen] = useState(false);
  if (!tools.length) return null;
  const labels = tools.map((t) => TOOL_LABELS[t] ?? t);
  return (
    <div className="mt-1.5">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex max-w-full items-center gap-1 rounded-full border bg-muted/40 px-2 py-0.5 text-[10.5px] text-muted-foreground transition-colors hover:bg-muted"
        aria-expanded={open}
      >
        <Wrench className="h-3 w-3 shrink-0" />
        <span className="truncate">Checked: {labels.join(" · ")}</span>
        <ChevronDown className={`h-3 w-3 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <p className="mt-1 pl-1 text-[10.5px] leading-relaxed text-muted-foreground">
          Shepherd retrieved this live data through your permission-filtered tools. Every access is logged for compliance.
        </p>
      ) : null}
    </div>
  );
}

function CrisisNotice({ resources }: { resources: string[] }) {
  return (
    <div className="mt-2 rounded-xl border border-rose-300/70 bg-rose-50 p-3 text-rose-950 dark:border-rose-500/40 dark:bg-rose-950/40 dark:text-rose-100">
      <p className="flex items-center gap-1.5 text-xs font-semibold">
        <LifeBuoy className="h-4 w-4" /> You are not alone — immediate support
      </p>
      <ul className="mt-1.5 space-y-1 pl-1 text-xs leading-relaxed">
        {resources.map((r) => (
          <li key={r} className="flex gap-1.5">
            <span aria-hidden>·</span> {r}
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-[11px] opacity-80">
        Shepherd has let the church's care team know so someone can reach out to support you.
      </p>
    </div>
  );
}

export default function MessageThread({
  messages,
  streaming,
  streamingText,
  streamTools,
  crisisEvent,
  info,
}: {
  messages: AiMsg[];
  streaming: boolean;
  streamingText: string;
  streamTools: string[];
  crisisEvent: { category: string; careCaseId?: string | null } | null;
  info: AiInfoResp | undefined;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const turns = useMemo(() => groupMessages(messages), [messages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns.length, streamingText, streaming]);

  const resources = info?.crisisResources ?? [];

  return (
    <div className="space-y-4" role="log" aria-live="polite" aria-label="Conversation with Shepherd">
      {turns.map((t) =>
        t.kind === "user" ? (
          <div key={t.id} className="flex justify-end">
            <div className="max-w-[85%] rounded-2xl rounded-br-md bg-gradient-to-br from-fuchsia-500 to-violet-600 px-3.5 py-2 text-sm leading-relaxed text-white shadow-sm">
              <p className="whitespace-pre-wrap">{t.text}</p>
            </div>
          </div>
        ) : (
          <div key={t.id} className="flex gap-2.5">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 via-fuchsia-500 to-amber-400 shadow-sm">
              <Sparkles className="h-3.5 w-3.5 text-white" />
            </div>
            <div className="min-w-0 max-w-[88%]">
              <div className="rounded-2xl rounded-tl-md border bg-card px-3.5 py-2.5 shadow-sm">
                {t.text ? <MarkdownRenderer content={t.text} /> : <p className="text-sm italic text-muted-foreground">Thinking…</p>}
                {t.crisis ? <CrisisNotice resources={resources} /> : null}
                {t.cards.map((c, i) => (
                  <ReportCard key={`${t.id}-card-${i}`} card={c} />
                ))}
                <ToolTransparencyChip tools={t.tools} />
              </div>
            </div>
          </div>
        ),
      )}

      {streaming ? (
        <div className="flex gap-2.5">
          <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 via-fuchsia-500 to-amber-400 shadow-sm">
            <Sparkles className="h-3.5 w-3.5 animate-pulse text-white" />
          </div>
          <div className="min-w-0 max-w-[88%]">
            <div className="rounded-2xl rounded-tl-md border bg-card px-3.5 py-2.5 shadow-sm">
              {streamTools.length ? (
                <p className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                  <span className="h-1.5 w-1.5 animate-ping rounded-full bg-fuchsia-500" />
                  Checking {streamTools.map((t) => TOOL_LABELS[t] ?? t).join(" · ")}…
                </p>
              ) : null}
              {crisisEvent && !streamTools.length ? (
                <p className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-rose-600 dark:text-rose-400">
                  <AlertTriangle className="h-3.5 w-3.5" /> Notifying the care team transparently…
                </p>
              ) : null}
              {streamingText ? (
                <MarkdownRenderer content={streamingText} />
              ) : (
                <div className="flex items-center gap-1 py-1" aria-label="Shepherd is typing">
                  {[0, 1, 2].map((i) => (
                    <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/50" style={{ animationDelay: `${i * 150}ms` }} />
                  ))}
                </div>
              )}
              {crisisEvent ? <CrisisNotice resources={resources} /> : null}
            </div>
          </div>
        </div>
      ) : null}
      <div ref={bottomRef} />
    </div>
  );
}
