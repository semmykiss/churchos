"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { fmtDateShort, fmtDateTime } from "@/lib/types";
import type { PartnerTenantRow, PartnerTenantDetail } from "@/lib/types";
import { LoadingBlock, ErrorBlock, EmptyState, PageHeader, useApiQuery } from "@/components/app/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { Building2, Plus, Search, ShieldOff, ShieldCheck, KeyRound, Loader2, ScrollText } from "lucide-react";
import { toast } from "sonner";
import { LicenseStatusBadge, TenantStatusBadge, DaysLeftBadge, PLAN_LABELS } from "@/components/partner/partner-shared";

export default function PartnerTenants({ onManage }: { onManage: (licenseId: string) => void }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const params = new URLSearchParams();
  if (statusFilter !== "all") params.set("status", statusFilter);
  if (search.trim()) params.set("search", search.trim());
  const q = params.size ? `?${params.toString()}` : "";
  const { data, isLoading, error } = useApiQuery<PartnerTenantRow[]>(["partner", "tenants", statusFilter, q], `/partner/tenants${q}`);

  async function toggleTenantStatus(row: PartnerTenantRow) {
    if (row.status === "pending_verification") {
      toast.info("Verify this church from the Compliance tab — activation requires the CAC checks there.");
      return;
    }
    const next = row.status === "active" ? "suspended" : "active";
    try {
      await api.patch(`/partner/tenants/${row.id}/status`, { status: next });
      toast.success(next === "suspended" ? `${row.name} suspended — sign-ins blocked.` : `${row.name} reactivated.`);
      await queryClient.invalidateQueries({ queryKey: ["partner"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Status change failed.");
    }
  }

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
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search churches…" className="pl-8" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="sm:w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All tenants</SelectItem>
            <SelectItem value="active">Active only</SelectItem>
            <SelectItem value="pending">Pending verification</SelectItem>
            <SelectItem value="suspended">Suspended only</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <LoadingBlock label="Loading tenants…" />
      ) : error ? (
        <ErrorBlock error={error} />
      ) : (data ?? []).length === 0 ? (
        <EmptyState icon={Building2} title="No churches match" description="Try a different search, or onboard your first church." />
      ) : (
        <div className="rounded-lg border">
          <div className="max-h-[62vh] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Church</TableHead>
                  <TableHead>License</TableHead>
                  <TableHead>Seats</TableHead>
                  <TableHead>People</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Tenant</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data ?? []).map((t) => (
                  <TableRow key={t.id} className="cursor-pointer" onClick={() => setDetailId(t.id)}>
                    <TableCell>
                      <p className="font-medium">{t.name}</p>
                      <p className="font-mono text-[11px] text-muted-foreground">{t.slug}</p>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-1">
                        <LicenseStatusBadge status={t.licenseStatus} />
                        <span className="text-[11px] text-muted-foreground">{PLAN_LABELS[t.plan] ?? t.plan}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {t.seatsUsed}/{t.seats || "—"}
                    </TableCell>
                    <TableCell>{t.people}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="text-xs">{t.expiresAt ? fmtDateShort(t.expiresAt) : "—"}</span>
                        <DaysLeftBadge daysLeft={t.daysLeft} />
                      </div>
                    </TableCell>
                    <TableCell><TenantStatusBadge status={t.status} /></TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => { if (t.licenseKey) onManageDetail(t, onManage); else toast.info("No license yet — issue one from the detail view."); }}
                        >
                          <KeyRound className="h-3.5 w-3.5" /> License
                        </Button>
                        {t.status === "pending_verification" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-amber-200 text-amber-700 hover:bg-amber-50 hover:text-amber-800"
                            title="Approval requires compliance verification"
                            onClick={() => toggleTenantStatus(t)}
                          >
                            <ShieldCheck className="h-3.5 w-3.5" /> Pending review
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant={t.status === "active" ? "ghost" : "outline"}
                            className={t.status === "active" ? "text-destructive hover:text-destructive" : ""}
                            onClick={() => toggleTenantStatus(t)}
                          >
                            {t.status === "active" ? <ShieldOff className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                            {t.status === "active" ? "Suspend" : "Reactivate"}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      <CreateTenantDialog open={createOpen} onOpenChange={setCreateOpen} />
      <TenantDetailDialog tenantId={detailId} onClosed={() => setDetailId(null)} onManage={onManage} />
    </div>
  );
}

async function onManageDetail(t: PartnerTenantRow, onManage: (id: string) => void) {
  // license id lookup happens in the detail dialog cache; simplest correct path:
  // fetch the tenant detail and open manage with its license id.
  try {
    const detail = await api.get<PartnerTenantDetail>(`/partner/tenants/${t.id}`);
    if (detail.license) onManage(detail.license.id);
    else toast.info("This tenant has no license yet.");
  } catch {
    toast.error("Could not load the license.");
  }
}

// ── create tenant ────────────────────────────────────────────────────────────

function CreateTenantDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: "",
    slug: "",
    plan: "growth",
    seats: "250",
    termMonths: "12",
    licenseStatus: "trial",
    ownerName: "",
    ownerEmail: "",
    ownerPassword: "Welcome2026!",
    notes: "",
  });
  const [busy, setBusy] = useState(false);

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const created = await api.post<{ licenseKey: string; name: string }>("/partner/tenants", {
        name: form.name,
        slug: form.slug || undefined,
        plan: form.plan,
        seats: Number(form.seats),
        termMonths: Number(form.termMonths),
        licenseStatus: form.licenseStatus,
        notes: form.notes || undefined,
        owner: { name: form.ownerName, email: form.ownerEmail, password: form.ownerPassword },
      });
      toast.success(`${created.name} onboarded. License key: ${created.licenseKey}`, { duration: 8000 });
      await queryClient.invalidateQueries({ queryKey: ["partner"] });
      onOpenChange(false);
      setForm((f) => ({ ...f, name: "", slug: "", ownerName: "", ownerEmail: "", notes: "" }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Onboarding failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Onboard a church</DialogTitle>
          <DialogDescription>
            Creates the tenant (organization, main campus, default roles), the license, and the owner login — all in one step.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4 py-1">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="ct-name">Church name *</Label>
              <Input id="ct-name" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="New Life Fellowship" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ct-slug">Slug (optional)</Label>
              <Input id="ct-slug" value={form.slug} onChange={(e) => set("slug", e.target.value)} placeholder="auto from name" />
            </div>
            <div className="space-y-1.5">
              <Label>Plan</Label>
              <Select value={form.plan} onValueChange={(v) => set("plan", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="starter">Starter — $99/mo</SelectItem>
                  <SelectItem value="growth">Growth — $249/mo</SelectItem>
                  <SelectItem value="multisite">Multisite — $499/mo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ct-seats">Seats</Label>
              <Input id="ct-seats" type="number" min={1} max={10000} value={form.seats} onChange={(e) => set("seats", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Term</Label>
              <Select value={form.termMonths} onValueChange={(v) => set("termMonths", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1 month (trial-ish)</SelectItem>
                  <SelectItem value="12">12 months</SelectItem>
                  <SelectItem value="24">24 months</SelectItem>
                  <SelectItem value="36">36 months</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>License starts as</Label>
              <Select value={form.licenseStatus} onValueChange={(v) => set("licenseStatus", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
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
              <Input id="ct-owner-name" value={form.ownerName} onChange={(e) => set("ownerName", e.target.value)} placeholder="Pastor Jordan Lee" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ct-owner-email">Owner email *</Label>
              <Input id="ct-owner-email" type="email" value={form.ownerEmail} onChange={(e) => set("ownerEmail", e.target.value)} placeholder="jordan@newlife.demo" required />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="ct-owner-pw">Temp password * (min 8 chars)</Label>
              <Input id="ct-owner-pw" value={form.ownerPassword} onChange={(e) => set("ownerPassword", e.target.value)} required minLength={8} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="ct-notes">License notes (optional)</Label>
              <Input id="ct-notes" value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="e.g. 30-day trial, follow up Friday" />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
            <Button type="submit" disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Create tenant
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── tenant detail ────────────────────────────────────────────────────────────

function TenantDetailDialog({ tenantId, onClosed, onManage }: { tenantId: string | null; onClosed: () => void; onManage: (licenseId: string) => void }) {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useApiQuery<PartnerTenantDetail>(
    ["partner", "tenant", tenantId],
    `/partner/tenants/${tenantId}`,
    { enabled: !!tenantId },
  );

  async function toggleStatus(status: string) {
    if (!data) return;
    if (data.status === "pending_verification") {
      toast.info("Verify this church from the Compliance tab — activation requires the CAC checks there.");
      return;
    }
    const next = status === "active" ? "suspended" : "active";
    try {
      await api.patch(`/partner/tenants/${data.id}/status`, { status: next });
      toast.success(next === "suspended" ? "Tenant suspended." : "Tenant reactivated.");
      await queryClient.invalidateQueries({ queryKey: ["partner"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Status change failed.");
    }
  }

  return (
    <Dialog open={!!tenantId} onOpenChange={(open) => { if (!open) onClosed(); }}>
      <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto" aria-describedby={undefined}>
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

            <div className="rounded-lg border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <KeyRound className="h-4 w-4" /> License
                    {data.license ? <LicenseStatusBadge status={data.license.status} /> : <LicenseStatusBadge status="none" />}
                  </p>
                  {data.license ? (
                    <p className="mt-0.5 font-mono text-xs text-muted-foreground">{data.license.key}</p>
                  ) : null}
                </div>
                {data.license ? (
                  <Button size="sm" variant="outline" onClick={() => onManage(data.license!.id)}>
                    Manage license
                  </Button>
                ) : null}
              </div>
              {data.license ? (
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-muted-foreground sm:grid-cols-4">
                  <span>Plan: <b className="text-foreground">{PLAN_LABELS[data.license.plan] ?? data.license.plan}</b></span>
                  <span>Seats: <b className="text-foreground">{data.license.seats}</b></span>
                  <span>Expires: <b className="text-foreground">{fmtDateShort(data.license.expiresAt)}</b></span>
                  <span>Issued: <b className="text-foreground">{fmtDateShort(data.license.issuedAt)}</b></span>
                  {data.license.notes ? <span className="col-span-2 sm:col-span-4">Notes: {data.license.notes}</span> : null}
                </div>
              ) : null}
            </div>

            <div>
              <p className="mb-2 text-sm font-medium">Users</p>
              <div className="max-h-40 space-y-1.5 overflow-y-auto rounded-lg border p-2">
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
              <div className="max-h-36 space-y-1 overflow-y-auto rounded-lg border p-2 text-xs text-muted-foreground">
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
                <p className="mr-auto flex items-center gap-1.5 text-xs text-amber-700">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Awaiting compliance review — activate from the Compliance queue after CAC checks.
                </p>
              ) : data.status === "active" ? (
                <Button variant="destructive" onClick={() => toggleStatus("active")} disabled={isLoading}>
                  <ShieldOff className="h-4 w-4" /> Suspend tenant
                </Button>
              ) : (
                <Button onClick={() => toggleStatus("suspended")} disabled={isLoading}>
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
