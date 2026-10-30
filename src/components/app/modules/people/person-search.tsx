"use client";

/**
 * Reusable person-search primitives for the People module:
 * `usePersonSearch` — debounced directory search (active people only), and
 * `PersonCombobox` — single-select person picker with a removable chip.
 */
import { useEffect, useState } from "react";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PersonAvatar, useApiQuery } from "@/components/app/shared";
import { qs } from "@/lib/api";
import { type Paged, type PersonListItem } from "@/lib/types";

function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function fullName(p: { firstName: string; lastName: string; preferredName?: string | null }): string {
  const base = `${p.firstName} ${p.lastName}`;
  return p.preferredName ? `${base} (${p.preferredName})` : base;
}

/** Debounced person search — returns [] while the text is empty. */
export function usePersonSearch(searchText: string) {
  const q = useDebounced(searchText);
  const query = useApiQuery<Paged<PersonListItem>>(
    ["people", "search", { q }],
    `/people${qs({ search: q || undefined, status: undefined, pageSize: 25 })}`,
    { enabled: q.trim().length >= 1 },
  );
  return {
    results: q.trim().length === 0 ? [] : (query.data?.items ?? []),
    isLoading: query.isLoading,
  };
}

/** Single-select person picker — search list + removable chip for the pick. */
export function PersonCombobox({ value, onSelect, placeholder, excludePersonIds }: {
  value: string | null;
  onSelect: (p: PersonListItem | null) => void;
  placeholder?: string;
  excludePersonIds?: string[];
}) {
  const [searchText, setSearchText] = useState("");
  const { results, isLoading } = usePersonSearch(searchText);
  // Resolved people by id, so the chip can render from the controlled `value`
  // without sync effects (parent clearing `value` hides the chip naturally).
  const [resolved, setResolved] = useState<Record<string, PersonListItem>>({});

  const picked = value ? (resolved[value] ?? null) : null;
  const excluded = new Set(excludePersonIds ?? []);
  const list = results.filter((p) => p.id !== value && !excluded.has(p.id));

  function choose(p: PersonListItem) {
    setResolved((prev) => ({ ...prev, [p.id]: p }));
    setSearchText("");
    onSelect(p);
  }

  function clear() {
    onSelect(null);
  }

  return (
    <div className="space-y-1.5">
      {picked ? (
        <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-2 py-1">
          <PersonAvatar name={fullName(picked)} src={picked.photoUrl} className="h-6 w-6 text-[9px]" />
          <span className="min-w-0 flex-1 truncate text-sm">{fullName(picked)}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            aria-label={`Clear ${fullName(picked)}`}
            onClick={clear}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="pc-search">Search people</Label>
        <div className="flex items-center gap-2">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <Input
            id="pc-search"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder={placeholder ?? "Search name or email…"}
            className="h-8"
            aria-label="Search people"
          />
        </div>
        <ul className="max-h-48 space-y-0.5 overflow-y-auto scroll-slim rounded-md border p-1" aria-label="People results">
          {isLoading ? (
            <li className="px-2 py-3 text-center text-xs text-muted-foreground">Loading…</li>
          ) : list.length === 0 ? (
            <li className="px-2 py-3 text-center text-xs text-muted-foreground">
              {searchText.trim() ? "No matches." : "Type to search…"}
            </li>
          ) : (
            list.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => choose(p)}
                  className="row-hover flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors"
                >
                  <PersonAvatar name={fullName(p)} src={p.photoUrl} className="h-6 w-6 text-[9px]" />
                  <span className="min-w-0 flex-1 truncate">{fullName(p)}</span>
                  <span className="max-w-32 truncate text-[11px] text-muted-foreground">{p.email ?? p.phone ?? ""}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
