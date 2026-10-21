// ChurchOS — navigation configuration. Shared between the app shell and permission checks.
import type { Module } from '@/lib/permissions'
import {
  LayoutDashboard, Users, Network, CalendarCheck, UserPlus, CalendarDays,
  Wallet, Megaphone, HeartHandshake, ListChecks, Package, FileText, BarChart3,
  Settings, ShieldCheck, Search, KeyRound, Cake, MessageSquare,
} from 'lucide-react'

export interface NavItem {
  id: Module
  label: string
  icon: typeof LayoutDashboard
  description: string
}

export const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, description: 'Church operations overview' },
  { id: 'members', label: 'Members', icon: Users, description: 'Membership CRM registry' },
  { id: 'departments', label: 'Departments', icon: Network, description: 'Departments, units & teams' },
  { id: 'attendance', label: 'Attendance', icon: CalendarCheck, description: 'Services & attendance' },
  { id: 'visitors', label: 'Visitors', icon: UserPlus, description: 'Visitors & follow-up' },
  { id: 'events', label: 'Events', icon: CalendarDays, description: 'Church calendar' },
  { id: 'finance', label: 'Finance', icon: Wallet, description: 'Giving & expenses' },
  { id: 'announcements', label: 'Announcements', icon: Megaphone, description: 'Notices & broadcasts' },
  { id: 'pastoral', label: 'Pastoral Care', icon: HeartHandshake, description: 'Care & welfare cases' },
  { id: 'tasks', label: 'Tasks', icon: ListChecks, description: 'Tasks & approvals' },
  { id: 'assets', label: 'Assets', icon: Package, description: 'Assets & facilities' },
  { id: 'documents', label: 'Documents', icon: FileText, description: 'Document library' },
  { id: 'reports', label: 'Reports', icon: BarChart3, description: 'Analytics & exports' },
  { id: 'celebrations', label: 'Celebrations', icon: Cake, description: 'Birthdays & wedding anniversaries' },
  { id: 'townhall', label: 'Town Hall', icon: MessageSquare, description: 'Member community chat' },
  { id: 'audit', label: 'Audit Log', icon: ShieldCheck, description: 'System audit trail' },
  { id: 'access', label: 'Access Control', icon: KeyRound, description: 'View permission matrix & role assignments' },
  { id: 'settings', label: 'Settings', icon: Settings, description: 'Church configuration' },
]

export const SEARCH_ITEM: NavItem = {
  id: 'search', label: 'Search', icon: Search, description: 'Global permission-aware search',
}
