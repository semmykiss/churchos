"use client";

/**
 * People CRM Phase 7 — Import wizard (CSV/XLSX).
 *
 * Steps: upload → column mapping (auto-mapped, templates) → normalization
 * preview with per-row create/skip/merge decisions → dry-run summary →
 * chunked commit with live progress (polls the job) → result with error
 * report download and "Undo this import" (7 days). The browser parses the
 * file; the server re-validates every value, so the preview shown here is
 * exactly what a commit writes.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  AlertTriangle, CheckCircle2, Download, FileSpreadsheet, FileUp, History, Loader2,
  RotateCcw, Save, SkipForward, Users, X,
} from "lucide-react";
import type {
  ImportFieldIssueDTO, ImportJobDTO, ImportJobStats, ImportMappingTemplateDTO, ImportPreviewRow,
} from "./crm-shared";

// The canonical field list lives server-side (people-import.ts IMPORT_FIELDS);
// this mirror drives the mapping dropdown labels only.
const FIELD_OPTIONS: { key: string; label: string }[] = [
  { key: "firstName", label: "First name *" },
  { key: "lastName", label: "Last name *" },
  { key: "preferredName", label: "Preferred name" },
  { key: "title", label: "Title" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "gender", label: "Gender" },
  { key: "birthdate", label: "Date of birth" },
  { key: "maritalStatus", label: "Marital status" },
  { key: "weddingAnniversary", label: "Wedding anniversary" },
  { key: "occupation", label: "Occupation" },
  { key: "addressLine1", label: "Street address" },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "lga", label: "LGA" },
  { key: "lifecycleStage", label: "Stage" },
  { key: "notes", label: "Notes" },
];


type Step = "upload" | "mapping" | "review" | "committing" | "done";

interface StageResponse {
  jobId: string;
  stats: ImportJobStats;
  mapping: Record<string, string>;
}

export function ImportWizard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState<string>("");
  const [source, setSource] = useState<"csv" | "xlsx">("csv");
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [jobId, setJobId] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreviewRow[] | null>(null);
  const [stats, setStats] = useState<ImportJobStats | null>(null);
  const [busy, setBusy] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const jobsQ = useQuery<ImportJobDTO[]>({
    queryKey: ["people", "import", "jobs"],
    queryFn: () => api.get<ImportJobDTO[]>("/people/import"),
    enabled: open,
    refetchInterval: step === "committing" ? 1500 : false,
  });

  const templatesQ = useQuery<ImportMappingTemplateDTO[]>({
    queryKey: ["people", "import", "templates"],
    queryFn: () => api.get<ImportMappingTemplateDTO[]>("/people/import-mappings"),
    enabled: open && step === "mapping",
  });

  const reset = useCallback(() => {
    setStep("upload"); setFileName(""); setColumns([]); setRows([]); setMapping({});
    setJobId(null); setPreview(null); setStats(null); setBusy(false);
  }, []);

  const closeAll = useCallback(() => {
    reset();
    onClose();
    void qc.invalidateQueries({ queryKey: ["people"] });
  }, [onClose, qc, reset]);

  // ── file parsing (client-side SheetJS; server re-validates everything) ─────
  const parseFile = useCallback(async (file: File) => {
    setBusy(true);
    try {
      const XLSX = await import("xlsx");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { cellDates: false, raw: false });
      const ws = wb.Sheets[wb.SheetNames[0]];
      if (!ws) throw new Error("The file has no sheets.");
      const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", blankrows: false });
      if (aoa.length < 2) throw new Error("The file needs a header row and at least one data row.");
      const header = (aoa[0] as unknown[]).map((h, i) => String(h ?? "").trim() || `Column ${i + 1}`);
      const dataRows = (aoa.slice(1) as unknown[][]).map((r) => {
        const obj: Record<string, string> = {};
        header.forEach((h, i) => { obj[h] = String(r[i] ?? "").trim(); });
        return obj;
      });
      if (dataRows.length > 5000) throw new Error("Import is limited to 5,000 rows per file — split larger files.");
      setFileName(file.name);
      setSource(file.name.toLowerCase().endsWith(".xlsx") || file.name.toLowerCase().endsWith(".xls") ? "xlsx" : "csv");
      setColumns(header);
      setRows(dataRows);

      const res = await api.post<StageResponse>("/people/import", {
        fileName: file.name,
        source: file.name.toLowerCase().endsWith(".xlsx") || file.name.toLowerCase().endsWith(".xls") ? "xlsx" : "csv",
        columns: header,
        rows: dataRows,
      });
      setJobId(res.jobId);
      setMapping(res.mapping);
      setStats(res.stats);
      setStep("mapping");
      toast.success(`${dataRows.length} rows staged — review the column mapping.`);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Could not read the file.";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }, []);

  // ── mapping → re-stage → preview ────────────────────────────────────────────
  const applyMapping = useCallback(async (actions?: Record<string, string>) => {
    if (!jobId) return;
    setBusy(true);
    try {
      const res = await api.post<StageResponse>(`/people/import/${jobId}/mapping`, { mapping, actions: actions ?? {} });
      setStats(res.stats);
      const pv = await api.get<{ rows: ImportPreviewRow[] }>(`/people/import/${jobId}/preview?limit=300`);
      setPreview(pv.rows);
      setStep("review");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not apply the mapping.");
    } finally {
      setBusy(false);
    }
  }, [jobId, mapping]);

  const setAction = useCallback(async (rowNumber: number, action: string) => {
    if (!jobId) return;
    // optimistic local update
    setPreview((prev) => prev ? prev.map((r) => (r.rowNumber === rowNumber ? { ...r, action } : r)) : prev);
    try {
      await api.post(`/people/import/${jobId}/actions`, { actions: { [String(rowNumber)]: action } });
    } catch {
      toast.error("Could not update that row.");
    }
  }, [jobId]);

  const commit = useCallback(async () => {
    if (!jobId) return;
    setStep("committing");
    try {
      const res = await api.post<{ stats: ImportJobStats }>(`/people/import/${jobId}/commit`);
      setStats(res.stats);
      setStep("done");
      toast.success(`Import complete — ${res.stats.created ?? 0} people created.`);
      void qc.invalidateQueries({ queryKey: ["people"] });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Commit failed.");
      setStep("review");
    }
  }, [jobId, qc]);

  const rollback = useCallback(async (id: string) => {
    try {
      const res = await api.post<{ deleted: number; skipped: { row: number; reason: string }[] }>(`/people/import/${id}/rollback`);
      toast.success(`Undo complete — ${res.deleted} people removed.`);
      void qc.invalidateQueries({ queryKey: ["people", "import", "jobs"] });
      void qc.invalidateQueries({ queryKey: ["people"] });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Undo failed.");
    }
  }, [qc]);

  const saveTemplate = useCallback(async () => {
    if (!templateName.trim()) { toast.error("Give the template a name."); return; }
    try {
      await api.post("/people/import-mappings", { name: templateName.trim(), mapping, source });
      setTemplateName("");
      void qc.invalidateQueries({ queryKey: ["people", "import", "templates"] });
      toast.success("Mapping template saved.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save the template.");
    }
  }, [mapping, source, templateName]);

  const downloadErrors = useCallback(() => {
    if (jobId) window.open(`/api/v1/people/import/${jobId}/errors.csv`, "_blank");
  }, [jobId]);

  const mappedCount = useMemo(() => new Set(Object.values(mapping).filter(Boolean)).size, [mapping]);
  const reviewCounts = useMemo(() => {
    const p = preview ?? [];
    return {
      ready: p.filter((r) => r.status === "ready" && r.action === "create").length,
      dupes: p.filter((r) => r.duplicateOfId).length,
      errors: p.filter((r) => r.status === "error").length,
      issues: p.reduce((a, r) => a + r.issues.length, 0),
    };
  }, [preview]);

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) closeAll(); }}>
      <DialogContent className="max-w-4xl overflow-hidden p-0" aria-describedby={undefined}>
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Users className="h-5 w-5 text-primary" aria-hidden /> Import people
          </DialogTitle>
          <DialogDescription>
            CSV or Excel · phones normalized to +234 · duplicates flagged before anything is written.
          </DialogDescription>
        </DialogHeader>

        {/* step rail */}
        <div className="flex items-center gap-1 border-b px-6 py-2 text-xs" role="list" aria-label="Import steps">
          {(["upload", "mapping", "review", "done"] as const).map((s, i) => (
            <div key={s} role="listitem" className={cn(
              "flex items-center gap-1.5 rounded-full px-2.5 py-1",
              step === s ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground",
              s === "done" && (step === "committing" || step === "done") && "text-muted-foreground",
            )}>
              <span className={cn("grid h-4 w-4 place-items-center rounded-full border text-[10px]",
                [step, "committing"].includes(s) || (s === "done" && step === "done") ? "border-primary text-primary" : "border-muted-foreground/40")}>
                {i + 1}
              </span>
              {s === "upload" ? "Upload" : s === "mapping" ? "Map columns" : s === "review" ? "Review" : "Commit"}
              {i < 3 ? <span className="ml-1 text-muted-foreground/50">→</span> : null}
            </div>
          ))}
        </div>

        <div className="max-h-[65vh] overflow-y-auto px-6 py-4">
          {step === "upload" ? (
            <div className="space-y-4">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                className="grid w-full place-items-center gap-2 rounded-xl border-2 border-dashed p-10 text-center transition-colors hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-60"
              >
                {busy ? <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden /> : <FileUp className="h-8 w-8 text-primary" aria-hidden />}
                <span className="text-sm font-medium">{busy ? "Reading file…" : "Choose a CSV or Excel file"}</span>
                <span className="text-xs text-muted-foreground">Up to 5,000 rows · .csv, .xlsx, .xls</span>
              </button>
              <input
                ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="sr-only" aria-label="Import file"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void parseFile(f); e.target.value = ""; }}
              />
              <RecentJobs jobs={jobsQ.data ?? []} onUndo={(id) => void rollback(id)} busy={busy} />
            </div>
          ) : null}

          {step === "mapping" ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-muted-foreground">
                  <FileSpreadsheet className="mr-1 inline h-4 w-4" aria-hidden />
                  {fileName} — {stats?.rows ?? rows.length} rows · {mappedCount} columns mapped
                </p>
                <div className="flex items-center gap-2">
                  <Select onValueChange={(id) => {
                    const t = (templatesQ.data ?? []).find((x) => x.id === id);
                    if (t) { setMapping(JSON.parse(t.mapping) as Record<string, string>); toast.info(`Template “${t.name}” applied.`); }
                  }}>
                    <SelectTrigger className="h-8 w-44" aria-label="Load a mapping template"><SelectValue placeholder="Load template…" /></SelectTrigger>
                    <SelectContent>
                      {(templatesQ.data ?? []).map((t) => (
                        <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <ScrollArea className="max-h-72 rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-surface-sunken text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr><th className="px-3 py-2">File column</th><th className="px-3 py-2">Sample</th><th className="px-3 py-2">Maps to</th></tr>
                  </thead>
                  <tbody>
                    {columns.map((col) => (
                      <tr key={col} className="border-t">
                        <td className="px-3 py-1.5 font-medium">{col}</td>
                        <td className="max-w-40 truncate px-3 py-1.5 text-muted-foreground">{rows[0]?.[col] || "—"}</td>
                        <td className="px-3 py-1.5">
                          <Select value={mapping[col] ?? "none"} onValueChange={(v) => setMapping((m) => ({ ...m, [col]: v === "none" ? "" : v }))}>
                            <SelectTrigger className="h-8 w-44" aria-label={`Map column ${col}`}><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">— Skip column —</SelectItem>
                              {FIELD_OPTIONS.map((f) => <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollArea>

              <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-surface-sunken px-3 py-2">
                <Input value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="Save this mapping as…" className="h-8 w-48" aria-label="Template name" />
                <Button type="button" variant="outline" size="sm" onClick={() => void saveTemplate()} disabled={!templateName.trim()}>
                  <Save className="h-3.5 w-3.5" /> Save template
                </Button>
              </div>

              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={reset}>Cancel</Button>
                <Button type="button" onClick={() => void applyMapping()} disabled={busy || !mappingHasName(mapping)}>
                  {mappingHasName(mapping) ? "Preview import" : "Map First & Last name first"}
                </Button>
              </div>
            </div>
          ) : null}

          {step === "review" && preview ? (
            <div className="space-y-4">
              <DryRunSummary stats={stats} counts={reviewCounts} />
              <ScrollArea className="max-h-80 rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-surface-sunken text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">Row</th><th className="px-3 py-2">Person</th>
                      <th className="px-3 py-2">Phone (normalized)</th><th className="px-3 py-2">Notes from checks</th>
                      <th className="px-3 py-2">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((r) => (
                      <tr key={r.rowNumber} className={cn("border-t align-top", r.status === "error" && "bg-destructive/5")}>
                        <td className="px-3 py-1.5 text-muted-foreground">{r.rowNumber}</td>
                        <td className="px-3 py-1.5">
                          <div className="font-medium">{[r.values.firstName, r.values.lastName].filter(Boolean).join(" ") || "—"}</div>
                          <div className="text-xs text-muted-foreground">{r.values.email ?? ""}</div>
                          {r.duplicateOfId ? (
                            <Badge variant="outline" className="mt-1 border-warning/40 bg-warning/10 text-warning">
                              <AlertTriangle className="h-3 w-3" aria-hidden /> looks like an existing person
                            </Badge>
                          ) : null}
                        </td>
                        <td className="px-3 py-1.5 font-mono text-xs">{r.values.phone ?? "—"}</td>
                        <td className="px-3 py-1.5 text-xs">
                          {r.errorReason ? <span className="text-destructive">{r.errorReason}</span> : (
                            <ul className="space-y-0.5 text-muted-foreground">
                              {r.issues.slice(0, 2).map((iss: ImportFieldIssueDTO, k: number) => (
                                <li key={k}>{iss.reason}{iss.value ? `: ${iss.raw} → ${iss.value}` : iss.raw ? `: ${iss.raw}` : ""}</li>
                              ))}
                              {r.issues.length > 2 ? <li>+{r.issues.length - 2} more</li> : null}
                            </ul>
                          )}
                        </td>
                        <td className="px-3 py-1.5">
                          {r.status === "error" ? <Badge variant="outline" className="border-destructive/40 text-destructive">Error</Badge> : (
                            <Select value={r.action ?? "create"} onValueChange={(v) => void setAction(r.rowNumber, v)}>
                              <SelectTrigger className="h-7 w-28" aria-label={`Action for row ${r.rowNumber}`}><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="create">Create</SelectItem>
                                <SelectItem value="skip">Skip</SelectItem>
                                {r.duplicateOfId ? <SelectItem value="merge">Merge into existing</SelectItem> : null}
                              </SelectContent>
                            </Select>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollArea>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setStep("mapping")}>Back to mapping</Button>
                <Button type="button" onClick={() => void commit()} disabled={busy}>
                  <CheckCircle2 className="ml-1 h-4 w-4" /> Commit import
                </Button>
              </div>
            </div>
          ) : null}

          {step === "committing" ? (
            <div className="grid place-items-center gap-3 py-14" role="status">
              <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden />
              <p className="text-sm font-medium">Importing… {stats?.processed ?? 0} / {stats?.rows ?? 0} rows</p>
              <Progress value={stats && stats.rows ? Math.round(((stats.processed ?? 0) / stats.rows) * 100) : 0} className="w-64" />
              <p className="text-xs text-muted-foreground">{stats?.created ?? 0} created · {stats?.merged ?? 0} merged · {stats?.skipped ?? 0} skipped · {stats?.failed ?? 0} failed</p>
            </div>
          ) : null}

          {step === "done" && stats ? (
            <div className="space-y-4">
              <div className="grid gap-2 rounded-xl border p-4 sm:grid-cols-4">
                <Stat label="Created" value={stats.created ?? 0} tone="ok" />
                <Stat label="Merged" value={stats.merged ?? 0} />
                <Stat label="Skipped" value={stats.skipped ?? 0} />
                <Stat label="Failed" value={stats.failed ?? 0} tone={stats.failed ? "bad" : undefined} />
              </div>
              {(stats.failed ?? 0) > 0 ? (
                <div className="flex items-center justify-between rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
                  <span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-destructive" aria-hidden /> Some rows failed.</span>
                  <Button type="button" size="sm" variant="outline" onClick={downloadErrors}><Download className="h-3.5 w-3.5" /> Error report</Button>
                </div>
              ) : null}
              <UndoBanner jobId={jobId} onUndo={() => { void rollback(jobId!); }} onClose={closeAll} />
              <div className="flex justify-end"><Button type="button" onClick={closeAll}>Close</Button></div>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function mappingHasName(mapping: Record<string, string>): boolean {
  const vals = new Set(Object.values(mapping));
  return vals.has("firstName") && vals.has("lastName");
}

function DryRunSummary({ stats, counts }: { stats: ImportJobStats | null; counts: { ready: number; dupes: number; errors: number; issues: number } }) {
  return (
    <div className="flex flex-wrap gap-2 text-xs" aria-label="Dry-run summary">
      <Badge variant="outline" className="gap-1"><Users className="h-3 w-3" aria-hidden /> {stats?.rows ?? 0} rows</Badge>
      <Badge variant="outline" className="gap-1 border-primary/40 text-primary"><CheckCircle2 className="h-3 w-3" aria-hidden /> {counts.ready} ready to create</Badge>
      {counts.dupes ? <Badge variant="outline" className="gap-1 border-warning/40 text-warning"><AlertTriangle className="h-3 w-3" aria-hidden /> {counts.dupes} possible duplicates</Badge> : null}
      {counts.errors ? <Badge variant="outline" className="gap-1 border-destructive/40 text-destructive"><X className="h-3 w-3" aria-hidden /> {counts.errors} errors</Badge> : null}
      {counts.issues ? <Badge variant="outline" className="gap-1"><SkipForward className="h-3 w-3" aria-hidden /> {counts.issues} normalizations</Badge> : null}
    </div>
  );
}

function UndoBanner({ jobId, onUndo, onClose }: { jobId: string | null; onUndo: () => void; onClose: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
      <span className="flex items-center gap-2">
        <History className="h-4 w-4 text-warning" aria-hidden />
        Made a mistake? You can undo this import within 7 days — every person it created will be removed.
      </span>
      <div className="flex gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onUndo} disabled={!jobId}>
          <RotateCcw className="h-3.5 w-3.5" /> Undo this import
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>Keep and close</Button>
      </div>
    </div>
  );
}

function RecentJobs({ jobs, onUndo, busy }: { jobs: ImportJobDTO[]; onUndo: (id: string) => void; busy: boolean }) {
  if (!jobs.length) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Recent imports</p>
      <ul className="space-y-1">
        {jobs.slice(0, 5).map((job) => (
          <li key={job.id} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-sm">
            <span className="min-w-0 truncate">
              {job.fileName} · {job.status.replace("_", " ")}
              {job.stats.created != null ? ` — ${job.stats.created} created` : ""}
            </span>
            {job.undoable ? (
              <Button type="button" size="sm" variant="outline" className="h-7 shrink-0" disabled={busy} onClick={() => onUndo(job.id)}>
                <RotateCcw className="h-3 w-3" /> Undo
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "ok" | "bad" }) {
  return (
    <div className="text-center">
      <p className={cn("text-2xl font-semibold tabular-nums", tone === "ok" && "text-success", tone === "bad" && "text-destructive")}>{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
