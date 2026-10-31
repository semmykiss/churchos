"use client";

/**
 * ResetPasswordScreen — set a new password from a single-use ?reset=<token>
 * link. 2026 reference-style split card, matching sign-in: form on the left,
 * decorative visual panel on the right. On success: brief checkmark, then
 * back to the sign-in card.
 */
import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ThemeSwitcher } from "@/components/app/theme/theme-switcher";
import { AuthVisualPanel } from "@/components/app/auth-visuals";
import { AlertCircle, Check, Eye, EyeOff, ArrowLeft } from "lucide-react";

/** Reference-style filled input (matches the church sign-in). */
const FIELD_CLASS =
  "h-11 rounded-lg border-transparent bg-surface-sunken shadow-none placeholder:text-ink-muted/70 focus-visible:border-ring focus-visible:bg-surface";

export default function ResetPasswordScreen({ token, onDone }: { token: string; onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [touched, setTouched] = useState(false);
  const reduce = useReducedMotion();

  const tooShort = touched && password.length > 0 && password.length < 8;
  const mismatch = touched && confirm.length > 0 && password !== confirm;
  const valid = password.length >= 8 && password === confirm;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    setError(null);
    if (!valid) return;
    setBusy(true);
    try {
      await api.post("/auth/reset-password", { token, password });
      setDone(true);
      window.setTimeout(onDone, reduce ? 0 : 900);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to reset your password.");
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

      <div className="relative w-full max-w-5xl">
        <div className="relative overflow-hidden rounded-[1.75rem] bg-surface shadow-[0_24px_70px_-28px_rgba(15,23,42,0.35)] ring-1 ring-black/[0.06] dark:ring-white/10 lg:grid lg:grid-cols-[1.04fr_0.96fr]">
          {/* Success overlay */}
          <AnimatePresence>
            {done ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-surface/90 backdrop-blur-sm"
              >
                <motion.span
                  initial={{ scale: 0.4, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ duration: reduce ? 0.1 : 0.3, ease: [0.16, 1, 0.3, 1] }}
                  className="flex h-14 w-14 items-center justify-center rounded-full bg-success text-white shadow-lg"
                >
                  <Check className="h-7 w-7" strokeWidth={2.5} />
                </motion.span>
                <p className="text-sm font-medium text-ink">Password updated — taking you to sign in…</p>
              </motion.div>
            ) : null}
          </AnimatePresence>

          {/* ── Form side ─────────────────────────────────────────────── */}
          <div className="relative flex flex-col justify-center p-7 sm:p-10 xl:px-12">
            <button
              type="button"
              onClick={onDone}
              className="mb-5 inline-flex w-fit items-center gap-1 text-xs font-medium text-ink-secondary transition-colors hover:text-ink"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Back to sign in
            </button>

            <h2 className="font-display text-[1.65rem] font-bold leading-tight tracking-tight text-ink sm:text-3xl">
              Set a <span className="text-primary">new password</span>
            </h2>
            <p className="mb-7 mt-2 text-sm text-ink-secondary">
              Choose a strong password of at least 8 characters. All other sessions will be signed out.
            </p>

            <form onSubmit={submit} className="space-y-4" noValidate>
              <div className="space-y-1.5">
                <Label htmlFor="new-password" className="text-[13px] font-semibold text-ink">New password</Label>
                <div className="relative">
                  <Input
                    id="new-password"
                    type={show ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="At least 8 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={`${FIELD_CLASS} pr-10`}
                    aria-invalid={(tooShort || mismatch) || undefined}
                  />
                  <button
                    type="button"
                    onClick={() => setShow((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-ink-muted transition-colors hover:bg-accent hover:text-ink-secondary"
                    aria-label={show ? "Hide password" : "Show password"}
                  >
                    {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {tooShort ? (
                  <p className="flex items-center gap-1 text-xs text-danger" role="alert">
                    <AlertCircle className="h-3 w-3 shrink-0" aria-hidden /> Use at least 8 characters.
                  </p>
                ) : null}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="confirm-password" className="text-[13px] font-semibold text-ink">
                  Confirm new password
                </Label>
                <Input
                  id="confirm-password"
                  type={show ? "text" : "password"}
                  autoComplete="new-password"
                  placeholder="Repeat your password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className={FIELD_CLASS}
                  aria-invalid={mismatch || undefined}
                />
                {mismatch ? (
                  <p className="flex items-center gap-1 text-xs text-danger" role="alert">
                    <AlertCircle className="h-3 w-3 shrink-0" aria-hidden /> Passwords don&apos;t match.
                  </p>
                ) : null}
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

              <Button type="submit" className="h-11 w-full rounded-lg text-sm font-semibold" size="lg" loading={busy} disabled={!valid}>
                Update password
              </Button>
            </form>
          </div>

          {/* ── Visual side ───────────────────────────────────────────── */}
          <AuthVisualPanel variant="church" className="hidden lg:flex" />
        </div>

        <div className="mt-5 flex justify-center">
          <ThemeSwitcher variant="compact" />
        </div>
      </div>
    </div>
  );
}
