"use client";

import React from "react";
import { Wordmark, Logo } from "@/components/Brand";
import { GameBadge } from "@/components/game/GameBadge";
import { formatClock } from "@/lib/game/format";

export function ControlRoomTopBar({
  lobbyCode,
  status,
  playersCount,
  maxPlayers,
  puzzleName,
  gridCols,
  gridRows,
  pieceCount,
  timerMs,
  onOpenDisplay,
  onNewArena,
}: {
  lobbyCode?: string;
  status?: string;
  playersCount: number;
  maxPlayers: number;
  puzzleName?: string | null;
  gridCols: number;
  gridRows: number;
  pieceCount: number;
  timerMs?: number | null;
  onOpenDisplay?: () => void;
  onNewArena?: () => void;
}) {
  const isLive = status === "LOBBY" || status === "MEMORY" || status === "PUZZLE";
  const timerText = timerMs !== null && timerMs !== undefined ? formatClock(timerMs) : "—";

  return (
    <header className="sticky top-0 z-40 w-full border-b border-cyan-500/20 bg-slate-950/90 backdrop-blur-md px-4 py-2.5 sm:px-6">
      <div className="mx-auto flex flex-wrap items-center justify-between gap-3 max-w-7xl">
        {/* Brand & Cockpit Title */}
        <div className="flex items-center gap-3">
          <Wordmark size={22} />
          <div className="hidden sm:block h-5 w-px bg-white/15" />
          <span className="hidden sm:inline-block font-mono text-xs font-black uppercase tracking-[0.25em] text-cyan-300">
            Control Room
          </span>
          <GameBadge variant={isLive ? "live" : "neutral"} pulse={isLive}>
            {isLive ? "ARENA LIVE" : "IDLE"}
          </GameBadge>
        </div>

        {/* HUD Metadata Pill Grid */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {lobbyCode && (
            <div className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-slate-900/80 px-2.5 py-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-200/60">
                Lobby:
              </span>
              <span className="font-mono text-xs font-black text-cyan-300">
                {lobbyCode}
              </span>
            </div>
          )}

          {playersCount !== undefined && (
            <div className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-slate-900/80 px-2.5 py-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-200/60">
                Players:
              </span>
              <span className="font-mono text-xs font-black text-emerald-400">
                {playersCount}
              </span>
              <span className="text-white/40">/</span>
              <span className="font-mono text-xs text-white/70">
                {maxPlayers}
              </span>
            </div>
          )}

          {gridCols > 0 && gridRows > 0 && (
            <div className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-slate-900/80 px-2.5 py-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-200/60">
                Grid:
              </span>
              <span className="font-mono text-xs font-black text-purple-300">
                {gridCols}×{gridRows}
              </span>
              <span className="text-[10px] text-white/50">
                ({pieceCount} Pcs)
              </span>
            </div>
          )}

          {status && (
            <div className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-slate-900/80 px-2.5 py-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-200/60">
                Phase:
              </span>
              <span className="font-mono text-xs font-black text-amber-300">
                {status}
              </span>
            </div>
          )}

          {timerMs !== undefined && timerMs !== null && (
            <div className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-slate-900/80 px-2.5 py-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-200/60">
                Timer:
              </span>
              <span className="font-mono text-xs font-black text-cyan-300">
                {timerText}
              </span>
            </div>
          )}
        </div>

        {/* Quick Actions */}
        <div className="flex items-center gap-2">
          {onNewArena && (
            <button
              type="button"
              onClick={onNewArena}
              className="btn-primary px-3 py-1.5 text-xs font-bold flex items-center gap-1.5"
            >
              <span>✨</span>
              <span>New Arena</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
