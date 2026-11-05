import { db } from "@/server/db";
import { audit, j } from "@/server/audit";
import { badRequest, forbidden, notFound } from "@/server/http";
import { encryptField, decryptField, maskSensitive } from "@/server/services/tenant/crypto";
import type { SessionUser } from "@/server/permissions";

/**
 * Integrations service — email server (SMTP) & SMS API configuration.
 * Business rules honored:
 *  • configs live on organization.settings JSON (no migration needed);
 *    secrets (SMTP password, SMS API key) are AES-256-GCM encrypted at rest
 *    via the tenant crypto envelope ("enc.v1")
 *  • writes are owner-only (same rule as org settings) and audited with
 *    secrets NEVER logged — only the masked shape is audited
 *  • reads return masked secrets ("••••1234") so the UI can show that a
 *    credential exists without ever round-tripping it to the browser
 *  • test endpoints do a REAL network round-trip (SMTP verify / provider
 *    send) and surface the provider error verbatim for honest diagnostics
 *  • when an integration is disabled or not configured, comms falls back to
 *    the existing local delivery simulation — nothing breaks
 */

// ── shapes ───────────────────────────────────────────────────────────────────

export interface EmailIntegrationConfig {
  enabled: boolean;
  provider: "smtp";
  host: string;
  port: number;
  secure: boolean; // true = implicit TLS (465), false = STARTTLS (587/25)
  username: string;
  password: string | null; // stored encrypted
  fromName: string;
  fromEmail: string;
  /** Set after a successful test — informational only. */
  lastVerifiedAt?: string;
  lastVerifyError?: string;
}

export interface SmsIntegrationConfig {
  enabled: boolean;
  provider: "termii" | "twilio" | "custom";
  apiKey: string | null; // stored encrypted (Termii/custom); Twilio password part
  accountSid: string | null; // Twilio only (NOT secret, but stored alongside)
  senderId: string; // "from" name / alphanumeric sender
  endpoint: string; // custom provider URL (ignored for termii/twilio)
  lastVerifiedAt?: string;
  lastVerifyError?: string;
}

const DEFAULT_EMAIL: EmailIntegrationConfig = {
  enabled: false, provider: "smtp", host: "", port: 587, secure: false,
  username: "", password: null, fromName: "", fromEmail: "",
};

const DEFAULT_SMS: SmsIntegrationConfig = {
  enabled: false, provider: "termii", apiKey: null, accountSid: null,
  senderId: "", endpoint: "",
};

function readEmailConfig(orgSettings: string | null): EmailIntegrationConfig {
  const s = j<Record<string, unknown>>(orgSettings, {});
  const raw = s.emailIntegration as Partial<EmailIntegrationConfig> | undefined;
  return raw ? { ...DEFAULT_EMAIL, ...raw } : DEFAULT_EMAIL;
}

function readSmsConfig(orgSettings: string | null): SmsIntegrationConfig {
  const s = j<Record<string, unknown>>(orgSettings, {});
  const raw = s.smsIntegration as Partial<SmsIntegrationConfig> | undefined;
  return raw ? { ...DEFAULT_SMS, ...raw } : DEFAULT_SMS;
}

/** Public shape: secrets masked, never returned to the browser in clear. */
function maskEmail(cfg: EmailIntegrationConfig) {
  return {
    enabled: cfg.enabled, provider: cfg.provider,
    host: cfg.host, port: cfg.port, secure: cfg.secure,
    username: cfg.username,
    hasPassword: !!cfg.password,
    passwordMask: maskSensitive(decryptField(cfg.password), 2),
    fromName: cfg.fromName, fromEmail: cfg.fromEmail,
    configured: !!(cfg.host && cfg.username && cfg.password && cfg.fromEmail),
    lastVerifiedAt: cfg.lastVerifiedAt ?? null,
    lastVerifyError: cfg.lastVerifyError ?? null,
  };
}

function maskSms(cfg: SmsIntegrationConfig) {
  return {
    enabled: cfg.enabled, provider: cfg.provider,
    hasApiKey: !!cfg.apiKey,
    apiKeyMask: maskSensitive(decryptField(cfg.apiKey), 4),
    accountSid: cfg.accountSid ?? "",
    senderId: cfg.senderId,
    endpoint: cfg.endpoint,
    configured: cfg.provider === "twilio"
      ? !!(cfg.accountSid && cfg.apiKey && cfg.senderId)
      : !!(cfg.apiKey && cfg.senderId && (cfg.provider !== "custom" || cfg.endpoint)),
    lastVerifiedAt: cfg.lastVerifiedAt ?? null,
    lastVerifyError: cfg.lastVerifyError ?? null,
  };
}

async function ownerGuard(user: SessionUser) {
  if (!user.roleKeys.includes("owner")) {
    throw forbidden("Only owners can change integration settings.");
  }
}

async function saveOrgSettings(user: SessionUser, patch: Record<string, unknown>) {
  const org = await db.organization.findUnique({ where: { id: user.orgId } });
  if (!org) throw notFound("Organization not found.");
  const merged = { ...j<Record<string, unknown>>(org.settings, {}), ...patch };
  await db.organization.update({ where: { id: org.id }, data: { settings: JSON.stringify(merged) } });
  return org;
}

// ── read / update ────────────────────────────────────────────────────────────

export async function getIntegrations(user: SessionUser) {
  const org = await db.organization.findUnique({ where: { id: user.orgId } });
  if (!org) throw notFound("Organization not found.");
  return {
    email: maskEmail(readEmailConfig(org.settings)),
    sms: maskSms(readSmsConfig(org.settings)),
    org: { name: org.name, timezone: org.timezone },
  };
}

const EMAIL_FIELDS = ["enabled", "host", "port", "secure", "username", "fromName", "fromEmail"] as const;

export async function updateEmailIntegration(
  user: SessionUser, input: any, meta: { ip?: string; userAgent?: string },
) {
  await ownerGuard(user);
  const org = await db.organization.findUnique({ where: { id: user.orgId } });
  if (!org) throw notFound("Organization not found.");
  const cfg = readEmailConfig(org.settings);

  for (const k of EMAIL_FIELDS) {
    if (input?.[k] !== undefined) (cfg as any)[k] = input[k];
  }
  if (input?.port !== undefined) {
    const port = Math.round(Number(input.port));
    if (!Number.isFinite(port) || port < 1 || port > 65535) throw badRequest("Port must be between 1 and 65535.");
    cfg.port = port;
  }
  if (input?.secure !== undefined) cfg.secure = input.secure === true || input.secure === "true";
  if (input?.enabled !== undefined) cfg.enabled = input.enabled === true || input.enabled === "true";
  if (input?.host !== undefined) cfg.host = String(input.host).trim();
  if (input?.username !== undefined) cfg.username = String(input.username).trim();
  if (input?.fromName !== undefined) cfg.fromName = String(input.fromName).trim();
  if (input?.fromEmail !== undefined) {
    const email = String(input.fromEmail).trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest("From email is not a valid address.");
    cfg.fromEmail = email;
  }
  // password: empty string → clear; absent → keep; value → encrypt
  if (input?.password !== undefined) {
    const pw = String(input.password);
    cfg.password = pw === "" ? null : (encryptField(pw) as string);
  }
  if (cfg.enabled && (!cfg.host || !cfg.username || !cfg.password || !cfg.fromEmail)) {
    throw badRequest("Enable requires host, username, password and from email to be set.");
  }

  await saveOrgSettings(user, { emailIntegration: cfg });
  await audit({
    orgId: user.orgId, actor: user, action: "integration.email.update", entityType: "organization", entityId: user.orgId,
    after: { enabled: cfg.enabled, host: cfg.host, port: cfg.port, secure: cfg.secure, username: cfg.username, fromEmail: cfg.fromEmail },
    ip: meta.ip, userAgent: meta.userAgent,
  });
  return { ok: true, email: maskEmail(cfg) };
}

const SMS_FIELDS = ["provider", "accountSid", "senderId", "endpoint"] as const;

export async function updateSmsIntegration(
  user: SessionUser, input: any, meta: { ip?: string; userAgent?: string },
) {
  await ownerGuard(user);
  const org = await db.organization.findUnique({ where: { id: user.orgId } });
  if (!org) throw notFound("Organization not found.");
  const cfg = readSmsConfig(org.settings);

  for (const k of SMS_FIELDS) {
    if (input?.[k] !== undefined) (cfg as any)[k] = String(input[k]).trim();
  }
  if (input?.provider !== undefined && !["termii", "twilio", "custom"].includes(cfg.provider)) {
    throw badRequest('Provider must be "termii", "twilio" or "custom".');
  }
  if (input?.enabled !== undefined) cfg.enabled = input.enabled === true || input.enabled === "true";
  if (input?.apiKey !== undefined) {
    const key = String(input.apiKey);
    cfg.apiKey = key === "" ? null : (encryptField(key) as string);
  }
  if (cfg.enabled) {
    if (!cfg.apiKey) throw badRequest("Enable requires an API key.");
    if (!cfg.senderId) throw badRequest("Enable requires a sender ID.");
    if (cfg.provider === "twilio" && !cfg.accountSid) throw badRequest("Twilio requires an Account SID.");
    if (cfg.provider === "custom" && !/^https?:\/\//.test(cfg.endpoint)) {
      throw badRequest("Custom provider requires an https endpoint URL.");
    }
  }

  await saveOrgSettings(user, { smsIntegration: cfg });
  await audit({
    orgId: user.orgId, actor: user, action: "integration.sms.update", entityType: "organization", entityId: user.orgId,
    after: { enabled: cfg.enabled, provider: cfg.provider, senderId: cfg.senderId, hasApiKey: !!cfg.apiKey },
    ip: meta.ip, userAgent: meta.userAgent,
  });
  return { ok: true, sms: maskSms(cfg) };
}

// ── real delivery helpers (used by comms + tests) ────────────────────────────

/** Nodemailer transport for this org, or null when email is not active. */
async function emailTransport(orgId: string) {
  const org = await db.organization.findUnique({ where: { id: orgId } });
  if (!org) return null;
  const cfg = readEmailConfig(org.settings);
  if (!cfg.enabled || !cfg.host || !cfg.username || !cfg.password) return null;
  const nodemailer = (await import("nodemailer")).default;
  const transport = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.username, pass: decryptField(cfg.password) ?? "" },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
  return { transport, cfg };
}

/** Active SMS config for this org, or null when SMS is not active. */
async function activeSmsConfig(orgId: string): Promise<SmsIntegrationConfig | null> {
  const org = await db.organization.findUnique({ where: { id: orgId } });
  if (!org) return null;
  const cfg = readSmsConfig(org.settings);
  if (!cfg.enabled || !cfg.apiKey) return null;
  if (cfg.provider === "twilio" && !cfg.accountSid) return null;
  if (cfg.provider === "custom" && !/^https?:\/\//.test(cfg.endpoint)) return null;
  return cfg;
}

/** Is the org's email (SMTP) integration active and fully configured? */
export async function emailActive(orgId: string): Promise<boolean> {
  return (await emailTransport(orgId)) !== null;
}

/** Is the org's SMS API integration active and fully configured? */
export async function smsActive(orgId: string): Promise<boolean> {
  return (await activeSmsConfig(orgId)) !== null;
}

/** Send one email through the configured SMTP server. Returns delivery result. */
export async function deliverEmail(
  orgId: string, to: string, subject: string, bodyText: string, bodyHtml?: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const active = await emailTransport(orgId);
  if (!active) return { ok: false, error: "not_configured" };
  const { transport, cfg } = active;
  try {
    await transport.sendMail({
      from: cfg.fromName ? `"${cfg.fromName}" <${cfg.fromEmail}>` : cfg.fromEmail,
      to, subject, text: bodyText, html: bodyHtml ?? undefined,
    });
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "smtp_error" };
  }
}

/** Send one SMS through the configured provider API. Returns delivery result. */
export async function deliverSms(
  orgId: string, to: string, bodyText: string,
): Promise<{ ok: boolean; error?: string }> {
  const cfg = await activeSmsConfig(orgId);
  if (!cfg) return { ok: false, error: "not_configured" };
  const apiKey = decryptField(cfg.apiKey) ?? "";
  const text = to && bodyText ? bodyText : bodyText;
  try {
    if (cfg.provider === "termii") {
      const res = await fetch("https://api.ng.termii.com/api/sms/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to, from: cfg.senderId, sms: text, type: "plain", channel: "generic", api_key: apiKey,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return { ok: false, error: `termii ${res.status}: ${(await res.text()).slice(0, 200)}` };
      const data = (await res.json()) as { message?: string };
      return data.message === "Successfully Sent" ? { ok: true } : { ok: false, error: data.message ?? "termii_error" };
    }
    if (cfg.provider === "twilio") {
      const form = new URLSearchParams({ To: to, From: cfg.senderId, Body: text });
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(cfg.accountSid!)}/Messages.json`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${cfg.accountSid}:${apiKey}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return { ok: false, error: `twilio ${res.status}: ${(await res.text()).slice(0, 200)}` };
      return { ok: true };
    }
    // custom: POST {to, from, message} with Bearer key — user's own gateway
    const res = await fetch(cfg.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ to, from: cfg.senderId, message: text }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { ok: false, error: `custom ${res.status}: ${(await res.text()).slice(0, 200)}` };
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "sms_error" };
  }
}

// ── test endpoints (real network round-trip) ─────────────────────────────────

export async function testEmailIntegration(
  user: SessionUser, input: { to?: string }, meta: { ip?: string; userAgent?: string },
) {
  await ownerGuard(user);
  const active = await emailTransport(user.orgId);
  if (!active) {
    throw badRequest("SMTP is not enabled or not fully configured. Save the settings first.");
  }
  const { transport, cfg } = active;
  const markError = async (message: string) => {
    const org = await db.organization.findUnique({ where: { id: user.orgId } });
    if (org) {
      const merged = { ...j<Record<string, unknown>>(org.settings, {}), emailIntegration: { ...readEmailConfig(org.settings), lastVerifiedAt: undefined, lastVerifyError: message } };
      await db.organization.update({ where: { id: org.id }, data: { settings: JSON.stringify(merged) } });
    }
  };
  try {
    await transport.verify();
    const to = String(input?.to ?? "").trim() || cfg.username;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw badRequest("Provide a valid destination email address.");
    await transport.sendMail({
      from: cfg.fromName ? `"${cfg.fromName}" <${cfg.fromEmail}>` : cfg.fromEmail,
      to,
      subject: "ChurchOS — SMTP test email",
      text: `Your SMTP integration works. Sent from ${cfg.fromEmail} at ${new Date().toISOString()}.`,
    });
    const org = await db.organization.findUnique({ where: { id: user.orgId } });
    if (org) {
      const merged = { ...j<Record<string, unknown>>(org.settings, {}), emailIntegration: { ...readEmailConfig(org.settings), lastVerifiedAt: new Date().toISOString(), lastVerifyError: null } };
      await db.organization.update({ where: { id: org.id }, data: { settings: JSON.stringify(merged) } });
    }
    await audit({
      orgId: user.orgId, actor: user, action: "integration.email.test", entityType: "organization", entityId: user.orgId,
      after: { ok: true, to }, ip: meta.ip, userAgent: meta.userAgent,
    });
    return { ok: true, sentTo: to, message: "SMTP verified and test email sent." };
  } catch (err: any) {
    const message = String(err?.message ?? "SMTP test failed").slice(0, 300);
    await markError(message);
    await audit({
      orgId: user.orgId, actor: user, action: "integration.email.test", entityType: "organization", entityId: user.orgId,
      after: { ok: false, error: message }, ip: meta.ip, userAgent: meta.userAgent,
    });
    throw badRequest(`SMTP test failed: ${message}`);
  }
}

export async function testSmsIntegration(
  user: SessionUser, input: { to?: string }, meta: { ip?: string; userAgent?: string },
) {
  await ownerGuard(user);
  const cfg = await activeSmsConfig(user.orgId);
  if (!cfg) throw badRequest("SMS is not enabled or not fully configured. Save the settings first.");
  const to = String(input?.to ?? "").trim();
  if (!/^\+?\d{7,15}$/.test(to.replace(/[\s-]/g, ""))) {
    throw badRequest("Provide a valid destination phone number (digits, optional +).");
  }
  const result = await deliverSms(user.orgId, to.replace(/[\s-]/g, ""), `ChurchOS SMS test — your SMS integration works. ${new Date().toISOString()}`);
  const ok = result.ok;
  const org = await db.organization.findUnique({ where: { id: user.orgId } });
  if (org) {
    const merged = {
      ...j<Record<string, unknown>>(org.settings, {}),
      smsIntegration: { ...readSmsConfig(org.settings), lastVerifiedAt: ok ? new Date().toISOString() : undefined, lastVerifyError: ok ? null : result.error },
    };
    await db.organization.update({ where: { id: org.id }, data: { settings: JSON.stringify(merged) } });
  }
  await audit({
    orgId: user.orgId, actor: user, action: "integration.sms.test", entityType: "organization", entityId: user.orgId,
    after: { ok, to }, ip: meta.ip, userAgent: meta.userAgent,
  });
  if (!ok) throw badRequest(`SMS test failed: ${result.error ?? "provider error"}`);
  return { ok: true, sentTo: to, message: `Test SMS sent via ${cfg.provider}.` };
}
