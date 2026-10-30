"use client";

/**
 * SignupSuccess — the "welcome pack" after atomic provisioning (spec §7):
 * the generated tenant URL, the owner's sign-in credentials, the verification
 * checklist status, and copy-to-clipboard for the URL. In production the same
 * content is what the welcome email contains (delivery channel is logged in
 * tenant_onboarding_audit; SMTP is not configured in this build).
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  PartyPopper, Copy, CheckCircle2, Circle, LogIn, ShieldAlert, Globe, MailCheck,
} from "lucide-react";

export interface SuccessData {
  orgId: string;
  displayName: string;
  subdomain: string;
  url: string;
  status: string;
  ownerEmail: string;
  checklist: { missing: string[] };
}

export default function SignupSuccess({ data, onDone }: { data: SuccessData; onDone: () => void }) {
  const [copied, setCopied] = useState(false);

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(data.url);
      setCopied(true);
      toast.success("Church URL copied");
      setTimeout(() => setCopied(false), 2500);
    } catch {
      toast.error("Couldn't copy — the URL is: " + data.url);
    }
  }

  const missing = data.checklist?.missing ?? [];

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-emerald-50 via-background to-background p-6">
      <div className="w-full max-w-2xl space-y-6">
        <div className="text-center">
          <div className="brand-gradient mx-auto flex h-14 w-14 items-center justify-center rounded-2xl text-primary-foreground shadow-lg">
            <PartyPopper className="h-7 w-7" />
          </div>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">
            {data.displayName} is on ChurchOS
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your church account, owner login, and unique church URL were all provisioned in one secure step.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Globe className="h-4 w-4 text-primary" /> Your unique church URL
            </CardTitle>
            <CardDescription>Ready immediately — in production this resolves via <code>*.churchos.app</code> wildcard DNS.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg border bg-muted/60 px-3 py-2.5 text-sm font-semibold">
                {data.url}
              </code>
              <Button variant="outline" size="sm" onClick={copyUrl} className="shrink-0">
                {copied ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
              <ShieldAlert className="h-4 w-4 shrink-0" />
              <span>
                Status: <Badge variant="outline" className="border-amber-300 bg-white text-amber-900">pending_verification</Badge>
                {" "}— People, groups, attendance, care and record-keeping are live now; <strong>online giving unlocks</strong> once our team verifies your CAC documents and your settlement account is on file.
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <LogIn className="h-4 w-4 text-primary" /> Owner sign-in
            </CardTitle>
            <CardDescription>Use the email and the password you chose in Step 7. You&apos;ll be asked to change it after your first visit.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <MailCheck className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="text-muted-foreground">Owner email:</span>
              <code className="rounded bg-muted px-2 py-0.5 font-semibold">{data.ownerEmail}</code>
            </div>
            <Separator />
            {missing.length ? (
              <div>
                <p className="text-sm font-medium">Complete your verification checklist</p>
                <ul className="mt-2 space-y-1.5">
                  {missing.map((m) => (
                    <li key={m} className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Circle className="h-3.5 w-3.5 text-amber-500" /> {m}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="flex items-center gap-2 text-sm text-emerald-700">
                <CheckCircle2 className="h-4 w-4" /> Everything is submitted — verification is usually completed within one business day.
              </p>
            )}
          </CardContent>
        </Card>

        <div className="flex justify-center gap-3">
          <Button onClick={onDone} className="min-w-44">
            Go to sign in
          </Button>
        </div>
      </div>
    </div>
  );
}
