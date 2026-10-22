import { useEffect, type RefObject } from "react";
import { matchesShortcut } from "./usePlatform";

/**
 * Cmd+Enter (Mac) or Ctrl+Enter (elsewhere) submits the form behind `ref`.
 * Uses requestSubmit, so native validation and the form's onSubmit run as for a
 * click. Fires when focus is inside the form or nowhere in particular.
 */
export function useSubmitShortcut(ref: RefObject<HTMLFormElement | null>) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const form = ref.current;
      if (!form || e.repeat || !matchesShortcut(e, "submit")) return;
      const active = document.activeElement;
      if (active && active !== document.body && !form.contains(active)) return;
      e.preventDefault();
      form.requestSubmit();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [ref]);
}
