"use client";

/**
 * WhatsApp Broadcasts — template-based bulk sends. Audience uses the People
 * segment semantics (stage / groups / tags) intersected with the WhatsApp
 * opt-in ledger; Meta approval of the template is required before sending.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { canDo, fmtDateTime, STAGE_LABELS, type GroupDTO, type SessionUser } from "@/lib/types";
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
import { Checkbox } from "@/components/ui/checkbox";
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
import { toast } from "sonner";
import { Loader2, Megaphone, Play, Plus, Trash2, Users } from "lucide-react";
import type { WaAudiencePreviewResp, WaBroadcast, WaBroadcastsResp, WaTemplatesResp } from "@/components/app/whatsapp/WhatsAppModule";

const AUDIENCE_STAGES = ["guest", "returning_guest", "attender", "member", "leader", "inactive"] as const;

function BroadcastStatusBadge({ status }: { status: string }) {
  const cls =
    status === "sent"
      ? "border-transparent bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
      : status === "scheduled" || status === "sending"
        ? "border-transparent bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
        : status === "failed"
          ? "border-transparent bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200"
          : "border-transparent bg-muted text-muted-foreground"; // draft
  return <Badge variant="outline" className={cn("font-medium capitalize", cls)}>{status}</Badge>;
}

function canSendWhatsapp(user: SessionUser): boolean {
  return canDo(user, "comms.whatsapp.send") || canDo(user, "comms.send");
}

export default function BroadcastsTab({ user }: ModuleProps) {
  const qc = useQueryClient();
  const broadcastsQ = useApiQuery<WaBroadcastsResp>(["whatsapp", "broadcasts"], "/whatsapp/broadcasts");
  const [createOpen, setCreateOpen] = useState(false);
  const [sendRow, setSendRow] = useState<WaBroadcast | null>(null);
  const [deleteRow, setDeleteRow] = useState<WaBroadcast | null>(null);
  const [busy, setBusy] = useState(false);

  const broadcasts = broadcastsQ.data?.items ?? [];
  const canSend = canSendWhatsapp(user);

  async function refresh() {
    await qc.invalidateQueries({ queryKey: ["whatsapp"] });
  }

  async function sendBroadcast(row: WaBroadcast) {
    setBusy(true);
    try {
      const res = await api.post<{ sent: number; failed: number; skipped: number }>(`/whatsapp/broadcasts/${row.id}/send`);
      toast.success(`Broadcast sent — ${res.sent} delivered, ${res.failed} failed, ${res.skipped} skipped.`);
      setSendRow(null);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sending failed.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteBroadcast(row: WaBroadcast) {
    setBusy(true);
    try {
      await api.del(`/whatsapp/broadcasts/${row.id}`);
      toast.success("Broadcast deleted.");
      setDeleteRow(null);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Section
        title="Broadcasts"
        description="Send an approved template to an opted-in audience. Counts skip contacts without a WhatsApp number."
        actions={
          canSend ? (
            <Button className="h-11 lg:h-9" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" /> New broadcast
            </Button>
          ) : null
        }
      >
      {broadcastsQ.isLoading ? (
        <LoadingBlock label="Loading broadcasts…" />
      ) : broadcastsQ.isError ? (
        <ErrorBlock error={broadcastsQ.error} />
      ) : broadcasts.length === 0 ? (
        <EmptyState
          icon={Megaphone}
          title="No broadcasts yet"
          description="Create your first broadcast — pick an approved template and an audience of opted-in members."
        />
      ) : (
        <>
          {/* desktop table */}
          <div className="hidden overflow-x-auto rounded-lg border md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Broadcast</TableHead>
                  <TableHead>Template</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Results</TableHead>
                  <TableHead>Sent / scheduled</TableHead>
                  <TableHead>Created by</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {broadcasts.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="font-medium">{b.name}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{b.templateName ?? "—"}</TableCell>
                    <TableCell>
                      <BroadcastStatusBadge status={b.status} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      <span className="font-medium text-emerald-700 tabular-nums dark:text-emerald-400">{b.sentCount}</span>
                      <span className="text-muted-foreground"> sent · </span>
                      <span className="font-medium text-destructive tabular-nums">{b.failedCount}</span>
                      <span className="text-muted-foreground"> failed · </span>
                      <span className="font-medium text-muted-foreground tabular-nums">{b.skippedCount}</span>
                      <span className="text-muted-foreground"> skipped</span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {b.scheduledAt ? fmtDateTime(b.scheduledAt) : b.sentAt ? fmtDateTime(b.sentAt) : "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{b.createdByName ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      {canSend && b.status === "draft" ? (
                        <div className="flex justify-end gap-1.5">
                          <Button size="sm" variant="outline" className="h-9" onClick={() => setSendRow(b)}>
                            <Play className="h-3.5 w-3.5" /> Send
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-9 text-destructive hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => setDeleteRow(b)}
                          >
                            <Trash2 className="h-3.5 w-3.5" /> Delete
                          </Button>
                        </div>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* mobile cards */}
          <div className="space-y-3 md:hidden">
            {broadcasts.map((b) => (
              <Card key={b.id} className="py-0">
                <CardContent className="space-y-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-semibold">{b.name}</span>
                    <BroadcastStatusBadge status={b.status} />
                  </div>
                  <p className="font-mono text-xs text-muted-foreground">{b.templateName ?? "—"}</p>
                  <p className="text-xs text-muted-foreground">
                    {b.scheduledAt ? `Scheduled ${fmtDateTime(b.scheduledAt)}` : b.sentAt ? fmtDateTime(b.sentAt) : "Not sent yet"}
                    {b.createdByName ? ` · by ${b.createdByName}` : ""}
                  </p>
                  <p className="text-xs">
                    <span className="font-medium text-emerald-700 dark:text-emerald-400">{b.sentCount} sent</span>
                    <span className="text-muted-foreground"> · {b.failedCount} failed · {b.skippedCount} skipped</span>
                  </p>
                  {canSend && b.status === "draft" && (
                    <div className="flex gap-2 pt-1">
                      <Button size="sm" variant="outline" className="h-11 flex-1" onClick={() => setSendRow(b)}>
                        <Play className="h-4 w-4" /> Send now
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-11 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => setDeleteRow(b)}
                      >
                        <Trash2 className="h-4 w-4" /> Delete
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
      </Section>

      <CreateBroadcastDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={refresh} />

      {/* send confirm */}
      <AlertDialog open={!!sendRow} onOpenChange={(o) => !o && setSendRow(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send “{sendRow?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The template goes out immediately to every opted-in member matching the audience. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11 lg:h-9">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="h-11 lg:h-9 bg-emerald-700 text-white hover:bg-emerald-800"
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                if (sendRow) void sendBroadcast(sendRow);
              }}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send now"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* delete confirm */}
      <AlertDialog open={!!deleteRow} onOpenChange={(o) => !o && setDeleteRow(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleteRow?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>Draft broadcasts are removed permanently. Sent ones are kept for the record.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11 lg:h-9">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="h-11 lg:h-9 bg-destructive text-white hover:bg-destructive/90"
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                if (deleteRow) void deleteBroadcast(deleteRow);
              }}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ───────────────────────── create dialog ───────────────────────── */

function CreateBroadcastDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => Promise<void>;
}) {
  const templatesQ = useApiQuery<WaTemplatesResp>(["whatsapp", "templates"], "/whatsapp/templates", { enabled: open });
  const groupsQ = useApiQuery<{ items: GroupDTO[] }>(["whatsapp", "groups"], "/groups", { enabled: open });
  const tagsQ = useApiQuery<{ items: { id: string; name: string; color: string }[] }>(
    ["whatsapp", "tags"],
    "/tags",
    { enabled: open },
  );

  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState<string>("");
  const [stage, setStage] = useState<string[]>([]);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [preview, setPreview] = useState<WaAudiencePreviewResp | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);

  const templates = templatesQ.data?.items ?? [];
  const groups = groupsQ.data?.items ?? [];
  const tags = tagsQ.data?.items ?? [];

  function toggle(list: string[], id: string): string[] {
    return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  }

  function reset() {
    setName("");
    setTemplateId("");
    setStage([]);
    setGroupIds([]);
    setTagIds([]);
    setPreview(null);
  }

  async function runPreview() {
    setPreviewing(true);
    try {
      const res = await api.post<WaAudiencePreviewResp>("/whatsapp/audience/preview", { stage, groupIds, tagIds });
      setPreview(res);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Preview failed.");
    } finally {
      setPreviewing(false);
    }
  }

  async function save() {
    if (!name.trim() || !templateId) {
      toast.error("Give the broadcast a name and pick a template.");
      return;
    }
    setSaving(true);
    try {
      await api.post("/whatsapp/broadcasts", {
        name: name.trim(),
        templateId,
        audience: { stage, groupIds, tagIds },
      });
      toast.success("Broadcast created as a draft — send it from the list when ready.");
      onOpenChange(false);
      reset();
      await onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create the broadcast.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto scroll-slim sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New broadcast</DialogTitle>
          <DialogDescription>
            Only Meta-approved templates can be sent, and only members who opted in to WhatsApp receive it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="wa-bc-name">Name</Label>
            <Input
              id="wa-bc-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Sunday service reminder"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Template</Label>
            <Select value={templateId} onValueChange={setTemplateId}>
              <SelectTrigger className="w-full" aria-label="Broadcast template">
                <SelectValue placeholder="Choose an approved template…" />
              </SelectTrigger>
              <SelectContent>
                {templates.length === 0 && (
                  <p className="px-3 py-2 text-sm text-muted-foreground">No templates yet — create one in the Templates tab.</p>
                )}
                {templates.map((t) => (
                  <SelectItem key={t.id} value={t.id} disabled={t.status !== "approved"}>
                    {t.name}
                    {t.status !== "approved" ? " — pending approval" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Stage</Label>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by lifecycle stage">
              {AUDIENCE_STAGES.map((s) => {
                const on = stage.includes(s);
                return (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setStage(toggle(stage, s))}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                      on
                        ? "border-emerald-700 bg-emerald-700 text-white"
                        : "border-border bg-background text-muted-foreground hover:bg-muted",
                    )}
                  >
                    {STAGE_LABELS[s] ?? s}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-muted-foreground">Leave empty to include every stage.</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Groups</Label>
              <div className="scroll-slim max-h-40 space-y-1.5 overflow-y-auto rounded-lg border p-2.5">
                {groupsQ.isLoading ? (
                  <p className="text-xs text-muted-foreground">Loading groups…</p>
                ) : groups.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No groups found.</p>
                ) : (
                  groups.map((g) => (
                    <label key={g.id} className="flex min-h-8 cursor-pointer items-center gap-2 text-sm">
                      <Checkbox
                        checked={groupIds.includes(g.id)}
                        onCheckedChange={() => setGroupIds(toggle(groupIds, g.id))}
                        aria-label={`Include group ${g.name}`}
                      />
                      <span className="truncate">{g.name}</span>
                    </label>
                  ))
                )}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Tags</Label>
              <div className="scroll-slim max-h-40 space-y-1.5 overflow-y-auto rounded-lg border p-2.5">
                {tagsQ.isLoading ? (
                  <p className="text-xs text-muted-foreground">Loading tags…</p>
                ) : tags.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No tags found.</p>
                ) : (
                  tags.map((t) => (
                    <label key={t.id} className="flex min-h-8 cursor-pointer items-center gap-2 text-sm">
                      <Checkbox
                        checked={tagIds.includes(t.id)}
                        onCheckedChange={() => setTagIds(toggle(tagIds, t.id))}
                        aria-label={`Include tag ${t.name}`}
                      />
                      <span className="truncate">{t.name}</span>
                    </label>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Button variant="outline" className="h-11 lg:h-9" onClick={runPreview} disabled={previewing}>
              {previewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />} Preview audience
            </Button>
            {preview && (
              <div className="rounded-lg border bg-muted/40 p-3 text-sm">
                <p className="font-medium">
                  {preview.count} opted-in member{preview.count === 1 ? "" : "s"} match
                </p>
                {preview.sample.length > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    e.g. {preview.sample.map((s) => s.name).join(", ")}
                    {preview.count > preview.sample.length ? "…" : ""}
                  </p>
                )}
                {preview.count === 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Nobody matches — the broadcast will have nothing to send.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" className="h-11 lg:h-9" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button className="h-11 bg-emerald-700 hover:bg-emerald-800 lg:h-9" onClick={save} disabled={saving || !name.trim() || !templateId}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Create draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
