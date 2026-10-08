import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "zetavote-theme";

/**
 * The pre-paint script in index.html has already resolved and applied the theme
 * to <html> by the time this runs. Reading that attribute back keeps one
 * implementation of the stored-value-then-system-preference rule; recomputing it
 * here would be a second copy free to drift out of sync with the script that
 * decides what the user actually sees on first paint.
 */
function readAppliedTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(readAppliedTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Storage unavailable (private mode, etc.) — theme still applies.
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  }, []);

  return { theme, toggleTheme };
}
