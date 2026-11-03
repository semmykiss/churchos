"use client";

/**
 * Assets & Facilities module — ChurchOS.
 * Modernized register: tenant-scoped CRUD, maintenance log, booking workflow
 * (request → approve/decline), kobo-accurate money, matrix-based RBAC.
 * Uses the shared design system (PageHeader / StatCard / Section / EmptyState).
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, ApiError, qs } from "@/lib/api";
import {
  fmtDate,
  fmtDateTime,
  fmtMoney,
  canDo,
  type AssetDTO,
  type AssetListResp,
  type AssetDetailResp,
  type AssetGlEntryDTO,
  type AssetBookingDTO,
  type AssetBookingsResp,
  type SessionUser,
} from "@/lib/types";
import {
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  PageHeader,
  Section,
  StatCard,
  useApiQuery,
  type ModuleProps,
} from "@/components/app/shared";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertTriangle, Armchair, BadgeCheck, Building2, CalendarPlus, CalendarRange, Car, CheckCircle2,
  Cpu, Eye, Filter, Landmark, MapPin, MoreHorizontal, Music, Package, Pencil, Plus, Search,
  Send, Trash2, UserCircle, Wallet, Wrench, X, XCircle, type LucideIcon,
} from "lucide-react";

/* ───────────────────────────── constants ───────────────────────────── */

const CATEGORIES = [
  { value: "equipment", label: "Equipment", icon: Wrench },
  { value: "instrument", label: "Instruments", icon: Music },
  { value: "furniture", label: "Furniture", icon: Armchair },
  { value: "vehicle", label: "Vehicles", icon: Car },
  { value: "building", label: "Buildings", icon: Building2 },
  { value: "it", label: "IT", icon: Cpu },
] as const;

const CONDITIONS = [
  { value: "good", label: "Good" },
  { value: "fair", label: "Fair" },
  { value: "damaged", label: "Damaged" },
  { value: "unserviceable", label: "Unserviceable" },
] as const;

const STATUSES = [
  { value: "active", label: "Active" },
  { value: "in_maintenance", label: "In maintenance" },
  { value: "retired", label: "Retired" },
  { value: "disposed", label: "Disposed" },
] as const;

const CATEGORY_BADGE: Record<string, string> = {
  equipment: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-transparent",
  instrument: "bg-violet-500/10 text-violet-700 dark:text-violet-300 border-transparent",
  furniture: "bg-teal-500/10 text-teal-700 dark:text-teal-300 border-transparent",
  vehicle: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 border-transparent",
  building: "bg-primary/10 text-primary border-transparent",
  it: "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-transparent",
};

const CONDITION_BADGE: Record<string, string> = {
  good: "bg-success-bg text-success border-transparent",
  fair: "bg-warning-bg text-warning border-transparent",
  damaged: "bg-danger-bg text-danger border-transparent",
  unserviceable: "bg-muted text-muted-foreground border-transparent",
};

const ASSET_STATUS_BADGE: Record<string, string> = {
  active: "bg-success-bg text-success border-transparent",
  in_maintenance: "bg-warning-bg text-warning border-transparent",
  retired: "bg-muted text-muted-foreground border-transparent",
  disposed: "bg-muted text-muted-foreground/80 border-transparent",
};

const ASSET_STATUS_LABELS: Record<string, string> = {
  active: "Active", in_maintenance: "In maintenance", retired: "Retired", disposed: "Disposed",
};

const BOOKING_STATUS_BADGE: Record<string, string> = {
  pending: "bg-warning-bg text-warning border-transparent",
  approved: "bg-success-bg text-success border-transparent",
  declined: "bg-danger-bg text-danger border-transparent",
  cancelled: "bg-muted text-muted-foreground border-transparent",
};

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  equipment: Wrench,
  instrument: Music,
  furniture: Armchair,
  vehicle: Car,
  building: Building2,
  it: Cpu,
};

/** Fixed-asset GL account per category group — mirrors server ASSET_GL_ACCOUNT. */
const ASSET_GL_CODE: Record<string, string> = {
  equipment: "1500", instrument: "1500",
  furniture: "1510", it: "1510",
  vehicle: "1520",
  building: "1530",
};
const ASSET_GL_NAME: Record<string, string> = {
  "1500": "Fixed Assets — Equipment & Instruments",
  "1510": "Fixed Assets — Furniture & IT",
  "1520": "Fixed Assets — Vehicles",
  "1530": "Fixed Assets — Buildings & Land",
};

function categoryLabel(cat: string) {
  return CATEGORIES.find((c) => c.value === cat)?.label ?? cat;
}

function DotBadge({ label, className }: { label: string; className?: string }) {
  return (
    <Badge variant="outline" className={`gap-1.5 font-medium ${className ?? ""}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" aria-hidden />
      {label}
    </Badge>
  );
}

/* ───────────────────────────── helpers ───────────────────────────── */

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

function useDebouncedValue<T>(value: T, delay = 350): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

/** Kobo (stored) → naira string for text inputs. */
function centsToNairaInput(cents: number | null | undefined): string {
  if (cents == null) return "";
  return String(cents / 100);
}

/** Naira text input → integer kobo (null when blank/invalid). */
function nairaInputToCents(v: string): number | null {
  const s = v.trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/** ISO date → value usable in <input type="date"> */
function toDateInput(iso: string | null | undefined): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}

/** ISO datetime → value usable in <input type="datetime-local"> */
function toLocalInput(iso: string | null | undefined): string {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Next occurrence of 8pm today (sane default for a booking start). */
function defaultBookingStart(): string {
  const d = new Date();
  d.setHours(17, 0, 0, 0);
  if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
  return toLocalInput(d.toISOString());
}

/* ───────────────────────────── module ───────────────────────────── */

export default function AssetsModule({ user }: ModuleProps) {
  const canEdit = canDo(user, "assets.edit");
  const canCreate = canDo(user, "assets.create");
  const canDelete = canDo(user, "assets.delete");

  const [tab, setTab] = useState("register");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [condition, setCondition] = useState("");
  const [status, setStatus] = useState("");
  const debouncedSearch = useDebouncedValue(search, 350);

  // dialogs — forms remount (key) on every open so field state re-initializes
  // without setState-in-effect (React Compiler rule).
  const [detailId, setDetailId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [editId, setEditId] = useState<string | null>(null);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [bookingKey, setBookingKey] = useState(0);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [disposeId, setDisposeId] = useState<string | null>(null);
  const [disposeKey, setDisposeKey] = useState(0);

  const openCreate = () => { setEditId(null); setFormKey((k) => k + 1); setFormOpen(true); };
  const openEdit = (id: string) => { setEditId(id); setFormKey((k) => k + 1); setFormOpen(true); };
  const openBooking = (presetAssetId: string | null) => { setEditId(presetAssetId); setBookingKey((k) => k + 1); setBookingOpen(true); };

  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["assets"] });

  const listQ = useApiQuery<AssetListResp>(
    ["assets", "list", debouncedSearch, category, condition, status],
    `/assets${qs({ q: debouncedSearch || undefined, category: category || undefined, condition: condition || undefined, status: status || undefined, pageSize: 200 })}`
  );

  const bookingsQ = useApiQuery<AssetBookingsResp>(["assets", "bookings"], "/assets/bookings", {
    staleTime: 30_000,
  });

  const items = listQ.data?.items ?? [];
  const stats = listQ.data?.stats;
  const bookings = bookingsQ.data?.items ?? [];
  const upcoming = useMemo(
    () => bookings.filter((b) => b.status === "approved" || b.status === "pending").filter((b) => new Date(b.endAt).getTime() >= Date.now()).length,
    [bookings]
  );
  const hasFilters = !!(search || category || condition || status);

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.del(`/assets/${id}`),
    onSuccess: () => {
      toast.success("Asset deleted");
      setDeleteId(null);
      invalidate();
    },
    onError: (err) => toast.error(errorMessage(err, "Could not delete the asset.")),
  });

  const postGlMut = useMutation({
    mutationFn: (id: string) => api.post<{ id: string; reference: string | null; alreadyPosted: boolean }>(`/assets/${id}/post-acquisition`, {}),
    onSuccess: (d) => {
      toast.success(d.alreadyPosted ? "Already posted to the GL" : `Posted to the GL — ${d.reference ?? "journal created"}`);
      invalidate();
    },
    onError: (err) => toast.error(errorMessage(err, "Could not post the acquisition to the GL.")),
  });

  const deleteTarget = items.find((a) => a.id === deleteId) ?? null;
  const disposeTarget = items.find((a) => a.id === disposeId) ?? null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Assets & Facilities"
        description="Track church equipment, vehicles, instruments and rooms — with maintenance history and a booking approval workflow."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => openBooking(null)} className="gap-2">
              <CalendarPlus className="h-4 w-4" /> Book asset
            </Button>
            {canCreate && (
              <Button size="sm" onClick={openCreate} className="gap-2">
                <Plus className="h-4 w-4" /> Add asset
              </Button>
            )}
          </>
        }
      />

      {/* Stats */}
      {listQ.isLoading ? (
        <LoadingBlock label="Loading register…" />
      ) : listQ.isError ? (
        <ErrorBlock error={listQ.error} />
      ) : stats ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Total assets" value={stats.total.toLocaleString()} icon={Package} sub={`${stats.byStatus.active ?? 0} active`} tone="default" />
          <StatCard label="Total value" value={fmtMoney(stats.totalValueCents)} icon={Wallet} sub="current values" tone="positive" />
          <StatCard label="Needs attention" value={stats.needsAttention.toLocaleString()} icon={AlertTriangle} sub="damaged · in maintenance" tone={stats.needsAttention > 0 ? "warning" : "default"} />
          <StatCard label="Upcoming bookings" value={upcoming.toLocaleString()} icon={CalendarRange} sub="pending or approved" tone="violet" />
        </div>
      ) : null}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="register" className="gap-1.5"><Package className="h-4 w-4" /> Register</TabsTrigger>
          <TabsTrigger value="bookings" className="gap-1.5">
            <CalendarRange className="h-4 w-4" /> Bookings
            {bookings.some((b) => b.status === "pending") && (
              <Badge variant="outline" className="ml-1 border-transparent bg-warning-bg px-1.5 text-[10px] font-semibold text-warning">
                {bookings.filter((b) => b.status === "pending").length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ── Register tab ─────────────────────────────────────────────── */}
        <TabsContent value="register" className="space-y-4">
          <Card>
            <CardContent className="flex flex-col gap-2 p-4 sm:flex-row sm:flex-wrap sm:items-center">
              <div className="relative flex-1 sm:min-w-[240px]">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search name, tag, location, custodian…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-9 pl-9"
                  aria-label="Search assets"
                />
              </div>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="h-9 sm:w-44" aria-label="Filter by category">
                  <Filter className="mr-1.5 h-3.5 text-muted-foreground" />
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">All categories</SelectItem>
                  {CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={condition} onValueChange={setCondition}>
                <SelectTrigger className="h-9 sm:w-40" aria-label="Filter by condition">
                  <SelectValue placeholder="Condition" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">All conditions</SelectItem>
                  {CONDITIONS.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="h-9 sm:w-40" aria-label="Filter by status">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">All statuses</SelectItem>
                  {STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
              {hasFilters && (
                <Button variant="ghost" size="sm" className="gap-2" onClick={() => { setSearch(""); setCategory(""); setCondition(""); setStatus(""); }}>
                  <X className="h-3.5 w-3.5" /> Reset
                </Button>
              )}
            </CardContent>
          </Card>

          {listQ.isLoading ? (
            <LoadingBlock label="Loading assets…" />
          ) : listQ.isError ? (
            <ErrorBlock error={listQ.error} />
          ) : items.length === 0 ? (
            <Card>
              <EmptyState
                icon={Package}
                title={hasFilters ? "No assets match your filters" : "No assets registered yet"}
                description={hasFilters ? "Try adjusting the search or filters." : canCreate ? "Add your first asset to start tracking church equipment." : "Ask a church administrator to register assets."}
                action={canCreate && !hasFilters ? (
                  <Button size="sm" className="gap-2" onClick={openCreate}>
                    <Plus className="h-4 w-4" /> Add asset
                  </Button>
                ) : undefined}
              />
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((a) => (
                <AssetCard
                  key={a.id}
                  asset={a}
                  canEdit={canEdit}
                  canDelete={canDelete}
                  onView={() => setDetailId(a.id)}
                  onEdit={() => openEdit(a.id)}
                  onDelete={() => setDeleteId(a.id)}
                  onPostGl={() => postGlMut.mutate(a.id)}
                  postGlPending={postGlMut.isPending && postGlMut.variables === a.id}
                  onDispose={() => { setDisposeId(a.id); setDisposeKey((k) => k + 1); }}
                />
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Bookings tab ─────────────────────────────────────────────── */}
        <TabsContent value="bookings" className="space-y-4">
          <Section
            title="Booking requests"
            description="Anyone with access can request an asset; editors approve or decline before use."
            icon={CalendarRange}
            actions={
              <Button size="sm" variant="outline" className="gap-2" onClick={() => openBooking(null)}>
                <CalendarPlus className="h-4 w-4" /> New booking
              </Button>
            }
          >
            <BookingsPanel
              q={bookingsQ}
              canEdit={canEdit}
              canDelete={canDelete}
              onChanged={invalidate}
              onBookAgain={(assetId) => openBooking(assetId)}
            />
          </Section>
        </TabsContent>
      </Tabs>

      {/* dialogs */}
      <AssetDetailDialog
        id={detailId}
        open={!!detailId}
        canEdit={canEdit}
        onClose={() => setDetailId(null)}
        onChanged={invalidate}
        onPostGl={detailId ? () => postGlMut.mutate(detailId) : undefined}
        postGlPending={!!detailId && postGlMut.isPending && postGlMut.variables === detailId}
        onDispose={(id) => { setDetailId(null); setDisposeId(id); setDisposeKey((k) => k + 1); }}
      />
      <AssetFormDialog key={`asset-form-${formKey}`} open={formOpen} editId={editId} onClose={() => setFormOpen(false)} onSaved={invalidate} />
      <BookingFormDialog key={`booking-${bookingKey}`} open={bookingOpen} presetAssetId={editId} onClose={() => setBookingOpen(false)} onSaved={invalidate} assets={items.filter((a) => a.status === "active" || a.status === "in_maintenance")} />
      {disposeTarget && (
        <DisposalDialog
          key={`dispose-${disposeKey}`}
          asset={disposeTarget}
          open={!!disposeId}
          onClose={() => setDisposeId(null)}
          onDone={invalidate}
        />
      )}

      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this asset?</AlertDialogTitle>
            <AlertDialogDescription>
              You are about to permanently remove &quot;{deleteTarget?.name ?? ""}&quot; from the register, including its maintenance history and booking records. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={deleteMut.isPending}
              onClick={(e) => { e.preventDefault(); if (deleteId) deleteMut.mutate(deleteId); }}
            >
              {deleteMut.isPending ? "Deleting…" : "Delete asset"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ───────────────────────────── asset card ───────────────────────────── */

function AssetCard({ asset, canEdit, canDelete, onView, onEdit, onDelete, onPostGl, postGlPending, onDispose }: {
  asset: AssetDTO;
  canEdit: boolean;
  canDelete: boolean;
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onPostGl: () => void;
  postGlPending: boolean;
  onDispose: () => void;
}) {
  const Icon = CATEGORY_ICONS[asset.category] ?? Package;
  const valueCents = asset.currentValueCents ?? asset.purchaseCostCents;
  const costed = (asset.purchaseCostCents ?? 0) > 0;
  const glActionable = costed && !asset.acquisitionPosted && asset.status !== "disposed";
  return (
    <Card className="group transition-all hover:shadow-md">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-ink-muted">
              <Icon className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <button onClick={onView} className="block max-w-full truncate text-left font-medium text-ink hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" aria-label={`View ${asset.name}`}>
                {asset.name}
              </button>
              {asset.tag && <p className="truncate text-xs text-muted-foreground">Tag {asset.tag}</p>}
            </div>
          </div>
          {(canEdit || canDelete) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label={`Actions for ${asset.name}`}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={onView}><Eye className="mr-2 h-4 w-4" /> View details</DropdownMenuItem>
                {canEdit && <DropdownMenuItem onClick={onEdit}><Pencil className="mr-2 h-4 w-4" /> Edit</DropdownMenuItem>}
                {canEdit && glActionable && (
                  <DropdownMenuItem onClick={onPostGl} disabled={postGlPending}>
                    <Landmark className="mr-2 h-4 w-4" /> {postGlPending ? "Posting…" : "Post to GL"}
                  </DropdownMenuItem>
                )}
                {canEdit && asset.status !== "disposed" && (
                  <DropdownMenuItem onClick={onDispose}><Send className="mr-2 h-4 w-4" /> Record disposal…</DropdownMenuItem>
                )}
                {canDelete && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="text-danger" onClick={onDelete}><Trash2 className="mr-2 h-4 w-4" /> Delete</DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <DotBadge label={categoryLabel(asset.category)} className={CATEGORY_BADGE[asset.category]} />
          <DotBadge label={asset.condition[0].toUpperCase() + asset.condition.slice(1)} className={CONDITION_BADGE[asset.condition]} />
          <DotBadge label={ASSET_STATUS_LABELS[asset.status] ?? asset.status} className={ASSET_STATUS_BADGE[asset.status]} />
          {asset.acquisitionPosted && (
            <DotBadge label="In GL" className="bg-success-bg text-success border-transparent" />
          )}
          {glActionable && (
            <DotBadge label="Not in GL" className="bg-muted text-muted-foreground border-transparent" />
          )}
        </div>

        <div className="grid grid-cols-1 gap-1 text-xs text-muted-foreground">
          {asset.location && <p className="flex items-center gap-1.5"><MapPin className="h-3 w-3" aria-hidden /> {asset.location}</p>}
          {asset.custodianName && <p className="flex items-center gap-1.5"><UserCircle className="h-3 w-3" aria-hidden /> {asset.custodianName}</p>}
          {asset.acquiredAt && <p className="flex items-center gap-1.5"><CalendarRange className="h-3 w-3" aria-hidden /> Acquired {fmtDate(asset.acquiredAt)}</p>}
          {asset.status === "disposed" && asset.disposedAt && (
            <p className="flex items-center gap-1.5"><Send className="h-3 w-3" aria-hidden /> Disposed {fmtDate(asset.disposedAt)}{asset.disposedByName ? ` · by ${asset.disposedByName}` : ""}</p>
          )}
        </div>

        {valueCents != null && (
          <div className="border-t pt-2 text-sm font-semibold tabular-nums text-ink">{fmtMoney(valueCents)}</div>
        )}
        {asset.status === "disposed" && (
          <p className="text-xs tabular-nums text-muted-foreground">
            {(asset.disposalProceedsCents ?? 0) > 0
              ? `Sold for ${fmtMoney(asset.disposalProceedsCents ?? 0)} · book value ${fmtMoney(asset.disposalBookValueCents ?? 0)}`
              : `Written off · book value ${fmtMoney(asset.disposalBookValueCents ?? 0)}`}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/* ───────────────────────────── bookings panel ───────────────────────────── */

function BookingsPanel({ q, canEdit, canDelete, onChanged, onBookAgain }: {
  q: { data?: AssetBookingsResp; isLoading: boolean; isError: boolean; error: unknown };
  canEdit: boolean;
  canDelete: boolean;
  onChanged: () => void;
  onBookAgain: (assetId: string) => void;
}) {
  const decideMut = useMutation({
    mutationFn: (vars: { id: string; decision: "approved" | "declined" }) =>
      api.post(`/assets/bookings/${vars.id}/decision`, { decision: vars.decision }),
    onSuccess: (_d, vars) => {
      toast.success(vars.decision === "approved" ? "Booking approved" : "Booking declined");
      onChanged();
    },
    onError: (err) => toast.error(errorMessage(err, "Could not update the booking.")),
  });
  const cancelMut = useMutation({
    mutationFn: (id: string) => api.post(`/assets/bookings/${id}/cancel`),
    onSuccess: () => { toast.success("Booking cancelled"); onChanged(); },
    onError: (err) => toast.error(errorMessage(err, "Could not cancel the booking.")),
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => api.del(`/assets/bookings/${id}`),
    onSuccess: () => { toast.success("Booking removed"); onChanged(); },
    onError: (err) => toast.error(errorMessage(err, "Could not remove the booking.")),
  });

  if (q.isLoading) return <LoadingBlock label="Loading bookings…" />;
  if (q.isError) return <ErrorBlock error={q.error} />;
  const items = q.data?.items ?? [];
  if (items.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={CalendarRange}
          title="No bookings yet"
          description="Requests for rooms, vehicles and equipment will appear here."
        />
      </Card>
    );
  }

  const actions = (b: AssetBookingDTO) => (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {canEdit && b.status === "pending" && (
        <>
          <Button size="sm" variant="outline" className="h-7 gap-1 border-success/30 text-success hover:bg-success-bg" disabled={decideMut.isPending}
            onClick={() => decideMut.mutate({ id: b.id, decision: "approved" })} aria-label={`Approve ${b.title}`}>
            <CheckCircle2 className="h-3.5 w-3.5" /> Approve
          </Button>
          <Button size="sm" variant="outline" className="h-7 gap-1 border-danger/30 text-danger hover:bg-danger-bg" disabled={decideMut.isPending}
            onClick={() => decideMut.mutate({ id: b.id, decision: "declined" })} aria-label={`Decline ${b.title}`}>
            <XCircle className="h-3.5 w-3.5" /> Decline
          </Button>
        </>
      )}
      {(b.mine || canEdit) && (b.status === "pending" || b.status === "approved") && (
        <Button size="sm" variant="ghost" className="h-7 text-muted-foreground" disabled={cancelMut.isPending}
          onClick={() => cancelMut.mutate(b.id)} aria-label={`Cancel ${b.title}`}>
          Cancel
        </Button>
      )}
      {canDelete && (
        <Button size="sm" variant="ghost" className="h-7 text-muted-foreground hover:text-danger" disabled={deleteMut.isPending}
          onClick={() => deleteMut.mutate(b.id)} aria-label={`Remove ${b.title}`}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );

  return (
    <>
      {/* desktop table */}
      <Card className="hidden sm:block">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-4">Asset</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Requested by</TableHead>
                <TableHead>When</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="pr-4 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((b) => (
                <TableRow key={b.id}>
                  <TableCell className="pl-4 text-sm font-medium">
                    {b.assetName}
                    {b.assetLocation ? <span className="block text-xs text-muted-foreground">{b.assetLocation}</span> : null}
                  </TableCell>
                  <TableCell className="text-sm">
                    {b.title}
                    {b.purpose ? <span className="block max-w-64 truncate text-xs text-muted-foreground">{b.purpose}</span> : null}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{b.requesterName ?? "—"}</TableCell>
                  <TableCell className="whitespace-nowrap text-sm tabular-nums">{fmtDateTime(b.startAt)} → {fmtDateTime(b.endAt)}</TableCell>
                  <TableCell><DotBadge label={b.status[0].toUpperCase() + b.status.slice(1)} className={BOOKING_STATUS_BADGE[b.status]} /></TableCell>
                  <TableCell className="pr-4">{actions(b)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* mobile cards */}
      <div className="space-y-3 sm:hidden">
        {items.map((b) => (
          <Card key={b.id}>
            <CardContent className="space-y-2 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink">{b.title}</p>
                  <p className="text-xs text-muted-foreground">{b.assetName}{b.assetLocation ? ` · ${b.assetLocation}` : ""}</p>
                </div>
                <DotBadge label={b.status[0].toUpperCase() + b.status.slice(1)} className={BOOKING_STATUS_BADGE[b.status]} />
              </div>
              <p className="text-xs tabular-nums text-muted-foreground">{fmtDateTime(b.startAt)} → {fmtDateTime(b.endAt)}</p>
              <p className="text-xs text-muted-foreground">Requested by {b.requesterName ?? "—"}</p>
              {actions(b)}
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}

/* ───────────────────────────── detail dialog ───────────────────────────── */

function AssetDetailDialog({ id, open, canEdit, onClose, onChanged, onPostGl, postGlPending, onDispose }: {
  id: string | null;
  open: boolean;
  canEdit: boolean;
  onClose: () => void;
  onChanged: () => void;
  onPostGl?: () => void;
  postGlPending?: boolean;
  onDispose: (id: string) => void;
}) {
  const q = useApiQuery<AssetDetailResp>(["assets", "detail", id], `/assets/${id}`, { enabled: !!id && open });
  const a = q.data?.asset;
  const [maintOpen, setMaintOpen] = useState(false);
  const [maintKey, setMaintKey] = useState(0);
  const openMaint = () => { setMaintKey((k) => k + 1); setMaintOpen(true); };
  const gl = q.data?.gl;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{a ? a.name : "Asset details"}</DialogTitle>
          <DialogDescription>
            {a ? [a.tag ? `Tag ${a.tag}` : null, a.location, a.custodianName].filter(Boolean).join(" · ") || "Full record" : "Loading…"}
          </DialogDescription>
        </DialogHeader>

        {q.isLoading || !a ? (
          <LoadingBlock label="Loading asset…" />
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <DetailRow label="Category" value={categoryLabel(a.category)} />
              <DetailRow label="Condition" value={a.condition[0].toUpperCase() + a.condition.slice(1)} />
              <DetailRow label="Status" value={ASSET_STATUS_LABELS[a.status] ?? a.status} />
              <DetailRow label="Serial no." value={a.serialNumber} />
              <DetailRow label="Location" value={a.location} />
              <DetailRow label="Custodian" value={a.custodianName} />
              <DetailRow label="Acquired" value={a.acquiredAt ? fmtDate(a.acquiredAt) : null} />
              <DetailRow label="Registered by" value={a.createdByName} />
              <DetailRow label="Purchase cost" value={a.purchaseCostCents != null ? fmtMoney(a.purchaseCostCents) : null} />
              <DetailRow label="Current value" value={a.currentValueCents != null ? fmtMoney(a.currentValueCents) : null} />
            </div>

            {a.notes && (
              <div className="rounded-xl bg-muted/40 p-3 text-sm text-ink-secondary">
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Notes</p>
                {a.notes}
              </div>
            )}

            {a.status === "disposed" && (
              <div className="rounded-xl bg-muted/40 p-3 text-sm">
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Disposal record</p>
                <div className="grid grid-cols-2 gap-2">
                  <DetailRow label="Disposed on" value={a.disposedAt ? fmtDate(a.disposedAt) : null} />
                  <DetailRow label="Disposed by" value={a.disposedByName} />
                  <DetailRow label="Book value at disposal" value={a.disposalBookValueCents != null ? fmtMoney(a.disposalBookValueCents) : null} />
                  <DetailRow label="Proceeds" value={a.disposalProceedsCents != null ? fmtMoney(a.disposalProceedsCents) : null} />
                </div>
                {a.disposalNotes && <p className="mt-2 text-sm text-ink-secondary">{a.disposalNotes}</p>}
              </div>
            )}

            <Section
              title="Accounting (GL)"
              description="Double-entry postings for this asset."
              icon={Landmark}
              actions={canEdit && a.status !== "disposed" ? (
                <Button size="sm" variant="outline" className="gap-2" onClick={() => onDispose(id!)}>
                  <Send className="h-3.5 w-3.5" /> Record disposal…
                </Button>
              ) : undefined}
            >
              <div className="space-y-3">
                {gl?.acquisition ? (
                  <GlEntryCard title="Acquisition" entry={gl.acquisition} />
                ) : a.purchaseCostCents != null && a.purchaseCostCents > 0 && a.status !== "disposed" ? (
                  <div className="rounded-xl border border-dashed p-4">
                    <p className="text-sm text-ink-secondary">
                      Purchase cost {fmtMoney(a.purchaseCostCents)} is not posted to the GL yet.
                    </p>
                    {onPostGl && (
                      <Button size="sm" variant="outline" className="mt-2 gap-2" onClick={onPostGl} disabled={postGlPending}>
                        <Landmark className="h-3.5 w-3.5" /> {postGlPending ? "Posting…" : "Post acquisition to GL"}
                      </Button>
                    )}
                    <p className="mt-2 text-xs text-muted-foreground">
                      Dr {ASSET_GL_NAME[ASSET_GL_CODE[a.category] ?? "1500"]} / Cr Operating Cash — posted at the recorded cost.
                    </p>
                  </div>
                ) : a.status === "disposed" ? (
                  <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
                    No acquisition posting recorded for this asset.
                  </p>
                ) : (
                  <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
                    No purchase cost recorded — acquisitions post to the GL from the recorded cost.
                  </p>
                )}

                {gl?.disposal ? (
                  <GlEntryCard title="Disposal" entry={gl.disposal} />
                ) : a.status === "disposed" ? (
                  <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
                    Written off with no GL movement (book value and proceeds were both zero).
                  </p>
                ) : null}
              </div>
            </Section>

            <Section
              title="Maintenance history"
              description="Servicing, repairs and inspections."
              icon={Wrench}
              actions={canEdit ? (
                <Button size="sm" variant="outline" className="gap-2" onClick={openMaint}>
                  <Plus className="h-3.5 w-3.5" /> Log entry
                </Button>
              ) : undefined}
            >
              {(q.data?.maintenance?.length ?? 0) === 0 ? (
                <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">No maintenance recorded yet.</p>
              ) : (
                <ol className="space-y-2">
                  {q.data!.maintenance.map((m) => (
                    <li key={m.id} className="flex items-start justify-between gap-3 rounded-xl border p-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-ink">{m.description}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {fmtDate(m.servicedOn)}
                          {m.vendorName ? ` · ${m.vendorName}` : ""}
                          {m.performedByName ? ` · by ${m.performedByName}` : ""}
                        </p>
                      </div>
                      {m.costCents != null && <span className="shrink-0 text-sm font-semibold tabular-nums text-ink">{fmtMoney(m.costCents)}</span>}
                    </li>
                  ))}
                </ol>
              )}
            </Section>

            <Section title="Booking history" description="Most recent reservations for this asset." icon={CalendarRange}>
              {(q.data?.bookings?.length ?? 0) === 0 ? (
                <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">No bookings recorded.</p>
              ) : (
                <ol className="space-y-2">
                  {q.data!.bookings.map((b) => (
                    <li key={b.id} className="flex items-center justify-between gap-3 rounded-xl border p-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-ink">{b.title}</p>
                        <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">{fmtDateTime(b.startAt)} → {fmtDateTime(b.endAt)}</p>
                      </div>
                      <DotBadge label={b.status[0].toUpperCase() + b.status.slice(1)} className={BOOKING_STATUS_BADGE[b.status]} />
                    </li>
                  ))}
                </ol>
              )}
            </Section>
          </div>
        )}

        {a && id && (
          <MaintenanceFormDialog
            key={`maint-${maintKey}`}
            assetId={id}
            open={maintOpen}
            onClose={() => setMaintOpen(false)}
            onSaved={() => { setMaintOpen(false); onChanged(); }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function DetailRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="rounded-xl bg-muted/30 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate font-medium text-ink" title={value ?? undefined}>{value || "—"}</p>
    </div>
  );
}

/** Read-only double-entry journal card (acquisition / disposal). */
function GlEntryCard({ title, entry }: { title: string; entry: AssetGlEntryDTO }) {
  return (
    <div className="rounded-xl border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-ink">{title}</p>
        {entry.reversed
          ? <DotBadge label="Reversed" className="bg-danger-bg text-danger border-transparent" />
          : <DotBadge label="Posted" className="bg-success-bg text-success border-transparent" />}
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {entry.reference ?? "Journal"} · {fmtDate(entry.entryDate)}
      </p>
      <table className="mt-2 w-full text-xs tabular-nums">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="pb-1 font-normal">Account</th>
            <th className="pb-1 text-right font-normal">Debit</th>
            <th className="pb-1 text-right font-normal">Credit</th>
          </tr>
        </thead>
        <tbody>
          {entry.lines.map((l, i) => (
            <tr key={`${l.accountCode}-${i}`} className="border-t">
              <td className="py-1.5 pr-2">
                <span className="mr-1.5 text-muted-foreground">{l.accountCode}</span>
                {l.accountName}
              </td>
              <td className="py-1.5 text-right">{l.debitCents ? fmtMoney(l.debitCents) : ""}</td>
              <td className="py-1.5 text-right">{l.creditCents ? fmtMoney(l.creditCents) : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ───────────────────────────── maintenance form ───────────────────────────── */

function MaintenanceFormDialog({ assetId, open, onClose, onSaved }: {
  assetId: string;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  // parent remounts this dialog (key) on each open — lazy initializers are the reset
  const [servicedOn, setServicedOn] = useState(() => toDateInput(new Date().toISOString()));
  const [description, setDescription] = useState("");
  const [vendorName, setVendorName] = useState("");
  const [cost, setCost] = useState("");
  const [markInMaintenance, setMarkInMaintenance] = useState(false);

  const mut = useMutation({
    mutationFn: () =>
      api.post(`/assets/${assetId}/maintenance`, {
        servicedOn: servicedOn ? new Date(`${servicedOn}T12:00:00`).toISOString() : undefined,
        description,
        vendorName: vendorName || undefined,
        costCents: nairaInputToCents(cost),
        markInMaintenance,
      }),
    onSuccess: () => { toast.success("Maintenance logged"); onSaved(); },
    onError: (err) => toast.error(errorMessage(err, "Could not log the maintenance entry.")),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Log maintenance</DialogTitle>
          <DialogDescription>Record servicing, repairs or an inspection for this asset.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="maint-date" className="text-sm font-medium">Date</Label>
            <Input id="maint-date" type="date" value={servicedOn} onChange={(e) => setServicedOn(e.target.value)} className="h-9" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="maint-vendor" className="text-sm font-medium">Vendor / engineer</Label>
            <Input id="maint-vendor" value={vendorName} onChange={(e) => setVendorName(e.target.value)} placeholder="e.g. SoundPoint Ltd" className="h-9" />
          </div>
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor="maint-desc" className="text-sm font-medium">Work carried out *</Label>
            <Textarea id="maint-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Replaced right channel driver, cleaned faders" rows={3} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="maint-cost" className="text-sm font-medium">Cost (₦)</Label>
            <Input id="maint-cost" type="number" min="0" step="0.01" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0.00" className="h-9 tabular-nums" />
          </div>
          <label className="mt-6 flex cursor-pointer items-center gap-2 text-sm text-ink-secondary">
            <input type="checkbox" checked={markInMaintenance} onChange={(e) => setMarkInMaintenance(e.target.checked)} className="h-4 w-4 accent-[var(--primary)]" />
            Mark asset as in maintenance
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending || description.trim().length < 3} className="gap-2">
            {mut.isPending ? "Saving…" : "Save entry"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ───────────────────────────── asset form ───────────────────────────── */

function AssetFormDialog({ open, editId, onClose, onSaved }: {
  open: boolean;
  editId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!editId;
  // the parent remounts this dialog (key) on every open, so the fields child
  // below initializes once from fetched data — no setState-in-effect.
  const detailQ = useApiQuery<AssetDetailResp>(["assets", "detail", editId], `/assets/${editId}`, {
    enabled: open && isEdit,
  });
  const ready = !isEdit || detailQ.isSuccess;
  const initial = detailQ.data?.asset;

  const mut = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      isEdit ? api.patch(`/assets/${editId}`, payload) : api.post("/assets", payload),
    onSuccess: () => {
      toast.success(isEdit ? "Asset updated" : "Asset registered");
      onSaved();
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err, "Could not save the asset.")),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[620px]">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit asset" : "Add asset"}</DialogTitle>
          <DialogDescription>{isEdit ? "Update the record for this asset." : "Register a new church asset or facility."}</DialogDescription>
        </DialogHeader>

        {!ready ? (
          <LoadingBlock label="Loading asset…" />
        ) : (
          <AssetFormFields
            initial={isEdit ? initial ?? null : null}
            saving={mut.isPending}
            onSubmit={(payload) => mut.mutate(payload)}
          />
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AssetFormFields({ initial, saving, onSubmit }: {
  initial: AssetDTO | null; // null = create defaults
  saving: boolean;
  onSubmit: (payload: Record<string, unknown>) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [tag, setTag] = useState(initial?.tag ?? "");
  const [category, setCategory] = useState(initial?.category ?? "equipment");
  const [condition, setCondition] = useState(initial?.condition ?? "good");
  const [status, setStatus] = useState(initial?.status ?? "active");
  const [location, setLocation] = useState(initial?.location ?? "");
  const [custodianName, setCustodianName] = useState(initial?.custodianName ?? "");
  const [serialNumber, setSerialNumber] = useState(initial?.serialNumber ?? "");
  const [acquiredAt, setAcquiredAt] = useState(toDateInput(initial?.acquiredAt));
  const [purchaseCost, setPurchaseCost] = useState(centsToNairaInput(initial?.purchaseCostCents));
  const [currentValue, setCurrentValue] = useState(centsToNairaInput(initial?.currentValueCents));
  const [notes, setNotes] = useState(initial?.notes ?? "");

  const submit = () =>
    onSubmit({
      name,
      tag: tag || null,
      category,
      condition,
      status,
      location: location || null,
      custodianName: custodianName || null,
      serialNumber: serialNumber || null,
      acquiredAt: acquiredAt ? new Date(`${acquiredAt}T12:00:00`).toISOString() : null,
      purchaseCostCents: nairaInputToCents(purchaseCost),
      currentValueCents: nairaInputToCents(currentValue),
      notes: notes || null,
    });

  return (
    <div className="grid grid-cols-1 gap-4 py-2 sm:grid-cols-2">
      <div className="grid gap-2 sm:col-span-2">
        <Label htmlFor="asset-name" className="text-sm font-medium">Name *</Label>
        <Input id="asset-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Yamaha PSR-S975 Keyboard" className="h-9" />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="asset-tag" className="text-sm font-medium">Tag / asset ID</Label>
        <Input id="asset-tag" value={tag} onChange={(e) => setTag(e.target.value)} placeholder="e.g. GCI-AST-0001" className="h-9" />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="asset-serial" className="text-sm font-medium">Serial number</Label>
        <Input id="asset-serial" value={serialNumber} onChange={(e) => setSerialNumber(e.target.value)} placeholder="Optional" className="h-9" />
      </div>
      <div className="grid gap-2">
        <Label className="text-sm font-medium">Category</Label>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            {CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-2">
        <Label className="text-sm font-medium">Operational status</Label>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            {STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-2">
        <Label className="text-sm font-medium">Condition</Label>
        <Select value={condition} onValueChange={setCondition}>
          <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            {CONDITIONS.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="asset-acquired" className="text-sm font-medium">Acquired date</Label>
        <Input id="asset-acquired" type="date" value={acquiredAt} onChange={(e) => setAcquiredAt(e.target.value)} className="h-9" />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="asset-location" className="text-sm font-medium">Location</Label>
        <Input id="asset-location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Main Sanctuary" className="h-9" />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="asset-custodian" className="text-sm font-medium">Custodian</Label>
        <Input id="asset-custodian" value={custodianName} onChange={(e) => setCustodianName(e.target.value)} placeholder="e.g. Media Department" className="h-9" />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="asset-purchase" className="text-sm font-medium">Purchase cost (₦)</Label>
        <Input id="asset-purchase" type="number" min="0" step="0.01" inputMode="decimal" value={purchaseCost} onChange={(e) => setPurchaseCost(e.target.value)} placeholder="0.00" className="h-9 tabular-nums" />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="asset-value" className="text-sm font-medium">Current value (₦)</Label>
        <Input id="asset-value" type="number" min="0" step="0.01" inputMode="decimal" value={currentValue} onChange={(e) => setCurrentValue(e.target.value)} placeholder="0.00" className="h-9 tabular-nums" />
      </div>
      <div className="grid gap-2 sm:col-span-2">
        <Label htmlFor="asset-notes" className="text-sm font-medium">Notes</Label>
        <Textarea id="asset-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Optional — insurance details, accessories, remarks…" />
      </div>
      <div className="sm:col-span-2">
        <Button onClick={submit} disabled={saving || name.trim().length < 2} className="w-full gap-2">
          {saving ? "Saving…" : initial ? "Save changes" : "Add asset"}
        </Button>
      </div>
    </div>
  );
}

/* ───────────────────────────── booking form ───────────────────────────── */

function BookingFormDialog({ open, presetAssetId, onClose, onSaved, assets }: {
  open: boolean;
  presetAssetId: string | null;
  onClose: () => void;
  onSaved: () => void;
  assets: AssetDTO[];
}) {
  // remounted (key) per open — lazy initializers provide the defaults
  const [assetId, setAssetId] = useState(presetAssetId ?? "");
  const [title, setTitle] = useState("");
  const [purpose, setPurpose] = useState("");
  const [startAt, setStartAt] = useState(() => defaultBookingStart());
  const [endAt, setEndAt] = useState(() => {
    const d = new Date(defaultBookingStart());
    d.setHours(d.getHours() + 2);
    return toLocalInput(d.toISOString());
  });

  const mut = useMutation({
    mutationFn: () =>
      api.post("/assets/bookings", {
        assetId,
        title,
        purpose: purpose || undefined,
        startAt: startAt ? new Date(startAt).toISOString() : undefined,
        endAt: endAt ? new Date(endAt).toISOString() : undefined,
      }),
    onSuccess: () => {
      toast.success("Booking requested — pending approval");
      onSaved();
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err, "Could not create the booking.")),
  });

  const invalid = !assetId || title.trim().length < 3 || !startAt || !endAt ||
    new Date(endAt).getTime() <= new Date(startAt).getTime();

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Request a booking</DialogTitle>
          <DialogDescription>Reserve a room, vehicle or piece of equipment. A facilities editor will approve or decline it.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-4 py-2">
          <div className="grid gap-2">
            <Label className="text-sm font-medium">Asset *</Label>
            <Select value={assetId} onValueChange={setAssetId}>
              <SelectTrigger className="h-9" aria-label="Choose asset"><SelectValue placeholder="Choose an asset…" /></SelectTrigger>
              <SelectContent>
                {assets.length === 0 ? (
                  <div className="px-3 py-2 text-sm text-muted-foreground">No bookable assets — register one first.</div>
                ) : (
                  assets.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}{a.location ? ` — ${a.location}` : ""}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="bk-title" className="text-sm font-medium">Title *</Label>
            <Input id="bk-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Friday rehearsal" className="h-9" />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="bk-start" className="text-sm font-medium">Start *</Label>
              <Input id="bk-start" type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} className="h-9" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="bk-end" className="text-sm font-medium">End *</Label>
              <Input id="bk-end" type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} className="h-9" />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="bk-purpose" className="text-sm font-medium">Purpose</Label>
            <Textarea id="bk-purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)} rows={2} placeholder="Optional — what will it be used for?" />
          </div>
          {assets.length === 0 && (
            <p className="flex items-center gap-2 rounded-lg bg-warning-bg p-3 text-xs text-warning">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden /> There are no bookable assets yet — add one in the Register tab first.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending || invalid} className="gap-2">
            {mut.isPending ? "Sending…" : "Request booking"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ───────────────────────────── disposal form ───────────────────────────── */

/**
 * Record a disposal with a live double-entry preview. The journal posted by
 * the server mirrors exactly what this preview shows:
 *   Dr Cash (proceeds) + Dr Loss (NBV − proceeds)
 *   = Cr Fixed Asset (NBV) + Cr Gain (proceeds − NBV)
 */
function DisposalDialog({ asset, open, onClose, onDone }: {
  asset: AssetDTO;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [disposalDate, setDisposalDate] = useState(() => toDateInput(new Date().toISOString()));
  const [proceeds, setProceeds] = useState("");
  const [notes, setNotes] = useState("");

  const nbv = asset.currentValueCents ?? asset.purchaseCostCents ?? 0;
  const proceedsCents = nairaInputToCents(proceeds) ?? 0;
  const loss = Math.max(0, nbv - proceedsCents);
  const gain = Math.max(0, proceedsCents - nbv);
  const faCode = ASSET_GL_CODE[asset.category] ?? "1500";

  const previewLines = [
    proceedsCents > 0 && { dr: true, code: "1000", name: "Operating Cash", amount: proceedsCents },
    loss > 0 && { dr: true, code: "5900", name: "Loss on Asset Disposal", amount: loss },
    nbv > 0 && { dr: false, code: faCode, name: ASSET_GL_NAME[faCode] ?? "Fixed Assets", amount: nbv },
    gain > 0 && { dr: false, code: "4600", name: "Gain on Asset Disposal", amount: gain },
  ].filter(Boolean) as { dr: boolean; code: string; name: string; amount: number }[];
  const drTotal = previewLines.filter((l) => l.dr).reduce((s, l) => s + l.amount, 0);
  const crTotal = previewLines.filter((l) => !l.dr).reduce((s, l) => s + l.amount, 0);

  const mut = useMutation({
    mutationFn: () =>
      api.post<{ ok: boolean; journal: { id: string; reference: string | null } | null }>(`/assets/${asset.id}/dispose`, {
        disposalDate: disposalDate ? new Date(`${disposalDate}T12:00:00`).toISOString() : undefined,
        proceedsCents,
        notes: notes || undefined,
      }),
    onSuccess: (d) => {
      toast.success(d.journal?.reference ? `Disposal recorded — ${d.journal.reference} posted to the GL` : "Disposal recorded");
      onDone();
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err, "Could not record the disposal.")),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[540px]">
        <DialogHeader>
          <DialogTitle>Record disposal — {asset.name}</DialogTitle>
          <DialogDescription>
            Removes the asset from the books with a balanced journal: cash received, gain or loss on disposal, and the fixed-asset account cleared.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="dispose-date" className="text-sm font-medium">Disposal date</Label>
            <Input id="dispose-date" type="date" value={disposalDate} onChange={(e) => setDisposalDate(e.target.value)} className="h-9" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="dispose-proceeds" className="text-sm font-medium">Proceeds (₦)</Label>
            <Input
              id="dispose-proceeds" type="number" min="0" step="0.01" inputMode="decimal"
              value={proceeds} onChange={(e) => setProceeds(e.target.value)} placeholder="0.00"
              className="h-9 tabular-nums"
            />
            <p className="text-xs text-muted-foreground">Book value {fmtMoney(nbv)} · leave 0 for a write-off</p>
          </div>
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor="dispose-notes" className="text-sm font-medium">Notes</Label>
            <Textarea
              id="dispose-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
              placeholder="e.g. Sold to a member, board approval minute №12…"
            />
          </div>
        </div>

        {/* live double-entry preview */}
        <div className="rounded-xl border bg-muted/20 p-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Journal preview</p>
          {previewLines.length === 0 ? (
            <p className="text-sm text-muted-foreground">No journal — book value and proceeds are both zero, the asset is simply written off.</p>
          ) : (
            <table className="w-full text-xs tabular-nums">
              <tbody>
                {previewLines.map((l) => (
                  <tr key={l.code} className="border-t first:border-t-0">
                    <td className="py-1.5 pr-2">
                      <span className={`mr-2 inline-block w-8 text-right font-semibold ${l.dr ? "text-ink" : "pl-4 text-muted-foreground"}`}>
                        {l.dr ? "Dr" : "Cr"}
                      </span>
                      <span className="mr-1.5 text-muted-foreground">{l.code}</span>{l.name}
                    </td>
                    <td className="w-24 py-1.5 text-right">{l.dr ? fmtMoney(l.amount) : ""}</td>
                    <td className="w-24 py-1.5 text-right">{!l.dr ? fmtMoney(l.amount) : ""}</td>
                  </tr>
                ))}
                <tr className="border-t font-semibold">
                  <td className="py-1.5 pr-2 text-right text-muted-foreground">Totals</td>
                  <td className="py-1.5 text-right">{fmtMoney(drTotal)}</td>
                  <td className="py-1.5 text-right">{fmtMoney(crTotal)}</td>
                </tr>
              </tbody>
            </table>
          )}
          {previewLines.length > 0 && drTotal === crTotal && (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-success">
              <BadgeCheck className="h-3.5 w-3.5" aria-hidden /> Balanced — debits equal credits
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending} className="gap-2">
            {mut.isPending ? "Recording…" : "Record disposal"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
