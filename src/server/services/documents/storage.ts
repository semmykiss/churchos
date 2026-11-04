/**
 * Documents storage driver (backend only).
 *
 * Abstraction so the DMS never touches the filesystem directly:
 *   • LocalDriver  — db/uploads/documents (dev / single-node; the folder is
 *     git-ignored, same precedent as person photos).
 *   • S3Driver     — S3 / Cloudflare R2 / MinIO-compatible object storage via
 *     AWS Signature V4 (no extra deps). Activated automatically when
 *     S3_BUCKET + S3_ACCESS_KEY_ID + S3_SECRET_ACCESS_KEY are configured —
 *     required for ephemeral serverless hosts (Vercel) where local disk does
 *     not persist between requests.
 *
 * The driver is chosen once at module load. Keys are opaque strings
 * ("documents/{orgId}/{random}.{ext}") — never user-controlled paths.
 */
import { createHmac, createHash } from "crypto";
import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import path from "path";

export interface StorageDriver {
  readonly name: string;
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

// ── local driver ─────────────────────────────────────────────────────────────

const LOCAL_ROOT = path.join(process.cwd(), "db", "uploads", "documents");

const localDriver: StorageDriver = {
  name: "local",
  async put(key, data) {
    const full = path.join(LOCAL_ROOT, key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, data);
  },
  async get(key) {
    return readFile(path.join(LOCAL_ROOT, key));
  },
  async remove(key) {
    await unlink(path.join(LOCAL_ROOT, key)).catch(() => {
      /* already gone */
    });
  },
};

// ── S3 / R2 / MinIO driver (SigV4, zero deps) ───────────────────────────────

const S3_BUCKET = process.env.S3_BUCKET ?? "";
const S3_ACCESS_KEY_ID = process.env.S3_ACCESS_KEY_ID ?? "";
const S3_SECRET_ACCESS_KEY = process.env.S3_SECRET_ACCESS_KEY ?? "";
const S3_REGION = process.env.S3_REGION ?? "auto";
const S3_ENDPOINT = process.env.S3_ENDPOINT ?? ""; // e.g. https://<account>.r2.cloudflarestorage.com (path-style)

const s3Configured = Boolean(S3_BUCKET && S3_ACCESS_KEY_ID && S3_SECRET_ACCESS_KEY);

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

interface S3RequestArgs {
  method: "GET" | "PUT" | "DELETE";
  key: string;
  body?: Buffer;
  contentType?: string;
}

/** Perform a signed S3 object request (path-style when S3_ENDPOINT is set). */
async function s3Request({ method, key, body, contentType }: S3RequestArgs): Promise<Response> {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ""); // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body ?? Buffer.alloc(0));

  const host = S3_ENDPOINT ? new URL(S3_ENDPOINT).host : `${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com`;
  const canonicalUri = S3_ENDPOINT ? `/${S3_BUCKET}/${key}` : `/${key}`;

  const headers: Record<string, string> = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  if (contentType) headers["content-type"] = contentType;

  const sortedHeaderKeys = Object.keys(headers).sort();
  const canonicalHeaders = sortedHeaderKeys.map((h) => `${h}:${headers[h]}\n`).join("");
  const signedHeaders = sortedHeaderKeys.join(";");
  const canonicalRequest = [method, canonicalUri, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");

  const scope = `${dateStamp}/${S3_REGION}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");

  const kDate = hmac(`AWS4${S3_SECRET_ACCESS_KEY}`, dateStamp);
  const kRegion = hmac(kDate, S3_REGION);
  const kService = hmac(kRegion, "s3");
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");

  const authorization = `AWS4-HMAC-SHA256 Credential=${S3_ACCESS_KEY_ID}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const url = S3_ENDPOINT ? `${S3_ENDPOINT.replace(/\/$/, "")}/${S3_BUCKET}/${key}` : `https://${host}/${key}`;
  return fetch(url, {
    method,
    headers: { ...headers, Authorization: authorization },
    body: body ? new Uint8Array(body) : undefined,
  });
}

const s3Driver: StorageDriver = {
  name: "s3",
  async put(key, data, contentType) {
    const res = await s3Request({ method: "PUT", key, body: data, contentType });
    if (!res.ok) throw new Error(`S3 put failed (${res.status}) for key ${key}`);
  },
  async get(key) {
    const res = await s3Request({ method: "GET", key });
    if (!res.ok) throw new Error(`S3 get failed (${res.status}) for key ${key}`);
    return Buffer.from(await res.arrayBuffer());
  },
  async remove(key) {
    const res = await s3Request({ method: "DELETE", key });
    if (!res.ok && res.status !== 404) throw new Error(`S3 delete failed (${res.status}) for key ${key}`);
  },
};

// ── selection ────────────────────────────────────────────────────────────────

function selectDriver(): StorageDriver {
  if (s3Configured) return s3Driver;
  return localDriver;
}

export const storage: StorageDriver = selectDriver();
export const storageIsRemote = s3Configured;

/** Build a storage key: documents/{orgId}/{random16}.{ext} — opaque, no PII. */
export function documentStorageKey(orgId: string, ext: string): string {
  const rand = Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  return `documents/${orgId}/${rand}${ext ? `.${ext}` : ""}`;
}
