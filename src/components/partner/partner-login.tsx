"use client";

/**
 * PartnerLogin — 2026 reference-style split card, matching the church
 * sign-in: floating card on a soft canvas, form on the left (two-tone
 * heading, filled inputs, full-width CTA), decorative vendor-layer visual
 * panel on the right. Church sessions and partner sessions remain separate
 * principals (own table, cookie and session store).
 */
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { PartnerPrincipal } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthVisualPanel } from "@/components/app/auth-visuals";
import { AlertCircle, ArrowLeft, Store } from "lucide-react";

/** Reference-style filled input (matches the church sign-in). */
const FIELD_CLASS =
  "h-11 rounded-lg border-transparent bg-surface-sunken shadow-none placeholder:text-ink-muted/70 focus-visible:border-ring focus-visible:bg-surface";

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
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-surface-sunken px-4 py-10 sm:px-8">
      {/* Ambient canvas blobs (decorative) */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div
          className="mesh-blob-a absolute -left-32 top-[-8%] h-[30rem] w-[30rem] rounded-full opacity-20 blur-3xl"
          style={{ background: "var(--primary)" }}
        />
        <div
          className="mesh-blob-b absolute bottom-[-12%] right-[-8%] h-[26rem] w-[26rem] rounded-full opacity-20 blur-3xl"
          style={{ background: "var(--accent-decorative)" }}
        />
      </div>

      <div className="relative w-full max-w-4xl">
        <div className="overflow-hidden rounded-[1.75rem] bg-surface shadow-[0_24px_70px_-28px_rgba(15,23,42,0.35)] ring-1 ring-black/[0.06] dark:ring-white/10 lg:grid lg:grid-cols-[1.04fr_0.96fr]">
          {/* ── Form side ─────────────────────────────────────────────── */}
          <div className="relative flex flex-col justify-center p-7 sm:p-10 xl:px-12">
            <button
              type="button"
              onClick={onBack}
              className="mb-6 inline-flex w-fit items-center gap-1 text-xs font-medium text-ink-secondary transition-colors hover:text-ink"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Church sign-in
            </button>

            <div className="mb-7 flex items-center gap-3">
              <div className="brand-gradient flex h-11 w-11 items-center justify-center rounded-xl text-primary-foreground shadow-sm">
                <Store className="h-5 w-5" aria-hidden />
              </div>
              <div>
                <p className="font-display text-sm font-semibold leading-tight text-ink">Grace ChMS</p>
                <p className="text-[11px] text-ink-muted">Vendor layer — tenants &amp; licenses</p>
              </div>
            </div>

            <h2 className="font-display text-[1.65rem] font-bold leading-tight tracking-tight text-ink sm:text-3xl">
              Partner <span className="text-primary">Console</span>
            </h2>
            <p className="mt-2 text-sm text-ink-secondary">
              Manage church tenants, issue licenses, suspend accounts — separate from church logins.
            </p>

            <form onSubmit={submit} className="mt-7 space-y-4" noValidate>
              <div className="space-y-1.5">
                <Label htmlFor="partner-email" className="text-[13px] font-semibold text-ink">E-mail</Label>
                <Input
                  id="partner-email"
                  type="email"
                  autoComplete="username"
                  placeholder="Enter your email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={FIELD_CLASS}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="partner-password" className="text-[13px] font-semibold text-ink">Password</Label>
                <Input
                  id="partner-password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={FIELD_CLASS}
                  required
                />
              </div>

              {error ? (
                <div
                  className="flex items-start gap-2.5 rounded-lg border border-danger/25 bg-danger-bg p-3 text-sm text-danger"
                  role="alert"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  <p className="leading-snug">{error}</p>
                </div>
              ) : null}

              <Button type="submit" className="h-11 w-full rounded-lg text-sm font-semibold" size="lg" disabled={busy}>
                Sign In
              </Button>

              <p className="text-center text-[11px] text-ink-muted">
                Demo partner:{" "}
                <code className="rounded bg-surface-sunken px-1.5 py-0.5">partner@gracechms.demo</code> /{" "}
                <code className="rounded bg-surface-sunken px-1.5 py-0.5">partner2026</code>
              </p>
            </form>
          </div>

          {/* ── Visual side ───────────────────────────────────────────── */}
          <AuthVisualPanel variant="partner" className="hidden lg:flex" />
        </div>

        <p className="mt-6 text-center text-[11px] text-ink-muted">
          Local build · SQLite · License enforcement active at church sign-in
        </p>
      </div>
    </div>
  );
}
