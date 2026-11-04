"use client";

/**
 * ⌘K / Ctrl+K command palette for quick document search — searches the live
 * API (debounced), keyboard navigable, opens the detail sheet on select.
 */
import { useState } from "react";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { useDebouncedValue } from "../hooks/use-debounced-value";
import { useDocuments } from "../hooks/use-documents";
import { CATEGORY_LABELS, STATUS_META } from "../constants";
import { fmtBytes, timeAgo } from "../utils";
import type { DocumentDTO } from "../types";
import { FileText, Search } from "lucide-react";

interface CommandSearchProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenDocument: (doc: DocumentDTO) => void;
}

export function CommandSearch({ open, onOpenChange, onOpenDocument }: CommandSearchProps) {
  const [term, setTerm] = useState("");
  const debounced = useDebouncedValue(term, 250);
  const { data } = useDocuments(
    { q: debounced, category: "", access: "", status: "", kind: "", owner: "", tag: "", folderId: "", from: "", to: "", scope: "", sort: "updatedAt", dir: "desc", page: 1, pageSize: 12 },
    { enabled: open }
  );

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Document search" description="Search the document library">
      <CommandInput
        value={term}
        onValueChange={setTerm}
        placeholder="Search documents by title, description, tag or filename…"
      />
      <CommandList>
        <CommandEmpty>{debounced ? "No documents match that search." : "Type to search the library…"}</CommandEmpty>
        {(data?.items ?? []).length ? (
          <CommandGroup heading="Documents">
            {(data?.items ?? []).map((doc) => (
              <CommandItem
                key={doc.id}
                value={`${doc.title} ${doc.fileName} ${doc.tags.map((t) => t.name).join(" ")} ${doc.category}`}
                onSelect={() => {
                  onOpenDocument(doc);
                  onOpenChange(false);
                }}
                className="gap-2.5"
              >
                <Search className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">{doc.title}</span>
                  <span className="block truncate text-xs text-ink-muted">
                    {doc.fileName} · {fmtBytes(doc.byteSize)} · {timeAgo(doc.updatedAt)}
                  </span>
                </span>
                <Badge variant="outline" className="border-transparent bg-primary/10 text-primary">
                  {CATEGORY_LABELS[doc.category as keyof typeof CATEGORY_LABELS] ?? doc.category}
                </Badge>
                <Badge variant="outline" className="hidden border-transparent bg-muted text-muted-foreground sm:inline-flex">
                  {STATUS_META[doc.status as keyof typeof STATUS_META]?.label ?? doc.status}
                </Badge>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
      </CommandList>
    </CommandDialog>
  );
}

export const CommandSearchIcon = FileText;
