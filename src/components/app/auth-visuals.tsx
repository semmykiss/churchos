"use client";

/**
 * Shared visuals for the auth surfaces (sign-in / reset / partner).
 *
 * 2026 refresh — reference-style split card: the form lives on the white left
 * side; the right side is this deep theme-gradient visual panel with a
 * floating "app in action" mockup cluster, a two-tone-feel headline, a slow
 * rotating tagline and carousel dots (mirrors the marketing mock).
 *
 * The panel is purely decorative and aria-hidden — everything a screen reader
 * needs lives in the form side. Theme-safe: light/midnight/harvest use the
 * primary gradient; high-contrast forces black via the globals.css override.
 */
import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Church, MapPin, Store, TrendingUp, Users } from "lucide-react";
import { cn } from "@/lib/utils";

const CHURCH_TAGLINES = [
  "Check-in, giving, volunteers and care — one calm system for the whole week.",
  "Attendance and giving trends, clear the moment service ends.",
  "Shepherd AI drafts rotas, sermons and board reports — you stay in command.",
];

const PARTNER_TAGLINES = [
  "Every church tenant, license health and recurring revenue — across all deployments.",
  "Issue, suspend and renew licenses without ever touching church data.",
];

/** Slow index rotation for the tagline + dots. Freezes under reduced motion. */
function useRotatingIndex(count: number, ms = 6000): number {
  const [index, setIndex] = useState(0);
  const reduce = useReducedMotion();
  useEffect(() => {
    if (reduce || count <= 1) return;
    const id = window.setInterval(() => setIndex((i) => (i + 1) % count), ms);
    return () => window.clearInterval(id);
  }, [count, ms, reduce]);
  return index;
}

/** Small stat chip used across the mockup cluster. */
function FloatChip({
  className, icon, title, sub,
}: {
  className?: string;
  icon: React.ReactNode;
  title: string;
  sub: string;
}) {
  return (
    <div
      className={cn(
        "absolute rounded-2xl border border-white/25 bg-white/12 p-3 shadow-xl backdrop-blur-md",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/20">{icon}</span>
        <div>
          <p className="text-sm font-semibold leading-none text-white">{title}</p>
          <p className="mt-1 text-[10px] font-medium uppercase tracking-wider text-white/70">{sub}</p>
        </div>
      </div>
    </div>
  );
}

/** Mini "Sunday attendance" phone-style card (church variant centerpiece). */
function AttendanceMock() {
  const bars = [42, 58, 48, 72, 60, 84, 66];
  return (
    <div className="absolute left-1/2 top-1/2 w-52 -translate-x-1/2 -translate-y-[60%] rotate-2 rounded-[1.6rem] border border-white/25 bg-white/12 p-4 shadow-2xl backdrop-blur-md sm:w-56">
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-white/50 to-white/15 text-[10px] font-bold text-white">
          EA
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-white">Sunday Live</p>
          <p className="text-[10px] text-white/65">Main Campus · 9:00 AM</p>
        </div>
        <span className="flex gap-0.5">
          {[0, 1, 2].map((i) => (
            <span key={i} className="h-1 w-1 rounded-full bg-white/70" />
          ))}
        </span>
      </div>
      <p className="mt-3.5 text-[10px] font-semibold uppercase tracking-wider text-white/70">
        Attendance — last 7 services
      </p>
      <div className="mt-2 flex h-16 items-end gap-1.5" aria-hidden>
        {bars.map((h, i) => (
          <span
            key={i}
            style={{ height: `${h}%` }}
            className={cn("w-full rounded-full", i === bars.length - 1 ? "bg-white" : "bg-white/55")}
          />
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between rounded-xl bg-white/15 px-2.5 py-1.5">
        <span className="text-[11px] font-medium text-white/85">Checked in</span>
        <span className="text-[11px] font-bold text-white">248 · +12%</span>
      </div>
    </div>
  );
}

/** Mini tenant-list card (partner variant centerpiece). */
function TenantsMock() {
  const rows = [
    { name: "Redeem Baptist Church", plan: "Trial", initials: "RB" },
    { name: "Grace Chapel", plan: "Growth", initials: "GC" },
    { name: "Covenant Assembly", plan: "Starter", initials: "CA" },
  ];
  return (
    <div className="absolute left-1/2 top-1/2 w-56 -translate-x-1/2 -translate-y-[60%] rotate-2 rounded-[1.4rem] border border-white/25 bg-white/12 p-3.5 shadow-2xl backdrop-blur-md sm:w-60">
      <div className="flex items-center justify-between px-1 pb-2.5">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-white/70">Church tenants</p>
        <span className="rounded-full bg-white/20 px-1.5 py-0.5 text-[9px] font-bold text-white">24</span>
      </div>
      <div className="space-y-1.5">
        {rows.map((r) => (
          <div key={r.name} className="flex items-center gap-2.5 rounded-xl bg-white/12 px-2.5 py-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-white/50 to-white/15 text-[9px] font-bold text-white">
              {r.initials}
            </span>
            <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-white">{r.name}</span>
            <span className="rounded-full border border-white/25 px-1.5 py-0.5 text-[9px] font-semibold text-white/85">
              {r.plan}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The reference-style visual panel — place as the right column of the split
 * auth card. Entirely decorative; hidden below `lg` by the caller.
 */
export function AuthVisualPanel({
  tenantName,
  tenantLogoUrl,
  variant = "church",
  className,
}: {
  tenantName?: string | null;
  tenantLogoUrl?: string | null;
  variant?: "church" | "partner";
  className?: string;
}) {
  const isChurch = variant === "church";
  const taglines = isChurch ? CHURCH_TAGLINES : PARTNER_TAGLINES;
  const index = useRotatingIndex(taglines.length);
  const brandName = isChurch ? tenantName ?? "ChurchOS" : "Partner Console";

  return (
    <div
      className={cn("relative overflow-hidden bg-primary text-primary-foreground", className)}
      aria-hidden
    >
      {/* Deep theme gradient + ambient blobs (contrast theme → black, CSS override) */}
      <div className="brand-gradient absolute inset-0" />
      <div
        className="mesh-blob-a absolute -left-24 top-8 h-96 w-96 rounded-full opacity-50 blur-3xl"
        style={{ background: "var(--accent-decorative)" }}
      />
      <div className="mesh-blob-b absolute bottom-[-6rem] right-[-4rem] h-[26rem] w-[26rem] rounded-full opacity-40 blur-3xl" style={{ background: "#ffffff" }} />

      <div className="relative flex h-full min-h-[560px] flex-col p-9 xl:p-11">
        {/* Top — tenant/logo slot (white-label ready) */}
        <div className="flex items-center gap-3">
          {tenantLogoUrl ? (
            <img src={tenantLogoUrl} alt="" className="h-10 w-10 rounded-xl object-cover" />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 backdrop-blur-sm">
              {isChurch ? <Church className="h-5 w-5" /> : <Store className="h-5 w-5" />}
            </div>
          )}
          <div>
            <p className="font-display text-base font-semibold leading-tight">{brandName}</p>
            <p className="text-[11px] text-white/70">
              {isChurch ? "Church Management Platform" : "Grace ChMS — vendor layer"}
            </p>
          </div>
        </div>

        {/* Center — floating mockup cluster */}
        <div className="relative my-10 flex-1">
          {isChurch ? <AttendanceMock /> : <TenantsMock />}
          {isChurch ? (
            <>
              <FloatChip
                className="left-[-0.5rem] top-[46%] -rotate-3"
                icon={<TrendingUp className="h-3.5 w-3.5" />}
                title="₦2.4M"
                sub="Giving this week"
              />
              <FloatChip
                className="bottom-[4%] right-[-0.25rem] rotate-3"
                icon={<Users className="h-3.5 w-3.5" />}
                title="Volunteers ready"
                sub="Rota published"
              />
            </>
          ) : (
            <>
              <FloatChip
                className="left-[-0.5rem] top-[44%] -rotate-3"
                icon={<TrendingUp className="h-3.5 w-3.5" />}
                title="₦1.2M MRR"
                sub="Recurring revenue"
              />
              <FloatChip
                className="bottom-[4%] right-[-0.25rem] rotate-3"
                icon={<Store className="h-3.5 w-3.5" />}
                title="18 active"
                sub="Licenses healthy"
              />
            </>
          )}
        </div>

        {/* Bottom — headline, rotating tagline, carousel dots */}
        <div className="max-w-md space-y-3">
          <h1 className="font-display text-3xl font-bold leading-[1.15] text-white">
            Welcome to <span className="text-white/85">{brandName}</span>.
          </h1>
          <div className="relative min-h-12" aria-live="off">
            <AnimatePresence mode="wait">
              <motion.p
                key={index}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
                className="text-sm leading-relaxed text-white/85"
              >
                {taglines[index]}
              </motion.p>
            </AnimatePresence>
          </div>
          <div className="flex items-center gap-1.5 pt-1">
            {taglines.map((_, i) => (
              <span
                key={i}
                className={cn(
                  "h-1.5 rounded-full transition-all duration-300",
                  i === index ? "w-6 bg-white" : "w-1.5 bg-white/40",
                )}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Photos for the photo-panel carousel (local static assets). */
const AUTH_PHOTOS = [
  { src: "/auth/church-1.png", caption: "Sunday service — main sanctuary" },
  { src: "/auth/church-2.png", caption: "Midweek worship gathering" },
  { src: "/auth/church-3.png", caption: "Welcome home" },
];

/**
 * Photo-panel variant of the auth visual (Flatstep reference): full-bleed
 * photography on the right side of the split card, a glass caption chip
 * (bottom-left) and carousel dots (bottom-right). Slow auto-crossfade,
 * frozen under reduced motion. Entirely decorative and aria-hidden, like
 * AuthVisualPanel — hidden below `lg` by the caller.
 */
export function PhotoVisualPanel({
  tenantName,
  className,
}: {
  tenantName?: string | null;
  className?: string;
}) {
  const [index, setIndex] = useState(0);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (reduce) return;
    const id = window.setInterval(() => setIndex((i) => (i + 1) % AUTH_PHOTOS.length), 6000);
    return () => window.clearInterval(id);
  }, [reduce]);

  return (
    <div className={cn("relative overflow-hidden bg-surface-sunken", className)} aria-hidden>
      {AUTH_PHOTOS.map((photo, i) => (
        <img
          key={photo.src}
          src={photo.src}
          alt=""
          className={cn(
            "absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ease-out",
            i === index ? "opacity-100" : "opacity-0",
          )}
        />
      ))}
      {/* Legibility gradient behind the caption chip */}
      <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-black/50 to-transparent" />

      {/* Glass caption chip (bottom-left, like the reference) */}
      <div className="absolute bottom-5 left-5 flex max-w-[80%] items-center gap-1.5 rounded-full bg-black/35 px-3.5 py-1.5 text-xs font-medium text-white shadow-sm backdrop-blur-md">
        <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="truncate">{tenantName ?? AUTH_PHOTOS[index].caption}</span>
      </div>

      {/* Carousel dots (bottom-right, indicators only) */}
      <div className="absolute bottom-6 right-5 flex items-center gap-1.5">
        {AUTH_PHOTOS.map((_, i) => (
          <span
            key={i}
            className={cn(
              "h-1.5 rounded-full transition-all duration-300",
              i === index ? "w-5 bg-white" : "w-1.5 bg-white/50",
            )}
          />
        ))}
      </div>
    </div>
  );
}

/** Small tenant-awareness chip shown above the sign-in form on a subdomain. */
export function TenantChip({ name, logoUrl }: { name: string; logoUrl?: string | null }) {
  return (
    <div className="mx-auto mb-5 flex w-fit items-center justify-center gap-2 rounded-full border bg-surface-sunken px-3.5 py-1.5 text-xs font-medium text-ink-secondary shadow-xs">
      {logoUrl ? (
        <img src={logoUrl} alt="" className="h-4 w-4 rounded-full object-cover" />
      ) : (
        <Church className="h-3.5 w-3.5 text-primary" aria-hidden />
      )}
      Signing in to <span className="font-semibold text-ink">{name}</span>
    </div>
  );
}
