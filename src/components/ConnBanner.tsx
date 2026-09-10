"use client";

import type { ConnectionState } from "@/lib/fuzal/realtime";

export function ConnBanner({ state }: { state: ConnectionState }) {
  if (state === "open") return null;
  return (
    <div className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-2 bg-amber-500/95 py-2 text-sm font-bold text-slate-950">
      <span className="h-3 w-3 animate-pulse rounded-full bg-slate-950" />
      {state === "connecting" ? "Connecting…" : "Connection lost. Reconnecting…"}
    </div>
  );
}
