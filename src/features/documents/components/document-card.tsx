"use client";

/**
 * Grid-view document card — tinted file-type tile, title with search highlight,
 * badges that never rely on color alone (icon + text), quick actions.
 */
import { memo } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { CATEGORY_LABELS, ACCESS_LEVEL_META, STATUS_META, SCAN_META, fileKindFromMime } from "../constants";
import { fmtBytes, timeAgo, highlightSegments, daysUntil } from "../utils";
import type { DocumentDTO } from "../types";
import { FileText, FileImage, FileType2, FileSpreadsheet, Presentation, File, Star, Lock, ShieldAlert } from "lucide-react";

const KIND_ICON: Record<string, React.ElementType> = {
  pdf: FileType2, image: FileImage, word: FileText, excel: FileSpreadsheet, powerpoint: Presentation, text: FileText, other: File,
};
const KIND_TINT: Record<string, string> = {
  pdf: "bg-danger/10 text-danger",
  image: "bg-success/10 text-success",
  word: "bg-info/10 text-info",
  excel: "bg-success/15 text-success",
  powerpoint: "bg-warning/15 text-warning",
  text: "bg-muted text-ink-muted",
  other: "bg-muted text-ink-muted",
};

const STATUS_TONE_CLASS: Record<string, string> = {
  muted: "bg-muted text-muted-foreground",
  info: "bg-info-bg text-info",
  success: "bg-success-bg text-success",
  warning: "bg-warning-bg text-warning",
  danger: "bg-danger-bg text-danger",
};

export function Highlight({ text, query }: { text: string; query: string }) {
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

interface DocumentCardProps {
  doc: DocumentDTO;
  query: string;
  selected: boolean;
  onSelect: (id: string, checked: boolean) => void;
  onOpen: (doc: DocumentDTO) => void;
  onToggleFavorite: (doc: DocumentDTO) => void;
}

function DocumentCardInner({ doc, query, selected, onSelect, onOpen, onToggleFavorite }: DocumentCardProps) {
  const kind = fileKindFromMime(doc.mimeType);
  const KindIcon = KIND_ICON[kind] ?? File;
  const statusMeta = STATUS_META[doc.status as keyof typeof STATUS_META] ?? { label: doc.status, tone: "muted" as const };
  const accessMeta = ACCESS_LEVEL_META[doc.accessLevel as keyof typeof ACCESS_LEVEL_META];
  const scanMeta = SCAN_META[doc.scanStatus as keyof typeof SCAN_META];
  const expiryDays = daysUntil(doc.expiresAt);
  const expiring = expiryDays != null && expiryDays <= 30 && expiryDays >= 0;

  return (
    <Card
      className={cn(
        "group relative cursor-pointer gap-0 py-0 transition-[box-shadow,transform] duration-150 hover:-translate-y-px hover:shadow-md",
        selected && "ring-2 ring-primary/60"
      )}
      onClick={() => onOpen(doc)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(doc);
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={`Open document ${doc.title}`}
    >
      <CardContent className="flex flex-col gap-2.5 p-4">
        <div className="flex items-start justify-between gap-2">
          <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", KIND_TINT[kind])}>
            <KindIcon className="h-5 w-5" aria-hidden />
          </span>
          <div className="flex items-center gap-1.5">
            <Checkbox
              checked={selected}
              onClick={(e) => e.stopPropagation()}
              onCheckedChange={(v) => onSelect(doc.id, v === true)}
              onKeyDown={(e) => e.stopPropagation()}
              aria-label={`Select ${doc.title}`}
              className="opacity-0 transition-opacity group-hover:opacity-100 data-[state=checked]:opacity-100 focus-visible:opacity-100"
            />
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleFavorite(doc);
              }}
              aria-label={doc.favorite ? `Remove ${doc.title} from favorites` : `Add ${doc.title} to favorites`}
              aria-pressed={doc.favorite}
              className={cn(
                "rounded-md p-1 transition-colors hover:bg-accent",
                doc.favorite ? "text-warning" : "text-ink-muted opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              )}
            >
              <Star className={cn("h-4 w-4", doc.favorite && "fill-current")} aria-hidden />
            </button>
          </div>
        </div>

        <div className="min-w-0 space-y-1">
          <p className="truncate font-display text-sm font-semibold text-ink" title={doc.title}>
            <Highlight text={doc.title} query={query} />
          </p>
          <p className="truncate text-xs text-ink-muted" title={doc.fileName}>
            v{doc.currentVersion} · {fmtBytes(doc.byteSize)} · {doc.fileName}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className="border-transparent gap-1 bg-primary/10 text-primary">{CATEGORY_LABELS[doc.category as keyof typeof CATEGORY_LABELS] ?? doc.category}</Badge>
          <Badge variant="outline" className={cn("border-transparent gap-1", STATUS_TONE_CLASS[statusMeta.tone])}>
            <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" aria-hidden />
            {statusMeta.label}
          </Badge>
          {accessMeta ? (
            <Badge variant="outline" className="border-transparent gap-1 bg-violet/10 text-violet">
              <Lock className="h-3 w-3" aria-hidden /> {accessMeta.label}
            </Badge>
          ) : null}
          {doc.scanStatus !== "clean" && scanMeta ? (
            <Badge variant="outline" className={cn("border-transparent gap-1", scanMeta.tone === "danger" ? "bg-danger-bg text-danger" : "bg-muted text-muted-foreground")}>
              <ShieldAlert className="h-3 w-3" aria-hidden /> {scanMeta.label}
            </Badge>
          ) : null}
          {expiring ? (
            <Badge variant="outline" className="border-transparent gap-1 bg-warning-bg text-warning">
              expires {timeAgo(doc.expiresAt)}
            </Badge>
          ) : null}
          {doc.lockedByName ? (
            <Badge variant="outline" className="border-transparent gap-1 bg-muted text-muted-foreground">checked out</Badge>
          ) : null}
          {doc.legalHold ? (
            <Badge variant="outline" className="border-transparent gap-1 bg-danger-bg text-danger">legal hold</Badge>
          ) : null}
        </div>

        <div className="flex items-center justify-between text-xs text-ink-muted">
          <span className="truncate" title={doc.ownerName ?? undefined}>{doc.ownerName ?? "—"}</span>
          <span>{timeAgo(doc.updatedAt)}</span>
        </div>
      </CardContent>
    </Card>
  );
}

export const DocumentCard = memo(DocumentCardInner);
