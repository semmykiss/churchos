"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { SessionUser } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Church, Store, UserPlus } from "lucide-react";

const DEMO_ACCOUNTS = [
  { email: "david@gracechapel.demo", role: "Owner / Lead Pastor" },
  { email: "renee@gracechapel.demo", role: "Campus Admin" },
  { email: "tom@gracechapel.demo", role: "Finance (Treasurer)" },
  { email: "grace@gracechapel.demo", role: "Ministry Leader" },
  { email: "marcus@gracechapel.demo", role: "Volunteer" },
  { email: "aisha@gracechapel.demo", role: "Member / Parent" },
];

export default function LoginScreen({ onLogin, onPartner, onSignup }: { onLogin: (user: SessionUser) => void; onPartner?: () => void; onSignup?: () => void }) {
  const [email, setEmail] = useState("david@gracechapel.demo");
  const [password, setPassword] = useState("grace2026");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ user: SessionUser }>("/auth/login", { email, password });
      onLogin(res.user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to sign in.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-background lg:flex-row">
      {/* Brand panel */}
      <div className="brand-gradient relative flex min-h-44 flex-col justify-between p-6 text-primary-foreground sm:p-10 lg:min-h-screen lg:w-[46%]">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15">
            <Church className="h-5 w-5" />
          </div>
          <div>
            <p className="text-lg font-semibold leading-tight">Grace Chapel</p>
            <p className="text-xs text-white/70">Church Management Platform</p>
          </div>
        </div>
        <div className="hidden max-w-md space-y-4 lg:block">
          <h1 className="text-3xl font-semibold leading-tight">
            One system for Sunday —<br />and everything after it.
          </h1>
          <p className="text-sm leading-relaxed text-white/80">
            People, groups, children&apos;s check-in, giving, volunteers, care and reporting in one place —
            built so a church of 200 can run the whole week without a spreadsheet beside it.
          </p>
          <ul className="space-y-1.5 text-sm text-white/75">
            <li>• Family check-in with per-occurrence security codes</li>
            <li>• Batches that balance to the penny before they post</li>
            <li>• Volunteers confirmed from a text — no login required</li>
          </ul>
        </div>
        <p className="text-[11px] text-white/50">Local build · SQLite · All data stays on this machine</p>
      </div>

      {/* Login form */}
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-md space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">Sign in</CardTitle>
              <CardDescription>Use a demo account below — password for all is <code className="rounded bg-muted px-1.5 py-0.5 text-xs">grace2026</code></CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={submit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
                </div>
                {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
                <Button type="submit" className="w-full" disabled={busy}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Sign in
                </Button>
                {onSignup ? (
                  <Button type="button" className="w-full" onClick={onSignup}>
                    <UserPlus className="h-4 w-4" />
                    Create your church&apos;s account — Nigerian onboarding
                  </Button>
                ) : null}
                {onPartner ? (
                  <Button type="button" variant="outline" className="w-full" onClick={onPartner}>
                    <Store className="h-4 w-4" />
                    Partner Portal — manage churches &amp; licenses
                  </Button>
                ) : null}
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Demo accounts — each sees a different view</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {DEMO_ACCOUNTS.map((a) => (
                <button
                  key={a.email}
                  type="button"
                  onClick={() => { setEmail(a.email); setPassword("grace2026"); }}
                  className="row-hover rounded-lg border px-3 py-2 text-left transition-colors"
                >
                  <span className="block text-xs font-medium">{a.role}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">{a.email}</span>
                </button>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
