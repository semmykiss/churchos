/**
 * Shared frontend types — mirrors docs/api-contract.md.
 * FRONTEND ONLY: no server imports.
 */

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
  permissions: string[];
  /** Effective per-module access levels (max across roles). 0=OFF, 4=Full. */
  moduleAccess?: Record<string, number>;
  amr: string;
  /** Raw JSON preferences blob (e.g. {"theme":"midnight"}). Optional/additive. */
  preferences?: string | null;
}

/** Granular module access levels — mirrors the server's ACCESS_LEVELS. */
export const ACCESS_LEVELS = [
  { value: 0, label: "OFF", description: "No access — module hidden" },
  { value: 1, label: "Read only", description: "View existing records" },
  { value: 2, label: "Edit / Modify", description: "Read + change existing records" },
  { value: 3, label: "Create", description: "Read + edit + add new records" },
  { value: 4, label: "Delete (Full)", description: "Everything, including remove/archive" },
] as const;

/** Effective module access level for the signed-in user (0 when absent). */
export function moduleLevel(
  user: Pick<SessionUser, "moduleAccess"> | null | undefined,
  key: string
): number {
  if (!user?.moduleAccess) return 0;
  return user.moduleAccess[key] ?? 0;
}

export interface PersonListItem {
  id: string;
  firstName: string;
  lastName: string;
  preferredName?: string | null;
  email?: string | null;
  phone?: string | null;
  birthdate?: string | null;
  gender?: string | null;
  status: string;
  lifecycleStage: string;
  membershipStatus: string;
  allergies?: string | null;
  photoUrl?: string | null;
  firstVisitAt?: string | null;
  lastActivityAt?: string | null;
  household?: { id: string; name: string; role: string } | null;
  tags?: { id: string; name: string; color: string }[];
}

/** A linked guardian↔dependent relationship (display label). */
export type GuardianRelationshipType = "parent" | "guardian" | "foster" | "other";
export const GUARDIAN_RELATIONSHIP_TYPES: GuardianRelationshipType[] = ["parent", "guardian", "foster", "other"];

/** Reciprocal of `guardians` — shown on a PARENT's profile. */
export interface Dependent {
  personId: string;
  name: string;
  photoUrl?: string | null;
  birthdate?: string | null;
  relationshipType: GuardianRelationshipType;
  isPrimary: boolean;
}

export interface GuardianLink {
  personId: string;
  name: string;
  photoUrl?: string | null;
  phone?: string | null;
  relationshipType: GuardianRelationshipType;
  authorizedPickup: boolean;
  custodyRestricted: boolean;
}

export const HOUSEHOLD_ROLES = ["head", "spouse", "adult", "child", "dependent", "other"] as const;
export const HOUSEHOLD_ROLE_LABELS: Record<string, string> = {
  head: "Head", spouse: "Spouse", adult: "Adult", child: "Child", dependent: "Dependent", other: "Other",
};

export interface Paged<T> {
  total: number;
  page: number;
  pageSize: number;
  items: T[];
}

export interface GroupDTO {
  id: string;
  name: string;
  type: string;
  campusId?: string;
  leaderPersonId?: string | null;
  leaderName?: string | null;
  meetingDay?: string | null;
  meetingTime?: string | null;
  locationText?: string | null;
  capacity?: number | null;
  description?: string | null;
  isOpen?: boolean;
  isConfidential?: boolean;
  status: string;
  memberCount: number;
}

export interface EventDTO {
  id: string;
  name: string;
  kind: string;
  campusId?: string;
  serviceId?: string | null;
  groupId?: string | null;
  startsAt: string;
  endsAt: string;
  roomText?: string | null;
  capacity?: number | null;
  checkinEnabled?: boolean;
  status: string;
  headcount?: number;
}

export interface DonationDTO {
  id: string;
  person?: { id: string; name: string } | null;
  householdName?: string | null;
  amountCents: number;
  currency: string;
  method: string;
  status: string;
  receivedOn: string;
  source?: string;
  feeCents?: number;
  netCents?: number | null;
  checkNumber?: string | null;
  memo?: string | null;
  isAnonymous?: boolean;
  batch?: { id: string; name: string; status: string } | null;
  splits?: { fundId: string; fundName: string; amountCents: number }[];
  reversalOfId?: string | null;
  createdByName?: string | null;
}

export interface FundDTO {
  id: string;
  name: string;
  code: string;
  type: string;
  isTaxDeductible: boolean;
  goalCents?: number | null;
  isActive: boolean;
  receivedCentsYTD?: number;
}

export interface BatchDTO {
  id: string;
  name: string;
  kind: string;
  serviceDate: string;
  status: string;
  totalCents: number;
  donationCount?: number;
  pendingCount?: number;
  depositAccount?: string | null;
  countedByOne?: string | null;
  countedByTwo?: string | null;
  postedByName?: string | null;
  postedAt?: string | null;
}

export interface MessageDTO {
  id: string;
  channel: string;
  subject?: string | null;
  bodyText?: string | null;
  status: string;
  audience?: string | null;
  scheduledAt?: string | null;
  sentAt?: string | null;
  recipientCount?: number;
  deliveredCount?: number;
  bouncedCount?: number;
  failedCount?: number;
  createdByName?: string | null;
  costCents?: number;
}

export interface CareCaseDTO {
  id: string;
  person: { id: string; name: string };
  type: string;
  stage: string;
  ownerName?: string | null;
  urgency: string;
  dueDate?: string | null;
  confidentialityTier: string;
  status: string;
  closeReason?: string | null;
  summary?: string | null;
  openedAt: string;
  isSafeguarding?: boolean;
  noteCount?: number;
}

export interface AssignmentDTO {
  id: string;
  roleName: string;
  person: { id: string; name: string };
  eventId: string;
  eventName?: string;
  startsAt: string;
  status: string;
  callTime?: string | null;
  responseToken?: string;
}

export interface PlanDTO {
  eventId: string;
  startsAt: string;
  eventName?: string;
  positions: { roleId: string; roleName: string; person: { id: string; name: string } | null; status: string; callTime?: string | null }[];
  fillRate: number;
  needsAttention?: boolean;
}

export interface WorkflowRunDTO {
  id: string;
  workflow: { name: string };
  subjectName?: string | null;
  status: string;
  firedReason?: string | null;
  detail?: string | null;
  startedAt: string;
  finishedAt?: string | null;
}

export interface AuditRow {
  id: string;
  createdAt: string;
  actorLabel?: string | null;
  actorType: string;
  action: string;
  entityType: string;
  before?: string | null;
  after?: string | null;
  ip?: string | null;
}

export const LIFECYCLE_STAGES = ["guest", "returning_guest", "attender", "member", "leader", "inactive", "archived"] as const;
export const STAGE_LABELS: Record<string, string> = {
  guest: "Guest", returning_guest: "Returning guest", attender: "Attender",
  member: "Member", leader: "Leader", inactive: "Inactive", archived: "Archived",
};
export const STATUS_LABELS: Record<string, string> = {
  asked: "Asked", accepted: "Accepted", declined: "Declined", confirmed: "Confirmed",
  served: "Served", no_show: "No-show", pending: "Pending", posted: "Posted",
  reversed: "Reversed", open: "Open", closed: "Closed", scheduled: "Scheduled",
  completed: "Completed", cancelled: "Cancelled", draft: "Draft", sent: "Sent",
  delivered: "Delivered", bounced: "Bounced", failed: "Failed", queued: "Queued",
  active: "Active", paused: "Paused", new: "New", in_progress: "In progress",
  waiting: "Waiting", archived: "Archived", deceased: "Deceased",
};

/** Wildcard-aware permission check — client mirror of the server's can(). */
export function canDo(user: Pick<SessionUser, "permissions"> | null, required: string): boolean {
  if (!user) return false;
  for (const p of user.permissions) {
    if (p === "*" || p === required) return true;
    if (p.endsWith(".*") && required.startsWith(p.slice(0, -1))) return true;
  }
  return false;
}

export function fmtMoney(cents?: number | null): string {
  if (cents == null) return "—";
  // Nigerian Naira (₦) — amounts are stored in kobo (minor units, 1 ₦ = 100 kobo).
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const decimals = abs % 100 === 0 ? 0 : 2;
  const body = (abs / 100).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return `${neg ? "-" : ""}₦${body}`;
}
export function fmtDate(d?: string | Date | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
export function fmtDateShort(d?: string | Date | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
export function fmtDateTime(d?: string | Date | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
export function fmtTime(d?: string | Date | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}
export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("");
}
export function ageOf(birthdate?: string | null): number | null {
  if (!birthdate) return null;
  const bd = new Date(birthdate);
  const now = new Date();
  let a = now.getFullYear() - bd.getFullYear();
  const m = now.getMonth() - bd.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < bd.getDate())) a--;
  return a;
}
export function roomForAge(birthdate?: string | null): string {
  const a = ageOf(birthdate);
  if (a == null) return "Adults";
  if (a < 2) return "Nursery";
  if (a < 6) return "Preschool";
  if (a < 12) return "K–5th";
  if (a < 18) return "Students";
  return "Adults";
}

// ── Partner console (SaaS vendor layer) ─────────────────────────────────────

export interface PartnerPrincipal {
  sessionId?: string;
  partnerUserId: string;
  email: string;
  name: string;
}

export interface PartnerLicense {
  id: string;
  orgId: string;
  key: string;
  plan: string;
  seats: number;
  status: string;
  issuedAt: string;
  expiresAt: string;
  notes: string | null;
}

export interface PartnerTenantRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  createdAt: string;
  plan: string;
  licenseStatus: string;
  licenseKey: string | null;
  seats: number;
  seatsUsed: number;
  expiresAt: string | null;
  daysLeft: number | null;
  campuses: number;
  people: number;
}

export interface PartnerTenantDetail {
  id: string;
  name: string;
  slug: string;
  status: string;
  timezone: string;
  currency: string;
  plan: string;
  createdAt: string;
  license: PartnerLicense | null;
  campuses: { id: string; name: string; code: string; isPrimary: boolean }[];
  users: { membershipId: string; email: string; name: string; status: string; roles: string[]; lastLoginAt: string | null }[];
  peopleCount: number;
  audit: { action: string; actorLabel: string | null; actorType: string; createdAt: string }[];
}

export interface PartnerLicenseRow extends PartnerLicense {
  orgName: string;
  orgStatus: string;
  daysLeft: number;
  monthlyPriceCents: number;
}

export interface PartnerOverview {
  tenants: { total: number; active: number; suspended: number };
  licenses: { total: number; active: number; trial: number; pastDue: number; suspended: number };
  mrrCents: number;
  totalPeople: number;
  totalUsers: number;
  expiringSoon: {
    id: string;
    orgId: string;
    orgName: string;
    plan: string;
    status: string;
    expiresAt: string;
    daysLeft: number;
  }[];
}

/* ────────────────────────────── Chat (Communications) ────────────────────────────── */

export interface ChatLastMessage {
  id: string;
  body: string;
  senderName: string;
  createdAt: string;
  mine: boolean;
}

export interface ChatConversationDTO {
  id: string;
  type: "direct" | "group" | "churchwide";
  title: string;
  groupId: string | null;
  memberCount: number;
  unreadCount: number;
  updatedAt: string;
  lastMessage: ChatLastMessage | null;
  otherPersonId: string | null;
  canModerate: boolean;
}

export interface ChatConversationsResp {
  items: ChatConversationDTO[];
  me: { personId: string; name: string };
  churchwideAvailable: boolean;
}

export interface ChatReplyToDTO {
  id: string;
  senderName: string;
  body: string; // empty string = original was deleted
}

export interface ChatMessageDTO {
  id: string;
  conversationId: string;
  senderPersonId: string;
  senderUserId: string | null;
  senderName: string;
  body: string;
  kind: string;
  createdAt: string;
  mine: boolean;
  replyTo: ChatReplyToDTO | null;
}

export interface ChatMessagesResp {
  items: ChatMessageDTO[];
  hasMore: boolean;
}

export interface ChatDirectoryPerson {
  id: string;
  name: string;
  preferredName: string | null;
  email: string | null;
  stage: string;
  hasPortalAccess: boolean;
}

export interface ChatDirectoryGroup {
  id: string;
  name: string;
  type: string;
  myRole: string;
  memberCount: number;
}

/* socket events */
export interface ChatSocketMessage {
  conversationId: string;
  message: ChatMessageDTO;
}

export interface ChatSocketTyping {
  conversationId: string;
  personId: string;
  name: string;
  typing: boolean;
}

export interface ChatSocketDelete {
  conversationId: string;
  messageId: string;
}

export interface ChatSocketRead {
  conversationId: string;
  personId: string;
  name: string;
  at: string;
}

export interface ChatSocketPresence {
  personId: string;
  name: string;
  online: boolean;
}

/* ── notifications (topbar bell) ── */

export interface NotificationDTO {
  id: string;
  module: string;
  type: string;
  title: string;
  body: string | null;
  entityType: string | null;
  entityId: string | null;
  linkModule: string | null;
  readAt: string | null;
  read: boolean;
  createdAt: string;
}

export interface NotificationsResp {
  items: NotificationDTO[];
  unread: number;
}
