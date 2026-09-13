"use client";

import React from "react";

export interface GridOption {
  n: number;
  label: string;
  pieces: number;
  difficulty: "Fast" | "Standard" | "Pro" | "Insane";
}

export const GRID_OPTIONS: GridOption[] = [
  { n: 2, label: "2×2", pieces: 4, difficulty: "Fast" },
  { n: 3, label: "3×3", pieces: 9, difficulty: "Standard" },
  { n: 4, label: "4×4", pieces: 16, difficulty: "Standard" },
  { n: 5, label: "5×5", pieces: 25, difficulty: "Pro" },
  { n: 6, label: "6×6", pieces: 36, difficulty: "Pro" },
  { n: 7, label: "7×7", pieces: 49, difficulty: "Insane" },
  { n: 8, label: "8×8", pieces: 64, difficulty: "Insane" },
];

export function GridSelector({
  value,
  onChange,
  disabled = false,
}: {
  value: number;
  onChange: (n: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex w-full flex-col items-center gap-3">
      <div className="flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
        <span className="text-xs font-bold uppercase tracking-[0.3em] text-cyan-300/90">
          Select Puzzle Arena Grid
        </span>
        <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
      </div>

      <div className="grid w-full max-w-2xl grid-cols-2 gap-2.5 sm:grid-cols-4 md:grid-cols-7">
        {GRID_OPTIONS.map((opt) => {
          const isSelected = value === opt.n;
          return (
            <button
              key={opt.n}
              type="button"
              disabled={disabled}
              onClick={() => onChange(opt.n)}
              className={`group relative flex flex-col items-center justify-center rounded-2xl p-3 text-center transition-all duration-200 ${
                isSelected
                  ? "scale-[1.06] border-2 border-cyan-400 bg-gradient-to-b from-cyan-500/25 to-purple-600/25 shadow-[0_0_25px_rgba(34,211,238,0.55)] ring-1 ring-white/30"
                  : "border border-white/10 bg-white/[0.04] hover:border-cyan-400/40 hover:bg-white/[0.08] hover:scale-[1.02]"
              } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
            >
              {/* Selected indicator pill */}
              {isSelected && (
                <span className="absolute -top-2.5 rounded-full bg-cyan-400 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-slate-950 shadow-[0_0_10px_rgba(34,211,238,0.8)]">
                  Active
                </span>
              )}

              <span
                className={`font-display text-xl font-black transition-colors ${
                  isSelected ? "neon-text text-2xl" : "text-white group-hover:text-cyan-200"
                }`}
              >
                {opt.label}
              </span>

              <span
                className={`mt-1 text-[11px] font-bold uppercase tracking-wider ${
                  isSelected ? "text-cyan-300 font-extrabold" : "text-indigo-200/60"
                }`}
              >
                {opt.pieces} Pieces
              </span>

              <span
                className={`mt-1.5 rounded-md px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${
                  opt.difficulty === "Fast"
                    ? "bg-emerald-500/20 text-emerald-300"
                    : opt.difficulty === "Standard"
                      ? "bg-cyan-500/20 text-cyan-300"
                      : opt.difficulty === "Pro"
                        ? "bg-fuchsia-500/20 text-fuchsia-300"
                        : "bg-rose-500/20 text-rose-300"
                }`}
              >
                {opt.difficulty}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
