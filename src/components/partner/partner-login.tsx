"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { PartnerPrincipal } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Store, ArrowLeft } from "lucide-react";

export default function PartnerLogin({
  onLogin,
  onBack,
}: {
  onLogin: (partner: PartnerPrincipal) => void;
  onBack: () => void;
}) {
  const [email, setEmail] = useState("partner@gracechms.demo");
  const [password, setPassword] = useState("partner2026");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ partner: PartnerPrincipal }>("/partner/auth/login", { email, password });
      onLogin(res.partner);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to sign in.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="brand-gradient flex min-h-screen flex-col justify-between p-6 text-primary-foreground sm:p-10">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15">
            <Store className="h-5 w-5" />
          </div>
          <div>
            <p className="text-lg font-semibold leading-tight">Grace ChMS Partner Console</p>
            <p className="text-xs text-white/70">Vendor layer — tenants &amp; licenses</p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onBack} className="text-white/80 hover:bg-white/10 hover:text-white">
          <ArrowLeft className="h-4 w-4" /> Church sign-in
        </Button>
      </div>

      <div className="flex flex-1 items-center justify-center py-10">
        <div className="w-full max-w-md space-y-4">
          <Card className="border-none shadow-xl">
            <CardHeader>
              <CardTitle className="text-xl">Partner sign-in</CardTitle>
              <CardDescription>
                Manage church tenants, issue licenses, suspend accounts. This is the vendor layer — separate from church logins.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={submit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="partner-email">Email</Label>
                  <Input id="partner-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="partner-password">Password</Label>
                  <Input id="partner-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
                </div>
                {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
                <Button type="submit" className="w-full" disabled={busy}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Sign in to Partner Console
                </Button>
              </form>
            </CardContent>
          </Card>
          <p className="text-center text-xs text-white/60">
            Demo partner: <code className="rounded bg-white/10 px-1.5 py-0.5">partner@gracechms.demo</code> / <code className="rounded bg-white/10 px-1.5 py-0.5">partner2026</code>
          </p>
        </div>
      </div>

      <p className="text-[11px] text-white/50">Local build · SQLite · License enforcement active at church sign-in</p>
    </div>
  );
}
