"use client";

import type { ConnectionState } from "@/lib/fuzal/realtime";

export function ConnBanner({ state }: { state: ConnectionState }) {
  // Only show warning during genuine connection failures/reconnects.
  // Never show for initial connecting, normal rotation, or open states.
  if (
    state === "open" ||
    state === "connecting" ||
    state === "rotating" ||
    state === "session_invalid"
  ) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed top-3 right-3 z-50 flex items-center gap-2 rounded-full border border-amber-400/40 bg-slate-900/90 px-3 py-1.5 text-xs font-semibold text-amber-300 shadow-xl backdrop-blur-md"
    >
      <span className="h-2 w-2 animate-pulse rounded-full bg-amber-400" />
      <span>Reconnecting…</span>
    </div>
  );
}
