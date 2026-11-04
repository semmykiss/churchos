"use client";

/**
 * PartnerRoot — vendor console bootstrap: partner session gate + shell.
 * Completely separate from the church app session (different cookie + table).
 *
 * Security-audit behaviour implemented here:
 *  - Session gate: on mount we ask `/partner/auth/me`; until it resolves a
 *    centered loading state is shown. Without a partner principal the login
 *    screen renders — no tab content or data fetches leak to signed-out users.
 *  - 401 handling: a single QueryCache/MutationCache `onError` watches every
 *    react-query request. Any 401 (expired/revoked partner session) dispatches
 *    the `partner:session-expired` window event, which drops the principal,
 *    clears the whole query cache (no cross-session data reuse) and toasts a
 *    re-sign-in notice. Queries never retry on 401.
 *  - Hash-based tabs: the active tab lives in the URL hash
 *    (`#/partner/<key>`), so deep links survive refresh and browser back/forward
 *    (popstate) without server round-trips. The tablist follows the WAI-ARIA
 *    roving-tabindex pattern (ArrowLeft/ArrowRight/Home/End).
 *  - Mutations never auto-retry (onboarding, renewals, deletions must never
 *    fire twice); queries retry at most once and never on auth failures.
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import type { PartnerPrincipal } from "@/lib/types";
import PartnerLogin from "@/components/partner/partner-login";
import PartnerOverview from "@/components/partner/partner-overview";
import PartnerTenants from "@/components/partner/partner-tenants";
import PartnerLicenses, { LicenseManageDialog } from "@/components/partner/partner-licenses";
import { PartnerCompliance } from "@/components/partner/partner-compliance";
import { LoadingBlock } from "@/components/app/shared";
import { Button } from "@/components/ui/button";
import { Store, LayoutDashboard, Building2, KeyRound, ShieldCheck, LogOut, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { key: "overview", label: "Overview", icon: LayoutDashboard },
  { key: "tenants", label: "Church tenants", icon: Building2 },
  { key: "licenses", label: "Licenses", icon: KeyRound },
  { key: "compliance", label: "Compliance", icon: ShieldCheck },
] as const;

type TabKey = (typeof TABS)[number]["key"];
const TAB_KEYS: TabKey[] = TABS.map((t) => t.key);

/** Window event fired whenever a partner API call comes back 401. */
const SESSION_EXPIRED = "partner:session-expired";

/**
 * Resolve the active tab from the URL hash, defaulting to "overview".
 * Server-render safe (returns the default when `window` is absent).
 */
function tabFromHash(): TabKey {
  if (typeof window === "undefined") return "overview";
  const match = /^#\/partner\/(\w+)/.exec(window.location.hash);
  const key = match?.[1] as TabKey | undefined;
  return key && TAB_KEYS.includes(key) ? key : "overview";
}

/** Funnel every react-query error through here: 401 ends the partner session. */
function handleApiError(err: unknown) {
  if (err instanceof ApiError && err.status === 401) {
    window.dispatchEvent(new Event(SESSION_EXPIRED));
  }
}

function PartnerInner({ onBack }: { onBack: () => void }) {
  const queryClient = useQueryClient();
  const [partner, setPartner] = useState<PartnerPrincipal | null>(null);
  const [booting, setBooting] = useState(true);
  // Initial tab comes straight from the URL hash. PartnerInner only mounts
  // client-side (after the church sign-in screen's "Partner console" click),
  // so reading the hash here is hydration-safe — no sync setState needed in
  // the mount effect below.
  const [tab, setTabState] = useState<TabKey>(() => tabFromHash());
  const [manageLicenseId, setManageLicenseId] = useState<string | null>(null);
  const tabRefs = useRef<Partial<Record<TabKey, HTMLButtonElement | null>>>({});

  /** Switch tabs and keep the URL hash in sync (no history spam). */
  const setTab = useCallback((t: TabKey) => {
    setTabState(t);
    window.history.replaceState(null, "", `#/partner/${t}`);
  }, []);

  useEffect(() => {
    const onPopState = () => setTabState(tabFromHash());
    const onSessionExpired = () => {
      setPartner(null);
      queryClient.clear();
      // Flags the login screen's "session ended" notice (read + cleared there).
      try {
        sessionStorage.setItem("partner:session-ended", "1");
      } catch {
        // Storage unavailable (private mode etc.) — the toast below still fires.
      }
      // Stable id — sonner dedupes by id, so N concurrent 401s toast only once.
      toast.info("Your partner session has ended. Please sign in again.", { id: "partner-session-expired" });
    };
    window.addEventListener("popstate", onPopState);
    window.addEventListener(SESSION_EXPIRED, onSessionExpired);

    api
      .get<{ partner: PartnerPrincipal | null }>("/partner/auth/me")
      .then((res) => setPartner(res.partner))
      .catch(() => setPartner(null))
      .finally(() => setBooting(false));

    return () => {
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener(SESSION_EXPIRED, onSessionExpired);
    };
  }, [queryClient]);

  async function logout() {
    await api.post("/partner/auth/logout").catch(() => undefined);
    queryClient.clear();
    setPartner(null);
    setTab("overview");
  }

  /** WAI-ARIA roving tabindex: ArrowRight/ArrowLeft cycle, Home/End jump. */
  function onTabListKey(e: KeyboardEvent<HTMLDivElement>) {
    const idx = TAB_KEYS.indexOf(tab);
    let next: TabKey | undefined;
    if (e.key === "ArrowRight") next = TAB_KEYS[(idx + 1) % TAB_KEYS.length];
    else if (e.key === "ArrowLeft") next = TAB_KEYS[(idx - 1 + TAB_KEYS.length) % TAB_KEYS.length];
    else if (e.key === "Home") next = TAB_KEYS[0];
    else if (e.key === "End") next = TAB_KEYS[TAB_KEYS.length - 1];
    if (!next) return;
    e.preventDefault();
    setTab(next);
    tabRefs.current[next]?.focus();
  }

  if (booting) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <LoadingBlock label="Opening partner console…" />
      </div>
    );
  }

  if (!partner) {
    return <PartnerLogin onLogin={(p) => setPartner(p)} onBack={onBack} />;
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="brand-gradient flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-primary-foreground">
                <Store className="h-4.5 w-4.5" aria-hidden />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold leading-tight">Grace ChMS · Partner console</p>
                <p className="truncate text-xs text-muted-foreground">{partner.name} · {partner.email}</p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Button variant="ghost" size="sm" onClick={onBack} className="hidden sm:inline-flex">
                <ArrowLeft className="h-4 w-4" aria-hidden /> Church app
              </Button>
              <Button variant="ghost" size="sm" onClick={logout}>
                <LogOut className="h-4 w-4" aria-hidden /> Sign out
              </Button>
            </div>
          </div>
          <div
            role="tablist"
            aria-label="Partner sections"
            onKeyDown={onTabListKey}
            className="scroll-slim -mx-1 flex gap-1 overflow-x-auto px-1"
          >
            {TABS.map((t) => {
              const selected = tab === t.key;
              return (
                <button
                  key={t.key}
                  ref={(el) => {
                    tabRefs.current[t.key] = el;
                  }}
                  type="button"
                  role="tab"
                  id={`tab-${t.key}`}
                  aria-selected={selected}
                  aria-controls={`panel-${t.key}`}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => setTab(t.key)}
                  className={cn(
                    "flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                    selected
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <t.icon className="h-4 w-4" aria-hidden /> {t.label}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
        <div
          role="tabpanel"
          id={`panel-${tab}`}
          aria-labelledby={`tab-${tab}`}
          tabIndex={0}
          className="outline-none"
        >
          {tab === "overview" ? <PartnerOverview onOpenLicense={setManageLicenseId} /> : null}
          {tab === "tenants" ? <PartnerTenants onManage={setManageLicenseId} /> : null}
          {tab === "licenses" ? <PartnerLicenses onManage={setManageLicenseId} /> : null}
          {tab === "compliance" ? <PartnerCompliance /> : null}
        </div>
      </main>

      <footer className="mt-auto border-t">
        <div className="mx-auto max-w-7xl px-4 py-3 text-xs text-muted-foreground sm:px-6">
          Grace ChMS partner console · all actions are audit-logged
        </div>
      </footer>

      <LicenseManageDialog licenseId={manageLicenseId} onClosed={() => setManageLicenseId(null)} />
    </div>
  );
}

export default function PartnerRoot({ onBack }: { onBack: () => void }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        queryCache: new QueryCache({ onError: handleApiError }),
        mutationCache: new MutationCache({ onError: handleApiError }),
        defaultOptions: {
          queries: {
            staleTime: 10_000,
            refetchOnWindowFocus: false,
            retry: (count, err) => !(err instanceof ApiError && err.status === 401) && count < 1,
          },
          // Never auto-retry onboarding / renewals / deletions — a retried
          // mutation could double-charge or double-issue a license.
          mutations: { retry: false },
        },
      }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <PartnerInner onBack={onBack} />
    </QueryClientProvider>
  );
}
