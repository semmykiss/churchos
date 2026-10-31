"use client";

/**
 * WhatsApp Inbox — two-pane conversation view (list + thread). Free-form
 * replies are allowed only inside Meta's 24-hour customer-service window;
 * outside it the composer swaps to an approved-template picker. Unknown
 * numbers can be linked to a church person record inline.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, qs } from "@/lib/api";
import { fmtDateShort, fmtTime, type PersonListItem } from "@/lib/types";
import { cn } from "@/lib/utils";
import { EmptyState, ErrorBlock, LoadingBlock, useApiQuery, type ModuleProps } from "@/components/app/shared";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { ArrowLeft, MessageCircle, Search, Send, UserRoundPlus } from "lucide-react";
import type { WaConversation, WaConversationsResp, WaTemplate, WaTemplatesResp, WaThreadResp } from "@/components/app/whatsapp/WhatsAppModule";

/* ───────────────────────── helpers ───────────────────────── */

function timeAgo(iso?: string | null): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return fmtDateShort(iso);
}

function displayNameOf(c: { personName: string | null; displayName: string | null; phoneNumber: string }): string {
  return c.personName || c.displayName || c.phoneNumber;
}

function avatarText(label: string): string {
  const letters = label.replace(/[^a-zA-Z ]/g, " ").trim();
  if (letters) {
    return letters
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join("");
  }
  const digits = label.replace(/\D/g, "");
  return digits.slice(-2) || "?";
}

function ContactAvatar({ contact, className }: { contact: { personName: string | null; displayName: string | null; phoneNumber: string }; className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground",
        className,
      )}
    >
      {avatarText(displayNameOf(contact))}
    </div>
  );
}

function statusTick(status: string): { label: string; className: string } | null {
  switch (status) {
    case "sent":
      return { label: "✓ Sent", className: "text-white/70" };
    case "delivered":
      return { label: "✓✓ Delivered", className: "text-white/80" };
    case "read":
      return { label: "✓✓ Read", className: "text-white" };
    case "failed":
      return { label: "Failed to deliver", className: "text-red-100" };
    default:
      return null;
  }
}

function useDebounced<T>(value: T, ms = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/* ───────────────────────── tab ───────────────────────── */

export default function InboxTab({ user: _user }: ModuleProps) {
  const conversationsQ = useApiQuery<WaConversationsResp>(["whatsapp", "conversations"], "/whatsapp/conversations");
  const templatesQ = useApiQuery<WaTemplatesResp>(["whatsapp", "templates"], "/whatsapp/templates");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const conversations = conversationsQ.data?.items ?? [];
  const approvedTemplates = useMemo(
    () => (templatesQ.data?.items ?? []).filter((t) => t.status === "approved"),
    [templatesQ.data],
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
      {/* conversation list */}
      <div
        className={cn(
          "flex flex-col overflow-hidden rounded-xl border bg-card",
          selectedId ? "hidden lg:flex" : "flex",
          "lg:h-[72vh]",
        )}
        aria-label="WhatsApp conversations"
      >
        <div className="border-b px-4 py-3">
          <h2 className="text-sm font-semibold">Conversations</h2>
          <p className="text-xs text-muted-foreground">{conversations.length} contact(s)</p>
        </div>
        <div className="scroll-slim max-h-[60vh] flex-1 overflow-y-auto lg:max-h-none">
          {conversationsQ.isLoading ? (
            <div className="space-y-2 p-3" aria-hidden>
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full rounded-lg" />
              ))}
            </div>
          ) : conversationsQ.isError ? (
            <ErrorBlock error={conversationsQ.error} />
          ) : conversations.length === 0 ? (
            <EmptyState
              icon={MessageCircle}
              title="No conversations yet"
              description="When members message your WhatsApp number, their chats appear here. Test the channel from Settings."
            />
          ) : (
            <ul className="divide-y" role="list">
              {conversations.map((c) => (
                <ConversationRow
                  key={c.id}
                  conv={c}
                  active={c.id === selectedId}
                  onClick={() => setSelectedId(c.id)}
                />
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* thread pane */}
      <div
        className={cn(
          "flex-col overflow-hidden rounded-xl border bg-card",
          selectedId ? "flex lg:h-[72vh]" : "hidden lg:flex lg:h-[72vh]",
        )}
        aria-label="WhatsApp thread"
      >
        {selectedId ? (
          <ThreadPane
            key={selectedId}
            contactId={selectedId}
            conversation={conversations.find((c) => c.id === selectedId) ?? null}
            templates={approvedTemplates}
            onBack={() => setSelectedId(null)}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <EmptyState
              icon={MessageCircle}
              title="Select a conversation"
              description="Pick a chat on the left to read the thread and reply."
            />
          </div>
        )}
      </div>
    </div>
  );
}

/* ───────────────────────── conversation row ───────────────────────── */

function ConversationRow({ conv, active, onClick }: { conv: WaConversation; active: boolean; onClick: () => void }) {
  const name = displayNameOf(conv);
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-current={active ? "true" : undefined}
        className={cn(
          "flex w-full items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/60",
          active && "bg-muted",
        )}
      >
        <ContactAvatar contact={conv} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-sm font-semibold">{name}</span>
            <span className="shrink-0 text-[11px] text-muted-foreground">{timeAgo(conv.lastMessage?.createdAt ?? conv.lastInboundAt)}</span>
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {conv.lastMessage
              ? `${conv.lastMessage.direction === "outbound" ? "You: " : ""}${conv.lastMessage.content ?? ""}`
              : conv.phoneNumber}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            {conv.withinWindow ? (
              <Badge variant="outline" className="gap-1 border-transparent bg-emerald-50 px-1.5 py-0 text-[10px] text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" aria-hidden /> Window open
              </Badge>
            ) : (
              <Badge variant="outline" className="gap-1 border-transparent bg-muted px-1.5 py-0 text-[10px] text-muted-foreground">
                <span className="h-1.5 w-1.5 rounded-full bg-stone-400" aria-hidden /> Window closed
              </Badge>
            )}
            {!conv.personId && (
              <Badge variant="outline" className="border-transparent bg-amber-100 px-1.5 py-0 text-[10px] text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                Not linked
              </Badge>
            )}
            {conv.onboardState === "awaiting_name" && (
              <Badge variant="outline" className="border-transparent bg-amber-100 px-1.5 py-0 text-[10px] text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                Awaiting name
              </Badge>
            )}
            {!conv.optedIn && (
              <Badge variant="outline" className="border-transparent bg-muted px-1.5 py-0 text-[10px] text-muted-foreground">
                Opted out
              </Badge>
            )}
          </div>
        </div>
      </button>
    </li>
  );
}

/* ───────────────────────── thread pane ───────────────────────── */

function ThreadPane({
  contactId,
  conversation,
  templates,
  onBack,
}: {
  contactId: string;
  conversation: WaConversation | null;
  templates: WaTemplate[];
  onBack: () => void;
}) {
  const qc = useQueryClient();
  const threadQ = useApiQuery<WaThreadResp>(["whatsapp", "thread", contactId], `/whatsapp/messages/${contactId}`);
  const [linkOpen, setLinkOpen] = useState(false);
  const contact = threadQ.data?.contact;
  const messages = threadQ.data?.items ?? [];

  async function refresh() {
    await qc.invalidateQueries({ queryKey: ["whatsapp"] });
  }

  return (
    <>
      {/* header */}
      <div className="flex items-center gap-2 border-b px-3 py-2.5 sm:px-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={onBack}
          aria-label="Back to conversations"
          className="h-11 w-11 lg:h-9 lg:w-9"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        {threadQ.isLoading || !contact ? (
          <div className="flex items-center gap-2 py-1" aria-hidden>
            <Skeleton className="h-9 w-9 rounded-full" />
            <Skeleton className="h-4 w-36" />
          </div>
        ) : (
          <>
            <ContactAvatar
              contact={{
                personName: conversation?.personName ?? null,
                displayName: conversation?.displayName ?? null,
                phoneNumber: contact.phoneNumber,
              }}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">
                {conversation ? displayNameOf(conversation) : contact.phoneNumber}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {contact.phoneNumber}
                {contact.personId ? " · linked to a church profile" : " · unlinked number"}
                {contact.optedIn ? "" : " · opted out"}
              </p>
            </div>
            {!contact.personId && (
              <Button variant="outline" size="sm" className="h-11 lg:h-9" onClick={() => setLinkOpen(true)}>
                <UserRoundPlus className="h-4 w-4" /> Link person
              </Button>
            )}
          </>
        )}
      </div>

      {/* messages */}
      <div className="scroll-slim flex-1 space-y-2.5 overflow-y-auto bg-muted/30 p-3 sm:p-4">
        {threadQ.isLoading ? (
          <LoadingBlock label="Loading messages…" />
        ) : threadQ.isError ? (
          <ErrorBlock error={threadQ.error} />
        ) : messages.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">No messages in this thread yet.</p>
        ) : (
          messages.map((m) => <Bubble key={m.id} message={m} />)
        )}
      </div>

      {/* composer */}
      {contact && (
        <Composer
          contact={contact}
          templates={templates}
          onSent={refresh}
        />
      )}

      <LinkPersonDialog
        contactId={contactId}
        open={linkOpen}
        onOpenChange={setLinkOpen}
        onLinked={refresh}
      />
    </>
  );
}

function Bubble({ message: m }: { message: WaThreadResp["items"][number] }) {
  const outbound = m.direction === "outbound";
  const tick = outbound ? statusTick(m.status) : null;
  return (
    <div className={cn("flex flex-col", outbound ? "items-end" : "items-start")}>
      <div
        className={cn(
          "max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm sm:max-w-[70%]",
          outbound
            ? "rounded-br-sm bg-emerald-600 text-white"
            : "rounded-bl-sm border bg-background text-foreground",
        )}
      >
        {m.content}
        {m.templateName && (
          <span
            className={cn(
              "mt-1.5 inline-block rounded px-1.5 py-0.5 text-[10px] font-medium",
              outbound ? "bg-white/15 text-white/90" : "bg-muted text-muted-foreground",
            )}
          >
            template: {m.templateName}
          </span>
        )}
      </div>
      <div className={cn("mt-0.5 flex items-center gap-2 px-1 text-[10px]", outbound ? "flex-row-reverse" : "")}>
        <span className="text-muted-foreground">{fmtTime(m.createdAt)}</span>
        {tick && <span className={tick.className}>{tick.label}</span>}
        {m.status === "failed" && m.errorReason && <span className="text-destructive">{m.errorReason}</span>}
      </div>
    </div>
  );
}

/* ───────────────────────── composer ───────────────────────── */

function Composer({
  contact,
  templates,
  onSent,
}: {
  contact: WaThreadResp["contact"];
  templates: WaTemplate[];
  onSent: () => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [templateId, setTemplateId] = useState<string>("");
  const [busy, setBusy] = useState(false);

  async function sendFreeForm() {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      await api.post("/whatsapp/send", { contactId: contact.id, text: text.trim() });
      toast.success("Message sent.");
      setText("");
      await onSent();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sending failed.");
    } finally {
      setBusy(false);
    }
  }

  async function sendTemplate() {
    if (!templateId || busy) return;
    setBusy(true);
    try {
      await api.post("/whatsapp/send", { contactId: contact.id, templateId });
      toast.success("Template message sent.");
      setTemplateId("");
      await onSent();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sending failed.");
    } finally {
      setBusy(false);
    }
  }

  if (!contact.optedIn) {
    return (
      <div className="border-t p-3 sm:p-4">
        <Alert>
          <AlertDescription className="text-sm">
            This contact has opted out of WhatsApp — replies are blocked until they text START.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!contact.withinWindow) {
    return (
      <div className="space-y-3 border-t p-3 sm:p-4">
        <Alert className="border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <AlertDescription className="text-sm">
            24-hour window closed — free-form replies are blocked by Meta policy. Use an approved template.
          </AlertDescription>
        </Alert>
        {templates.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No approved templates yet — create and approve one in the Templates tab.
          </p>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="wa-template-pick">Approved template</Label>
              <Select value={templateId} onValueChange={setTemplateId}>
                <SelectTrigger id="wa-template-pick" className="w-full">
                  <SelectValue placeholder="Choose a template…" />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name} ({t.category})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={sendTemplate} disabled={!templateId || busy} className="h-11 lg:h-10">
              <Send className="h-4 w-4" /> {busy ? "Sending…" : "Send template"}
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-end gap-2 border-t p-3 sm:p-4">
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Type a reply…"
        aria-label="Reply message"
        className="min-h-[44px] flex-1 resize-none"
        rows={1}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void sendFreeForm();
          }
        }}
      />
      <Button onClick={sendFreeForm} disabled={!text.trim() || busy} className="h-11 lg:h-10" aria-label="Send reply">
        <Send className="h-4 w-4" />
        <span className="sr-only lg:not-sr-only lg:ml-1.5">Send</span>
      </Button>
    </div>
  );
}

/* ───────────────────────── link person dialog ───────────────────────── */

function LinkPersonDialog({
  contactId,
  open,
  onOpenChange,
  onLinked,
}: {
  contactId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLinked: () => Promise<void>;
}) {
  const [search, setSearch] = useState("");
  const q = useDebounced(search);
  const [busyId, setBusyId] = useState<string | null>(null);

  const peopleQ = useApiQuery<{ items: PersonListItem[] }>(
    ["whatsapp", "people-search", q],
    `/people${qs({ search: q, page: 1, pageSize: 10 })}`,
    { enabled: open && q.trim().length >= 2 },
  );
  const people = peopleQ.data?.items ?? [];

  async function link(personId: string) {
    setBusyId(personId);
    try {
      await api.post(`/whatsapp/contacts/${contactId}/link`, { personId });
      toast.success("Contact linked to their church profile.");
      onOpenChange(false);
      setSearch("");
      await onLinked();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Linking failed.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Link person</DialogTitle>
          <DialogDescription>
            Match this WhatsApp number to a church profile so engagement lands on their record.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search people by name, email or phone…"
              className="pl-8"
              aria-label="Search people"
            />
          </div>
          <div className="scroll-slim max-h-64 min-h-24 overflow-y-auto rounded-lg border">
            {q.trim().length < 2 ? (
              <p className="p-4 text-sm text-muted-foreground">Type at least 2 characters to search.</p>
            ) : peopleQ.isLoading ? (
              <div className="space-y-2 p-3" aria-hidden>
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : people.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">No people match “{q}”.</p>
            ) : (
              <ul className="divide-y" role="list">
                {people.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => void link(p.id)}
                      disabled={busyId !== null}
                      className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left transition-colors hover:bg-muted/60 disabled:opacity-50"
                    >
                      <span className="text-sm font-medium">
                        {p.firstName} {p.lastName}
                      </span>
                      <span className="text-xs text-muted-foreground">{p.phone ?? "no phone"}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" className="h-11 lg:h-9" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
