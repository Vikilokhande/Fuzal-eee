"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Wordmark, Logo } from "@/components/Brand";
import { createLobby, sessionStore } from "@/lib/fuzal/api";
import { GameShell } from "@/components/game/GameShell";
import { GridSelector } from "@/components/game/GridSelector";
import { GameBadge } from "@/components/game/GameBadge";

export default function GameSetupPage() {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gridSize, setGridSize] = useState<number>(3);

  const pieceCount = gridSize * gridSize;

  async function hostGame() {
    setCreating(true);
    setError(null);
    try {
      const lobby = await createLobby({ gridSize });
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

          <div className="mt-1 flex items-center gap-2">
            <GameBadge variant="ready" pulse>
              MULTIPLAYER ARENA
            </GameBadge>
            <GameBadge variant="grid">
              {gridSize}×{gridSize} • {pieceCount} PIECES
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

        {/* Primary CTA: Dynamic with gridSize */}
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
              Up to 5 players scan the lobby QR with their phone to enter the arena instantly.
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

        <p className="text-[11px] uppercase tracking-[0.3em] text-indigo-200/40">
          Host Arena View · Optimized for Big Screen TV &amp; Projectors
        </p>
      </div>
    </GameShell>
  );
}
