"use client";

/**
 * Event door kiosk — a full-screen access-control screen the event manager
 * launches from the Registration tab. Built for a tablet/laptop at the door:
 *
 *  • camera QR scanning (BarcodeDetector where available) of the 6-digit
 *    ticket QR — each successful scan admits one seat of the order
 *  • an on-screen numeric keypad for the 6-digit ticket code (touch kiosks),
 *    plus a hidden-keyboard input that accepts USB laser scanners typing the
 *    code followed by Enter
 *  • per-event scoping: a ticket printed for another service bounces with a
 *    clear "wrong event" message instead of silently admitting someone
 *  • big green/amber/red verdict with the attendee's name and seat count,
 *    auto-clearing after a few seconds so the next person can step up
 *  • audio chirps (success / already-in / denied) via WebAudio
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { fmtDateTime } from "@/lib/types";
import { normalizeScannedToken } from "@/components/app/events/qr";
import { useApiQuery } from "@/components/app/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  BadgeCheck,
  CameraOff,
  Delete,
  Loader2,
  LogOut,
  ScanLine,
  TicketX,
  TriangleAlert,
} from "lucide-react";

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

/* ── audio chirps ── */

let audioCtx: AudioContext | null = null;

function beep(kind: "success" | "info" | "error") {
  try {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    audioCtx ??= new AC();
    if (audioCtx.state === "suspended") void audioCtx.resume();
    const now = audioCtx.currentTime;
    const tones: Array<[number, number]> =
      kind === "success"
        ? [[880, 0], [1318.5, 0.11]]
        : kind === "info"
          ? [[659.3, 0]]
          : [[196, 0], [185, 0.17]];
    for (const [freq, at] of tones) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = kind === "error" ? "sawtooth" : "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.12, now + at);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + at + (kind === "error" ? 0.35 : 0.2));
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now + at);
      osc.stop(now + at + 0.42);
    }
  } catch {
    /* audio is a nicety — never let it break check-in */
  }
}

/* ── verdict overlay ── */

type Verdict = {
  kind: "success" | "info" | "error";
  title: string;
  detail?: string;
  seats?: string;
};

const VERDICT_STYLES: Record<
  Verdict["kind"],
  { wrap: string; icon: typeof BadgeCheck; autoClearMs: number }
> = {
  success: { wrap: "bg-emerald-600/95", icon: BadgeCheck, autoClearMs: 3500 },
  info: { wrap: "bg-amber-500/95", icon: TriangleAlert, autoClearMs: 3000 },
  error: { wrap: "bg-red-600/95", icon: TicketX, autoClearMs: 5000 },
};

/* ── kiosk host-dialog guard ── */

/**
 * True while a door kiosk overlay is on screen. The kiosk is portaled to
 * document.body — OUTSIDE the Radix dialog layer that hosts it — so every
 * click inside the kiosk looks like an "outside" interaction to the host
 * dialog. The host dialog reads this flag and suppresses its outside-dismiss
 * handlers while the kiosk is up.
 */
let kioskActive = false;

export function isDoorKioskActive() {
  return kioskActive;
}

/* ── kiosk ── */

type BarcodeDetectorLike = {
  detect: (source: CanvasImageSource) => Promise<Array<{ rawValue?: string }>>;
};

export function EventDoorKiosk({
  open,
  onOpenChange,
  eventId,
  eventName,
  startsAt,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  eventId: string;
  eventName: string;
  startsAt: string;
}) {
  const qc = useQueryClient();
  const [code, setCode] = useState("");
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [cameraState, setCameraState] = useState<"starting" | "ready" | "unavailable">("starting");
  const [optimistic, setOptimistic] = useState(0);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const busyRef = useRef(false);

  // Live door stats for this event — polled so the header counter stays honest
  // even if a colleague checks people in from the office.
  const statsQ = useApiQuery<KioskStats>(
    ["kiosk", "stats", eventId],
    `/events/${eventId}/registration`,
    { refetchInterval: 15000, enabled: open }
  );
  const stats = statsQ.data?.stats;
  const checkedIn = (stats?.checkedInSeats ?? 0) + optimistic;
  useEffect(() => {
    setOptimistic(0);
  }, [statsQ.dataUpdatedAt]);

  useEffect(() => {
    if (!open) return;
    kioskActive = true;
    return () => {
      kioskActive = false;
    };
  }, [open]);

  const submit = useCallback(
    async (raw: string) => {
      const token = normalizeScannedToken(raw);
      if (!token || busyRef.current) return;
      busyRef.current = true;
      setCode("");
      try {
        const res = await api.post<{
          ok: boolean;
          alreadyDone: boolean;
          name: string;
          eventName: string;
          ticketTypeName?: string;
          seatsTotal: number;
          seatsCheckedIn: number;
        }>("/events/check-in", { qrToken: token, eventId });
        if (res.alreadyDone) {
          setVerdict({
            kind: "info",
            title: "Already checked in",
            detail: res.name,
            seats: `All ${res.seatsTotal} seat(s) of this order are in`,
          });
          beep("info");
        } else {
          setVerdict({
            kind: "success",
            title: "Welcome",
            detail: res.name,
            seats: `Seat ${res.seatsCheckedIn} of ${res.seatsTotal}${res.ticketTypeName ? ` · ${res.ticketTypeName}` : ""}`,
          });
          beep("success");
          setOptimistic((n) => n + 1);
          void qc.invalidateQueries({ queryKey: ["kiosk", "stats", eventId] });
        }
      } catch (err) {
        setVerdict({
          kind: "error",
          title: "Not admitted",
          detail: errorMessage(err, "Check-in failed — try again."),
        });
        beep("error");
      } finally {
        busyRef.current = false;
        inputRef.current?.focus();
      }
    },
    [eventId, qc]
  );

  // Auto-submit once 6 digits are typed — covers keypad users and USB scanners.
  useEffect(() => {
    if (code.length !== 6) return;
    const t = setTimeout(() => void submit(code), 220);
    return () => clearTimeout(t);
  }, [code, submit]);

  // Auto-clear the verdict so the next attendee can step up.
  useEffect(() => {
    if (!verdict) return;
    const t = setTimeout(
      () => setVerdict((v) => (v === verdict ? null : v)),
      VERDICT_STYLES[verdict.kind].autoClearMs
    );
    return () => clearTimeout(t);
  }, [verdict]);

  // Camera + QR detection loop — same seam as the scanner dialog, scoped here.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let raf = 0;
    let lastToken = "";
    let lastAt = 0;

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => undefined);
        }
        setCameraState("ready");

        const Detector = (
          window as unknown as { BarcodeDetector?: new (opts: { formats: string[] }) => BarcodeDetectorLike }
        ).BarcodeDetector;
        if (!Detector || !videoRef.current) return;
        const detector = new Detector({ formats: ["qr_code"] });
        const tick = async () => {
          if (cancelled || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            const raw = codes?.[0]?.rawValue;
            if (raw) {
              const token = normalizeScannedToken(raw);
              const now = Date.now();
              if (token && (token !== lastToken || now - lastAt > 2500)) {
                lastToken = token;
                lastAt = now;
                void submit(token);
              }
            }
          } catch {
            /* transient frame errors are fine */
          }
          raf = requestAnimationFrame(() => void tick());
        };
        raf = requestAnimationFrame(() => void tick());
      } catch {
        if (!cancelled) setCameraState("unavailable");
      }
    }
    void start();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      const stream = videoRef.current?.srcObject as MediaStream | null;
      stream?.getTracks().forEach((t) => t.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [open, submit]);

  // Fullscreen the KIOSK ITSELF while it is up. Putting the kiosk root (not
  // documentElement) in the top layer also guarantees it paints and hit-tests
  // above any open Radix dialog overlay. Restore when leaving.
  useEffect(() => {
    if (!open) return;
    const el = rootRef.current;
    void el?.requestFullscreen?.().catch(() => undefined);
    return () => {
      if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => undefined);
    };
  }, [open]);

  // Refocus the scanner input whenever the verdict clears.
  useEffect(() => {
    if (!verdict) inputRef.current?.focus();
  }, [verdict]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const vs = verdict ? VERDICT_STYLES[verdict.kind] : null;
  const VerdictIcon = vs?.icon ?? BadgeCheck;

  const keypad = [
    "1", "2", "3",
    "4", "5", "6",
    "7", "8", "9",
    "C", "0", "⌫",
  ];

  // Rendered through a portal: the event detail (and this overlay) mounts inside
  // a Radix DialogContent whose translate transform makes it the containing
  // block for position:fixed — without the portal the kiosk would only fill the
  // dialog box instead of the whole screen.
  return createPortal(
    <div
      ref={rootRef}
      className="fixed inset-0 z-[100] flex flex-col bg-zinc-950 text-zinc-50"
      role="dialog"
      aria-label="Door kiosk mode"
      onKeyDown={(e) => {
        // Escape leaves the kiosk only — stop it here so the Radix dialog that
        // hosts this portal never sees it and closes the whole event detail.
        if (e.key === "Escape") {
          e.stopPropagation();
          onOpenChange(false);
        }
      }}
    >
      {/* header */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3 sm:px-6">
        <div className="min-w-0">
          <p className="truncate text-base font-semibold sm:text-lg">{eventName}</p>
          <p className="text-xs text-zinc-400">{fmtDateTime(new Date(startsAt))} · Access control</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-2xl font-bold leading-none tabular-nums">{checkedIn}</p>
            <p className="text-[11px] uppercase tracking-wide text-zinc-400">checked in</p>
          </div>
          {stats && stats.remainingSeats != null ? (
            <div className="hidden text-right sm:block">
              <p className="text-2xl font-bold leading-none tabular-nums">{stats.remainingSeats}</p>
              <p className="text-[11px] uppercase tracking-wide text-zinc-400">seats left</p>
            </div>
          ) : null}
          <Button
            variant="outline"
            className="gap-1.5 border-white/20 bg-white/5 text-zinc-100 hover:bg-white/10 hover:text-white"
            onClick={() => onOpenChange(false)}
          >
            <LogOut className="h-4 w-4" aria-hidden /> Exit kiosk
          </Button>
        </div>
      </header>

      {/* body */}
      <div className="relative flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 sm:p-6 lg:flex-row">
        {/* camera panel */}
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3">
          <div
            className="relative w-full max-w-lg overflow-hidden rounded-2xl border-2 border-white/15 bg-black/80"
            style={{ aspectRatio: "4 / 3" }}
          >
            <video ref={videoRef} className="h-full w-full object-cover" muted playsInline aria-label="Kiosk camera" />
            {cameraState === "starting" ? (
              <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-white/80">
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> Starting camera…
              </div>
            ) : null}
            {cameraState === "unavailable" ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-8 text-center text-sm text-white/75">
                <CameraOff className="h-8 w-8" aria-hidden />
                <p>No camera on this device. Type or scan the 6-digit ticket code on the keypad.</p>
              </div>
            ) : null}
            {cameraState === "ready" ? (
              <>
                <div
                  className="pointer-events-none absolute left-1/2 top-1/2 h-48 w-48 -translate-x-1/2 -translate-y-1/2 rounded-xl border-2 border-white/70"
                  aria-hidden
                />
                <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-black/60 px-3 py-1 text-xs text-white/85">
                  <ScanLine className="h-3.5 w-3.5" aria-hidden /> Scanning for tickets…
                </div>
              </>
            ) : null}
          </div>
          <p className="text-center text-sm text-zinc-400">
            Each scan or code admits <span className="font-medium text-zinc-200">one seat</span> — family orders scan once per person.
          </p>
        </div>

        {/* keypad panel */}
        <div className="w-full shrink-0 lg:w-96">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit(code);
            }}
          >
            <label htmlFor="kiosk-code" className="mb-1.5 block text-xs uppercase tracking-wide text-zinc-400">
              Ticket code
            </label>
            <Input
              id="kiosk-code"
              ref={inputRef}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void submit(code);
                }
              }}
              inputMode="none"
              autoComplete="off"
              placeholder="······"
              aria-label="6-digit ticket code"
              className="h-16 border-white/20 bg-white/5 text-center font-mono text-4xl tracking-[0.4em] text-zinc-50 placeholder:text-zinc-600"
            />
            <div className="mt-3 grid grid-cols-3 gap-2">
              {keypad.map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-label={k === "⌫" ? "Backspace" : k === "C" ? "Clear" : `Digit ${k}`}
                  className="flex h-14 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-xl font-semibold text-zinc-100 transition hover:bg-white/15 active:bg-white/25 sm:h-16 sm:text-2xl"
                  onClick={() => {
                    if (k === "C") setCode("");
                    else if (k === "⌫") setCode((c) => c.slice(0, -1));
                    else setCode((c) => (c.length < 6 ? c + k : c));
                    inputRef.current?.focus();
                  }}
                >
                  {k === "⌫" ? <Delete className="h-5 w-5" aria-hidden /> : k}
                </button>
              ))}
            </div>
            {/* keep a submit button for codes shorter than 6 (legacy evt_ tickets) */}
            <Button
              type="submit"
              disabled={!code.trim()}
              className="mt-3 h-12 w-full text-base font-semibold"
            >
              Check in
            </Button>
          </form>
        </div>

        {/* verdict overlay */}
        {verdict && vs ? (
          <div
            className={`absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 p-8 text-center text-white ${vs.wrap}`}
            role="status"
            aria-live="assertive"
          >
            <VerdictIcon className="h-24 w-24 drop-shadow sm:h-28 sm:w-28" aria-hidden />
            <p className="text-3xl font-bold sm:text-4xl">{verdict.title}</p>
            {verdict.detail ? <p className="text-xl font-medium sm:text-2xl">{verdict.detail}</p> : null}
            {verdict.seats ? <p className="text-base text-white/85">{verdict.seats}</p> : null}
            <Button
              variant="outline"
              className="mt-2 border-white/40 bg-white/10 text-white hover:bg-white/20 hover:text-white"
              onClick={() => setVerdict(null)}
            >
              Continue scanning
            </Button>
          </div>
        ) : null}
      </div>
    </div>,
    document.body
  );
}

/* ── kiosk stats shape ── */

type KioskStats = {
  stats: { checkedInSeats: number; remainingSeats: number | null; heldSeats: number };
};
