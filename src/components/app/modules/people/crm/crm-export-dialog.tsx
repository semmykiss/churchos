"use client";

/**
 * People CRM Phase 7 — Export dialog (CSV/XLSX).
 *
 * Exports the CURRENT filtered view (search + filter builder state + sort)
 * with the admin-chosen columns (incl. visible custom fields). The server
 * re-scopes every row through the same permission-scoped serializer used by
 * the table, so a viewer can only export fields they can already see, and
 * every export is logged (PersonExportLog) for NDPA accountability.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { Download, FileSpreadsheet, FileText, Info, Loader2, ShieldCheck } from "lucide-react";
import { EXPORT_COLUMN_CATALOG, type CustomFieldDefDTO, type ExportColumnDTO, type ExportLogEntryDTO } from "./crm-shared";

interface ExportDialogProps {
  open: boolean;
  onClose: () => void;
  /** Current view state — exported rows match exactly what the table shows. */
  search: string;
  filters: unknown;
  sort: string;
  dir: "asc" | "desc";
  /** Chosen table columns (composite ids) + visible custom field defs. */
  tableColumns: string[];
  customFields: CustomFieldDefDTO[];
}

export function ExportDialog({ open, onClose, search, filters, sort, dir, tableColumns, customFields }: ExportDialogProps) {
  const [format, setFormat] = useState<"csv" | "xlsx">("csv");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(tableColumns.length ? tableColumns : ["name", "contact", "stage"]));

  const logQ = useQuery<ExportLogEntryDTO[]>({
    queryKey: ["people", "export", "log"],
    queryFn: () => api.get<ExportLogEntryDTO[]>("/people/export-log"),
    enabled: open,
  });

  // full choice list: catalog + one entry per visible custom field
  const choices: ExportColumnDTO[] = useMemo(() => [
    ...EXPORT_COLUMN_CATALOG,
    ...customFields.map((f) => ({ id: `custom:${f.key}`, label: `${f.label} (custom)` })),
  ], [customFields]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const runExport = async () => {
    if (!selected.size) { toast.error("Choose at least one column."); return; }
    setBusy(true);
    try {
      const columns = [...selected].map((id) => ({ id, label: choices.find((c) => c.id === id)?.label }));
      const res = await fetch("/api/v1/people/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ format, columns, search: search || undefined, filters, sort, dir }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? "Export failed.");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `people-export-${new Date().toISOString().slice(0, 10)}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
      const rows = res.headers.get("x-export-rows");
      toast.success(rows ? `${rows} rows exported.` : "Export downloaded.");
      void logQ.refetch();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Export failed.");
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl overflow-hidden p-0" aria-describedby={undefined}>
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Download className="h-5 w-5 text-primary" aria-hidden /> Export people
          </DialogTitle>
          <DialogDescription>
            Exports the current view — same filters, sort and scoping as your table.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[62vh] space-y-4 overflow-y-auto px-6 py-4">
          {/* NDPA reminder */}
          <div className="flex gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5 text-xs leading-relaxed">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
            <span>
              <strong>NDPA reminder.</strong> This file contains members&apos; personal data (Nigeria Data
              Protection Act 2023). Share only with people who need it for church work, keep it secure,
              and delete it when the purpose is done. This export is logged.
            </span>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2" role="radiogroup" aria-label="File format">
              <button type="button" role="radio" aria-checked={format === "csv"} onClick={() => setFormat("csv")}
                className={cn("flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm", format === "csv" && "border-primary bg-primary/10 text-primary")}>
                <FileText className="h-4 w-4" aria-hidden /> CSV
              </button>
              <button type="button" role="radio" aria-checked={format === "xlsx"} onClick={() => setFormat("xlsx")}
                className={cn("flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm", format === "xlsx" && "border-primary bg-primary/10 text-primary")}>
                <FileSpreadsheet className="h-4 w-4" aria-hidden /> Excel
              </button>
            </div>
            <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
              <Switch id="exp-current" checked onCheckedChange={() => {}} disabled aria-describedby="exp-current-note" />
              <Label htmlFor="exp-current" id="exp-current-note" className="text-muted-foreground">Current view filters</Label>
            </div>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <Label className="text-sm">Columns</Label>
              <div className="flex gap-1">
                <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSelected(new Set(choices.map((c) => c.id)))}>Select all</Button>
                <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSelected(new Set())}>Clear</Button>
              </div>
            </div>
            <ScrollArea className="max-h-64 rounded-lg border p-2">
              <ul className="grid gap-1 sm:grid-cols-2">
                {choices.map((c) => (
                  <li key={c.id}>
                    <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-surface-sunken">
                      <Checkbox checked={selected.has(c.id)} onCheckedChange={() => toggle(c.id)} aria-label={c.label} />
                      <span className="truncate">{c.label}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </ScrollArea>
            {selected.size ? <Badge variant="outline" className="mt-2">{selected.size} columns</Badge> : null}
          </div>

          {logQ.data?.length ? (
            <div>
              <p className="mb-1 flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <Info className="h-3.5 w-3.5" aria-hidden /> Recent exports
              </p>
              <ul className="space-y-1 text-xs text-muted-foreground">
                {logQ.data.slice(0, 5).map((e) => (
                  <li key={e.id} className="flex justify-between gap-2 rounded border px-2 py-1">
                    <span>{e.userName} · {e.format.toUpperCase()} · {e.rowCount} rows</span>
                    <time dateTime={e.createdAt}>{new Date(e.createdAt).toLocaleString()}</time>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 border-t px-6 py-3">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="button" onClick={() => void runExport()} disabled={busy || !selected.size}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
            Export {format.toUpperCase()}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
