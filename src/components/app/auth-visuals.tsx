"use client";

/**
 * Shared visuals for the auth surfaces (sign-in / forgot / reset).
 * Left panel: full-bleed ambient gradient mesh (theme primary + accent),
 * slow CSS animation, frozen under prefers-reduced-motion. Right side hosts
 * the centered card (rendered by each screen).
 */
import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Church, Quote, Sparkles, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

interface RotatingSlide {
  kind: "verse" | "stat" | "quote";
  text: string;
  attribution?: string;
}

const SLIDES: RotatingSlide[] = [
  { kind: "verse", text: "Let all that you do be done in love.", attribution: "1 Corinthians 16:14" },
  {
    kind: "stat",
    text: "Check-in, giving, volunteers, care and reporting — one calm system for the whole week, not five spreadsheets.",
    attribution: "Everything in one place",
  },
  {
    kind: "quote",
    text: "Sunday runs like a well-rehearsed service — and the rest of the week just as smoothly.",
    attribution: "Designed for churches of 200",
  },
];

/** Slow crossfade of the rotating element every 6s (spec §5). */
export function RotatingShowcase({ className }: { className?: string }) {
  const [index, setIndex] = useState(0);
  const reduce = useReducedMotion();

  useEffect(() => {
    const id = window.setInterval(() => setIndex((i) => (i + 1) % SLIDES.length), 6000);
    return () => window.clearInterval(id);
  }, []);

  const slide = SLIDES[index];
  const Icon = slide.kind === "verse" ? Quote : slide.kind === "stat" ? TrendingUp : Sparkles;

  return (
    <div className={cn("relative min-h-28", className)} aria-live="polite">
      <AnimatePresence mode="wait">
        <motion.div
          key={index}
          initial={{ opacity: 0, y: reduce ? 0 : 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: reduce ? 0 : -8 }}
          transition={{ duration: reduce ? 0.15 : 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="rounded-2xl border border-white/15 bg-white/10 p-4 backdrop-blur-sm"
        >
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/15">
              <Icon className="h-3.5 w-3.5" aria-hidden />
            </span>
            <div>
              <p className="text-sm leading-relaxed text-white/90">{slide.text}</p>
              {slide.attribution ? (
                <p className="mt-1.5 text-xs font-medium uppercase tracking-wider text-white/60">{slide.attribution}</p>
              ) : null}
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

/**
 * The left brand panel (desktop ≥lg) — gradient mesh, wordmark, headline,
 * rotating showcase, "Powered by ChurchOS" badge.
 */
export function AuthBrandPanel({
  tenantName,
  tenantLogoUrl,
}: {
  tenantName?: string | null;
  tenantLogoUrl?: string | null;
}) {
  return (
    <div className="relative hidden overflow-hidden lg:flex lg:w-[45%] lg:shrink-0 lg:flex-col lg:justify-between">
      {/* Ambient gradient mesh (purely decorative) */}
      <div className="brand-gradient absolute inset-0" aria-hidden />
      <div
        className="mesh-blob-a absolute -left-24 top-8 h-96 w-96 rounded-full opacity-50 blur-3xl"
        style={{ background: "var(--accent-decorative)" }}
        aria-hidden
      />
      <div
        className="mesh-blob-b absolute bottom-[-6rem] right-[-4rem] h-[28rem] w-[28rem] rounded-full opacity-40 blur-3xl"
        style={{ background: "#ffffff" }}
        aria-hidden
      />

      <div className="relative flex flex-1 flex-col justify-between p-10 text-white xl:p-14">
        {/* Tenant logo slot (white-label ready) or ChurchOS wordmark */}
        <div className="flex items-center gap-3">
          {tenantLogoUrl ? (
            <img src={tenantLogoUrl} alt="" className="h-10 w-10 rounded-xl object-cover" />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 backdrop-blur-sm">
              <Church className="h-5 w-5" aria-hidden />
            </div>
          )}
          <div>
            <p className="font-display text-lg font-semibold leading-tight">{tenantName ?? "ChurchOS"}</p>
            <p className="text-xs text-white/70">Church Management Platform</p>
          </div>
        </div>

        <div className="max-w-lg space-y-6">
          <h1 className="font-display text-4xl font-bold leading-[1.15] text-white">
            Run your church with clarity.
          </h1>
          <RotatingShowcase />
        </div>

        <div className="flex items-end justify-between">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-medium text-white/85 backdrop-blur-sm">
            Powered by ChurchOS
          </span>
          <p className="text-[11px] text-white/50">Local build · SQLite · data stays on this machine</p>
        </div>
      </div>
    </div>
  );
}

/** Small tenant-awareness chip shown above the sign-in form on a subdomain. */
export function TenantChip({ name, logoUrl }: { name: string; logoUrl?: string | null }) {
  return (
    <div className="mx-auto mb-5 flex items-center justify-center gap-2 rounded-full border bg-surface-sunken px-3.5 py-1.5 text-xs font-medium text-ink-secondary shadow-xs">
      {logoUrl ? (
         
        <img src={logoUrl} alt="" className="h-4 w-4 rounded-full object-cover" />
      ) : (
        <Church className="h-3.5 w-3.5 text-primary" aria-hidden />
      )}
      Signing in to <span className="font-semibold text-ink">{name}</span>
    </div>
  );
}
