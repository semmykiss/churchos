# ChurchOS — Enterprise Database Architecture

## Overview

ChurchOS uses an **enterprise-grade data access architecture** based on the **Repository Pattern** — the standard approach used by production SaaS applications like Stripe, Linear, and Notion.

## Why NOT Separate Databases Per Module

Enterprise SaaS apps do **NOT** use separate databases per module. Here's why:

1. **Cross-module relations**: A Member has donations, attendance, pastoral cases, household relationships, tithes, and task assignments. Splitting databases would break all foreign keys.
2. **Transaction integrity**: Creating a member with a login account, adding them to a department, and recording their first tithe must be atomic — impossible across databases.
3. **Query complexity**: Cross-database joins require complex application-level orchestration, increasing latency and bug risk.
4. **Operational overhead**: Multiple databases mean multiple connection pools, migrations, backups, and monitoring points.

## What Enterprise SaaS Apps Actually Do

| Pattern | Description | ChurchOS Implementation |
|---|---|---|
| **Single database, tenant-scoped** | One DB with `organizationId` on every table | ✅ Every model has `organizationId` |
| **Repository pattern** | Each module has its own data access layer | ✅ 8 repository files in `src/lib/repositories/` |
| **Schema documentation** | Models grouped into logical domains | ✅ `src/lib/schema-map.ts` with 13 domains |
| **Connection pooling** | Singleton DB client | ✅ `src/lib/db.ts` (Prisma singleton) |
| **Server-side authorization** | Every query checked for permissions | ✅ `requirePermission()` → `canAsync()` |
| **Tenant isolation** | All queries scoped by org | ✅ Every repo method takes `orgId` as first param |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     API Route Layer                          │
│  (HTTP parsing, auth, validation, response formatting)      │
│  src/app/api/*/route.ts                                     │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                   Repository Layer                           │
│  (Data access, queries, filters, relations)                 │
│  src/lib/repositories/*.repository.ts                       │
│                                                              │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────────┐       │
│  │ MembersRepo │ │ FinanceRepo │ │ AttendanceRepo  │       │
│  ├─────────────┤ ├─────────────┤ ├─────────────────┤       │
│  │ EventsRepo  │ │ TasksRepo   │ │ PastoralRepo    │       │
│  ├─────────────┤ ├─────────────┤ ├─────────────────┤       │
│  │ ChatRepo    │ │ IdentityRepo│ │                 │       │
│  └─────────────┘ └─────────────┘ └─────────────────┘       │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                    Prisma Client (Singleton)                 │
│  src/lib/db.ts — single connection, pooled                  │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                    SQLite Database                           │
│  49 models across 13 logical domains                        │
│  All tenant-scoped via organizationId                       │
└─────────────────────────────────────────────────────────────┘
```

## Schema Domains (13 logical groups)

| Domain | Models | Repository |
|---|---|---|
| **Identity & Access** | Organization, User, Role, RolePermission, UserRoleAssignment, FieldPermission, AccessGrant, ApprovalPolicy, AccessReview, Branch | `IdentityRepo` |
| **Membership** | Member, MemberStatusHistory, Household, Relationship, Dependant | `MembersRepo` |
| **Organization** | Department, DepartmentMembership, Unit | (in MembersRepo) |
| **Attendance** | Service, AttendanceSession, AttendanceRecord | `AttendanceRepo` |
| **Visitors** | Visitor, FollowUpTask, FollowUpInteraction | (in MembersRepo) |
| **Events** | Event, Registration | `EventsRepo` |
| **Finance** | Fund, Donation, Expense, Budget, Tithe, Approval, Payment, Invoice, Subscription | `FinanceRepo` |
| **Communications** | Announcement, Notification | `IdentityRepo` |
| **Pastoral Care** | PastoralCase, PrayerRequest | `PastoralRepo` |
| **Tasks** | Task, TaskComment, Meeting | `TasksRepo` |
| **Assets** | Asset, Booking | (direct Prisma) |
| **Documents** | Document | (direct Prisma) |
| **Chat** | ChatRoom, ChatMessage | `ChatRepo` |
| **Platform** | Plan, PartnerAudit, TenantStatusHistory, Setting, ImportJob, AuditLog | (direct Prisma) |

## Repository Usage

```typescript
// In an API route:
import { MembersRepo, FinanceRepo } from '@/lib/repositories'

// List members with filters
const { items, total } = await MembersRepo.list(orgId, {
  q: 'John', status: 'active', departmentId: 'dept-worship', page: 1
})

// Get finance overview
const overview = await FinanceRepo.overview(orgId)

// Create a tithe
const tithe = await FinanceRepo.createTithe(orgId, {
  memberId, amount: 5000, method: 'cash', titheMonth: new Date()
})
```

## Migration to PostgreSQL (Production)

When deploying to production:

1. Change `datasource` in `prisma/schema.prisma` from `sqlite` to `postgresql`
2. Enable **Row-Level Security (RLS)** on all tenant-owned tables:
   ```sql
   ALTER TABLE members ENABLE ROW LEVEL SECURITY;
   CREATE POLICY tenant_isolation ON members
     USING (organization_id = current_setting('app.org_id')::text);
   ```
3. Use connection pooling (PgBouncer or Prisma Accelerate)
4. Set up read replicas for reporting queries
5. The repository layer remains unchanged — only the DB engine changes

## Files

| File | Purpose |
|---|---|
| `src/lib/schema-map.ts` | Documents all 49 models across 13 domains |
| `src/lib/repositories/index.ts` | Exports all 8 repositories |
| `src/lib/repositories/members.repository.ts` | Member CRUD + stats + celebrations |
| `src/lib/repositories/finance.repository.ts` | Funds, donations, tithes, expenses, budgets, overview |
| `src/lib/repositories/attendance.repository.ts` | Services, sessions, check-in, stats |
| `src/lib/repositories/events.repository.ts` | Events, registrations |
| `src/lib/repositories/tasks.repository.ts` | Tasks, subtasks, comments, stats |
| `src/lib/repositories/chat.repository.ts` | Chat rooms, messages |
| `src/lib/repositories/pastoral.repository.ts` | Cases, prayer requests |
| `src/lib/repositories/identity.repository.ts` | Users, roles, assignments, notifications |
| `src/lib/db.ts` | Singleton Prisma client (connection pool) |
