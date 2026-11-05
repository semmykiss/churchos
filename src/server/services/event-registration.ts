import { randomBytes, randomInt } from "crypto";
import { readFile } from "fs/promises";
import path from "path";
import ExcelJS from "exceljs";
import sharp from "sharp";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { badRequest, notFound } from "@/server/http";
import type { SessionUser } from "@/server/permissions";
import type { Meta } from "./events";

/**
 * Events & Registration service — ticketing, free RSVP, capacity limits,
 * QR check-in and payments for conventions / retreats / special services.
 *
 * Business rules honored:
 *  • tenant isolation: every query filters orgId
 *  • capacity: event.registrationCapacity caps total held seats (confirmed +
 *    pending_payment); ticketType.capacity caps a single class. Overflowing
 *    orders go to a FIFO waitlist and are auto-promoted when seats free up.
 *  • payments: paid ticket orders start as pending_payment and are confirmed
 *    by a staff-recorded payment (cash/transfer) or a demo card charge — the
 *    same seam the Giving module uses, swappable for Stripe without schema
 *    changes (paymentRef holds the provider intent id).
 *  • QR check-in: each order carries a unique qrToken; scanning consumes one
 *    seat per scan up to quantity (family packs), pending_payment tickets are
 *    refused until payment is recorded.
 */

const QR_PREFIX = "chms-event:";
const HELD_STATUSES = ["confirmed", "pending_payment"];
const MAX_SEATS_PER_ORDER = 10;

export type { Meta };

/**
 * Ticket codes are plain 6-digit numbers (100000–999999) so door keepers can
 * type them on a kiosk keypad. The column is globally unique, so we pre-check
 * for collisions and retry; after 10 unlucky tries we fall back to a long
 * internal token rather than failing someone's registration.
 */
async function newQrToken(): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const code = String(randomInt(100000, 1000000));
    const clash = await db.eventRegistration.findUnique({ where: { qrToken: code } });
    if (!clash) return code;
  }
  return `evt_${randomBytes(16).toString("hex")}`;
}

function paymentRefFor(method: string, reference?: string): string {
  if (reference && reference.trim()) return reference.trim();
  return method === "demo_card"
    ? `pi_demo_${randomBytes(10).toString("hex")}`
    : `manual_${randomBytes(6).toString("hex")}`;
}

export function normalizeQrToken(raw: string): string {
  const t = (raw ?? "").trim();
  const stripped = t.toLowerCase().startsWith(QR_PREFIX) ? t.slice(QR_PREFIX.length) : t;
  // forgive spaces like "566 062" typed at the door
  return stripped.replace(/\s+/g, "");
}

async function requireEvent(orgId: string, eventId: string) {
  const event = await db.event.findFirst({ where: { id: eventId, orgId } });
  if (!event) throw notFound("Event not found.");
  return event;
}

async function requireTicketType(orgId: string, eventId: string, ticketTypeId: string) {
  const tt = await db.eventTicketType.findFirst({ where: { id: ticketTypeId, orgId, eventId } });
  if (!tt) throw notFound("Ticket type not found for this event.");
  return tt;
}

/** Total seats currently HELD per status + overall (one groupBy). */
async function heldSeats(orgId: string, eventId: string) {
  const grouped = await db.eventRegistration.groupBy({
    by: ["status"],
    where: { orgId, eventId, status: { in: [...HELD_STATUSES, "waitlist"] } },
    _sum: { quantity: true },
    _count: { _all: true },
  });
  const byStatus = new Map(grouped.map((g) => [g.status, { seats: g._sum.quantity ?? 0, orders: g._count._all }]));
  const held = (byStatus.get("confirmed")?.seats ?? 0) + (byStatus.get("pending_payment")?.seats ?? 0);
  return { byStatus, held };
}

function remainingOf(capacity: number | null | undefined, taken: number): number | null {
  return capacity == null ? null : Math.max(0, capacity - taken);
}

function toTicketTypeDTO(tt: any) {
  return {
    id: tt.id,
    name: tt.name,
    description: tt.description,
    priceCents: tt.priceCents,
    currency: tt.currency,
    capacity: tt.capacity,
    soldCount: tt.soldCount,
    maxPerOrder: tt.maxPerOrder,
    salesEndAt: tt.salesEndAt,
    isActive: tt.isActive,
    sortOrder: tt.sortOrder,
  };
}

function toRegistrationDTO(r: any, opts?: { withToken?: boolean }) {
  const displayName =
    r.person
      ? [r.person.firstName, r.person.lastName].filter(Boolean).join(" ")
      : r.guestName || "Guest";
  return {
    id: r.id,
    eventId: r.eventId,
    ticketTypeId: r.ticketTypeId,
    ticketTypeName: r.ticketType?.name ?? "General admission",
    quantity: r.quantity,
    status: r.status,
    amountDueCents: r.amountDueCents,
    amountPaidCents: r.amountPaidCents,
    paymentMethod: r.paymentMethod,
    paymentRef: r.paymentRef,
    paidAt: r.paidAt,
    personId: r.personId,
    name: displayName,
    isGuest: !r.personId,
    guestEmail: r.guestEmail,
    guestPhone: r.guestPhone,
    qrToken: opts?.withToken ? r.qrToken : undefined,
    checkedInAt: r.checkedInAt,
    checkedInSeats: r.checkedInSeats,
    checkedInBy: r.checkedInBy,
    notes: r.notes,
    createdByName: r.createdByName,
    createdAt: r.createdAt,
  };
}

/* ───────────────────────── staff: settings & overview ───────────────────────── */

export async function getRegistrationOverview(user: SessionUser, eventId: string) {
  const event = await requireEvent(user.orgId, eventId);
  const ticketTypes = await db.eventTicketType.findMany({
    where: { orgId: user.orgId, eventId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  const { held, byStatus } = await heldSeats(user.orgId, eventId);
  const paid = await db.eventRegistration.aggregate({
    where: { orgId: user.orgId, eventId, status: "confirmed" },
    _sum: { amountPaidCents: true },
    _count: { _all: true },
  });
  const checkedIn = await db.eventRegistration.aggregate({
    where: { orgId: user.orgId, eventId, checkedInSeats: { gt: 0 } },
    _sum: { checkedInSeats: true },
  });

  return {
    event: {
      id: event.id,
      name: event.name,
      kind: event.kind,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      status: event.status,
      roomText: event.roomText,
      registrationEnabled: event.registrationEnabled,
      registrationCapacity: event.registrationCapacity,
      registrationDeadline: event.registrationDeadline,
      registrationNote: event.registrationNote,
    },
    ticketTypes: ticketTypes.map(toTicketTypeDTO),
    stats: {
      heldSeats: held,
      remainingSeats: remainingOf(event.registrationCapacity, held),
      confirmedSeats: byStatus.get("confirmed")?.seats ?? 0,
      pendingSeats: byStatus.get("pending_payment")?.seats ?? 0,
      pendingOrders: byStatus.get("pending_payment")?.orders ?? 0,
      waitlistOrders: byStatus.get("waitlist")?.orders ?? 0,
      waitlistSeats: byStatus.get("waitlist")?.seats ?? 0,
      checkedInSeats: checkedIn._sum.checkedInSeats ?? 0,
      paidOrders: paid._count._all,
      revenueCents: paid._sum.amountPaidCents ?? 0,
    },
  };
}

export interface RegistrationSettingsInput {
  registrationEnabled?: boolean;
  registrationCapacity?: number | null;
  registrationDeadline?: string | null;
  registrationNote?: string | null;
}

export async function updateRegistrationSettings(
  user: SessionUser,
  eventId: string,
  input: RegistrationSettingsInput,
  meta?: Meta
) {
  const event = await requireEvent(user.orgId, eventId);
  const data: any = {};
  if (input.registrationEnabled !== undefined) data.registrationEnabled = input.registrationEnabled;
  if (input.registrationCapacity !== undefined) {
    if (input.registrationCapacity !== null && input.registrationCapacity < 1)
      throw badRequest("Registration capacity must be at least 1.");
    data.registrationCapacity = input.registrationCapacity ?? null;
  }
  if (input.registrationDeadline !== undefined) {
    if (input.registrationDeadline) {
      const d = new Date(input.registrationDeadline);
      if (isNaN(d.getTime())) throw badRequest("registrationDeadline must be a valid ISO datetime.");
      data.registrationDeadline = d;
    } else {
      data.registrationDeadline = null;
    }
  }
  if (input.registrationNote !== undefined) data.registrationNote = input.registrationNote?.trim() || null;
  if (Object.keys(data).length === 0) throw badRequest("Nothing to update.");

  const updated = await db.event.update({ where: { id: event.id }, data });
  await audit({
    orgId: user.orgId, actor: user, action: "event.registration.settings",
    entityType: "event", entityId: eventId,
    before: {
      registrationEnabled: event.registrationEnabled,
      registrationCapacity: event.registrationCapacity,
      registrationDeadline: event.registrationDeadline,
    },
    after: {
      registrationEnabled: updated.registrationEnabled,
      registrationCapacity: updated.registrationCapacity,
      registrationDeadline: updated.registrationDeadline,
    },
    ip: meta?.ip, userAgent: meta?.userAgent,
  });
  return { ok: true };
}

/* ───────────────────────────── staff: ticket types ───────────────────────────── */

export interface TicketTypeInput {
  name?: string;
  description?: string | null;
  priceCents?: number;
  capacity?: number | null;
  maxPerOrder?: number;
  salesEndAt?: string | null;
  isActive?: boolean;
  sortOrder?: number;
}

export async function createTicketType(user: SessionUser, eventId: string, input: TicketTypeInput, meta?: Meta) {
  await requireEvent(user.orgId, eventId);
  const name = input.name?.trim();
  if (!name) throw badRequest("Ticket name is required.");
  const priceCents = input.priceCents ?? 0;
  if (priceCents < 0) throw badRequest("Price cannot be negative.");
  if (input.capacity != null && input.capacity < 1) throw badRequest("Ticket capacity must be at least 1.");
  const maxPerOrder = input.maxPerOrder ?? 2;
  if (maxPerOrder < 1 || maxPerOrder > MAX_SEATS_PER_ORDER)
    throw badRequest(`Max per order must be between 1 and ${MAX_SEATS_PER_ORDER}.`);
  let salesEndAt: Date | null = null;
  if (input.salesEndAt) {
    salesEndAt = new Date(input.salesEndAt);
    if (isNaN(salesEndAt.getTime())) throw badRequest("salesEndAt must be a valid ISO datetime.");
  }

  const tt = await db.eventTicketType.create({
    data: {
      orgId: user.orgId,
      eventId,
      name,
      description: input.description?.trim() || undefined,
      priceCents,
      capacity: input.capacity ?? undefined,
      maxPerOrder,
      salesEndAt: salesEndAt ?? undefined,
      isActive: input.isActive ?? true,
      sortOrder: input.sortOrder ?? 0,
    },
  });
  await audit({
    orgId: user.orgId, actor: user, action: "event.ticket_type.create",
    entityType: "event_ticket_type", entityId: tt.id,
    after: { eventId, name: tt.name, priceCents: tt.priceCents, capacity: tt.capacity },
    ip: meta?.ip, userAgent: meta?.userAgent,
  });
  return toTicketTypeDTO(tt);
}

export async function updateTicketType(
  user: SessionUser,
  eventId: string,
  ticketTypeId: string,
  input: TicketTypeInput,
  meta?: Meta
) {
  const tt = await requireTicketType(user.orgId, eventId, ticketTypeId);
  const data: any = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw badRequest("Ticket name cannot be empty.");
    data.name = name;
  }
  if (input.description !== undefined) data.description = input.description?.trim() || null;
  if (input.priceCents !== undefined) {
    if (tt.soldCount > 0 && input.priceCents !== tt.priceCents)
      throw badRequest("Cannot change the price after tickets have been sold — deactivate this type and create a new one instead.");
    if (input.priceCents < 0) throw badRequest("Price cannot be negative.");
    data.priceCents = input.priceCents;
  }
  if (input.capacity !== undefined) {
    if (input.capacity != null) {
      if (input.capacity < 1) throw badRequest("Ticket capacity must be at least 1.");
      if (tt.soldCount > input.capacity)
        throw badRequest(`Capacity cannot be below the ${tt.soldCount} seats already sold.`);
    }
    data.capacity = input.capacity ?? null;
  }
  if (input.maxPerOrder !== undefined) {
    if (input.maxPerOrder < 1 || input.maxPerOrder > MAX_SEATS_PER_ORDER)
      throw badRequest(`Max per order must be between 1 and ${MAX_SEATS_PER_ORDER}.`);
    data.maxPerOrder = input.maxPerOrder;
  }
  if (input.salesEndAt !== undefined) {
    if (input.salesEndAt) {
      const d = new Date(input.salesEndAt);
      if (isNaN(d.getTime())) throw badRequest("salesEndAt must be a valid ISO datetime.");
      data.salesEndAt = d;
    } else {
      data.salesEndAt = null;
    }
  }
  if (input.isActive !== undefined) data.isActive = input.isActive;
  if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;
  if (Object.keys(data).length === 0) throw badRequest("Nothing to update.");

  const updated = await db.eventTicketType.update({ where: { id: tt.id }, data });
  await audit({
    orgId: user.orgId, actor: user, action: "event.ticket_type.update",
    entityType: "event_ticket_type", entityId: tt.id,
    before: { name: tt.name, priceCents: tt.priceCents, capacity: tt.capacity, isActive: tt.isActive },
    after: data,
    ip: meta?.ip, userAgent: meta?.userAgent,
  });
  return toTicketTypeDTO(updated);
}

/* ──────────────────────────── staff: registrations ──────────────────────────── */

export async function listRegistrations(
  user: SessionUser,
  eventId: string,
  q: { status?: string; search?: string }
) {
  await requireEvent(user.orgId, eventId);
  const where: any = { orgId: user.orgId, eventId };
  if (q.status && q.status !== "all") where.status = q.status;
  const rows = await db.eventRegistration.findMany({
    where,
    include: {
      person: { select: { id: true, firstName: true, lastName: true } },
      ticketType: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  let items = rows.map((r) => toRegistrationDTO(r, { withToken: true }));
  if (q.search?.trim()) {
    const s = q.search.trim().toLowerCase();
    items = items.filter(
      (i) => i.name.toLowerCase().includes(s) || (i.guestEmail ?? "").toLowerCase().includes(s) || (i.guestPhone ?? "").includes(s)
    );
  }
  return { items };
}

/** Shared capacity resolution — returns the placement for a requested seat count. */
async function resolvePlacement(
  orgId: string,
  event: { id: string; registrationCapacity: number | null },
  ticketType: { id: string; capacity: number | null; soldCount: number } | null,
  quantity: number
): Promise<"fits" | "waitlist"> {
  const { held } = await heldSeats(orgId, event.id);
  if (event.registrationCapacity != null && held + quantity > event.registrationCapacity) return "waitlist";
  if (ticketType) {
    if (ticketType.capacity != null && ticketType.soldCount + quantity > ticketType.capacity) return "waitlist";
  }
  return "fits";
}

export interface CreateRegistrationInput {
  personId?: string;
  guestName?: string;
  guestEmail?: string;
  guestPhone?: string;
  ticketTypeId?: string;
  quantity?: number;
  notes?: string;
}

/** Staff registration — bypasses deadlines (door registration), respects capacity. */
export async function createRegistration(user: SessionUser, eventId: string, input: CreateRegistrationInput, meta?: Meta) {
  const event = await requireEvent(user.orgId, eventId);
  if (!event.registrationEnabled) throw badRequest("Registration is not enabled for this event — turn it on under Registration first.");

  const quantity = Math.max(1, Math.min(MAX_SEATS_PER_ORDER, Math.round(input.quantity ?? 1)));
  let personId: string | null = null;
  let guestName: string | null = null;
  let guestEmail: string | null = null;
  let guestPhone: string | null = null;

  if (input.personId) {
    const person = await db.person.findFirst({ where: { id: input.personId, orgId: user.orgId } });
    if (!person) throw badRequest("Person not found in this church.");
    personId = person.id;
  } else {
    guestName = input.guestName?.trim() || null;
    if (!guestName) throw badRequest("Provide a member or a guest name.");
    guestEmail = input.guestEmail?.trim() || null;
    guestPhone = input.guestPhone?.trim() || null;
  }

  let ticketType: any = null;
  if (input.ticketTypeId) {
    ticketType = await requireTicketType(user.orgId, eventId, input.ticketTypeId);
    if (!ticketType.isActive) throw badRequest("That ticket type is no longer active.");
    if (quantity > ticketType.maxPerOrder)
      throw badRequest(`"${ticketType.name}" allows at most ${ticketType.maxPerOrder} seat(s) per order.`);
  }

  const placement = await resolvePlacement(user.orgId, event, ticketType, quantity);
  const paid = !!ticketType && ticketType.priceCents > 0;
  const status = placement === "waitlist" ? "waitlist" : paid ? "pending_payment" : "confirmed";
  const amountDueCents = status === "pending_payment" ? ticketType.priceCents * quantity : 0;

  const reg = await db.eventRegistration.create({
    data: {
      orgId: user.orgId,
      eventId,
      ticketTypeId: ticketType?.id ?? null,
      personId,
      guestName,
      guestEmail,
      guestPhone,
      quantity,
      status,
      amountDueCents,
      paymentMethod: status === "confirmed" ? "free" : null,
      qrToken: await newQrToken(),
      notes: input.notes?.trim() || null,
      createdByName: user.name,
    },
  });
  if (status !== "waitlist" && ticketType) {
    await db.eventTicketType.update({ where: { id: ticketType.id }, data: { soldCount: { increment: quantity } } });
  }
  await audit({
    orgId: user.orgId, actor: user, action: "event.registration.create",
    entityType: "event_registration", entityId: reg.id,
    after: { eventId, name: personId ?? guestName, quantity, status, amountDueCents },
    ip: meta?.ip, userAgent: meta?.userAgent,
  });
  return toRegistrationDTO({ ...reg, ticketType, person: null }, { withToken: true });
}

/** FIFO waitlist promotion after seats free up. Single pass — honest and small. */
async function promoteWaitlist(orgId: string, eventId: string) {
  const event = await db.event.findFirst({ where: { id: eventId, orgId } });
  if (!event) return;
  const waitlisted = await db.eventRegistration.findMany({
    where: { orgId, eventId, status: "waitlist" },
    include: { ticketType: true },
    orderBy: { createdAt: "asc" },
    take: 50,
  });
  if (!waitlisted.length) return;

  let { held } = await heldSeats(orgId, eventId);
  for (const reg of waitlisted) {
    const tt = reg.ticketType;
    if (tt && !tt.isActive) continue;
    if (event.registrationCapacity != null && held + reg.quantity > event.registrationCapacity) continue;
    if (tt && tt.capacity != null && tt.soldCount + reg.quantity > tt.capacity) continue;

    const paid = !!tt && tt.priceCents > 0;
    const status = paid ? "pending_payment" : "confirmed";
    const amountDueCents = paid ? tt.priceCents * reg.quantity : 0;
    await db.eventRegistration.update({
      where: { id: reg.id },
      data: { status, amountDueCents, paymentMethod: paid ? null : "free" },
    });
    if (tt) {
      await db.eventTicketType.update({ where: { id: tt.id }, data: { soldCount: { increment: reg.quantity } } });
    }
    held += reg.quantity;
  }
}

export async function cancelRegistration(user: SessionUser, registrationId: string, meta?: Meta) {
  const reg = await db.eventRegistration.findFirst({
    where: { id: registrationId, orgId: user.orgId },
    include: { ticketType: true },
  });
  if (!reg) throw notFound("Registration not found.");
  if (reg.status === "cancelled") return { ok: true };
  if (reg.checkedInSeats > 0) throw badRequest("This order is already checked in — it cannot be cancelled.");

  await db.eventRegistration.update({ where: { id: reg.id }, data: { status: "cancelled" } });
  if (reg.status !== "waitlist" && reg.ticketTypeId) {
    await db.eventTicketType.update({
      where: { id: reg.ticketTypeId },
      data: { soldCount: { decrement: Math.min(reg.quantity, reg.ticketType?.soldCount ?? reg.quantity) } },
    });
  }
  await audit({
    orgId: user.orgId, actor: user, action: "event.registration.cancel",
    entityType: "event_registration", entityId: reg.id,
    before: { status: reg.status },
    after: { status: "cancelled" },
    ip: meta?.ip, userAgent: meta?.userAgent,
  });
  await promoteWaitlist(user.orgId, reg.eventId);
  return { ok: true };
}

export interface ConfirmPaymentInput {
  method?: string;
  reference?: string;
}

const PAY_METHODS = ["cash", "transfer", "demo_card"];

export async function confirmRegistrationPayment(user: SessionUser, registrationId: string, input: ConfirmPaymentInput, meta?: Meta) {
  const reg = await db.eventRegistration.findFirst({
    where: { id: registrationId, orgId: user.orgId },
    include: { ticketType: true, person: { select: { firstName: true, lastName: true } } },
  });
  if (!reg) throw notFound("Registration not found.");
  if (reg.status === "cancelled") throw badRequest("This registration was cancelled.");
  if (reg.status === "waitlist") throw badRequest("This order is still waitlisted — payment opens once a seat frees up.");
  // pending_payment is the normal unpaid state, but a confirmed order can also
  // carry an outstanding balance (pay-later at the office, partial collection)
  // — allow settling it instead of stranding the money unpayable.
  const outstanding = reg.amountDueCents - reg.amountPaidCents;
  if (reg.status !== "pending_payment" && !(reg.status === "confirmed" && outstanding > 0))
    throw badRequest("Nothing left to pay on this order.");

  const method = PAY_METHODS.includes(input.method ?? "") ? (input.method as string) : "cash";
  const ref = paymentRefFor(method, input.reference);
  const updated = await db.eventRegistration.update({
    where: { id: reg.id },
    data: {
      status: "confirmed",
      amountPaidCents: reg.amountDueCents,
      paymentMethod: method,
      paymentRef: ref,
      paidAt: new Date(),
    },
  });
  await audit({
    orgId: user.orgId, actor: user, action: "event.registration.payment",
    entityType: "event_registration", entityId: reg.id,
    after: { method, amountCents: updated.amountPaidCents, paymentRef: ref },
    ip: meta?.ip, userAgent: meta?.userAgent,
  });
  return toRegistrationDTO({ ...updated, ticketType: reg.ticketType, person: reg.person }, { withToken: true });
}

/* ─────────────────────────────── QR check-in ─────────────────────────────── */

export async function checkInByToken(
  user: SessionUser,
  rawToken: string,
  meta?: Meta,
  opts?: { eventId?: string }
) {
  const token = normalizeQrToken(rawToken);
  if (!token) throw badRequest("Scan or paste a ticket code first.");
  const reg = await db.eventRegistration.findFirst({
    where: { orgId: user.orgId, qrToken: token },
    include: {
      event: { select: { id: true, name: true, startsAt: true } },
      ticketType: { select: { name: true } },
      person: { select: { firstName: true, lastName: true } },
    },
  });
  if (!reg) throw notFound("Ticket not recognized — check the code and try again.");
  const displayName = reg.person
    ? [reg.person.firstName, reg.person.lastName].filter(Boolean).join(" ")
    : reg.guestName || "Guest";

  // Kiosk mode is per-event: a ticket printed for another service must bounce
  // with a clear message, not silently check the person in somewhere else.
  if (opts?.eventId && reg.eventId !== opts.eventId)
    throw badRequest(`Wrong event — this ticket is for “${reg.event.name}”.`);

  if (reg.status === "cancelled") throw badRequest(`Ticket for ${displayName} was cancelled.`);
  if (reg.status === "waitlist") throw badRequest(`${displayName} is still on the waitlist.`);
  if (reg.status === "pending_payment")
    throw badRequest(`Payment outstanding for ${displayName} — record it before check-in.`);

  if (reg.checkedInSeats >= reg.quantity) {
    return {
      ok: true, alreadyDone: true,
      name: displayName,
      eventName: reg.event.name,
      seatsTotal: reg.quantity,
      seatsCheckedIn: reg.checkedInSeats,
    };
  }

  const updated = await db.eventRegistration.update({
    where: { id: reg.id },
    data: {
      checkedInSeats: { increment: 1 },
      checkedInAt: reg.checkedInAt ?? new Date(),
      checkedInBy: user.name,
    },
  });
  // Door check-ins constitute attendance: every member seat admitted at the
  // door lands in the event's attendance sheet (status "checked_in"), so
  // headcounts and the Excel export see it. Guests have no person record —
  // they remain visible through the door check-in list instead.
  if (reg.personId) {
    await db.attendanceRecord.upsert({
      where: { personId_eventId: { personId: reg.personId, eventId: reg.eventId } },
      create: {
        orgId: user.orgId,
        personId: reg.personId,
        eventId: reg.eventId,
        status: "checked_in",
        method: "kiosk",
        checkedInAt: new Date(),
        checkedInByName: user.name ?? undefined,
      },
      update: { status: "checked_in", checkedInByName: user.name ?? undefined },
    });
  }
  await audit({
    orgId: user.orgId, actor: user, action: "event.registration.checkin",
    entityType: "event_registration", entityId: reg.id,
    after: { name: displayName, seatsCheckedIn: updated.checkedInSeats, seatsTotal: updated.quantity },
    ip: meta?.ip, userAgent: meta?.userAgent,
  });
  return {
    ok: true, alreadyDone: false,
    name: displayName,
    eventName: reg.event.name,
    ticketTypeName: reg.ticketType?.name ?? "General admission",
    seatsTotal: updated.quantity,
    seatsCheckedIn: updated.checkedInSeats,
  };
}

/* ─────────────────────────── program / run-sheet ─────────────────────────── */

export async function getProgram(user: SessionUser, eventId: string) {
  await requireEvent(user.orgId, eventId);
  const items = await db.eventProgramItem.findMany({
    where: { orgId: user.orgId, eventId },
    orderBy: [{ startsAt: "asc" }, { sortOrder: "asc" }],
  });
  return { items };
}

export interface ProgramItemInput {
  title?: string;
  speaker?: string;
  startsAt?: string;
  endsAt?: string;
  roomText?: string;
  notes?: string;
}

export async function addProgramItem(user: SessionUser, eventId: string, input: ProgramItemInput, meta?: Meta) {
  await requireEvent(user.orgId, eventId);
  const title = input.title?.trim();
  if (!title) throw badRequest("Program item title is required.");
  const startsAt = new Date(input.startsAt ?? "");
  const endsAt = new Date(input.endsAt ?? "");
  if (isNaN(startsAt.getTime())) throw badRequest("Start time is required.");
  if (isNaN(endsAt.getTime())) throw badRequest("End time is required.");
  if (endsAt <= startsAt) throw badRequest("End time must be after the start time.");

  const item = await db.eventProgramItem.create({
    data: {
      orgId: user.orgId,
      eventId,
      title,
      speaker: input.speaker?.trim() || null,
      startsAt,
      endsAt,
      roomText: input.roomText?.trim() || null,
      notes: input.notes?.trim() || null,
      sortOrder: 0,
    },
  });
  await audit({
    orgId: user.orgId, actor: user, action: "event.program.create",
    entityType: "event_program_item", entityId: item.id,
    after: { eventId, title, startsAt, endsAt },
    ip: meta?.ip, userAgent: meta?.userAgent,
  });
  return { ok: true, id: item.id };
}

export async function deleteProgramItem(user: SessionUser, eventId: string, itemId: string, meta?: Meta) {
  const item = await db.eventProgramItem.findFirst({ where: { id: itemId, orgId: user.orgId, eventId } });
  if (!item) throw notFound("Program item not found.");
  await db.eventProgramItem.delete({ where: { id: item.id } });
  await audit({
    orgId: user.orgId, actor: user, action: "event.program.delete",
    entityType: "event_program_item", entityId: item.id,
    before: { title: item.title },
    ip: meta?.ip, userAgent: meta?.userAgent,
  });
  return { ok: true };
}

/* ─────────────────────── member self-service (portal) ─────────────────────── */

/** Upcoming registration-enabled events for members, with remaining seats. */
export async function memberCatalog(user: SessionUser) {
  const now = new Date(Date.now() - 2 * 3600 * 1000); // keep visible for 2h after start
  const events = await db.event.findMany({
    where: { orgId: user.orgId, registrationEnabled: true, status: "scheduled", startsAt: { gte: now } },
    orderBy: { startsAt: "asc" },
    take: 20,
  });
  if (!events.length) return { items: [] };

  const ids = events.map((e) => e.id);
  const types = await db.eventTicketType.findMany({
    where: { orgId: user.orgId, eventId: { in: ids }, isActive: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  const held = await db.eventRegistration.groupBy({
    by: ["eventId"],
    where: { orgId: user.orgId, eventId: { in: ids }, status: { in: HELD_STATUSES } },
    _sum: { quantity: true },
  });
  const heldMap = new Map(held.map((h) => [h.eventId, h._sum.quantity ?? 0]));
  const mine = await db.eventRegistration.findMany({
    where: { orgId: user.orgId, personId: user.personId ?? "__none__", eventId: { in: ids }, status: { not: "cancelled" } },
    orderBy: { createdAt: "desc" },
  });
  const mineByEvent = new Map<string, (typeof mine)[number]>();
  for (const m of mine) if (!mineByEvent.has(m.eventId)) mineByEvent.set(m.eventId, m);

  return {
    items: events.map((e) => {
      const myReg = mineByEvent.get(e.id);
      return {
        id: e.id,
        name: e.name,
        kind: e.kind,
        startsAt: e.startsAt,
        endsAt: e.endsAt,
        roomText: e.roomText,
        registrationNote: e.registrationNote,
        registrationDeadline: e.registrationDeadline,
        remainingSeats: remainingOf(e.registrationCapacity, heldMap.get(e.id) ?? 0),
        ticketTypes: types
          .filter((t) => t.eventId === e.id)
          .map((t) => ({
            id: t.id,
            name: t.name,
            description: t.description,
            priceCents: t.priceCents,
            currency: t.currency,
            maxPerOrder: t.maxPerOrder,
            remaining: remainingOf(t.capacity, t.soldCount),
            salesEndAt: t.salesEndAt,
          })),
        myRegistration: myReg
          ? {
              id: myReg.id,
              status: myReg.status,
              quantity: myReg.quantity,
              amountDueCents: myReg.amountDueCents,
              amountPaidCents: myReg.amountPaidCents,
            }
          : null,
      };
    }),
  };
}

/** The member's own tickets (with qrToken so the portal can render the QR). */
export async function myRegistrations(user: SessionUser) {
  if (!user.personId) return { items: [] };
  const rows = await db.eventRegistration.findMany({
    where: { orgId: user.orgId, personId: user.personId, status: { not: "cancelled" } },
    include: {
      event: { select: { id: true, name: true, startsAt: true, endsAt: true, roomText: true, kind: true } },
      ticketType: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return {
    items: rows.map((r) => ({
      id: r.id,
      eventId: r.eventId,
      eventName: r.event.name,
      eventStartsAt: r.event.startsAt,
      eventRoomText: r.event.roomText,
      kind: r.event.kind,
      ticketTypeName: r.ticketType?.name ?? "General admission",
      quantity: r.quantity,
      status: r.status,
      amountDueCents: r.amountDueCents,
      amountPaidCents: r.amountPaidCents,
      checkedInSeats: r.checkedInSeats,
      qrToken: r.qrToken,
      createdAt: r.createdAt,
    })),
  };
}

export interface MemberRsvpInput {
  ticketTypeId?: string;
  quantity?: number;
}

export async function memberRsvp(user: SessionUser, eventId: string, input: MemberRsvpInput, meta?: Meta) {
  if (!user.personId) throw badRequest("Your portal account is not linked to a member profile — ask the office to link it.");
  const event = await requireEvent(user.orgId, eventId);
  if (!event.registrationEnabled) throw badRequest("Registration is not open for this event.");
  if (event.status !== "scheduled") throw badRequest("This event is no longer open.");
  if (event.registrationDeadline && new Date(event.registrationDeadline).getTime() < Date.now())
    throw badRequest("The registration deadline for this event has passed.");

  const existing = await db.eventRegistration.findFirst({
    where: { orgId: user.orgId, eventId, personId: user.personId, status: { not: "cancelled" } },
  });
  if (existing) throw badRequest("You already have a registration for this event — view it under My tickets.");

  const quantity = Math.max(1, Math.min(MAX_SEATS_PER_ORDER, Math.round(input.quantity ?? 1)));
  let ticketType: any = null;
  if (input.ticketTypeId) {
    ticketType = await requireTicketType(user.orgId, eventId, input.ticketTypeId);
    if (!ticketType.isActive) throw badRequest("That ticket type is no longer available.");
    if (quantity > ticketType.maxPerOrder)
      throw badRequest(`"${ticketType.name}" allows at most ${ticketType.maxPerOrder} seat(s) per order.`);
    if (ticketType.salesEndAt && new Date(ticketType.salesEndAt).getTime() < Date.now())
      throw badRequest(`Sales for "${ticketType.name}" have closed.`);
  }

  const placement = await resolvePlacement(user.orgId, event, ticketType, quantity);
  const paid = !!ticketType && ticketType.priceCents > 0;
  const status = placement === "waitlist" ? "waitlist" : paid ? "pending_payment" : "confirmed";
  const amountDueCents = status === "pending_payment" ? ticketType.priceCents * quantity : 0;

  const reg = await db.eventRegistration.create({
    data: {
      orgId: user.orgId,
      eventId,
      ticketTypeId: ticketType?.id ?? null,
      personId: user.personId,
      quantity,
      status,
      amountDueCents,
      paymentMethod: status === "confirmed" ? "free" : null,
      qrToken: await newQrToken(),
      createdByName: user.name,
    },
  });
  if (status !== "waitlist" && ticketType) {
    await db.eventTicketType.update({ where: { id: ticketType.id }, data: { soldCount: { increment: quantity } } });
  }
  await audit({
    orgId: user.orgId, actor: user, action: "event.registration.rsvp",
    entityType: "event_registration", entityId: reg.id,
    after: { eventId, quantity, status, source: "portal" },
    ip: meta?.ip, userAgent: meta?.userAgent,
  });
  return { id: reg.id, status, amountDueCents, quantity };
}

/** Member pays a pending ticket with the demo card seam (Stripe-swappable). */
export async function memberPayRsvp(user: SessionUser, registrationId: string, meta?: Meta) {
  if (!user.personId) throw badRequest("Your portal account is not linked to a member profile.");
  const reg = await db.eventRegistration.findFirst({
    where: { id: registrationId, orgId: user.orgId, personId: user.personId },
  });
  if (!reg) throw notFound("Registration not found.");
  if (reg.status === "cancelled") throw badRequest("This order was cancelled.");
  if (reg.status === "waitlist") throw badRequest("This order is still waitlisted — you'll be notified when a seat frees up.");
  // Same rule as staff-side: settle any order with an outstanding balance.
  const outstanding = reg.amountDueCents - reg.amountPaidCents;
  if (reg.status !== "pending_payment" && !(reg.status === "confirmed" && outstanding > 0))
    throw badRequest("Nothing left to pay on this order.");

  const ref = `pi_demo_${randomBytes(10).toString("hex")}`;
  const updated = await db.eventRegistration.update({
    where: { id: reg.id },
    data: {
      status: "confirmed",
      amountPaidCents: reg.amountDueCents,
      paymentMethod: "demo_card",
      paymentRef: ref,
      paidAt: new Date(),
    },
  });
  await audit({
    orgId: user.orgId, actor: user, action: "event.registration.payment",
    entityType: "event_registration", entityId: reg.id,
    after: { method: "demo_card", amountCents: updated.amountPaidCents, paymentRef: ref, source: "portal" },
    ip: meta?.ip, userAgent: meta?.userAgent,
  });
  return { ok: true, status: updated.status };
}

/* ─────────────────────── summary for the module dashboard ─────────────────────── */

export async function registrationSummary(user: SessionUser, q: { from?: string; to?: string }) {
  const now = Date.now();
  const from = q.from ? new Date(q.from) : new Date(now - 30 * 864e5);
  const to = q.to ? new Date(q.to) : new Date(now + 60 * 864e5);
  if (isNaN(from.getTime()) || isNaN(to.getTime())) throw badRequest("from/to must be valid ISO dates.");
  const events = await db.event.findMany({
    where: { orgId: user.orgId, startsAt: { gte: from, lte: to } },
    select: { id: true },
  });
  if (!events.length) return { items: [] };
  const ids = events.map((e) => e.id);
  const grouped = await db.eventRegistration.groupBy({
    by: ["eventId", "status"],
    where: { orgId: user.orgId, eventId: { in: ids }, status: { in: [...HELD_STATUSES, "waitlist"] } },
    _sum: { quantity: true },
    _count: { _all: true },
  });
  const map = new Map<string, { seats: number; orders: number; waitlistSeats: number }>();
  for (const g of grouped) {
    const cur = map.get(g.eventId) ?? { seats: 0, orders: 0, waitlistSeats: 0 };
    if (g.status === "waitlist") {
      cur.waitlistSeats += g._sum.quantity ?? 0;
    } else {
      cur.seats += g._sum.quantity ?? 0;
      cur.orders += g._count._all;
    }
    map.set(g.eventId, cur);
  }
  return { items: [...map.entries()].map(([eventId, v]) => ({ eventId, ...v })) };
}

/* ─────────────── door check-ins → attendance + Excel export ─────────────── */

export interface DoorCheckinRow {
  key: string;
  name: string;
  personId: string | null;
  isGuest: boolean;
  ticketTypeName: string;
  seat: number; // 1-based within the order
  seats: number; // order quantity
  checkedInAt: string | null; // first door scan of the order (ISO)
  checkedInBy: string | null;
}

/**
 * Every seat admitted at the door for an event, expanded one row per seat.
 * Members and guests both appear — guests (no person record) carry isGuest.
 */
export async function doorCheckinsFor(orgId: string, eventId: string): Promise<DoorCheckinRow[]> {
  const regs = await db.eventRegistration.findMany({
    where: { orgId, eventId, checkedInSeats: { gt: 0 } },
    include: {
      ticketType: { select: { name: true } },
      person: { select: { firstName: true, lastName: true } },
    },
    orderBy: { checkedInAt: "asc" },
  });
  const rows: DoorCheckinRow[] = [];
  for (const r of regs) {
    const name = r.person
      ? [r.person.firstName, r.person.lastName].filter(Boolean).join(" ")
      : r.guestName || "Guest";
    for (let seat = 1; seat <= r.checkedInSeats; seat++) {
      rows.push({
        key: `${r.id}#${seat}`,
        name,
        personId: r.personId,
        isGuest: !r.personId,
        ticketTypeName: r.ticketType?.name ?? "General admission",
        seat,
        seats: r.quantity,
        checkedInAt: r.checkedInAt ? r.checkedInAt.toISOString() : null,
        checkedInBy: r.checkedInBy,
      });
    }
  }
  return rows.sort((a, b) => (a.checkedInAt ?? "").localeCompare(b.checkedInAt ?? ""));
}

/** Staff listing of a single event's door check-ins (attendance). */
export async function listDoorCheckins(user: SessionUser, eventId: string) {
  await requireEvent(user.orgId, eventId);
  return { items: await doorCheckinsFor(user.orgId, eventId) };
}

/** Rasterize the church logo once per process — the Excel header embeds a PNG. */
let logoPngCache: Buffer | null | undefined;
async function logoPng(): Promise<Buffer | null> {
  if (logoPngCache !== undefined) return logoPngCache;
  try {
    const svg = await readFile(path.join(process.cwd(), "public", "logo.svg"));
    logoPngCache = await sharp(svg, { density: 300 }).resize(96, 96, { fit: "inside" }).png().toBuffer();
  } catch {
    logoPngCache = null; // export still works without the logo
  }
  return logoPngCache;
}

function fmtExcelDateTime(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short", day: "numeric", month: "short", year: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true, timeZone,
  }).format(d);
}

/**
 * Attendance workbook for an event: branded header (church logo, org name,
 * event name, date, venue) + every person who was checked in — door seats
 * (QR / kiosk, members and guests) plus roster/manual attendance rows.
 */
export async function exportAttendanceWorkbook(user: SessionUser, eventId: string) {
  const event = await requireEvent(user.orgId, eventId);
  const [campus, org, doorRows, records] = await Promise.all([
    db.campus.findFirst({ where: { id: event.campusId }, select: { name: true, city: true } }),
    db.organization.findFirst({ where: { id: user.orgId }, select: { name: true, timezone: true } }),
    doorCheckinsFor(user.orgId, eventId),
    db.attendanceRecord.findMany({ where: { orgId: user.orgId, eventId }, orderBy: { checkedInAt: "asc" } }),
  ]);

  const personIds = [...new Set(records.map((r) => r.personId))];
  const people = personIds.length
    ? await db.person.findMany({ where: { id: { in: personIds } }, select: { id: true, firstName: true, lastName: true } })
    : [];
  const peopleMap = new Map(people.map((p) => [p.id, `${p.firstName} ${p.lastName}`]));

  const tz = org?.timezone || "Africa/Lagos";
  const doorPersonIds = new Set(doorRows.map((r) => r.personId).filter(Boolean) as string[]);
  const METHOD_LABELS: Record<string, string> = { kiosk: "QR / kiosk", roster: "Roster", manual: "Manual", headcount: "Headcount", self: "Self" };

  type Row = { name: string; category: string; ticketType: string; seat: string; at: string; via: string };
  const rows: Row[] = [];
  for (const r of doorRows) {
    rows.push({
      name: r.name,
      category: r.isGuest ? "Guest" : "Member",
      ticketType: r.ticketTypeName,
      seat: `Seat ${r.seat} of ${r.seats}`,
      at: r.checkedInAt ? fmtExcelDateTime(new Date(r.checkedInAt), tz) : "",
      via: "QR / kiosk",
    });
  }
  // roster/manual rows that the door flow didn't already cover for that person
  for (const r of records) {
    if (r.personId && doorPersonIds.has(r.personId)) continue;
    rows.push({
      name: peopleMap.get(r.personId) ?? r.personId,
      category: "Member",
      ticketType: r.roomText || "—",
      seat: "—",
      at: r.checkedInAt ? fmtExcelDateTime(r.checkedInAt, tz) : "",
      via: METHOD_LABELS[r.method] ?? r.method,
    });
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = user.orgName || "ChurchOS";
  wb.created = new Date();
  const ws = wb.addWorksheet("Attendance", {
    views: [{ showGridLines: false }],
    // Landscape + fit-to-width so all columns print on one page.
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5 } },
  });

  ws.columns = [
    { width: 11 },  // # (doubles as logo gutter — keeps the 64px image clear of the text)
    { width: 28 },  // name
    { width: 12 },  // category
    { width: 24 },  // ticket type / room
    { width: 16 },  // seat
    { width: 26 },  // checked in at
    { width: 16 },  // recorded via
  ];

  // ── branded header ──
  ws.mergeCells("B1:G1");
  ws.mergeCells("B2:G2");
  ws.mergeCells("B3:G3");
  ws.mergeCells("B4:G4");
  const orgCell = ws.getCell("B1");
  orgCell.value = org?.name || user.orgName || "Church";
  orgCell.font = { size: 16, bold: true, color: { argb: "FF1C1917" } };
  const eventCell = ws.getCell("B2");
  eventCell.value = `Event: ${event.name}`;
  eventCell.font = { size: 13, bold: true, color: { argb: "FF44403C" } };
  ws.getCell("B3").value = `Date: ${fmtExcelDateTime(event.startsAt, tz)}`;
  const venue = [event.roomText, campus?.name, campus?.city].filter(Boolean).join(" — ");
  ws.getCell("B4").value = `Venue: ${venue || "—"}`;
  for (const ref of ["B3", "B4"]) {
    ws.getCell(ref).font = { size: 11, color: { argb: "FF57534E" } };
  }

  const logo = await logoPng();
  if (logo) {
    const imgId = wb.addImage({ buffer: logo, extension: "png" });
    ws.addImage(imgId, { tl: { col: 0.08, row: 0.05 }, ext: { width: 64, height: 64 } });
  }
  ws.getRow(5).height = 8;

  // ── table header ──
  const headerRow = ws.getRow(6);
  headerRow.values = ["#", "Name", "Category", "Ticket type / room", "Seat", "Checked in at", "Recorded via"];
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF292524" } };
    cell.alignment = { vertical: "middle" };
  });

  // ── data rows ──
  rows.forEach((r, i) => {
    const row = ws.getRow(7 + i);
    row.values = [i + 1, r.name, r.category, r.ticketType, r.seat, r.at, r.via];
    row.alignment = { vertical: "middle" };
    if (i % 2 === 1) {
      row.eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFAFAF9" } };
      });
    }
  });

  // ── totals ──
  const totalRow = ws.getRow(8 + rows.length);
  totalRow.values = ["", `Total checked in: ${doorRows.length} seat(s)`, "", "", "", "", `Generated ${fmtExcelDateTime(new Date(), tz)} by ${user.name ?? "staff"}`];
  totalRow.getCell(2).font = { bold: true, size: 11 };
  totalRow.getCell(7).font = { size: 9, italic: true, color: { argb: "FF78716C" } };

  if (rows.length === 0) {
    ws.mergeCells("B7:G7");
    ws.getCell("B7").value = "No attendance recorded yet for this event.";
    ws.getCell("B7").font = { italic: true, color: { argb: "FF78716C" } };
  }

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  const safeName = event.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "event";
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="attendance-${safeName}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
