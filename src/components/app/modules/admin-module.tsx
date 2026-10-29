"use client";

/**
 * Admin — permission transparency ("who can see giving?"), append-only audit log,
 * CSV import with rollback, and org settings (owner-only writes).
 */
import { Fragment, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, qs } from "@/lib/api";
import { fmtDateTime, fmtMoney } from "@/lib/types";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Bot, Check, ChevronDown, ChevronRight, Eye, RotateCcw, Save, Upload,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

// ── local shapes ─────────────────────────────────────────────────────────────
interface MatrixDTO {
  roles: { key: string; name: string; permissions: string[] }[];
  permissions: { key: string; module: string; label: string }[];
  matrix: Record<string, string[]>;
  whoSeesGiving: string[];
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
  settings: { monthlyBudgetCents?: number | null; quietHours?: unknown };
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

// ── module ───────────────────────────────────────────────────────────────────
export default function AdminModule({ user }: ModuleProps) {
  const isOwner = user.roleKeys.includes("owner");
  return (
    <div className="space-y-6">
      <PageHeader
        title="Admin"
        description="Trust features: who can see what, who did what, and clean ways in and out of data imports."
      />
      <Tabs defaultValue="permissions">
        <TabsList className="flex w-full flex-wrap">
          <TabsTrigger value="permissions">Permissions</TabsTrigger>
          <TabsTrigger value="audit">Audit log</TabsTrigger>
          <TabsTrigger value="import">Import</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>
        <TabsContent value="permissions"><PermissionsTab /></TabsContent>
        <TabsContent value="audit"><AuditTab /></TabsContent>
        <TabsContent value="import"><ImportTab /></TabsContent>
        <TabsContent value="settings"><SettingsTab isOwner={isOwner} /></TabsContent>
      </Tabs>
    </div>
  );
}

// ── Permissions ──────────────────────────────────────────────────────────────
function PermissionsTab() {
  const q = useApiQuery<MatrixDTO>(["admin", "matrix"], "/admin/permission-matrix");

  // group permissions by module, preserving server order (hook stays unconditional)
  const modules = useMemo(() => {
    const out: { module: string; perms: { key: string; label: string }[] }[] = [];
    for (const p of q.data?.permissions ?? []) {
      let m = out.find((x) => x.module === p.module);
      if (!m) { m = { module: p.module, perms: [] }; out.push(m); }
      m.perms.push(p);
    }
    return out;
  }, [q.data]);

  if (q.isLoading) return <LoadingBlock label="Loading permission matrix…" />;
  if (q.error) return <ErrorBlock error={q.error} />;
  const d = q.data!;
  const roleName = new Map(d.roles.map((r) => [r.key, r.name] as const));

  return (
    <div className="space-y-4">
      <StatCard
        label="Who can see giving?"
        icon={Eye}
        value={
          d.whoSeesGiving.length
            ? <span className="text-lg leading-snug">{d.whoSeesGiving.map((k) => roleName.get(k) ?? k).join(" · ")}</span>
            : "Nobody"
        }
        sub="Computed live from your roles — not hardcoded. Giving data is the most sensitive report in the building."
        tone="default"
      />

      <Section title="Permission matrix" description="Rows are permissions grouped by module; columns are roles.">
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="sticky left-0 z-10 bg-background min-w-56">Permission</TableHead>
                {d.roles.map((r) => (
                  <TableHead key={r.key} className="min-w-24 text-center text-xs">{r.name}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {modules.map((m) => (
                <Fragment key={m.module}>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableCell colSpan={d.roles.length + 1} className="py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {m.module}
                    </TableCell>
                  </TableRow>
                  {m.perms.map((p) => (
                    <TableRow key={p.key}>
                      <TableCell className="sticky left-0 z-10 bg-background">
                        <span className="block font-medium">{p.label}</span>
                        <span className="block font-mono text-[10px] text-muted-foreground">{p.key}</span>
                      </TableCell>
                      {d.roles.map((r) => {
                        const has = r.permissions.includes(p.key) || r.permissions.includes("*");
                        return (
                          <TableCell key={r.key} className="text-center">
                            {has
                              ? <Check className="mx-auto h-4 w-4 text-teal-700 dark:text-teal-400" aria-label={`${r.name} has ${p.key}`} />
                              : <span className="text-muted-foreground/50" aria-label={`${r.name} does not have ${p.key}`}>—</span>}
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
      </Section>
    </div>
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
          placeholder="Filter by action, e.g. person.create"
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
function SettingsTab({ isOwner }: { isOwner: boolean }) {
  const queryClient = useQueryClient();
  const q = useApiQuery<SettingsDTO>(["admin", "settings"], "/admin/settings");
  const [budgetDollars, setBudgetDollars] = useState<string>("");

  const org = q.data?.org;
  const settings = q.data?.settings;
  const budgetValue = budgetDollars !== "" ? budgetDollars : settings?.monthlyBudgetCents != null ? String(settings.monthlyBudgetCents / 100) : "";

  const saveMut = useMutation({
    mutationFn: () => api.put("/admin/settings", { settings: { monthlyBudgetCents: Math.round(Number(budgetValue) * 100) } }),
    onSuccess: () => {
      toast.success("Settings saved.");
      setBudgetDollars("");
      queryClient.invalidateQueries({ queryKey: ["admin", "settings"] });
      queryClient.invalidateQueries({ queryKey: ["admin"] });
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
                  <Label htmlFor="budget-input">Budget (USD per month)</Label>
                  <Input
                    id="budget-input" type="number" min={0} step="1"
                    value={budgetValue}
                    onChange={(e) => setBudgetDollars(e.target.value)}
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
