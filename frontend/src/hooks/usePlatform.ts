/**
 * Keyboard-shortcut platform detection. Mac (and iOS) use Cmd, everything else
 * uses Ctrl. Pages never hard-code a modifier; they name a semantic shortcut and
 * ask this module for the label, the aria value, and the modifier to test.
 */

/** "submit" is Enter; `{ key }` is any single character, e.g. { key: "N" }. */
export type Shortcut = "submit" | { key: string };

type NavigatorWithUAData = Navigator & { userAgentData?: { platform?: string } };

export function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as NavigatorWithUAData;
  const platform = nav.userAgentData?.platform ?? nav.platform ?? "";
  return /mac|iphone|ipad/i.test(platform);
}

/** True when `e` carries the platform modifier and no other modifier. */
export function hasPlatformModifier(e: KeyboardEvent): boolean {
  const mac = isMac();
  return mac
    ? e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey
    : e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;
}

const keyName = (s: Shortcut) => (s === "submit" ? "Enter" : s.key.toUpperCase());

/** "⌘↵" / "⌘N" on Mac, "Ctrl+Enter" / "Ctrl+N" elsewhere. */
export function shortcutLabel(s: Shortcut): string {
  if (isMac()) return `⌘${s === "submit" ? "↵" : keyName(s)}`;
  return `Ctrl+${keyName(s)}`;
}

/** Value for aria-keyshortcuts: "Meta+Enter" / "Control+Enter". */
export function shortcutAria(s: Shortcut): string {
  return `${isMac() ? "Meta" : "Control"}+${keyName(s)}`;
}

/** Does this keydown match the shortcut on this platform? */
export function matchesShortcut(e: KeyboardEvent, s: Shortcut): boolean {
  return hasPlatformModifier(e) && e.key.toLowerCase() === (s === "submit" ? "enter" : s.key.toLowerCase());
}
