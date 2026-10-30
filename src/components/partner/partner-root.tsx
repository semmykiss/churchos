"use client";

/**
 * PartnerRoot — vendor console bootstrap: partner session gate + shell.
 * Completely separate from the church app session (different cookie + table).
 */
import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
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

function PartnerInner({ onBack }: { onBack: () => void }) {
  const queryClient = useQueryClient();
  const [partner, setPartner] = useState<PartnerPrincipal | null>(null);
  const [booting, setBooting] = useState(true);
  const [tab, setTab] = useState<TabKey>("overview");
  const [manageLicenseId, setManageLicenseId] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ partner: PartnerPrincipal | null }>("/partner/auth/me")
      .then((res) => setPartner(res.partner))
      .catch(() => setPartner(null))
      .finally(() => setBooting(false));
  }, []);

  async function logout() {
    try {
      await api.post("/partner/auth/logout");
    } finally {
      queryClient.clear();
      setPartner(null);
      setTab("overview");
    }
  }

  if (booting) {
    return <div className="flex min-h-screen items-center justify-center"><LoadingBlock label="Opening partner console…" /></div>;
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
                <Store className="h-4.5 w-4.5" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold leading-tight">Grace ChMS — Partner Console</p>
                <p className="truncate text-xs text-muted-foreground">{partner.name} · {partner.email}</p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Button variant="ghost" size="sm" onClick={onBack} className="hidden sm:inline-flex">
                <ArrowLeft className="h-4 w-4" /> Church app
              </Button>
              <Button variant="ghost" size="sm" onClick={logout}>
                <LogOut className="h-4 w-4" /> Sign out
              </Button>
            </div>
          </div>
          <nav aria-label="Partner navigation" className="flex gap-1 overflow-x-auto">
            {TABS.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  "flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors",
                  tab === t.key
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <t.icon className="h-4 w-4" /> {t.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
        {tab === "overview" ? <PartnerOverview onOpenLicense={setManageLicenseId} /> : null}
        {tab === "tenants" ? <PartnerTenants onManage={setManageLicenseId} /> : null}
        {tab === "licenses" ? <PartnerLicenses onManage={setManageLicenseId} /> : null}
        {tab === "compliance" ? <PartnerCompliance /> : null}
      </main>

      <footer className="mt-auto border-t bg-muted/40">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-1 px-4 py-3 text-center text-[11px] text-muted-foreground sm:flex-row sm:px-6 sm:text-left">
          <span>Partner Console · vendor layer · data stored on this machine (SQLite)</span>
          <span>Signed in as {partner.name}</span>
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
        defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 10_000 } },
      }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <PartnerInner onBack={onBack} />
    </QueryClientProvider>
  );
}
