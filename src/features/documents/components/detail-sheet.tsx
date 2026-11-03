"use client";

/**
 * Detail side-sheet — tabs: Overview · Versions · Activity · Sharing ·
 * Comments. All action visibility comes from server-computed perms
 * (DocumentDetailResp.perms) — the UI never invents permissions.
 */
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { LoadingBlock } from "@/components/app/shared";
import { useDocument, useLookupUsers, useDocumentVersions, useDocumentComments } from "../hooks/use-documents";
import { useDocumentMutations } from "../hooks/use-document-mutations";
import { documentMetaSchema, type DocumentMetaInput } from "../schemas";
import { CATEGORY_LABELS, ACCESS_LEVELS_DMS, ACCESS_LEVEL_META, STATUS_META, STATUS_TRANSITIONS, SCAN_META, ACL_LEVELS, ACL_LEVEL_LABELS, ACL_SUBJECT_TYPES, STRINGS, ALL } from "../constants";
import { fmtBytes, fmtDate, fmtDateTime, timeAgo } from "../utils";
import { downloadBinary, openSignedDownload } from "../api/documents";
import type { SessionUser } from "@/lib/types";
import { canDo } from "@/lib/types";
import type { DocumentDTO } from "../types";
import { cn } from "@/lib/utils";
import {
  Download, Eye, Share2, Star, Loader2, History, ShieldCheck, Lock, LockOpen,
  Trash2, RotateCcw, Copy, Plus, MessageSquare, Send, Activity, Info, UploadCloud, FileWarning,
} from "lucide-react";

interface DetailSheetProps {
  documentId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: SessionUser;
  query: string;
  onPreview: (doc: DocumentDTO) => void;
  onChanged?: () => void;
}

export function DetailSheet({ documentId, open, onOpenChange, user, query, onPreview, onChanged }: DetailSheetProps) {
  const { data, isLoading, error } = useDocument(open ? documentId : null);
  const mutations = useDocumentMutations();
  const [tab, setTab] = useState("overview");

  if (!documentId) return null;

  const doc = data?.document;
  const perms = data?.perms;

  const workflowOptions = doc
    ? (STATUS_TRANSITIONS[doc.status as keyof typeof STATUS_TRANSITIONS] ?? []).map((target) => ({
        target,
        action: target === "in_review" ? "submit" : target === "draft" ? "reject" : target,
        label:
          target === "in_review" ? "Submit for review" :
          target === "draft" ? "Send back to draft" :
          target === "approved" ? "Approve" :
          target === "published" ? doc.status === "archived" ? "Re-publish" : "Publish" :
          "Archive",
      }))
    : [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-xl lg:max-w-2xl">
        {isLoading ? (
          <div className="space-y-3 p-6">
            <SheetHeader className="sr-only">
              <SheetTitle>Loading document…</SheetTitle>
            </SheetHeader>
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : error || !doc || !perms ? (
          <div className="p-6">
            <SheetHeader className="sr-only">
              <SheetTitle>Document unavailable</SheetTitle>
            </SheetHeader>
            <LoadingBlock label={error ? "This document is unavailable or you lack access." : "Loading…"} />
          </div>
        ) : (
          <>
            <SheetHeader className="gap-1 border-b px-5 py-4 text-left">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <SheetTitle className="truncate text-lg">{doc.title}</SheetTitle>
                  <SheetDescription className="truncate">
                    {doc.folderName ? `${doc.folderName} · ` : ""}v{doc.currentVersion} · {fmtBytes(doc.byteSize)} · updated {timeAgo(doc.updatedAt)}
                  </SheetDescription>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    size="icon" variant="ghost"
                    aria-label={doc.favorite ? "Remove from favorites" : "Add to favorites"}
                    aria-pressed={doc.favorite}
                    className={doc.favorite ? "text-warning" : "text-ink-muted"}
                    onClick={() => void mutations.toggleFavorite(doc)}
                  >
                    <Star className={cn("h-4 w-4", doc.favorite && "fill-current")} />
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 pt-1">
                <Badge variant="outline" className="border-transparent bg-primary/10 text-primary">{CATEGORY_LABELS[doc.category as keyof typeof CATEGORY_LABELS] ?? doc.category}</Badge>
                <Badge variant="outline" className="border-transparent bg-muted text-muted-foreground">{STATUS_META[doc.status as keyof typeof STATUS_META]?.label ?? doc.status}</Badge>
                <Badge variant="outline" className="border-transparent bg-violet/10 text-violet">{ACCESS_LEVEL_META[doc.accessLevel as keyof typeof ACCESS_LEVEL_META]?.label ?? doc.accessLevel}</Badge>
                {doc.scanStatus !== "clean" ? (
                  <Badge variant="outline" className={cn("border-transparent gap-1", doc.scanStatus === "infected" ? "bg-danger-bg text-danger" : "bg-muted text-muted-foreground")}>
                    <FileWarning className="h-3 w-3" aria-hidden /> {SCAN_META[doc.scanStatus as keyof typeof SCAN_META]?.label ?? doc.scanStatus}
                  </Badge>
                ) : null}
                {doc.legalHold ? <Badge variant="outline" className="border-transparent bg-danger-bg text-danger">legal hold</Badge> : null}
                {doc.lockedByName ? <Badge variant="outline" className="border-transparent bg-muted text-muted-foreground">checked out by {doc.lockedByName}</Badge> : null}
              </div>
            </SheetHeader>

            <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
              <TabsList className="mx-5 mt-3 w-fit">
                <TabsTrigger value="overview">{STRINGS.overview}</TabsTrigger>
                <TabsTrigger value="versions">{STRINGS.versions} ({doc.versionCount})</TabsTrigger>
                <TabsTrigger value="activity">{STRINGS.activity}</TabsTrigger>
                <TabsTrigger value="sharing">{STRINGS.share}</TabsTrigger>
                <TabsTrigger value="comments">{STRINGS.comments}</TabsTrigger>
              </TabsList>

              <ScrollArea className="min-h-0 flex-1">
                <div className="px-5 py-4">
                  {/* ── OVERVIEW ─────────────────────────────────────────── */}
                  <TabsContent value="overview" className="mt-0 space-y-4 focus-visible:outline-none">
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        onClick={() => onPreview(doc)}
                        disabled={!perms.canPreview}
                      >
                        <Eye className="h-4 w-4" aria-hidden /> {STRINGS.preview}
                      </Button>
                      <Button
                        size="sm" variant="outline"
                        onClick={() => {
                          void openSignedDownload(doc.id).catch((e) => toast.error(e instanceof Error ? e.message : "Download failed."));
                        }}
                        disabled={!perms.canDownload}
                        title={doc.downloadRestricted ? "Downloads are restricted for this document" : undefined}
                      >
                        <Download className="h-4 w-4" aria-hidden /> {STRINGS.download}
                      </Button>
                      {perms.canEdit ? (
                        doc.lockedById === user.membershipId ? (
                          <Button size="sm" variant="outline" onClick={() => void mutations.unlock(doc.id)}>
                            <LockOpen className="h-4 w-4" aria-hidden /> Check in
                          </Button>
                        ) : !doc.lockedById ? (
                          <Button size="sm" variant="outline" onClick={() => void mutations.lock(doc.id)}>
                            <Lock className="h-4 w-4" aria-hidden /> Check out
                          </Button>
                        ) : null
                      ) : null}
                      {perms.canDelete ? (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button size="sm" variant="destructive" disabled={doc.legalHold} title={doc.legalHold ? "Legal hold — release it first" : undefined}>
                              <Trash2 className="h-4 w-4" aria-hidden /> Trash
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Move “{doc.title}” to Trash?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Share links are revoked immediately. You can restore it from the Trash, or delete it forever later.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                onClick={() => {
                                  mutations.trashDocument(doc);
                                  onOpenChange(false);
                                  onChanged?.();
                                }}
                              >
                                Move to Trash
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      ) : null}
                    </div>

                    {/* workflow */}
                    {doc.status !== "published" || perms.canApprove ? (
                      <section className="rounded-xl border p-3.5" aria-label="Approval workflow">
                        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                          <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Workflow
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          {workflowOptions.map((w) => {
                            const needsApprove = ["approved", "published", "archived"].includes(w.target) || (w.target === "draft" && doc.status === "in_review");
                            const allowed = needsApprove ? perms.canApprove : perms.canEdit;
                            return (
                              <Button
                                key={w.action + w.target}
                                size="sm"
                                variant={needsApprove ? "default" : "outline"}
                                disabled={!allowed}
                                onClick={() => void mutations.runWorkflow(doc.id, w.action).then(() => onChanged?.())}
                              >
                                {w.label}
                              </Button>
                            );
                          })}
                          {!workflowOptions.length ? <p className="text-xs text-ink-muted">No workflow actions from this state.</p> : null}
                        </div>
                        {doc.workflowNote ? <p className="mt-2 text-xs text-ink-secondary">Reviewer note: “{doc.workflowNote}”</p> : null}
                        {doc.approvedByName ? <p className="mt-1 text-xs text-ink-muted">Approved by {doc.approvedByName} · {fmtDateTime(doc.approvedAt)}</p> : null}
                      </section>
                    ) : null}

                    <Separator />
                    <OverviewForm doc={doc} perms={perms} onChanged={onChanged} />
                  </TabsContent>

                  {/* ── VERSIONS ─────────────────────────────────────────── */}
                  <TabsContent value="versions" className="mt-0 focus-visible:outline-none">
                    <VersionsTab doc={doc} perms={perms} onChanged={onChanged} />
                  </TabsContent>

                  {/* ── ACTIVITY ─────────────────────────────────────────── */}
                  <TabsContent value="activity" className="mt-0 space-y-3 focus-visible:outline-none">
                    {perms.canAudit ? (
                      <Button
                        size="sm" variant="outline"
                        onClick={() => void downloadBinary(`/documents/audit/export?documentId=${doc.id}`).catch((e) => toast.error(e.message))}
                      >
                        <Download className="h-4 w-4" aria-hidden /> Export audit CSV
                      </Button>
                    ) : null}
                    {data.recentActivity.length ? (
                      <ol className="space-y-2.5">
                        {data.recentActivity.map((a) => (
                          <li key={a.id} className="flex items-start gap-2.5 rounded-lg bg-muted/50 px-3 py-2">
                            <Activity className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-muted" aria-hidden />
                            <div className="min-w-0 flex-1">
                              <p className="text-xs text-ink">
                                <span className="font-semibold">{a.actorLabel ?? "System"}</span>{" "}
                                {a.action.replace("document.", "").replace(/_/g, " ")}
                              </p>
                              <p className="text-[11px] text-ink-muted">{fmtDateTime(a.createdAt)}{a.ip ? ` · ${a.ip}` : ""}</p>
                            </div>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="py-6 text-center text-sm text-ink-muted">No activity recorded yet.</p>
                    )}
                  </TabsContent>

                  {/* ── SHARING ──────────────────────────────────────────── */}
                  <TabsContent value="sharing" className="mt-0 focus-visible:outline-none">
                    <SharingTab doc={doc} perms={perms} onChanged={onChanged} />
                  </TabsContent>

                  {/* ── COMMENTS ─────────────────────────────────────────── */}
                  <TabsContent value="comments" className="mt-0 focus-visible:outline-none">
                    <CommentsTab doc={doc} user={user} perms={perms} />
                  </TabsContent>
                </div>
              </ScrollArea>
            </Tabs>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ── Overview metadata form (react-hook-form + zod, values/reset pattern) ────

function OverviewForm({ doc, perms, onChanged }: { doc: DocumentDTO; perms: { canEdit: boolean; canDelete: boolean }; onChanged?: () => void }) {
  const mutations = useDocumentMutations();
  const form = useForm<DocumentMetaInput>({
    resolver: zodResolver(documentMetaSchema),
    values: {
      title: doc.title,
      description: doc.description ?? "",
      category: doc.category as DocumentMetaInput["category"],
      accessLevel: doc.accessLevel as DocumentMetaInput["accessLevel"],
      folderId: doc.folderId ?? "",
      tags: doc.tags.map((t) => t.name),
      expiresAt: doc.expiresAt ? doc.expiresAt.slice(0, 10) : "",
      reviewAt: doc.reviewAt ? doc.reviewAt.slice(0, 10) : "",
      downloadRestricted: doc.downloadRestricted,
      watermark: doc.watermark,
    },
  });

  // reset form whenever a different document loads
  const docIdRef = useRef(doc.id);
  useEffect(() => {
    if (docIdRef.current !== doc.id) {
      docIdRef.current = doc.id;
      form.reset({
        title: doc.title,
        description: doc.description ?? "",
        category: doc.category as DocumentMetaInput["category"],
        accessLevel: doc.accessLevel as DocumentMetaInput["accessLevel"],
        folderId: doc.folderId ?? "",
        tags: doc.tags.map((t) => t.name),
        expiresAt: doc.expiresAt ? doc.expiresAt.slice(0, 10) : "",
        reviewAt: doc.reviewAt ? doc.reviewAt.slice(0, 10) : "",
        downloadRestricted: doc.downloadRestricted,
        watermark: doc.watermark,
      });
    }
  }, [doc, form]);

  const save = form.handleSubmit(async (values) => {
    try {
      await mutations.updateDocument(doc.id, { ...values, expiresAt: values.expiresAt || null, reviewAt: values.reviewAt || null });
      onChanged?.();
    } catch {
      /* toast already shown */
    }
  });

  return (
    <form onSubmit={(e) => void save(e)} className="grid gap-3" aria-label="Document metadata">
      {!perms.canEdit ? (
        <p className="flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2 text-xs text-ink-muted">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          You have read access to this document{doc.downloadRestricted ? " and downloads are restricted" : ""}.
        </p>
      ) : null}
      <div className="grid gap-1.5">
        <Label htmlFor="meta-title">Title</Label>
        <Input id="meta-title" disabled={!perms.canEdit} {...form.register("title")} />
        {form.formState.errors.title ? <p className="text-xs text-danger">{form.formState.errors.title.message}</p> : null}
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="meta-desc">Description</Label>
        <Textarea id="meta-desc" rows={2} disabled={!perms.canEdit} {...form.register("description")} />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="meta-category">Category</Label>
          <Select value={form.watch("category")} onValueChange={(v) => form.setValue("category", v as DocumentMetaInput["category"])} disabled={!perms.canEdit}>
            <SelectTrigger id="meta-category"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="meta-access">Access level</Label>
          <Select value={form.watch("accessLevel")} onValueChange={(v) => form.setValue("accessLevel", v as DocumentMetaInput["accessLevel"])} disabled={!perms.canEdit}>
            <SelectTrigger id="meta-access"><SelectValue /></SelectTrigger>
            <SelectContent>
              {ACCESS_LEVELS_DMS.map((l) => (
                <SelectItem key={l} value={l}>{ACCESS_LEVEL_META[l].label} — {ACCESS_LEVEL_META[l].description}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="meta-tags">Tags (comma separated)</Label>
        <Input
          id="meta-tags"
          disabled={!perms.canEdit}
          defaultValue={doc.tags.map((t) => t.name).join(", ")}
          onChange={(e) => form.setValue("tags", e.target.value.split(",").map((t) => t.trim()).filter(Boolean))}
        />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="meta-expires">Expires on</Label>
          <Input id="meta-expires" type="date" disabled={!perms.canEdit} {...form.register("expiresAt")} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="meta-review">Review on</Label>
          <Input id="meta-review" type="date" disabled={!perms.canEdit} {...form.register("reviewAt")} />
        </div>
      </div>
      {perms.canDelete ? (
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-ink-secondary">
            <Checkbox
              checked={form.watch("downloadRestricted")}
              onCheckedChange={(v) => form.setValue("downloadRestricted", v === true)}
            />
            Restrict downloads (finance/pastoral mode)
          </label>
        </div>
      ) : null}
      {perms.canEdit ? (
        <div className="flex items-center gap-2">
          <Button type="submit" size="sm" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null} Save changes
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => form.reset()}>Reset</Button>
        </div>
      ) : null}
    </form>
  );
}

// ── Versions tab ─────────────────────────────────────────────────────────────

function VersionsTab({ doc, perms, onChanged }: { doc: DocumentDTO; perms: { canEdit: boolean; canDownload: boolean }; onChanged?: () => void }) {
  const mutations = useDocumentMutations();
  const { data: versions, isLoading } = useDocumentVersions(doc.id);
  const [changelog, setChangelog] = useState("");
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const uploadVersion = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("meta", JSON.stringify({ documentId: doc.id, changelog }));
      const res = await fetch("/api/v1/documents-upload", { method: "POST", body: form, credentials: "same-origin" });
      const data = await res.json();
      if (!res.ok || data?.error) throw new Error(data?.message ?? "Version upload failed.");
      toast.success(`Version ${doc.currentVersion + 1} uploaded.`);
      setChangelog("");
      onChanged?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Version upload failed.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-3">
      {perms.canEdit ? (
        <div className="rounded-xl border p-3.5">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">
            <UploadCloud className="h-3.5 w-3.5" aria-hidden /> {STRINGS.uploadNewVersion}
          </p>
          <div className="mt-2 grid gap-2">
            <Input
              value={changelog}
              onChange={(e) => setChangelog(e.target.value)}
              placeholder="What changed in this version? (optional)"
              aria-label="Version changelog"
            />
            <input
              ref={inputRef}
              type="file"
              className="sr-only"
              aria-label="Choose file for new version"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void uploadVersion(file);
                e.target.value = "";
              }}
            />
            <Button size="sm" variant="outline" onClick={() => inputRef.current?.click()} disabled={uploading}>
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <UploadCloud className="h-4 w-4" aria-hidden />}
              Choose file &amp; upload
            </Button>
          </div>
        </div>
      ) : null}

      {isLoading ? (
        <LoadingBlock />
      ) : (
        <ol className="space-y-2">
          {(versions ?? []).map((v) => (
            <li key={v.id} className="rounded-lg border px-3.5 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-medium text-ink">
                    <History className="h-3.5 w-3.5 text-ink-muted" aria-hidden />
                    Version {v.version}
                    {v.current ? <Badge variant="outline" className="border-transparent bg-success-bg text-success">current</Badge> : null}
                  </p>
                  <p className="truncate text-xs text-ink-muted">{v.fileName} · {fmtBytes(v.byteSize)} · {v.uploadedByName ?? "—"} · {fmtDate(v.createdAt)}</p>
                  {v.changelog ? <p className="mt-0.5 text-xs text-ink-secondary">“{v.changelog}”</p> : null}
                  <p className="mt-0.5 font-mono text-[10px] text-ink-muted/70">sha256: {v.checksum.slice(0, 16)}…</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {perms.canDownload && v.downloadUrl ? (
                    <Button
                      size="sm" variant="ghost"
                      aria-label={`Download version ${v.version}`}
                      onClick={() => window.open(v.downloadUrl!, "_blank", "noopener")}
                    >
                      <Download className="h-4 w-4" aria-hidden />
                    </Button>
                  ) : null}
                  {perms.canEdit && !v.current ? (
                    <Button
                      size="sm" variant="outline"
                      aria-label={`Restore version ${v.version}`}
                      onClick={() => void mutations.restoreVersion(doc.id, v.id).then(() => onChanged?.())}
                    >
                      <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Restore
                    </Button>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// ── Sharing tab (share links + ACL overrides) ────────────────────────────────

function SharingTab({ doc, perms, onChanged }: { doc: DocumentDTO; perms: { canShare: boolean; canDelete: boolean }; onChanged?: () => void }) {
  const mutations = useDocumentMutations();
  const { data: users } = useLookupUsers(perms.canShare);
  const [expiresHours, setExpiresHours] = useState("168");
  const [password, setPassword] = useState("");
  const [maxDownloads, setMaxDownloads] = useState("");
  const [creating, setCreating] = useState(false);
  const [aclSubject, setAclSubject] = useState({ type: "user", id: "", label: "" });
  const [aclLevel, setAclLevel] = useState("read");

  const create = async () => {
    setCreating(true);
    try {
      const link = await mutations.createShareLink(doc.id, {
        expiresInHours: expiresHours && expiresHours !== ALL ? Number(expiresHours) : null,
        password: password || undefined,
        maxDownloads: maxDownloads ? Number(maxDownloads) : null,
      });
      await navigator.clipboard.writeText(`${window.location.origin}${link.url}`).catch(() => {});
      toast.success("Secure link created and copied to clipboard.");
      setPassword("");
      setMaxDownloads("");
      onChanged?.();
    } catch {
      /* toast already shown */
    } finally {
      setCreating(false);
    }
  };

  const addAcl = async () => {
    if (!aclSubject.id) {
      toast.error("Pick a user, role or department first.");
      return;
    }
    try {
      const res = await fetch(`/api/v1/documents/${doc.id}/acls`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ subjectType: aclSubject.type, subjectId: aclSubject.id, subjectLabel: aclSubject.label, level: aclLevel }),
      });
      const data = await res.json();
      if (!res.ok || data?.error) throw new Error(data?.message ?? "Could not add the override.");
      toast.success("Access override added.");
      onChanged?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add the override.");
    }
  };

  const removeAcl = async (aclId: string) => {
    try {
      const res = await fetch(`/api/v1/documents/${doc.id}/acls/${aclId}`, { method: "DELETE", credentials: "same-origin" });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.error) throw new Error(data?.message ?? "Could not remove the override.");
      toast.success("Access override removed.");
      onChanged?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove the override.");
    }
  };

  return (
    <div className="space-y-4">
      <section className="rounded-xl border p-3.5" aria-label="Share links">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">
          <Share2 className="h-3.5 w-3.5" aria-hidden /> Secure share links
        </p>
        {perms.canShare ? (
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            <Select value={expiresHours} onValueChange={setExpiresHours}>
              <SelectTrigger aria-label="Link expiry"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1 hour</SelectItem>
                <SelectItem value="24">1 day</SelectItem>
                <SelectItem value="168">7 days</SelectItem>
                <SelectItem value="720">30 days</SelectItem>
                <SelectItem value={ALL}>Never expires</SelectItem>
              </SelectContent>
            </Select>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password (optional)" aria-label="Link password" />
            <Input type="number" min={1} value={maxDownloads} onChange={(e) => setMaxDownloads(e.target.value)} placeholder="Max downloads (optional)" aria-label="Maximum downloads" />
            <Button size="sm" className="sm:col-span-3" onClick={() => void create()} disabled={creating}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />} Create secure link
            </Button>
          </div>
        ) : (
          <p className="mt-2 text-xs text-ink-muted">You do not have permission to share this document.</p>
        )}

        <Separator className="my-3" />
        <ShareLinksList docId={doc.id} onChanged={onChanged} canShare={perms.canShare} />
      </section>

      <section className="rounded-xl border p-3.5" aria-label="Access overrides">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Per-document access overrides
        </p>
        <p className="mt-1 text-xs text-ink-muted">Grants and blocks layered on top of the document&apos;s access level. “Blocked” always wins.</p>
        {perms.canShare ? (
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            <Select value={aclSubject.type} onValueChange={(v) => setAclSubject((s) => ({ ...s, type: v, id: "", label: "" }))}>
              <SelectTrigger aria-label="Override type"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ACL_SUBJECT_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>{t === "user" ? "Person" : t === "role" ? "Role" : "Department"}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {aclSubject.type === "user" ? (
              <Select
                value={aclSubject.id}
                onValueChange={(v) => {
                  const u = (users ?? []).find((x) => x.membershipId === v);
                  setAclSubject((s) => ({ ...s, id: v, label: u?.name ?? v }));
                }}
              >
                <SelectTrigger aria-label="Pick person"><SelectValue placeholder="Pick person…" /></SelectTrigger>
                <SelectContent>
                  {(users ?? []).map((u) => (
                    <SelectItem key={u.membershipId} value={u.membershipId}>{u.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                value={aclSubject.id}
                onChange={(e) => setAclSubject((s) => ({ ...s, id: e.target.value, label: e.target.value }))}
                placeholder={aclSubject.type === "role" ? "role key e.g. finance" : "department (group) id"}
                aria-label="Subject id"
              />
            )}
            <Select value={aclLevel} onValueChange={setAclLevel}>
              <SelectTrigger aria-label="Override level"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ACL_LEVELS.map((l) => (
                  <SelectItem key={l} value={l}>{ACL_LEVEL_LABELS[l]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" className="sm:col-span-3" onClick={() => void addAcl()}>
              <Plus className="h-4 w-4" aria-hidden /> Add override
            </Button>
          </div>
        ) : null}
        <Separator className="my-3" />
        <AclList docId={doc.id} canShare={perms.canShare} onRemove={removeAcl} onChanged={onChanged} />
      </section>
    </div>
  );
}

function ShareLinksList({ docId, canShare, onChanged }: { docId: string; canShare: boolean; onChanged?: () => void }) {
  const { data, isLoading } = useDocument(docId);
  const mutations = useDocumentMutations();
  if (isLoading) return <LoadingBlock />;
  const links = data?.shareLinks ?? [];
  if (!links.length) return <p className="py-2 text-xs text-ink-muted">No active share links.</p>;
  return (
    <ul className="space-y-2 pt-1">
      {links.map((l) => (
        <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/50 px-3 py-2">
          <div className="min-w-0">
            <p className="truncate font-mono text-xs text-ink">/shared-document?token={l.token.slice(0, 12)}…</p>
            <p className="text-[11px] text-ink-muted">
              {l.hasPassword ? "password protected · " : ""}
              {l.expiresAt ? `expires ${fmtDateTime(l.expiresAt)} · ` : "no expiry · "}
              {l.maxDownloads != null ? `${l.downloadCount}/${l.maxDownloads} downloads` : `${l.downloadCount} downloads`}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <Button
              size="sm" variant="ghost"
              aria-label="Copy link"
              onClick={() => {
                void navigator.clipboard.writeText(`${window.location.origin}${l.url}`);
                toast.success("Link copied.");
              }}
            >
              <Copy className="h-3.5 w-3.5" aria-hidden />
            </Button>
            {canShare && !l.revokedAt ? (
              <Button size="sm" variant="ghost" className="text-danger" onClick={() => void mutations.revokeShareLink(docId, l.id).then(() => onChanged?.())} aria-label="Revoke link">
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </Button>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

function AclList({ docId, canShare, onRemove, onChanged }: { docId: string; canShare: boolean; onRemove: (id: string) => void; onChanged?: () => void }) {
  const { data, isLoading } = useDocument(docId);
  if (isLoading) return <LoadingBlock />;
  const acls = data?.acls ?? [];
  if (!acls.length) return <p className="py-2 text-xs text-ink-muted">No per-document overrides.</p>;
  return (
    <ul className="space-y-1.5 pt-1">
      {acls.map((a) => (
        <li key={a.id} className="flex items-center justify-between gap-2 rounded-lg bg-muted/50 px-3 py-2">
          <p className="text-xs text-ink">
            <span className="font-semibold">{a.subjectLabel}</span>{" "}
            <span className="text-ink-muted">({a.subjectType})</span> — {ACL_LEVEL_LABELS[a.level as keyof typeof ACL_LEVEL_LABELS] ?? a.level}
          </p>
          {canShare ? (
            <Button
              size="sm" variant="ghost" className="text-danger"
              aria-label={`Remove override for ${a.subjectLabel}`}
              onClick={() => {
                onRemove(a.id);
                onChanged?.();
              }}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

// ── Comments tab ─────────────────────────────────────────────────────────────

function CommentsTab({ doc, user, perms }: { doc: DocumentDTO; user: SessionUser; perms: { canDelete: boolean; canEdit: boolean } }) {
  const mutations = useDocumentMutations();
  const { data: comments, isLoading } = useDocumentComments(doc.id);
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);

  const post = async () => {
    if (!body.trim()) return;
    setPosting(true);
    try {
      await mutations.addComment(doc.id, body);
      setBody("");
    } catch {
      /* toast shown */
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-2">
        <Label htmlFor="comment-body" className="sr-only">Add a comment</Label>
        <Textarea
          id="comment-body"
          rows={2}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={`Discuss “${doc.title}” — @name to mention someone`}
        />
        <Button size="sm" className="w-fit" onClick={() => void post()} disabled={posting || !body.trim()}>
          {posting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />} Post
        </Button>
      </div>
      {isLoading ? (
        <LoadingBlock />
      ) : (comments ?? []).length ? (
        <ol className="space-y-2">
          {(comments ?? []).map((c) => (
            <li key={c.id} className="rounded-lg border px-3.5 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-ink">
                  <MessageSquare className="h-3 w-3 text-ink-muted" aria-hidden />
                  {c.authorName}
                  <span className="font-normal text-ink-muted">· {timeAgo(c.createdAt)}</span>
                </p>
                {(c.mine || perms.canDelete) ? (
                  <Button size="sm" variant="ghost" className="h-6 text-danger" aria-label="Delete comment" onClick={() => void mutations.deleteComment(doc.id, c.id)}>
                    <Trash2 className="h-3 w-3" aria-hidden />
                  </Button>
                ) : null}
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-ink-secondary">
                {c.body.split(/(@[\w .,'-]{2,40})/g).map((part, i) =>
                  part.startsWith("@") ? (
                    <mark key={i} className="rounded bg-primary/10 px-0.5 font-medium text-primary">{part}</mark>
                  ) : (
                    <span key={i}>{part}</span>
                  )
                )}
              </p>
            </li>
          ))}
        </ol>
      ) : (
        <p className="py-4 text-center text-sm text-ink-muted">No comments yet — start the conversation.</p>
      )}
    </div>
  );
}
