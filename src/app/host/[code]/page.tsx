"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useFuzalGame, formatClock } from "@/lib/fuzal/useFuzalGame";
import { createLobby, sessionStore } from "@/lib/fuzal/api";
import { Wordmark, Logo } from "@/components/Brand";
import { WinnerScreen } from "@/components/WinnerScreen";
import { PhaseBanner, HostRoster } from "@/components/GameStatus";
import { ConnBanner } from "@/components/ConnBanner";
import { GameShell } from "@/components/game/GameShell";
import { GameBadge } from "@/components/game/GameBadge";
import { LobbyQRCard } from "@/components/game/LobbyQRCard";
import { PlayerRosterCard } from "@/components/game/PlayerRosterCard";
import { MemoryImage } from "@/components/MemoryImage";

export default function HostPage() {
  const params = useParams<{ code: string }>();
  const code = String(params.code).toUpperCase();
  const router = useRouter();
  const search = useSearchParams();

  const [token] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const sp = new URLSearchParams(window.location.search);
    const qt = sp.get("token");
    if (qt) {
      sessionStore.set(`host:${code}`, { token: qt });
      window.history.replaceState(null, "", `/host/${code}`);
      return qt;
    }
    const stored = sessionStore.get<{ token: string }>(`host:${code}`);
    return stored?.token ?? null;
  });

  const [badHost] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    const sp = new URLSearchParams(window.location.search);
    const qt = sp.get("token");
    if (qt) return false;
    const stored = sessionStore.get<{ token: string }>(`host:${code}`);
    return !stored?.token;
  });

  const game = useFuzalGame(token ? { code, kind: "host", hostToken: token } : { code, kind: "host" });
  const { state, connState, toast, memorySeconds, puzzleElapsedMs, puzzleRemainingMs, actions } = game;

  async function newLobby() {
    const lobby = await createLobby({ gridSize: state?.gridCols ?? 3 });
    sessionStore.set(`host:${lobby.code}`, { token: lobby.hostToken });
    router.push(`/host/${lobby.code}`);
  }

  if (badHost) {
    return (
      <GameShell maxWidth="max-w-md">
        <div className="glass w-full p-8 text-center flex flex-col items-center gap-4">
          <div className="text-6xl">🎛️</div>
          <h1 className="font-display text-3xl font-bold text-white">No Host Session</h1>
          <p className="text-sm text-indigo-200/70">
            Create a new FUZAL arena lobby to control the big screen.
          </p>
          <button className="btn-primary w-full py-3 mt-2" onClick={() => router.push("/")}>
            Create an Arena
          </button>
        </div>
      </GameShell>
    );
  }

  if (connState === "error" && !state) {
    return (
      <GameShell maxWidth="max-w-md">
        <div className="glass w-full p-8 text-center flex flex-col items-center gap-4">
          <div className="text-6xl">⚠️</div>
          <h1 className="font-display text-2xl font-bold text-white">Arena Connection Failed</h1>
          <p className="text-sm text-indigo-200/70">
            Unable to connect to game lobby <strong className="text-cyan-300">{code}</strong>.
          </p>
          <div className="flex flex-col gap-2.5 w-full mt-2">
            <button className="btn-primary w-full py-3" onClick={() => window.location.reload()}>
              Retry Connection
            </button>
            <button className="btn-secondary w-full py-2.5" onClick={() => router.push("/")}>
              Return to Setup
            </button>
          </div>
        </div>
      </GameShell>
    );
  }

  if (connState === "session_invalid" && token && !state) {
    return (
      <GameShell maxWidth="max-w-md">
        <div className="glass w-full p-8 text-center flex flex-col items-center gap-4">
          <div className="text-6xl">🔒</div>
          <h1 className="font-display text-2xl font-bold text-white">Host Session Ended</h1>
          <p className="text-sm text-indigo-200/70">
            This host token is no longer active. Create a new arena lobby to continue.
          </p>
          <button className="btn-primary w-full py-3 mt-2" onClick={() => router.push("/")}>
            Return to Setup
          </button>
        </div>
      </GameShell>
    );
  }

  if (!token || !state) {
    return (
      <GameShell maxWidth="max-w-sm">
        <div className="flex flex-col items-center gap-4 py-8">
          <div className="animate-float">
            <Logo size={64} />
          </div>
          <div className="flex items-center gap-3">
            <span className="h-3 w-3 animate-ping rounded-full bg-cyan-400 inline-block" />
            <p className="text-sm font-bold uppercase tracking-widest text-cyan-300">
              Opening Arena Lobby…
            </p>
          </div>
        </div>
      </GameShell>
    );
  }

  const players = state.players;
  const canStart = players.length >= 1;
  const totalPieces = state.pieceCount ?? state.gridCols * state.gridRows;

  return (
    <GameShell
      maxWidth={state.status === "FINISHED" ? "max-w-3xl" : "max-w-6xl"}
      header={
        <div className="flex items-center justify-between w-full select-none">
          <div className="flex items-center gap-3">
            <Logo size={32} />
            <Wordmark size={24} />
          </div>
          <div className="flex items-center gap-2">
            <GameBadge variant="code">{code}</GameBadge>
            <GameBadge variant="grid">
              {state.gridCols}×{state.gridRows} • {totalPieces} Pcs
            </GameBadge>
          </div>
        </div>
      }
    >
      <ConnBanner state={connState} />
      {toast && (
        <div className="fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-full bg-rose-500/95 px-6 py-2.5 text-sm font-bold text-white shadow-[0_0_20px_rgba(244,63,94,0.6)]">
          {toast}
        </div>
      )}

      {/* 1. FINISHED SCREEN */}
      {state.status === "FINISHED" && state.result && (
        <div className="w-full">
          <WinnerScreen
            result={state.result}
            isHost
            onPlayAgain={actions.playAgain}
            onBackToLobby={actions.backToLobby}
            onNewLobby={newLobby}
          />
        </div>
      )}

      {/* 2. MULTIPLAYER LOBBY */}
      {state.status === "LOBBY" && (
        <div className="flex w-full flex-col items-center gap-6 py-4 select-none">
          {/* Arena Top Banner */}
          <div className="flex flex-col items-center gap-2 text-center">
            <GameBadge variant="ready" pulse>
              EVENT ARENA LOBBY
            </GameBadge>
            <h2 className="font-display text-3xl sm:text-4xl md:text-5xl font-black text-white uppercase tracking-wider">
              Join The Arena
            </h2>
            <p className="text-sm sm:text-base text-indigo-200/80">
              Scan the QR code to enter the game • Up to {state.maxPlayers} players
            </p>
          </div>

          {/* Two-Column Event Lobby Grid */}
          <div className="grid w-full grid-cols-1 md:grid-cols-2 gap-6 lg:gap-10 items-start justify-items-center mt-2">
            {/* Left: QR Display Card */}
            <LobbyQRCard
              code={code}
              gridSize={state.gridCols}
              pieceCount={totalPieces}
              size={240}
            />

            {/* Right: Players Roster & Launch Game */}
            <PlayerRosterCard
              players={players}
              maxPlayers={state.maxPlayers}
              canStart={canStart}
              onStart={actions.startGame}
              onNewLobby={newLobby}
            />
          </div>
        </div>
      )}

      {/* 3. MEMORY PHASE */}
      {state.status === "MEMORY" && (
        <div className="flex w-full flex-col items-center gap-6 py-4 select-none">
          {/* Phase HUD Header */}
          <div className="flex flex-col items-center gap-1 text-center">
            <GameBadge variant="memory" pulse>
              MEMORY PHASE
            </GameBadge>
            <h2 className="font-display text-3xl sm:text-5xl font-black text-white uppercase tracking-wide">
              Memorize The Image
            </h2>
            <p className="text-sm sm:text-base text-indigo-200/80">
              Remember every detail before the scramble begins!
            </p>
          </div>

          {/* Projector-Optimized Display */}
          <div className="grid w-full items-center gap-6 md:grid-cols-[1fr_auto_1fr] mt-2">
            {/* Left: Players List */}
            <div className="order-2 md:order-1 flex justify-center md:justify-start">
              <div className="glass w-full max-w-sm p-5 border border-white/10">
                <p className="mb-3 text-xs font-bold uppercase tracking-[0.3em] text-indigo-200/70">
                  Arena Players ({players.length})
                </p>
                <div className="flex flex-col gap-2">
                  {players.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between rounded-xl bg-white/5 px-3 py-2 text-sm"
                    >
                      <span className="font-bold text-white truncate">{p.name}</span>
                      <span className="text-xs font-semibold text-emerald-400">Ready</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Center: Large High-Impact Image */}
            <div className="order-1 flex flex-col items-center gap-3 md:order-2">
              {state.image && (
                <MemoryImage
                  src={state.image.url}
                  name={state.image.name}
                  secondsLeft={memorySeconds}
                />
              )}
              {state.image?.name && (
                <span className="rounded-full bg-slate-900/80 px-4 py-1 text-xs font-mono font-bold text-cyan-300 border border-cyan-400/30">
                  {state.image.name} • {state.gridCols}×{state.gridRows} ({totalPieces} Pieces)
                </span>
              )}
            </div>

            {/* Right: Giant Dominant Countdown */}
            <div className="order-3 flex flex-col items-center justify-center md:justify-end">
              <div className="glass p-6 sm:p-8 flex flex-col items-center rounded-3xl border border-amber-400/30 shadow-[0_0_40px_rgba(251,191,36,0.2)]">
                <span className="text-xs font-extrabold uppercase tracking-[0.3em] text-amber-300">
                  Seconds To Memorize
                </span>
                <span
                  className={`font-display text-7xl sm:text-8xl md:text-9xl font-black leading-none tabular-nums mt-2 ${
                    memorySeconds <= 5
                      ? "animate-pulse text-rose-400 drop-shadow-[0_0_20px_rgba(244,63,94,0.8)]"
                      : "text-amber-300 drop-shadow-[0_0_20px_rgba(251,191,36,0.6)]"
                  }`}
                >
                  {memorySeconds < 10 ? `0${memorySeconds}` : memorySeconds}
                </span>
                <span className="text-xs text-indigo-200/60 uppercase tracking-widest mt-2">
                  SECONDS REMAINING
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 4. PUZZLE PHASE (Spectator Arena for Host) */}
      {state.status === "PUZZLE" && (
        <div className="flex w-full flex-col items-center gap-6 py-4 select-none">
          {/* Phase HUD Top */}
          <div className="flex flex-col sm:flex-row items-center justify-between w-full max-w-4xl glass p-4 sm:p-6 gap-4">
            <div className="flex flex-col items-start">
              <GameBadge variant="puzzle" pulse>
                PUZZLE IN PROGRESS
              </GameBadge>
              <h3 className="font-display text-2xl sm:text-3xl font-black text-white uppercase mt-1">
                Battle For The Solved Board
              </h3>
              <p className="text-xs sm:text-sm text-indigo-200/70">
                First player to complete {totalPieces} pieces wins the arena!
              </p>
            </div>

            <div className="flex flex-col items-center sm:items-end rounded-2xl bg-black/40 px-6 py-3 border border-white/10">
              <span className="text-[10px] font-extrabold uppercase tracking-[0.3em] text-indigo-200/70">
                Time Remaining
              </span>
              <span
                className={`font-display text-3xl sm:text-4xl font-black tabular-nums ${
                  puzzleRemainingMs <= 30000
                    ? "animate-pulse text-rose-400 drop-shadow-[0_0_10px_rgba(244,63,94,0.8)]"
                    : "text-cyan-300 drop-shadow-[0_0_10px_rgba(34,211,238,0.5)]"
                }`}
              >
                {formatClock(puzzleRemainingMs)}
              </span>
            </div>
          </div>

          {/* Live Player Progress Leaderboard */}
          <div className="w-full max-w-4xl">
            <HostRoster
              players={players}
              progress={state.puzzleProgress}
              totalPieces={totalPieces}
            />
          </div>

          <div className="flex items-center gap-3 text-xs text-indigo-200/70 py-2">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-cyan-400" />
            <span>Players are actively solving on their mobile devices…</span>
          </div>
        </div>
      )}
    </GameShell>
  );
}
