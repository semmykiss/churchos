"use client";

/**
 * People CRM Phase 7 — Public Visitor Connect Card admin ("Forms" tab).
 *
 * Builder: name, link (slug), field toggles + required flags, thank-you
 * message, approval queue toggle. Distribution: QR code + short link.
 * Review: the submissions queue (approve → person, reject) with dedupe info.
 */
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { useApiQuery } from "@/components/app/shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  Check, Copy, ExternalLink, Loader2, QrCode, Radio, Settings2, Trash2, UserCheck, Users, X,
} from "lucide-react";
import QRCode from "qrcode";
import {
  PUBLIC_FORM_CATALOG,
  type PublicFormDTO, type PublicFormSubmissionDTO,
} from "./crm-shared";

export function PublicFormsAdmin() {
  const qc = useQueryClient();
  const formsQ = useApiQuery<PublicFormDTO[]>(["people", "forms"], "/people/forms");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<PublicFormDTO | null>(null);
  const [reviewing, setReviewing] = useState<PublicFormDTO | null>(null);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["people", "forms"] });
    void qc.invalidateQueries({ queryKey: ["people"] });
  };

  const forms = formsQ.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">Visitor connect cards</h2>
          <p className="text-sm text-muted-foreground">
            Public forms your church shares by QR code or link — no login needed, submissions land here.
          </p>
        </div>
        <Button type="button" onClick={() => setCreating(true)}>
          <Radio className="h-4 w-4" aria-hidden /> New connect card
        </Button>
      </div>

      {formsQ.isLoading ? (
        <div className="grid place-items-center rounded-xl border p-10 text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> Loading…</div>
      ) : !forms.length ? (
        <div className="grid place-items-center gap-2 rounded-xl border border-dashed p-10 text-center">
          <QrCode className="h-8 w-8 text-muted-foreground" aria-hidden />
          <p className="text-sm font-medium">No connect cards yet</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Create one, print the QR code for the welcome desk, and every submission is deduped against your people list automatically.
          </p>
        </div>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {forms.map((form) => (
            <li key={form.id} className="rounded-xl border bg-card p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-medium">
                    {form.name}
                    <Badge variant="outline" className={cn("gap-1", form.enabled ? "border-success/40 text-success" : "text-muted-foreground")}>
                      {form.enabled ? "Live" : "Paused"}
                    </Badge>
                    {form.requireApproval ? <Badge variant="outline" className="border-warning/40 text-warning">Approval</Badge> : null}
                  </p>
                  <p className="mt-0.5 font-mono text-xs text-muted-foreground">/#/connect/{form.slug}</p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button type="button" size="icon" variant="ghost" className="h-8 w-8" aria-label={`Open ${form.name}`} onClick={() => window.open(`/#/connect/${form.slug}`, "_blank")}>
                    <ExternalLink className="h-4 w-4" aria-hidden />
                  </Button>
                  <Button type="button" size="icon" variant="ghost" className="h-8 w-8" aria-label={`Settings for ${form.name}`} onClick={() => setEditing(form)}>
                    <Settings2 className="h-4 w-4" aria-hidden />
                  </Button>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg border bg-surface-sunken py-1.5">
                  <p className="text-lg font-semibold tabular-nums">{form.submissionCounts?.total ?? 0}</p>
                  <p className="text-[11px] text-muted-foreground">Responses</p>
                </div>
                <div className="rounded-lg border bg-surface-sunken py-1.5">
                  <p className={cn("text-lg font-semibold tabular-nums", (form.submissionCounts?.pending ?? 0) > 0 && "text-warning")}>{form.submissionCounts?.pending ?? 0}</p>
                  <p className="text-[11px] text-muted-foreground">Awaiting review</p>
                </div>
                <div className="rounded-lg border bg-surface-sunken py-1.5">
                  <p className="text-lg font-semibold tabular-nums text-success">{form.submissionCounts?.converted ?? 0}</p>
                  <p className="text-[11px] text-muted-foreground">Added as guests</p>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => setReviewing(form)}>
                  <Users className="h-3.5 w-3.5" aria-hidden /> Submissions
                  {(form.submissionCounts?.pending ?? 0) > 0 ? <Badge className="ml-1 h-4 px-1 text-[10px]">{form.submissionCounts?.pending}</Badge> : null}
                </Button>
                <QrButton slug={form.slug} name={form.name} />
              </div>
            </li>
          ))}
        </ul>
      )}

      <FormBuilderDialog
        open={creating || !!editing}
        form={editing}
        onClose={() => { setCreating(false); setEditing(null); }}
        onSaved={() => { setCreating(false); setEditing(null); refresh(); }}
      />
      <SubmissionsDialog form={reviewing} onClose={() => setReviewing(null)} onChanged={refresh} />
    </div>
  );
}

// ── QR dialog ────────────────────────────────────────────────────────────────

function QrButton({ slug, name }: { slug: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const link = typeof window !== "undefined" ? `${window.location.origin}/#/connect/${slug}` : `/#/connect/${slug}`;

  const show = async () => {
    setOpen(true);
    try {
      const url = await QRCode.toDataURL(link, { width: 360, margin: 2, errorCorrectionLevel: "M" });
      setDataUrl(url);
    } catch {
      setDataUrl(null);
    }
  };

  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={() => void show()}>
        <QrCode className="h-3.5 w-3.5" aria-hidden /> QR code
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Share “{name}”</DialogTitle>
            <DialogDescription>Print the QR for the welcome desk, or copy the short link.</DialogDescription>
          </DialogHeader>
          <div className="grid place-items-center gap-3">
            {dataUrl ? (
              <img src={dataUrl} alt={`QR code linking to ${name}`} className="rounded-lg border p-2" width={280} height={280} />
            ) : (
              <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden />
            )}
            <div className="flex w-full items-center gap-2">
              <Input readOnly value={link} className="font-mono text-xs" aria-label="Form link" onFocus={(e) => e.target.select()} />
              <Button type="button" size="icon" variant="outline" className="h-9 w-9 shrink-0" aria-label="Copy link"
                onClick={() => { void navigator.clipboard.writeText(link); toast.success("Link copied."); }}>
                <Copy className="h-4 w-4" aria-hidden />
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── builder ──────────────────────────────────────────────────────────────────

function FormBuilderDialog({ open, form, onClose, onSaved }: { open: boolean; form: PublicFormDTO | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [thankYou, setThankYou] = useState("");
  const [requireApproval, setRequireApproval] = useState(false);
  const [fields, setFields] = useState<Record<string, { enabled: boolean; required: boolean }>>({});
  const [busy, setBusy] = useState(false);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  // load (or default-init) when the target changes
  const targetId = form?.id ?? "new";
  if (open && loadedFor !== targetId) {
    setLoadedFor(targetId);
    setName(form?.name ?? "");
    setSlug(form?.slug ?? "");
    setThankYou(form?.thankYouMessage ?? "");
    setRequireApproval(form?.requireApproval ?? false);
    const init: Record<string, { enabled: boolean; required: boolean }> = {};
    for (const f of PUBLIC_FORM_CATALOG) {
      const cur = form?.fields.find((x) => x.key === f.key);
      init[f.key] = { enabled: f.locked || !!cur || (!form && ["phone", "email", "visitingFrom", "interestedIn"].includes(f.key)), required: cur?.required ?? false };
    }
    setFields(init);
  }
  if (!open && loadedFor !== null) setLoadedFor(null);

  const submit = async () => {
    if (!name.trim()) { toast.error("Give the form a name."); return; }
    setBusy(true);
    try {
      const fieldList = Object.entries(fields).filter(([, v]) => v.enabled).map(([key, v]) => ({ key, required: v.required }));
      const body = { name: name.trim(), slug: slug.trim() || undefined, fields: fieldList, thankYouMessage: thankYou, requireApproval };
      if (form) {
        await api.patch(`/people/forms/${form.id}`, body);
        toast.success("Connect card updated.");
      } else {
        await api.post("/people/forms", body);
        toast.success("Connect card created — share the QR or link.");
      }
      onSaved();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save the form.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!form) return;
    try {
      await api.del(`/people/forms/${form.id}`);
      toast.success("Form deleted.");
      onSaved();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not delete the form.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-xl overflow-hidden p-0" aria-describedby={undefined}>
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle>{form ? "Edit connect card" : "New connect card"}</DialogTitle>
          <DialogDescription>Choose the fields visitors fill in — first and last name are always included.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-4 overflow-y-auto px-6 py-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="pf-name">Form name</Label>
              <Input id="pf-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Sunday service card" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pf-slug">Link name</Label>
              <div className="flex items-center gap-1">
                <span className="shrink-0 text-xs text-muted-foreground">/#/connect/</span>
                <Input id="pf-slug" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="sunday" className="font-mono text-xs" disabled={!!form} />
              </div>
            </div>
          </div>

          <div>
            <Label className="mb-1.5 block text-sm">Fields on the form</Label>
            <ul className="divide-y rounded-lg border">
              {PUBLIC_FORM_CATALOG.map((f) => {
                const st = fields[f.key] ?? { enabled: false, required: false };
                return (
                  <li key={f.key} className="flex items-center gap-3 px-3 py-2">
                    <Switch
                      checked={st.enabled} disabled={!!f.locked}
                      onCheckedChange={(v) => setFields((prev) => ({ ...prev, [f.key]: { ...st, enabled: v } }))}
                      aria-label={`Include ${f.label}`}
                    />
                    <span className={cn("flex-1 text-sm", !st.enabled && "text-muted-foreground")}>{f.label}</span>
                    {st.enabled && !f.locked ? (
                      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <input type="checkbox" className="accent-primary" checked={st.required}
                          onChange={(e) => setFields((prev) => ({ ...prev, [f.key]: { ...st, required: e.target.checked } }))} />
                        Required
                      </label>
                    ) : f.locked ? <Badge variant="outline" className="text-[10px]">always</Badge> : null}
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="pf-thanks">Thank-you message</Label>
            <Textarea id="pf-thanks" value={thankYou} onChange={(e) => setThankYou(e.target.value)} rows={2} placeholder="We're so glad you visited — someone will reach out this week!" />
          </div>

          <label className="flex items-start gap-3 rounded-lg border px-3 py-2.5">
            <Switch checked={requireApproval} onCheckedChange={setRequireApproval} aria-labelledby="pf-approval-label" />
            <span>
              <span id="pf-approval-label" className="block text-sm font-medium">Review before adding</span>
              <span className="text-xs text-muted-foreground">Submissions wait in the queue until someone approves them. Off: visitors are added immediately as guests.</span>
            </span>
          </label>
        </div>
        <div className="flex items-center justify-between gap-2 border-t px-6 py-3">
          {form ? (
            <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
              <AlertDialogTrigger asChild>
                <Button type="button" variant="ghost" size="sm" className="text-destructive"><Trash2 className="h-3.5 w-3.5" /> Delete</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader><AlertDialogTitle>Delete this form?</AlertDialogTitle>
                  <AlertDialogDescription>Only forms with no responses can be deleted — otherwise pause it instead.</AlertDialogDescription></AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void remove()}>Delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : <span />}
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="button" onClick={() => void submit()} disabled={busy || !name.trim()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null} Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── submissions queue ────────────────────────────────────────────────────────

function SubmissionsDialog({ form, onClose, onChanged }: { form: PublicFormDTO | null; onClose: () => void; onChanged: () => void }) {
  const [statusFilter, setStatusFilter] = useState<string>("pending");
  const subsQ = useQuery<PublicFormSubmissionDTO[]>({
    queryKey: ["people", "forms", form?.id, "submissions", statusFilter],
    queryFn: () => api.get<PublicFormSubmissionDTO[]>(`/people/forms/${form!.id}/submissions?status=${statusFilter}`),
    enabled: !!form,
  });
  const [busyId, setBusyId] = useState<string | null>(null);

  const review = async (id: string, decision: "approve" | "reject") => {
    setBusyId(id);
    try {
      await api.post(`/people/forms/submissions/${id}/review`, { decision });
      toast.success(decision === "approve" ? "Approved — visitor added as a guest." : "Submission rejected.");
      onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not review that submission.");
    } finally {
      setBusyId(null);
    }
  };

  const labels: Record<string, string> = { pending: "Awaiting review", converted: "Added", duplicate: "Existing person", rejected: "Rejected", approved: "Approved" };

  return (
    <Dialog open={!!form} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl overflow-hidden p-0" aria-describedby={undefined}>
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle>Submissions — {form?.name}</DialogTitle>
          <DialogDescription>Duplicates are matched against your people list automatically.</DialogDescription>
        </DialogHeader>
        <div className="flex gap-1 px-6 pt-3">
          {["pending", "converted", "duplicate", "rejected"].map((s) => (
            <button key={s} type="button" onClick={() => setStatusFilter(s)}
              className={cn("rounded-full px-3 py-1 text-xs", statusFilter === s ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-surface-sunken")}>
              {labels[s]}
            </button>
          ))}
        </div>
        <ScrollArea className="max-h-[55vh] px-6 pb-5 pt-2">
          {subsQ.isLoading ? (
            <div className="grid place-items-center py-8"><Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden /></div>
          ) : !(subsQ.data ?? []).length ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Nothing here yet.</p>
          ) : (
            <ul className="space-y-2">
              {(subsQ.data ?? []).map((s) => (
                <li key={s.id} className="rounded-lg border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium">{s.payload.firstName} {s.payload.lastName}</p>
                      <p className="text-xs text-muted-foreground">
                        {[s.payload.phone, s.payload.email].filter(Boolean).join(" · ") || "No contact details"}
                        {" · "}{new Date(s.createdAt).toLocaleString()}
                      </p>
                      {Object.entries(s.payload).filter(([k]) => !["firstName", "lastName", "phone", "email"].includes(k)).map(([k, v]) => (
                        <p key={k} className="mt-0.5 text-xs text-muted-foreground"><span className="capitalize">{k.replace(/([A-Z])/g, " $1")}:</span> {v}</p>
                      ))}
                      {s.duplicateOfName ? (
                        <Badge variant="outline" className="mt-1.5 border-warning/40 text-warning">Existing person: {s.duplicateOfName}</Badge>
                      ) : null}
                      {s.convertedName ? (
                        <Badge variant="outline" className="mt-1.5 border-success/40 text-success"><Check className="h-3 w-3" aria-hidden /> Added as {s.convertedName}</Badge>
                      ) : null}
                    </div>
                    {s.status === "pending" ? (
                      <div className="flex shrink-0 gap-1.5">
                        <Button type="button" size="sm" variant="outline" className="h-8" disabled={busyId === s.id} onClick={() => void review(s.id, "approve")}>
                          <UserCheck className="h-3.5 w-3.5 text-success" aria-hidden /> Approve
                        </Button>
                        <Button type="button" size="sm" variant="outline" className="h-8" disabled={busyId === s.id} onClick={() => void review(s.id, "reject")}>
                          <X className="h-3.5 w-3.5 text-destructive" aria-hidden /> Reject
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
