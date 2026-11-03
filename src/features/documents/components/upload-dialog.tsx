"use client";

/**
 * Upload dialog — drag-and-drop multi-file upload (with keyboard fallback via
 * the file input), metadata form (react-hook-form + zod), and a live upload
 * queue with per-file progress, cancel and retry. Progress is announced via
 * aria-live for screen readers.
 */
import { useCallback, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useLookupTags } from "../hooks/use-documents";
import { useUploadQueue } from "../hooks/use-upload";
import { documentMetaSchema, type DocumentMetaInput } from "../schemas";
import { ALL, DOCUMENT_CATEGORIES, CATEGORY_LABELS, ACCESS_LEVELS_DMS, ACCESS_LEVEL_META, STRINGS, type DocumentAccessLevel } from "../constants";
import { fmtBytes } from "../utils";
import type { DocumentDTO, FolderDTO } from "../types";
import type { SessionUser } from "@/lib/types";
import { canDo } from "@/lib/types";
import { cn } from "@/lib/utils";
import { CloudUpload, File as FileIcon, X, RotateCcw, Loader2, CheckCircle2, AlertCircle } from "lucide-react";

const ALLOWED_FOR_LEVEL = (user: SessionUser): DocumentAccessLevel[] => {
  // mirror of the server's assertCanSetAccessLevel — UI convenience only
  const rank =
    canDo(user, "documents.settings") || user.roleKeys.includes("owner") || user.roleKeys.includes("campus_admin") ? 4
    : user.roleKeys.includes("pastor") || canDo(user, "care.risk.view.all") ? 4
    : user.roleKeys.includes("finance") || canDo(user, "accounting.manage") ? 3
    : canDo(user, "documents.approve") || user.roleKeys.includes("ministry_leader") || user.roleKeys.includes("minister") ? 2
    : canDo(user, "documents.edit") || user.roleKeys.includes("head_usher") ? 1
    : 0;
  return ACCESS_LEVELS_DMS.filter((l) => ACCESS_LEVEL_META[l].rank <= rank);
};

interface UploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: SessionUser;
  folders: FolderDTO[];
  defaultFolderId?: string | null;
  onUploaded?: (doc: DocumentDTO) => void;
}

export function UploadDialog({ open, onOpenChange, user, folders, defaultFolderId, onUploaded }: UploadDialogProps) {
  const [dragOver, setDragOver] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const queue = useUploadQueue(onUploaded);
  const canCreate = canDo(user, "documents.create");
  const allowedLevels = ALLOWED_FOR_LEVEL(user);
  const { data: tagOptions } = useLookupTags(canCreate);

  const form = useForm<DocumentMetaInput>({
    resolver: zodResolver(documentMetaSchema),
    defaultValues: {
      title: "",
      description: "",
      category: "resource",
      accessLevel: "members",
      folderId: defaultFolderId ?? "",
      tags: [],
      expiresAt: "",
      reviewAt: "",
      downloadRestricted: false,
      watermark: false,
    },
  });

  const setFiles = useCallback((files: File[]) => {
    setSelectedFiles(files);
    const first = files[0];
    if (first && !form.getValues("title")) {
      form.setValue("title", first.name.replace(/\.[^.]+$/, "").slice(0, 200));
    }
  }, [form]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length) setFiles(files);
  }, [setFiles]);

  const submit = form.handleSubmit((values) => {
    if (!selectedFiles.length) {
      toast.error("Choose at least one file to upload.");
      return;
    }
    queue.addFiles(selectedFiles, { ...values, tags: values.tags ?? [] });
    setSelectedFiles([]);
    form.reset({ ...values, title: "", description: "" });
  });

  const close = () => {
    onOpenChange(false);
  };

  const busyCount = queue.items.filter((it) => it.status === "uploading" || it.status === "queued").length;

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl" role="dialog" aria-label="Upload documents">
        <DialogHeader>
          <DialogTitle>{STRINGS.upload}</DialogTitle>
          <DialogDescription>
            Drag files here or browse. Files are validated (type, size, content) and virus-scanned before they appear in the library.
          </DialogDescription>
        </DialogHeader>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={cn(
            "flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-7 text-center transition-colors",
            dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50",
            !canCreate && "pointer-events-none opacity-50"
          )}
        >
          <CloudUpload className="h-8 w-8 text-primary" aria-hidden />
          <p className="text-sm font-medium text-ink">Drag &amp; drop files here</p>
          <p className="text-xs text-ink-muted">or</p>
          <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={!canCreate}>
            Browse files
          </Button>
          <input
            ref={inputRef}
            type="file"
            multiple
            className="sr-only"
            aria-label="Choose files to upload"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              if (files.length) setFiles(files);
              e.target.value = "";
            }}
          />
          {selectedFiles.length ? (
            <ul className="mt-2 w-full space-y-1 text-left" aria-label="Selected files">
              {selectedFiles.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2 rounded-md bg-muted/60 px-2.5 py-1.5 text-xs">
                  <span className="flex min-w-0 items-center gap-1.5 text-ink">
                    <FileIcon className="h-3.5 w-3.5 shrink-0 text-ink-muted" aria-hidden />
                    <span className="truncate">{f.name}</span>
                  </span>
                  <span className="shrink-0 tabular-nums text-ink-muted">{fmtBytes(f.size)}</span>
                  <button
                    type="button"
                    className="rounded p-0.5 text-ink-muted hover:bg-accent hover:text-ink"
                    aria-label={`Remove ${f.name}`}
                    onClick={() => setFiles(selectedFiles.filter((_, j) => j !== i))}
                  >
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <form onSubmit={(e) => void submit(e)} className="grid gap-3.5">
          <div className="grid gap-1.5">
            <Label htmlFor="doc-title">Title</Label>
            <Input id="doc-title" {...form.register("title")} placeholder="e.g. 2026 Child Protection Policy" />
            {form.formState.errors.title ? <p className="text-xs text-danger">{form.formState.errors.title.message}</p> : null}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="doc-desc">Description <span className="text-ink-muted">(optional)</span></Label>
            <Textarea id="doc-desc" rows={2} {...form.register("description")} placeholder="What is this document for?" />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <Label htmlFor="doc-category">Category</Label>
              <Select value={form.watch("category")} onValueChange={(v) => form.setValue("category", v as DocumentMetaInput["category"])}>
                <SelectTrigger id="doc-category" aria-label="Category"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DOCUMENT_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>{CATEGORY_LABELS[c]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="doc-access">Access level</Label>
              <Select value={form.watch("accessLevel")} onValueChange={(v) => form.setValue("accessLevel", v as DocumentMetaInput["accessLevel"])}>
                <SelectTrigger id="doc-access" aria-label="Access level"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {allowedLevels.map((l) => (
                    <SelectItem key={l} value={l}>{ACCESS_LEVEL_META[l].label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="doc-folder">Folder</Label>
              <Select value={toSelectValue(form.watch("folderId"))} onValueChange={(v) => form.setValue("folderId", v === ALL ? "" : v)}>
                <SelectTrigger id="doc-folder" aria-label="Folder"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>No folder</SelectItem>
                  {folders.map((f) => (
                    <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="doc-tags">Tags <span className="text-ink-muted">(comma separated)</span></Label>
            <Input
              id="doc-tags"
              placeholder="e.g. safeguarding, 2026"
              defaultValue={(form.watch("tags") ?? []).join(", ")}
              onChange={(e) =>
                form.setValue("tags", e.target.value.split(",").map((t) => t.trim()).filter(Boolean))
              }
            />
            {tagOptions?.length ? (
              <div className="flex flex-wrap gap-1" aria-label="Existing tags">
                {tagOptions.slice(0, 8).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-ink-secondary hover:bg-accent"
                    onClick={() => {
                      const current = form.getValues("tags") ?? [];
                      if (!current.includes(t.name)) form.setValue("tags", [...current, t.name]);
                    }}
                  >
                    +{t.name}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="doc-expires">Expires on <span className="text-ink-muted">(optional)</span></Label>
              <Input id="doc-expires" type="date" {...form.register("expiresAt")} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="doc-review">Review on <span className="text-ink-muted">(optional)</span></Label>
              <Input id="doc-review" type="date" {...form.register("reviewAt")} />
            </div>
          </div>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm text-ink-secondary">
              <Checkbox
                checked={form.watch("downloadRestricted")}
                onCheckedChange={(v) => form.setValue("downloadRestricted", v === true)}
                disabled={!canDo(user, "documents.delete")}
              />
              Restrict downloads
            </label>
            <label className="flex items-center gap-2 text-sm text-ink-secondary">
              <Checkbox checked={form.watch("watermark")} onCheckedChange={(v) => form.setValue("watermark", v === true)} />
              Watermark previews
            </label>
          </div>
          <Button type="submit" disabled={!canCreate || !selectedFiles.length || busyCount > 0}>
            {busyCount > 0 ? (<><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Uploading…</>) : `Upload ${selectedFiles.length || ""} file${selectedFiles.length === 1 ? "" : "s"}`}
          </Button>
          {!canCreate ? (
            <p className="text-xs text-danger" role="alert">You need upload permission — ask an administrator to raise your Documents access to “Create”.</p>
          ) : null}
        </form>

        {/* ── live queue ─────────────────────────────────────────────────── */}
        {queue.items.length ? (
          <div className="space-y-2 rounded-xl border p-3" aria-label="Upload queue">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Upload queue</p>
              <button type="button" className="text-xs text-primary hover:underline" onClick={queue.clearFinished}>
                Clear finished
              </button>
            </div>
            <div aria-live="polite" className="sr-only">{queue.announcement}</div>
            <ScrollArea className="max-h-44">
              <ul className="space-y-2">
                {queue.items.map((item) => (
                  <li key={item.id} className="flex items-center gap-2.5 rounded-lg bg-muted/50 px-2.5 py-2">
                    <span className="shrink-0">
                      {item.status === "done" ? <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />
                        : item.status === "error" ? <AlertCircle className="h-4 w-4 text-danger" aria-hidden />
                        : item.status === "canceled" ? <X className="h-4 w-4 text-ink-muted" aria-hidden />
                        : item.status === "uploading" ? <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden />
                        : <FileIcon className="h-4 w-4 text-ink-muted" aria-hidden />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-ink">{item.file.name}</p>
                      {item.status === "error" ? (
                        <p className="truncate text-xs text-danger">{item.error}</p>
                      ) : (
                        <Progress value={item.progress} className="mt-1 h-1" aria-label={`${item.file.name} ${item.progress}%`} />
                      )}
                    </div>
                    {item.status === "error" ? (
                      <Button type="button" size="sm" variant="ghost" onClick={() => queue.retry(item.id)} aria-label={`Retry ${item.file.name}`}>
                        <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                    ) : null}
                    {item.status === "uploading" || item.status === "queued" ? (
                      <Button type="button" size="sm" variant="ghost" onClick={() => queue.cancel(item.id)} aria-label={`Cancel ${item.file.name}`}>
                        <X className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </ScrollArea>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function toSelectValue(v: string | undefined): string {
  return v || ALL;
}
