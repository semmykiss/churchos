import { getSessionUser } from "@/server/auth";
import { can } from "@/server/permissions";
import { jsonOk, ApiError } from "@/server/http";
import { addVersionFromUpload, createFromUpload } from "@/server/services/documents";
import type { DocumentMetaInput } from "@/features/documents/schemas";

/**
 * DEDICATED MULTIPART UPLOAD ENDPOINT — /api/v1/documents-upload
 *
 * The main API router parses JSON bodies only; browser uploads need multipart
 * FormData so the client gets real per-file progress (xhr.upload.onprogress).
 * This thin adapter resolves the session cookie itself and enforces the same
 * permission gates as the router (documents.create for new documents,
 * documents.edit for new versions), then delegates to the documents service —
 * which re-validates EVERYTHING (allowlist, size caps, magic bytes, checksum,
 * quota, scan) server-side.
 */
export const dynamic = "force-dynamic";

// Route-level sanity ceiling — the real, role-based caps live in tenant settings.
const HARD_CAP_BYTES = 256 * 1024 * 1024;

function errorResponse(err: unknown): Response {
  if (err instanceof ApiError) {
    return jsonOk({ error: err.code, message: err.message, details: err.details }, { status: err.status });
  }
  console.error("[documents-upload] unhandled error:", err);
  return jsonOk({ error: "internal", message: "Upload failed on the server." }, { status: 500 });
}

export async function POST(req: Request): Promise<Response> {
  try {
    const cookieHeader = req.headers.get("cookie") ?? "";
    const cookies = Object.fromEntries(
      cookieHeader.split(";").map((c) => {
        const idx = c.indexOf("=");
        return [c.slice(0, idx).trim(), c.slice(idx + 1).trim()];
      }).filter(([, v]) => v !== undefined)
    );
    const user = await getSessionUser(cookies["chms_session"]);
    if (!user) return jsonOk({ error: "unauthorized", message: "Sign in required." }, { status: 401 });

    const form = await req.formData();
    const file = form.get("file");
    const metaRaw = form.get("meta");
    if (!(file instanceof File) || typeof metaRaw !== "string") {
      return jsonOk({ error: "bad_request", message: "Expected multipart fields: file, meta." }, { status: 400 });
    }
    let meta: DocumentMetaInput & { documentId?: string; changelog?: string };
    try {
      meta = JSON.parse(metaRaw);
    } catch {
      return jsonOk({ error: "bad_request", message: "meta must be valid JSON." }, { status: 400 });
    }

    if (file.size > HARD_CAP_BYTES) {
      return jsonOk({ error: "bad_request", message: "File exceeds the 256 MB hard cap." }, { status: 413 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const declaredMime = file.type || "application/octet-stream";
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    const auditMeta = { ip, userAgent: req.headers.get("user-agent") };

    if (meta.documentId) {
      // new version of an existing document
      if (!can(user, "documents.edit")) {
        return jsonOk({ error: "forbidden", message: 'Requires "documents.edit" permission.' }, { status: 403 });
      }
      const doc = await addVersionFromUpload(
        user, meta.documentId,
        { buffer, fileName: file.name, mimeType: declaredMime },
        meta.changelog, auditMeta
      );
      return jsonOk(doc);
    }

    if (!can(user, "documents.create")) {
      return jsonOk({ error: "forbidden", message: 'Requires "documents.create" permission.' }, { status: 403 });
    }
    const doc = await createFromUpload(
      user,
      { buffer, fileName: file.name, mimeType: declaredMime },
      meta, auditMeta
    );
    return jsonOk(doc);
  } catch (err) {
    return errorResponse(err);
  }
}
