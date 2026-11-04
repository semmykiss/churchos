"use client";

/**
 * Partner Console — Church Tenants.
 *
 * Security-audit upgrade:
 * - Server-side search/filter/pagination (PartnerTenantPage) with URL-hash sync
 *   and a debounced search input.
 * - Rows are no longer clickable; the church name is a real, keyboard-reachable
 *   button that opens the detail dialog (audit #20).
 * - Suspend/reactivate REQUIRE an audited reason (>= 10 chars) via a confirm
 *   dialog; deletion is a SOFT delete with a typed-slug confirmation and a
 *   30-day recovery window.
 * - Onboarding no longer sets an owner password: the server returns a one-time
 *   invite link, and the license key is shown exactly once.
 * - Full license keys are never listed — reveal is an audited POST that copies
 *   the key to the clipboard.
 */
import { useEffect, useRef, useState, type FormEvent } from "react";
import { keepPreviousData, useQueryClient } from "@tanstack/react-query";
import { api, qs } from "@/lib/api";
import { fmtDateShort, fmtDateTime, fmtMoney } from "@/lib/types";
import type {
  PartnerLicense,
  PartnerPlan,
  PartnerTenantDetail,
  PartnerTenantPage,
  PartnerTenantRow,
  TenantDeletePreview,
} from "@/lib/types";
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader, useApiQuery } from "@/components/app/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Building2, CheckCircle2, ChevronLeft, ChevronRight, Copy, Eye, KeyRound, MoreHorizontal, Plus,
  ScrollText, Search, ShieldCheck, ShieldOff, Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  DaysLeftBadge, LicenseStatusBadge, PLAN_LABELS, TenantStatusBadge, maskLicenseKey,
} from "@/components/partner/partner-shared";
import { ConfirmActionDialog } from "@/components/partner/confirm-action-dialog";

const PAGE_SIZES = [10, 25, 50];

const STATUS_FILTER_OPTIONS = [
  { value: "all", label: "All tenants" },
  { value: "active", label: "Active only" },
  { value: "pending", label: "Pending verification" },
  { value: "suspended", label: "Suspended only" },
] as const;

/** Query params this component owns inside the `#/partner/tenants` hash. */
function readTenantsHash() {
  const sp = new URLSearchParams(window.location.hash.split("?")[1] ?? "");
  const search = sp.get("search") ?? "";
  const rawStatus = sp.get("status") ?? "all";
  const rawPage = Number.parseInt(sp.get("page") ?? "1", 10);
  return {
    search,
    status: STATUS_FILTER_OPTIONS.some((o) => o.value === rawStatus) ? rawStatus : "all",
    page: Number.isFinite(rawPage) && rawPage >= 1 ? rawPage : 1,
  };
}

export default function PartnerTenants({ onManage }: { onManage: (licenseId: string) => void }) {
  // Lazy initializers seeded from the URL hash: the FIRST render already
  // carries the deep-linked values, so react-query never fires a throwaway
  // fetch with the blank defaults before the mount effect restores them (no
  // double request on deep links). Client-only — this component mounts after
  // the "Partner console" click and never renders during SSR — so reading
  // window.location here is hydration-safe.
  const [searchInput, setSearchInput] = useState(() => readTenantsHash().search);
  const [search, setSearch] = useState(() => readTenantsHash().search);
  const [statusFilter, setStatusFilter] = useState<string>(() => readTenantsHash().status);
  const [page, setPage] = useState(() => readTenantsHash().page);
  const [pageSize, setPageSize] = useState(10);

  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [deleteRow, setDeleteRow] = useState<PartnerTenantRow | null>(null);
  const [statusAction, setStatusAction] = useState<{
    id: string;
    name: string;
    mode: "suspend" | "reactivate";
  } | null>(null);

  // The last committed search — lets the debounce effect tell "user edited the
  // query" apart from "state was restored from the URL hash" (which must not
  // reset the page). Seeded with the lazily-restored search so the first user
  // keystroke still resets the page.
  const committedSearchRef = useRef(search);

  // Mount: restore filters from the URL hash, then keep listening for
  // back/forward navigation so the hash stays the source of truth.
  useEffect(() => {
    function applyHash() {
      const restored = readTenantsHash();
      committedSearchRef.current = restored.search;
      setSearchInput(restored.search);
      setSearch(restored.search);
      setStatusFilter(restored.status);
      setPage(restored.page);
    }
    applyHash();
    window.addEventListener("hashchange", applyHash);
    window.addEventListener("popstate", applyHash);
    return () => {
      window.removeEventListener("hashchange", applyHash);
      window.removeEventListener("popstate", applyHash);
    };
  }, []);

  // Debounce the raw input into the committed search (300ms). A genuinely new
  // search always returns to page 1.
  useEffect(() => {
    const t = setTimeout(() => {
      const next = searchInput.trim();
      if (committedSearchRef.current !== next) {
        committedSearchRef.current = next;
        setSearch(next);
        setPage(1);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Mirror the filter state into the URL hash (replaceState — no history spam,
  // and it never fires hashchange, so there is no feedback loop).
  useEffect(() => {
    window.history.replaceState(
      null,
      "",
      `#/partner/tenants${qs({
        search: search || undefined,
        status: statusFilter !== "all" ? statusFilter : undefined,
        page: page > 1 ? page : undefined,
      })}`,
    );
  }, [search, statusFilter, page]);

  const { data, isLoading, error } = useApiQuery<PartnerTenantPage>(
    ["partner", "tenants", statusFilter, search, page, pageSize],
    `/partner/tenants${qs({ search, status: statusFilter, page, pageSize })}`,
    { placeholderData: keepPreviousData },
  );

  // Render-phase correction (React's blessed conditional-setState pattern —
  // deliberately NOT an effect): if the committed page sits beyond the last
  // page (e.g. the last row of the last page was just deleted), pull it back
  // so the UI never shows "page 5 of 3" with an empty table. React re-renders
  // immediately with the corrected page before anything paints.
  const maxPage = Math.max(1, data?.pageCount ?? 1);
  if (page > maxPage) setPage(maxPage);

  // Rendered rows come straight from the (possibly corrected) response — no
  // flash of a stale copy while the corrected page refetches.
  const rows = data?.rows ?? [];
  const hasFilters = search !== "" || statusFilter !== "all";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Church tenants"
        description="Every church deployment you manage. Suspend a tenant and their people are locked out at next sign-in."
        actions={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> Onboard church
          </Button>
        }
      />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search churches…"
            aria-label="Search churches by name or slug"
            className="pl-8"
          />
        </div>
        <Select
          value={statusFilter}
          onValueChange={(v) => {
            setStatusFilter(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="sm:w-44" aria-label="Filter by status"><SelectValue /></SelectTrigger>
          <SelectContent>
            {STATUS_FILTER_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <LoadingBlock label="Loading tenants…" />
      ) : error ? (
        <ErrorBlock error={error} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Building2}
          title={hasFilters ? "No churches match" : "No churches yet"}
          description={
            hasFilters
              ? "Try a different search or clear the filters."
              : "Onboard your first church to get started."
          }
        />
      ) : (
        <>
          {/* Table (md and up) */}
          <div className="hidden rounded-lg border md:block">
            <div className="max-h-[62vh] overflow-auto scroll-slim">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Church</TableHead>
                    <TableHead>License</TableHead>
                    <TableHead>Seats</TableHead>
                    <TableHead>People</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell>
                        <button
                          type="button"
                          onClick={() => setDetailId(t.id)}
                          className="rounded-sm text-left font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        >
                          {t.name}
                        </button>
                        <p className="font-mono text-[11px] text-muted-foreground">{t.slug}</p>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col items-start gap-1">
                          <LicenseStatusBadge status={t.licenseStatus} />
                          <span className="text-[11px] text-muted-foreground">{PLAN_LABELS[t.plan] ?? t.plan}</span>
                          <LicenseKeyLine t={t} />
                        </div>
                      </TableCell>
                      <TableCell>{t.seatsUsed}/{t.seats || "—"}</TableCell>
                      <TableCell>{t.people}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="text-xs">{t.expiresAt ? fmtDateShort(t.expiresAt) : "—"}</span>
                          <DaysLeftBadge daysLeft={t.daysLeft} />
                        </div>
                      </TableCell>
                      <TableCell><TenantStatusBadge status={t.status} /></TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end">
                          <TenantActionsMenu
                            t={t}
                            onManageLicense={onManage}
                            onViewDetails={() => setDetailId(t.id)}
                            onStatus={(mode) => setStatusAction({ id: t.id, name: t.name, mode })}
                            onDelete={() => setDeleteRow(t)}
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* Stacked cards (below md) */}
          <div className="space-y-3 md:hidden">
            {rows.map((t) => (
              <div key={t.id} className="space-y-3 rounded-lg border p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 space-y-0.5">
                    <button
                      type="button"
                      onClick={() => setDetailId(t.id)}
                      className="block max-w-full truncate rounded-sm text-left font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      {t.name}
                    </button>
                    <p className="truncate font-mono text-[11px] text-muted-foreground">{t.slug}</p>
                  </div>
                  <TenantActionsMenu
                    t={t}
                    onManageLicense={onManage}
                    onViewDetails={() => setDetailId(t.id)}
                    onStatus={(mode) => setStatusAction({ id: t.id, name: t.name, mode })}
                    onDelete={() => setDeleteRow(t)}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <TenantStatusBadge status={t.status} />
                  <LicenseStatusBadge status={t.licenseStatus} />
                  <span className="text-[11px] text-muted-foreground">{PLAN_LABELS[t.plan] ?? t.plan}</span>
                </div>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  <dt className="text-muted-foreground">Seats</dt>
                  <dd className="text-right font-medium">{t.seatsUsed}/{t.seats || "—"}</dd>
                  <dt className="text-muted-foreground">People</dt>
                  <dd className="text-right font-medium">{t.people}</dd>
                  <dt className="text-muted-foreground">Expires</dt>
                  <dd className="flex items-center justify-end gap-1.5">
                    <span className="font-medium">{t.expiresAt ? fmtDateShort(t.expiresAt) : "—"}</span>
                    <DaysLeftBadge daysLeft={t.daysLeft} />
                  </dd>
                </dl>
                <LicenseKeyLine t={t} />
              </div>
            ))}
          </div>

          {/* Pagination */}
          {data ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted-foreground">
                {data.total} {data.total === 1 ? "church" : "churches"} · page {data.page} of {Math.max(data.pageCount, 1)}
              </p>
              <div className="flex items-center gap-2">
                <Select
                  value={String(pageSize)}
                  onValueChange={(v) => {
                    setPageSize(Number(v));
                    setPage(1);
                  }}
                >
                  <SelectTrigger className="h-8 w-[110px]" aria-label="Rows per page"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAGE_SIZES.map((n) => (
                      <SelectItem key={n} value={String(n)}>{n} / page</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="h-4 w-4" /> Prev
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= data.pageCount}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ) : null}
        </>
      )}

      <CreateTenantDialog open={createOpen} onOpenChange={setCreateOpen} />
      <TenantDetailDialog
        tenantId={detailId}
        onClosed={() => setDetailId(null)}
        onManage={onManage}
        onRequestStatus={(tenant, mode) => setStatusAction({ id: tenant.id, name: tenant.name, mode })}
      />
      {statusAction ? (
        <TenantStatusConfirmDialog
          tenant={statusAction}
          mode={statusAction.mode}
          onClosed={() => setStatusAction(null)}
        />
      ) : null}
      {deleteRow ? <DeleteTenantDialog row={deleteRow} onClosed={() => setDeleteRow(null)} /> : null}
    </div>
  );
}

// ── row actions ──────────────────────────────────────────────────────────────

/**
 * Overflow menu shared by the table rows and the mobile cards.
 * "Manage license" uses the licenseId carried on the row — no extra fetch.
 */
function TenantActionsMenu({
  t,
  onManageLicense,
  onViewDetails,
  onStatus,
  onDelete,
}: {
  t: PartnerTenantRow;
  onManageLicense: (licenseId: string) => void;
  onViewDetails: () => void;
  onStatus: (mode: "suspend" | "reactivate") => void;
  onDelete: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          aria-label={`Actions for ${t.name}`}
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem
          disabled={!t.licenseId}
          onClick={() => {
            if (t.licenseId) onManageLicense(t.licenseId);
          }}
        >
          <KeyRound className="h-4 w-4" /> Manage license
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onViewDetails}>
          <Eye className="h-4 w-4" /> View details
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {t.status === "suspended" ? (
          <DropdownMenuItem onClick={() => onStatus("reactivate")}>
            <ShieldCheck className="h-4 w-4" /> Reactivate…
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onClick={() => onStatus("suspend")}>
            <ShieldOff className="h-4 w-4" /> Suspend…
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-danger focus:bg-danger-bg focus:text-danger"
          onClick={onDelete}
        >
          <Trash2 className="h-4 w-4" /> Delete…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Masked license key with an audited "reveal & copy" affordance. When the
 * tenant has no license at all, keeps the previous behavior: a click that
 * explains where to issue one.
 */
function LicenseKeyLine({ t }: { t: PartnerTenantRow }) {
  if (!t.licenseKey) {
    if (t.licenseId) return null;
    return (
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
        aria-label="No license yet"
        onClick={() => toast.info("No license yet — issue one from the tenant detail view.")}
      >
        <KeyRound className="h-3.5 w-3.5" /> No license
      </Button>
    );
  }
  return (
    <span className="inline-flex max-w-full items-center gap-1">
      <span className="truncate font-mono text-[11px] text-muted-foreground">{t.licenseKey}</span>
      {t.licenseId ? (
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0"
          aria-label={`Copy full license key for ${t.name}`}
          title="Reveal & copy full key (audited)"
          onClick={() => void revealLicenseKey(t)}
        >
          <Copy className="h-3 w-3" />
        </Button>
      ) : null}
    </span>
  );
}

/** Audited key reveal — the full key is copied, never rendered inline. */
async function revealLicenseKey(t: PartnerTenantRow): Promise<void> {
  if (!t.licenseId) return;
  try {
    const res = await api.post<{ key: string }>(`/partner/licenses/${t.licenseId}/reveal-key`);
    try {
      await navigator.clipboard.writeText(res.key);
      toast.success("Full key copied — reveal recorded on the audit trail.");
    } catch {
      // Clipboard unavailable (e.g. insecure context) — NEVER render the key.
      // The reveal was audited, so it can simply be repeated once clipboard
      // access works.
      toast.error("Could not access the clipboard. Use Reveal again to copy.");
    }
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "Could not reveal the license key.");
  }
}

// ── suspend / reactivate (shared by table + detail dialog) ───────────────────

function TenantStatusConfirmDialog({
  tenant,
  mode,
  onClosed,
}: {
  tenant: { id: string; name: string };
  mode: "suspend" | "reactivate";
  onClosed: () => void;
}) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  async function onConfirm(reason: string) {
    setBusy(true);
    try {
      await api.patch(`/partner/tenants/${tenant.id}/status`, {
        status: mode === "suspend" ? "suspended" : "active",
        reason,
      });
      toast.success(
        mode === "suspend" ? `${tenant.name} suspended — sign-ins blocked.` : `${tenant.name} reactivated.`,
      );
      await queryClient.invalidateQueries({ queryKey: ["partner"] });
      onClosed();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Status change failed.");
    } finally {
      setBusy(false);
    }
  }

  if (mode === "suspend") {
    return (
      <ConfirmActionDialog
        open
        onOpenChange={(o) => {
          if (!o) onClosed();
        }}
        tone="destructive"
        title={`Suspend ${tenant.name}?`}
        description="Suspends the license and blocks all church sign-in until reactivated."
        impacts={[
          "Every user at this church loses access immediately",
          "The reason is stored on the partner and organization audit trails",
        ]}
        confirmLabel="Suspend church"
        reason={{
          label: "Reason for suspension",
          minLength: 10,
          placeholder: "e.g. Invoice unpaid after 60 days",
        }}
        busy={busy}
        onConfirm={onConfirm}
      />
    );
  }

  return (
    <ConfirmActionDialog
      open
      onOpenChange={(o) => {
        if (!o) onClosed();
      }}
      tone="default"
      title={`Reactivate ${tenant.name}?`}
      description="Restores sign-in and license validity."
      confirmLabel="Reactivate church"
      reason={{ label: "Reason for reactivation", minLength: 10 }}
      busy={busy}
      onConfirm={onConfirm}
    />
  );
}

// ── create tenant (no password — one-time invite link) ───────────────────────

/**
 * Idempotency key that also works on non-secure origins, where
 * crypto.randomUUID is unavailable (http:// LAN deployments, older browsers).
 */
function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

const INITIAL_TENANT_FORM = {
  name: "",
  slug: "",
  plan: "growth",
  seats: "250",
  termMonths: "12",
  licenseStatus: "trial",
  ownerName: "",
  ownerEmail: "",
  notes: "",
};

interface OnboardTenantResponse {
  id: string;
  name: string;
  slug: string;
  /** FULL license key — shown exactly once, right here. */
  licenseKey: string;
  plan: string;
  seats: number;
  status: string;
  expiresAt: string | null;
  /** One-time owner sign-in link (path, e.g. /?magic=token). */
  inviteLink: string;
}

function CreateTenantDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ ...INITIAL_TENANT_FORM });
  const [busy, setBusy] = useState(false);
  // Success step — the dialog stays open with the invite link and the one-time
  // license key until the user dismisses it (credentials are too important to
  // leave in a transient toast).
  const [onboarded, setOnboarded] = useState<OnboardTenantResponse | null>(null);
  const seatsTouchedRef = useRef(false);
  // One key per logical submission: a retry after a network failure reuses it
  // so the server can dedupe; a fresh submission gets a new one.
  const idemKey = useRef<string>(newIdempotencyKey());

  const { data: plansData } = useApiQuery<{ plans: PartnerPlan[] }>(["partner", "plans"], "/partner/plans");
  const plans = plansData?.plans ?? [];

  const seatsNum = Number(form.seats);
  const seatsValid = Number.isInteger(seatsNum) && seatsNum >= 1 && seatsNum <= 10000;

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  /** Plan change suggests the plan's default seats until the field is touched. */
  function handlePlanChange(key: string) {
    setForm((f) => {
      if (seatsTouchedRef.current) return { ...f, plan: key };
      const suggested = plans.find((p) => p.key === key)?.defaultSeats;
      return suggested ? { ...f, plan: key, seats: String(suggested) } : { ...f, plan: key };
    });
  }

  function reset() {
    setForm({ ...INITIAL_TENANT_FORM });
    seatsTouchedRef.current = false;
  }

  /** Done / Cancel / overlay close — the next onboarding always starts clean. */
  function closeDialog() {
    setOnboarded(null);
    reset();
    onOpenChange(false);
  }

  function copyInviteLink() {
    if (!onboarded) return;
    navigator.clipboard
      .writeText(window.location.origin + onboarded.inviteLink)
      .then(() => toast.success("Invite link copied."))
      .catch(() => toast.error("Could not access the clipboard."));
  }

  function copyLicenseKey() {
    if (!onboarded) return;
    navigator.clipboard
      .writeText(onboarded.licenseKey)
      .then(() => toast.success("License key copied."))
      .catch(() => toast.error("Could not access the clipboard."));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!seatsValid) {
      toast.error("Seats must be between 1 and 10,000.");
      return;
    }
    setBusy(true);
    try {
      const created = await api.post<OnboardTenantResponse>(
        "/partner/tenants",
        {
          name: form.name,
          slug: form.slug.trim().toLowerCase() || undefined,
          plan: form.plan,
          seats: seatsNum,
          termMonths: Number(form.termMonths),
          licenseStatus: form.licenseStatus,
          notes: form.notes.trim() || undefined,
          owner: { name: form.ownerName, email: form.ownerEmail.trim() },
        },
        { headers: { "Idempotency-Key": idemKey.current } },
      );
      // Switch to the success step and KEEP the dialog open — the invite link
      // and one-time key stay copyable until the user presses Done. Nothing
      // but the church name leaves the dialog via toast.
      setOnboarded(created);
      toast.success(`${created.name} onboarded.`);
      idemKey.current = newIdempotencyKey();
      await queryClient.invalidateQueries({ queryKey: ["partner"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Onboarding failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) closeDialog(); }}>
      <DialogContent className="max-h-[88vh] max-w-xl overflow-y-auto scroll-slim">
        {onboarded ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-success" aria-hidden /> Church onboarded
              </DialogTitle>
              <DialogDescription>
                {onboarded.name} is ready. Copy the invite link to hand to the owner, and store the license key now.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-1">
              <div className="rounded-lg border p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-medium text-muted-foreground">Owner invite link (one-time, expires in 24 hours)</p>
                  <Button type="button" size="sm" variant="outline" onClick={copyInviteLink}>Copy</Button>
                </div>
                <p className="mt-1 truncate font-mono text-xs" title={window.location.origin + onboarded.inviteLink}>
                  {window.location.origin + onboarded.inviteLink}
                </p>
              </div>

              <div className="rounded-lg border p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-medium text-muted-foreground">License key (shown only once)</p>
                  <Button type="button" size="sm" variant="outline" onClick={copyLicenseKey}>Copy</Button>
                </div>
                <p className="mt-1 break-all font-mono text-xs">{onboarded.licenseKey}</p>
                <p className="mt-1.5 text-[11px] text-muted-foreground">Store it now — it is masked everywhere else.</p>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" onClick={closeDialog}>Done</Button>
            </DialogFooter>
          </>
        ) : (
        <>
        <DialogHeader>
          <DialogTitle>Onboard a church</DialogTitle>
          <DialogDescription>
            Creates the tenant (organization, main campus, default roles) and the license in one step. No password is
            set here — the owner receives a one-time invite link to sign in.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4 py-1">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="ct-name">Church name *</Label>
              <Input
                id="ct-name"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="New Life Fellowship"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ct-slug">Slug (optional)</Label>
              <Input
                id="ct-slug"
                value={form.slug}
                onChange={(e) => set("slug", e.target.value)}
                placeholder="auto from name"
                autoCapitalize="none"
              />
              <p className="text-[11px] text-muted-foreground">Leave blank to auto-generate from the church name.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ct-plan">Plan</Label>
              <Select value={form.plan} onValueChange={handlePlanChange}>
                <SelectTrigger id="ct-plan"><SelectValue placeholder="Select a plan" /></SelectTrigger>
                <SelectContent>
                  {plans.length === 0 ? (
                    <SelectItem value={form.plan} disabled>Loading plans…</SelectItem>
                  ) : (
                    plans.map((p) => (
                      <SelectItem key={p.key} value={p.key}>
                        {p.label} — {fmtMoney(p.monthlyPriceCents)}/mo
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ct-seats">Seats</Label>
              <Input
                id="ct-seats"
                type="number"
                min={1}
                max={10000}
                inputMode="numeric"
                value={form.seats}
                onChange={(e) => {
                  seatsTouchedRef.current = true;
                  set("seats", e.target.value);
                }}
                error={seatsValid ? undefined : "Seats must be between 1 and 10,000."}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ct-term">Term</Label>
              <Select value={form.termMonths} onValueChange={(v) => set("termMonths", v)}>
                <SelectTrigger id="ct-term"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1 month</SelectItem>
                  <SelectItem value="12">12 months</SelectItem>
                  <SelectItem value="24">24 months</SelectItem>
                  <SelectItem value="36">36 months</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ct-license-status">License starts as</Label>
              <Select value={form.licenseStatus} onValueChange={(v) => set("licenseStatus", v)}>
                <SelectTrigger id="ct-license-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="trial">Trial</SelectItem>
                  <SelectItem value="active">Active (paid)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <Separator />
          <p className="text-xs font-medium text-muted-foreground">Owner login for the church</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ct-owner-name">Owner name *</Label>
              <Input
                id="ct-owner-name"
                value={form.ownerName}
                onChange={(e) => set("ownerName", e.target.value)}
                placeholder="Pastor Jordan Lee"
                autoComplete="name"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ct-owner-email">Owner email *</Label>
              <Input
                id="ct-owner-email"
                type="email"
                value={form.ownerEmail}
                onChange={(e) => set("ownerEmail", e.target.value)}
                placeholder="jordan@newlife.demo"
                autoComplete="email"
                required
              />
              <p className="text-[11px] text-muted-foreground">They sign in with a one-time invite link — no password.</p>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="ct-notes">License notes (optional)</Label>
              <Textarea
                id="ct-notes"
                rows={2}
                maxLength={500}
                value={form.notes}
                onChange={(e) => set("notes", e.target.value)}
                placeholder="e.g. 30-day trial, follow up Friday"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeDialog} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" loading={busy}>Create tenant</Button>
          </DialogFooter>
        </form>
        </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── tenant delete (soft delete, slug-typed confirmation, 30-day recovery) ────

function DeleteTenantDialog({ row, onClosed }: { row: PartnerTenantRow; onClosed: () => void }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  const { data: preview, isLoading: previewLoading } = useApiQuery<TenantDeletePreview>(
    ["partner", "tenant-delete-preview", row.id],
    `/partner/tenants/${row.id}/delete-preview`,
  );

  const impacts = previewLoading || !preview
    ? ["Calculating impact…"]
    : [
        `${preview.people} people records, households and attendance history`,
        `${preview.donations} giving records and the full accounting ledger`,
        `${preview.users} user account(s), unless they also belong to another church`,
        `${preview.documents} documents, messages, care notes and AI chats`,
        `${row.slug}.churchos.app will be released for reuse after the recovery window`,
      ];

  async function onConfirm(reason: string) {
    setBusy(true);
    try {
      const res = await api.post<{ name: string; recoverUntil: string }>(
        `/partner/tenants/${row.id}/delete`,
        { confirmSlug: row.slug, reason },
      );
      toast.success(`${res.name} scheduled for deletion. Recoverable until ${fmtDateShort(res.recoverUntil)}.`);
      await queryClient.invalidateQueries({ queryKey: ["partner"] });
      onClosed();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Deletion failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ConfirmActionDialog
      open
      onOpenChange={(o) => {
        if (!o) onClosed();
      }}
      tone="destructive"
      title="Delete church tenant"
      description={
        <>
          <b>{row.name}</b> is scheduled for permanent deletion. It can be restored until the recovery window closes.
        </>
      }
      impacts={impacts}
      confirmLabel="Schedule deletion"
      typedConfirm={{ expected: row.slug, label: `Type "${row.slug}" to confirm` }}
      reason={{ label: "Reason (kept on the platform audit trail)", minLength: 10 }}
      busy={busy}
      onConfirm={onConfirm}
    />
  );
}

// ── tenant detail ────────────────────────────────────────────────────────────

function TenantDetailDialog({
  tenantId,
  onClosed,
  onManage,
  onRequestStatus,
}: {
  tenantId: string | null;
  onClosed: () => void;
  onManage: (licenseId: string) => void;
  onRequestStatus: (tenant: { id: string; name: string; status: string }, mode: "suspend" | "reactivate") => void;
}) {
  const { data, isLoading, error } = useApiQuery<PartnerTenantDetail>(
    ["partner", "tenant", tenantId],
    `/partner/tenants/${tenantId}`,
    { enabled: !!tenantId },
  );

  return (
    <Dialog open={!!tenantId} onOpenChange={(o) => { if (!o) onClosed(); }}>
      <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto scroll-slim" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>
            {data ? (
              <span className="flex flex-wrap items-center gap-2">{data.name} <TenantStatusBadge status={data.status} /></span>
            ) : (
              "Church tenant"
            )}
          </DialogTitle>
          {data ? (
            <DialogDescription>
              <span className="font-mono text-xs">{data.slug}</span> · {data.timezone} · {data.currency} · onboarded {fmtDateShort(data.createdAt)}
            </DialogDescription>
          ) : (
            <DialogDescription>Loading tenant details…</DialogDescription>
          )}
        </DialogHeader>
        {isLoading || !data ? (
          <div className="py-10"><LoadingBlock label="Loading tenant…" /></div>
        ) : error ? (
          <ErrorBlock error={error} />
        ) : (
          <>
            <div className="grid gap-4 py-2 sm:grid-cols-3">
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">People records</p>
                <p className="text-lg font-semibold">{data.peopleCount}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Campuses</p>
                <p className="text-lg font-semibold">{data.campuses.length}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Users</p>
                <p className="text-lg font-semibold">{data.users.length}</p>
              </div>
            </div>

            <DetailLicenseCard license={data.license} onManage={onManage} />

            <div>
              <p className="mb-2 text-sm font-medium">Users</p>
              <div className="max-h-40 space-y-1.5 overflow-y-auto rounded-lg border p-2 scroll-slim">
                {data.users.map((u) => (
                  <div key={u.membershipId} className="flex items-center justify-between gap-2 px-1 py-0.5 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{u.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{u.email} · {u.roles.join(", ") || "no roles"}</p>
                    </div>
                    <Badge variant="secondary" className="shrink-0">{u.status}</Badge>
                  </div>
                ))}
                {data.users.length === 0 ? <p className="p-2 text-sm text-muted-foreground">No users yet.</p> : null}
              </div>
            </div>

            <div>
              <p className="mb-2 flex items-center gap-1.5 text-sm font-medium"><ScrollText className="h-4 w-4" /> Recent activity</p>
              <div className="max-h-36 space-y-1 overflow-y-auto rounded-lg border p-2 text-xs text-muted-foreground scroll-slim">
                {data.audit.map((a, i) => (
                  <p key={i}>
                    <span className="font-mono">{a.action}</span> — {a.actorLabel ?? "system"} · {fmtDateTime(a.createdAt)}
                  </p>
                ))}
                {data.audit.length === 0 ? <p className="p-2">No activity recorded.</p> : null}
              </div>
            </div>

            <DialogFooter className="gap-2">
              {data.status === "pending_verification" ? (
                <p className="mr-auto flex items-center gap-1.5 text-xs text-warning">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Awaiting compliance review — activate from the Compliance queue after CAC checks.
                </p>
              ) : data.status === "active" ? (
                <Button
                  variant="destructive"
                  onClick={() => onRequestStatus({ id: data.id, name: data.name, status: data.status }, "suspend")}
                >
                  <ShieldOff className="h-4 w-4" /> Suspend tenant
                </Button>
              ) : (
                <Button
                  onClick={() => onRequestStatus({ id: data.id, name: data.name, status: data.status }, "reactivate")}
                >
                  <ShieldCheck className="h-4 w-4" /> Reactivate tenant
                </Button>
              )}
              <Button variant="outline" onClick={onClosed}>Close</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * License block of the tenant detail dialog. The license arrives as a prop, so
 * the null narrowing survives into the click handler — no non-null assertion
 * in the JSX — and full keys stay masked (the audited reveal endpoint remains
 * the only path to the full key).
 */
function DetailLicenseCard({ license, onManage }: { license: PartnerLicense | null; onManage: (licenseId: string) => void }) {
  return (
    <div className="rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-medium">
            <KeyRound className="h-4 w-4" /> License
            <LicenseStatusBadge status={license ? license.status : "none"} />
          </p>
          {license ? (
            // Full keys are credentials — always render masked here.
            <p className="mt-0.5 font-mono text-xs text-muted-foreground">{maskLicenseKey(license.key)}</p>
          ) : null}
        </div>
        {license ? (
          <Button size="sm" variant="outline" onClick={() => onManage(license.id)}>
            Manage license
          </Button>
        ) : null}
      </div>
      {license ? (
        <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-muted-foreground sm:grid-cols-4">
          <span>Plan: <b className="text-foreground">{PLAN_LABELS[license.plan] ?? license.plan}</b></span>
          <span>Seats: <b className="text-foreground">{license.seats}</b></span>
          <span>Expires: <b className="text-foreground">{fmtDateShort(license.expiresAt)}</b></span>
          <span>Issued: <b className="text-foreground">{fmtDateShort(license.issuedAt)}</b></span>
          {license.notes ? <span className="col-span-2 sm:col-span-4">Notes: {license.notes}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
