"use client";

/**
 * Risk Signals — additive PersonDetailDialog section for Care Radar flags.
 * The endpoint is permission-gated server-side (care.risk.view scope rules +
 * giving-visibility stripping), so this component renders nothing when the
 * viewer has no access — hiding is UX, the server is the permission.
 */
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { fmtDate } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { LEVEL_TONE } from "@/components/app/care/care-radar";
import { CircleDot, Radar } from "lucide-react";
import { cn } from "@/lib/utils";

interface PersonFlagResp {
  flag: { id: string; riskLevel: "watch" | "elevated" | "urgent"; status: string; computedAt: string; topSignals: { type: string; severity: number; detail: string }[] } | null;
  visible: boolean;
}

export function RiskSignalsSection({ personId }: { personId: string }) {
  const q = useQuery({
    queryKey: ["risk", "person", personId],
    queryFn: () => api.get<PersonFlagResp>(`/risk/flags/person?personId=${encodeURIComponent(personId)}`),
    staleTime: 30_000,
    retry: false,
  });

  // No access / no flag / still loading → render nothing (additive, silent).
  if (!q.data?.flag) return null;

  return (
    <div>
      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Radar className="h-3.5 w-3.5" aria-hidden /> Care Radar — risk signals
      </h3>
      <div className="rounded-lg border p-3">
        <div className="flex items-center justify-between gap-2">
          <Badge variant="outline" className={cn("capitalize", LEVEL_TONE[q.data.flag.riskLevel])}>{q.data.flag.riskLevel}</Badge>
          <span className="text-[11px] text-muted-foreground">{q.data.flag.status.replace(/_/g, " ")} · {fmtDate(q.data.flag.computedAt)}</span>
        </div>
        <ul className="mt-2 space-y-1.5">
          {q.data.flag.topSignals.map((s, i) => (
            <li key={i} className="flex items-start gap-1.5 text-xs text-ink-secondary">
              <CircleDot className="mt-0.5 h-3 w-3 shrink-0 text-primary" aria-hidden />
              <span>{s.detail}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[10px] text-muted-foreground">
          Deterministic decision-support — open Care Radar for the full reasoning, trend and history.
        </p>
      </div>
    </div>
  );
}
