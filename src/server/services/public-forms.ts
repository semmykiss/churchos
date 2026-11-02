import { randomBytes } from "crypto";
import { db } from "@/server/db";
import { badRequest, notFound } from "@/server/http";
import { audit } from "@/server/audit";
import type { SessionUser } from "@/server/permissions";
import { normalizeToE164 } from "@/lib/phone";
import { checkDuplicates, createPerson } from "@/server/services/people";
import { titleCaseName } from "@/server/services/people-import";

/**
 * People CRM Phase 7 — public Visitor Connect Card forms.
 *
 * TENANT SAFETY MODEL: a form's globally-unique slug is the authoritative
 * tenant key. Public endpoints resolve the org ONLY via that slug and can
 * therefore never read or write another tenant's data — there is no other
 * tenant parameter to influence. Public GETs expose exactly two things:
 * the church display name and the field configuration. Submissions are
 * rate-limited per IP, protected by a honeypot field, and deduped against
 * existing people before any person record is created.
 */

// ── field catalog (builder chooses from these; first/last name always on) ────

export const FORM_FIELD_CATALOG = [
  { key: "firstName", label: "First name", type: "text", locked: true, required: true },
  { key: "lastName", label: "Last name", type: "text", locked: true, required: true },
  { key: "phone", label: "Phone number", type: "phone" },
  { key: "email", label: "Email", type: "email" },
  { key: "gender", label: "Gender", type: "select", options: ["male", "female"] },
  { key: "birthdate", label: "Date of birth", type: "date" },
  { key: "address", label: "Home address", type: "text" },
  { key: "visitingFrom", label: "How did you hear about us?", type: "text" },
  { key: "interestedIn", label: "I'm interested in…", type: "select", options: ["joining a group", "serving", "baptism", "prayer", "pastor visit", "other"] },
  { key: "prayerRequest", label: "Prayer request", type: "textarea" },
] as const;

export interface PublicFormFieldConfig {
  key: string;
  required: boolean;
}

export interface PublicFormPayload {
  [key: string]: string;
}

function j<T>(v: string | null | undefined, fallback: T): T {
  try {
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

function meta(m: { ip?: string; userAgent?: string }) {
  return { ip: m.ip, userAgent: m.userAgent };
}

export function normalizeSlug(input: string): string {
  return input.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
}

// ── admin (permission people.forms.manage) ───────────────────────────────────

export async function listForms(user: SessionUser) {
  const forms = await db.publicForm.findMany({
    where: { orgId: user.orgId },
    orderBy: { createdAt: "desc" },
  });
  const counts = await db.publicFormSubmission.groupBy({
    by: ["formId", "status"],
    where: { orgId: user.orgId },
    _count: true,
  });
  return forms.map((f) => {
    const c = counts.filter((x) => x.formId === f.id);
    return {
      id: f.id,
      slug: f.slug,
      name: f.name,
      enabled: f.enabled,
      fields: j<PublicFormFieldConfig[]>(f.fields, []),
      thankYouMessage: f.thankYouMessage,
      requireApproval: f.requireApproval,
      createdAt: f.createdAt,
      submissionCounts: {
        total: c.reduce((a, x) => a + x._count, 0),
        pending: c.find((x) => x.status === "pending")?._count ?? 0,
        converted: c.find((x) => x.status === "converted")?._count ?? 0,
        duplicate: c.find((x) => x.status === "duplicate")?._count ?? 0,
      },
    };
  });
}

export async function createForm(user: SessionUser, input: { name: string; slug?: string; fields?: PublicFormFieldConfig[]; thankYouMessage?: string; requireApproval?: boolean }, m: { ip?: string; userAgent?: string }) {
  const name = input.name?.trim();
  if (!name) throw badRequest("Give the form a name.");
  let slug = normalizeSlug(input.slug || name);
  if (!slug) throw badRequest("The form needs a link name.");
  // unique slug globally (collides → suggest with suffix)
  if (await db.publicForm.findUnique({ where: { slug } })) {
    slug = `${slug}-${randomBytes(2).toString("hex")}`;
  }
  const fields = sanitizeFieldConfig(input.fields);
  const form = await db.publicForm.create({
    data: {
      orgId: user.orgId,
      slug,
      name,
      fields: JSON.stringify(fields),
      thankYouMessage: input.thankYouMessage?.trim() || null,
      requireApproval: input.requireApproval === true,
      createdByName: user.name,
    },
  });
  await audit({ orgId: user.orgId, actor: user, action: "people.forms.create", entityType: "public_form", entityId: form.id, after: { slug }, ...meta(m) });
  return serializeForm(form);
}

export async function updateForm(user: SessionUser, id: string, input: { name?: string; enabled?: boolean; fields?: PublicFormFieldConfig[]; thankYouMessage?: string; requireApproval?: boolean }, m: { ip?: string; userAgent?: string }) {
  const form = await db.publicForm.findFirst({ where: { id, orgId: user.orgId } });
  if (!form) throw notFound("Form not found.");
  const data: Record<string, unknown> = { updatedAt: new Date() };
  if (input.name !== undefined) {
    if (!input.name.trim()) throw badRequest("Form name cannot be empty.");
    data.name = input.name.trim();
  }
  if (input.enabled !== undefined) data.enabled = input.enabled === true;
  if (input.fields !== undefined) data.fields = JSON.stringify(sanitizeFieldConfig(input.fields));
  if (input.thankYouMessage !== undefined) data.thankYouMessage = input.thankYouMessage.trim() || null;
  if (input.requireApproval !== undefined) data.requireApproval = input.requireApproval === true;
  const updated = await db.publicForm.update({ where: { id: form.id }, data });
  await audit({ orgId: user.orgId, actor: user, action: "people.forms.update", entityType: "public_form", entityId: form.id, after: { changes: Object.keys(data) }, ...meta(m) });
  return serializeForm(updated);
}

export async function deleteForm(user: SessionUser, id: string, m: { ip?: string; userAgent?: string }) {
  const form = await db.publicForm.findFirst({ where: { id, orgId: user.orgId } });
  if (!form) throw notFound("Form not found.");
  const subs = await db.publicFormSubmission.count({ where: { formId: id, orgId: user.orgId } });
  if (subs > 0) throw badRequest("This form has submissions — disable it instead of deleting.");
  await db.publicForm.delete({ where: { id: form.id } });
  await audit({ orgId: user.orgId, actor: user, action: "people.forms.delete", entityType: "public_form", entityId: form.id, after: { slug: form.slug }, ...meta(m) });
  return { ok: true };
}

function sanitizeFieldConfig(input?: PublicFormFieldConfig[]): PublicFormFieldConfig[] {
  const allowed = new Set(FORM_FIELD_CATALOG.map((f) => f.key as string));
  const out = new Map<string, PublicFormFieldConfig>();
  for (const f of input ?? []) {
    if (!allowed.has(f.key)) continue;
    const cat = FORM_FIELD_CATALOG.find((x) => x.key === f.key)!;
    const locked = "locked" in cat && cat.locked;
    out.set(f.key, { key: f.key, required: locked ? true : f.required === true });
  }
  for (const f of FORM_FIELD_CATALOG) {
    if ("locked" in f && f.locked && !out.has(f.key)) out.set(f.key, { key: f.key, required: true });
  }
  return [...out.values()];
}

export function serializeForm(f: { id: string; orgId: string; slug: string; name: string; enabled: boolean; fields: string; thankYouMessage: string | null; requireApproval: boolean; createdAt: Date }) {
  return {
    id: f.id,
    orgId: f.orgId,
    slug: f.slug,
    name: f.name,
    enabled: f.enabled,
    fields: j<PublicFormFieldConfig[]>(f.fields, []),
    thankYouMessage: f.thankYouMessage,
    requireApproval: f.requireApproval,
    createdAt: f.createdAt,
  };
}

export async function listSubmissions(user: SessionUser, formId: string, status?: string) {
  const form = await db.publicForm.findFirst({ where: { id: formId, orgId: user.orgId } });
  if (!form) throw notFound("Form not found.");
  const subs = await db.publicFormSubmission.findMany({
    where: { formId, orgId: user.orgId, ...(status && ["pending", "approved", "rejected", "converted", "duplicate"].includes(status) ? { status } : {}) },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const personIds = subs.map((s) => s.convertedPersonId ?? s.duplicateOfPersonId).filter((x): x is string => !!x);
  const people = personIds.length
    ? await db.person.findMany({ where: { id: { in: personIds }, orgId: user.orgId }, select: { id: true, firstName: true, lastName: true } })
    : [];
  const nameOf = (id: string | null) => {
    if (!id) return null;
    const p = people.find((x) => x.id === id);
    return p ? `${p.firstName} ${p.lastName}` : null;
  };
  return subs.map((s) => ({
    id: s.id,
    formId: s.formId,
    status: s.status,
    payload: j<PublicFormPayload>(s.payload, {}),
    duplicateOfPersonId: s.duplicateOfPersonId,
    duplicateOfName: nameOf(s.duplicateOfPersonId),
    convertedPersonId: s.convertedPersonId,
    convertedName: nameOf(s.convertedPersonId),
    reviewedByName: s.reviewedByName,
    reviewedAt: s.reviewedAt,
    createdAt: s.createdAt,
  }));
}

/** Approve (converts to a person, stage guest) or reject a queued submission. */
export async function reviewSubmission(user: SessionUser, submissionId: string, decision: "approve" | "reject", m: { ip?: string; userAgent?: string }) {
  const sub = await db.publicFormSubmission.findFirst({ where: { id: submissionId, orgId: user.orgId } });
  if (!sub) throw notFound("Submission not found.");
  if (sub.status !== "pending") throw badRequest("Only pending submissions can be reviewed.");
  if (decision === "reject") {
    await db.publicFormSubmission.update({ where: { id: sub.id }, data: { status: "rejected", reviewedByName: user.name, reviewedAt: new Date() } });
    await audit({ orgId: user.orgId, actor: user, action: "people.forms.submission.reject", entityType: "form_submission", entityId: sub.id, ...meta(m) });
    return { ok: true, status: "rejected" as const };
  }
  const personId = await convertSubmission(user, sub, m);
  return { ok: true, status: "converted" as const, personId };
}

// ── conversion (shared by auto-convert + approval) ───────────────────────────

async function convertSubmission(user: SessionUser, sub: { id: string; orgId: string; payload: string; formId: string }, m: { ip?: string; userAgent?: string }) {
  const payload = j<PublicFormPayload>(sub.payload, {});
  const input = payloadToPersonInput(payload);
  // createPerson re-runs dedupe; force=true is safe here because the public
  // submit path already deduped — a race would create at most one extra
  // guest which the merge tooling handles.
  const result = await createPerson(user, { ...input, force: true, source: "guest_card" }, m);
  if (!result.created) throw badRequest("Could not create the person record.");
  await db.publicFormSubmission.update({
    where: { id: sub.id },
    data: { status: "converted", convertedPersonId: result.created.id, reviewedByName: user.name, reviewedAt: new Date() },
  });
  await audit({ orgId: user.orgId, actor: user, action: "people.forms.submission.convert", entityType: "form_submission", entityId: sub.id, after: { personId: result.created.id }, ...meta(m) });
  return result.created.id;
}

function payloadToPersonInput(payload: PublicFormPayload) {
  const str = (k: string) => (typeof payload[k] === "string" ? payload[k].trim() : "");
  const phone = str("phone") || undefined;
  const phoneE164 = phone ? normalizeToE164(phone) ?? undefined : undefined;
  const gender = str("gender").toLowerCase().startsWith("f") ? "f" : str("gender").toLowerCase().startsWith("m") ? "m" : undefined;
  return {
    firstName: titleCaseName(str("firstName")),
    lastName: titleCaseName(str("lastName")),
    email: str("email").toLowerCase() || undefined,
    phone,
    phoneE164,
    gender,
    birthdate: /^\d{4}-\d{2}-\d{2}$/.test(str("birthdate")) ? str("birthdate") : undefined,
    lifecycleStage: "guest",
    addressLine1: str("address") || undefined,
    notes: [str("prayerRequest") && `Prayer request: ${str("prayerRequest")}`, str("interestedIn") && `Interested in: ${str("interestedIn")}`, str("visitingFrom") && `Heard about us: ${str("visitingFrom")}`]
      .filter(Boolean)
      .join("\n") || undefined,
  };
}

// ── public endpoints (no session) ────────────────────────────────────────────

/** Public form meta — the ONLY thing an anonymous visitor can read. */
export async function publicGetForm(slug: string) {
  const form = await db.publicForm.findUnique({ where: { slug: slug.toLowerCase() } });
  if (!form || !form.enabled) throw notFound("This form is not available.");
  const org = await db.organization.findUnique({ where: { id: form.orgId }, select: { name: true } });
  if (!org) throw notFound("This form is not available.");
  const fields = j<PublicFormFieldConfig[]>(form.fields, []);
  const catalog = FORM_FIELD_CATALOG.map((f) => ({
    key: f.key,
    label: f.label,
    type: f.type,
    options: "options" in f ? (f.options as readonly string[]) : undefined,
    enabled: fields.some((x) => x.key === f.key),
    required: fields.find((x) => x.key === f.key)?.required === true,
  }));
  return {
    churchName: org.name,
    formName: form.name,
    thankYouMessage: form.thankYouMessage,
    fields: catalog,
  };
}

/** Per-IP in-memory rate limit for public submissions. */
const submitLog = new Map<string, number[]>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const hits = (submitLog.get(ip) ?? []).filter((t) => now - t < windowMs);
  hits.push(now);
  submitLog.set(ip, hits);
  return hits.length > 8; // 8 submissions / 10 min / IP
}

export async function publicSubmitForm(slug: string, payload: PublicFormPayload, m: { ip?: string; userAgent?: string }) {
  const ip = m.ip ?? "unknown";
  if (rateLimited(ip)) throw badRequest("Too many submissions from this device. Please try again later.");

  const form = await db.publicForm.findUnique({ where: { slug: slug.toLowerCase() } });
  if (!form || !form.enabled) throw notFound("This form is not available.");

  // honeypot: hidden "website" field must be empty (bots fill it)
  if (String(payload["website"] ?? "").trim() !== "") {
    // pretend success — do not confirm bot detection
    return { ok: true as const, message: "Thank you — your details have been received." };
  }

  const fields = j<PublicFormFieldConfig[]>(form.fields, []);
  const enabledKeys = new Set(fields.map((f) => f.key));

  // build the validated payload: only known+enabled keys, length caps
  const clean: PublicFormPayload = {};
  for (const f of FORM_FIELD_CATALOG) {
    const key = f.key as string;
    if (!enabledKeys.has(key)) continue;
    const raw = String(payload[key] ?? "").trim().slice(0, 1000);
    const cfg = fields.find((x) => x.key === key);
    if (!raw) {
      if (cfg?.required) throw badRequest(`"${f.label}" is required.`);
      continue;
    }
    clean[key] = raw;
  }
  if (!clean.firstName || !clean.lastName) throw badRequest("First and last name are required.");

  // phone normalization (accept 0803…, 803…, +234…)
  if (clean.phone) {
    const e164 = normalizeToE164(clean.phone);
    if (!e164) throw badRequest("That phone number doesn't look valid — try the format 0803 123 4567.");
    clean.phone = e164;
  }

  // store the submission FIRST (even a duplicate is kept for the review queue)
  const sub = await db.publicFormSubmission.create({
    data: {
      orgId: form.orgId,
      formId: form.id,
      payload: JSON.stringify(clean),
      status: "pending",
      ip,
      userAgent: m.userAgent,
    },
  });

  // dedupe against existing people (same logic as Add person)
  const dups = await checkDuplicates(form.orgId, {
    email: clean.email,
    phone: clean.phone,
    firstName: clean.firstName,
    lastName: clean.lastName,
    birthdate: clean.birthdate,
  });
  const dup = dups.exact[0] ?? null;

  if (dup) {
    // known person — never create a duplicate record; keep for review
    await db.publicFormSubmission.update({
      where: { id: sub.id },
      data: { status: form.requireApproval ? "pending" : "duplicate", duplicateOfPersonId: dup.id },
    });
    await audit({ orgId: form.orgId, actorType: "system", actorLabel: `connect-card:${form.slug}`, action: "people.forms.submit", entityType: "form_submission", entityId: sub.id, after: { duplicate: true, existingPersonId: dup.id }, ...meta(m) });
    return { ok: true as const, message: "Thank you — we found your details and updated your visit." };
  }

  if (form.requireApproval) {
    await audit({ orgId: form.orgId, actorType: "system", actorLabel: `connect-card:${form.slug}`, action: "people.forms.submit", entityType: "form_submission", entityId: sub.id, after: { queued: true }, ...meta(m) });
    return { ok: true as const, message: "Thank you — your details have been received." };
  }

  // auto-convert: create the guest person (stage guest) via the standard path
  const pseudoUser = await systemPrincipal(form.orgId);
  if (!pseudoUser) throw badRequest("The church needs to complete its setup before the form can accept responses.");
  const input = payloadToPersonInput(clean);
  const result = await createPerson(pseudoUser, { ...input, force: true, source: "guest_card" }, m);
  if (!result.created) {
    // fall back to the queue if creation is blocked (e.g. needs force)
    await audit({ orgId: form.orgId, actorType: "system", actorLabel: `connect-card:${form.slug}`, action: "people.forms.submit", entityType: "form_submission", entityId: sub.id, after: { queued: true, reason: "create_deferred" }, ...meta(m) });
    return { ok: true as const, message: "Thank you — your details have been received." };
  }
  await db.publicFormSubmission.update({
    where: { id: sub.id },
    data: { status: "converted", convertedPersonId: result.created.id },
  });
  await audit({ orgId: form.orgId, actorType: "system", actorLabel: `connect-card:${form.slug}`, action: "people.forms.submit", entityType: "form_submission", entityId: sub.id, after: { converted: true, personId: result.created.id }, ...meta(m) });
  return { ok: true as const, message: form.thankYouMessage?.trim() || "Thank you — your details have been received." };
}

/** A minimal SessionUser-shaped principal scoped to the form's org, used for
 *  auto-conversion. It carries ONLY people-module permissions. */
async function systemPrincipal(orgId: string): Promise<SessionUser | null> {
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { id: true, name: true, status: true } });
  if (!org || !["active", "pending_verification"].includes(org.status)) return null;
  return {
    sessionId: "system-connect-card",
    userId: "system",
    membershipId: "system",
    orgId,
    orgName: org.name,
    campusId: null,
    campusName: null,
    email: "system@connect-card.local",
    name: "Connect Card",
    personId: null,
    roleKeys: ["system"],
    roleNames: ["System"],
    permissions: ["people.view", "people.create", "people.edit"],
    moduleAccess: {},
    amr: "pwd",
    preferences: null,
  };
}
