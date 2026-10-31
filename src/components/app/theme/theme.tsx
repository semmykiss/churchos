"use client";

/**
 * ChurchOS ThemeProvider — runtime-switchable multi-theme system.
 *
 * • Sets data-theme="<key>" on <html> (plus the `.dark` class for the two dark
 *   themes so legacy `dark:` utilities keep working).
 * • Zero flash-of-wrong-theme: a blocking inline script in the root layout
 *   applies the stored theme before first paint; this provider adopts it.
 * • Persists to localStorage ("churchos-theme"), honours prefers-color-scheme
 *   via the "system" option, and — once authenticated — syncs to
 *   users.preferences.theme so the choice follows the user across devices.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

export type ThemeKey = "sanctuary-light" | "midnight" | "harvest" | "contrast";
export type StoredTheme = ThemeKey | "system";

export interface ThemeDef {
  key: ThemeKey;
  label: string;
  hint: string;
  /** [bg, surface, primary] swatch colors for the switcher previews. */
  swatch: [string, string, string];
  dark: boolean;
}

export const THEMES: ThemeDef[] = [
  { key: "sanctuary-light", label: "Sanctuary Light", hint: "Cool canvas · white & ink", swatch: ["#E4E7F0", "#FFFFFF", "#17181D"], dark: false },
  { key: "midnight", label: "Midnight", hint: "Blue-black · soft indigo", swatch: ["#0D0E14", "#1D1E2B", "#818CF8"], dark: true },
  { key: "harvest", label: "Harvest", hint: "Linen canvas · ink & coral", swatch: ["#EFE8DC", "#FFFFFF", "#1B1815"], dark: false },
  { key: "contrast", label: "High Contrast", hint: "Black & white · AAA", swatch: ["#000000", "#111111", "#FFFFFF"], dark: true },
];

const STORAGE_KEY = "churchos-theme";
const THEME_KEYS = THEMES.map((t) => t.key);

function isThemeKey(v: unknown): v is ThemeKey {
  return typeof v === "string" && (THEME_KEYS as string[]).includes(v);
}

function systemTheme(): ThemeKey {
  if (typeof window === "undefined") return "sanctuary-light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "midnight" : "sanctuary-light";
}

function applyTheme(key: ThemeKey) {
  const el = document.documentElement;
  el.dataset.theme = key;
  el.classList.toggle("dark", key === "midnight" || key === "contrast");
  el.style.colorScheme = key === "midnight" || key === "contrast" ? "dark" : "light";
}

function applyThemeAnimated(key: ThemeKey) {
  const el = document.documentElement;
  el.classList.add("theme-anim");
  applyTheme(key);
  window.setTimeout(() => el.classList.remove("theme-anim"), 220);
}

/** Parse the JSON `preferences` blob stored on User. */
export function parseUserTheme(preferences?: string | null): ThemeKey | null {
  if (!preferences) return null;
  try {
    const parsed = JSON.parse(preferences) as { theme?: unknown };
    return isThemeKey(parsed.theme) ? parsed.theme : null;
  } catch {
    return null;
  }
}

interface ThemeContextValue {
  /** What the user picked — "system" or an explicit theme key. */
  stored: StoredTheme;
  /** The theme currently applied to <html> (resolves "system"). */
  resolved: ThemeKey;
  setTheme: (next: StoredTheme) => void;
  /**
   * Called by AppRoot once the session is known: enables server persistence
   * and adopts the user's server-side preference (server wins on sign-in so
   * the choice follows the user across devices).
   */
  attachUser: (serverTheme?: ThemeKey | null) => void;
  /** Called on sign-out: stop persisting theme changes to the server. */
  detachUser: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [stored, setStored] = useState<StoredTheme>("system");
  const [resolved, setResolved] = useState<ThemeKey>("sanctuary-light");
  const storedRef = useRef<StoredTheme>("system");
  const authedRef = useRef(false);
  const syncTimer = useRef<number | null>(null);

  const resolve = useCallback((s: StoredTheme): ThemeKey => (s === "system" ? systemTheme() : s), []);

  // Adopt whatever the pre-paint inline script applied; follow OS changes while
  // the user is on "system".
  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    const initial: StoredTheme = raw === "system" || isThemeKey(raw) ? raw : "system";
    storedRef.current = initial;
    setStored(initial);
    const r = resolve(initial);
    setResolved(r);
    applyTheme(r); // idempotent with the inline script

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystemChange = () => {
      if (storedRef.current !== "system") return;
      const nr = systemTheme();
      setResolved(nr);
      applyThemeAnimated(nr);
    };
    mq.addEventListener("change", onSystemChange);

    return () => {
      mq.removeEventListener("change", onSystemChange);
    };
  }, [resolve]);

  const pushToServer = useCallback((s: StoredTheme) => {
    if (!authedRef.current) return;
    if (syncTimer.current) window.clearTimeout(syncTimer.current);
    syncTimer.current = window.setTimeout(() => {
      import("@/lib/api").then(({ api }) =>
        api.post("/users/me/preferences", { theme: s }).catch(() => {
          /* non-fatal — local persistence already succeeded */
        })
      );
    }, 600);
  }, []);

  const setTheme = useCallback(
    (next: StoredTheme) => {
      storedRef.current = next;
      setStored(next);
      const r = resolve(next);
      setResolved(r);
      applyThemeAnimated(r);
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        /* private mode — ignore */
      }
      pushToServer(next);
    },
    [resolve, pushToServer]
  );

  // Remote control surface (command palette, future admin UIs) — declared after
  // setTheme so the dependency array evaluates after initialization.
  useEffect(() => {
    const onThemeSet = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail === "system" || isThemeKey(detail)) setTheme(detail);
    };
    window.addEventListener("chms:theme:set", onThemeSet);
    return () => window.removeEventListener("chms:theme:set", onThemeSet);
  }, [setTheme]);

  const attachUser = useCallback(
    (serverTheme?: ThemeKey | null) => {
      authedRef.current = true;
      if (isThemeKey(serverTheme) && serverTheme !== storedRef.current) {
        // Server preference wins on sign-in (follows the user across devices).
        setTheme(serverTheme);
      } else if (!serverTheme && storedRef.current !== "system") {
        // First sign-in with a pre-existing local choice: adopt it server-side.
        pushToServer(storedRef.current);
      }
    },
    [setTheme, pushToServer]
  );

  const detachUser = useCallback(() => {
    authedRef.current = false;
    if (syncTimer.current) window.clearTimeout(syncTimer.current);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ stored, resolved, setTheme, attachUser, detachUser }),
    [stored, resolved, setTheme, attachUser, detachUser]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}
