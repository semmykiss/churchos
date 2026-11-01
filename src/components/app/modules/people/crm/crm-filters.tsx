"use client";

/**
 * People CRM v2 — filter builder popover + removable condition chips.
 * Conditions are sent as JSON to POST /people/v2/list; the SERVER re-validates
 * every field/op (unknown fields 400), so this UI is convenience, not security.
 */
import { useMemo } from "react";
import { Filter, Plus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { LIFECYCLE_STAGES, STAGE_LABELS, fmtDate } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { FilterCondition, FilterGroup } from "./crm-shared";

export interface FilterOptions {
  campuses: { id: string; name: string }[];
  groups: { id: string; name: string }[];
  tags: { id: string; name: string }[];
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const AGE_CATS = [
  { value: "child", label: "Child (0–12)" },
  { value: "teen", label: "Teen (13–17)" },
  { value: "adult", label: "Adult (18–59)" },
  { value: "senior", label: "Senior (60+)" },
];

const MARITAL = [
  { value: "single", label: "Single" },
  { value: "engaged", label: "Engaged" },
  { value: "married", label: "Married" },
  { value: "widowed", label: "Widowed" },
  { value: "divorced", label: "Divorced" },
  { value: "separated", label: "Separated" },
];

type FieldKind = "select" | "setness" | "range" | "month" | "days" | "flag";

interface FieldDef {
  id: string;
  label: string;
  kind: FieldKind;
  options?: { value: string; label: string }[];
}

function fieldDefs(opts: FilterOptions): FieldDef[] {
  return [
    { id: "stage", label: "Lifecycle stage", kind: "select", options: LIFECYCLE_STAGES.map((s) => ({ value: s, label: STAGE_LABELS[s] ?? s })) },
    { id: "status", label: "Status", kind: "select", options: [{ value: "active", label: "Active" }, { value: "archived", label: "Archived" }, { value: "deceased", label: "Deceased" }] },
    { id: "ageCategory", label: "Age category", kind: "select", options: AGE_CATS },
    { id: "gender", label: "Gender", kind: "select", options: [{ value: "m", label: "Male" }, { value: "f", label: "Female" }] },
    { id: "maritalStatus", label: "Marital status", kind: "select", options: MARITAL },
    { id: "campus", label: "Campus", kind: "select", options: opts.campuses.map((c) => ({ value: c.id, label: c.name })) },
    { id: "group", label: "Group", kind: "select", options: opts.groups.map((g) => ({ value: g.id, label: g.name })) },
    { id: "tag", label: "Tag", kind: "select", options: opts.tags.map((t) => ({ value: t.id, label: t.name })) },
    { id: "phone", label: "Phone number", kind: "setness" },
    { id: "email", label: "Email", kind: "setness" },
    { id: "household", label: "Household", kind: "setness" },
    { id: "joined", label: "Joined", kind: "range" },
    { id: "created", label: "Record created", kind: "range" },
    { id: "lastAttended", label: "Last attended", kind: "range" },
    { id: "birthdayMonth", label: "Birthday month", kind: "month" },
    { id: "birthday", label: "Birthday upcoming", kind: "days" },
    { id: "guardian", label: "Minors without guardian", kind: "flag" },
  ];
}

function defaultCondition(field: FieldDef, opts: FilterOptions): FilterCondition | null {
  const first = field.options?.[0]?.value;
  switch (field.kind) {
    case "select":
      return first ? { field: field.id, op: "is", value: first } : null;
    case "setness":
      return { field: field.id, op: "isSet" };
    case "range":
      return { field: field.id, op: "between", value: { from: "", to: "" } };
    case "month":
      return { field: field.id, op: "is", value: 1 };
    case "days":
      return { field: field.id, op: "upcoming", value: { days: 7 } };
    case "flag":
      return { field: field.id, op: "isMissing" };
  }
  void opts;
  return null;
}

/** Drop half-configured conditions before they reach the server. */
export function sanitizeFilters(f: FilterGroup | null): FilterGroup | null {
  if (!f || f.conditions.length === 0) return null;
  const conditions = f.conditions.filter((c) => {
    if (c.op === "between") {
      const v = (c.value ?? {}) as { from?: string; to?: string };
      return Boolean(v.from || v.to);
    }
    if (c.op === "is" || c.op === "in" || c.op === "has") return c.value !== undefined && c.value !== null && c.value !== "";
    return true;
  });
  if (conditions.length === 0) return null;
  return { match: f.match, conditions };
}

function optionLabel(def: FieldDef | undefined, value: unknown): string {
  const v = String(value);
  return def?.options?.find((o) => o.value === v)?.label ?? v;
}

export function describeCondition(c: FilterCondition, opts: FilterOptions): string {
  const defs = fieldDefs(opts);
  const def = defs.find((d) => d.id === c.field);
  const label = def?.label ?? c.field;
  const range = (c.value ?? {}) as { from?: string; to?: string };
  switch (c.field) {
    case "stage":
    case "status":
    case "gender":
    case "maritalStatus":
    case "campus":
    case "group":
    case "tag":
    case "ageCategory":
      return `${label}: ${optionLabel(def, c.value)}`;
    case "phone":
    case "email":
    case "household":
      return `${label}: ${c.op === "isSet" ? "on file" : "missing"}`;
    case "joined":
    case "created":
    case "lastAttended": {
      if (c.op === "isSet") return `${label}: has attended`;
      if (c.op === "isMissing") return `${label}: never recorded`;
      const from = range.from ? fmtDate(range.from) : null;
      const to = range.to ? fmtDate(range.to) : null;
      if (from && to) return `${label}: ${from} – ${to}`;
      if (from) return `${label}: from ${from}`;
      if (to) return `${label}: until ${to}`;
      return label;
    }
    case "birthdayMonth":
      return `Birthday in ${MONTHS[Number(c.value) - 1] ?? String(c.value)}`;
    case "birthday":
      return `Birthday in ${Number((c.value as { days?: number })?.days ?? 7)} days`;
    case "guardian":
      return "Minors without guardian";
    default:
      return label;
  }
}

// ── chips row ────────────────────────────────────────────────────────────────

export function FilterChips({ filters, options, onChange }: {
  filters: FilterGroup;
  options: FilterOptions;
  onChange: (next: FilterGroup | null) => void;
}) {
  const remove = (idx: number) => {
    const next = filters.conditions.filter((_, i) => i !== idx);
    onChange(next.length > 0 ? { match: filters.match, conditions: next } : null);
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="list" aria-label="Active filters">
      <Badge
        variant="outline"
        className="cursor-pointer gap-1 border-dashed font-normal text-muted-foreground"
        role="listitem"
        onClick={() => onChange({ ...filters, match: filters.match === "all" ? "any" : "all" })}
        title="Toggle AND / OR matching"
      >
        Match: {filters.match === "all" ? "ALL" : "ANY"}
      </Badge>
      {filters.conditions.map((c, i) => (
        <Badge key={`${c.field}-${c.op}-${i}`} variant="secondary" className="gap-1 pr-1 font-normal" role="listitem">
          {describeCondition(c, options)}
          <button
            type="button"
            className="rounded-full p-0.5 hover:bg-foreground/10"
            aria-label={`Remove filter ${describeCondition(c, options)}`}
            onClick={() => remove(i)}
          >
            <X className="h-3 w-3" aria-hidden />
          </button>
        </Badge>
      ))}
      <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-muted-foreground" onClick={() => onChange(null)}>
        Clear all
      </Button>
    </div>
  );
}

// ── builder popover ──────────────────────────────────────────────────────────

export function FilterBuilder({ filters, options, onChange }: {
  filters: FilterGroup | null;
  options: FilterOptions;
  onChange: (next: FilterGroup | null) => void;
}) {
  const defs = useMemo(() => fieldDefs(options), [options]);
  const conditions = filters?.conditions ?? [];
  const match = filters?.match ?? "all";

  const addCondition = (fieldId: string) => {
    const def = defs.find((d) => d.id === fieldId);
    if (!def) return;
    const c = defaultCondition(def, options);
    if (!c) return;
    onChange({ match, conditions: [...conditions, c] });
  };
  const updateCondition = (idx: number, next: FilterCondition) => {
    const arr = conditions.map((c, i) => (i === idx ? next : c));
    onChange({ match, conditions: arr });
  };
  const removeCondition = (idx: number) => {
    const arr = conditions.filter((_, i) => i !== idx);
    onChange(arr.length > 0 ? { match, conditions: arr } : null);
  };

  const available = defs.filter((d) => !conditions.some((c) => c.field === d.id));

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" aria-label="Build filters">
          <Filter className="h-4 w-4" aria-hidden />
          Filter
          {conditions.length > 0 ? (
            <span className="ml-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-semibold text-primary-foreground tabular-nums">
              {conditions.length}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-84 max-w-[calc(100vw-2rem)] space-y-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold">Filters</p>
          <div className="flex overflow-hidden rounded-md border" role="group" aria-label="Match mode">
            {(["all", "any"] as const).map((m) => (
              <button
                key={m}
                type="button"
                className={cn(
                  "px-2.5 py-1 text-xs font-medium transition-colors",
                  match === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
                )}
                aria-pressed={match === m}
                onClick={() => onChange(conditions.length > 0 ? { match: m, conditions } : null)}
              >
                {m === "all" ? "Match ALL" : "Match ANY"}
              </button>
            ))}
          </div>
        </div>

        {conditions.length === 0 ? (
          <p className="text-xs leading-relaxed text-muted-foreground">
            No filters yet — add one below. Everything is checked server-side against your permissions.
          </p>
        ) : (
          <ul className="max-h-64 space-y-2.5 overflow-y-auto pr-1 scroll-slim">
            {conditions.map((c, idx) => {
              const def = defs.find((d) => d.id === c.field);
              return (
                <li key={`${c.field}-${idx}`} className="space-y-1.5 rounded-lg border p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <Label className="text-xs font-semibold">{def?.label ?? c.field}</Label>
                    <button
                      type="button"
                      className="rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      aria-label={`Remove ${def?.label ?? c.field} filter`}
                      onClick={() => removeCondition(idx)}
                    >
                      <X className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </div>
                  {def?.kind === "select" ? (
                    <Select value={String(c.value ?? "")} onValueChange={(v) => updateCondition(idx, { ...c, op: "is", value: v })}>
                      <SelectTrigger className="h-8 text-xs" aria-label={def.label}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {def.options?.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  ) : null}
                  {def?.kind === "setness" ? (
                    <Select value={c.op} onValueChange={(v) => updateCondition(idx, { ...c, op: v })}>
                      <SelectTrigger className="h-8 text-xs" aria-label={def.label}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="isSet">On file</SelectItem>
                        <SelectItem value="isMissing">Missing</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : null}
                  {def?.kind === "range" ? (
                    <div className="flex items-center gap-1.5">
                      <Input
                        type="date"
                        value={((c.value as { from?: string })?.from ?? "")}
                        onChange={(e) => updateCondition(idx, { ...c, op: "between", value: { ...(c.value as object), from: e.target.value } })}
                        className="h-8 text-xs"
                        aria-label={`${def.label} from date`}
                      />
                      <span className="text-xs text-muted-foreground">–</span>
                      <Input
                        type="date"
                        value={((c.value as { to?: string })?.to ?? "")}
                        onChange={(e) => updateCondition(idx, { ...c, op: "between", value: { ...(c.value as object), to: e.target.value } })}
                        className="h-8 text-xs"
                        aria-label={`${def.label} to date`}
                      />
                    </div>
                  ) : null}
                  {def?.kind === "month" ? (
                    <Select value={String(c.value ?? "1")} onValueChange={(v) => updateCondition(idx, { ...c, op: "is", value: Number(v) })}>
                      <SelectTrigger className="h-8 text-xs" aria-label={def.label}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {MONTHS.map((m, i) => <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  ) : null}
                  {def?.kind === "days" ? (
                    <Select
                      value={String((c.value as { days?: number })?.days ?? 7)}
                      onValueChange={(v) => updateCondition(idx, { ...c, op: "upcoming", value: { days: Number(v) } })}
                    >
                      <SelectTrigger className="h-8 text-xs" aria-label={def.label}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="7">Next 7 days</SelectItem>
                        <SelectItem value="14">Next 14 days</SelectItem>
                        <SelectItem value="30">Next 30 days</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : null}
                  {def?.kind === "flag" ? (
                    <p className="text-xs text-muted-foreground">Children under 18 with no guardian linked — a data-health gap.</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        {available.length > 0 ? (
          <Select value="" onValueChange={addCondition}>
            <SelectTrigger className="h-8 text-xs" aria-label="Add a filter condition">
              <span className="flex items-center gap-1.5 text-muted-foreground"><Plus className="h-3.5 w-3.5" aria-hidden /> Add condition</span>
            </SelectTrigger>
            <SelectContent>
              {available.map((d) => <SelectItem key={d.id} value={d.id}>{d.label}</SelectItem>)}
            </SelectContent>
          </Select>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
