"use client";

/**
 * WhatsApp Settings — connect/disconnect WhatsApp numbers (sandbox or Meta
 * Cloud API), hand over the webhook configuration, and simulate an inbound
 * message to test the channel end-to-end.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { canDo } from "@/lib/types";
import { EmptyState, ErrorBlock, LoadingBlock, Section, useApiQuery, type ModuleProps } from "@/components/app/shared";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { Copy, KeyRound, Loader2, MessageSquarePlus, Phone, Plus, PlugZap, Unplug } from "lucide-react";
import type { WaAccount, WaAccountsResp } from "@/components/app/whatsapp/WhatsAppModule";

async function copyText(value: string, label: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(`${label} copied to clipboard.`);
  } catch {
    toast.error("Could not copy — please select and copy the text manually.");
  }
}

const ACTION_LABELS: Record<string, string> = {
  opted_out: "Contact opted out (replied STOP)",
  opted_in: "Contact opted back in (replied START)",
  guest_created: "New guest profile created from onboarding",
  matched: "Matched to an existing church profile",
  onboarding_continues: "Onboarding continuing — waiting for a valid name",
  onboarding_started: "Onboarding started — welcome + name request sent",
  flow_advanced: "Consumed by an active flow step",
  ai_reply: "Shepherd AI replied",
  fallback: "Fallback acknowledgement sent",
};

function ProviderBadge({ provider }: { provider: string }) {
  return provider === "meta" ? (
    <Badge variant="outline" className="border-emerald-200 bg-emerald-50 font-medium text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
      Meta Cloud API
    </Badge>
  ) : (
    <Badge variant="outline" className="border-transparent bg-muted font-medium text-muted-foreground">
      Sandbox
    </Badge>
  );
}

function StatusBadge({ status }: { status: string }) {
  return status === "active" ? (
    <Badge variant="outline" className="border-transparent bg-emerald-100 font-medium text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
      Active
    </Badge>
  ) : (
    <Badge variant="outline" className="border-transparent bg-muted font-medium text-muted-foreground capitalize">
      {status}
    </Badge>
  );
}

export default function WhatsAppSettingsTab({ user }: ModuleProps) {
  const qc = useQueryClient();
  const accountsQ = useApiQuery<WaAccountsResp>(["whatsapp", "accounts"], "/whatsapp/accounts");
  const [connectOpen, setConnectOpen] = useState(false);
  const [disconnectRow, setDisconnectRow] = useState<WaAccount | null>(null);
  const [busy, setBusy] = useState(false);

  const canManage = canDo(user, "admin.manage");
  const accounts = accountsQ.data?.items ?? [];
  const connectedCount = accounts.filter((a) => a.status === "active").length;

  async function refresh() {
    await qc.invalidateQueries({ queryKey: ["whatsapp"] });
  }

  async function disconnect(account: WaAccount) {
    setBusy(true);
    try {
      await api.post(`/whatsapp/accounts/${account.id}/disconnect`);
      toast.success("Number disconnected.");
      setDisconnectRow(null);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Disconnect failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {!canManage && (
        <Alert>
          <AlertDescription>
            You need the admin.manage permission to connect or disconnect WhatsApp numbers. The configuration below is read-only.
          </AlertDescription>
        </Alert>
      )}

      <Section
        title="Connection"
        description={connectedCount > 0 ? "The newest active number is used for all sends." : "Connect a number to start sending and receiving."}
        actions={
          canManage ? (
            <Button className="h-11 lg:h-9" onClick={() => setConnectOpen(true)}>
              <Plus className="h-4 w-4" /> Connect account
            </Button>
          ) : null
        }
      >
        {accountsQ.isLoading ? (
          <LoadingBlock label="Loading accounts…" />
        ) : accountsQ.isError ? (
          <ErrorBlock error={accountsQ.error} />
        ) : accounts.length === 0 ? (
          <EmptyState
            icon={PlugZap}
            title="No WhatsApp number connected"
            description="Connect the sandbox provider to try the whole channel locally, or Meta Cloud API to go live."
          />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {accounts.map((a) => (
              <Card key={a.id} className="py-0">
                <CardHeader className="px-4 pt-4">
                  <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="flex items-center gap-2">
                      <Phone className="h-4 w-4 text-muted-foreground" aria-hidden />
                      {a.displayPhoneNumber || a.phoneNumberId}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <ProviderBadge provider={a.provider} />
                      <StatusBadge status={a.status} />
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 px-4 pb-4">
                  <div className="grid gap-2 text-xs">
                    <CopyRow label="Phone number ID" value={a.phoneNumberId} />
                    {a.businessAccountId && <CopyRow label="Business account ID" value={a.businessAccountId} />}
                    <CopyRow label="Webhook URL" value={a.webhookUrl} mono />
                    <CopyRow label="Webhook verify token" value={a.webhookVerifyToken} mono />
                  </div>
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <KeyRound className="h-3.5 w-3.5" aria-hidden />
                    {a.hasToken ? "Access token configured" : "No access token (sandbox needs none)"}
                  </p>
                  {a.lastError && (
                    <p className="rounded-md bg-red-50 px-2.5 py-2 text-xs text-red-900 dark:bg-red-950 dark:text-red-200">
                      Last error: {a.lastError}
                    </p>
                  )}
                  {canManage && a.status === "active" && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-11 w-full text-destructive hover:bg-destructive/10 hover:text-destructive lg:h-9"
                      onClick={() => setDisconnectRow(a)}
                    >
                      <Unplug className="h-4 w-4" /> Disconnect
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </Section>

      {canManage && (
        <Section
          title="Test the channel"
          description="Sandbox only — injects a message exactly as Meta's webhook would deliver it."
        >
          <SimulateInboundCard onSimulated={refresh} />
        </Section>
      )}

      <ConnectAccountDialog
        open={connectOpen}
        onOpenChange={setConnectOpen}
        onConnected={refresh}
      />

      <AlertDialog open={!!disconnectRow} onOpenChange={(o) => !o && setDisconnectRow(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect {disconnectRow?.displayPhoneNumber || disconnectRow?.phoneNumberId}?</AlertDialogTitle>
            <AlertDialogDescription>
              Sending and receiving stops for this number until it is connected again. The verify token is kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11 lg:h-9">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="h-11 bg-destructive text-white hover:bg-destructive/90 lg:h-9"
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                if (disconnectRow) void disconnect(disconnectRow);
              }}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Disconnect"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ───────────────────────── copy row ───────────────────────── */

function CopyRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/30 px-2.5 py-1.5">
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className={`truncate ${mono ? "font-mono" : ""}`}>{value}</p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-9 w-9 shrink-0"
        aria-label={`Copy ${label}`}
        onClick={() => void copyText(value, label)}
      >
        <Copy className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

/* ───────────────────────── simulate inbound ───────────────────────── */

function SimulateInboundCard({ onSimulated }: { onSimulated: () => Promise<void> }) {
  const [phone, setPhone] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function simulate() {
    if (!phone.trim() || !text.trim()) {
      toast.error("Phone number and message text are both required.");
      return;
    }
    setBusy(true);
    try {
      const res = await api.post<{ handled: boolean; action: string }>("/whatsapp/simulate/inbound", {
        phoneNumber: phone.trim(),
        text,
      });
      setResult(ACTION_LABELS[res.action] ?? res.action);
      await onSimulated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Simulation failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="wa-sim-phone">From (phone number)</Label>
            <Input
              id="wa-sim-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+2348012345678"
              inputMode="tel"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wa-sim-text">Message text</Label>
            <Input
              id="wa-sim-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="e.g. Hi! Is there service this Sunday?"
            />
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Button className="h-11 bg-emerald-700 hover:bg-emerald-800 lg:h-9" onClick={simulate} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquarePlus className="h-4 w-4" />} Send test message
          </Button>
          {result && <p className="text-sm text-muted-foreground">Result: <span className="font-medium text-foreground">{result}</span></p>}
        </div>
        <p className="text-xs text-muted-foreground">
          Tip: an unknown number starts onboarding (it will ask for a name); “STOP” opts the contact out; a reply to an RSVP or question advances a flow.
        </p>
      </CardContent>
    </Card>
  );
}

/* ───────────────────────── connect dialog ───────────────────────── */

interface ConnectSuccess {
  webhookUrl: string;
  webhookVerifyToken: string;
}

function ConnectAccountDialog({
  open,
  onOpenChange,
  onConnected,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnected: () => Promise<void>;
}) {
  const [provider, setProvider] = useState<string>("sandbox");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [displayPhoneNumber, setDisplayPhoneNumber] = useState("");
  const [businessAccountId, setBusinessAccountId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState<ConnectSuccess | null>(null);

  const isMeta = provider === "meta";

  function reset() {
    setProvider("sandbox");
    setPhoneNumberId("");
    setDisplayPhoneNumber("");
    setBusinessAccountId("");
    setAccessToken("");
    setAppSecret("");
    setSuccess(null);
  }

  async function save() {
    if (!phoneNumberId.trim()) {
      toast.error("Phone number ID is required.");
      return;
    }
    if (isMeta && !accessToken.trim()) {
      toast.error("Meta Cloud API accounts require a permanent access token.");
      return;
    }
    setSaving(true);
    try {
      const res = await api.post<ConnectSuccess & { ok: boolean }>("/whatsapp/accounts", {
        provider,
        phoneNumberId: phoneNumberId.trim(),
        displayPhoneNumber: displayPhoneNumber.trim() || undefined,
        businessAccountId: isMeta ? businessAccountId.trim() || undefined : undefined,
        accessToken: isMeta ? accessToken : undefined,
        appSecret: isMeta && appSecret.trim() ? appSecret : undefined,
      });
      setSuccess({ webhookUrl: res.webhookUrl, webhookVerifyToken: res.webhookVerifyToken });
      await onConnected();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not connect the account.");
    } finally {
      setSaving(false);
    }
  }

  function closeAndReset() {
    onOpenChange(false);
    reset();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(o) : closeAndReset())}>
      <DialogContent className="max-h-[92vh] overflow-y-auto scroll-slim sm:max-w-lg">
        {success ? (
          <>
            <DialogHeader>
              <DialogTitle>Account connected</DialogTitle>
              <DialogDescription>
                Paste this webhook URL into your Meta app configuration and subscribe to the <span className="font-medium">messages</span> field.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <CopyRow label="Webhook URL" value={success.webhookUrl} mono />
              <CopyRow label="Webhook verify token" value={success.webhookVerifyToken} mono />
              <p className="text-xs text-muted-foreground">
                Store the verify token safely — Meta’s subscription handshake (hub.challenge) uses it, and inbound
                messages only flow after the webhook is verified.
              </p>
            </div>
            <DialogFooter>
              <Button className="h-11 bg-emerald-700 hover:bg-emerald-800 lg:h-9" onClick={closeAndReset}>
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Connect account</DialogTitle>
              <DialogDescription>Choose a provider, then give this WhatsApp number its identity.</DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Provider</Label>
                <Select value={provider} onValueChange={setProvider}>
                  <SelectTrigger className="w-full" aria-label="Provider">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sandbox">Sandbox (simulated)</SelectItem>
                    <SelectItem value="meta">Meta Cloud API</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {isMeta
                    ? "WhatsApp Business Platform (Meta Cloud API)."
                    : "Simulated provider for local testing — no Meta account needed."}
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="wa-acc-phone-id">Phone number ID *</Label>
                <Input
                  id="wa-acc-phone-id"
                  value={phoneNumberId}
                  onChange={(e) => setPhoneNumberId(e.target.value)}
                  placeholder={isMeta ? "From your Meta WhatsApp account" : "e.g. sandbox-123456"}
                  className="font-mono"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="wa-acc-display">Display phone number</Label>
                <Input
                  id="wa-acc-display"
                  value={displayPhoneNumber}
                  onChange={(e) => setDisplayPhoneNumber(e.target.value)}
                  placeholder="+234 801 234 5678"
                />
              </div>

              {isMeta && (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="wa-acc-biz">WhatsApp Business account ID</Label>
                    <Input
                      id="wa-acc-biz"
                      value={businessAccountId}
                      onChange={(e) => setBusinessAccountId(e.target.value)}
                      className="font-mono"
                      placeholder="wabiz-…"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="wa-acc-token">Access token *</Label>
                    <Input
                      id="wa-acc-token"
                      type="password"
                      value={accessToken}
                      onChange={(e) => setAccessToken(e.target.value)}
                      placeholder="Permanent system-user token"
                      autoComplete="new-password"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="wa-acc-secret">App secret (optional)</Label>
                    <Input
                      id="wa-acc-secret"
                      type="password"
                      value={appSecret}
                      onChange={(e) => setAppSecret(e.target.value)}
                      placeholder="Enables webhook signature verification"
                      autoComplete="new-password"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      When set, inbound webhooks are rejected unless X-Hub-Signature-256 matches.
                    </p>
                  </div>
                </>
              )}

              <Separator />
              <p className="text-xs text-muted-foreground">
                The server generates a webhook verify token for this number automatically — you will see it right after connecting.
              </p>
            </div>

            <DialogFooter>
              <Button variant="outline" className="h-11 lg:h-9" onClick={closeAndReset}>
                Cancel
              </Button>
              <Button className="h-11 bg-emerald-700 hover:bg-emerald-800 lg:h-9" onClick={save} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Connect
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
