"use client";

/**
 * Module registry — single source of truth for navigation + access.
 * Access is permission-based (not role-based): a module appears when the
 * user's effective permissions include the module's permission. This is what
 * makes custom roles created in Administration work end-to-end. The server
 * still enforces every permission — this only shapes navigation.
 */
import { canDo, type SessionUser } from "@/lib/types";
import type { ModuleProps } from "@/components/app/shared";
import {
  LayoutDashboard, Users, UsersRound, ScanLine, CalendarDays, HandCoins,
  Megaphone, HandHeart, HeartHandshake, Workflow, BarChart3, Settings, UserRound,
  type LucideIcon,
} from "lucide-react";

import DashboardModule from "@/components/app/modules/dashboard-module";
import PeopleModule from "@/components/app/modules/people-module";
import GroupsModule from "@/components/app/modules/groups-module";
import CheckinModule from "@/components/app/modules/checkin-module";
import EventsModule from "@/components/app/modules/events-module";
import GivingModule from "@/components/app/modules/giving-module";
import CommsModule from "@/components/app/modules/comms-module";
import VolunteersModule from "@/components/app/modules/volunteers-module";
import CareModule from "@/components/app/modules/care-module";
import WorkflowsModule from "@/components/app/modules/workflows-module";
import ReportsModule from "@/components/app/modules/reports-module";
import AdminModule from "@/components/app/modules/admin-module";
import PortalModule from "@/components/app/modules/portal-module";

export interface ModuleDef {
  key: string;
  label: string;
  icon: LucideIcon;
  /** Required permission (wildcard-aware). A string OR a list (any-of) to see the module in nav. */
  permission: string | string[];
  component: React.ComponentType<ModuleProps>;
  group: "overview" | "ministry" | "finance" | "system";
}

export const MODULES: ModuleDef[] = [
  { key: "dashboard", label: "This Week", icon: LayoutDashboard, permission: "reports.view", component: DashboardModule, group: "overview" },
  { key: "people", label: "People", icon: Users, permission: "people.view", component: PeopleModule, group: "ministry" },
  { key: "groups", label: "Groups", icon: UsersRound, permission: "groups.view", component: GroupsModule, group: "ministry" },
  { key: "checkin", label: "Check-in", icon: ScanLine, permission: "checkin.view", component: CheckinModule, group: "ministry" },
  { key: "events", label: "Events", icon: CalendarDays, permission: "events.view", component: EventsModule, group: "ministry" },
  { key: "volunteers", label: "Volunteers", icon: HandHeart, permission: "schedule.view", component: VolunteersModule, group: "ministry" },
  { key: "care", label: "Care", icon: HeartHandshake, permission: "care.view", component: CareModule, group: "ministry" },
  // Members (giving.view.own / giving.give) get the self-service portal;
  // finance/admin (giving.view.all) get the full ledger — resolved inside the module.
  { key: "giving", label: "Giving", icon: HandCoins, permission: ["giving.view.all", "giving.view.own", "giving.give"], component: GivingModule, group: "finance" },
  { key: "comms", label: "Communications", icon: Megaphone, permission: ["comms.view", "comms.chat.use"], component: CommsModule, group: "finance" },
  { key: "reports", label: "Reports", icon: BarChart3, permission: "reports.view", component: ReportsModule, group: "finance" },
  { key: "workflows", label: "Workflows", icon: Workflow, permission: "workflows.view", component: WorkflowsModule, group: "system" },
  { key: "admin", label: "Administration", icon: Settings, permission: "admin.view", component: AdminModule, group: "system" },
  { key: "portal", label: "My Portal", icon: UserRound, permission: "portal.use", component: PortalModule, group: "system" },
];

function canSee(user: SessionUser, permission: ModuleDef["permission"]): boolean {
  return Array.isArray(permission) ? permission.some((p) => canDo(user, p)) : canDo(user, permission);
}

export function modulesFor(user: SessionUser): ModuleDef[] {
  return MODULES.filter((m) => canSee(user, m.permission));
}

export const GROUP_LABELS: Record<ModuleDef["group"], string> = {
  overview: "Overview",
  ministry: "Ministry",
  finance: "Finance & Outreach",
  system: "System",
};
