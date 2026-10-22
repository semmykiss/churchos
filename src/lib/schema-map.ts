// ChurchOS — Database schema map.
// Documents the logical separation of the 49-model schema into module domains.
// Each domain has a corresponding repository file in src/lib/repositories/.

export const SCHEMA_MAP = {
  // === IDENTITY & ACCESS ===
  identity: {
    description: 'Organizations, users, roles, permissions, access control',
    models: ['Organization', 'User', 'Role', 'RolePermission', 'UserRoleAssignment', 'FieldPermission', 'AccessGrant', 'ApprovalPolicy', 'AccessReview', 'Branch'],
  },
  // === MEMBERSHIP ===
  membership: {
    description: 'Members, households, relationships, dependants, status history',
    models: ['Member', 'MemberStatusHistory', 'Household', 'Relationship', 'Dependant'],
  },
  // === ORGANIZATION ===
  organization: {
    description: 'Departments, units, teams, memberships',
    models: ['Department', 'DepartmentMembership', 'Unit'],
  },
  // === ATTENDANCE ===
  attendance: {
    description: 'Services, sessions, check-in records',
    models: ['Service', 'AttendanceSession', 'AttendanceRecord'],
  },
  // === VISITORS & FOLLOWUP ===
  visitors: {
    description: 'Visitor registration, follow-up tasks, interactions',
    models: ['Visitor', 'FollowUpTask', 'FollowUpInteraction'],
  },
  // === EVENTS ===
  events: {
    description: 'Church calendar, registrations, event attendance',
    models: ['Event', 'Registration'],
  },
  // === FINANCE ===
  finance: {
    description: 'Funds, donations, expenses, budgets, tithes, approvals',
    models: ['Fund', 'Donation', 'Expense', 'Budget', 'Tithe', 'Approval', 'Payment', 'Invoice', 'Subscription'],
  },
  // === COMMUNICATIONS ===
  communications: {
    description: 'Announcements, notifications, in-app messages',
    models: ['Announcement', 'Notification'],
  },
  // === PASTORAL CARE ===
  pastoral: {
    description: 'Pastoral cases, prayer requests, welfare',
    models: ['PastoralCase', 'PrayerRequest'],
  },
  // === TASKS ===
  tasks: {
    description: 'Tasks, subtasks, comments, meetings',
    models: ['Task', 'TaskComment', 'Meeting'],
  },
  // === ASSETS ===
  assets: {
    description: 'Equipment, facilities, bookings, maintenance',
    models: ['Asset', 'Booking'],
  },
  // === DOCUMENTS ===
  documents: {
    description: 'Document library, file metadata, access levels',
    models: ['Document'],
  },
  // === CHAT ===
  chat: {
    description: 'Townhall rooms, messages, threaded replies',
    models: ['ChatRoom', 'ChatMessage'],
  },
  // === PLATFORM ===
  platform: {
    description: 'Plans, partner audit, tenant status history, settings, imports',
    models: ['Plan', 'PartnerAudit', 'TenantStatusHistory', 'Setting', 'ImportJob', 'AuditLog'],
  },
} as const

export type SchemaDomain = keyof typeof SCHEMA_MAP
