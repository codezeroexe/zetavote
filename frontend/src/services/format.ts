/**
 * Formatting shared by the voter and admin views.
 *
 * `formatDuration` was written twice, identically, one file over. Two copies of a
 * countdown is two places for "closes in" to become "closes in:" on one side of
 * the app and not the other.
 */

/** Milliseconds left until `endsAt`, or null if it has passed or is unset. */
export function msRemaining(endsAt: string | null): number | null {
  if (!endsAt) return null;
  const end = new Date(endsAt).getTime();
  if (Number.isNaN(end)) return null;
  const left = end - Date.now();
  return left > 0 ? left : null;
}

/** Coarse on purpose: "2d 4h", not "2d 4h 11m 38s". */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/**
 * A hash as the server will compare it.
 *
 * A commitment is hex, and it arrives here pasted out of a downloaded JSON file
 * where it may carry different casing or a wrapped newline. Comparing it as typed
 * makes a perfectly good ballot read as "not found", which is the one answer a
 * voter must never be shown about a valid vote.
 */
export function normaliseHash(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, "");
}

/** True for something shaped like a SHA-256 digest. */
export function looksLikeHash(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(normaliseHash(value));
}

/** A timestamp with the date, for tables where entries span more than one day. */
export function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
}

/**
 * The same instant, for a column too narrow for the date.
 *
 * The year is dropped and the day is named, because an audit log read on a phone
 * spans more than one day and "04:00:40" on its own would be a different day
 * from the one above it.
 */
export function formatTimestampCompact(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/**
 * What a `datetime-local` field actually means, spelled out.
 *
 * The field has no timezone, and the value is sent as an instant. An admin
 * setting a deadline should not have to know that.
 */
export function describeLocalInput(value: string): string | null {
  if (value === "") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "−";
  const hours = String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0");
  const minutes = String(Math.abs(offset) % 60).padStart(2, "0");
  return `Your local time — ${date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  })} (UTC${sign}${hours}:${minutes})`;
}
