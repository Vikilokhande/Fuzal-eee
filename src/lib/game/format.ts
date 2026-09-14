/**
 * FUZAL Server-Safe Formatting Utilities
 * --------------------------------------
 * Pure, deterministic time/clock formatting functions.
 * Strictly free of "use client", DOM, window, document, or client hooks.
 * Safe for server components, API route handlers, and client components alike.
 */

/**
 * Format milliseconds into standard MM:SS clock representation.
 * If ms is null, undefined, or NaN, safely returns "—".
 */
export function formatClock(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || Number.isNaN(ms)) {
    return "—";
  }
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
