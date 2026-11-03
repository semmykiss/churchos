"use client";

/**
 * In-app preview drawer — inline for images/PDF/text; friendly fallback for
 * Office docs (download prompt). Content is streamed from the short-lived
 * signed URL (never inlined into app state). Sensitive documents ask for
 * confirmation before opening.
 */
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { openSignedDownload, getSignedUrl } from "../api/documents";
import { fileKindFromMime } from "../constants";
import { fmtBytes, fmtDateTime } from "../utils";
import type { DocumentDTO } from "../types";
import { Download, FileWarning, ExternalLink } from "lucide-react";

interface PreviewDrawerProps {
  doc: DocumentDTO | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PreviewDrawer({ doc, open, onOpenChange }: PreviewDrawerProps) {
  const [confirmed, setConfirmed] = useState(false);
  const [url, setUrl] = useState<string | null>(null);

  const kind = doc ? fileKindFromMime(doc.mimeType) : "other";
  const inline = useMemo(
    () => (doc ? doc.mimeType === "application/pdf" || doc.mimeType.startsWith("image/") || doc.mimeType.startsWith("text/") : false),
    [doc]
  );

  // fetch the short-lived signed URL once the viewer confirms; the module
  // remounts this drawer per document (key=doc.id) so state resets naturally.
  useEffect(() => {
    if (!doc || !inline || !confirmed) return;
    let alive = true;
    getSignedUrl(doc.id)
      .then(({ url: signed }) => {
        if (alive) setUrl(signed);
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : "Could not load preview."));
    return () => {
      alive = false;
    };
  }, [doc, inline, confirmed]);

  if (!doc) return null;
  const sensitive = doc.accessLevel === "finance" || doc.accessLevel === "pastoral";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl lg:max-w-3xl">
        <SheetHeader className="gap-1 border-b px-5 py-4 text-left">
          <SheetTitle className="truncate text-base">{doc.title}</SheetTitle>
          <SheetDescription className="truncate">
            {doc.fileName} · {fmtBytes(doc.byteSize)} · updated {fmtDateTime(doc.updatedAt)}
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col">
          {sensitive && !confirmed ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
              <FileWarning className="h-8 w-8 text-warning" aria-hidden />
              <p className="text-sm font-medium text-ink">This document is marked {doc.accessLevel}.</p>
              <p className="max-w-sm text-xs text-ink-muted">
                Opening is logged to the audit trail with your name, time and IP address. Access is restricted to authorised roles.
              </p>
              <label className="flex items-center gap-2 text-sm text-ink-secondary">
                <Checkbox checked={confirmed} onCheckedChange={(v) => setConfirmed(v === true)} />
                I understand — open this document
              </label>
            </div>
          ) : !inline ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
              <FileWarning className="h-8 w-8 text-ink-muted" aria-hidden />
              <p className="text-sm font-medium text-ink">In-app preview isn&apos;t available for {kind.toUpperCase()} files.</p>
              <p className="max-w-sm text-xs text-ink-muted">
                Office documents (Word, Excel, PowerPoint) download through a short-lived secure link instead.
              </p>
              <Button size="sm" disabled={!doc.canDownload} onClick={() => void openSignedDownload(doc.id).catch((e) => toast.error(e.message))}>
                <Download className="h-4 w-4" aria-hidden /> Download to view
              </Button>
            </div>
          ) : url ? (
            <div className="min-h-0 flex-1 p-4">
              {doc.mimeType.startsWith("image/") ? (
                <img src={url} alt={`Preview of ${doc.title}`} className="mx-auto max-h-full max-w-full rounded-lg object-contain" />
              ) : doc.mimeType === "application/pdf" ? (
                <iframe
                  src={url}
                  title={`Preview of ${doc.title}`}
                  className="h-full min-h-[60vh] w-full rounded-lg border bg-white"
                  sandbox="allow-same-origin allow-downloads"
                />
              ) : (
                <TextPreview url={url} docTitle={doc.title} />
              )}
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center p-6">
              <Skeleton className="h-64 w-full" />
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t px-5 py-3">
          <p className="text-xs text-ink-muted">
            {doc.viewCount} views · {doc.downloadCount} downloads · access logged
          </p>
          <Button
            size="sm" variant="outline"
            disabled={!doc.canDownload}
            onClick={() => void openSignedDownload(doc.id).catch((e) => toast.error(e.message))}
          >
            <ExternalLink className="h-4 w-4" aria-hidden /> Open / download
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** text/csv/txt preview — fetches the signed URL and renders as plain text. */
function TextPreview({ url, docTitle }: { url: string; docTitle: string }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch(url, { credentials: "same-origin" })
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error("Preview fetch failed."))))
      .then((t) => {
        if (alive) setText(t.slice(0, 200_000));
      })
      .catch(() => {
        if (alive) setError(true);
      });
    return () => {
      alive = false;
    };
  }, [url]);
  if (error) return <p className="p-6 text-sm text-danger">Could not load the file content.</p>;
  if (text == null) return <Skeleton className="h-64 w-full" />;
  return (
    <pre className="max-h-full overflow-auto whitespace-pre-wrap rounded-lg border bg-muted/40 p-4 text-xs leading-relaxed text-ink" aria-label={`Text preview of ${docTitle}`}>
      {text}
    </pre>
  );
}
