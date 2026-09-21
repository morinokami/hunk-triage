import type { Verdict } from "./types.ts";

import { ROLE_CRITERIA } from "./questions.ts";

// `hunk.config`, cache files and Jev responses are untrusted: nothing read from them is
// used before one of these guards has accepted it.

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** A finite number from 0 to `max`, both included. */
export function inRange(value: unknown, max: number): value is number {
  return isFiniteNumber(value) && value >= 0 && value <= max;
}

export function isVerdict(value: unknown): value is Verdict {
  return (
    isRecord(value) &&
    typeof value.role === "string" &&
    Object.hasOwn(ROLE_CRITERIA, value.role) &&
    inRange(value.mechanical, 1) &&
    inRange(value.core, 1) &&
    inRange(value.attention, 3)
  );
}
