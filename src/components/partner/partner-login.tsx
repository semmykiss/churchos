"use client";

/**
 * PartnerLogin — 2026 reference-style split card, matching the church
 * sign-in: floating card on a soft canvas, form on the left (two-tone
 * heading, filled inputs, full-width CTA), decorative vendor-layer visual
 * panel on the right. Church sessions and partner sessions remain separate
 * principals (own table, cookie and session store).
 *
 * Security hardening:
 *  - No prefilled credentials; demo access is a dismissible hint only.
 *  - 401 failures always show a generic message ("Invalid email or password.")
 *    so the form never discloses whether an account exists.
 *  - 429 lockout responses trigger a local countdown that keeps the submit
 *    button disabled until the retry window elapses; a 429 without a parseable
 *    window falls back to a bounded 60s countdown so the form can never stay
 *    disabled forever.
 *  - Server faults (404/5xx) and network failures show their OWN copy — they
 *    are not credential problems, and labeling them "Invalid email or
 *    password." sent users hunting for typos that did not exist.
 */
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { PartnerPrincipal } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthVisualPanel } from "@/components/app/auth-visuals";
import { AlertCircle, ArrowLeft, Info, Loader2, Store, X } from "lucide-react";

/** Reference-style filled input (matches the church sign-in). */
const FIELD_CLASS =
  "h-11 rounded-lg border-transparent bg-surface-sunken shadow-none placeholder:text-ink-muted/70 focus-visible:border-ring focus-visible:bg-surface";

/** Extract a retry window (seconds) from a 429 lockout error, if any. */
function lockoutSeconds(err: unknown): number | null {
  if (!(err instanceof ApiError) || err.status !== 429) return null;
  const details = err.details as { retryAfterSeconds?: unknown } | undefined;
  const fromDetails = details?.retryAfterSeconds;
  if (typeof fromDetails === "number" && Number.isFinite(fromDetails) && fromDetails > 0) {
    return Math.ceil(fromDetails);
  }
  const match = /(\d+)\s*(?:s\b|sec|second)/i.exec(err.message ?? "");
  if (match) return Number(match[1]);
  return null;
}

export default function PartnerLogin({
  onLogin,
  onBack,
}: {
  onLogin: (partner: PartnerPrincipal) => void;
  onBack: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lockSeconds, setLockSeconds] = useState(0);
  const [sessionEnded, setSessionEnded] = useState(false);
  const [showHint, setShowHint] = useState(true);
  const locked = lockSeconds > 0;

  // Light-touch "session ended" notice: the session-expired flag is set in
  // sessionStorage by the console shell when a partner session is dropped.
  useEffect(() => {
    if (window.sessionStorage.getItem("partner:session-ended") === "1") {
      setSessionEnded(true);
      window.sessionStorage.removeItem("partner:session-ended");
    }
  }, []);

  // Local 1s countdown while locked out; unlocks the form when it hits zero.
  useEffect(() => {
    if (lockSeconds <= 0) return;
    const timer = window.setInterval(() => {
      setLockSeconds((s) => (s <= 1 ? 0 : s - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [lockSeconds > 0]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || locked) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ partner: PartnerPrincipal }>("/partner/auth/login", {
        email: email.trim().toLowerCase(),
        password,
      });
      onLogin(res.partner);
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        // No parseable window (missing/odd body)? Treat it as a 60s lockout —
        // bounded, so the form always re-enables and the countdown stays visible.
        setLockSeconds(lockoutSeconds(err) ?? 60);
      } else if (err instanceof ApiError && err.status !== 401) {
        // Server fault (404/5xx/503) — not a credential problem. Retryable.
        setError("The server could not process the sign-in. Please try again in a moment.");
      } else if (err instanceof ApiError) {
        // 401 — generic message only, never disclose whether the e-mail exists.
        setError("Invalid email or password.");
      } else {
        // Network failure (fetch rejected) — the request never reached us.
        setError("Cannot reach the server. Check your connection and try again.");
      }
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
                  inputMode="email"
                  autoComplete="email"
                  placeholder="Enter your email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={FIELD_CLASS}
                  aria-invalid={error || locked ? true : undefined}
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
                  aria-invalid={error || locked ? true : undefined}
                  required
                />
              </div>

              {locked ? (
                <div
                  className="flex items-start gap-2.5 rounded-lg border border-warning/40 bg-warning-bg p-3 text-sm text-warning"
                  role="alert"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  <p className="leading-snug">Too many attempts. Try again in {lockSeconds}s.</p>
                </div>
              ) : error ? (
                <div
                  className="flex items-start gap-2.5 rounded-lg border border-danger/25 bg-danger-bg p-3 text-sm text-danger"
                  role="alert"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  <p className="leading-snug">{error}</p>
                </div>
              ) : null}

              {sessionEnded ? (
                <div
                  className="flex items-start gap-2.5 rounded-lg border border-border-strong bg-muted p-3 text-sm text-muted-foreground"
                  role="status"
                >
                  <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  <p className="leading-snug">Your session ended after inactivity. Please sign in again.</p>
                </div>
              ) : null}

              <Button
                type="submit"
                className="h-11 w-full rounded-lg text-sm font-semibold"
                size="lg"
                disabled={busy || locked}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                {busy ? "Signing in…" : "Sign In"}
              </Button>

              {showHint ? (
                <p className="flex items-center justify-center gap-1 text-center text-xs text-muted-foreground">
                  <span>
                    Demo access: <code className="rounded bg-surface-sunken px-1 py-0.5">partner@gracechms.demo</code>
                    {" · "}
                    <code className="rounded bg-surface-sunken px-1 py-0.5">partner2026</code> (seeded demo tenant)
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowHint(false)}
                    aria-label="Hide demo credentials"
                    className="-m-1 rounded p-1 text-ink-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <X className="h-3 w-3" aria-hidden />
                  </button>
                </p>
              ) : null}
            </form>
          </div>

          {/* ── Visual side ───────────────────────────────────────────── */}
          <AuthVisualPanel variant="partner" className="hidden lg:flex" />
        </div>

        <p className="mt-6 text-center text-[11px] text-ink-muted">
          License enforcement is active at church sign-in
        </p>
      </div>
    </div>
  );
}
