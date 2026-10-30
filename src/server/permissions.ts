/**
 * Permission catalogue + policy checks (backend only).
 * Mirrors 04-architecture.md §3.8: authorization is resolved server-side
 * per (user, tenant, module, action) before any data is returned.
 * Hiding a button is not a permission.
 */

export const PERMISSIONS = [
  "people.view", "people.create", "people.edit", "people.archive", "people.merge",
  // SCOPED: unlocks edit ONLY on the user's own profile, their household
  // members and their linked dependents — never grants global people.edit.
  // Enforced server-side per (user, targetPerson) in services/people.ts.
  "people.edit.own_household",
  "people.tags.manage", "people.groups.manage",
  "groups.view", "groups.manage", "groups.attendance",
  "checkin.view", "checkin.manage", "checkin.kiosk",
  "events.view", "events.manage",
  // ── giving: donor-facing self-service vs staff ledger vs accounting ──
  "giving.give",              // member: submit own gifts, manage own methods/recurring
  "giving.view.own",          // member: view own giving history + own statements
  "giving.view.all",          // finance/admin: view everyone's giving records
  "giving.record",            // finance/admin: record gifts on behalf of donors (cash/check)
  "giving.reverse",           // finance/admin: reverse a gift
  "giving.batches.manage",    // finance/admin: create/post batches
  "giving.funds.manage",      // finance/admin: create/edit funds
  "giving.pledges.manage",    // finance/admin: create pledges FOR others
  "giving.statements.manage", // finance/admin: generate/send statements for others
  // CANDIDATE: role holding this sees individual giving ONLY when the church
  // setting pastorCanViewIndividualGiving is true — lets churches keep gift
  // histories private from pastoral staff while still granting oversight.
  "giving.view.pastor",
  "accounting.view",          // finance/admin/pastor: chart of accounts, reports, budgets (read)
  "accounting.manage",        // finance/admin: bills, vendors, reconciliation, journals, budgets
  "comms.view", "comms.send", "comms.sms.send", "comms.email.send",
  "comms.whatsapp.send", // WhatsApp channel — template/broadcast/reply send
  "comms.chat.use", "comms.chat.churchwide",
  "consent.view",
  "schedule.view", "schedule.assign", "schedule.respond",
  "care.view", "care.create", "care.manage",
  "pipeline.view",          // leaders/admins/follow-up volunteers: kanban + journey
  "pipeline.manage",        // admin: configure stages + sequences
  "pipeline.tasks.own",     // assigned volunteer: see/complete own tasks
  "pipeline.tasks.all",     // admin/pastor: see all tasks across volunteers
  "workflows.view", "workflows.manage",
  "reports.view",
  "admin.view", "admin.manage", "audit.view",
  "portal.use",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export interface SessionUser {
  sessionId: string;
  userId: string;
  membershipId: string;
  orgId: string;
  orgName: string;
  campusId: string | null;
  campusName: string | null;
  email: string;
  name: string;
  personId: string | null;
  roleKeys: string[];
  roleNames: string[];
  permissions: string[]; // expanded, wildcard-resolved
  amr: string;
}

/** Resolve wildcard patterns: "*" grants everything; "giving.*" grants "giving.view". */
export function can(user: Pick<SessionUser, "permissions"> | null, required: string): boolean {
  if (!user) return false;
  for (const p of user.permissions) {
    if (p === "*" || p === required) return true;
    if (p.endsWith(".*") && required.startsWith(p.slice(0, -1))) return true;
  }
  return false;
}

export function canAny(user: Pick<SessionUser, "permissions"> | null, required: string[]): boolean {
  return required.some((r) => can(user, r));
}

/**
 * Channel-specific send permissions — SMS and Email are gated independently.
 * The legacy "comms.send" grant still authorizes both channels so existing
 * roles keep working until an admin splits them in the permission matrix.
 */
export const CHANNEL_SEND_PERMISSION: Record<string, string> = {
  sms: "comms.sms.send",
  email: "comms.email.send",
  whatsapp: "comms.whatsapp.send",
};

export function canSendChannel(user: Pick<SessionUser, "permissions"> | null, channel: string): boolean {
  if (!user) return false;
  if (can(user, CHANNEL_SEND_PERMISSION[channel] ?? "__none__")) return true;
  return can(user, "comms.send");
}

/**
 * Role → default permission bundle (used when seeding / rendering the matrix).
 * admin.manage is deliberately NOT in any template except owner (via *): by
 * default only the Owner can create/edit roles and assign them. Grant
 * "Manage roles & access" to another role from the Admin screen if desired.
 */
export const ROLE_TEMPLATES: Record<string, string[]> = {
  owner: ["*"],
  campus_admin: [
    "people.view", "people.create", "people.edit", "people.archive", "people.merge",
    "people.tags.manage", "people.groups.manage",
    "groups.view", "groups.manage", "groups.attendance", "checkin.view", "checkin.manage", "checkin.kiosk",
    "events.view", "events.manage",
    "giving.view.all", "giving.view.own", "giving.record", "giving.reverse", "giving.batches.manage",
    "giving.funds.manage", "giving.pledges.manage", "giving.statements.manage",
    "accounting.view", "accounting.manage",
    "comms.view", "comms.send", "comms.sms.send", "comms.email.send",
    "comms.whatsapp.send", "comms.chat.use", "comms.chat.churchwide", "consent.view",
    "schedule.view", "schedule.assign", "care.view", "care.create", "care.manage",
    "pipeline.view", "pipeline.manage", "pipeline.tasks.all",
    "workflows.view", "reports.view", "admin.view", "portal.use",
  ],
  finance: [
    "people.view", "giving.view.all", "giving.view.own", "giving.give",
    "giving.record", "giving.reverse", "giving.batches.manage",
    "giving.funds.manage", "giving.pledges.manage", "giving.statements.manage",
    "accounting.view", "accounting.manage",
    "reports.view", "audit.view", "portal.use",
  ],
  ministry_leader: [
    // pastor: aggregate financial oversight (accounting.view) but individual
    // gift histories ONLY when the church setting pastorCanViewIndividualGiving
    // is enabled — giving.view.pastor is the candidate permission.
    "people.view", "people.tags.manage", "people.groups.manage", "groups.view", "groups.attendance", "schedule.view", "schedule.respond",
    "care.view", "care.create", "comms.view", "comms.send", "comms.chat.use", "comms.chat.churchwide",
    "pipeline.view", "pipeline.tasks.all",
    "giving.view.own", "giving.give", "giving.view.pastor", "accounting.view",
    "reports.view", "portal.use",
  ],
  volunteer: ["people.view", "giving.view.own", "giving.give", "schedule.view", "schedule.respond", "checkin.view", "checkin.kiosk", "comms.chat.use", "pipeline.view", "pipeline.tasks.own", "portal.use"],
  member: ["people.view", "giving.view.own", "giving.give", "portal.use", "comms.chat.use"],
  // Scoped self-service: parents/guardians may edit ONLY their own profile,
  // their household members and their linked dependents (server-verified).
  parent: ["people.view", "people.edit.own_household", "giving.view.own", "giving.give", "portal.use", "comms.chat.use"],
};

/** Which nav modules each role may open (frontend hints; server still enforces). */
export const MODULE_ACCESS: Record<string, string[]> = {
  dashboard: ["owner", "campus_admin", "finance", "ministry_leader"],
  people: ["owner", "campus_admin", "ministry_leader", "finance", "volunteer", "member", "parent"],
  giving: ["owner", "campus_admin", "finance", "ministry_leader", "volunteer", "member", "parent"],
  accounting: ["owner", "campus_admin", "finance", "ministry_leader"],
  groups: ["owner", "campus_admin", "ministry_leader"],
  checkin: ["owner", "campus_admin", "volunteer"],
  events: ["owner", "campus_admin", "ministry_leader"],
  comms: ["owner", "campus_admin", "ministry_leader", "volunteer", "member"],
  whatsapp: ["owner", "campus_admin", "ministry_leader"],
  volunteers: ["owner", "campus_admin", "volunteer"],
  care: ["owner", "campus_admin", "ministry_leader"],
  pipeline: ["owner", "campus_admin", "ministry_leader", "volunteer"],
  workflows: ["owner", "campus_admin"],
  reports: ["owner", "campus_admin", "finance", "ministry_leader"],
  admin: ["owner", "campus_admin", "finance"],
  portal: ["owner", "campus_admin", "finance", "ministry_leader", "volunteer", "member"],
};
