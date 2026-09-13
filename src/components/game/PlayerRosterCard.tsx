"use client";

import React, { useEffect, useState, useRef } from "react";
import type { PlayerView } from "@/lib/fuzal/useFuzalGame";
import { Avatar } from "@/components/PlayerList";
import { GameBadge } from "./GameBadge";

export function PlayerRosterCard({
  players,
  maxPlayers = 5,
  canStart,
  onStart,
  onNewLobby,
}: {
  players: PlayerView[];
  maxPlayers?: number;
  canStart: boolean;
  onStart: () => void;
  onNewLobby?: () => void;
}) {
  const [recentJoiner, setRecentJoiner] = useState<string | null>(null);
  const prevCount = useRef(players.length);

  useEffect(() => {
    if (players.length > prevCount.current) {
      const newest = players[players.length - 1];
      if (newest) {
        setRecentJoiner(newest.name);
        const t = setTimeout(() => setRecentJoiner(null), 4000);
        return () => clearTimeout(t);
      }
    }
    prevCount.current = players.length;
  }, [players]);

  const openSlotsCount = Math.max(0, maxPlayers - players.length);
  // If maxPlayers > 8, display all joined players + max 2 empty placeholders to keep UI compact
  const emptyPlaceholdersToShow = maxPlayers <= 8 ? openSlotsCount : Math.min(openSlotsCount, 2);

  return (
    <div className="flex w-full max-w-md flex-col gap-4">
      {/* Roster Header Card */}
      <div className="glass p-5 flex items-center justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.3em] text-indigo-200/70">
            Players Joined
          </p>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-display text-4xl sm:text-5xl font-black text-cyan-300">
              {players.length}
            </span>
            <span className="text-xl sm:text-2xl font-bold text-white/40">
              / {maxPlayers}
            </span>
          </div>
        </div>

        <div className="flex flex-col items-end gap-1.5">
          <GameBadge variant="live" pulse>
            Lobby Open
          </GameBadge>
          <span className="text-[11px] font-semibold text-indigo-200/60">
            {maxPlayers - players.length > 0
              ? `${maxPlayers - players.length} slots open`
              : "Lobby full"}
          </span>
        </div>
      </div>

      {/* Live Activity Toast banner if a player joined */}
      {recentJoiner && (
        <div className="animate-slide-up flex items-center gap-2.5 rounded-xl border border-emerald-400/40 bg-emerald-500/15 px-4 py-2.5 shadow-[0_0_20px_rgba(52,211,153,0.3)]">
          <span className="h-2 w-2 animate-ping rounded-full bg-emerald-400" />
          <span className="text-xs font-bold uppercase tracking-wider text-emerald-300">
            Player Joined:
          </span>
          <span className="text-xs font-extrabold text-white truncate">
            {recentJoiner} entered the arena!
          </span>
        </div>
      )}

      {/* Slots List */}
      <div className="flex flex-col gap-2.5 w-full">
        {players.map((player, i) => (
          <div
            key={player.id}
            className="flex items-center gap-3.5 rounded-2xl border px-4 py-3 border-cyan-400/30 bg-slate-900/60 shadow-[0_4px_20px_rgba(0,0,0,0.3)] transition-all duration-300"
          >
            <Avatar name={player.name} slot={player.slot} connected={player.connected} size="md" />
            <div className="min-w-0 flex-1 text-left">
              <p className="truncate text-base sm:text-lg font-bold text-white">
                {player.name}
              </p>
              <p className="text-xs text-indigo-200/70 flex items-center gap-1.5">
                {player.connected ? (
                  <>
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 inline-block" />
                    <span className="text-emerald-300 font-semibold">Ready in Arena</span>
                  </>
                ) : (
                  <>
                    <span className="h-1.5 w-1.5 rounded-full bg-rose-500 inline-block" />
                    <span className="text-rose-400 font-semibold">Disconnected</span>
                  </>
                )}
              </p>
            </div>
            <span className="rounded-lg bg-white/5 px-2 py-1 font-mono text-xs font-bold text-cyan-300/80">
              SLOT {player.slot || i + 1}
            </span>
          </div>
        ))}

        {Array.from({ length: emptyPlaceholdersToShow }).map((_, idx) => {
          const slotNum = players.length + idx + 1;
          return (
            <div
              key={`empty-${slotNum}`}
              className="flex items-center gap-3.5 rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-4 py-3 transition-all duration-300"
            >
              <div className="grid h-10 w-10 place-items-center rounded-full border border-dashed border-white/20 text-xs font-bold text-white/30">
                {slotNum}
              </div>
              <div className="flex-1 text-left">
                <p className="text-sm sm:text-base font-medium text-white/30 italic">
                  Waiting for player…
                </p>
              </div>
              <span className="text-[11px] font-medium text-white/20 uppercase tracking-widest">
                OPEN
              </span>
            </div>
          );
        })}

        {openSlotsCount > emptyPlaceholdersToShow && (
          <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.01] px-4 py-2 text-center text-xs font-mono text-indigo-200/50">
            +{openSlotsCount - emptyPlaceholdersToShow} more open slots available (up to {maxPlayers} players)
          </div>
        )}
      </div>

      {/* Primary Action Button */}
      <div className="pt-2 flex flex-col gap-2.5">
        <button
          type="button"
          onClick={onStart}
          disabled={!canStart}
          className="btn-primary w-full text-lg sm:text-xl py-4 font-black tracking-wide flex items-center justify-center gap-3"
        >
          {canStart ? (
            <>
              <span className="text-2xl">🚀</span>
              <span>START GAME</span>
            </>
          ) : (
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 animate-ping rounded-full bg-cyan-400 inline-block" />
              <span className="text-base tracking-wider uppercase">Waiting for players…</span>
            </div>
          )}
        </button>

        {!canStart && (
          <p className="text-center text-xs text-indigo-200/70">
            At least 1 player must join the arena before launching.
          </p>
        )}

        {onNewLobby && (
          <button
            type="button"
            onClick={onNewLobby}
            className="text-center text-xs text-indigo-200/50 hover:text-cyan-300 transition-colors py-1"
          >
            Create a different arena lobby
          </button>
        )}
      </div>
    </div>
  );
}
