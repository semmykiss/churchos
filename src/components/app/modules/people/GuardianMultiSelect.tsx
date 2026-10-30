"use client";

/**
 * GuardianMultiSelect — multi-select for linking adults as guardians.
 * Debounced search via usePersonSearch; only adults (18+, or unknown age)
 * are selectable. Selected people render as removable chips above the list.
 */
import { useState } from "react";
import { Check, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PersonAvatar } from "@/components/app/shared";
import { cn } from "@/lib/utils";
import { ageOf, type PersonListItem } from "@/lib/types";
import { usePersonSearch } from "./person-search";

function fullName(p: { firstName: string; lastName: string; preferredName?: string | null }): string {
  const base = `${p.firstName} ${p.lastName}`;
  return p.preferredName ? `${base} (${p.preferredName})` : base;
}

export function GuardianMultiSelect({ value, onChange, excludePersonIds }: {
  value: string[];
  onChange: (ids: string[]) => void;
  excludePersonIds?: string[];
}) {
  const [searchText, setSearchText] = useState("");
  const { results, isLoading } = usePersonSearch(searchText);
  const [picked, setPicked] = useState<Record<string, PersonListItem>>({});

  const excluded = new Set([...(excludePersonIds ?? []), ...value]);
  const adults = results.filter((p) => {
    if (excluded.has(p.id)) return false;
    const age = ageOf(p.birthdate);
    return age == null || age >= 18;
  });

  function toggle(p: PersonListItem) {
    if (value.includes(p.id)) {
      onChange(value.filter((id) => id !== p.id));
      return;
    }
    setPicked((prev) => ({ ...prev, [p.id]: p }));
    onChange([...value, p.id]);
  }

  return (
    <div className="space-y-1.5">
      {value.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {value.map((id) => {
            const p = picked[id];
            if (!p) return null;
            return (
              <span
                key={id}
                className="flex items-center gap-1.5 rounded-full border bg-muted/40 py-0.5 pl-0.5 pr-2 text-xs font-medium"
              >
                <PersonAvatar name={fullName(p)} src={p.photoUrl} className="h-6 w-6 text-[9px]" />
                <span className="max-w-40 truncate">{fullName(p)}</span>
                <button
                  type="button"
                  aria-label={`Remove ${fullName(p)}`}
                  className="rounded-full p-0.5 transition-colors hover:bg-foreground/10"
                  onClick={() => onChange(value.filter((v) => v !== id))}
                >
                  <X className="h-3 w-3" aria-hidden />
                </button>
              </span>
            );
          })}
        </div>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="gms-search">Search adults</Label>
        <div className="flex items-center gap-2">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <Input
            id="gms-search"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Search name or email…"
            className="h-8"
            aria-label="Search adults"
          />
        </div>
        <p className="text-[11px] text-muted-foreground">Only adults can be linked as guardians.</p>
        <ul className="max-h-48 space-y-0.5 overflow-y-auto scroll-slim rounded-md border p-1" aria-label="Adult results">
          {isLoading ? (
            <li className="px-2 py-3 text-center text-xs text-muted-foreground">Loading…</li>
          ) : adults.length === 0 ? (
            <li className="px-2 py-3 text-center text-xs text-muted-foreground">
              {searchText.trim() ? "No matches." : "Type to search…"}
            </li>
          ) : (
            adults.map((p) => {
              const checked = value.includes(p.id);
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => toggle(p)}
                    aria-pressed={checked}
                    className={cn(
                      "row-hover flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                      checked && "bg-primary/15",
                    )}
                  >
                    <PersonAvatar name={fullName(p)} src={p.photoUrl} className="h-6 w-6 text-[9px]" />
                    <span className="min-w-0 flex-1 truncate">{fullName(p)}</span>
                    <span className="max-w-32 truncate text-[11px] text-muted-foreground">{p.email ?? ""}</span>
                    {checked ? <Check className="h-3.5 w-3.5 shrink-0" aria-hidden /> : null}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </div>
    </div>
  );
}
