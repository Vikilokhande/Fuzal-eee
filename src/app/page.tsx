"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { Wordmark, Logo } from "@/components/Brand";
import { createLobby, sessionStore } from "@/lib/fuzal/api";
import { GAME_CONFIG } from "@/lib/game/config";
import { GameShell } from "@/components/game/GameShell";
import { GridSelector } from "@/components/game/GridSelector";
import { GameBadge } from "@/components/game/GameBadge";

const CAPACITY_PRESETS = [4, 8, 16, 32, 50, 100];

export default function GameSetupPage() {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gridSize, setGridSize] = useState<number>(3);
  const [maxPlayers, setMaxPlayers] = useState<number>(GAME_CONFIG.defaultCapacity ?? 8);

  const pieceCount = gridSize * gridSize;

  async function hostGame() {
    setCreating(true);
    setError(null);
    try {
      const lobby = await createLobby({ gridSize, maxPlayers });
      sessionStore.set(`host:${lobby.code}`, {
        token: lobby.hostToken,
        createdAt: Date.now(),
      });
      router.push(`/host/${lobby.code}`);
    } catch (e) {
      setError((e as Error).message);
      setCreating(false);
    }
  }

  return (
    <GameShell maxWidth="max-w-4xl">
      <div className="flex w-full flex-col items-center gap-8 py-8 text-center select-none">
        {/* Arena Setup Hero */}
        <div className="flex flex-col items-center gap-4">
          <div className="animate-float">
            <Logo size={76} />
          </div>
          <Wordmark size={56} />

          <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
            <GameBadge variant="ready" pulse>
              MULTIPLAYER ARENA
            </GameBadge>
            <GameBadge variant="grid">
              {gridSize}×{gridSize} • {pieceCount} PIECES
            </GameBadge>
            <GameBadge variant="neutral">
              1–{maxPlayers} PLAYERS
            </GameBadge>
          </div>

          <h1 className="font-display text-4xl sm:text-5xl md:text-6xl font-black uppercase tracking-wide text-white">
            Create Your Game
          </h1>
          <p className="max-w-xl text-base sm:text-lg text-indigo-200/80">
            Set the arena. Choose the challenge. Let the game begin.
          </p>
        </div>

        {/* Dynamic Grid Selector */}
        <div className="w-full flex flex-col items-center">
          <GridSelector
            value={gridSize}
            onChange={setGridSize}
            disabled={creating}
          />
        </div>

        {/* Configurable Player Capacity */}
        <div className="flex flex-col items-center gap-3 w-full max-w-md glass p-5 border border-white/10 rounded-2xl">
          <div className="flex items-center justify-between w-full">
            <span className="text-xs font-bold uppercase tracking-wider text-indigo-200/70">
              Lobby Player Capacity
            </span>
            <span className="font-mono text-sm font-black text-cyan-300">
              {maxPlayers} Players Max
            </span>
          </div>

          {/* Stepper + Presets */}
          <div className="flex items-center justify-center gap-4 w-full">
            <button
              type="button"
              disabled={creating || maxPlayers <= 1}
              onClick={() => setMaxPlayers((m) => Math.max(1, m - 1))}
              className="h-10 w-10 rounded-xl bg-slate-900/80 border border-white/10 hover:border-cyan-400 text-white font-black text-lg disabled:opacity-30 transition-colors"
            >
              −
            </button>
            <span className="font-display text-3xl font-black text-white w-20 text-center tabular-nums">
              {maxPlayers}
            </span>
            <button
              type="button"
              disabled={creating || maxPlayers >= 100}
              onClick={() => setMaxPlayers((m) => Math.min(100, m + 1))}
              className="h-10 w-10 rounded-xl bg-slate-900/80 border border-white/10 hover:border-cyan-400 text-white font-black text-lg disabled:opacity-30 transition-colors"
            >
              +
            </button>
          </div>

          {/* Quick Preset Buttons */}
          <div className="flex flex-wrap items-center justify-center gap-1.5 w-full pt-1">
            {CAPACITY_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                disabled={creating}
                onClick={() => setMaxPlayers(preset)}
                className={`px-3 py-1 text-xs font-mono font-bold rounded-lg border transition-all ${
                  maxPlayers === preset
                    ? "border-cyan-400 bg-cyan-500/25 text-white shadow-[0_0_10px_rgba(34,211,238,0.3)]"
                    : "border-white/10 bg-slate-900/50 text-indigo-200/60 hover:text-white"
                }`}
              >
                {preset}P
              </button>
            ))}
          </div>
        </div>

        {/* Primary CTA: Dynamic with gridSize and maxPlayers */}
        <div className="flex flex-col items-center gap-3 w-full max-w-md">
          <button
            type="button"
            onClick={hostGame}
            disabled={creating}
            className="btn-primary w-full py-4 text-xl sm:text-2xl font-black tracking-wider uppercase flex items-center justify-center gap-3 shadow-[0_10px_35px_rgba(34,211,238,0.4)]"
          >
            {creating ? (
              <div className="flex items-center gap-3">
                <span className="h-3 w-3 animate-ping rounded-full bg-slate-900 inline-block" />
                <span className="text-lg">CREATING ARENA…</span>
              </div>
            ) : (
              <>
                <span className="text-2xl">🎮</span>
                <span>HOST GAME • {gridSize}×{gridSize}</span>
              </>
            )}
          </button>

          {error && (
            <div className="rounded-xl border border-rose-500/40 bg-rose-500/20 px-4 py-2 text-xs font-semibold text-rose-300">
              {error}
            </div>
          )}
        </div>

        {/* Derived Dynamic Gameplay Flow (Zero Stale Copy) */}
        <div className="grid w-full max-w-3xl grid-cols-1 gap-3.5 sm:grid-cols-3 pt-2">
          <div className="glass p-4 sm:p-5 text-left border border-white/10 hover:border-cyan-400/30 transition-colors">
            <div className="mb-2 text-2xl">📱</div>
            <p className="font-display text-base font-bold text-white uppercase tracking-wider">
              1 · Scan to Join
            </p>
            <p className="mt-1 text-xs sm:text-sm text-indigo-200/70">
              Up to {maxPlayers} players scan the lobby QR with their phone to enter the arena instantly.
            </p>
          </div>

          <div className="glass p-4 sm:p-5 text-left border border-white/10 hover:border-amber-400/30 transition-colors">
            <div className="mb-2 text-2xl">👁️</div>
            <p className="font-display text-base font-bold text-white uppercase tracking-wider">
              2 · Memorize Image
            </p>
            <p className="mt-1 text-xs sm:text-sm text-indigo-200/70">
              The puzzle image is revealed on the big screen for 30 seconds of intense memorization.
            </p>
          </div>

          <div className="glass p-4 sm:p-5 text-left border border-white/10 hover:border-fuchsia-400/30 transition-colors">
            <div className="mb-2 text-2xl">🧩</div>
            <p className="font-display text-base font-bold text-white uppercase tracking-wider">
              3 · Solve First
            </p>
            <p className="mt-1 text-xs sm:text-sm text-indigo-200/70">
              <span className="text-cyan-300 font-bold">{pieceCount} shuffled pieces</span> on every phone. Fastest solver claims victory.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between w-full max-w-md pt-2">
          <Link
            href="/host"
            className="text-xs font-mono font-bold text-cyan-400 hover:text-cyan-300 flex items-center gap-1.5 transition-colors"
          >
            <span>🎛️</span>
            <span>Host Control Room &amp; Analytics</span>
          </Link>
          <span className="text-[11px] uppercase tracking-[0.2em] text-indigo-200/40">
            TV &amp; Projector Ready
          </span>
        </div>
      </div>
    </GameShell>
  );
}
