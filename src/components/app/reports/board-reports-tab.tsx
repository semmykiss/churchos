"use client";

/**
 * Board Reports (Feature 4) — permission-scoped board pack generation.
 * • Data can never exceed what the requesting user already sees in the normal
 *   UI: sections are gathered through the SAME scoped services with the
 *   requester's session; excluded sections are documented in scope notes.
 * • Reports are aggregate-only — never individual donor or member records.
 * • Every generation is audited with a frozen data snapshot.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import type { SessionUser } from "@/lib/types";
import { fmtDateShort } from "@/lib/types";
import { toast } from "sonner";
import { EmptyState, LoadingBlock, ErrorBlock, Section, useApiQuery } from "@/components/app/shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { FileText, ShieldCheck, Download, Sparkles, Info } from "lucide-react";
import { cn } from "@/lib/utils";

const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : "Something went wrong.");

interface TemplateDTO { id: string; name: string; type: string; sections: string[]; isSystem: boolean }
interface ReportRow { id: string; templateType: string; requestedByName: string; periodStart: string; periodEnd: string; status: string; generatedAt?: string | null; downloadUrl?: string | null }

const SECTION_LABELS: Record<string, string> = {
  membership: "Membership snapshot & growth",
  attendance: "Attendance trends",
  giving_summary: "Giving by fund (aggregate)",
  accounting_position: "Financial position & expenses",
  compliance: "Compliance status",
};

function periodFor(kind: "q" | "year" | "month"): { start: string; end: string } {
  const now = new Date();
  if (kind === "year") return { start: `${now.getUTCFullYear()}-01-01`, end: `${now.getUTCFullYear()}-12-31` };
  if (kind === "month") {
    const s = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const e = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
    return { start: s.toISOString().slice(0, 10), end: e.toISOString().slice(0, 10) };
  }
  const q = Math.floor(now.getUTCMonth() / 3);
  const s = new Date(Date.UTC(now.getUTCFullYear(), q * 3, 1));
  const e = new Date(Date.UTC(now.getUTCFullYear(), q * 3 + 3, 0));
  return { start: s.toISOString().slice(0, 10), end: e.toISOString().slice(0, 10) };
}

export function BoardReportsTab({ user }: { user: SessionUser }) {
  const queryClient = useQueryClient();
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [period, setPeriod] = useState(periodFor("q"));
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [lastRun, setLastRun] = useState<{ id: string; scopeNotes: string[] } | null>(null);

  const templatesQ = useApiQuery<{ items: TemplateDTO[] }>(["board-templates"], "/reports/board/templates");
  const historyQ = useQuery({ queryKey: ["board-reports"], queryFn: () => api.get<{ items: ReportRow[] }>("/reports/board") });

  const canGenerate = user.permissions.includes("reports.board.generate") || user.permissions.includes("*");
  const selected = templatesQ.data?.items.find((t) => t.id === (templateId ?? templatesQ.data?.items[0]?.id));

  const genMut = useMutation({
    mutationFn: () =>
      api.post<{ id: string; sections: string[]; scopeNotes: string[]; downloadUrl: string }>("/reports/board/generate", {
        templateId: selected?.id,
        periodStart: period.start,
        periodEnd: period.end,
        sections: selected ? selected.sections.filter((s) => !excluded.has(s)) : undefined,
      }),
    onSuccess: (r) => {
      toast.success("Board report generated — AI-assisted, aggregate-only, ready for your review");
      setLastRun({ id: r.id, scopeNotes: r.scopeNotes });
      queryClient.invalidateQueries({ queryKey: ["board-reports"] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-4">
        <Card>
          <CardContent className="space-y-4 p-4">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5 text-success" aria-hidden /> Permission-scoped by design
            </p>
            <p className="text-sm leading-relaxed text-ink-secondary">
              The report is built through the same permission-checked services you use every day, with YOUR access — asking in natural language never
              grants more. Sections your role cannot see are excluded and the exclusion is recorded. Reports contain aggregates only — never individual
              donor or member records.
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              {(["q", "year", "month"] as const).map((k) => {
                const p = periodFor(k);
                const active = p.start === period.start;
                return (
                  <button key={k} type="button" onClick={() => setPeriod(p)} className={cn(
                    "rounded-lg border p-2.5 text-left text-sm transition-colors",
                    active ? "border-primary bg-accent" : "hover:bg-accent/50",
                  )}>
                    <p className="font-medium">{k === "q" ? "This quarter" : k === "year" ? "This year" : "This month"}</p>
                    <p className="text-[11px] text-muted-foreground">{fmtDateShort(p.start)} → {fmtDateShort(p.end)}</p>
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Start</p>
                <input type="date" value={period.start} onChange={(e) => setPeriod((p) => ({ ...p, start: e.target.value }))}
                  className="h-9 rounded-md border border-input bg-surface-sunken px-3 text-sm" aria-label="Period start" />
              </div>
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">End</p>
                <input type="date" value={period.end} onChange={(e) => setPeriod((p) => ({ ...p, end: e.target.value }))}
                  className="h-9 rounded-md border border-input bg-surface-sunken px-3 text-sm" aria-label="Period end" />
              </div>
              <Button className="ml-auto" onClick={() => genMut.mutate()} disabled={!canGenerate || genMut.isPending || !selected}>
                <Sparkles className="h-4 w-4" aria-hidden /> {genMut.isPending ? "Gathering scoped data…" : "Generate report"}
              </Button>
            </div>
            {canGenerate ? null : (
              <p className="rounded-lg bg-warning-bg p-2.5 text-xs text-warning">
                You need the &ldquo;Board reports: generate&rdquo; permission — ask an admin to grant <code>reports.board.generate</code> to your role.
              </p>
            )}
          </CardContent>
        </Card>

        {lastRun ? (
          <div className="rounded-lg border border-success/30 bg-success-bg p-3 text-sm">
            <p className="flex items-center gap-1.5 font-medium text-ink"><ShieldCheck className="h-4 w-4 text-success" aria-hidden /> Report ready</p>
            <ul className="mt-1 space-y-0.5 text-xs text-ink-secondary">
              {lastRun.scopeNotes.map((n, i) => <li key={i}>• {n}</li>)}
            </ul>
            <a href={`/api/v1/reports/board/${lastRun.id}/download`} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
              <Download className="h-4 w-4" aria-hidden /> Open / print to PDF
            </a>
          </div>
        ) : null}

        <Section title="Report history (audited)">
          {historyQ.isLoading ? <LoadingBlock label="Loading history…" />
            : historyQ.isError ? <ErrorBlock error={historyQ.error} />
            : !historyQ.data?.items.length ? (
              <EmptyState icon={FileText} title="No reports yet" description="Generate your first board pack — every run freezes the exact figures used, so it stays reproducible." />
            ) : (
              <Card>
                <CardContent className="p-0">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                        <th className="px-4 py-2.5 font-semibold">Type</th>
                        <th className="px-4 py-2.5 font-semibold">Period</th>
                        <th className="hidden px-4 py-2.5 font-semibold sm:table-cell">Requested by</th>
                        <th className="px-4 py-2.5 font-semibold">Status</th>
                        <th className="px-4 py-2.5" aria-hidden />
                      </tr>
                    </thead>
                    <tbody>
                      {historyQ.data.items.map((r) => (
                        <tr key={r.id} className="border-b last:border-0">
                          <td className="px-4 py-2.5 font-medium">{r.templateType}</td>
                          <td className="px-4 py-2.5 text-muted-foreground">{fmtDateShort(r.periodStart)} → {fmtDateShort(r.periodEnd)}</td>
                          <td className="hidden px-4 py-2.5 text-muted-foreground sm:table-cell">{r.requestedByName}</td>
                          <td className="px-4 py-2.5">
                            <Badge variant="outline" className={r.status === "ready" ? "bg-success-bg text-success" : r.status === "failed" ? "bg-danger-bg text-danger" : ""}>
                              {r.status}
                            </Badge>
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            {r.downloadUrl ? (
                              <a href={r.downloadUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                                <Download className="h-3.5 w-3.5" aria-hidden /> Open
                              </a>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            )}
        </Section>
      </div>

      <Card className="h-fit">
        <CardContent className="space-y-3 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Template &amp; sections</p>
          {templatesQ.isLoading ? <LoadingBlock label="Loading templates…" /> : (
            <div className="space-y-1.5">
              {(templatesQ.data?.items ?? []).map((t) => (
                <button key={t.id} type="button" onClick={() => { setTemplateId(t.id); setExcluded(new Set()); }} className={cn(
                  "w-full rounded-lg border p-2.5 text-left text-sm transition-colors",
                  (templateId ?? templatesQ.data?.items[0]?.id) === t.id ? "border-primary bg-accent" : "hover:bg-accent/50",
                )}>
                  <p className="font-medium">{t.name} {t.isSystem ? <Badge variant="outline" className="ml-1 text-[9px]">default</Badge> : null}</p>
                  <p className="text-[11px] text-muted-foreground">{t.sections.map((s) => SECTION_LABELS[s] ?? s).join(" · ")}</p>
                </button>
              ))}
            </div>
          )}
          {selected ? (
            <div className="border-t pt-3">
              <p className="mb-1.5 flex items-center gap-1.5 text-xs text-muted-foreground"><Info className="h-3.5 w-3.5" aria-hidden /> Toggles only control which permitted sections are included — never what data you can access.</p>
              {selected.sections.map((s) => (
                <label key={s} className="flex items-center gap-2 py-1 text-sm">
                  <Checkbox
                    checked={!excluded.has(s)}
                    onCheckedChange={(v) => setExcluded((prev) => { const n = new Set(prev); if (v === true) n.delete(s); else n.add(s); return n; })}
                    aria-label={`Include ${SECTION_LABELS[s] ?? s}`}
                  />
                  {SECTION_LABELS[s] ?? s}
                </label>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
