"use client";

/**
 * HouseholdCombobox — single-select household picker. Debounced search over
 * GET /households, limited to 8 rows, with a removable chip for the pick.
 */
import { useEffect, useState } from "react";
import { Home, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useApiQuery } from "@/components/app/shared";
import { qs } from "@/lib/api";

interface HouseholdRow {
  id: string;
  name: string;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
  deletedAt?: string | null;
  canEdit: boolean;
  members: { personId: string; name: string; photoUrl?: string | null; role: string; email?: string | null; phone?: string | null }[];
}

function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function HouseholdCombobox({ value, onSelect }: {
  value: { id: string; name: string } | null;
  onSelect: (h: { id: string; name: string } | null) => void;
}) {
  const [searchText, setSearchText] = useState("");
  const q = useDebounced(searchText);
  const householdsQ = useApiQuery<{ items: HouseholdRow[] }>(
    ["households", "search", { q }],
    `/households${qs({ search: q || undefined })}`,
    { enabled: q.trim().length >= 1 },
  );

  const list = (householdsQ.data?.items ?? []).slice(0, 8);

  function choose(h: HouseholdRow) {
    onSelect({ id: h.id, name: h.name });
    setSearchText("");
  }

  function clear() {
    onSelect(null);
  }

  return (
    <div className="space-y-1.5">
      {value ? (
        <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-2 py-1">
          <Home className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-sm">{value.name}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            aria-label={`Clear ${value.name}`}
            onClick={clear}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="hc-search">Search households</Label>
        <div className="flex items-center gap-2">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <Input
            id="hc-search"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Search households…"
            className="h-8"
            aria-label="Search households"
          />
        </div>
        <ul className="max-h-48 space-y-0.5 overflow-y-auto scroll-slim rounded-md border p-1" aria-label="Household results">
          {householdsQ.isLoading ? (
            <li className="px-2 py-3 text-center text-xs text-muted-foreground">Loading…</li>
          ) : list.length === 0 ? (
            <li className="px-2 py-3 text-center text-xs text-muted-foreground">
              {searchText.trim() ? "No matches." : "Type to search…"}
            </li>
          ) : (
            list.map((h) => (
              <li key={h.id}>
                <button
                  type="button"
                  onClick={() => choose(h)}
                  className="row-hover flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors"
                >
                  <Home className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{h.name}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {h.members.length} {h.members.length === 1 ? "member" : "members"}
                    </span>
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
