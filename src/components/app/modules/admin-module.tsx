"use client";

/**
 * Administration — enterprise access control.
 *  • Roles & permissions: fully customizable — create/duplicate/rename/delete
 *    roles, toggle any permission live (optimistic save), editable full matrix
 *  • Users: every sign-in account, role assignment per member, add user
 *    accounts linked to people, enable/disable access
 *  • Audit log: append-only, who did what
 *  • Import: CSV stage → commit → rollback within 7 days
 *  • Settings: org profile (owner-only writes)
 *
 * Every mutation requires the "admin.manage" permission and is audited.
 */
import { Fragment, useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, qs } from "@/lib/api";
import { ACCESS_LEVELS, fmtDateTime, fmtMoney, type Paged, type PersonListItem, type SessionUser } from "@/lib/types";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  BarChart3, Bot, BookOpen, CalendarDays, Check, ChevronDown, ChevronRight, Eye, GitBranch, HandCoins,
  HandHeart, HeartHandshake, Landmark, LayoutDashboard, Lock, Megaphone, MessageCircle, Plus, Pencil,
  Copy, ScanLine, Settings, Sparkles, Trash2, RotateCcw, Save, ShieldCheck, Upload, UserPlus,
  Users as UsersIcon, UsersRound, UserRound, Workflow,
} from "lucide-react";
import {
  EmptyState, ErrorBlock, LoadingBlock, PageHeader, Section, StatCard, StatusBadge, useApiQuery, type ModuleProps,
} from "@/components/app/shared";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

// ── local shapes ─────────────────────────────────────────────────────────────
interface AccessRole {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: string[];
  /** Per-module access levels: 0=OFF 1=READ 2=EDIT 3=CREATE 4=DELETE. */
  accessMatrix: Record<string, number>;
  memberCount: number;
  heldByYou: boolean;
}
interface MatrixModule { key: string; label: string; group: string; hint?: string }
interface AccessDTO {
  roles: AccessRole[];
  permissions: { key: string; module: string; label: string }[];
  modules: MatrixModule[];
  whoSeesGiving: string[];
  canManage: boolean;
  counts: { memberCount: number; userCount: number };
  you: { membershipId: string };
}
interface MemberRow {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  status: string;
  lastLoginAt: string | null;
  personId: string | null;
  personName: string | null;
  roles: { id: string; key: string; name: string }[];
}
interface AuditItem {
  id: string;
  createdAt: string;
  actorLabel?: string | null;
  actorType: string;
  action: string;
  entityType: string;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
}
interface AuditPage { total: number; page?: number; pageSize?: number; items: AuditItem[]; }
interface SettingsDTO {
  org: { name: string; timezone: string; currency: string; plan: string; fiscalYearStartMonth: number };
  settings: { monthlyBudgetCents?: number | null; quietHours?: unknown; pastorCanViewIndividualGiving?: boolean; featureCareRadar?: boolean; featureBoardReports?: boolean; featureSermonStudio?: boolean; featureServingAi?: boolean; aiAssistantEnabled?: boolean; aiAssistantName?: string };
}
interface ImportJob {
  id: string; fileName: string; status: string;
  stats: { rows?: number; valid?: number; duplicates?: number; errors?: { row: number; reason: string }[] } | null;
  createdByName: string; createdAt: string;
}

function errMsg(err: unknown): string {
  return err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Something went wrong.";
}
function pretty(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
function hasPerm(role: AccessRole, permKey: string): boolean {
  return role.permissions.includes(permKey) || role.permissions.includes("*");
}
/** Signal the app shell to refresh the session (roles/permissions may have changed). */
function refreshSession() {
  window.dispatchEvent(new Event("chms:session-refresh"));
}
function randomPassword(): string {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return [...bytes].map((n) => chars[n % chars.length]).join("");
}

// ── module ───────────────────────────────────────────────────────────────────
/** Icons for the module access matrix rows (mirrors the nav registry + Shepherd AI). */
const MATRIX_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  dashboard: LayoutDashboard, people: UsersIcon, groups: UsersRound, checkin: ScanLine,
  events: CalendarDays, volunteers: HandHeart, care: HeartHandshake, pipeline: GitBranch,
  sermons: BookOpen, giving: HandCoins, accounting: Landmark, comms: Megaphone,
  whatsapp: MessageCircle, reports: BarChart3, workflows: Workflow, admin: Settings,
  portal: UserRound, ai: Sparkles,
};
const MATRIX_GROUP_LABELS: Record<string, string> = {
  overview: "Overview", ministry: "Ministry", finance: "Finance & Outreach",
  system: "System", ai: "AI Assistant",
};

export default function AdminModule({ user }: ModuleProps) {
  const [tab, setTab] = useState("roles");
  const isOwner = user.roleKeys.includes("owner");
  return (
    <div className="space-y-6">
      <PageHeader
        title="Administration"
        description="Enterprise access control: customizable roles, live permission editing, user accounts and role assignments — every change audited."
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex w-full flex-wrap">
          <TabsTrigger value="roles">Roles &amp; permissions</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="audit">Audit log</TabsTrigger>
          <TabsTrigger value="import">Import</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>
        <TabsContent value="roles"><AccessTab onManageUsers={() => setTab("users")} /></TabsContent>
        <TabsContent value="users"><UsersTab user={user} /></TabsContent>
        <TabsContent value="audit"><AuditTab /></TabsContent>
        <TabsContent value="import"><ImportTab /></TabsContent>
        <TabsContent value="settings"><SettingsTab isOwner={isOwner} /></TabsContent>
      </Tabs>
    </div>
  );
}

// ── Roles & permissions ──────────────────────────────────────────────────────
function groupByModule(perms: { key: string; module: string; label: string }[]) {
  const out: { module: string; perms: { key: string; label: string }[] }[] = [];
  for (const p of perms) {
    let m = out.find((x) => x.module === p.module);
    if (!m) { m = { module: p.module, perms: [] }; out.push(m); }
    m.perms.push(p);
  }
  return out;
}

function AccessTab({ onManageUsers }: { onManageUsers: () => void }) {
  const queryClient = useQueryClient();
  const q = useApiQuery<AccessDTO>(["admin", "access"], "/admin/access");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<"levels" | "editor" | "matrix">("levels");
  const [createOpen, setCreateOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [dupOpen, setDupOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const roles = q.data?.roles ?? [];
  const role = roles.find((r) => r.id === selectedId) ?? roles[0] ?? null;
  const canManage = q.data?.canManage ?? false;
  const modules = useMemo(() => groupByModule(q.data?.permissions ?? []), [q.data]);
  const roleName = new Map(roles.map((r) => [r.key, r.name] as const));

  // optimistic permission toggle — used by both the editor and the matrix
  const permMut = useMutation({
    mutationFn: (vars: { roleId: string; permissions: string[] }) =>
      api.put(`/admin/roles/${vars.roleId}/permissions`, { permissions: vars.permissions }),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: ["admin", "access"] });
      const old = queryClient.getQueryData<AccessDTO>(["admin", "access"]);
      queryClient.setQueryData<AccessDTO>(["admin", "access"], (d) =>
        d ? { ...d, roles: d.roles.map((r) => (r.id === vars.roleId ? { ...r, permissions: vars.permissions } : r)) } : d
      );
      return { old };
    },
    onSuccess: () => refreshSession(),
    onError: (err, _vars, ctx) => {
      if (ctx?.old) queryClient.setQueryData(["admin", "access"], ctx.old);
      toast.error(errMsg(err));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["admin", "access"] }),
  });

  function togglePerm(target: AccessRole, permKey: string) {
    if (!canManage || target.key === "owner") return;
    const next = hasPerm(target, permKey)
      ? target.permissions.filter((p) => p !== permKey)
      : [...target.permissions, permKey];
    permMut.mutate({ roleId: target.id, permissions: next });
  }

  // module access-matrix save — optimistic, session refresh re-scopes the nav
  const matrixMut = useMutation({
    mutationFn: (vars: { roleId: string; accessMatrix: Record<string, number> }) =>
      api.put(`/admin/roles/${vars.roleId}/access-matrix`, { accessMatrix: vars.accessMatrix }),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: ["admin", "access"] });
      const old = queryClient.getQueryData<AccessDTO>(["admin", "access"]);
      queryClient.setQueryData<AccessDTO>(["admin", "access"], (d) =>
        d ? { ...d, roles: d.roles.map((r) => (r.id === vars.roleId ? { ...r, accessMatrix: vars.accessMatrix } : r)) } : d
      );
      return { old };
    },
    onSuccess: () => {
      refreshSession();
      toast.success("Access levels saved — applied on members' next request.");
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.old) queryClient.setQueryData(["admin", "access"], ctx.old);
      toast.error(errMsg(err));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["admin", "access"] }),
  });

  if (q.isLoading) return <LoadingBlock label="Loading roles & permissions…" />;
  if (q.error) return <ErrorBlock error={q.error} />;
  const d = q.data!;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Who can see giving?"
          icon={Eye}
          value={
            d.whoSeesGiving.length
              ? <span className="text-lg leading-snug">{d.whoSeesGiving.map((k) => roleName.get(k) ?? k).join(" · ")}</span>
              : "Nobody"
          }
          sub="Computed live from your roles — not hardcoded."
          tone="default"
        />
        <StatCard
          label="Roles"
          icon={ShieldCheck}
          value={d.roles.length}
          sub={`${d.roles.filter((r) => !r.isSystem).length} custom · ${d.roles.filter((r) => r.isSystem).length} system`}
        />
        <StatCard
          label="User accounts"
          icon={UsersIcon}
          value={d.counts.userCount}
          sub={`${d.counts.memberCount} memberships in this church`}
        />
      </div>

      {!canManage ? (
        <Alert>
          <Lock />
          <AlertTitle>View-only access</AlertTitle>
          <AlertDescription>
            You can review roles and permissions, but changes require the &quot;Manage roles &amp; access&quot; (admin.manage) permission. Ask an Owner to grant it.
          </AlertDescription>
        </Alert>
      ) : null}

      <Section
        title="Roles & access levels"
        description="Every module — Shepherd AI included — has a granular access level per role: OFF, Read only, Edit, Create or Delete. Levels stack. Changes apply on the next request and are audited."
        actions={
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border p-0.5" role="tablist" aria-label="Permission view mode">
              <Button size="sm" variant={view === "levels" ? "secondary" : "ghost"} className="h-7" onClick={() => setView("levels")}>
                Access levels
              </Button>
              <Button size="sm" variant={view === "editor" ? "secondary" : "ghost"} className="h-7" onClick={() => setView("editor")}>
                Advanced
              </Button>
              <Button size="sm" variant={view === "matrix" ? "secondary" : "ghost"} className="h-7" onClick={() => setView("matrix")}>
                Full matrix
              </Button>
            </div>
            <Button size="sm" disabled={!canManage} onClick={() => setCreateOpen(true)}>
              <Plus /> New role
            </Button>
          </div>
        }
      >
        {view === "matrix" ? (
          <MatrixView modules={modules} roles={roles} canManage={canManage} onToggle={togglePerm} pending={permMut.isPending} />
        ) : (
          <div className="grid items-start gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
            {/* role list */}
            <Card className="gap-3 py-4">
              <CardHeader className="px-4 pb-0">
                <CardTitle className="flex items-center justify-between text-sm font-medium uppercase tracking-wide text-muted-foreground">
                  Roles <Badge variant="secondary">{roles.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="px-3">
                <div className="max-h-[430px] space-y-1 overflow-y-auto scroll-slim" role="listbox" aria-label="Roles">
                  {roles.map((r) => (
                    <button
                      key={r.id}
                      role="option"
                      aria-selected={role?.id === r.id}
                      onClick={() => setSelectedId(r.id)}
                      className={cn(
                        "w-full rounded-md px-3 py-2 text-left transition-colors hover:bg-accent",
                        role?.id === r.id && "bg-accent"
                      )}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">{r.name}</span>
                        {r.isSystem
                          ? <Badge variant="outline" className="shrink-0">System</Badge>
                          : <Badge className="shrink-0 bg-teal-100 text-teal-900 dark:bg-teal-950 dark:text-teal-200">Custom</Badge>}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {r.key === "owner" ? "Full access" : `${Object.values(r.accessMatrix ?? {}).filter((v) => v > 0).length || "—"} modules on · ${r.permissions.length} advanced grants`} · {r.memberCount} {r.memberCount === 1 ? "member" : "members"}
                        {r.heldByYou ? " · you" : ""}
                      </span>
                    </button>
                  ))}
                </div>
                <Button variant="outline" className="mt-3 w-full" disabled={!canManage} onClick={() => setCreateOpen(true)}>
                  <Plus /> New role
                </Button>
              </CardContent>
            </Card>

            {/* role editor */}
            {role ? (
              <Card className="py-4">
                <CardHeader className="px-4 pb-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                        {role.name}
                        {role.isSystem
                          ? <Badge variant="outline">System</Badge>
                          : <Badge className="bg-teal-100 text-teal-900 dark:bg-teal-950 dark:text-teal-200">Custom</Badge>}
                        {role.heldByYou ? <Badge variant="outline">Your role</Badge> : null}
                      </CardTitle>
                      <p className="mt-1 font-mono text-[11px] text-muted-foreground">{role.key} · assigned to {role.memberCount} {role.memberCount === 1 ? "member" : "members"}</p>
                      {role.description ? <p className="mt-1 max-w-xl text-sm text-muted-foreground">{role.description}</p> : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" disabled={!canManage} onClick={() => setRenameOpen(true)}>
                        <Pencil /> Rename
                      </Button>
                      <Button variant="outline" size="sm" disabled={!canManage} onClick={() => setDupOpen(true)}>
                        <Copy /> Duplicate
                      </Button>
                      {!role.isSystem ? (
                        <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
                          <AlertDialogTrigger asChild>
                            <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" disabled={!canManage}>
                              <Trash2 /> Delete
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete the &quot;{role.name}&quot; role?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This removes the role and its {role.permissions.length} permissions. Roles still assigned to members cannot be deleted.
                                This action is audited.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <DeleteRoleButton roleId={role.id} onDeleted={() => { setSelectedId(null); setDeleteOpen(false); }} />
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      ) : null}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4 px-4">
                  {role.key === "owner" ? (
                    <Alert className="border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40">
                      <Lock />
                      <AlertTitle>Full access by design</AlertTitle>
                      <AlertDescription>
                        The Owner role always has every module at the highest level. Duplicate it to create an editable copy.
                      </AlertDescription>
                    </Alert>
                  ) : null}

                  {role.memberCount > 0 ? (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2">
                      <p className="text-sm">Assigned to <span className="font-medium">{role.memberCount}</span> {role.memberCount === 1 ? "member" : "members"}.</p>
                      <Button variant="ghost" size="sm" onClick={onManageUsers}>
                        Manage in Users tab <ChevronRight />
                      </Button>
                    </div>
                  ) : null}

                  {view === "levels" ? (
                    <LevelsEditor
                      key={role.id}
                      role={role}
                      modules={d.modules}
                      canManage={canManage}
                      saving={matrixMut.isPending}
                      onSave={(accessMatrix) => matrixMut.mutate({ roleId: role.id, accessMatrix })}
                    />
                  ) : (
                    groupByModuleForRole(d.permissions).map((m) => (
                      <div key={m.module}>
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{m.module}</p>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {m.perms.map((p) => {
                            const has = role.key === "owner" || role.permissions.includes(p.key) || role.permissions.includes("*");
                            return (
                              <div key={p.key} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium">{p.label}</p>
                                  <p className="font-mono text-[10px] text-muted-foreground">{p.key}</p>
                                </div>
                                <Switch
                                  checked={has}
                                  disabled={!canManage || role.key === "owner" || permMut.isPending}
                                  onCheckedChange={() => togglePerm(role, p.key)}
                                  aria-label={`${has ? "Revoke" : "Grant"} ${p.key} for ${role.name}`}
                                />
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            ) : (
              <Card className="py-10"><EmptyState icon={ShieldCheck} title="No roles yet" description="Create your first custom role." /></Card>
            )}
          </div>
        )}
      </Section>

      {createOpen ? (
        <NewRoleDialog
          roles={roles}
          catalogue={d.permissions}
          onClose={() => setCreateOpen(false)}
          onCreated={(id) => { setSelectedId(id); setCreateOpen(false); }}
        />
      ) : null}
      {renameOpen && role ? (
        <RenameRoleDialog role={role} onClose={() => setRenameOpen(false)} />
      ) : null}
      {dupOpen && role ? (
        <DuplicateRoleDialog role={role} onClose={() => setDupOpen(false)} onCreated={(id) => { setSelectedId(id); setDupOpen(false); }} />
      ) : null}
    </div>
  );
}

function groupByModuleForRole(perms: { key: string; module: string; label: string }[]) {
  return groupByModule(perms);
}

// ── module access levels editor (granular OFF/READ/EDIT/CREATE/DELETE) ──────
const LEVEL_SHORT = ["OFF", "READ", "EDIT", "CREATE", "DELETE"] as const;

function LevelsEditor({ role, modules, canManage, saving, onSave }: {
  role: AccessRole;
  modules: MatrixModule[];
  canManage: boolean;
  saving: boolean;
  onSave: (accessMatrix: Record<string, number>) => void;
}) {
  const locked = role.key === "owner";
  const matrixKey = JSON.stringify(role.accessMatrix ?? {});
  const [draft, setDraft] = useState<Record<string, number>>(() => JSON.parse(matrixKey));
  useEffect(() => { setDraft(JSON.parse(matrixKey)); }, [matrixKey]);

  const normalized = JSON.stringify(
    Object.fromEntries(Object.entries(draft).filter(([, v]) => Number(v) > 0))
  );
  const dirty = normalized !== matrixKey;
  const editable = canManage && !locked && !saving;

  function setLevel(moduleKey: string, value: number) {
    setDraft((d) => ({ ...d, [moduleKey]: value }));
  }

  const groups = ["overview", "ministry", "finance", "system", "ai"];

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Levels stack — each includes everything below it. OFF hides the module from the nav and blocks
        its API; READ views; EDIT modifies; CREATE adds new; DELETE is full control.
      </p>

      <div className="max-h-[560px] space-y-4 overflow-y-auto pr-1 scroll-slim">
        {groups.map((group) => {
          const items = modules.filter((m) => (m.group ?? "system") === group);
          if (!items.length) return null;
          return (
            <div key={group}>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {MATRIX_GROUP_LABELS[group] ?? group}
              </p>
              <div className="space-y-2">
                {items.map((mod) => {
                  const Icon = MATRIX_ICONS[mod.key] ?? ShieldCheck;
                  const level = locked ? 4 : (draft[mod.key] ?? 0);
                  return (
                    <div
                      key={mod.key}
                      className={cn(
                        "flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border px-3 py-2.5",
                        level === 0 && "bg-muted/30"
                      )}
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span className={cn(
                          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                          level > 0 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                        )}>
                          <Icon className="h-4 w-4" aria-hidden />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{mod.label}</p>
                          {mod.hint ? <p className="text-[11px] leading-snug text-muted-foreground">{mod.hint}</p> : null}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={`Access level for ${mod.label}`}>
                        {ACCESS_LEVELS.map((lv) => {
                          const active = level === lv.value;
                          return (
                            <button
                              key={lv.value}
                              type="button"
                              role="radio"
                              aria-checked={active}
                              title={lv.description}
                              disabled={!editable}
                              onClick={() => setLevel(mod.key, lv.value)}
                              className={cn(
                                "rounded-full border px-2.5 py-1 text-[11px] font-semibold tracking-wide transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-55",
                                active
                                  ? lv.value === 4
                                    ? "border-destructive bg-destructive text-white"
                                    : lv.value === 0
                                      ? "bg-muted text-muted-foreground"
                                      : "border-primary bg-primary text-primary-foreground"
                                  : "border-border/70 text-muted-foreground hover:bg-accent hover:text-foreground"
                              )}
                            >
                              {LEVEL_SHORT[lv.value]}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {locked ? null : (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-3">
          {dirty ? (
            <span className="mr-auto text-xs font-medium text-amber-700 dark:text-amber-400">
              Unsaved changes — applied on members&apos; next request after saving.
            </span>
          ) : (
            <span className="mr-auto text-xs text-muted-foreground">Saved.</span>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={!editable || !dirty}
            onClick={() => setDraft(JSON.parse(matrixKey))}
          >
            <RotateCcw /> Reset
          </Button>
          <Button
            size="sm"
            disabled={!editable || !dirty}
            onClick={() => onSave(Object.fromEntries(Object.entries(draft).filter(([, v]) => Number(v) > 0)))}
          >
            <Save /> {saving ? "Saving…" : "Save access levels"}
          </Button>
        </div>
      )}
    </div>
  );
}

// ── full matrix (editable) ───────────────────────────────────────────────────
function MatrixView({ modules, roles, canManage, onToggle, pending }: {
  modules: { module: string; perms: { key: string; label: string }[] }[];
  roles: AccessRole[];
  canManage: boolean;
  onToggle: (role: AccessRole, permKey: string) => void;
  pending: boolean;
}) {
  return (
    <div className="space-y-2">
      {canManage ? (
        <p className="text-xs text-muted-foreground">
          Click any cell to toggle that permission for the role — saves live. The Owner column is locked (full access by design).
        </p>
      ) : null}
      <div className="max-h-[600px] overflow-auto rounded-lg border scroll-slim">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="sticky left-0 z-10 min-w-56 bg-background">Permission</TableHead>
              {roles.map((r) => (
                <TableHead key={r.id} className="min-w-24 text-center text-xs">{r.name}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {modules.map((m) => (
              <Fragment key={m.module}>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableCell colSpan={roles.length + 1} className="py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {m.module}
                  </TableCell>
                </TableRow>
                {m.perms.map((p) => (
                  <TableRow key={p.key}>
                    <TableCell className="sticky left-0 z-10 bg-background">
                      <span className="block font-medium">{p.label}</span>
                      <span className="block font-mono text-[10px] text-muted-foreground">{p.key}</span>
                    </TableCell>
                    {roles.map((r) => {
                      const has = hasPerm(r, p.key);
                      const editable = canManage && r.key !== "owner";
                      return (
                        <TableCell key={r.id} className="text-center">
                          {editable ? (
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() => onToggle(r, p.key)}
                              aria-label={`${has ? "Revoke" : "Grant"} ${p.key} for ${r.name}`}
                              className="mx-auto flex h-7 w-7 items-center justify-center rounded transition-colors hover:bg-accent"
                            >
                              {has
                                ? <Check className="h-4 w-4 text-teal-700 dark:text-teal-400" />
                                : <span className="text-muted-foreground/50">—</span>}
                            </button>
                          ) : has ? (
                            <Check className="mx-auto h-4 w-4 text-teal-700 dark:text-teal-400" aria-label={`${r.name} has ${p.key}`} />
                          ) : (
                            <span className="text-muted-foreground/50" aria-label={`${r.name} does not have ${p.key}`}>—</span>
                          )}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ── role dialogs ─────────────────────────────────────────────────────────────
function NewRoleDialog({ roles, catalogue, onClose, onCreated }: {
  roles: AccessRole[];
  catalogue: { key: string; module: string; label: string }[];
  onClose: () => void;
  onCreated: (roleId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [startFrom, setStartFrom] = useState("blank");
  const [pending, setPending] = useState(false);

  async function submit() {
    setPending(true);
    try {
      const template = roles.find((r) => r.id === startFrom);
      const permissions = template
        ? template.permissions.includes("*")
          ? catalogue.map((p) => p.key)
          : template.permissions
        : [];
      // copy the module access ladder too (owner expands to full)
      const accessMatrix = template
        ? template.key === "owner"
          ? Object.fromEntries((template.accessMatrix && Object.keys(template.accessMatrix).length
            ? Object.keys(template.accessMatrix)
            : ["dashboard", "people", "groups", "checkin", "events", "volunteers", "care", "pipeline", "sermons", "giving", "accounting", "comms", "whatsapp", "reports", "workflows", "admin", "portal", "ai"]).map((k) => [k, 4]))
          : (template.accessMatrix ?? {})
        : {};
      const res = await api.post<{ id: string; name: string }>("/admin/roles", { name, description, permissions, accessMatrix });
      toast.success(`Role "${res.name}" created. Set its module access levels below.`);
      queryClient.invalidateQueries({ queryKey: ["admin", "access"] });
      refreshSession();
      onCreated(res.id);
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setPending(false);
    }
  }

  const valid = name.trim().length >= 2;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create a custom role</DialogTitle>
          <DialogDescription>
            Start blank or copy an existing role, then fine-tune its permissions. You can rename it later.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="new-role-name">Role name</Label>
            <Input id="new-role-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Worship Team" autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-role-desc">Description (optional)</Label>
            <Input id="new-role-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is this role for?" />
          </div>
          <div className="space-y-1.5">
            <Label>Start from</Label>
            <Select value={startFrom} onValueChange={setStartFrom}>
              <SelectTrigger aria-label="Start from role"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="blank">Blank — no permissions</SelectItem>
                {roles.map((r) => (
                  <SelectItem key={r.id} value={r.id}>{r.name}{r.isSystem ? " (system)" : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {startFrom !== "blank" && roles.find((r) => r.id === startFrom)?.key === "owner" ? (
              <p className="text-xs text-amber-700 dark:text-amber-400">Copying Owner grants every permission explicitly — trim it down after creating.</p>
            ) : null}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!valid || pending} onClick={submit}>{pending ? "Creating…" : "Create role"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RenameRoleDialog({ role, onClose }: { role: AccessRole; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description ?? "");
  const [pending, setPending] = useState(false);

  async function submit() {
    setPending(true);
    try {
      await api.patch(`/admin/roles/${role.id}`, { name, description });
      toast.success("Role renamed.");
      queryClient.invalidateQueries({ queryKey: ["admin", "access"] });
      refreshSession();
      onClose();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rename &quot;{role.name}&quot;</DialogTitle>
          <DialogDescription>Display name and description only — the role key <span className="font-mono">{role.key}</span> stays stable.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="rename-role-name">Role name</Label>
            <Input id="rename-role-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rename-role-desc">Description</Label>
            <Textarea id="rename-role-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={name.trim().length < 2 || pending} onClick={submit}>{pending ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DuplicateRoleDialog({ role, onClose, onCreated }: { role: AccessRole; onClose: () => void; onCreated: (id: string) => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(`${role.name} (copy)`);
  const [pending, setPending] = useState(false);

  async function submit() {
    setPending(true);
    try {
      const res = await api.post<{ id: string; name: string }>(`/admin/roles/${role.id}/duplicate`, { name });
      toast.success(`Copied to "${res.name}" — customize its permissions now.`);
      queryClient.invalidateQueries({ queryKey: ["admin", "access"] });
      onCreated(res.id);
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Duplicate &quot;{role.name}&quot;</DialogTitle>
          <DialogDescription>
            Creates an editable custom role with the same {role.key === "owner" ? "full (expanded)" : ""} permission bundle — {role.key === "owner" ? "every permission" : `${role.permissions.length} permissions`}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="dup-role-name">New role name</Label>
          <Input id="dup-role-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={name.trim().length < 2 || pending} onClick={submit}>{pending ? "Copying…" : "Duplicate"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteRoleButton({ roleId, onDeleted }: { roleId: string; onDeleted: () => void }) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  return (
    <Button
      variant="destructive"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        try {
          await api.del(`/admin/roles/${roleId}`);
          toast.success("Role deleted.");
          queryClient.invalidateQueries({ queryKey: ["admin", "access"] });
          refreshSession();
          onDeleted();
        } catch (err) {
          toast.error(errMsg(err));
          setPending(false);
        }
      }}
    >
      {pending ? "Deleting…" : "Delete role"}
    </Button>
  );
}

// ── Users (accounts & role assignment) ───────────────────────────────────────
function UsersTab({ user }: { user: SessionUser }) {
  const queryClient = useQueryClient();
  const accessQ = useApiQuery<AccessDTO>(["admin", "access"], "/admin/access");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [rolesFor, setRolesFor] = useState<MemberRow | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const membersQ = useApiQuery<{ items: MemberRow[] }>(
    ["admin", "members", debounced],
    `/admin/members${qs({ search: debounced || undefined })}`,
    { placeholderData: (prev) => prev },
  );

  const canManage = accessQ.data?.canManage ?? false;
  const roles = accessQ.data?.roles ?? [];
  const items = membersQ.data?.items ?? [];

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["admin", "members"] });
    queryClient.invalidateQueries({ queryKey: ["admin", "access"] });
  };

  const statusMut = useMutation({
    mutationFn: (v: { membershipId: string; status: string }) =>
      api.patch(`/admin/members/${v.membershipId}/status`, { status: v.status }),
    onSuccess: (_res, v) => {
      toast.success(v.status === "active" ? "Access restored." : "Access disabled — sign-ins are blocked immediately.");
      invalidate();
      refreshSession();
    },
    onError: (err) => toast.error(errMsg(err)),
  });

  return (
    <div className="space-y-4">
      {!canManage ? (
        <Alert>
          <Lock />
          <AlertTitle>View-only access</AlertTitle>
          <AlertDescription>
            Viewing users requires &quot;View administration&quot;; changes require &quot;Manage roles &amp; access&quot; (admin.manage).
          </AlertDescription>
        </Alert>
      ) : null}

      <Section
        title="Users & role assignments"
        description="Every sign-in account in your church and the roles each one holds. Roles stack — a member with two roles gets the union of their permissions."
        actions={
          <Button size="sm" disabled={!canManage} onClick={() => setAddOpen(true)}>
            <UserPlus /> Add user
          </Button>
        }
      >
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or email…"
          aria-label="Search users"
          className="sm:max-w-xs"
        />

        {membersQ.isLoading ? <LoadingBlock />
          : membersQ.error ? <ErrorBlock error={membersQ.error} />
          : !items.length ? <EmptyState icon={UsersIcon} title="No users match" description="Try a different search, or add a user account." />
          : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Roles</TableHead>
                    <TableHead>Last sign-in</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((m) => (
                    <TableRow key={m.membershipId}>
                      <TableCell>
                        <span className="block font-medium">{m.name}</span>
                        <span className="block text-xs text-muted-foreground">{m.email}</span>
                      </TableCell>
                      <TableCell>
                        <span className="flex flex-wrap gap-1">
                          {m.roles.slice(0, 3).map((r) => (
                            <Badge key={r.id} variant="outline" className="font-normal">{r.name}</Badge>
                          ))}
                          {m.roles.length > 3 ? <Badge variant="secondary">+{m.roles.length - 3}</Badge> : null}
                          {!m.roles.length ? <span className="text-xs text-muted-foreground">No roles</span> : null}
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{m.lastLoginAt ? fmtDateTime(m.lastLoginAt) : "Never"}</TableCell>
                      <TableCell><StatusBadge status={m.status} /></TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-2">
                          <Button variant="outline" size="sm" disabled={!canManage} onClick={() => setRolesFor(m)}>
                            <ShieldCheck /> Roles
                          </Button>
                          {m.status === "active" ? (
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" disabled={!canManage || m.membershipId === user.membershipId}>
                                  Disable
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Disable access for {m.name}?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    They will be signed out immediately and cannot sign in until re-enabled. Their people record is untouched.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction
                                    className="bg-destructive text-white hover:bg-destructive/90"
                                    onClick={() => statusMut.mutate({ membershipId: m.membershipId, status: "disabled" })}
                                  >
                                    Disable access
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          ) : (
                            <Button variant="outline" size="sm" disabled={!canManage} onClick={() => statusMut.mutate({ membershipId: m.membershipId, status: "active" })}>
                              Enable
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
      </Section>

      {rolesFor ? (
        <ManageRolesDialog
          key={rolesFor.membershipId}
          member={rolesFor}
          roles={roles}
          onClose={() => { setRolesFor(null); invalidate(); }}
        />
      ) : null}
      {addOpen ? (
        <AddUserDialog
          roles={roles}
          onClose={() => setAddOpen(false)}
          onCreated={() => { setAddOpen(false); invalidate(); refreshSession(); }}
        />
      ) : null}
    </div>
  );
}

function RoleCheckList({ roles, selected, onToggle }: {
  roles: AccessRole[];
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  return (
    <div className="max-h-52 space-y-1 overflow-y-auto scroll-slim rounded-md border p-2" role="group" aria-label="Roles">
      {roles.map((r) => (
        <label key={r.id} className="flex cursor-pointer items-start gap-3 rounded-md px-2 py-1.5 hover:bg-accent">
          <Checkbox checked={selected.has(r.id)} onCheckedChange={() => onToggle(r.id)} className="mt-0.5" />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="text-sm font-medium">{r.name}</span>
              {r.isSystem
                ? <Badge variant="outline" className="text-[10px]">System</Badge>
                : <Badge className="bg-teal-100 text-teal-900 text-[10px] dark:bg-teal-950 dark:text-teal-200">Custom</Badge>}
              {r.key === "owner" ? <Badge variant="outline" className="border-amber-300 text-[10px] text-amber-700 dark:border-amber-700 dark:text-amber-400">Full access</Badge> : null}
            </span>
            <span className="block truncate font-mono text-[10px] text-muted-foreground">
              {r.key} · {r.key === "owner" ? "every permission" : `${r.permissions.length} permissions`} · {r.memberCount} assigned
            </span>
          </span>
        </label>
      ))}
    </div>
  );
}

function ManageRolesDialog({ member, roles, onClose }: { member: MemberRow; roles: AccessRole[]; onClose: () => void }) {
  const [selected, setSelected] = useState<Set<string>>(new Set(member.roles.map((r) => r.id)));
  const [saving, setSaving] = useState(false);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    setSaving(true);
    try {
      const current = new Set(member.roles.map((r) => r.id));
      const toAdd = [...selected].filter((id) => !current.has(id));
      const toRemove = [...current].filter((id) => !selected.has(id));
      for (const roleId of toAdd) {
        await api.post(`/admin/members/${member.membershipId}/roles`, { roleId });
      }
      for (const roleId of toRemove) {
        await api.del(`/admin/members/${member.membershipId}/roles/${roleId}`);
      }
      toast.success(`Roles updated for ${member.name}.`);
      refreshSession();
      onClose();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Roles for {member.name}</DialogTitle>
          <DialogDescription>{member.email} — changes take effect on their next page load and are audited.</DialogDescription>
        </DialogHeader>
        <RoleCheckList roles={roles} selected={selected} onToggle={toggle} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={saving} onClick={save}>{saving ? "Saving…" : "Save roles"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddUserDialog({ roles, onClose, onCreated }: { roles: AccessRole[]; onClose: () => void; onCreated: () => void }) {
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [personSearch, setPersonSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [personId, setPersonId] = useState<string | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState(randomPassword());
  const [roleIds, setRoleIds] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(personSearch), 300);
    return () => clearTimeout(t);
  }, [personSearch]);

  const peopleQ = useApiQuery<Paged<PersonListItem>>(
    ["admin", "person-search", debounced],
    `/people${qs({ search: debounced, pageSize: 8 })}`,
    { enabled: mode === "existing" && debounced.trim().length >= 2 },
  );

  function toggleRole(id: string) {
    setRoleIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit() {
    setPending(true);
    try {
      const payload =
        mode === "existing"
          ? { personId, email, password, roleIds: [...roleIds] }
          : { firstName, lastName, email, password, roleIds: [...roleIds] };
      await api.post("/admin/members", payload);
      toast.success("User account created — share the temporary password securely.");
      onCreated();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setPending(false);
    }
  }

  const valid =
    email.trim().length > 3 &&
    password.length >= 8 &&
    (mode === "existing" ? !!personId : firstName.trim().length > 0);

  const candidates = peopleQ.data?.items ?? [];
  const selectedPerson = candidates.find((p) => p.id === personId);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto scroll-slim sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a user account</DialogTitle>
          <DialogDescription>
            Creates a sign-in account and links it to a person record. They can change the password after signing in.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <RadioGroup value={mode} onValueChange={(v) => setMode(v as "existing" | "new")} className="flex gap-4">
            <label className="flex items-center gap-2 text-sm">
              <RadioGroupItem value="existing" /> Link existing person
            </label>
            <label className="flex items-center gap-2 text-sm">
              <RadioGroupItem value="new" /> Create new person
            </label>
          </RadioGroup>

          {mode === "existing" ? (
            <div className="space-y-2">
              <Label htmlFor="person-search">Find the person</Label>
              <Input
                id="person-search"
                value={personSearch}
                onChange={(e) => setPersonSearch(e.target.value)}
                placeholder="Start typing a name…"
                autoFocus
              />
              {debounced.trim().length >= 2 ? (
                peopleQ.isLoading ? <LoadingBlock label="Searching…" />
                  : !candidates.length ? <p className="py-2 text-sm text-muted-foreground">No people match — switch to &quot;Create new person&quot;.</p>
                  : (
                    <div className="max-h-44 space-y-1 overflow-y-auto scroll-slim rounded-md border p-1">
                      {candidates.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => setPersonId(p.id)}
                          className={cn(
                            "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent",
                            personId === p.id && "bg-accent"
                          )}
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium">{p.firstName} {p.lastName}</span>
                            <span className="block truncate text-xs text-muted-foreground">{p.email ?? "no email on file"}</span>
                          </span>
                          {personId === p.id ? <Check className="h-4 w-4 shrink-0 text-teal-700 dark:text-teal-400" /> : null}
                        </button>
                      ))}
                    </div>
                  )
              ) : (
                <p className="text-xs text-muted-foreground">Type at least 2 characters to search the directory.</p>
              )}
              {selectedPerson && personId ? (
                <p className="text-xs text-muted-foreground">
                  Linking <span className="font-medium text-foreground">{selectedPerson.firstName} {selectedPerson.lastName}</span>
                </p>
              ) : null}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="new-user-first">First name</Label>
                <Input id="new-user-first" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-user-last">Last name</Label>
                <Input id="new-user-last" value={lastName} onChange={(e) => setLastName(e.target.value)} />
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="new-user-email">Sign-in email</Label>
            <Input id="new-user-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@church.org" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="new-user-pw">Temporary password</Label>
            <div className="flex gap-2">
              <Input id="new-user-pw" value={password} onChange={(e) => setPassword(e.target.value)} className="font-mono text-xs" />
              <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={() => setPassword(randomPassword())}>
                Generate
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Minimum 8 characters. Share it over a secure channel.</p>
          </div>

          <div className="space-y-1.5">
            <Label>Roles ({roleIds.size} selected)</Label>
            <RoleCheckList roles={roles} selected={roleIds} onToggle={toggleRole} />
            {[...roleIds].some((id) => roles.find((r) => r.id === id)?.key === "owner") ? (
              <p className="text-xs text-amber-700 dark:text-amber-400">Careful: Owner grants full access, including role management.</p>
            ) : null}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!valid || pending} onClick={submit}>{pending ? "Creating…" : "Create account"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Audit log ────────────────────────────────────────────────────────────────
const PAGE_SIZE = 25;

function AuditTab() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [action, setAction] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const q = useApiQuery<AuditPage>(
    ["admin", "audit", page, search, action],
    `/audit-log${qs({ page, search: search || undefined, action: action || undefined })}`,
    { placeholderData: (prev) => prev },
  );

  const total = q.data?.total ?? 0;
  const items = q.data?.items ?? [];
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder="Search by actor name…"
          aria-label="Search audit log by actor"
          className="sm:max-w-xs"
        />
        <Input
          value={action}
          onChange={(e) => { setAction(e.target.value); setPage(1); }}
          placeholder="Filter by action, e.g. role.permissions"
          aria-label="Filter audit log by action"
          className="sm:max-w-xs font-mono text-xs"
        />
      </div>

      {q.isLoading ? <LoadingBlock />
        : q.error ? <ErrorBlock error={q.error} />
        : !items.length ? <EmptyState title="No audit entries match" description="Every create, edit, and sensitive read is logged here." />
        : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Time</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>IP</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((r) => (
                  <Fragment key={r.id}>
                    <TableRow className={cn(openId === r.id && "bg-muted/40")}>
                      <TableCell>
                        <Button
                          variant="ghost" size="icon" className="size-7"
                          aria-label={openId === r.id ? "Collapse details" : "Expand details"}
                          aria-expanded={openId === r.id}
                          onClick={() => setOpenId(openId === r.id ? null : r.id)}
                        >
                          {openId === r.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </Button>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs tabular-nums">{fmtDateTime(r.createdAt)}</TableCell>
                      <TableCell>
                        <span className="flex items-center gap-1.5 text-sm">
                          {r.actorType === "system" ? <Bot className="h-3.5 w-3.5 text-muted-foreground" aria-label="System actor" /> : null}
                          {r.actorLabel ?? "—"}
                          <Badge variant="outline" className="capitalize">{r.actorType}</Badge>
                        </span>
                      </TableCell>
                      <TableCell><span className="font-mono text-xs">{r.action}</span></TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.entityType}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{r.ip ?? "—"}</TableCell>
                    </TableRow>
                    {openId === r.id ? (
                      <TableRow>
                        <TableCell colSpan={6} className="bg-muted/30">
                          <div className="grid gap-2 py-1 sm:grid-cols-2">
                            <div>
                              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Before</p>
                              <pre className="max-h-40 overflow-auto rounded bg-background p-2 text-[11px] scroll-slim">{pretty(r.before)}</pre>
                            </div>
                            <div>
                              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">After</p>
                              <pre className="max-h-40 overflow-auto rounded bg-background p-2 text-[11px] scroll-slim">{pretty(r.after)}</pre>
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">Page {page} of {totalPages} · {total} entries</span>
        <span className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1 || q.isFetching} onClick={() => setPage((p) => Math.max(1, p - 1))}>Prev</Button>
          <Button variant="outline" size="sm" disabled={page >= totalPages || q.isFetching} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </span>
      </div>
    </div>
  );
}

// ── Import ───────────────────────────────────────────────────────────────────
const CSV_HINT = "Expected headers: first_name, last_name, email, phone, birthdate";

function ImportTab() {
  const queryClient = useQueryClient();
  const importsQ = useApiQuery<{ items: ImportJob[] }>(["admin", "imports"], "/admin/imports");

  const [csvText, setCsvText] = useState("");
  const [fileName, setFileName] = useState("");
  const [staged, setStaged] = useState<{ id: string; stats: NonNullable<ImportJob["stats"]> } | null>(null);

  const onFile = (file: File | null) => {
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => setCsvText(String(reader.result ?? ""));
    reader.readAsText(file);
  };

  const stageMut = useMutation({
    mutationFn: () => api.post<{ id: string; stats: NonNullable<ImportJob["stats"]> }>("/admin/imports/stage", { csvText, fileName: fileName || "pasted.csv" }),
    onSuccess: (res) => {
      setStaged(res);
      toast.success(`Analyzed ${res.stats.rows ?? 0} rows — ${res.stats.valid ?? 0} valid, ${res.stats.duplicates ?? 0} duplicate(s).`);
      queryClient.invalidateQueries({ queryKey: ["admin", "imports"] });
    },
    onError: (err) => toast.error(errMsg(err)),
  });

  const commitMut = useMutation({
    mutationFn: (id: string) => api.post<{ created: number; duplicates: number }>(`/admin/imports/${id}/commit`),
    onSuccess: (res) => {
      toast.success(`Import committed — created ${res.created}, skipped ${res.duplicates} duplicate(s).`);
      setStaged(null); setCsvText(""); setFileName("");
      queryClient.invalidateQueries({ queryKey: ["admin", "imports"] });
    },
    onError: (err) => toast.error(errMsg(err)),
  });

  const rollbackMut = useMutation({
    mutationFn: (id: string) => api.post<{ rolledBack: number }>(`/admin/imports/${id}/rollback`),
    onSuccess: (res) => {
      toast.success(`Rolled back ${res.rolledBack} person(s) created by that import.`);
      queryClient.invalidateQueries({ queryKey: ["admin", "imports"] });
    },
    onError: (err) => toast.error(errMsg(err)),
  });

  const jobs = importsQ.data?.items ?? [];
  const within7days = (j: ImportJob) => Date.now() - new Date(j.createdAt).getTime() < 7 * 86400000;

  return (
    <div className="space-y-6">
      <Section title="Stage a CSV" description="Staging only analyzes — nothing is created until you commit.">
        <Card>
          <CardContent className="space-y-3 pt-4">
            <p className="text-xs text-muted-foreground">{CSV_HINT}</p>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => onFile(e.target.files?.[0] ?? null)}
                aria-label="Choose CSV file"
                className="sm:max-w-sm"
              />
              {fileName ? <Badge variant="secondary">{fileName}</Badge> : null}
            </div>
            <Textarea
              rows={5}
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              placeholder={"…or paste CSV here\nfirst_name,last_name,email,phone\nMaria,Lopez,maria@example.com,555-0134"}
              aria-label="Paste CSV text"
              className="font-mono text-xs"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button disabled={!csvText.trim() || stageMut.isPending} onClick={() => { setStaged(null); stageMut.mutate(); }}>
                <Upload /> {stageMut.isPending ? "Analyzing…" : "Analyze"}
              </Button>
              {csvText ? <Button variant="ghost" size="sm" onClick={() => { setCsvText(""); setFileName(""); setStaged(null); }}>Clear</Button> : null}
            </div>

            {staged ? (
              <div className="space-y-3 rounded-md border p-3">
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div><p className="text-2xl font-semibold tabular-nums">{staged.stats.rows ?? 0}</p><p className="text-xs text-muted-foreground">Rows</p></div>
                  <div><p className="text-2xl font-semibold tabular-nums text-teal-700 dark:text-teal-400">{staged.stats.valid ?? 0}</p><p className="text-xs text-muted-foreground">Valid</p></div>
                  <div><p className="text-2xl font-semibold tabular-nums text-amber-700 dark:text-amber-400">{staged.stats.duplicates ?? 0}</p><p className="text-xs text-muted-foreground">Duplicates</p></div>
                </div>

                {staged.stats.errors?.length ? (
                  <div className="max-h-40 overflow-y-auto scroll-slim rounded border">
                    <Table>
                      <TableHeader><TableRow><TableHead className="w-16">Row</TableHead><TableHead>Problem</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {staged.stats.errors.map((e, i) => (
                          <TableRow key={i}>
                            <TableCell className="tabular-nums">{e.row}</TableCell>
                            <TableCell className="text-sm text-red-700 dark:text-red-400">{e.reason}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : <p className="text-xs text-teal-700 dark:text-teal-400">No row errors — every row has a name and a way to be contacted.</p>}

                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button disabled={commitMut.isPending || !staged.stats.valid}>
                      {commitMut.isPending ? "Committing…" : "Commit import"}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Commit this import?</AlertDialogTitle>
                      <AlertDialogDescription>
                        {staged.stats.valid} person(s) will be created as guests and tagged with this import batch.
                        Duplicates are skipped. You can roll back within 7 days.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => commitMut.mutate(staged.id)}>Commit</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </Section>

      <Section title="Import history" description="Committed imports can be rolled back for 7 days.">
        {importsQ.isLoading ? <LoadingBlock />
          : importsQ.error ? <ErrorBlock error={importsQ.error} />
          : !jobs.length ? <EmptyState title="No imports yet" />
          : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>File</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Stats</TableHead>
                    <TableHead>By</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Undo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {jobs.map((j) => (
                    <TableRow key={j.id}>
                      <TableCell className="max-w-40 truncate font-medium">{j.fileName}</TableCell>
                      <TableCell><StatusBadge status={j.status} /></TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {j.stats ? `${j.stats.rows ?? 0} rows · ${j.stats.valid ?? (j.stats as { created?: number }).created ?? 0} valid · ${j.stats.duplicates ?? 0} dup` : "—"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{j.createdByName}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs">{fmtDateTime(j.createdAt)}</TableCell>
                      <TableCell className="text-right">
                        {j.status === "committed" && within7days(j) ? (
                          <Button variant="outline" size="sm" disabled={rollbackMut.isPending} onClick={() => rollbackMut.mutate(j.id)}>
                            <RotateCcw /> Rollback
                          </Button>
                        ) : <span className="text-xs text-muted-foreground">—</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
      </Section>
    </div>
  );
}

// ── Settings ─────────────────────────────────────────────────────────────────

// ── Feature flags: AI suite + product surfaces (independent rollback) ───────
const FEATURE_FLAG_DEFS: { key: string; label: string; description: string }[] = [
  { key: "people.crmV2", label: "People CRM (next-gen)", description: "The redesigned People workspace: insights strip, filter builder, virtualized directory, smart lists and data health. The classic view stays one click away and remains the fallback when this is off." },
  { key: "featureCareRadar", label: "Care Radar", description: "Deterministic at-risk member signals with full human review. Giving signals respect the pastor visibility setting above." },
  { key: "featureBoardReports", label: "Board reports", description: "Natural-language board packs, permission-scoped to the requester — aggregates only, every run audited." },
  { key: "featureSermonStudio", label: "Sermon Studio", description: "AI sermon outlines, curated cross-references, illustrations and worship matches from your real song library." },
  { key: "featureServingAi", label: "Smart volunteer scheduling", description: "Deterministic rota engine honoring availability, rest windows and fairness. Drafts require explicit review and send." },
];

function FeatureFlagsCard({ settings, isOwner, onToggle }: { settings: SettingsDTO["settings"] | undefined; isOwner: boolean; onToggle: (key: string, enabled: boolean) => void }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Feature flags (independent rollback)</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {FEATURE_FLAG_DEFS.map((f) => (
          <div key={f.key} className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor={`flag-${f.key}`} className="text-sm font-medium">{f.label}</Label>
              <p className="text-xs text-muted-foreground">{f.description}</p>
            </div>
            <Switch
              id={`flag-${f.key}`}
              checked={settings?.[f.key as keyof SettingsDTO["settings"]] !== false}
              disabled={!isOwner}
              onCheckedChange={(checked) => onToggle(f.key, checked)}
              aria-label={`Toggle ${f.label}`}
            />
          </div>
        ))}
        <p className="text-xs text-muted-foreground">Flags default to ON. Turning one off immediately hides its surfaces and blocks its API/AI tools — data is never deleted.</p>
      </CardContent>
    </Card>
  );
}

function SettingsTab({ isOwner }: { isOwner: boolean }) {
  const queryClient = useQueryClient();
  const q = useApiQuery<SettingsDTO>(["admin", "settings"], "/admin/settings");
  const [budgetAmount, setBudgetAmount] = useState<string>("");

  const org = q.data?.org;
  const settings = q.data?.settings;
  const budgetValue = budgetAmount !== "" ? budgetAmount : settings?.monthlyBudgetCents != null ? String(settings.monthlyBudgetCents / 100) : "";

  const saveMut = useMutation({
    mutationFn: () => api.put("/admin/settings", { settings: { monthlyBudgetCents: Math.round(Number(budgetValue) * 100) } }),
    onSuccess: () => {
      toast.success("Settings saved.");
      setBudgetAmount("");
      queryClient.invalidateQueries({ queryKey: ["admin", "settings"] });
      queryClient.invalidateQueries({ queryKey: ["admin"] });
    },
    onError: (err) => toast.error(errMsg(err)),
  });

  // Privacy toggle: pastors see individual giving ONLY when opted in (default off).
  const pastorToggleMut = useMutation({
    mutationFn: (enabled: boolean) => api.put("/admin/settings", { settings: { pastorCanViewIndividualGiving: enabled } }),
    onSuccess: () => {
      toast.success("Pastor giving visibility updated. Takes effect on next sign-in.");
      queryClient.invalidateQueries({ queryKey: ["admin", "settings"] });
    },
    onError: (err) => toast.error(errMsg(err)),
  });

  const flagToggleMut = useMutation({
    mutationFn: ({ key, enabled }: { key: string; enabled: boolean }) => api.put("/admin/settings", { settings: { [key]: enabled } }),
    onSuccess: () => {
      toast.success("Feature flag updated — surfaces update on next page load.");
      queryClient.invalidateQueries({ queryKey: ["admin", "settings"] });
    },
    onError: (err) => toast.error(errMsg(err)),
  });

  // Shepherd AI church-level rollout toggle (launcher visibility for the whole org).
  const aiToggleMut = useMutation({
    mutationFn: (enabled: boolean) => api.put("/admin/settings", { settings: { aiAssistantEnabled: enabled } }),
    onSuccess: () => {
      toast.success("Shepherd AI setting saved — surfaces update on next page load.");
      queryClient.invalidateQueries({ queryKey: ["admin", "settings"] });
    },
    onError: (err) => toast.error(errMsg(err)),
  });

  // Shepherd AI display name (defaults to "Shepherd" when blank).
  const [aiNameDraft, setAiNameDraft] = useState<string>("");
  const aiNameValue = aiNameDraft !== "" ? aiNameDraft : settings?.aiAssistantName ?? "";
  const aiNameMut = useMutation({
    mutationFn: () => api.put("/admin/settings", { settings: { aiAssistantName: aiNameValue.trim() } }),
    onSuccess: () => {
      toast.success("Assistant name saved.");
      setAiNameDraft("");
      queryClient.invalidateQueries({ queryKey: ["admin", "settings"] });
    },
    onError: (err) => toast.error(errMsg(err)),
  });

  const quietHours = settings?.quietHours == null ? "Not configured"
    : typeof settings.quietHours === "string" ? settings.quietHours : JSON.stringify(settings.quietHours);

  return (
    <div className="space-y-4">
      {q.isLoading ? <LoadingBlock /> : q.error ? <ErrorBlock error={q.error} /> : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card><CardHeader className="pb-1"><CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Organization</CardTitle></CardHeader>
              <CardContent className="text-lg font-semibold">{org?.name ?? "—"}</CardContent></Card>
            <Card><CardHeader className="pb-1"><CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Timezone</CardTitle></CardHeader>
              <CardContent className="text-lg font-semibold">{org?.timezone ?? "—"}</CardContent></Card>
            <Card><CardHeader className="pb-1"><CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Currency · Plan</CardTitle></CardHeader>
              <CardContent className="text-lg font-semibold">{org?.currency ?? "—"} · <span className="capitalize">{org?.plan ?? "—"}</span></CardContent></Card>
            <Card><CardHeader className="pb-1"><CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Fiscal year starts</CardTitle></CardHeader>
              <CardContent className="text-lg font-semibold">Month {org?.fiscalYearStartMonth ?? 1}</CardContent></Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-base">Monthly giving budget</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="budget-input">Budget (₦ per month)</Label>
                  <Input
                    id="budget-input" type="number" min={0} step="1"
                    value={budgetValue}
                    onChange={(e) => setBudgetAmount(e.target.value)}
                    disabled={!isOwner}
                    placeholder="e.g. 40000"
                    className="sm:max-w-xs"
                  />
                  {settings?.monthlyBudgetCents != null ? (
                    <p className="text-xs text-muted-foreground">Current: {fmtMoney(settings.monthlyBudgetCents)} per month.</p>
                  ) : null}
                </div>
                {isOwner ? (
                  <Button disabled={saveMut.isPending || budgetValue === ""} onClick={() => saveMut.mutate()}>
                    <Save /> {saveMut.isPending ? "Saving…" : "Save settings"}
                  </Button>
                ) : (
                  <p className="text-sm text-muted-foreground">Only the Owner can change settings.</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Pastor giving visibility</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <Label htmlFor="pastor-giving-toggle" className="text-sm font-medium">
                      Pastors may view individual giving records
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Off (default): pastors keep aggregate oversight — fund totals, budgets, reports — but cannot open
                      any member&apos;s gift history. On: roles holding the pastor visibility grant can see individual records.
                      Takes effect on next sign-in.
                    </p>
                  </div>
                  <Switch
                    id="pastor-giving-toggle"
                    checked={settings?.pastorCanViewIndividualGiving === true}
                    disabled={!isOwner || pastorToggleMut.isPending}
                    onCheckedChange={(checked) => pastorToggleMut.mutate(checked)}
                    aria-label="Toggle pastor access to individual giving records"
                  />
                </div>
              </CardContent>
            </Card>

            <FeatureFlagsCard settings={settings} isOwner={isOwner} onToggle={(key, enabled) => flagToggleMut.mutate({ key, enabled })} />

            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Sparkles className="h-4 w-4 text-primary" aria-hidden /> Shepherd AI assistant</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <Label htmlFor="ai-assistant-toggle" className="text-sm font-medium">
                      Enable Shepherd for this church
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Off (default): the assistant launcher is hidden for everyone. On: members see the
                      &ldquo;Ask Shepherd&rdquo; launcher — each person still only gets what their role grants in
                      Roles &amp; permissions, and every tool call is permission-checked and audited server-side.
                      Surfaces update on next page load.
                    </p>
                  </div>
                  <Switch
                    id="ai-assistant-toggle"
                    checked={settings?.aiAssistantEnabled === true}
                    disabled={!isOwner || aiToggleMut.isPending}
                    onCheckedChange={(checked) => aiToggleMut.mutate(checked)}
                    aria-label="Toggle Shepherd AI assistant for this church"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ai-assistant-name">Assistant display name</Label>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      id="ai-assistant-name"
                      value={aiNameValue}
                      onChange={(e) => setAiNameDraft(e.target.value)}
                      disabled={!isOwner || aiNameMut.isPending}
                      placeholder="Shepherd"
                      maxLength={40}
                      className="sm:max-w-xs"
                    />
                    <Button
                      variant="outline"
                      disabled={!isOwner || aiNameMut.isPending || aiNameValue.trim() === (settings?.aiAssistantName ?? "")}
                      onClick={() => aiNameMut.mutate()}
                    >
                      <Save /> {aiNameMut.isPending ? "Saving…" : "Save name"}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">Shown in the launcher tooltip and inside the chat panel. Leave blank for the default &ldquo;Shepherd&rdquo;.</p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Quiet hours</CardTitle></CardHeader>
              <CardContent>
                <p className="font-mono text-sm text-muted-foreground">{quietHours}</p>
                <p className="mt-2 text-xs text-muted-foreground">Messages and SMS are held during quiet hours; emails queue for the morning.</p>
              </CardContent>
            </Card>
          </div>

          {!isOwner ? (
            <Alert>
              <AlertTitle>Read-only view</AlertTitle>
              <AlertDescription>Settings changes are audited and restricted to the Owner role for two-person accountability.</AlertDescription>
            </Alert>
          ) : null}
        </>
      )}
    </div>
  );
}
