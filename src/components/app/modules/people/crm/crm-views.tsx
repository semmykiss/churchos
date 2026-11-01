"use client";

/**
 * People CRM v2 — Smart Lists tab (Phase 3): saved views management.
 * System defaults ship in code (immutable); personal views are private to
 * their owner; shared views need people.views.manage to create or change.
 * Opening a view just applies its filter JSON to the SAME scoped list —
 * sharing a view never widens what a viewer can see.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BookmarkPlus, Eye, LayoutGrid, Lock, Pencil, Table2, Trash2, Columns3 } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { EmptyState, ErrorBlock, LoadingBlock, useApiQuery } from "@/components/app/shared";
import { api, ApiError } from "@/lib/api";
import type { CrmViewMode, SavedViewDTO } from "./crm-shared";
import { describeCondition, type FilterOptions } from "./crm-filters";

const VIEW_ICON: Record<CrmViewMode, React.ElementType> = {
  table: Table2,
  cards: LayoutGrid,
  board: Columns3,
};

const SCOPE_LABEL: Record<SavedViewDTO["scope"], string> = {
  system: "Default",
  personal: "Personal",
  shared: "Shared",
};

export interface ViewDraft {
  filters: SavedViewDTO["filters"];
  columns: string[] | null;
  sort: { sort: string; dir: "asc" | "desc" } | null;
  viewType: CrmViewMode;
}

interface UseViews {
  views: SavedViewDTO[];
  isLoading: boolean;
  error: unknown;
  refetch: () => void;
}

function useSavedViews(): UseViews {
  const q = useApiQuery<{ items: SavedViewDTO[] }>(
    ["people", "v2", "views"],
    "/people/v2/views",
  );
  return {
    views: q.data?.items ?? [],
    isLoading: q.isLoading,
    error: q.error,
    refetch: () => void q.refetch(),
  };
}

// ── save / edit dialog ──────────────────────────────────────────────────────

export function SaveViewDialog({ open, onClose, onSaved, draft, editing, canViewsManage }: {
  open: boolean;
  onClose: () => void;
  onSaved: (view: SavedViewDTO) => void;
  /** Current list state to save (ignored when editing). */
  draft: ViewDraft;
  editing: SavedViewDTO | null;
  canViewsManage: boolean;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"personal" | "shared">("personal");
  const [viewType, setViewType] = useState<CrmViewMode>("table");
  const [saving, setSaving] = useState(false);
  const [key, setKey] = useState(0); // remount to reset fields per open

  // Reset local fields whenever the dialog opens for a different target.
  const target = editing ? editing.id : draft.filters ? JSON.stringify(draft.filters) : "blank";
  const [lastTarget, setLastTarget] = useState("");
  if (open && target !== lastTarget) {
    setLastTarget(target);
    setName(editing?.name ?? "");
    setScope(editing ? (editing.scope === "shared" ? "shared" : "personal") : "personal");
    setViewType(editing?.viewType ?? draft.viewType ?? "table");
    setKey((k) => k + 1);
  }

  const submit = async () => {
    setSaving(true);
    try {
      const view = editing
        ? await api.patch<SavedViewDTO>(`/people/v2/views/${editing.id}`, { name, scope, viewType })
        : await api.post<SavedViewDTO>("/people/v2/views", {
            name,
            scope,
            viewType,
            filters: draft.filters,
            columns: draft.columns,
            sort: draft.sort,
          });
      void qc.invalidateQueries({ queryKey: ["people", "v2", "views"] });
      toast.success(editing ? "View updated" : `“${view.name}” saved to ${view.scope === "shared" ? "Shared lists" : "your personal lists"}`);
      onSaved(view);
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save the view.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit view" : "Save as smart list"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Rename this list or change how it opens. To change its filters, open the list, adjust, and save again."
              : "The current search and filters become a reusable list."}
          </DialogDescription>
        </DialogHeader>
        <div key={key} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="view-name">Name</Label>
            <Input
              id="view-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Newcomers follow-up"
              maxLength={80}
              autoFocus
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="view-scope">Visibility</Label>
              <Select value={scope} onValueChange={(v) => setScope(v as "personal" | "shared")}>
                <SelectTrigger id="view-scope" aria-label="View visibility"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="personal">Just me</SelectItem>
                  <SelectItem value="shared" disabled={!canViewsManage}>
                    <span className="flex items-center gap-1.5">
                      {!canViewsManage ? <Lock className="h-3 w-3" aria-hidden /> : null}
                      Whole church
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
              {!canViewsManage ? (
                <p className="text-[11px] text-muted-foreground">Sharing needs the people.views.manage permission.</p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="view-type">Opens as</Label>
              <Select value={viewType} onValueChange={(v) => setViewType(v as CrmViewMode)}>
                <SelectTrigger id="view-type" aria-label="Default layout"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="table">Table</SelectItem>
                  <SelectItem value="cards">Cards</SelectItem>
                  <SelectItem value="board">Board</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="button" onClick={() => void submit()} disabled={saving || !name.trim()}>
            {editing ? "Save changes" : "Save list"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── the tab itself ──────────────────────────────────────────────────────────

export function SmartListsTab({ options, canViewsManage, onApply, onSaveCurrent }: {
  options: FilterOptions;
  canViewsManage: boolean;
  onApply: (view: SavedViewDTO) => void;
  /** Opens the SaveViewDialog pre-filled with the CURRENT list state. */
  onSaveCurrent: () => void;
}) {
  const qc = useQueryClient();
  const { views, isLoading, error, refetch } = useSavedViews();
  const [editing, setEditing] = useState<SavedViewDTO | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [deleting, setDeleting] = useState<SavedViewDTO | null>(null);
  const [deletingNow, setDeletingNow] = useState(false);

  const doDelete = async () => {
    if (!deleting) return;
    setDeletingNow(true);
    try {
      await api.del(`/people/v2/views/${deleting.id}`);
      void qc.invalidateQueries({ queryKey: ["people", "v2", "views"] });
      toast.success(`“${deleting.name}” deleted`);
      setDeleting(null);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not delete the view.");
    } finally {
      setDeletingNow(false);
    }
  };

  if (isLoading) return <LoadingBlock label="Loading smart lists…" />;
  if (error) return <ErrorBlock error={error} />;

  const groups: { scope: SavedViewDTO["scope"]; label: string; hint: string }[] = [
    { scope: "system", label: "Defaults", hint: "Shipped with ChurchOS — always up to date" },
    { scope: "shared", label: "Shared", hint: canViewsManage ? "Visible to everyone with People access" : "Curated by your church admins" },
    { scope: "personal", label: "Personal", hint: "Only you can see these" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          One-click lists built on the same permission-scoped directory — a shared list never shows you more than your role allows.
        </p>
        <Button type="button" variant="outline" onClick={onSaveCurrent}>
          <BookmarkPlus className="h-4 w-4" aria-hidden /> Save current view
        </Button>
      </div>

      {views.length === 0 ? (
        <div className="rounded-xl border bg-card">
          <EmptyState
            icon={BookmarkPlus}
            title="No smart lists yet"
            description="Set up filters on the People tab, then save them here for one-click reuse."
            action={<Button type="button" variant="outline" onClick={onSaveCurrent}>Save current view</Button>}
          />
        </div>
      ) : (
        groups.map(({ scope, label, hint }) => {
          const items = views.filter((v) => v.scope === scope);
          if (items.length === 0) return null;
          return (
            <section key={scope} aria-label={`${label} lists`}>
              <div className="mb-2 flex items-baseline gap-2">
                <h3 className="text-sm font-semibold">{label}</h3>
                <span className="text-xs text-muted-foreground">{hint}</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {items.map((v) => {
                  const Icon = VIEW_ICON[v.viewType] ?? Table2;
                  return (
                    <div key={v.id} className="flex flex-col rounded-xl border bg-card p-4 shadow-xs">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h4 className="truncate text-sm font-semibold">{v.name}</h4>
                          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                            {v.description
                              ?? (v.filters && v.filters.conditions.length > 0
                                ? v.filters.conditions.map((c) => describeCondition(c, options)).join(v.filters.match === "any" ? " · OR · " : " · AND · ")
                                : "Everyone in the directory")}
                          </p>
                        </div>
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                          <Icon className="h-3.5 w-3.5" aria-hidden />
                        </span>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-1.5">
                        <Badge variant="outline" className="font-normal text-muted-foreground">{SCOPE_LABEL[v.scope]}</Badge>
                        {v.ownerName && v.scope !== "system" ? (
                          <span className="text-[11px] text-muted-foreground">by {v.ownerName}</span>
                        ) : null}
                      </div>
                      <div className="mt-3 flex items-center gap-2 border-t pt-3">
                        <Button type="button" size="sm" className="flex-1" onClick={() => onApply(v)}>
                          <Eye className="h-3.5 w-3.5" aria-hidden /> Open list
                        </Button>
                        {v.canEdit ? (
                          <Button
                            type="button"
                            size="icon"
                            variant="outline"
                            className="h-8 w-8"
                            aria-label={`Edit ${v.name}`}
                            onClick={() => { setEditing(v); setEditOpen(true); }}
                          >
                            <Pencil className="h-3.5 w-3.5" aria-hidden />
                          </Button>
                        ) : null}
                        {v.canDelete ? (
                          <Button
                            type="button"
                            size="icon"
                            variant="outline"
                            className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                            aria-label={`Delete ${v.name}`}
                            onClick={() => setDeleting(v)}
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden />
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })
      )}

      <SaveViewDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onSaved={() => refetch()}
        editing={editing}
        draft={{ filters: null, columns: null, sort: null, viewType: editing?.viewType ?? "table" }}
        canViewsManage={canViewsManage}
      />

      <AlertDialog open={deleting !== null} onOpenChange={(o) => { if (!o) setDeleting(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleting?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The list is removed for everyone{deleting?.scope === "shared" ? " in the church" : ""}. People records are not touched.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingNow}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); void doDelete(); }}
              disabled={deletingNow}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              Delete list
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Small helper re-exported for the toolbar button. */
export function SaveCurrentViewButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <Button type="button" variant="outline" onClick={onClick} disabled={disabled} aria-label="Save current view as a smart list">
      <BookmarkPlus className="h-4 w-4" aria-hidden />
      <span className="hidden sm:inline">Save view</span>
    </Button>
  );
}
