"use client";

/**
 * ResetPasswordScreen — set a new password from a single-use ?reset=<token>
 * link. Same card-on-gradient shell as sign-in for a consistent auth
 * experience. On success: brief checkmark, then back to the sign-in card.
 */
import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ThemeSwitcher } from "@/components/app/theme/theme-switcher";
import { AuthBrandPanel } from "@/components/app/auth-visuals";
import { AlertCircle, Check, Eye, EyeOff, ArrowLeft } from "lucide-react";

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
    <div className="flex min-h-screen bg-background">
      <AuthBrandPanel />
      <div className="flex flex-1 items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-[420px]">
          <div className="relative rounded-2xl border bg-surface p-8 shadow-lg sm:p-10">
            <AnimatePresence>
              {done ? (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-2xl bg-surface/90 backdrop-blur-sm"
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

            <button
              type="button"
              onClick={onDone}
              className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-ink-secondary transition-colors hover:text-ink"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Back to sign in
            </button>
            <h2 className="font-display text-2xl font-semibold text-ink">Set a new password</h2>
            <p className="mb-6 mt-1 text-sm text-ink-secondary">
              Choose a strong password of at least 8 characters. All other sessions will be signed out.
            </p>

            <form onSubmit={submit} className="space-y-4" noValidate>
              <div className="space-y-1.5">
                <Label htmlFor="new-password" className="text-[13px] font-medium text-ink-secondary">New password</Label>
                <div className="relative">
                  <Input
                    id="new-password"
                    type={show ? "text" : "password"}
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pr-10"
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
                <Label htmlFor="confirm-password" className="text-[13px] font-medium text-ink-secondary">Confirm new password</Label>
                <Input
                  id="confirm-password"
                  type={show ? "text" : "password"}
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  aria-invalid={mismatch || undefined}
                />
                {mismatch ? (
                  <p className="flex items-center gap-1 text-xs text-danger" role="alert">
                    <AlertCircle className="h-3 w-3 shrink-0" aria-hidden /> Passwords don&apos;t match.
                  </p>
                ) : null}
              </div>

              {error ? (
                <div className="flex items-start gap-2.5 rounded-lg border border-danger/25 bg-danger-bg p-3 text-sm text-danger" role="alert">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  <p className="leading-snug">{error}</p>
                </div>
              ) : null}

              <Button type="submit" className="w-full" size="lg" loading={busy} disabled={!valid}>
                Update password
              </Button>
            </form>
          </div>

          <div className="mt-5 flex justify-center">
            <ThemeSwitcher variant="compact" />
          </div>
        </div>
      </div>
    </div>
  );
}
