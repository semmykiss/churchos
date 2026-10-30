"use client";

/**
 * AppRoot — session bootstrap, login gate, module switching.
 */
import { useEffect, useState } from "react";
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
  const [user, setUser] = useState<SessionUser | null>(null);
  const [booting, setBooting] = useState(true);
  const [active, setActive] = useState("dashboard");
  const [view, setView] = useState<"church" | "partner" | "signup">("church");

  useEffect(() => {
    api.get<{ user: SessionUser | null }>("/auth/me")
      .then((res) => {
        setUser(res.user);
        if (res.user) {
          const first = modulesFor(res.user)[0];
          setActive(first?.key ?? "portal");
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
      queryClient.clear();
      setUser(null);
      setActive("dashboard");
    }
  }

  if (booting) {
    return <div className="flex min-h-screen items-center justify-center"><LoadingBlock label="Starting Grace ChMS…" /></div>;
  }

  if (!user) {
    if (view === "signup") {
      return (
        <SignupWizard
          onBack={() => setView("church")}
        />
      );
    }
    if (view === "partner") {
      return (
        <PartnerRoot
          onBack={() => setView("church")}
        />
      );
    }
    return (
      <LoginScreen
        onLogin={(u) => { setActive(modulesFor(u)[0]?.key ?? "portal"); setUser(u); }}
        onPartner={() => setView("partner")}
        onSignup={() => setView("signup")}
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
    <QueryClientProvider client={queryClient}>
      <Inner />
      <Toaster position="bottom-right" richColors />
    </QueryClientProvider>
  );
}
