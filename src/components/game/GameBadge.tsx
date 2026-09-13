"use client";

import React from "react";

type BadgeVariant =
  | "live"
  | "ready"
  | "memory"
  | "puzzle"
  | "solved"
  | "eliminated"
  | "grid"
  | "code"
  | "neutral";

export function GameBadge({
  variant = "neutral",
  children,
  className = "",
  pulse = false,
}: {
  variant?: BadgeVariant;
  children: React.ReactNode;
  className?: string;
  pulse?: boolean;
}) {
  const styles: Record<BadgeVariant, string> = {
    live: "border-emerald-400/40 bg-emerald-500/15 text-emerald-300 shadow-[0_0_15px_rgba(52,211,153,0.3)]",
    ready: "border-cyan-400/40 bg-cyan-500/15 text-cyan-200 shadow-[0_0_12px_rgba(34,211,238,0.25)]",
    memory: "border-amber-400/40 bg-amber-500/15 text-amber-200 shadow-[0_0_14px_rgba(251,191,36,0.3)]",
    puzzle: "border-fuchsia-400/40 bg-fuchsia-500/15 text-fuchsia-200 shadow-[0_0_15px_rgba(232,121,249,0.3)]",
    solved: "border-emerald-400/50 bg-emerald-500/20 text-emerald-200 shadow-[0_0_20px_rgba(52,211,153,0.4)]",
    eliminated: "border-rose-400/40 bg-rose-500/15 text-rose-300 shadow-[0_0_12px_rgba(244,63,94,0.3)]",
    grid: "border-cyan-400/40 bg-slate-900/80 text-cyan-300 shadow-[0_0_10px_rgba(34,211,238,0.2)] font-mono",
    code: "border-purple-400/40 bg-purple-500/15 text-purple-200 font-mono tracking-widest font-black shadow-[0_0_12px_rgba(168,85,247,0.3)]",
    neutral: "border-white/15 bg-white/5 text-indigo-100/80",
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-[0.2em] backdrop-blur-md transition-all ${
        styles[variant]
      } ${pulse ? "animate-pulse" : ""} ${className}`}
    >
      {variant === "live" && (
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
        </span>
      )}
      {children}
    </span>
  );
}
