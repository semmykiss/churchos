"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Sparkles } from "lucide-react";
import { useAiToolSchema } from "./hooks/useAiToolSchema";
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

  if (!info.data?.enabled) return null;

  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close AI assistant" : "Open AI assistant"}
        title={`${info.data.assistantName} — AI assistant`}
        className="group fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full shadow-lg transition-transform hover:scale-105 active:scale-95 no-print"
      >
        <span className="absolute inset-0 rounded-full bg-gradient-to-br from-indigo-500 via-fuchsia-500 to-amber-400 [background-size:220%_220%] [animation:shepherd-gradient_9s_ease_infinite] group-hover:brightness-110" />
        <span className="absolute inset-0 rounded-full bg-fuchsia-400/50 [animation:shepherd-pulse_2.6s_ease-out_infinite]" aria-hidden />
        <Sparkles className="relative h-6 w-6 text-white drop-shadow" />
        <style>{`
          @keyframes shepherd-gradient {
            0% { background-position: 0% 50% }
            50% { background-position: 100% 50% }
            100% { background-position: 0% 50% }
          }
          @keyframes shepherd-pulse {
            0% { transform: scale(1); opacity: .55 }
            70% { transform: scale(1.55); opacity: 0 }
            100% { transform: scale(1.55); opacity: 0 }
          }
        `}</style>
      </button>

      {open ? <AiChatPanel user={user} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
