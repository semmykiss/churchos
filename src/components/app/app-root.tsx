"use client";

/**
 * AppRoot — session bootstrap, login gate, module switching.
 * Also: theme persistence (per-user), and single-use deep-link auth
 * (?magic=<token> sign-in, ?reset=<token> password reset) parsed once on boot.
 */
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { SessionUser } from "@/lib/types";
import LoginScreen from "@/components/app/login-screen";
import AppShell from "@/components/app/app-shell";
import PartnerRoot from "@/components/partner/partner-root";
import { modulesFor } from "@/components/app/module-registry";
import { LoadingBlock } from "@/components/app/shared";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider, useTheme, parseUserTheme } from "@/components/app/theme/theme";
import ResetPasswordScreen from "@/components/app/reset-password-screen";

// Tenant onboarding — the signup wizard is lazy-loaded so it never affects
// the initial bundle of any other surface (same pattern as Shepherd's launcher).
const SignupWizard = dynamic(() => import("@/components/app/signup/SignupWizard"), { ssr: false });

// Shepherd AI — the single additive element in the root layout (spec §10):
// lazy-loaded so it never affects any other module's initial bundle.
const AiLauncherButton = dynamic(() => import("@/components/app/ai-assistant/AiLauncherButton"), { ssr: false });

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 15_000 },
  },
});

function Inner() {
  const theme = useTheme();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [booting, setBooting] = useState(true);
  // Hash deep-links (Phase 4): #/people/:id opens straight into the People CRM
  // profile — the module itself reads the id from the hash on mount.
  const [active, setActive] = useState(() =>
    typeof window !== "undefined" && /^#\/people\b/.test(window.location.hash) ? "people" : "dashboard"
  );
  const [view, setView] = useState<"church" | "partner" | "signup">("church");

  const moduleForHash = () =>
    typeof window !== "undefined" && /^#\/people\b/.test(window.location.hash) ? "people" : null;

  // Deep-link auth states (single-use tokens from email-style links)
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [magicBusy, setMagicBusy] = useState(false);
  const [magicError, setMagicError] = useState<string | null>(null);
  const magicGuard = useRef(false);

  function afterLogin(u: SessionUser) {
    setActive(moduleForHash() ?? modulesFor(u)[0]?.key ?? "portal");
    setUser(u);
    theme.attachUser(parseUserTheme(u.preferences));
  }

  useEffect(() => {
    // Parse single-use tokens once, then scrub them from the URL immediately
    // so links don't linger in the address bar or browser history.
    const params = new URLSearchParams(window.location.search);
    const magic = params.get("magic");
    const reset = params.get("reset");
    if (magic || reset) window.history.replaceState({}, "", window.location.pathname);

    if (reset) setResetToken(reset);
    if (magic && !magicGuard.current) {
      magicGuard.current = true;
      setMagicBusy(true);
      api
        .post<{ user: SessionUser }>("/auth/magic-verify", { token: magic })
        .then((res) => afterLogin(res.user))
        .catch(() => setMagicError("This sign-in link is invalid, already used, or expired. Request a fresh one below."))
        .finally(() => setMagicBusy(false));
    }

    api.get<{ user: SessionUser | null }>("/auth/me")
      .then((res) => {
        setUser(res.user);
        if (res.user) {
          const first = modulesFor(res.user)[0];
          setActive(moduleForHash() ?? first?.key ?? "portal");
          theme.attachUser(parseUserTheme(res.user.preferences));
        }
      })
      .catch(() => setUser(null))
      .finally(() => setBooting(false));
     
  }, []);

  // Access-control changes (role edits, assignments) dispatch this event so the
  // session + navigation refresh immediately without a full page reload.
  useEffect(() => {
    const refresh = () => {
      api.get<{ user: SessionUser | null }>("/auth/me")
        .then((res) => setUser(res.user))
        .catch(() => {});
    };
    window.addEventListener("chms:session-refresh", refresh);
    return () => window.removeEventListener("chms:session-refresh", refresh);
  }, []);

  async function logout() {
    try {
      await api.post("/auth/logout");
    } finally {
      theme.detachUser();
      queryClient.clear();
      setUser(null);
      setActive("dashboard");
    }
  }

  if (booting || magicBusy) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <LoadingBlock label={magicBusy ? "Signing you in…" : "Starting ChurchOS…"} />
      </div>
    );
  }

  if (!user) {
    if (resetToken) {
      return <ResetPasswordScreen token={resetToken} onDone={() => setResetToken(null)} />;
    }
    if (view === "signup") {
      return <SignupWizard onBack={() => setView("church")} />;
    }
    if (view === "partner") {
      return <PartnerRoot onBack={() => setView("church")} />;
    }
    return (
      <LoginScreen
        onLogin={afterLogin}
        onPartner={() => setView("partner")}
        onSignup={() => setView("signup")}
        initialNotice={magicError ?? undefined}
      />
    );
  }

  const mods = modulesFor(user);
  const Current = (mods.find((m) => m.key === active) ?? mods[0]).component;

  return (
    <>
      <AppShell user={user} active={active} onNavigate={setActive} onLogout={logout}>
        <Current key={active} user={user} />
      </AppShell>
      <AiLauncherButton user={user} />
    </>
  );
}

export default function AppRoot() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <Inner />
        <Toaster position="top-right" richColors closeButton />
      </QueryClientProvider>
    </ThemeProvider>
  );
}
