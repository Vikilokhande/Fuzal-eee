"use client";

import React from "react";
import { formatClock } from "@/lib/fuzal/useFuzalGame";
import type { ConnectionState } from "@/lib/fuzal/realtime";

export function PuzzleHUD({
  puzzleRemainingMs,
  moves,
  correctCount,
  totalPieces,
  completed,
  connState = "open",
}: {
  puzzleRemainingMs: number;
  moves: number;
  correctCount: number;
  totalPieces: number;
  completed: boolean;
  connState?: ConnectionState;
}) {
  const isUrgent = puzzleRemainingMs <= 30000;
  const percentage = Math.round((correctCount / totalPieces) * 100);

  return (
    <div className="w-full max-w-md mx-auto flex flex-col gap-1.5 shrink-0 px-1 select-none">
      {/* HUD Bar */}
      <div className="flex items-center justify-between rounded-2xl border border-cyan-500/20 bg-slate-900/80 px-4 py-2 shadow-[0_4px_20px_rgba(0,0,0,0.4)] backdrop-blur-md">
        {/* Timer Section */}
        <div className="flex flex-col items-start">
          <span className="text-[9px] font-extrabold uppercase tracking-[0.25em] text-indigo-200/70">
            Time Left
          </span>
          <span
            className={`font-display text-xl sm:text-2xl font-black tabular-nums tracking-wide ${
              isUrgent
                ? "animate-pulse text-rose-400 drop-shadow-[0_0_8px_rgba(244,63,94,0.6)]"
                : "text-cyan-300 drop-shadow-[0_0_8px_rgba(34,211,238,0.4)]"
            }`}
          >
            {formatClock(puzzleRemainingMs)}
          </span>
        </div>

        {/* Center Progress Badge */}
        <div className="flex flex-col items-center">
          <span
            className={`text-[9px] font-extrabold uppercase tracking-[0.25em] ${
              completed ? "text-emerald-400" : "text-indigo-200/70"
            }`}
          >
            {completed ? "Status" : "Progress"}
          </span>
          <div className="flex items-center gap-1.5">
            {completed ? (
              <span className="text-xs sm:text-sm font-black text-emerald-300 flex items-center gap-1">
                <span>🎉</span> SOLVED!
              </span>
            ) : (
              <div className="flex items-baseline gap-1">
                <span className="font-display text-lg sm:text-xl font-bold text-white">
                  {correctCount}
                </span>
                <span className="text-xs font-semibold text-white/50">
                  / {totalPieces}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Moves Count & Connection status */}
        <div className="flex flex-col items-end">
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] font-extrabold uppercase tracking-[0.25em] text-indigo-200/70">
              Moves
            </span>
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                connState === "open" ? "bg-emerald-400" : "bg-amber-400 animate-ping"
              }`}
              title={`Connection: ${connState}`}
            />
          </div>
          <span className="font-display text-xl sm:text-2xl font-black text-fuchsia-300 drop-shadow-[0_0_8px_rgba(232,121,249,0.4)]">
            {moves}
          </span>
        </div>
      </div>

      {/* Mini Progress Bar */}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800/80 p-0.5 border border-white/5">
        <div
          className={`h-full rounded-full transition-all duration-300 ${
            completed
              ? "bg-gradient-to-r from-emerald-400 to-teal-300 shadow-[0_0_10px_rgba(52,211,153,0.8)]"
              : "bg-gradient-to-r from-cyan-400 via-purple-500 to-fuchsia-400 shadow-[0_0_8px_rgba(34,211,238,0.5)]"
          }`}
          style={{ width: `${completed ? 100 : Math.max(3, percentage)}%` }}
        />
      </div>
    </div>
  );
}
