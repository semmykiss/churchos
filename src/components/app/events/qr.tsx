"use client";

/**
 * QR utilities for Events & Registration.
 *  • QrTicketDialog   — renders a registration order's QR (guests show it at the door)
 *  • QrScanDialog     — camera QR scanner (BarcodeDetector when available) with a
 *                       manual code-entry fallback for laptops without cameras
 *
 * Payload format: "chms-event:<qrToken>" — scanning strips the prefix server-side
 * too, so raw tokens pasted by hand work as well.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Camera, CameraOff, Keyboard, Loader2 } from "lucide-react";

export const EVENT_QR_PREFIX = "chms-event:";

export function buildEventQrPayload(token: string): string {
  return `${EVENT_QR_PREFIX}${token}`;
}

export function normalizeScannedToken(raw: string): string {
  const t = (raw ?? "").trim();
  return t.toLowerCase().startsWith(EVENT_QR_PREFIX) ? t.slice(EVENT_QR_PREFIX.length).trim() : t;
}

/* ───────────────────────────── ticket QR dialog ───────────────────────────── */

export function QrTicketDialog({
  open,
  onOpenChange,
  token,
  title,
  description,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  token: string | null;
  title: string;
  description?: string;
}) {
  // Cache generated QR data-URLs by token — generation happens in an async
  // callback (never synchronously inside the effect body), and the displayed
  // URL is derived, so closing the dialog never leaves a stale image around.
  const [dataUrls, setDataUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open || !token || dataUrls[token]) return;
    let cancelled = false;
    QRCode.toDataURL(buildEventQrPayload(token), {
      width: 360,
      margin: 2,
      errorCorrectionLevel: "M",
      color: { dark: "#1c1917", light: "#ffffff" },
    })
      .then((url) => {
        if (cancelled) return;
        setDataUrls((prev) => ({ ...prev, [token]: url }));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, token, dataUrls]);

  const dataUrl = open && token ? dataUrls[token] ?? null : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <div className="flex flex-col items-center gap-3">
          {dataUrl ? (
            <img
              src={dataUrl}
              alt="Ticket QR code"
              className="rounded-lg border bg-white p-2"
              width={240}
              height={240}
            />
          ) : (
            <div className="flex h-[240px] w-[240px] items-center justify-center rounded-lg border bg-muted/40">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
            </div>
          )}
          <div className="w-full space-y-1">
            <Label className="text-xs text-muted-foreground">Ticket code</Label>
            <div className="flex items-center gap-2">
              <Input readOnly value={token ?? ""} className="font-mono text-xs" aria-label="Ticket code" />
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (token) void navigator.clipboard.writeText(token);
                }}
              >
                Copy
              </Button>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─────────────────────────────── QR scanner ─────────────────────────────── */

type BarcodeDetectorLike = {
  detect: (source: CanvasImageSource) => Promise<Array<{ rawValue?: string }>>;
};

export function QrScanDialog({
  open,
  onOpenChange,
  onToken,
  title = "Scan a ticket",
  description = "Point the camera at the attendee's QR code — each scan checks in one seat.",
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onToken: (token: string) => void;
  title?: string;
  description?: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [cameraState, setCameraState] = useState<"starting" | "ready" | "unavailable">("starting");
  const [manual, setManual] = useState("");
  const [manualOpen, setManualOpen] = useState(false);

  const stopStream = useCallback(() => {
    const stream = videoRef.current?.srcObject as MediaStream | null;
    stream?.getTracks().forEach((t) => t.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

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
        if (!Detector || !videoRef.current) return; // camera shows, manual entry covers the rest
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
                onToken(token);
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
      stopStream();
    };
  }, [open, onToken, stopStream]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="relative overflow-hidden rounded-lg border bg-black/90" style={{ aspectRatio: "4 / 3" }}>
          <video ref={videoRef} className="h-full w-full object-cover" muted playsInline aria-label="Camera preview" />
          {cameraState === "starting" ? (
            <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-white/80">
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> Starting camera…
            </div>
          ) : null}
          {cameraState === "unavailable" ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-sm text-white/80">
              <CameraOff className="h-6 w-6" aria-hidden />
              <p>Camera unavailable in this browser. Use manual code entry below.</p>
            </div>
          ) : null}
          {cameraState === "ready" ? (
            <div
              className="pointer-events-none absolute left-1/2 top-1/2 h-40 w-40 -translate-x-1/2 -translate-y-1/2 rounded-lg border-2 border-white/70"
              aria-hidden
            />
          ) : null}
        </div>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Camera className="h-3.5 w-3.5" aria-hidden />
          {cameraState === "ready"
            ? "Camera live — scanning for QR codes…"
            : "No automatic scanning — enter the code manually."}
        </div>

        {manualOpen || cameraState !== "ready" ? (
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const token = normalizeScannedToken(manual);
              if (!token) return;
              setManual("");
              onToken(token);
            }}
          >
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="qr-manual">Ticket code</Label>
              <Input
                id="qr-manual"
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                placeholder="evt_…"
                className="font-mono text-xs"
                autoComplete="off"
              />
            </div>
            <Button type="submit" disabled={!manual.trim()}>
              Check in
            </Button>
          </form>
        ) : (
          <Button variant="outline" className="gap-1.5" onClick={() => setManualOpen(true)}>
            <Keyboard className="h-4 w-4" aria-hidden /> Enter code manually
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
