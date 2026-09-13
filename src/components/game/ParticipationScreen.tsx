"use client";

import React from "react";
import { Wordmark, Logo } from "@/components/Brand";
import { GameBadge } from "./GameBadge";

export function ParticipationScreen({
  playerName,
  gameCode,
  result,
  score,
  onPlayAgain,
  onReturnHome,
}: {
  playerName: string;
  gameCode: string;
  result?: "WINNER" | "PARTICIPANT" | "TIME_EXPIRED";
  score?: number;
  onPlayAgain?: () => void;
  onReturnHome: () => void;
}) {
  const isWinner = result === "WINNER";

  return (
    <div className="relative flex min-h-[100dvh] w-full flex-col items-center justify-center p-4 sm:p-6 text-center select-none">
      {/* Ambient background grid and glow */}
      <div className="fz-grid-bg absolute inset-0 z-0" aria-hidden="true" />
      <div className="pointer-events-none absolute h-80 w-80 rounded-full bg-cyan-500/20 blur-[120px]" />
      <div className="pointer-events-none absolute h-80 w-80 rounded-full bg-fuchsia-500/20 blur-[120px]" />

      <div className="relative z-10 flex w-full max-w-md flex-col items-center gap-6">
        {/* Logo */}
        <div className="flex flex-col items-center gap-2">
          <div className="animate-float">
            <Logo size={48} />
          </div>
          <Wordmark size={36} />
        </div>

        {/* Participation Card */}
        <div className="glass w-full p-6 sm:p-8 flex flex-col items-center gap-5 border border-cyan-500/30 shadow-[0_10px_40px_rgba(0,0,0,0.6)]">
          <div className="text-6xl animate-bounce">
            {isWinner ? "🏆" : "✨"}
          </div>

          <div className="flex flex-col items-center gap-1.5">
            <h2 className="font-display text-2xl sm:text-3xl font-black text-white uppercase tracking-wider">
              {isWinner ? "Victory Achieved!" : "Thank You For Participating!"}
            </h2>
            <p className="text-sm text-indigo-200/80">
              {isWinner
                ? "You solved the puzzle first and conquered the arena!"
                : "Thanks for playing FUZAL. You were part of this live match."}
            </p>
          </div>

          {/* Game & Player Details Badge Grid */}
          <div className="grid grid-cols-2 gap-3 w-full my-1">
            <div className="rounded-xl border border-white/10 bg-slate-900/60 p-3 flex flex-col items-center">
              <span className="text-[10px] font-bold uppercase tracking-widest text-indigo-200/60">
                Player
              </span>
              <span className="mt-0.5 font-display text-lg font-bold text-white truncate max-w-full">
                {playerName}
              </span>
            </div>

            <div className="rounded-xl border border-white/10 bg-slate-900/60 p-3 flex flex-col items-center">
              <span className="text-[10px] font-bold uppercase tracking-widest text-indigo-200/60">
                Game Arena
              </span>
              <span className="mt-0.5 font-mono text-lg font-bold text-cyan-300">
                {gameCode}
              </span>
            </div>
          </div>

          {/* Result Status */}
          <div className="w-full flex items-center justify-between rounded-xl bg-white/5 px-4 py-2.5">
            <span className="text-xs font-bold uppercase tracking-wider text-indigo-200/70">
              Match Result
            </span>
            <GameBadge
              variant={isWinner ? "solved" : result === "TIME_EXPIRED" ? "eliminated" : "ready"}
            >
              {isWinner ? "WINNER 🏆" : result === "TIME_EXPIRED" ? "TIME EXPIRED" : "PARTICIPANT"}
            </GameBadge>
          </div>

          {score !== undefined && score > 0 && (
            <div className="w-full flex items-center justify-between rounded-xl bg-white/5 px-4 py-2.5">
              <span className="text-xs font-bold uppercase tracking-wider text-indigo-200/70">
                Player Score
              </span>
              <span className="font-mono text-sm font-bold text-amber-300">
                ★ {score} pts
              </span>
            </div>
          )}

          <p className="text-xs text-indigo-200/60 italic">
            See you in the next arena showdown!
          </p>

          {/* CTAs */}
          <div className="flex flex-col gap-2.5 w-full pt-2">
            {onPlayAgain && (
              <button
                type="button"
                onClick={onPlayAgain}
                className="btn-primary w-full py-3.5 text-base font-bold flex items-center justify-center gap-2"
              >
                <span>🎮</span>
                <span>PLAY AGAIN</span>
              </button>
            )}
            <button
              type="button"
              onClick={onReturnHome}
              className="btn-secondary w-full py-3 text-sm font-bold flex items-center justify-center gap-2"
            >
              <span>🚪</span>
              <span>EXIT TO JOIN</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
