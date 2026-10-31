/**
 * Member-scope permission bundle for WhatsApp principals — mirrors the
 * "member" ROLE_TEMPLATE (people.view, giving.view.own, giving.give,
 * portal.use, comms.chat.use). Members without a user account get exactly
 * this over WhatsApp; staff resolve through their real membership roles.
 */
export const DEFAULT_MEMBER_PERMISSIONS = [
  "people.view",
  "giving.view.own",
  "giving.give",
  "portal.use",
  "comms.chat.use",
] as const;
