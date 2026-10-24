import { useCallback, useEffect, useState } from "react";

/** The stored choice. "auto" follows the system and is the default. */
export type Theme = "auto" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "zetavote-theme";
const QUERY = "(prefers-color-scheme: dark)";

function readStored(): Theme {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === "light" || v === "dark" ? v : "auto";
  } catch {
    return "auto";
  }
}

function systemTheme(): ResolvedTheme {
  return window.matchMedia(QUERY).matches ? "dark" : "light";
}

/**
 * Auto / Light / Dark. The pre-paint script in index.html applies the same rule
 * before first paint; this hook keeps it live (Auto tracks the system setting).
 */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(readStored);
  const [system, setSystem] = useState<ResolvedTheme>(systemTheme);

  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const onChange = () => setSystem(mq.matches ? "dark" : "light");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const resolved: ResolvedTheme = theme === "auto" ? system : theme;

  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
    const meta = document.querySelector('meta[name="theme-color"]');
    meta?.setAttribute("content", resolved === "light" ? "#1b2a41" : "#0e1624");
  }, [resolved]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    try {
      if (next === "auto") window.localStorage.removeItem(STORAGE_KEY);
      else window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage unavailable (private mode, etc.) — theme still applies.
    }
  }, []);

  return { theme, resolved, setTheme };
}
