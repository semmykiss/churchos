"use client";

/**
 * Communications module — Messages (history + detail), New message (audience
 * builder with live consent-aware segment preview, SMS quiet-hours guard),
 * and the Consent ledger (append-only preference toggles).
 */
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError, qs } from "@/lib/api";
import {
  LIFECYCLE_STAGES,
  STAGE_LABELS,
  fmtDateTime,
  fmtMoney,
  type GroupDTO,
  type MessageDTO,
} from "@/lib/types";
import {
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  PageHeader,
  Section,
  StatCard,
  StatusBadge,
  useApiQuery,
  type ModuleProps,
} from "@/components/app/shared";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  Clock,
  Mail,
  MessageSquare,
  Megaphone,
  Send,
  ShieldCheck,
  Users,
} from "lucide-react";

/* ───────────────────────────── API shapes ───────────────────────────── */

interface RecipientDTO {
  personId: string;
  name: string;
  address: string;
  status: string;
  sentAt: string | null;
  error: string | null;
}

interface MessageDetailResp {
  message: MessageDTO;
  recipients: RecipientDTO[];
}

interface SegmentPreviewResp {
  count: number;
  sample: { name: string }[];
}

interface ConsentPref {
  channel: string;
  category: string;
  optedIn: boolean;
  source: string;
  updatedAt: string;
}

interface ConsentItem {
  personId: string;
  name: string;
  email: string | null;
  phone: string | null;
  prefs: ConsentPref[];
}

/* ───────────────────────────── helpers ───────────────────────────── */

const CHANNEL_LABELS: Record<string, string> = { email: "Email", sms: "SMS" };

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

function smsSegments(text: string): number {
  return Math.max(1, Math.ceil(text.length / 160));
}

function isSmsQuietHours(): boolean {
  const h = new Date().getHours();
  return h < 8 || h >= 21;
}

function ChannelIcon({ channel, className }: { channel: string; className?: string }) {
  const cls = className ?? "h-4 w-4";
  return channel === "sms" ? (
    <MessageSquare className={`${cls} text-teal-700 dark:text-teal-400`} aria-label="SMS" />
  ) : (
    <Mail className={`${cls} text-amber-700 dark:text-amber-400`} aria-label="Email" />
  );
}

/* ───────────────────────────── module ───────────────────────────── */

export default function CommsModule({ user: _user }: ModuleProps) {
  const [tab, setTab] = useState("messages");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Communications"
        description="Send email and SMS to consent-respecting segments. Every send honors per-channel opt-ins and do-not-contact flags."
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="messages" className="gap-1.5">
            <Megaphone className="h-4 w-4" /> Messages
          </TabsTrigger>
          <TabsTrigger value="new" className="gap-1.5">
            <Send className="h-4 w-4" /> New message
          </TabsTrigger>
          <TabsTrigger value="consent" className="gap-1.5">
            <ShieldCheck className="h-4 w-4" /> Consent ledger
          </TabsTrigger>
        </TabsList>
        <TabsContent value="messages" className="mt-4">
          <MessagesTab />
        </TabsContent>
        <TabsContent value="new" className="mt-4">
          <NewMessageTab onSent={() => setTab("messages")} />
        </TabsContent>
        <TabsContent value="consent" className="mt-4">
          <ConsentTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ═════════════════════════════ MESSAGES LIST ═════════════════════════════ */

function MessagesTab() {
  const messagesQ = useApiQuery<{ items: MessageDTO[] }>(["messages"], "/messages");
  const [detailId, setDetailId] = useState<string | null>(null);
  const messages = messagesQ.data?.items ?? [];

  return (
    <div className="space-y-4">
      {messagesQ.isLoading ? (
        <LoadingBlock label="Loading messages…" />
      ) : messagesQ.isError ? (
        <ErrorBlock error={messagesQ.error} />
      ) : messages.length === 0 ? (
        <EmptyState icon={Megaphone} title="No messages yet" description="Compose your first announcement from the New message tab." />
      ) : (
        <>
          {/* desktop */}
          <div className="hidden overflow-x-auto rounded-lg border md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Channel</TableHead>
                  <TableHead>Message</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Recipients</TableHead>
                  <TableHead>Sent / scheduled</TableHead>
                  <TableHead>Created by</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {messages.map((m) => (
                  <MessageRow key={m.id} m={m} onClick={() => setDetailId(m.id)} />
                ))}
              </TableBody>
            </Table>
          </div>

          {/* mobile */}
          <div className="space-y-3 md:hidden">
            {messages.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setDetailId(m.id)}
                className="w-full rounded-xl border p-4 text-left transition-colors hover:bg-muted/50"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="flex items-center gap-2 font-semibold">
                    <ChannelIcon channel={m.channel} /> {m.subject || CHANNEL_LABELS[m.channel] || m.channel}
                  </span>
                  <StatusBadge status={m.status} />
                </div>
                <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{m.bodyText}</p>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                  <span className="text-teal-700 dark:text-teal-400">{m.deliveredCount ?? 0} delivered</span>
                  <span className="text-destructive">{m.bouncedCount ?? 0} bounced</span>
                  <span className="text-muted-foreground">{m.scheduledAt ? `Scheduled ${fmtDateTime(m.scheduledAt)}` : m.sentAt ? fmtDateTime(m.sentAt) : "—"}</span>
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      <MessageDetailDialog id={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}

function MessageRow({ m, onClick }: { m: MessageDTO; onClick: () => void }) {
  return (
    <TableRow className="row-hover cursor-pointer" onClick={onClick}>
      <TableCell>
        <span className="flex items-center gap-2 whitespace-nowrap">
          <ChannelIcon channel={m.channel} /> {CHANNEL_LABELS[m.channel] ?? m.channel}
        </span>
      </TableCell>
      <TableCell className="max-w-72">
        <p className="truncate font-medium">{m.subject || "(no subject)"}</p>
        <p className="truncate text-xs text-muted-foreground">{m.bodyText}</p>
      </TableCell>
      <TableCell>
        <StatusBadge status={m.status} />
      </TableCell>
      <TableCell className="whitespace-nowrap text-sm">
        <span className="font-medium text-teal-700 tabular-nums dark:text-teal-400">{m.deliveredCount ?? 0}</span>
        <span className="text-muted-foreground"> delivered · </span>
        <span className="font-medium text-destructive tabular-nums">{m.bouncedCount ?? 0}</span>
        <span className="text-muted-foreground"> bounced</span>
        <span className="block text-xs text-muted-foreground">{m.recipientCount ?? 0} recipients</span>
      </TableCell>
      <TableCell className="whitespace-nowrap text-muted-foreground">
        {m.scheduledAt ? (
          <span className="flex items-center gap-1">
            <Clock className="h-3.5 w-3.5" aria-hidden /> {fmtDateTime(m.scheduledAt)}
          </span>
        ) : m.sentAt ? (
          fmtDateTime(m.sentAt)
        ) : (
          "—"
        )}
      </TableCell>
      <TableCell className="whitespace-nowrap text-muted-foreground">{m.createdByName ?? "—"}</TableCell>
    </TableRow>
  );
}

function MessageDetailDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const detailQ = useApiQuery<MessageDetailResp>(["messages", "detail", id], `/messages/${id}`, {
    enabled: !!id,
  });
  const [busy, setBusy] = useState(false);

  if (!id) return null;
  const m = detailQ.data?.message;
  const canSend = m?.status === "draft" || m?.status === "scheduled";
  const canCancel = m?.status === "scheduled";

  async function sendNow() {
    if (!id) return;
    setBusy(true);
    try {
      const dto = await api.post<MessageDTO>(`/messages/${id}/send`);
      toast.success(`Sent — ${dto.deliveredCount ?? 0} of ${dto.recipientCount ?? 0} delivered.`);
      if ((dto as MessageDTO & { warning?: string }).warning) {
        toast.warning((dto as MessageDTO & { warning?: string }).warning);
      }
      void qc.invalidateQueries({ queryKey: ["messages"] });
    } catch (err) {
      toast.error(errorMessage(err, "Could not send the message."));
    } finally {
      setBusy(false);
    }
  }

  async function cancelSchedule() {
    if (!id) return;
    setBusy(true);
    try {
      await api.post(`/messages/${id}/cancel`);
      toast.success("Scheduled send cancelled.");
      onClose();
      void qc.invalidateQueries({ queryKey: ["messages"] });
    } catch (err) {
      toast.error(errorMessage(err, "Could not cancel the scheduled message."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!id} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto scroll-slim sm:max-w-2xl">
        {detailQ.isLoading || !detailQ.data ? (
          <>
            <DialogHeader>
              <DialogTitle>Message</DialogTitle>
            </DialogHeader>
            <LoadingBlock label="Loading message…" />
          </>
        ) : detailQ.isError ? (
          <>
            <DialogHeader>
              <DialogTitle>Message</DialogTitle>
            </DialogHeader>
            <ErrorBlock error={detailQ.error} />
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                <ChannelIcon channel={detailQ.data.message.channel} />
                {detailQ.data.message.subject || `${CHANNEL_LABELS[detailQ.data.message.channel] ?? ""} message`}
                <StatusBadge status={detailQ.data.message.status} />
              </DialogTitle>
              <DialogDescription>
                {detailQ.data.message.recipientCount ?? 0} recipients ·{" "}
                {detailQ.data.message.deliveredCount ?? 0} delivered ·{" "}
                <span className="text-destructive">{detailQ.data.message.bouncedCount ?? 0} bounced</span>
                {detailQ.data.message.costCents ? ` · est. cost ${fmtMoney(detailQ.data.message.costCents)}` : ""}
                {detailQ.data.message.sentAt ? ` · sent ${fmtDateTime(detailQ.data.message.sentAt)}` : ""}
                {detailQ.data.message.scheduledAt ? ` · scheduled ${fmtDateTime(detailQ.data.message.scheduledAt)}` : ""}
              </DialogDescription>
            </DialogHeader>

            <div className="rounded-lg border p-4">
              <p className="whitespace-pre-wrap text-sm">{detailQ.data.message.bodyText}</p>
            </div>

            <Section title={`Recipients (${detailQ.data.recipients.length})`}>
              {detailQ.data.recipients.length === 0 ? (
                <EmptyState icon={Users} title="No recipients resolved" description="The segment matched nobody with the right consent." />
              ) : (
                <div className="max-h-80 overflow-y-auto scroll-slim rounded-lg border">
                  <div className="divide-y">
                    {detailQ.data.recipients.map((r) => (
                      <div key={r.personId} className="flex items-center justify-between gap-2 px-3 py-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{r.name}</p>
                          <p className="truncate text-xs text-muted-foreground">{r.address}</p>
                          {r.error ? <p className="truncate text-xs text-destructive">{r.error}</p> : null}
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span className="text-xs text-muted-foreground">{r.sentAt ? fmtDateTime(r.sentAt) : ""}</span>
                          <StatusBadge status={r.status} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Section>

            {canSend || canCancel ? (
              <DialogFooter>
                {canCancel ? (
                  <Button variant="outline" onClick={cancelSchedule} disabled={busy}>
                    Cancel schedule
                  </Button>
                ) : null}
                {canSend ? (
                  <Button onClick={sendNow} disabled={busy} className="gap-1.5">
                    <Send className="h-4 w-4" /> Send now
                  </Button>
                ) : null}
              </DialogFooter>
            ) : null}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ═════════════════════════════ NEW MESSAGE ═════════════════════════════ */

const STAGE_CHIP_STAGES = LIFECYCLE_STAGES.filter((s) => s !== "archived");

function NewMessageTab({ onSent }: { onSent: () => void }) {
  const qc = useQueryClient();
  const [channel, setChannel] = useState<"email" | "sms">("email");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [stages, setStages] = useState<string[]>([]);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [consentCategory, setConsentCategory] = useState("operational");
  const [scheduleAt, setScheduleAt] = useState("");
  const [busy, setBusy] = useState(false);

  const groupsQ = useApiQuery<{ items: GroupDTO[] }>(["groups"], "/groups");
  const groups = groupsQ.data?.items ?? [];

  // debounced segment preview
  const [previewKey, setPreviewKey] = useState({ stages: "", groupIds: "" });
  useEffect(() => {
    const t = setTimeout(() => setPreviewKey({ stages: stages.join(","), groupIds: groupIds.join(",") }), 400);
    return () => clearTimeout(t);
  }, [stages, groupIds]);

  const previewQ = useApiQuery<SegmentPreviewResp>(
    ["segments-preview", channel, previewKey.stages, previewKey.groupIds, consentCategory],
    `/segments/preview${qs({
      channel,
      stage: previewKey.stages || undefined,
      groupIds: previewKey.groupIds || undefined,
      consentCategory,
    })}`
  );
  const preview = previewQ.data;
  const quietHours = channel === "sms" && isSmsQuietHours();
  const segments = channel === "sms" ? smsSegments(body) : 0;
  const smsCost = channel === "sms" && preview ? preview.count : 0;

  function toggleStage(stage: string) {
    setStages((prev) => (prev.includes(stage) ? prev.filter((s) => s !== stage) : [...prev, stage]));
  }

  function toggleGroup(id: string) {
    setGroupIds((prev) => (prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id]));
  }

  const audience = () => ({
    segment: {
      stage: stages.length ? stages : undefined,
      groupIds: groupIds.length ? groupIds : undefined,
      consentCategory,
    },
  });

  const canSubmit = body.trim().length > 0 && (channel === "sms" || subject.trim().length > 0) && !busy;

  async function createMessage(scheduledAt?: string): Promise<MessageDTO> {
    return api.post<MessageDTO>("/messages", {
      channel,
      subject: channel === "email" ? subject.trim() : undefined,
      bodyText: body.trim(),
      audience: audience(),
      scheduledAt,
    });
  }

  async function schedule() {
    if (!canSubmit || !scheduleAt) return;
    setBusy(true);
    try {
      await createMessage(new Date(scheduleAt).toISOString());
      toast.success(`Message scheduled for ${fmtDateTime(scheduleAt)}.`);
      reset();
      void qc.invalidateQueries({ queryKey: ["messages"] });
      onSent();
    } catch (err) {
      toast.error(errorMessage(err, "Could not schedule the message."));
    } finally {
      setBusy(false);
    }
  }

  async function sendNow() {
    if (!canSubmit) return;
    setBusy(true);
    try {
      const created = await createMessage();
      const dto = await api.post<MessageDTO>(`/messages/${created.id}/send`);
      toast.success(`Sent — ${dto.deliveredCount ?? 0} of ${dto.recipientCount ?? 0} delivered.`);
      const warning = (dto as MessageDTO & { warning?: string }).warning;
      if (warning) toast.warning(warning);
      reset();
      void qc.invalidateQueries({ queryKey: ["messages"] });
      onSent();
    } catch (err) {
      toast.error(errorMessage(err, "Could not send the message."));
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setSubject("");
    setBody("");
    setStages([]);
    setGroupIds([]);
    setScheduleAt("");
  }

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      {/* composer */}
      <div className="space-y-5 lg:col-span-3">
        <Section title="Compose">
          <div className="space-y-4 rounded-lg border p-4">
            <div className="space-y-2">
              <Label>Channel</Label>
              <RadioGroup
                value={channel}
                onValueChange={(v) => setChannel(v as "email" | "sms")}
                className="flex gap-4"
                aria-label="Message channel"
              >
                <label className="flex flex-1 cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50 has-[[data-state=checked]]:border-amber-400 has-[[data-state=checked]]:bg-amber-50 dark:has-[[data-state=checked]]:bg-amber-950">
                  <RadioGroupItem value="email" id="ch-email" />
                  <Mail className="h-5 w-5 text-amber-700 dark:text-amber-400" aria-hidden />
                  <span className="font-medium">Email</span>
                </label>
                <label className="flex flex-1 cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50 has-[[data-state=checked]]:border-teal-400 has-[[data-state=checked]]:bg-teal-50 dark:has-[[data-state=checked]]:bg-teal-950">
                  <RadioGroupItem value="sms" id="ch-sms" />
                  <MessageSquare className="h-5 w-5 text-teal-700 dark:text-teal-400" aria-hidden />
                  <span className="font-medium">SMS</span>
                </label>
              </RadioGroup>
            </div>

            {channel === "email" ? (
              <div className="space-y-1.5">
                <Label htmlFor="msg-subject">Subject</Label>
                <Input id="msg-subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Food drive this Saturday" />
              </div>
            ) : null}

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="msg-body">Message</Label>
                {channel === "sms" ? (
                  <span className={`text-xs tabular-nums ${body.length > 320 ? "text-destructive" : "text-muted-foreground"}`}>
                    {body.length} chars · {segments} segment{segments === 1 ? "" : "s"}
                  </span>
                ) : null}
              </div>
              <Textarea
                id="msg-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={channel === "sms" ? 4 : 8}
                placeholder={channel === "sms" ? "Keep it short — 160 chars per segment." : "Write the announcement…"}
              />
            </div>

            {quietHours ? (
              <Alert className="border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950">
                <Clock className="h-4 w-4 text-amber-600" aria-hidden />
                <AlertDescription className="text-amber-900 dark:text-amber-200">
                  Outside quiet hours — the platform will still queue this. Check your timing.
                </AlertDescription>
              </Alert>
            ) : null}

            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="msg-schedule">Schedule for (optional)</Label>
                <Input id="msg-schedule" type="datetime-local" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} />
              </div>
              <Button variant="outline" onClick={schedule} disabled={!canSubmit || !scheduleAt}>
                Schedule
              </Button>
              <Button onClick={sendNow} disabled={!canSubmit} className="gap-1.5">
                <Send className="h-4 w-4" /> Send now
              </Button>
            </div>
          </div>
        </Section>

        <Section title="Audience" description="Consent is applied on top: only people opted in to this channel + category are reachable.">
          <div className="space-y-4 rounded-lg border p-4">
            <div className="space-y-2">
              <Label>Lifecycle stages</Label>
              <div className="flex flex-wrap gap-2">
                {STAGE_CHIP_STAGES.map((s) => {
                  const on = stages.includes(s);
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => toggleStage(s)}
                      aria-pressed={on}
                      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                        on
                          ? "border-transparent bg-amber-200 text-amber-950 dark:bg-amber-900 dark:text-amber-100"
                          : "border-border text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      {STAGE_LABELS[s] ?? s}
                    </button>
                  );
                })}
                {stages.length === 0 ? <p className="text-xs text-muted-foreground">No stage filter — all stages.</p> : null}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Groups</Label>
              {groupsQ.isLoading ? (
                <LoadingBlock label="Loading groups…" />
              ) : (
                <div className="max-h-40 space-y-1 overflow-y-auto scroll-slim rounded-md border p-2">
                  {groups.length === 0 ? (
                    <p className="px-1 py-1 text-sm text-muted-foreground">No groups found.</p>
                  ) : (
                    groups.map((g) => (
                      <label key={g.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted/60">
                        <Checkbox
                          checked={groupIds.includes(g.id)}
                          onCheckedChange={() => toggleGroup(g.id)}
                          aria-label={`Include group ${g.name}`}
                        />
                        <span className="flex-1">{g.name}</span>
                        <span className="text-xs text-muted-foreground">{g.memberCount}</span>
                      </label>
                    ))
                  )}
                </div>
              )}
              {groupIds.length === 0 ? <p className="text-xs text-muted-foreground">No group filter — everyone consenting.</p> : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="msg-consent">Consent category</Label>
              <Select value={consentCategory} onValueChange={setConsentCategory}>
                <SelectTrigger id="msg-consent" className="sm:w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="operational">Operational (ministry essentials)</SelectItem>
                  <SelectItem value="marketing">Marketing (newsletters, events)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </Section>
      </div>

      {/* live preview */}
      <div className="lg:col-span-2">
        <div className="space-y-4 lg:sticky lg:top-4">
          <Card>
            <CardHeader className="pb-2">
              <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Live segment preview</Label>
            </CardHeader>
            <CardContent className="space-y-3">
              {previewQ.isLoading ? (
                <LoadingBlock label="Resolving audience…" />
              ) : previewQ.isError ? (
                <ErrorBlock error={previewQ.error} />
              ) : preview ? (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <StatCard label="Reaches" value={preview.count} sub={preview.count === 1 ? "person" : "people"} icon={Users} tone="positive" />
                    {channel === "sms" ? (
                      <StatCard label="Est. cost" value={fmtMoney(smsCost)} sub={`${smsCost} × $0.01`} icon={MessageSquare} />
                    ) : (
                      <StatCard label="Channel" value="Email" sub="no per-send cost" icon={Mail} />
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {preview.count === 0
                      ? "Nobody matches this segment + consent combination."
                      : `Including: ${preview.sample.map((s) => s.name).join(", ")}${preview.count > preview.sample.length ? "…" : ""}`}
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Adjust the audience to see reach.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Delivery preview</Label>
            </CardHeader>
            <CardContent>
              {channel === "email" ? (
                <div className="rounded-lg border">
                  <div className="border-b bg-muted/40 px-3 py-2 text-sm">
                    <span className="font-medium">{subject || "(no subject)"}</span>
                  </div>
                  <p className="min-h-20 whitespace-pre-wrap p-3 text-sm">{body || "Your email body…"}</p>
                </div>
              ) : (
                <div className="rounded-xl border bg-stone-100 p-3 dark:bg-stone-900">
                  <p className="min-h-16 whitespace-pre-wrap text-sm">{body || "Your text message…"}</p>
                  <p className="mt-2 text-right text-xs text-muted-foreground">
                    {segments} segment{segments === 1 ? "" : "s"}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

/* ═════════════════════════════ CONSENT LEDGER ═════════════════════════════ */

function ConsentTab() {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const consentQ = useApiQuery<{ items: ConsentItem[] }>(["consent", search], `/consent${qs({ search: search || undefined })}`);
  const items = consentQ.data?.items ?? [];

  return (
    <div className="space-y-4">
      <Section
        title="Consent ledger"
        description="Append-only: toggling writes a new entry — the newest state wins. Source and timestamp are recorded."
      >
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search by name or email…"
          className="sm:max-w-sm"
          aria-label="Search consent ledger"
        />

        {consentQ.isLoading ? (
          <LoadingBlock label="Loading consent records…" />
        ) : consentQ.isError ? (
          <ErrorBlock error={consentQ.error} />
        ) : items.length === 0 ? (
          <EmptyState icon={ShieldCheck} title="No people found" description="Try a different name or email." />
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Person</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead className="min-w-80">Channel preferences</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((p) => (
                  <ConsentRow key={p.personId} item={p} />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Section>
    </div>
  );
}

function ConsentRow({ item }: { item: ConsentItem }) {
  // group prefs into unique channel+category keys so each has one toggle
  const grouped = useMemo(() => {
    const map = new Map<string, ConsentPref>();
    for (const p of item.prefs) map.set(`${p.channel}:${p.category}`, p);
    return [...map.values()];
  }, [item.prefs]);

  return (
    <TableRow className="row-hover">
      <TableCell className="font-medium">{item.name}</TableCell>
      <TableCell className="max-w-52">
        <span className="block truncate text-sm text-muted-foreground">{item.email ?? "—"}</span>
      </TableCell>
      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{item.phone ?? "—"}</TableCell>
      <TableCell>
        {grouped.length === 0 ? (
          <span className="text-sm text-muted-foreground">No preferences on file</span>
        ) : (
          <div className="flex flex-wrap gap-2">
            {grouped.map((p) => (
              <ConsentToggle key={`${p.channel}:${p.category}`} personId={item.personId} pref={p} />
            ))}
          </div>
        )}
      </TableCell>
    </TableRow>
  );
}

function ConsentToggle({ personId, pref }: { personId: string; pref: ConsentPref }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  async function toggle(next: boolean) {
    setBusy(true);
    try {
      await api.post("/consent", {
        personId,
        channel: pref.channel,
        category: pref.category,
        optedIn: next,
        source: "staff_update",
      });
      toast.success("Preference updated — consent ledger entry appended");
      void qc.invalidateQueries({ queryKey: ["consent"] });
    } catch (err) {
      toast.error(errorMessage(err, "Could not update the preference."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="flex items-center gap-2 rounded-full border px-3 py-1"
      title={`${pref.source} · updated ${fmtDateTime(pref.updatedAt)}`}
    >
      <ChannelIcon channel={pref.channel} className="h-3.5 w-3.5" />
      <span className="text-xs">
        <span className="font-medium">{CHANNEL_LABELS[pref.channel] ?? pref.channel}</span>
        <span className="text-muted-foreground"> · {pref.category}</span>
      </span>
      <Badge
        variant="outline"
        className={`border-transparent text-[10px] ${
          pref.optedIn
            ? "bg-teal-100 text-teal-900 dark:bg-teal-950 dark:text-teal-200"
            : "bg-stone-100 text-stone-500 dark:bg-stone-900 dark:text-stone-400"
        }`}
      >
        {pref.optedIn ? "Opted in" : "Opted out"}
      </Badge>
      <Switch
        checked={pref.optedIn}
        disabled={busy}
        onCheckedChange={toggle}
        aria-label={`Toggle ${CHANNEL_LABELS[pref.channel] ?? pref.channel} ${pref.category} consent`}
      />
    </div>
  );
}
