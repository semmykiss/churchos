import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { badRequest, forbidden, notFound } from "@/server/http";
import { can, type SessionUser } from "@/server/permissions";
import { notifyChatDelete, notifyChatMessage, notifyChatRead } from "@/server/chat-realtime";
import { markEntityRead, pushNotifications, userIdsForPersons } from "@/server/services/notifications";

/**
 * Chat service (backend only) — WhatsApp-style messaging inside Communications.
 * Business rules:
 *  • direct chats between two persons, deduped (either side can reopen the thread)
 *  • group chats are bound to real Groups; participants sync from GroupMember
 *    membership (leaving a group revokes the chat, rejoining restores it)
 *  • the church-wide conversation is one per org and strictly access-based:
 *    only users holding "comms.chat.churchwide" ever see or join it
 *  • every chat user needs a member profile (personId) — chat is people-to-people
 * Real-time delivery is delegated to the socket.io service; this service owns
 * persistence, permissions, read state and moderation.
 */

const MAX_BODY = 4000;
const DEFAULT_PAGE = 50;

function requireChatProfile(user: SessionUser): string {
  if (!user.personId) throw badRequest("Chat requires a member profile linked to your account.");
  return user.personId;
}

export function canChurchwide(user: SessionUser): boolean {
  return can(user, "comms.chat.churchwide");
}

function personName(p: { firstName: string; lastName: string } | null | undefined): string {
  return p ? `${p.firstName} ${p.lastName}`.trim() : "Unknown";
}

/** Resolve a conversation the user may access, or throw. */
async function assertAccess(user: SessionUser, conversationId: string) {
  const conv = await db.chatConversation.findFirst({
    where: { id: conversationId, orgId: user.orgId, archivedAt: null },
  });
  if (!conv) throw notFound("Conversation not found.");
  if (conv.type === "churchwide") {
    if (!canChurchwide(user)) {
      throw forbidden('Church-wide chat requires the "comms.chat.churchwide" permission.');
    }
    return conv;
  }
  const part = await db.chatParticipant.findFirst({
    where: { conversationId: conv.id, personId: user.personId ?? "__none__", leftAt: null },
  });
  if (!part) throw forbidden("You are not part of this conversation.");
  return conv;
}

type ReplyRow = { id: string; senderName: string; body: string; deletedAt: Date | null } | null;

function toMessageDTO(
  m: {
    id: string;
    conversationId: string;
    senderPersonId: string;
    senderUserId: string | null;
    senderName: string;
    body: string;
    kind: string;
    createdAt: Date;
    replyTo?: ReplyRow;
  },
  me: string,
) {
  return {
    id: m.id,
    conversationId: m.conversationId,
    senderPersonId: m.senderPersonId,
    senderUserId: m.senderUserId,
    senderName: m.senderName,
    body: m.body,
    kind: m.kind,
    createdAt: m.createdAt,
    mine: m.senderPersonId === me,
    replyTo: m.replyTo
      ? {
          id: m.replyTo.id,
          senderName: m.replyTo.senderName,
          // deleted originals render as "message was deleted" in the UI
          body: m.replyTo.deletedAt ? "" : m.replyTo.body,
        }
      : null,
  };
}

/* ───────────────────────────── conversations ───────────────────────────── */

export async function listConversations(user: SessionUser) {
  const me = requireChatProfile(user);
  const churchwide = canChurchwide(user);
  const meName = personName(
    await db.person.findUnique({ where: { id: me }, select: { firstName: true, lastName: true } }),
  );

  // 1) sync group-chat participation from real group membership
  const groupConvs = await db.chatConversation.findMany({
    where: { orgId: user.orgId, type: "group", archivedAt: null },
    select: { id: true, groupId: true },
  });
  const myGroupIds = new Set(
    (
      await db.groupMember.findMany({
        where: {
          orgId: user.orgId, personId: me, status: "active",
          group: { status: "active", deletedAt: null },
        },
        select: { groupId: true },
      })
    ).map((gm) => gm.groupId),
  );
  for (const gc of groupConvs) {
    if (gc.groupId && myGroupIds.has(gc.groupId)) {
      await db.chatParticipant.upsert({
        where: { conversationId_personId: { conversationId: gc.id, personId: me } },
        create: { orgId: user.orgId, conversationId: gc.id, personId: me, label: meName },
        update: { leftAt: null },
      });
    } else {
      await db.chatParticipant.updateMany({
        where: { conversationId: gc.id, personId: me, leftAt: null },
        data: { leftAt: new Date() },
      });
    }
  }

  // 2) ensure the church-wide conversation + my participant row (access-based)
  if (churchwide) {
    let cw = await db.chatConversation.findFirst({
      where: { orgId: user.orgId, type: "churchwide", archivedAt: null },
    });
    if (!cw) {
      cw = await db.chatConversation.create({
        data: { orgId: user.orgId, type: "churchwide", title: `${user.orgName} — Church-wide` },
      });
      await audit({
        orgId: user.orgId, actor: user, action: "chat.conversation.create",
        entityType: "chat_conversation", entityId: cw.id, after: { type: "churchwide" },
      });
    }
    await db.chatParticipant.upsert({
      where: { conversationId_personId: { conversationId: cw.id, personId: me } },
      create: { orgId: user.orgId, conversationId: cw.id, personId: me, label: meName },
      update: { leftAt: null },
    });
  }

  // 3) my conversations
  const myParts = await db.chatParticipant.findMany({
    where: { personId: me, leftAt: null, conversation: { orgId: user.orgId, archivedAt: null } },
    include: {
      conversation: {
        include: {
          group: { select: { name: true } },
          _count: { select: { participants: { where: { leftAt: null } } } },
        },
      },
    },
  });
  // a user who lost church-wide access must not keep seeing the room
  const visibleParts = myParts.filter((p) => p.conversation.type !== "churchwide" || churchwide);

  const convIds = visibleParts.map((p) => p.conversationId);
  const lastMessages = convIds.length
    ? await db.chatMessage.findMany({
        where: { conversationId: { in: convIds }, deletedAt: null },
        orderBy: { createdAt: "desc" },
        distinct: ["conversationId"],
      })
    : [];
  const lastByConv = new Map(lastMessages.map((m) => [m.conversationId, m]));

  const allParts = convIds.length
    ? await db.chatParticipant.findMany({
        where: { conversationId: { in: convIds }, leftAt: null },
        select: { conversationId: true, personId: true, label: true },
      })
    : [];
  const partsByConv = new Map<string, { personId: string; label: string | null }[]>();
  for (const ap of allParts) {
    const list = partsByConv.get(ap.conversationId) ?? [];
    list.push({ personId: ap.personId, label: ap.label });
    partsByConv.set(ap.conversationId, list);
  }

  const items: Array<{
    id: string;
    type: string;
    title: string;
    groupId: string | null;
    memberCount: number;
    unreadCount: number;
    updatedAt: Date;
    lastMessage: { id: string; body: string; senderName: string; createdAt: Date; mine: boolean } | null;
    otherPersonId: string | null;
    canModerate: boolean;
  }> = [];
  for (const part of visibleParts) {
    const conv = part.conversation;
    let title = conv.title ?? conv.group?.name ?? "";
    let otherPersonId: string | null = null;
    if (conv.type === "direct") {
      const others = (partsByConv.get(conv.id) ?? []).filter((p) => p.personId !== me);
      otherPersonId = others[0]?.personId ?? null;
      title = others[0]?.label ?? title;
    }
    if (conv.type === "churchwide" && !title) title = `${user.orgName} — Church-wide`;

    const last = lastByConv.get(conv.id);
    const unreadCount = last
      ? await db.chatMessage.count({
          where: {
            conversationId: conv.id, deletedAt: null,
            senderPersonId: { not: me },
            createdAt: { gt: part.lastReadAt ?? new Date(0) },
          },
        })
      : 0;

    items.push({
      id: conv.id,
      type: conv.type,
      title,
      groupId: conv.groupId,
      memberCount: conv._count.participants,
      unreadCount,
      updatedAt: conv.updatedAt,
      lastMessage: last
        ? { id: last.id, body: last.body, senderName: last.senderName, createdAt: last.createdAt, mine: last.senderPersonId === me }
        : null,
      otherPersonId,
      canModerate: conv.type === "churchwide" && churchwide,
    });
  }

  items.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));

  return { items, me: { personId: me, name: meName }, churchwideAvailable: churchwide };
}

async function conversationItem(user: SessionUser, conversationId: string) {
  const me = requireChatProfile(user);
  const conv = await db.chatConversation.findFirst({
    where: { id: conversationId, orgId: user.orgId },
    include: {
      group: { select: { name: true } },
      participants: { where: { leftAt: null }, select: { personId: true, label: true } },
      _count: { select: { participants: { where: { leftAt: null } } } },
    },
  });
  if (!conv) throw notFound("Conversation not found.");

  let title = conv.title ?? conv.group?.name ?? "";
  let otherPersonId: string | null = null;
  if (conv.type === "direct") {
    const other = conv.participants.find((p) => p.personId !== me);
    otherPersonId = other?.personId ?? null;
    title = other?.label ?? title;
  }
  if (conv.type === "churchwide" && !title) title = `${user.orgName} — Church-wide`;

  const last = await db.chatMessage.findFirst({
    where: { conversationId: conv.id, deletedAt: null },
    orderBy: { createdAt: "desc" },
  });
  const myPart = await db.chatParticipant.findFirst({
    where: { conversationId: conv.id, personId: me },
  });
  const unreadCount = last
    ? await db.chatMessage.count({
        where: {
          conversationId: conv.id, deletedAt: null, senderPersonId: { not: me },
          createdAt: { gt: myPart?.lastReadAt ?? new Date(0) },
        },
      })
    : 0;

  return {
    id: conv.id,
    type: conv.type,
    title,
    groupId: conv.groupId,
    memberCount: conv._count.participants,
    unreadCount,
    updatedAt: conv.updatedAt,
    lastMessage: last
      ? { id: last.id, body: last.body, senderName: last.senderName, createdAt: last.createdAt, mine: last.senderPersonId === me }
      : null,
    otherPersonId,
    canModerate: conv.type === "churchwide" && canChurchwide(user),
  };
}

export async function createDirect(user: SessionUser, input: { personId?: string }) {
  const me = requireChatProfile(user);
  const targetId = String(input?.personId ?? "");
  if (!targetId) throw badRequest("personId is required.");
  if (targetId === me) throw badRequest("You cannot start a chat with yourself.");

  const target = await db.person.findFirst({
    where: { id: targetId, orgId: user.orgId, deletedAt: null, status: { notIn: ["archived", "deceased"] } },
    select: { id: true, firstName: true, lastName: true },
  });
  if (!target) throw notFound("Person not found.");

  const directKey = `direct:${[me, targetId].sort().join(":")}`;
  let conv = await db.chatConversation.findUnique({ where: { directKey } });
  if (!conv) {
    try {
      conv = await db.chatConversation.create({
        data: { orgId: user.orgId, type: "direct", directKey, createdById: user.membershipId },
      });
      const meRow = await db.person.findUnique({ where: { id: me }, select: { firstName: true, lastName: true } });
      await db.chatParticipant.createMany({
        data: [
          { orgId: user.orgId, conversationId: conv.id, personId: me, label: personName(meRow) },
          { orgId: user.orgId, conversationId: conv.id, personId: targetId, label: personName(target) },
        ],
      });
      await audit({
        orgId: user.orgId, actor: user, action: "chat.conversation.create",
        entityType: "chat_conversation", entityId: conv.id, after: { type: "direct" },
      });
    } catch (err) {
      // lost a create race — reuse the winner's row
      conv = await db.chatConversation.findUnique({ where: { directKey } });
      if (!conv) throw err;
    }
  } else {
    await db.chatParticipant.updateMany({
      where: { conversationId: conv.id, personId: me },
      data: { leftAt: null },
    });
  }
  return conversationItem(user, conv.id);
}

export async function createGroup(user: SessionUser, input: { groupId?: string; title?: string }) {
  const me = requireChatProfile(user);
  const groupId = String(input?.groupId ?? "");
  if (!groupId) throw badRequest("groupId is required.");

  const group = await db.group.findFirst({
    where: { id: groupId, orgId: user.orgId, deletedAt: null, status: "active" },
  });
  if (!group) throw notFound("Group not found.");

  const myMembership = await db.groupMember.findFirst({
    where: { groupId: group.id, personId: me, status: "active" },
  });
  if (!myMembership) throw forbidden("You can only open chats for groups you belong to.");

  let conv = await db.chatConversation.findFirst({
    where: { orgId: user.orgId, groupId: group.id, type: "group" },
  });
  if (!conv) {
    conv = await db.chatConversation.create({
      data: {
        orgId: user.orgId, type: "group", groupId: group.id,
        title: input?.title?.trim() || group.name, createdById: user.membershipId,
      },
    });
    const members = await db.groupMember.findMany({
      where: { groupId: group.id, status: "active" },
      select: { personId: true, person: { select: { firstName: true, lastName: true } } },
    });
    await db.chatParticipant.createMany({
      data: members.map((m) => ({
        orgId: user.orgId, conversationId: conv!.id, personId: m.personId, label: personName(m.person),
      })),
    });
    await audit({
      orgId: user.orgId, actor: user, action: "chat.conversation.create",
      entityType: "chat_conversation", entityId: conv.id, after: { type: "group", groupId: group.id },
    });
  } else {
    await db.chatParticipant.updateMany({
      where: { conversationId: conv.id, personId: me },
      data: { leftAt: null },
    });
  }
  return conversationItem(user, conv.id);
}

/* ───────────────────────────── messages ───────────────────────────── */

export async function listMessages(
  user: SessionUser,
  conversationId: string,
  q: { before?: string; limit?: string },
) {
  const me = requireChatProfile(user);
  const conv = await assertAccess(user, conversationId);

  const take = Math.min(Math.max(parseInt(q.limit ?? "", 10) || DEFAULT_PAGE, 1), 100);
  let before: Date | undefined;
  if (q.before) {
    const d = new Date(q.before);
    if (isNaN(d.getTime())) throw badRequest("before must be a valid ISO date.");
    before = d;
  }

  const rows = await db.chatMessage.findMany({
    where: {
      conversationId: conv.id, deletedAt: null,
      ...(before ? { createdAt: { lt: before } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: take + 1,
    include: { replyTo: true },
  });
  const hasMore = rows.length > take;
  const items = rows.slice(0, take).reverse().map((m) => toMessageDTO(m, me));

  // opening (or polling) the thread marks it read and tells the room
  const wasUnread = await db.chatParticipant.findFirst({
    where: { conversationId: conv.id, personId: me },
    select: { lastReadAt: true },
  });
  await db.chatParticipant.updateMany({
    where: { conversationId: conv.id, personId: me },
    data: { lastReadAt: new Date() },
  });
  if (items.length && (!wasUnread?.lastReadAt || items[items.length - 1].createdAt > wasUnread.lastReadAt)) {
    notifyChatRead(conv.id, me, user.name);
  }

  // opening the thread clears its bell notifications for this user
  await markEntityRead(user, "chat_conversation", conv.id);

  return { items, hasMore };
}

export async function sendMessage(
  user: SessionUser,
  conversationId: string,
  input: { body?: string; replyToId?: string },
) {
  const me = requireChatProfile(user);
  const conv = await assertAccess(user, conversationId);

  const text = String(input?.body ?? "").trim();
  if (!text) throw badRequest("Message cannot be empty.");
  if (text.length > MAX_BODY) throw badRequest(`Message is too long (max ${MAX_BODY} characters).`);

  // a reply must quote a live message from the SAME conversation
  let replyToId: string | undefined;
  if (input?.replyToId) {
    const target = await db.chatMessage.findFirst({
      where: { id: String(input.replyToId), conversationId: conv.id, deletedAt: null },
      select: { id: true },
    });
    if (!target) throw badRequest("The message you replied to is no longer available.");
    replyToId = target.id;
  }

  const msg = await db.chatMessage.create({
    data: {
      orgId: user.orgId,
      conversationId: conv.id,
      senderPersonId: me,
      senderUserId: user.userId,
      senderName: user.name,
      body: text,
      ...(replyToId ? { replyToId } : {}),
    },
    include: { replyTo: true },
  });
  await db.chatConversation.update({ where: { id: conv.id }, data: { updatedAt: new Date() } });
  await db.chatParticipant.updateMany({
    where: { conversationId: conv.id, personId: me },
    data: { lastReadAt: new Date() },
  });

  // church-wide sends are audited (broad-audience trace); 1:1 & group chats are not
  if (conv.type === "churchwide") {
    await audit({
      orgId: user.orgId, actor: user, action: "chat.message.churchwide",
      entityType: "chat_message", entityId: msg.id, after: { length: text.length },
    });
  }
  const dto = toMessageDTO(msg, me);
  notifyChatMessage(conv.id, dto); // server-driven fan-out to the room

  // bell notifications for everyone else in the room (pull-based inbox)
  try {
    const others = await db.chatParticipant.findMany({
      where: { conversationId: conv.id, leftAt: null, personId: { not: me } },
      select: { personId: true },
    });
    const userIds = await userIdsForPersons(user.orgId, others.map((o) => o.personId));
    if (userIds.length) {
      let label = conv.title ?? "";
      if (conv.type === "group" && conv.groupId) {
        const g = await db.group.findUnique({ where: { id: conv.groupId }, select: { name: true } });
        label = g?.name ?? label;
      }
      const where = conv.type === "direct" ? "" : conv.type === "churchwide" ? " · Church-wide" : ` · ${label}`;
      await pushNotifications({
        orgId: user.orgId,
        userIds,
        module: "chat",
        type: "chat.message",
        title: `${user.name}${where}`,
        body: text.slice(0, 160),
        entityType: "chat_conversation",
        entityId: conv.id,
        linkModule: "comms",
      });
    }
  } catch {
    // notifications are best-effort — never fail the send
  }

  return dto;
}

export async function markRead(user: SessionUser, conversationId: string) {
  const me = requireChatProfile(user);
  const conv = await assertAccess(user, conversationId);
  await db.chatParticipant.updateMany({
    where: { conversationId: conv.id, personId: me },
    data: { lastReadAt: new Date() },
  });
  await markEntityRead(user, "chat_conversation", conv.id);
  notifyChatRead(conv.id, me, user.name);
  return { ok: true };
}

export async function deleteMessage(user: SessionUser, messageId: string) {
  const me = requireChatProfile(user);
  const msg = await db.chatMessage.findFirst({
    where: { id: messageId, orgId: user.orgId, deletedAt: null },
  });
  if (!msg) throw notFound("Message not found.");
  const conv = await assertAccess(user, msg.conversationId);

  const mine = msg.senderPersonId === me;
  const moderator = conv.type === "churchwide" && canChurchwide(user);
  if (!mine && !moderator) throw forbidden("You can only delete your own messages.");

  await db.chatMessage.update({ where: { id: msg.id }, data: { deletedAt: new Date() } });
  notifyChatDelete(msg.conversationId, msg.id);
  if (moderator && !mine) {
    await audit({
      orgId: user.orgId, actor: user, action: "chat.message.moderate_delete",
      entityType: "chat_message", entityId: msg.id, after: { sender: msg.senderName },
    });
  }
  return { ok: true };
}

/* ───────────────────── directory (who can I chat with?) ───────────────────── */

export async function directory(user: SessionUser, search?: string) {
  const me = requireChatProfile(user);
  const s = search?.trim();
  const people = await db.person.findMany({
    where: {
      orgId: user.orgId,
      id: { not: me },
      deletedAt: null,
      status: { notIn: ["archived", "deceased"] },
      ...(s ? { OR: [{ firstName: { contains: s } }, { lastName: { contains: s } }, { email: { contains: s } }] } : {}),
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: 30,
    select: { id: true, firstName: true, lastName: true, preferredName: true, email: true, lifecycleStage: true },
  });
  const withPortal = people.length
    ? new Set(
        (
          await db.membership.findMany({
            where: { orgId: user.orgId, status: "active", personId: { in: people.map((p) => p.id) } },
            select: { personId: true },
          })
        ).map((m) => m.personId),
      )
    : new Set<string>();
  return {
    items: people.map((p) => ({
      id: p.id,
      name: personName(p),
      preferredName: p.preferredName,
      email: p.email,
      stage: p.lifecycleStage,
      hasPortalAccess: withPortal.has(p.id),
    })),
  };
}

export async function myGroups(user: SessionUser) {
  const me = requireChatProfile(user);
  const rows = await db.groupMember.findMany({
    where: {
      orgId: user.orgId, personId: me, status: "active",
      group: { status: "active", deletedAt: null },
    },
    select: { role: true, group: { select: { id: true, name: true, type: true } } },
  });
  const ids = rows.map((r) => r.group.id);
  const counts = ids.length
    ? await db.groupMember.groupBy({
        by: ["groupId"],
        where: { groupId: { in: ids }, status: "active" },
        _count: true,
      })
    : [];
  const countMap = new Map(counts.map((c) => [c.groupId, c._count]));
  return {
    items: rows
      .map((r) => ({
        id: r.group.id, name: r.group.name, type: r.group.type,
        myRole: r.role, memberCount: countMap.get(r.group.id) ?? 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/* ─────────────────── socket-service support endpoints ─────────────────── */

/** Identity for the chat websocket handshake (validated against the session). */
export async function whoami(user: SessionUser) {
  return {
    userId: user.userId,
    personId: user.personId,
    membershipId: user.membershipId,
    orgId: user.orgId,
    name: user.name,
    canChat: can(user, "comms.chat.use") && !!user.personId,
    churchwide: can(user, "comms.chat.churchwide"),
  };
}

/** Which of the given conversations may this session access? (room-join guard) */
export async function accessCheck(user: SessionUser, input: { ids?: unknown }) {
  const ids = Array.isArray(input?.ids) ? input.ids.map(String).slice(0, 100) : [];
  const allowed: string[] = [];
  for (const id of ids) {
    try {
      await assertAccess(user, id);
      allowed.push(id);
    } catch {
      // not accessible — excluded
    }
  }
  return { allowed };
}
