"use client";

/**
 * LoginScreen — premium split-screen sign-in (spec §5).
 * Left: ambient gradient mesh + rotating showcase. Right: centered 420px card
 * with inline validation, password visibility toggle, magic-link sign-in,
 * forgot-password flow, tenant-aware branding chip, theme mini-switcher and
 * a 300ms success micro-animation. Demo accounts remain available (local build).
 */
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { api, ApiError } from "@/lib/api";
import type { SessionUser } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ThemeSwitcher } from "@/components/app/theme/theme-switcher";
import { AuthBrandPanel, TenantChip } from "@/components/app/auth-visuals";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertCircle, ArrowLeft, Building2, Check, ChevronDown, Eye, EyeOff, Link2,
  Loader2, Mail, Search, Store, UserPlus, Wand2, X,
} from "lucide-react";

const DEMO_ACCOUNTS = [
  { email: "pastor@redeembaptist.ng", role: "Owner / Lead Pastor — everything" },
  { email: "rita.p@redeembaptist.ng", role: "Ministry Leader — Care Radar, Sermon Studio, Serving" },
  { email: "femi.f@redeembaptist.ng", role: "Finance (Treasurer) — giving, board reports" },
  { email: "vera.v@redeembaptist.ng", role: "Volunteer — my serving schedule & portal" },
];

const DEMO_PASSWORD = "redeem2026";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Branding {
  name: string;
  logoUrl: string | null;
}

type Mode = "signin" | "magic" | "forgot";

/** Field with top-aligned label, inline error, optional trailing control. */
function Field({
  id, label, error, trailing, children,
}: {
  id: string;
  label: string;
  error?: string | null;
  trailing?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label htmlFor={id} className="text-[13px] font-medium text-ink-secondary">{label}</Label>
        {trailing}
      </div>
      {children}
      {error ? (
        <p className="flex items-center gap-1 text-xs text-danger" role="alert">
          <AlertCircle className="h-3 w-3 shrink-0" aria-hidden /> {error}
        </p>
      ) : null}
    </div>
  );
}

export default function LoginScreen({
  onLogin,
  onPartner,
  onSignup,
  initialNotice,
}: {
  onLogin: (user: SessionUser) => void;
  onPartner?: () => void;
  onSignup?: () => void;
  initialNotice?: string;
}) {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState(DEMO_ACCOUNTS[0].email);
  const [password, setPassword] = useState(DEMO_PASSWORD);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; action?: "magic" | "fresh-link" } | null>(null);
  const [touched, setTouched] = useState(false);
  const [succeeded, setSucceeded] = useState(false);
  const [sentLink, setSentLink] = useState<{ message: string; devLink?: string } | null>(null);
  const [branding, setBranding] = useState<Branding | null>(null);
  const [demoOpen, setDemoOpen] = useState(false);
  const successTimer = useRef<number | null>(null);
  const reduce = useReducedMotion();

  // Tenant-awareness: resolve church branding from a church subdomain.
  useEffect(() => {
    const host = window.location.hostname;
    if (/^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.)/.test(host)) return;
    const parts = host.split(".");
    if (parts.length < 3) return;
    const sub = parts[0];
    if (["www", "app", "www-wpm"].includes(sub)) return;
    api
      .get<{ found: boolean; name?: string; logoUrl?: string | null }>(`/tenants/branding?subdomain=${encodeURIComponent(sub)}`)
      .then((res) => {
        if (res.found && res.name) setBranding({ name: res.name, logoUrl: res.logoUrl ?? null });
      })
      .catch(() => {});
  }, []);

  useEffect(() => () => { if (successTimer.current) window.clearTimeout(successTimer.current); }, []);

  const emailError = touched && !EMAIL_RE.test(email) ? "Enter a valid email address." : null;
  const passwordError = mode === "signin" && touched && !password ? "Enter your password." : null;
  const formValid = EMAIL_RE.test(email) && (mode !== "signin" || password.length > 0);

  function finishLogin(u: SessionUser) {
    setSucceeded(true);
    const delay = reduce ? 0 : 550; // ~300ms checkmark + settle, skippable
    successTimer.current = window.setTimeout(() => onLogin(u), delay);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    setError(null);
    if (!formValid) return;
    setBusy(true);
    try {
      if (mode === "signin") {
        const res = await api.post<{ user: SessionUser }>("/auth/login", { email, password });
        finishLogin(res.user);
      } else {
        const path = mode === "magic" ? "/auth/magic-link" : "/auth/forgot-password";
        const res = await api.post<{ ok: boolean; message: string; devLink?: string }>(path, { email });
        setSentLink({ message: res.message, devLink: res.devLink });
      }
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Unable to sign in.";
      const code = err instanceof ApiError ? err.code : "";
      const invalid = message.toLowerCase().includes("invalid") || code === "invalid_credentials";
      setError({
        message,
        action: mode === "signin" && invalid ? "magic" : undefined,
      });
    } finally {
      setBusy(false);
    }
  }

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setSentLink(null);
    setTouched(false);
  }

  return (
    <div className="flex min-h-screen bg-background">
      <AuthBrandPanel tenantName={branding?.name ?? null} tenantLogoUrl={branding?.logoUrl ?? null} />

      {/* Right panel — centered card */}
      <div className="relative flex flex-1 items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-[420px]">
          {/* Top-left compact brand (mobile) */}
          <div className="mb-6 flex items-center gap-2.5 lg:hidden">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10">
              <svg viewBox="0 0 24 24" className="h-4.5 w-4.5 text-primary" fill="currentColor" aria-hidden>
                <path d="M12 2a2 2 0 0 1 2 2v2h2a2 2 0 1 1 0 4h-2v10a2 2 0 1 1-4 0V10H8a2 2 0 1 1 0-4h2V4a2 2 0 0 1 2-2Z" />
              </svg>
            </div>
            <span className="font-display text-base font-semibold">ChurchOS</span>
          </div>

          <div className="relative">
            <AnimatePresence>
              {succeeded ? (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => { if (successTimer.current) window.clearTimeout(successTimer.current); }}
                  className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-surface/80 backdrop-blur-sm"
                  aria-hidden
                >
                  <motion.span
                    initial={{ scale: 0.4, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ duration: reduce ? 0.1 : 0.3, ease: [0.16, 1, 0.3, 1] }}
                    className="flex h-14 w-14 items-center justify-center rounded-full bg-success text-white shadow-lg"
                  >
                    <Check className="h-7 w-7" strokeWidth={2.5} />
                  </motion.span>
                </motion.div>
              ) : null}
            </AnimatePresence>

            <div className="rounded-2xl border bg-surface p-8 shadow-lg sm:p-10">
              {branding ? <TenantChip name={branding.name} logoUrl={branding.logoUrl} /> : null}

              {mode === "signin" ? (
                <>
                  <div className="mb-6">
                    <h2 className="font-display text-2xl font-semibold text-ink">Welcome back</h2>
                    <p className="mt-1 text-sm text-ink-secondary">
                      {branding ? `Sign in to your ${branding.name} account.` : "Sign in to your church workspace."}{" "}
                      <FindChurchLink onFound={(b) => setBranding(b)} />
                    </p>
                  </div>

                  <form onSubmit={submit} className="space-y-4" noValidate>
                    <Field id="email" label="Email" error={emailError}>
                      <Input
                        id="email"
                        type="email"
                        autoComplete="username"
                        placeholder="you@church.org"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        aria-invalid={!!emailError || undefined}
                      />
                    </Field>

                    <Field
                      id="password"
                      label="Password"
                      error={passwordError}
                      trailing={
                        <button
                          type="button"
                          onClick={() => switchMode("forgot")}
                          className="text-xs font-medium text-primary underline-offset-4 hover:underline"
                        >
                          Forgot password?
                        </button>
                      }
                    >
                      <div className="relative">
                        <Input
                          id="password"
                          type={showPassword ? "text" : "password"}
                          autoComplete="current-password"
                          placeholder="Your password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          className="pr-10"
                          aria-invalid={!!passwordError || undefined}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((v) => !v)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-ink-muted transition-colors hover:bg-accent hover:text-ink-secondary"
                          aria-label={showPassword ? "Hide password" : "Show password"}
                        >
                          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </Field>

                    {error ? (
                      <div className="flex items-start gap-2.5 rounded-lg border border-danger/25 bg-danger-bg p-3 text-sm text-danger" role="alert">
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                        <div className="space-y-1.5">
                          <p className="leading-snug">{error.message}</p>
                          {error.action === "magic" ? (
                            <button
                              type="button"
                              onClick={() => { setError(null); setMode("magic"); }}
                              className="inline-flex items-center gap-1 text-xs font-semibold underline underline-offset-2"
                            >
                              <Wand2 className="h-3 w-3" aria-hidden /> Sign in with a magic link instead
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ) : null}

                    <Button type="submit" className="w-full" size="lg" loading={busy} disabled={!formValid}>
                      Sign in
                    </Button>

                    <div className="relative py-1 text-center">
                      <div className="absolute inset-0 flex items-center" aria-hidden>
                        <span className="w-full border-t" />
                      </div>
                      <span className="relative bg-surface px-3 text-[11px] font-medium uppercase tracking-wider text-ink-muted">
                        or
                      </span>
                    </div>

                    <Button type="button" variant="outline" className="w-full" onClick={() => switchMode("magic")}>
                      <Mail className="h-4 w-4" aria-hidden /> Email me a one-time sign-in link
                    </Button>
                  </form>
                </>
              ) : (
                <MagicOrForgot
                  mode={mode}
                  email={email}
                  setEmail={setEmail}
                  emailError={emailError}
                  busy={busy}
                  sent={sentLink}
                  error={error?.message ?? null}
                  onSubmit={submit}
                  onBack={() => switchMode("signin")}
                />
              )}
            </div>
          </div>

          {/* Secondary actions */}
          <div className="mt-5 space-y-3">
            <div className="flex items-center justify-center gap-1.5 text-sm text-ink-secondary">
              <span>New church?</span>
              {onSignup ? (
                <button type="button" onClick={onSignup} className="inline-flex items-center gap-1 font-semibold text-primary underline-offset-4 hover:underline">
                  <UserPlus className="h-3.5 w-3.5" aria-hidden /> Create your ChurchOS account
                </button>
              ) : null}
            </div>
            {onPartner ? (
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={onPartner}
                  className="inline-flex items-center gap-1.5 rounded-full border bg-surface px-3.5 py-1.5 text-xs font-medium text-ink-secondary shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  <Store className="h-3.5 w-3.5" aria-hidden /> Partner Portal — manage churches &amp; licenses
                </button>
              </div>
            ) : null}
            <div className="flex justify-center pt-1">
              <ThemeSwitcher variant="compact" />
            </div>
          </div>

          {/* Demo accounts — local build convenience, collapsed by default */}
          <div className="mt-6 rounded-xl border bg-surface shadow-xs">
            <button
              type="button"
              onClick={() => setDemoOpen((v) => !v)}
              aria-expanded={demoOpen}
              className="flex w-full items-center justify-between px-4 py-3 text-left text-xs font-medium text-ink-secondary transition-colors hover:bg-accent/60"
            >
              Demo accounts — each sees a different view
              <ChevronDown className={`h-4 w-4 transition-transform ${demoOpen ? "rotate-180" : ""}`} aria-hidden />
            </button>
            {demoOpen ? (
              <div className="grid grid-cols-1 gap-1.5 border-t p-3 sm:grid-cols-2">
                {DEMO_ACCOUNTS.map((a) => (
                  <button
                    key={a.email}
                    type="button"
                    onClick={() => { setEmail(a.email); setPassword(DEMO_PASSWORD); switchMode("signin"); }}
                    className="row-hover rounded-lg border px-3 py-2 text-left transition-colors"
                  >
                    <span className="block text-xs font-medium text-ink">{a.role}</span>
                    <span className="block truncate text-[11px] text-ink-muted">{a.email}</span>
                  </button>
                ))}
                <p className="col-span-full pt-1 text-[11px] text-ink-muted">
                  Password for all demo accounts: <code className="rounded bg-surface-sunken px-1.5 py-0.5 text-[10px]">{DEMO_PASSWORD}</code>
                </p>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Magic-link / forgot-password sub-form (same card, sequential steps). */
function MagicOrForgot({
  mode, email, setEmail, emailError, busy, sent, error, onSubmit, onBack,
}: {
  mode: "magic" | "forgot";
  email: string;
  setEmail: (v: string) => void;
  emailError: string | null;
  busy: boolean;
  sent: { message: string; devLink?: string } | null;
  error: string | null;
  onSubmit: (e: React.FormEvent) => void;
  onBack: () => void;
}) {
  const isMagic = mode === "magic";
  return (
    <>
      <div className="mb-6">
        <button
          type="button"
          onClick={onBack}
          className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-ink-secondary transition-colors hover:text-ink"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Back to sign in
        </button>
        <h2 className="font-display text-2xl font-semibold text-ink">
          {isMagic ? "Sign in with a link" : "Reset your password"}
        </h2>
        <p className="mt-1 text-sm text-ink-secondary">
          {isMagic
            ? "We'll create a one-time sign-in link for your email — no password needed."
            : "Enter your email and we'll create a one-time link to set a new password."}
        </p>
      </div>

      {sent ? (
        <div className="space-y-4">
          <div className="flex items-start gap-2.5 rounded-lg border border-success/25 bg-success-bg p-3.5 text-sm" role="status">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
            <div className="space-y-2.5">
              <p className="leading-snug text-ink">{sent.message}</p>
              {sent.devLink ? (
                <Button type="button" size="sm" onClick={() => { window.location.href = sent.devLink!; }}>
                  <Link2 className="h-3.5 w-3.5" aria-hidden /> Open your one-time link
                </Button>
              ) : null}
              <p className="text-xs leading-relaxed text-ink-muted">
                This local build has no mail server, so the link is shown here instead of being emailed.
              </p>
            </div>
          </div>
          <Button type="button" variant="outline" className="w-full" onClick={onBack}>
            <X className="h-4 w-4" aria-hidden /> Close
          </Button>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <Field id="magic-email" label="Email" error={emailError}>
            <Input
              id="magic-email"
              type="email"
              autoComplete="username"
              placeholder="you@church.org"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={!!emailError || undefined}
            />
          </Field>
          {error ? (
            <div className="flex items-start gap-2.5 rounded-lg border border-danger/25 bg-danger-bg p-3 text-sm text-danger" role="alert">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <p className="leading-snug">{error}</p>
            </div>
          ) : null}
          <Button type="submit" className="w-full" size="lg" loading={busy} disabled={!EMAIL_RE.test(email)}>
            {isMagic ? "Create sign-in link" : "Create reset link"}
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          </Button>
        </form>
      )}
    </>
  );
}

/** "find your church" inline link + lookup dialog (root-domain sign-in). */
function FindChurchLink({ onFound }: { onFound: (b: Branding) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ name: string; logoUrl: string | null } | null>(null);
  const [notFound, setNotFound] = useState(false);

  async function lookup() {
    const host = query.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/:\d+$/, "");
    const parts = host.split(".");
    const sub = parts.length >= 3 ? parts[0] : host;
    if (!sub) return;
    setBusy(true);
    setNotFound(false);
    setResult(null);
    try {
      const res = await api.get<{ found: boolean; name?: string; logoUrl?: string | null }>(
        `/tenants/branding?subdomain=${encodeURIComponent(sub)}`
      );
      if (res.found && res.name) {
        setResult({ name: res.name, logoUrl: res.logoUrl ?? null });
      } else {
        setNotFound(true);
      }
    } catch {
      setNotFound(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button type="button" className="font-medium text-primary underline-offset-4 hover:underline">
          Find your church
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm" role="dialog" aria-label="Find your church">
        <DialogHeader>
          <DialogTitle className="font-display">Find your church</DialogTitle>
          <DialogDescription>
            Enter your church&apos;s ChurchOS web address (e.g. <span className="font-medium text-ink">grace.churchos.app</span>).
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="yourchurch.churchos.app"
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); lookup(); } }}
          />
          <Button type="button" onClick={lookup} loading={busy} disabled={!query.trim()}>
            <Search className="h-4 w-4" aria-hidden /> Look up
          </Button>
        </div>
        {result ? (
          <div className="flex items-center justify-between rounded-xl border bg-surface-sunken p-3">
            <div className="flex items-center gap-2.5">
              <Building2 className="h-4 w-4 text-primary" aria-hidden />
              <span className="text-sm font-medium text-ink">{result.name}</span>
            </div>
            <Button
              type="button"
              size="sm"
              onClick={() => { onFound(result); setOpen(false); setResult(null); setQuery(""); }}
            >
              Sign in here
            </Button>
          </div>
        ) : null}
        {notFound ? (
          <p className="text-sm text-danger" role="alert">
            No church found at that address — check the spelling or ask your church admin.
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
