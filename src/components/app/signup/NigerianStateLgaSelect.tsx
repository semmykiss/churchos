"use client";

/**
 * NigerianStateLgaSelect — cascading State → LGA dropdowns (spec §7).
 * Data-driven from the 36-states + FCT / 774-LGA roll in @/lib/nigeria.
 */
import { useMemo } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { STATE_LGAS, NIGERIAN_STATES } from "@/lib/nigeria";

export function NigerianStateLgaSelect({
  state,
  lga,
  onState,
  onLga,
  idPrefix = "addr",
  disabled = false,
}: {
  state: string;
  lga: string;
  onState: (v: string) => void;
  onLga: (v: string) => void;
  idPrefix?: string;
  disabled?: boolean;
}) {
  const lgas = useMemo(() => (state ? STATE_LGAS[state] ?? [] : []), [state]);

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-state`}>State</Label>
        <Select
          value={state || undefined}
          onValueChange={(v) => { onState(v); onLga(""); }}
          disabled={disabled}
        >
          <SelectTrigger id={`${idPrefix}-state`} className="w-full">
            <SelectValue placeholder="Select a state" />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            {NIGERIAN_STATES.map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-lga`}>LGA (Local Government Area)</Label>
        <Select
          value={lga || undefined}
          onValueChange={onLga}
          disabled={disabled || !state}
        >
          <SelectTrigger id={`${idPrefix}-lga`} className="w-full">
            <SelectValue placeholder={state ? "Select an LGA" : "Choose a state first"} />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            {lgas.map((l) => (
              <SelectItem key={l} value={l}>{l}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
