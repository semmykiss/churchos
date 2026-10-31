"use client";

/**
 * WhatsApp module — two-way member engagement: the shared inbox, opt-in
 * broadcast sending, conversation flows and Meta-gated templates.
 * This shell renders the header + connection badge + tab navigation;
 * every tab owns its own data fetching.
 */
import { useApiQuery, type ModuleProps } from "@/components/app/shared";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileText, Inbox, Megaphone, Settings, Workflow } from "lucide-react";
import InboxTab from "@/components/app/whatsapp/InboxTab";
import BroadcastsTab from "@/components/app/whatsapp/BroadcastsTab";
import FlowsTab from "@/components/app/whatsapp/FlowsTab";
import TemplatesTab from "@/components/app/whatsapp/TemplatesTab";
import WhatsAppSettingsTab from "@/components/app/whatsapp/WhatsAppSettingsTab";

/* ───────────────────────── API shapes (shared by the tabs) ───────────────────────── */

export interface WaOverview {
  connected: boolean;
  provider: string | null;
  displayPhoneNumber: string | null;
  accountStatus: string | null;
  contacts: number;
  optedOut: number;
  messages24h: number;
  followups: number;
  approvedTemplates: number;
  activeFlows: number;
}

export interface WaContactFields {
  id: string;
  phoneNumber: string;
  displayName: string | null;
  personId: string | null;
  personName: string | null;
  optedIn: boolean;
  onboardState: string | null;
  withinWindow: boolean;
  lastInboundAt: string | null;
  createdAt: string;
}

export type WaContactRow = WaContactFields;

export interface WaContactsResp {
  items: WaContactRow[];
}

export interface WaLastMessage {
  direction: string;
  content: string | null;
  status: string;
  messageType: string;
  createdAt: string;
}

export interface WaConversation extends WaContactFields {
  lastMessage: WaLastMessage | null;
}

export interface WaConversationsResp {
  items: WaConversation[];
}

/** Thread pane contact — the server returns a narrower shape here. */
export interface WaThreadContact {
  id: string;
  phoneNumber: string;
  personId: string | null;
  optedIn: boolean;
  withinWindow: boolean;
  lastInboundAt: string | null;
}

export interface WaMessage {
  id: string;
  direction: string;
  messageType: string;
  content: string;
  templateName: string | null;
  status: string;
  errorReason?: string | null;
  createdAt: string;
}

export interface WaThreadResp {
  contact: WaThreadContact;
  items: WaMessage[];
}

export interface WaTemplate {
  id: string;
  name: string;
  language: string;
  category: string;
  body: string;
  variables: string[];
  status: string;
  statusInfo: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WaTemplatesResp {
  items: WaTemplate[];
}

export interface WaAudience {
  stage?: string[];
  groupIds?: string[];
  tagIds?: string[];
}

export interface WaBroadcast {
  id: string;
  name: string;
  templateId: string | null;
  templateName: string | null;
  audience: WaAudience;
  scheduledAt: string | null;
  status: string;
  sentCount: number;
  failedCount: number;
  skippedCount: number;
  createdByName: string | null;
  sentAt: string | null;
  createdAt: string;
}

export interface WaBroadcastsResp {
  items: WaBroadcast[];
}

export interface WaFlowStep {
  kind: "message" | "template" | "question" | "rsvp" | "give_link" | "assign_followup";
  text?: string;
  templateName?: string;
  vars?: string[];
  delayHours?: number;
  key?: string;
  choices?: string[];
  eventId?: string;
  fundCode?: string;
  introText?: string;
  note?: string;
  assigneeMembershipId?: string;
}

export interface WaFlow {
  id: string;
  name: string;
  description: string | null;
  triggerType: string;
  eventId: string | null;
  steps: WaFlowStep[];
  isActive: boolean;
  runCount: number;
  createdAt: string;
}

export interface WaFlowsResp {
  items: WaFlow[];
}

export interface WaRun {
  id: string;
  flowName: string;
  status: string;
  needsHuman: boolean;
  currentStep: number;
  context: Record<string, string>;
  contactId: string;
  personName: string;
  phoneNumber: string | null;
  nextStepAt: string | null;
  startedAt: string;
  lastActivityAt: string;
}

export interface WaRunsResp {
  items: WaRun[];
}

export interface WaAccount {
  id: string;
  provider: string;
  phoneNumberId: string;
  displayPhoneNumber: string | null;
  businessAccountId: string | null;
  status: string;
  tokenMasked: string | null;
  hasToken: boolean;
  webhookVerifyToken: string;
  webhookUrl: string;
  lastError: string | null;
  createdAt: string;
}

export interface WaAccountsResp {
  items: WaAccount[];
}

export interface WaAudiencePreviewResp {
  count: number;
  sample: { name: string; stage: string }[];
}

/* ───────────────────────── module shell ───────────────────────── */

export default function WhatsAppModule({ user }: ModuleProps) {
  const overviewQ = useApiQuery<WaOverview>(["whatsapp", "overview"], "/whatsapp/overview");
  const ov = overviewQ.data;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">WhatsApp</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Two-way member engagement — inbox, broadcasts, flows and templates.
          </p>
        </div>
        <div>
          {overviewQ.isLoading ? (
            <Skeleton className="h-6 w-36 rounded-full" aria-hidden />
          ) : ov?.connected ? (
            <Badge
              aria-label="WhatsApp connection status: connected"
              className="border-transparent bg-emerald-100 font-medium text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
            >
              Connected{ov.provider ? ` · ${ov.provider}` : ""}
            </Badge>
          ) : (
            <Badge
              aria-label="WhatsApp connection status: not connected"
              className="border-transparent bg-amber-100 font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200"
            >
              Not connected
            </Badge>
          )}
        </div>
      </div>

      <Tabs defaultValue="inbox">
        <TabsList className="max-w-full overflow-x-auto">
          <TabsTrigger value="inbox" className="gap-1.5">
            <Inbox className="h-4 w-4" /> Inbox
          </TabsTrigger>
          <TabsTrigger value="broadcasts" className="gap-1.5">
            <Megaphone className="h-4 w-4" /> Broadcasts
          </TabsTrigger>
          <TabsTrigger value="flows" className="gap-1.5">
            <Workflow className="h-4 w-4" /> Flows
          </TabsTrigger>
          <TabsTrigger value="templates" className="gap-1.5">
            <FileText className="h-4 w-4" /> Templates
          </TabsTrigger>
          <TabsTrigger value="settings" className="gap-1.5">
            <Settings className="h-4 w-4" /> Settings
          </TabsTrigger>
        </TabsList>
        <TabsContent value="inbox" className="mt-4">
          <InboxTab user={user} />
        </TabsContent>
        <TabsContent value="broadcasts" className="mt-4">
          <BroadcastsTab user={user} />
        </TabsContent>
        <TabsContent value="flows" className="mt-4">
          <FlowsTab user={user} />
        </TabsContent>
        <TabsContent value="templates" className="mt-4">
          <TemplatesTab user={user} />
        </TabsContent>
        <TabsContent value="settings" className="mt-4">
          <WhatsAppSettingsTab user={user} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
