"use client";

/**
 * ConfirmActionDialog — gated confirmation for sensitive partner actions
 * (suspend tenant, revoke license, delete records…). The audit findings that
 * motivated this component:
 *   1. Destructive actions must never be one click away — require a deliberate
 *      confirm dialog, optionally with a typed confirmation value (a unique
 *      slug, never a display name).
 *   2. Every confirmed action must carry a mandatory reason string that is
 *      forwarded to `onConfirm` so it can be persisted on the audit trail.
 *   3. Irreversible consequences must be spelled out before confirming.
 *
 * The dialog is busy-safe: it cannot be dismissed (overlay click, Escape)
 * while the action request is in flight, and the confirm button shows a
 * spinner + disables via `canConfirm`.
 */
import { useId, useState, type ReactNode } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type Tone = "default" | "warning" | "destructive";

export interface ConfirmActionProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  /** Consequences shown in a warning panel. */
  impacts?: string[];
  confirmLabel: string;
  tone?: Tone;
  /** The user must type this exact value. Use a unique slug, never a display name. */
  typedConfirm?: { expected: string; label: string };
  /** Mandatory reason. It is passed to onConfirm and stored on the audit trail. */
  reason?: { label: string; minLength: number; placeholder?: string };
  /** Mandatory checkbox. */
  acknowledgement?: string;
  busy?: boolean;
  onConfirm: (reason: string) => void | Promise<void>;
}

/** Intentional solid amber action color for the "warning" tone (readable in both themes). */
const WARNING_BUTTON =
  "bg-amber-600 text-white hover:bg-amber-700 dark:bg-amber-600 dark:hover:bg-amber-700";

export function ConfirmActionDialog({
  open,
  onOpenChange,
  title,
  description,
  impacts,
  confirmLabel,
  tone = "default",
  typedConfirm,
  reason,
  acknowledgement,
  busy = false,
  onConfirm,
}: ConfirmActionProps) {
  const [typed, setTyped] = useState("");
  const [why, setWhy] = useState("");
  const [ack, setAck] = useState(false);

  // Fresh state every time the dialog opens — a previously typed value or
  // reason must never leak into the next confirmation. Implemented as the
  // documented "adjust state when a prop changes" render-phase pattern
  // (https://react.dev/learn/you-might-not-need-an-effect) instead of a
  // setState-in-effect, which causes cascading renders.
  const [lastOpen, setLastOpen] = useState(open);
  if (lastOpen !== open) {
    setLastOpen(open);
    if (!open) {
      setTyped("");
      setWhy("");
      setAck(false);
    }
  }

  const typedOk = !typedConfirm || typed.trim() === typedConfirm.expected.trim();
  const reasonOk = !reason || why.trim().length >= reason.minLength;
  const ackOk = !acknowledgement || ack;
  const canConfirm = !busy && typedOk && reasonOk && ackOk;

  const typedId = useId();
  const reasonId = useId();
  const ackId = useId();

  const typedMismatch = typedConfirm !== undefined && typed.trim().length > 0 && !typedOk;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!busy) onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            {tone !== "default" ? (
              <AlertTriangle
                className={cn("h-4.5 w-4.5 shrink-0", tone === "destructive" ? "text-destructive" : "text-warning")}
                aria-hidden
              />
            ) : null}
            {title}
          </DialogTitle>
          <DialogDescription asChild>
            <div className="text-sm leading-relaxed text-muted-foreground">{description}</div>
          </DialogDescription>
        </DialogHeader>

        {impacts && impacts.length > 0 ? (
          <div
            className={cn(
              "rounded-lg border p-3",
              tone === "destructive"
                ? "border-destructive/30 bg-destructive/5 text-muted-foreground"
                : "border-warning/40 bg-warning-bg text-warning",
            )}
          >
            <ul className="space-y-1.5 text-[13px] leading-snug">
              {impacts.map((impact) => (
                <li key={impact} className="flex items-start gap-2">
                  <span aria-hidden className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-current" />
                  <span>{impact}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="space-y-4">
          {typedConfirm ? (
            <div className="space-y-1.5">
              <Label htmlFor={typedId} className="text-[13px] font-medium">
                {typedConfirm.label}
              </Label>
              <Input
                id={typedId}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={typedConfirm.expected}
                autoComplete="off"
                spellCheck={false}
                aria-invalid={typedMismatch ? true : undefined}
                aria-describedby={typedMismatch ? `${typedId}-error` : undefined}
                className={cn("h-10", typedMismatch && "border-danger focus-visible:ring-danger/40")}
              />
              {typedMismatch ? (
                <p id={`${typedId}-error`} className="text-xs text-danger">
                  Value does not match. Check for typos.
                </p>
              ) : null}
            </div>
          ) : null}

          {reason ? (
            <div className="space-y-1.5">
              <Label htmlFor={reasonId} className="text-[13px] font-medium">
                {reason.label}
              </Label>
              <Textarea
                id={reasonId}
                rows={3}
                maxLength={500}
                value={why}
                onChange={(e) => setWhy(e.target.value)}
                placeholder={reason.placeholder}
                aria-required="true"
              />
              <p className="text-right text-[11px] text-muted-foreground" aria-live="polite">
                {why.trim().length}/{reason.minLength} characters minimum
              </p>
            </div>
          ) : null}

          {acknowledgement ? (
            <div className="flex items-start gap-2.5">
              <Checkbox
                id={ackId}
                checked={ack}
                onCheckedChange={(v) => setAck(v === true)}
                className="mt-0.5"
                aria-required="true"
              />
              <Label htmlFor={ackId} className="cursor-pointer text-[13px] font-normal leading-snug text-muted-foreground">
                {acknowledgement}
              </Label>
            </div>
          ) : null}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant={tone === "destructive" ? "destructive" : "default"}
            className={cn(tone === "warning" && WARNING_BUTTON)}
            disabled={!canConfirm}
            onClick={() => void onConfirm(why.trim())}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            {busy ? "Working…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ConfirmActionDialog;
