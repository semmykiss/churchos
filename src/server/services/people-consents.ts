/**
 * People CRM (Phase 6) — person consent history (PersonConsent table).
 *
 * One row per consent EVENT (granted/declined/withdrawn per channel), so the
 * profile shows an auditable trail plus the CURRENT status per channel. The
 * comms module's CommunicationPreference ledger is untouched — it answers
 * "may we message this person right now"; this answers "what was consented,
 * when, and on what evidence".
 *
 * Visibility: consent data rides on the profile visibility rules (self,
 * parents, leaders and staff see it; plain members do not see OTHERS').
 * Recording: canEditPerson (staff via people.edit, or the person's own
 * household scope — a member recording their OWN consent is legitimate
 * self-service and is stamped with their identity).
 */
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { badRequest, forbidden, notFound } from "@/server/http";
import type { SessionUser } from "@/server/permissions";
import { canEditPerson } from "@/server/services/people";
import {
  buildViewerScope,
  profileVisible,
  tierForTarget,
} from "@/server/services/people-serializer";

export const CONSENT_CHANNELS = ["whatsapp", "sms", "email", "call", "photo"] as const;
export type ConsentChannel = (typeof CONSENT_CHANNELS)[number];

export const CONSENT_STATUSES = ["granted", "declined", "withdrawn"] as const;
export type ConsentStatus = (typeof CONSENT_STATUSES)[number];

export const CONSENT_SOURCES = [
  "connection_card", "in_person", "phone_call", "whatsapp", "website", "other",
] as const;
export type ConsentSource = (typeof CONSENT_SOURCES)[number];

const NOTE_MAX = 500;

export interface NormalizedConsent {
  channel: ConsentChannel;
  status: ConsentStatus;
  source: ConsentSource | null;
  note: string | null;
  occurredAt: Date;
}

interface ConsentInputLike {
  channel?: unknown; status?: unknown; source?: unknown; note?: unknown; occurredAt?: unknown;
}

/** Validate + normalize a consent payload (shared by the endpoint and createPerson). */
export function normalizeConsentInputs(raw: unknown, opts: { requireStatus?: boolean } = {}): NormalizedConsent[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw badRequest("consents must be an array.");
  if (raw.length > 10) throw badRequest("At most 10 consent entries per save.");
  return raw.map((entry) => {
    const input = (entry ?? {}) as ConsentInputLike;
    const channel = String(input.channel ?? "").trim();
    if (!(CONSENT_CHANNELS as readonly string[]).includes(channel)) {
      throw badRequest(`Unknown consent channel "${channel}".`);
    }
    const statusRaw = input.status === undefined || input.status === "" ? (opts.requireStatus ? "" : "granted") : String(input.status).trim();
    if (!(CONSENT_STATUSES as readonly string[]).includes(statusRaw)) {
      throw badRequest(`Consent status must be granted, declined or withdrawn.`);
    }
    let source: ConsentSource | null = null;
    if (input.source !== undefined && input.source !== "") {
      const s = String(input.source).trim();
      if (!(CONSENT_SOURCES as readonly string[]).includes(s)) {
        throw badRequest(`Unknown consent source "${s}".`);
      }
      source = s as ConsentSource;
    }
    let note: string | null = null;
    if (input.note !== undefined && input.note !== "") {
      note = String(input.note).trim();
      if (note.length > NOTE_MAX) throw badRequest(`Consent note is limited to ${NOTE_MAX} characters.`);
    }
    let occurredAt = new Date();
    if (input.occurredAt !== undefined && input.occurredAt !== "") {
      const d = new Date(String(input.occurredAt));
      if (Number.isNaN(d.getTime())) throw badRequest("Consent date is invalid.");
      if (d.getTime() > Date.now() + 86_400_000) throw badRequest("Consent date cannot be in the future.");
      occurredAt = d;
    }
    return {
      channel: channel as ConsentChannel,
      status: statusRaw as ConsentStatus,
      source,
      note,
      occurredAt,
    };
  });
}

function requireLivePerson(orgId: string, personId: string) {
  return db.person.findFirst({
    where: { id: personId, orgId, deletedAt: null },
    select: { id: true },
  }).then((p) => {
    if (!p) throw notFound("Person not found.");
    return p;
  });
}

export function serializeConsentRow(r: {
  id: string; channel: string; status: string; source: string | null;
  note: string | null; occurredAt: Date; recordedByName: string | null; createdAt: Date;
}) {
  return {
    id: r.id,
    channel: r.channel,
    status: r.status,
    source: r.source,
    note: r.note,
    occurredAt: r.occurredAt,
    recordedByName: r.recordedByName,
    createdAt: r.createdAt,
  };
}

/** Current status per channel (rows arrive ordered newest-first — first wins). */
export function currentByChannel(rows: { channel: string; status: string; occurredAt: Date; id: string }[]) {
  const current: Record<string, string> = {};
  for (const r of rows) {
    if (!current[r.channel]) current[r.channel] = r.status;
  }
  return current;
}

/** Consent trail + per-channel status — embedded in the profile when visible. */
export async function consentHistoryPayload(orgId: string, personId: string, take = 30) {
  const rows = await db.personConsent.findMany({
    where: { orgId, personId },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    take,
  });
  return {
    current: currentByChannel(rows),
    items: rows.map(serializeConsentRow),
  };
}

/** GET /people/v2/:id/consents — gated on the profile visibility rules. */
export async function listPersonConsents(user: SessionUser, personId: string) {
  const scope = await buildViewerScope(user);
  const person = await requireLivePerson(user.orgId, personId);
  const links = await db.householdMember.findMany({
    where: { personId: person.id, endedAt: null },
    select: { householdId: true },
  });
  const tier = tierForTarget(scope, { id: person.id, householdIds: links.map((l) => l.householdId) });
  if (!profileVisible(tier)) {
    throw forbidden("You don't have permission to view this person's consents.");
  }
  return { tier, ...(await consentHistoryPayload(user.orgId, person.id)) };
}

/** POST /people/v2/:id/consents — canEditPerson (staff, or own household scope). */
export async function recordPersonConsent(
  user: SessionUser,
  personId: string,
  input: ConsentInputLike,
  meta: { ip?: string; userAgent?: string }
) {
  if (!(await canEditPerson(user, personId))) {
    throw forbidden("You can only record consents for people you may edit.");
  }
  await requireLivePerson(user.orgId, personId);
  const [normalized] = normalizeConsentInputs([input], { requireStatus: true });
  if (!normalized) throw badRequest("Consent details are required.");

  const row = await db.personConsent.create({
    data: {
      orgId: user.orgId,
      personId,
      channel: normalized.channel,
      status: normalized.status,
      source: normalized.source,
      note: normalized.note,
      occurredAt: normalized.occurredAt,
      recordedById: user.userId,
      recordedByName: user.name,
    },
  });
  await audit({
    orgId: user.orgId, actor: user, action: "person.consent.record",
    entityType: "person", entityId: personId,
    after: { consentId: row.id, channel: row.channel, status: row.status, source: row.source, occurredAt: row.occurredAt },
    ip: meta.ip, userAgent: meta.userAgent,
  });
  return { consent: serializeConsentRow(row) };
}
