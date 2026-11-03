"use client";

/**
 * Trash view — soft-deleted documents with restore / permanent delete and
 * legal-hold control (admin). Retention-friendly: rows show who deleted and when.
 */
import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { LoadingBlock, EmptyState } from "@/components/app/shared";
import { useDocuments } from "../hooks/use-documents";
import { useDocumentMutations } from "../hooks/use-document-mutations";
import { fmtBytes, timeAgo } from "../utils";
import type { DocumentDTO } from "../types";
import type { DocumentFilters } from "../schemas";
import { RotateCcw, Trash2, ShieldCheck, ShieldOff, Inbox } from "lucide-react";

interface TrashDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: DocumentFilters;
  canPurge: boolean;
  onChanged?: () => void;
}

export function TrashDialog({ open, onOpenChange, filters, canPurge, onChanged }: TrashDialogProps) {
  const [q, setQ] = useState("");
  const mutations = useDocumentMutations();

  const trashFilters: DocumentFilters = { ...filters, q };
  const { data, isLoading } = useDocuments(trashFilters, { trash: true });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl" role="dialog" aria-label="Document Trash">
        <DialogHeader>
          <DialogTitle>Trash</DialogTitle>
          <DialogDescription>
            Trashed documents keep their versions and history. Restore them any time, or delete them forever to free storage.
          </DialogDescription>
        </DialogHeader>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the Trash…" aria-label="Search trash" />
        <div className="max-h-[50vh] overflow-y-auto rounded-xl border" style={{ maxHeight: "24rem" }}>
          {isLoading ? (
            <LoadingBlock />
          ) : (data?.items ?? []).length ? (
            <ul className="divide-y">
              {data!.items.map((doc) => (
                <TrashRow
                  key={doc.id}
                  doc={doc}
                  canPurge={canPurge}
                  onRestore={() => void mutations.restoreDocument(doc).then(() => onChanged?.())}
                  onPurge={() => void mutations.purgeDocument(doc).then(() => onChanged?.())}
                  onLegalHold={(v) => void mutations.setLegalHold(doc.id, v).then(() => onChanged?.())}
                />
              ))}
            </ul>
          ) : (
            <EmptyState icon={Inbox} title="The Trash is empty" description="Deleted documents will appear here for recovery." />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TrashRow({ doc, canPurge, onRestore, onPurge, onLegalHold }: {
  doc: DocumentDTO;
  canPurge: boolean;
  onRestore: () => void;
  onPurge: () => void;
  onLegalHold: (value: boolean) => void;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-ink">{doc.title}</p>
        <p className="text-xs text-ink-muted">
          {doc.fileName} · {fmtBytes(doc.byteSize)} · trashed {timeAgo(doc.deletedAt)}{doc.deletedByName ? ` by ${doc.deletedByName}` : ""}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {doc.legalHold ? (
          <Badge variant="outline" className="border-transparent gap-1 bg-danger-bg text-danger">
            <ShieldCheck className="h-3 w-3" aria-hidden /> legal hold
          </Badge>
        ) : null}
        {canPurge ? (
          <Button
            size="sm" variant="ghost"
            aria-label={doc.legalHold ? "Release legal hold" : "Apply legal hold"}
            title={doc.legalHold ? "Release legal hold" : "Apply legal hold (prevents deletion)"}
            onClick={onLegalHold.bind(null, !doc.legalHold)}
          >
            {doc.legalHold ? <ShieldOff className="h-4 w-4" aria-hidden /> : <ShieldCheck className="h-4 w-4" aria-hidden />}
          </Button>
        ) : null}
        <Button size="sm" variant="outline" onClick={onRestore}>
          <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Restore
        </Button>
        {canPurge ? (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="destructive" disabled={doc.legalHold} title={doc.legalHold ? "Release the legal hold first" : undefined}>
                <Trash2 className="h-3.5 w-3.5" aria-hidden /> Delete forever
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Permanently delete “{doc.title}”?</AlertDialogTitle>
                <AlertDialogDescription>
                  This removes every version, the stored files, share links and comments. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={onPurge}>
                  Delete forever
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : null}
      </div>
    </li>
  );
}
