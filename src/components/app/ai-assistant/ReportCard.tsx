"use client";

import { Download } from "lucide-react";
import type { AiReportCard } from "./types";

/**
 * Rich inline report card inside an assistant bubble — renders structured
 * tool results as stats + table, with a CSV export matching the platform's
 * money discipline (values arrive pre-formatted in ₦; CSV carries raw naira).
 */

function csvEscape(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(card: AiReportCard) {
  const csv = card.csv;
  if (!csv) return;
  const body = [csv.columns, ...csv.rows].map((r) => r.map(csvEscape).join(",")).join("\n");
  const blob = new Blob([`\uFEFF${body}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${csv.name}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function ReportCard({ card }: { card: AiReportCard }) {
  return (
    <div className="mt-2 overflow-hidden rounded-xl border bg-background shadow-sm">
      <div className="border-b bg-surface-sunken px-3.5 py-2.5">
        <p className="text-sm font-semibold leading-tight">{card.title}</p>
        {card.subtitle ? <p className="mt-0.5 text-[11px] text-muted-foreground">{card.subtitle}</p> : null}
      </div>
      <div className="space-y-2.5 px-3.5 py-3">
        {card.stats?.length ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {card.stats.map((s) => (
              <div key={s.label} className="rounded-lg bg-muted/50 px-2.5 py-2">
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{s.label}</p>
                <p className="mt-0.5 text-sm font-semibold tabular-nums">{s.value}</p>
              </div>
            ))}
          </div>
        ) : null}
        {card.table?.rows.length ? (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-xs">
              <thead className="bg-muted/40">
                <tr>
                  {card.table.columns.map((c) => (
                    <th key={c} className="px-2.5 py-1.5 text-left font-semibold">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {card.table.rows.slice(0, 14).map((r, ri) => (
                  <tr key={ri} className="border-t">
                    {r.map((cell, ci) => (
                      <td key={ci} className="px-2.5 py-1.5 tabular-nums">{String(cell)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {card.table.rows.length > 14 ? (
              <p className="border-t px-2.5 py-1.5 text-[11px] text-muted-foreground">
                + {card.table.rows.length - 14} more rows — export for the full set
              </p>
            ) : null}
          </div>
        ) : null}
        {card.csv ? (
          <button
            onClick={() => downloadCsv(card)}
            className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
          >
            <Download className="h-3.5 w-3.5" /> Export CSV
          </button>
        ) : null}
      </div>
    </div>
  );
}
