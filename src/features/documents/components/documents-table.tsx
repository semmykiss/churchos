"use client";

/**
 * Table view — sortable columns (title, category, access, updated, size,
 * version, owner), row selection, keyboard navigation with arrow keys.
 */
import { memo, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { SORT_FIELD_LABELS, ACCESS_LEVEL_META, fileKindFromMime, type DocumentSortField } from "../constants";
import { fmtBytes, timeAgo, highlightSegments, daysUntil } from "../utils";
import type { DocumentDTO } from "../types";
import { ArrowDown, ArrowUp, Star, Lock, Eye } from "lucide-react";

const ACCESS_TINT: Record<string, string> = {
  public: "bg-success/10 text-success",
  members: "bg-info/10 text-info",
  staff: "bg-violet/10 text-violet",
  leaders: "bg-violet/15 text-violet",
  finance: "bg-warning/10 text-warning",
  pastoral: "bg-danger/10 text-danger",
};

function HighlightSpan({ text, query }: { text: string; query: string }) {
  const segments = highlightSegments(text, query);
  return (
    <>
      {segments.map((seg, i) =>
        seg.hit ? (
          <mark key={i} className="rounded-sm bg-warning/30 px-0.5 text-ink">{seg.text}</mark>
        ) : (
          <span key={i}>{seg.text}</span>
        )
      )}
    </>
  );
}

interface DocumentsTableProps {
  items: DocumentDTO[];
  query: string;
  sort: DocumentSortField;
  dir: "asc" | "desc";
  onSort: (field: DocumentSortField) => void;
  selectedIds: Set<string>;
  onSelect: (id: string, checked: boolean) => void;
  onSelectAll: (checked: boolean) => void;
  onOpen: (doc: DocumentDTO) => void;
  onToggleFavorite: (doc: DocumentDTO) => void;
}

const COLUMNS: { field: DocumentSortField | null; label: string; className?: string }[] = [
  { field: "title", label: "Title" },
  { field: "category", label: "Category", className: "hidden md:table-cell" },
  { field: "accessLevel", label: "Access", className: "hidden lg:table-cell" },
  { field: "byteSize", label: "Size", className: "hidden sm:table-cell" },
  { field: "currentVersion", label: "Ver.", className: "hidden sm:table-cell" },
  { field: "ownerName", label: "Owner", className: "hidden xl:table-cell" },
  { field: "updatedAt", label: "Updated" },
  { field: null, label: "", className: "w-12" },
];

function DocumentsTableInner({ items, query, sort, dir, onSort, selectedIds, onSelect, onSelectAll, onOpen, onToggleFavorite }: DocumentsTableProps) {
  const tableRef = useRef<HTMLDivElement>(null);
  const allSelected = items.length > 0 && items.every((d) => selectedIds.has(d.id));

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const rows = Array.from(tableRef.current?.querySelectorAll<HTMLElement>("tr[data-doc-row]") ?? []);
    const idx = rows.indexOf(document.activeElement as HTMLElement);
    if (idx === -1 && rows.length) {
      rows[0].focus();
      e.preventDefault();
      return;
    }
    const next = e.key === "ArrowDown" ? rows[idx + 1] : rows[idx - 1];
    if (next) {
      next.focus();
      e.preventDefault();
    }
  };

  return (
    <div ref={tableRef} onKeyDown={onKeyDown} className="overflow-hidden rounded-xl border bg-surface">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50 hover:bg-muted/50">
            <TableHead className="w-10">
              <Checkbox
                checked={allSelected ? true : selectedIds.size ? "indeterminate" : false}
                onCheckedChange={(v) => onSelectAll(v === true)}
                aria-label="Select all documents on this page"
              />
            </TableHead>
            {COLUMNS.map((col) => (
              <TableHead key={col.label || "actions"} className={col.className} aria-sort={col.field && sort === col.field ? (dir === "asc" ? "ascending" : "descending") : undefined}>
                {col.field ? (
                  <button
                    type="button"
                    onClick={() => onSort(col.field!)}
                    className={cn("inline-flex items-center gap-1 rounded px-1 py-0.5 text-xs font-semibold text-ink-secondary hover:text-ink focus-visible:outline-2 focus-visible:outline-primary", sort === col.field && "text-ink")}
                  >
                    {SORT_FIELD_LABELS[col.field]}
                    {sort === col.field ? (dir === "asc" ? <ArrowUp className="h-3 w-3" aria-hidden /> : <ArrowDown className="h-3 w-3" aria-hidden />) : null}
                  </button>
                ) : (
                  col.label
                )}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((doc) => {
            const accessMeta = ACCESS_LEVEL_META[doc.accessLevel as keyof typeof ACCESS_LEVEL_META];
            const expiryDays = daysUntil(doc.expiresAt);
            const expiring = expiryDays != null && expiryDays <= 30 && expiryDays >= 0;
            return (
              <TableRow
                key={doc.id}
                data-doc-row
                tabIndex={0}
                className={cn("cursor-pointer", selectedIds.has(doc.id) && "bg-primary/5")}
                onClick={() => onOpen(doc)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onOpen(doc);
                  }
                }}
                aria-label={`Open document ${doc.title}`}
              >
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    checked={selectedIds.has(doc.id)}
                    onCheckedChange={(v) => onSelect(doc.id, v === true)}
                    aria-label={`Select ${doc.title}`}
                  />
                </TableCell>
                <TableCell className="max-w-[280px]">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleFavorite(doc);
                      }}
                      aria-label={doc.favorite ? `Remove ${doc.title} from favorites` : `Add ${doc.title} to favorites`}
                      className={cn("shrink-0 rounded p-0.5 hover:bg-accent", doc.favorite ? "text-warning" : "text-ink-muted/40 hover:text-warning")}
                    >
                      <Star className={cn("h-3.5 w-3.5", doc.favorite && "fill-current")} aria-hidden />
                    </button>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">
                        <HighlightSpan text={doc.title} query={query} />
                      </p>
                      <p className="truncate text-xs text-ink-muted">{doc.fileName}</p>
                    </div>
                    {doc.lockedByName ? <Lock className="h-3 w-3 shrink-0 text-ink-muted" aria-label="Checked out" /> : null}
                    {expiring ? <Badge variant="outline" className="hidden border-transparent bg-warning-bg text-warning xl:inline-flex">expiring</Badge> : null}
                  </div>
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <Badge variant="outline" className="border-transparent bg-primary/10 text-primary">{doc.category}</Badge>
                </TableCell>
                <TableCell className="hidden lg:table-cell">
                  {accessMeta ? (
                    <Badge variant="outline" className={cn("border-transparent gap-1", ACCESS_TINT[doc.accessLevel])}>
                      <Lock className="h-3 w-3" aria-hidden />
                      {accessMeta.label}
                    </Badge>
                  ) : (
                    <span className="text-xs text-ink-muted">{doc.accessLevel}</span>
                  )}
                </TableCell>
                <TableCell className="hidden whitespace-nowrap sm:table-cell text-xs tabular-nums text-ink-secondary">{fmtBytes(doc.byteSize)}</TableCell>
                <TableCell className="hidden sm:table-cell text-xs tabular-nums text-ink-secondary">v{doc.currentVersion}</TableCell>
                <TableCell className="hidden max-w-[140px] truncate text-xs text-ink-secondary xl:table-cell">{doc.ownerName ?? "—"}</TableCell>
                <TableCell className="whitespace-nowrap text-xs text-ink-secondary">
                  <span className="inline-flex items-center gap-1.5">
                    <Eye className="h-3 w-3 opacity-60" aria-hidden />
                    {timeAgo(doc.updatedAt)}
                  </span>
                </TableCell>
                <TableCell />
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <div className="sr-only" aria-live="polite">
        {items.length} documents loaded. Use up and down arrow keys to navigate rows, Enter to open.
      </div>
    </div>
  );
}

export const DocumentsTable = memo(DocumentsTableInner);
