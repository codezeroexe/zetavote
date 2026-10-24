import type { AgeCriteria } from "../types/api";

/**
 * The eligibility rule in words.
 *
 * Two callers that must agree — the create form reads it back live as the admin
 * types, and the results panel prints it beside the published hash — so it lives
 * here rather than being written twice.
 *
 * `min_age: 0` and no minimum mean the same thing, so it reads as no age limit
 * rather than as the absurdity it literally is.
 */
export function describeCriteria(criteria: AgeCriteria): string {
  const low = criteria.min_age;
  const high = criteria.max_age;
  if ((low === null || low === 0) && high === null) return "No age limit";
  if (high === null) return `Ages ${low} and over`;
  if (low === null) return `Ages ${high} and under`;
  return `Ages ${low} to ${high}`;
}
