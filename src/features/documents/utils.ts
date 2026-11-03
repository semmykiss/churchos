/**
 * Documents (DMS) client utilities — formatting, highlighting, filename ops.
 */
import { fileKindFromMime, type FileKind } from "./constants";

/** Human bytes (1024 base, one decimal under 10 MB). */
export function fmtBytes(bytes?: number | null): string {
  if (bytes == null || Number.isNaN(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/** Sanitize a filename for display/download (server also sanitizes on write). */
export function sanitizeFileName(name: string): string {
  return (
    name
      .normalize("NFKD")
      .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, " ")
      .replace(/\s+/g, " ")
      .replace(/^[.\s]+|[.\s]+$/g, "")
      .slice(0, 180) || "file"
  );
}

export function fileIconKind(mime: string): FileKind {
  return fileKindFromMime(mime);
}

export function isPreviewableImage(mime: string): boolean {
  return mime.startsWith("image/");
}

export function isInlinePreviewable(mime: string): boolean {
  return (
    mime === "application/pdf" ||
    mime.startsWith("image/") ||
    mime.startsWith("text/") ||
    mime === "application/json"
  );
}

/** Split text into matched/unmatched segments for search highlighting. */
export function highlightSegments(text: string, query: string): { text: string; hit: boolean }[] {
  const q = query.trim();
  if (!q) return [{ text, hit: false }];
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${escaped})`, "ig"));
  return parts
    .filter((p) => p !== "")
    .map((part) => ({ text: part, hit: part.toLowerCase() === q.toLowerCase() }));
}

/** Relative time ("3 d ago") — lightweight, no deps. */
export function timeAgo(iso?: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diff = Date.now() - then;
  const abs = Math.abs(diff);
  const future = diff < 0;
  const mins = Math.round(abs / 60_000);
  const fmt = (n: number, unit: string) => (future ? `in ${n} ${unit}` : `${n} ${unit} ago`);
  if (mins < 1) return future ? "soon" : "just now";
  if (mins < 60) return fmt(mins, mins === 1 ? "min" : "mins");
  const hours = Math.round(mins / 60);
  if (hours < 24) return fmt(hours, hours === 1 ? "hour" : "hours");
  const days = Math.round(hours / 24);
  if (days < 31) return fmt(days, days === 1 ? "day" : "days");
  const months = Math.round(days / 30.5);
  if (months < 18) return fmt(months, months === 1 ? "month" : "months");
  return fmt(Math.round(months / 12), "yr(s)");
}

export function daysUntil(iso?: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.ceil((t - Date.now()) / 86_400_000);
}

/** Localised short date ( mirrors lib/types fmtDate for feature-local use). */
export function fmtDate(d?: string | Date | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** Localised date + time. */
export function fmtDateTime(d?: string | Date | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Extension without dot, lowercased. */
export function extOf(fileName: string): string {
  const idx = fileName.lastIndexOf(".");
  return idx > 0 ? fileName.slice(idx + 1).toLowerCase() : "";
}

/** Well-known magic numbers used for server-side sniffing (see validate.ts). */
export const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  txt: "text/plain",
  csv: "text/csv",
  md: "text/plain",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};
