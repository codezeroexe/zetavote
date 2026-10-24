import { useCallback, useEffect, useState } from "react";

export type Section = "login" | "voter" | "admin" | "verify";

const VALID: readonly Section[] = ["login", "voter", "admin", "verify"];

function readHash(): Section | null {
  const raw = window.location.hash.replace(/^#\/?/, "");
  return (VALID as readonly string[]).includes(raw) ? (raw as Section) : null;
}

/**
 * The current section, in the URL.
 *
 * Navigation used to be one piece of `useState` in the shell, which meant the
 * back button did nothing, a reload dropped you wherever the app happened to
 * start, and no view could be linked to. That is a nuisance in a normal app and
 * a real problem in this one: the whole point of the create-election flow is that
 * the admin hands an id to a voter, and `#/verify` is a thing worth sending
 * someone.
 *
 * The hash rather than history.pushState, because a hash router needs no server
 * rewrite — which matters here, since the backend serves this same file as a
 * static bundle (see the mount at the end of backend/app.py).
 */
export function useHashSection(): [Section | null, (next: Section) => void] {
  const [section, setSection] = useState<Section | null>(readHash);

  useEffect(() => {
    const onHashChange = () => setSection(readHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const navigate = useCallback((next: Section) => {
    // Assigning the hash pushes a history entry, which is what makes Back work.
    // Re-navigating to where we already are would stack duplicate entries, so
    // that case is a no-op.
    if (readHash() === next) return;
    window.location.hash = `/${next}`;
  }, []);

  return [section, navigate];
}
