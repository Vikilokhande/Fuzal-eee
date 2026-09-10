import { timingSafeEqual } from "node:crypto";

/** Constant-time string comparison for token checks. */
export function safeEqualToken(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return a === b;
  }
}
