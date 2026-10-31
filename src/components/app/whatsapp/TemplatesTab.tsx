"use client";

/**
 * WhatsApp Templates — Meta-gated message templates. Draft locally, submit
 * for approval, and (sandbox only) simulate Meta's review. Approved
 * templates are locked — editing resets them to draft, so it is disabled.
 */
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { canDo, fmtDateShort, type SessionUser } from "@/lib/types";
import { cn } from "@/lib/utils";
import { EmptyState, ErrorBlock, LoadingBlock, Section, useApiQuery, type ModuleProps } from "@/components/app/shared";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { FileText, Loader2, Pencil, Plus, SendHorizonal, ShieldCheck, Trash2 } from "lucide-react";
import type { WaTemplate, WaTemplatesResp } from "@/components/app/whatsapp/WhatsAppModule";

function TemplateStatusBadge({ status }: { status: string }) {
  const cls =
    status === "approved"
      ? "border-transparent bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
      : status === "pending"
        ? "border-transparent bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
        : status === "rejected"
          ? "border-transparent bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200"
          : "border-transparent bg-muted text-muted-foreground"; // draft
  const label =
    status === "pending"
      ? "Pending Meta approval"
      : status.charAt(0).toUpperCase() + status.slice(1);
  return (
    <Badge variant="outline" className={cn("whitespace-nowrap font-medium", cls)}>
      {label}
    </Badge>
  );
}

function canSendWhatsapp(user: SessionUser): boolean {
  return canDo(user, "comms.whatsapp.send") || canDo(user, "comms.send");
}

function renderPreview(body: string, labels: string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (_m, i: string) => {
    const n = Number(i);
    return labels[n - 1]?.trim() || `Var ${n}`;
  });
}

export default function TemplatesTab({ user }: ModuleProps) {
  const qc = useQueryClient();
  const templatesQ = useApiQuery<WaTemplatesResp>(["whatsapp", "templates"], "/whatsapp/templates");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<WaTemplate | null>(null);
  const [deleteRow, setDeleteRow] = useState<WaTemplate | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const templates = templatesQ.data?.items ?? [];
  const canSend = canSendWhatsapp(user);

  async function refresh() {
    await qc.invalidateQueries({ queryKey: ["whatsapp"] });
  }

  async function submitTemplate(t: WaTemplate) {
    setBusyId(t.id);
    try {
      const res = await api.post<{ ok: boolean; info?: string | null }>(`/whatsapp/templates/${t.id}/submit`);
      toast.success(res.info ? `Submitted to Meta: ${res.info}` : `“${t.name}” submitted for Meta approval.`);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Submission failed.");
    } finally {
      setBusyId(null);
    }
  }

  async function approveTemplate(t: WaTemplate) {
    setBusyId(t.id);
    try {
      await api.post(`/whatsapp/templates/${t.id}/approve`);
      toast.success(`“${t.name}” approved (sandbox review).`);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Approval failed.");
    } finally {
      setBusyId(null);
    }
  }

  async function deleteTemplate(t: WaTemplate) {
    setBusyId(t.id);
    try {
      await api.del(`/whatsapp/templates/${t.id}`);
      toast.success("Template deleted.");
      setDeleteRow(null);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setBusyId(null);
    }
  }

  function rowActions(t: WaTemplate) {
    if (!canSend) return null;
    return (
      <div className="flex flex-wrap justify-end gap-1.5">
        {t.status !== "approved" && (
          <Button variant="ghost" size="sm" className="h-11 lg:h-9" aria-label={`Edit template ${t.name}`} onClick={() => {
            setEditing(t);
            setEditorOpen(true);
          }}>
            <Pencil className="h-3.5 w-3.5" /> Edit
          </Button>
        )}
        {(t.status === "draft" || t.status === "rejected") && (
          <Button variant="outline" size="sm" className="h-11 lg:h-9" disabled={busyId === t.id} onClick={() => void submitTemplate(t)}>
            {busyId === t.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <SendHorizonal className="h-3.5 w-3.5" />} Submit for approval
          </Button>
        )}
        {t.status === "pending" && (
          <Button
            variant="outline"
            size="sm"
            className="h-11 border-amber-200 text-amber-800 hover:bg-amber-50 hover:text-amber-900 lg:h-9"
            disabled={busyId === t.id}
            title="Sandbox only — simulates Meta granting approval"
            onClick={() => void approveTemplate(t)}
          >
            <ShieldCheck className="h-3.5 w-3.5" /> Approve (sandbox)
          </Button>
        )}
        {t.status === "draft" && (
          <Button
            variant="ghost"
            size="sm"
            className="h-11 text-destructive hover:bg-destructive/10 hover:text-destructive lg:h-9"
            aria-label={`Delete template ${t.name}`}
            onClick={() => setDeleteRow(t)}
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Section
        title="Templates"
        description="Meta reviews every template before it can be sent outside the 24-hour window."
        actions={
          canSend ? (
            <Button
              className="h-11 lg:h-9"
              onClick={() => {
                setEditing(null);
                setEditorOpen(true);
              }}
            >
              <Plus className="h-4 w-4" /> New template
            </Button>
          ) : null
        }
      >

      {templatesQ.isLoading ? (
        <LoadingBlock label="Loading templates…" />
      ) : templatesQ.isError ? (
        <ErrorBlock error={templatesQ.error} />
      ) : templates.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No templates"
          description="Create your first template to send broadcasts and reach members outside the 24-hour window."
        />
      ) : (
        <>
          {/* desktop table */}
          <div className="hidden overflow-x-auto rounded-lg border md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Body</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {templates.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell>
                      <p className="font-mono text-sm font-medium">{t.name}</p>
                      <p className="text-xs text-muted-foreground">{t.language}</p>
                    </TableCell>
                    <TableCell className="capitalize text-muted-foreground">{t.category}</TableCell>
                    <TableCell className="max-w-72">
                      <p className="truncate text-sm">{t.body}</p>
                      {t.statusInfo && <p className="truncate text-xs text-muted-foreground">{t.statusInfo}</p>}
                    </TableCell>
                    <TableCell>
                      <TemplateStatusBadge status={t.status} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{fmtDateShort(t.updatedAt)}</TableCell>
                    <TableCell className="text-right">{rowActions(t)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* mobile cards */}
          <div className="space-y-3 md:hidden">
            {templates.map((t) => (
              <Card key={t.id} className="py-0">
                <CardContent className="space-y-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-mono text-sm font-semibold">{t.name}</span>
                    <TemplateStatusBadge status={t.status} />
                  </div>
                  <p className="text-sm text-muted-foreground">{t.body}</p>
                  {t.statusInfo && <p className="text-xs text-muted-foreground">{t.statusInfo}</p>}
                  <p className="text-xs text-muted-foreground">
                    {t.category} · {t.language} · updated {fmtDateShort(t.updatedAt)}
                  </p>
                  {rowActions(t)}
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
      </Section>

      <TemplateEditorDialog
        open={editorOpen}
        template={editing}
        onOpenChange={setEditorOpen}
        onSaved={refresh}
      />

      <AlertDialog open={!!deleteRow} onOpenChange={(o) => !o && setDeleteRow(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete template “{deleteRow?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Draft templates are removed permanently. Templates referenced by a flow cannot be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11 lg:h-9">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="h-11 bg-destructive text-white hover:bg-destructive/90 lg:h-9"
              disabled={busyId !== null}
              onClick={(e) => {
                e.preventDefault();
                if (deleteRow) void deleteTemplate(deleteRow);
              }}
            >
              {busyId ? <Loader2 className="h-4 w-4 animate-spin" /> : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ───────────────────────── editor dialog ───────────────────────── */

function TemplateEditorDialog({
  open,
  template,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  template: WaTemplate | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState<string>("utility");
  const [language, setLanguage] = useState("en");
  const [body, setBody] = useState("");
  const [variables, setVariables] = useState("");
  const [saving, setSaving] = useState(false);

  const [hydratedFor, setHydratedFor] = useState<string | null>(null);
  const hydrateKey = open ? (template?.id ?? "new") : null;
  if (open && hydrateKey !== null && hydratedFor !== hydrateKey) {
    setHydratedFor(hydrateKey);
    if (template) {
      setName(template.name);
      setCategory(template.category);
      setLanguage(template.language);
      setBody(template.body);
      setVariables(template.variables.join(", "));
    } else {
      setName("");
      setCategory("utility");
      setLanguage("en");
      setBody("");
      setVariables("");
    }
  }
  if (!open && hydratedFor !== null) setHydratedFor(null);

  const labels = useMemo(() => variables.split(",").map((s) => s.trim()).filter(Boolean), [variables]);
  const previewText = useMemo(() => renderPreview(body, labels), [body, labels]);
  const overLimit = body.length > 1024;

  async function save() {
    if (!name.trim() || !body.trim()) {
      toast.error("Template name and body are required.");
      return;
    }
    if (overLimit) {
      toast.error("Template body is limited to 1024 characters (Meta limit).");
      return;
    }
    setSaving(true);
    try {
      await api.post("/whatsapp/templates", {
        ...(template ? { id: template.id } : {}),
        name: name.trim(),
        category,
        language: language.trim() || "en",
        body,
        variables: labels,
      });
      toast.success(template ? "Template saved — resubmit it for approval." : "Template created as a draft.");
      onOpenChange(false);
      await onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the template.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto scroll-slim sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{template ? "Edit template" : "New template"}</DialogTitle>
          <DialogDescription>
            {template
              ? "Editing resets the template to draft — it must be resubmitted for Meta approval."
              : "Templates start as drafts; submit them for Meta approval before use."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="wa-tpl-name">Name</Label>
            <Input
              id="wa-tpl-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="lowercase_with_underscores"
              className="font-mono"
            />
            <p className="text-[11px] text-muted-foreground">Meta requires lowercase names with underscores.</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="w-full" aria-label="Template category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="utility">Utility</SelectItem>
                  <SelectItem value="marketing">Marketing</SelectItem>
                  <SelectItem value="authentication">Authentication</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wa-tpl-lang">Language</Label>
              <Input id="wa-tpl-lang" value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="en" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="wa-tpl-body">Body</Label>
            <Textarea
              id="wa-tpl-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Hi {{1}}, don't forget our service this Sunday at {{2}}!"
              className="min-h-28"
              aria-describedby="wa-tpl-body-hint"
            />
            <p id="wa-tpl-body-hint" className={cn("text-[11px]", overLimit ? "font-medium text-destructive" : "text-muted-foreground")}>
              Use {"{{1}}"}, {"{{2}}"} positional placeholders · {body.length}/1024 characters (Meta limit)
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="wa-tpl-vars">Variable labels</Label>
            <Input
              id="wa-tpl-vars"
              value={variables}
              onChange={(e) => setVariables(e.target.value)}
              placeholder="First name, Service time (comma separated)"
            />
            <p className="text-[11px] text-muted-foreground">{"{{1}}"} label first — used for sending and previews.</p>
          </div>

          <div className="space-y-1.5">
            <Label>Preview</Label>
            <div className="rounded-2xl rounded-br-sm border bg-muted/40 px-3.5 py-2.5 text-sm whitespace-pre-wrap">
              {previewText || <span className="text-muted-foreground">Start typing the body to see a live preview…</span>}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" className="h-11 lg:h-9" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button className="h-11 bg-emerald-700 hover:bg-emerald-800 lg:h-9" onClick={save} disabled={saving || overLimit}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
