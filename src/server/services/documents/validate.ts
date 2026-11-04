/**
 * Upload validation pipeline (backend only) — NEVER trust the client:
 *   1. filename sanitization (no traversal/control chars, length cap)
 *   2. extension + declared MIME must be in the tenant allowlist
 *   3. size caps (member cap / staff cap, per-tenant settings)
 *   4. magic-byte sniffing — declared type must match the real bytes
 *   5. SHA-256 checksum for duplicate detection
 *   6. malware heuristics — EICAR test string & executable magic → "infected"
 *      (the hook where ClamAV / a scanner API plugs in later)
 */
import { createHash } from "crypto";
import { sanitizeFileName, extOf, MIME_BY_EXT } from "@/features/documents/utils";

const CONTROL_CHARS = /[\u0000-\u001f<>:"/\\|?*]/g;

export function cleanFileName(name: string): string {
  const base = name.normalize("NFKD").replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").replace(/^[.\s]+|[.\s]+$/g, "");
  return base.slice(0, 180) || "file";
}

export function sha256Hex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

// ── magic byte sniffing ─────────────────────────────────────────────────────

function startsWith(buf: Buffer, bytes: number[], offset = 0): boolean {
  if (buf.length < offset + bytes.length) return false;
  return bytes.every((b, i) => buf[offset + i] === b);
}

const PNG = [0x89, 0x50, 0x4e, 0x47];
const JPEG = [0xff, 0xd8, 0xff];
const GIF = [0x47, 0x49, 0x46];
const RIFF = [0x52, 0x49, 0x46, 0x46];
const WEBP = [0x57, 0x45, 0x42, 0x50];
const PDF = [0x25, 0x50, 0x44, 0x46]; // %PDF
const ZIP = [0x50, 0x4b, 0x03, 0x04]; // PK.. (OOXML containers)
const EXE_MZ = [0x4d, 0x5a];
const ELF = [0x7f, 0x45, 0x4c, 0x46];

export type SniffResult =
  | { verdict: "ok"; effectiveMime: string }
  | { verdict: "infected"; reason: string }
  | { verdict: "mismatch"; reason: string };

/**
 * Compare declared MIME with actual bytes. Executables / EICAR payloads are
 * "infected" (quarantine pipeline); known-but-different types are "mismatch"
 * (validation error); text/CSV and OOXML-with-zip-magic are "ok".
 */
export function sniff(buffer: Buffer, declaredMime: string, fileName: string): SniffResult {
  const head = buffer.subarray(0, 4096);

  // 6) malware heuristics — executable containers are never documents
  const eicar = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR";
  if (head.includes(eicar) || head.includes("EICAR-STANDARD-ANTIVIRUS-TEST-FILE")) {
    return { verdict: "infected", reason: "Antivirus test signature detected — file quarantined." };
  }
  if (startsWith(head, EXE_MZ) || startsWith(head, ELF)) {
    return { verdict: "infected", reason: "Executable content detected — file quarantined." };
  }
  // shebang scripts uploaded as "documents"
  if (head[0] === 0x23 && head[1] === 0x21 && !declaredMime.startsWith("text/")) {
    return { verdict: "mismatch", reason: "Script content does not match the declared file type." };
  }

  const ext = extOf(fileName);
  const looksZip = startsWith(head, ZIP);
  const looksImage =
    startsWith(head, PNG) || startsWith(head, JPEG) || startsWith(head, GIF) ||
    (startsWith(head, RIFF) && startsWith(head, WEBP, 8));

  if (declaredMime.startsWith("image/")) {
    const effective =
      startsWith(head, PNG) ? "image/png" :
      startsWith(head, JPEG) ? "image/jpeg" :
      startsWith(head, GIF) ? "image/gif" :
      (startsWith(head, RIFF) && startsWith(head, WEBP, 8)) ? "image/webp" : null;
    if (!effective) return { verdict: "mismatch", reason: "Image content does not match the declared file type." };
    if (effective !== declaredMime) return { verdict: "mismatch", reason: "Image type does not match the file extension." };
    return { verdict: "ok", effectiveMime: declaredMime };
  }

  if (declaredMime === "application/pdf") {
    if (!startsWith(head, PDF)) return { verdict: "mismatch", reason: "Not a valid PDF file." };
    return { verdict: "ok", effectiveMime: declaredMime };
  }

  const officeExts = new Set(["doc", "docx", "xls", "xlsx", "ppt", "pptx"]);
  if (officeExts.has(ext)) {
    if (!looksZip && !MIME_BY_EXT[ext]?.includes("msword") && !MIME_BY_EXT[ext]?.includes("ms-excel") && !MIME_BY_EXT[ext]?.includes("ms-powerpoint")) {
      return { verdict: "mismatch", reason: "Office document is corrupt or mislabeled." };
    }
    if (MIME_BY_EXT[ext]?.includes("openxml") && !looksZip) {
      return { verdict: "mismatch", reason: "Office document is corrupt or mislabeled." };
    }
    return { verdict: "ok", effectiveMime: MIME_BY_EXT[ext] ?? declaredMime };
  }

  if (declaredMime.startsWith("text/") || declaredMime === "application/json") {
    // reject binary payloads pretending to be text
    let suspicious = 0;
    for (const b of head) if (b === 0) suspicious++;
    if (suspicious > 2) return { verdict: "mismatch", reason: "Binary content does not match the declared text type." };
    return { verdict: "ok", effectiveMime: declaredMime };
  }

  // unknown declared types still pass IF the bytes are consistent (zip magic for zip-like)
  if (looksZip || looksImage || startsWith(head, PDF)) {
    return { verdict: "ok", effectiveMime: declaredMime };
  }
  return { verdict: "mismatch", reason: "File content does not match the declared type." };
}

/** Extension must agree with the declared MIME (client sends both). */
export function extMimeConsistent(fileName: string, declaredMime: string): boolean {
  const ext = extOf(fileName);
  const canonical = MIME_BY_EXT[ext];
  if (!canonical) return true; // unknown extension — allowlist check governs
  if (canonical === declaredMime) return true;
  // excel also accepts csv
  if (declaredMime === "text/csv" && ext === "csv") return true;
  return false;
}
