"use client";

/**
 * TagPicker — inline tag badges for a person with an add/remove popover flow
 * (search existing tags via GET /tags, create-on-miss, delete via X).
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useApiQuery } from "@/components/app/shared";
import { api, ApiError, qs } from "@/lib/api";

interface TagRef {
  id: string;
  name: string;
  color?: string | null;
}

interface TagSearchItem {
  id: string;
  name: string;
  color: string;
}

function errText(err: unknown): string {
  return err instanceof ApiError ? err.message : "Something went wrong.";
}

function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function TagPicker({ personId, tags, canManage, onChanged }: {
  personId: string;
  tags: { id: string; name: string; color?: string | null }[];
  canManage: boolean;
  onChanged?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const q = useDebounced(searchText);
  const [added, setAdded] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const tagsQ = useApiQuery<{ items: TagSearchItem[] }>(
    ["tags", "search", { q }],
    `/tags${qs({ search: q || undefined })}`,
    { enabled: open },
  );

  const attached = new Set([...tags.map((t) => t.id), ...added]);
  const available = (tagsQ.data?.items ?? []).filter((t) => !attached.has(t.id));
  const canCreate = available.length === 0 && searchText.trim().length > 0;

  async function attachTag(t: TagRef) {
    setBusy(true);
    try {
      await api.post(`/people/${personId}/tags`, { tagId: t.id });
      toast.success(`Added “${t.name}” tag`);
      setAdded((prev) => [...prev, t.id]);
      onChanged?.();
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(false);
    }
  }

  async function createAndAttach() {
    const name = searchText.trim();
    if (!name) return;
    setBusy(true);
    try {
      const created = await api.post<TagSearchItem>("/tags", { name });
      await api.post(`/people/${personId}/tags`, { tagId: created.id });
      toast.success(`Added “${created.name}” tag`);
      setAdded((prev) => [...prev, created.id]);
      setSearchText("");
      onChanged?.();
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(false);
    }
  }

  async function detachTag(t: TagRef) {
    setBusy(true);
    try {
      await api.del(`/people/${personId}/tags/${t.id}`);
      toast.success(`Removed “${t.name}” tag`);
      onChanged?.();
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.map((t) => (
        <Badge key={t.id} variant="outline" className="gap-1 font-normal">
          <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: t.color || "var(--primary)" }} />
          {t.name}
          {canManage ? (
            <button
              type="button"
              aria-label={`Remove ${t.name} tag`}
              className="-mr-1 rounded-full p-0.5 transition-colors hover:bg-foreground/10"
              onClick={(e) => {
                e.stopPropagation();
                void detachTag(t);
              }}
            >
              <X className="h-3 w-3" aria-hidden />
            </button>
          ) : null}
        </Badge>
      ))}
      {tags.length === 0 && !canManage ? <span className="text-sm text-muted-foreground">No tags</span> : null}

      {canManage ? (
        <Popover
          open={open}
          onOpenChange={(o) => {
            setOpen(o);
            if (!o) {
              setSearchText("");
              setAdded([]);
            }
          }}
        >
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" size="sm" className="h-6 gap-1 rounded-full px-2 text-[11px]">
              <Plus className="h-3 w-3" aria-hidden /> Tag
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 space-y-2 p-2">
            <div className="flex items-center gap-2">
              <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <Input
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Search tags…"
                className="h-8"
                aria-label="Search tags"
              />
            </div>
            <div className="max-h-48 space-y-0.5 overflow-y-auto scroll-slim rounded-md border p-1">
              {tagsQ.isLoading ? (
                <p className="px-2 py-3 text-center text-xs text-muted-foreground">Loading…</p>
              ) : available.length > 0 ? (
                available.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    disabled={busy}
                    onClick={() => void attachTag(t)}
                    className="row-hover flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors"
                  >
                    <span
                      className="inline-block h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: t.color || "var(--primary)" }}
                    />
                    <span className="min-w-0 flex-1 truncate">{t.name}</span>
                  </button>
                ))
              ) : canCreate ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void createAndAttach()}
                  className="row-hover flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors"
                >
                  <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="truncate">Create “{searchText.trim()}”</span>
                </button>
              ) : (
                <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                  {searchText.trim() ? "No matches." : "No tags yet."}
                </p>
              )}
            </div>
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  );
}
