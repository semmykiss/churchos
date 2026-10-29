"use client";

/**
 * Module registry — single source of truth for navigation + access.
 * Access mirrors server MODULE_ACCESS (src/server/permissions.ts); the server
 * still enforces every permission — this only shapes navigation.
 */
import type { SessionUser } from "@/lib/types";
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
  roles: string[]; // role keys allowed to open
  component: React.ComponentType<ModuleProps>;
  group: "overview" | "ministry" | "finance" | "system";
}

export const MODULES: ModuleDef[] = [
  { key: "dashboard", label: "This Week", icon: LayoutDashboard, roles: ["owner", "campus_admin", "finance", "ministry_leader"], component: DashboardModule, group: "overview" },
  { key: "people", label: "People", icon: Users, roles: ["owner", "campus_admin", "ministry_leader", "finance"], component: PeopleModule, group: "ministry" },
  { key: "groups", label: "Groups", icon: UsersRound, roles: ["owner", "campus_admin", "ministry_leader"], component: GroupsModule, group: "ministry" },
  { key: "checkin", label: "Check-in", icon: ScanLine, roles: ["owner", "campus_admin", "volunteer"], component: CheckinModule, group: "ministry" },
  { key: "events", label: "Events", icon: CalendarDays, roles: ["owner", "campus_admin", "ministry_leader"], component: EventsModule, group: "ministry" },
  { key: "volunteers", label: "Volunteers", icon: HandHeart, roles: ["owner", "campus_admin", "volunteer"], component: VolunteersModule, group: "ministry" },
  { key: "care", label: "Care", icon: HeartHandshake, roles: ["owner", "campus_admin", "ministry_leader"], component: CareModule, group: "ministry" },
  { key: "giving", label: "Giving", icon: HandCoins, roles: ["owner", "finance"], component: GivingModule, group: "finance" },
  { key: "comms", label: "Communications", icon: Megaphone, roles: ["owner", "campus_admin", "ministry_leader"], component: CommsModule, group: "finance" },
  { key: "reports", label: "Reports", icon: BarChart3, roles: ["owner", "campus_admin", "finance", "ministry_leader"], component: ReportsModule, group: "finance" },
  { key: "workflows", label: "Workflows", icon: Workflow, roles: ["owner", "campus_admin"], component: WorkflowsModule, group: "system" },
  { key: "admin", label: "Administration", icon: Settings, roles: ["owner", "campus_admin", "finance"], component: AdminModule, group: "system" },
  { key: "portal", label: "My Portal", icon: UserRound, roles: ["owner", "campus_admin", "finance", "ministry_leader", "volunteer", "member"], component: PortalModule, group: "system" },
];

export function modulesFor(user: SessionUser): ModuleDef[] {
  return MODULES.filter((m) => m.roles.some((r) => user.roleKeys.includes(r)));
}

export const GROUP_LABELS: Record<ModuleDef["group"], string> = {
  overview: "Overview",
  ministry: "Ministry",
  finance: "Finance & Outreach",
  system: "System",
};
