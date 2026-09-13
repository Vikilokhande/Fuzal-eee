"use client";

import React from "react";

export function CinematicTransition({
  active,
  countdown,
}: {
  active: boolean;
  countdown?: number;
}) {
  if (!active && (countdown === undefined || countdown > 3 || countdown <= 0)) {
    return null;
  }

  const text = active ? "GO!" : String(countdown);

  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-fade-in select-none">
      <div className="relative flex flex-col items-center justify-center">
        {/* Glow halo */}
        <div className="absolute h-72 w-72 rounded-full bg-gradient-to-r from-cyan-500/40 to-fuchsia-500/40 blur-3xl animate-pulse" />

        {!active && (
          <p className="relative mb-2 text-xs sm:text-sm font-extrabold uppercase tracking-[0.4em] text-cyan-300">
            Get Ready
          </p>
        )}

        <span
          key={text}
          className={`relative font-display font-black leading-none tracking-wider ${
            active
              ? "text-7xl sm:text-9xl text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-purple-300 to-fuchsia-400 drop-shadow-[0_0_40px_rgba(34,211,238,0.9)] animate-scale-up"
              : "text-7xl sm:text-8xl text-white drop-shadow-[0_0_30px_rgba(232,121,249,0.8)] animate-count"
          }`}
        >
          {text}
        </span>
      </div>
    </div>
  );
}
