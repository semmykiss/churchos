"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Sparkles } from "lucide-react";
import { useAiToolSchema } from "./hooks/useAiToolSchema";
import { moduleLevel } from "@/lib/types";
import type { SessionUser } from "@/lib/types";

/**
 * AiLauncherButton — the ONLY element injected into the root app shell
 * (spec §10). Renders nothing when the church hasn't enabled the assistant.
 * The chat panel bundle is lazy-loaded on first open so every other module's
 * initial load is untouched.
 */

const AiChatPanel = dynamic(() => import("./AiChatPanel"), { ssr: false });

export default function AiLauncherButton({ user }: { user: SessionUser }) {
  const [open, setOpen] = useState(false);
  const info = useAiToolSchema(true);

  // sidebar "Ask Shepherd" item + other surfaces dispatch this window event
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener("chms:ai:open", onOpen);
    return () => window.removeEventListener("chms:ai:open", onOpen);
  }, []);

  // Escape closes the panel
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // org toggle ON + the user's module matrix must grant the Shepherd AI module
  if (!info.data?.enabled || moduleLevel(user, "ai") < 1) return null;

  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close AI assistant" : "Open AI assistant"}
        title={`${info.data.assistantName} — AI assistant`}
        className="fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full border border-border/60 bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105 active:scale-95 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 no-print"
      >
        <Sparkles className="h-6 w-6" aria-hidden />
      </button>

      {open ? <AiChatPanel user={user} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
