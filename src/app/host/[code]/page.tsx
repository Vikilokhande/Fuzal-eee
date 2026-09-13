"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useFuzalGame, formatClock } from "@/lib/fuzal/useFuzalGame";
import { createLobby, sessionStore } from "@/lib/fuzal/api";
import { Wordmark, Logo } from "@/components/Brand";
import { QRCodeDisplay } from "@/components/QRCodeDisplay";
import { PlayerSlots } from "@/components/PlayerList";
import { Countdown } from "@/components/Countdown";
import { MemoryImage } from "@/components/MemoryImage";
import { WinnerScreen } from "@/components/WinnerScreen";
import { PhaseBanner, HostRoster } from "@/components/GameStatus";
import { ConnBanner } from "@/components/ConnBanner";

export default function HostPage() {
  const params = useParams<{ code: string }>();
  const code = String(params.code).toUpperCase();
  const router = useRouter();
  const search = useSearchParams();
  const [token, setToken] = useState<string | null>(null);
  const [badHost, setBadHost] = useState(false);

  useEffect(() => {
    const qt = search.get("token");
    if (qt) {
      sessionStore.set(`host:${code}`, { token: qt });
      setToken(qt);
      window.history.replaceState(null, "", `/host/${code}`);
      return;
    }
    const stored = sessionStore.get<{ token: string }>(`host:${code}`);
    if (stored?.token) setToken(stored.token);
    else setBadHost(true);
  }, [code, search]);

  const game = useFuzalGame(token ? { code, kind: "host", hostToken: token } : { code, kind: "host" });
  const { state, connState, toast, memorySeconds, puzzleElapsedMs, puzzleRemainingMs, actions } = game;

  async function newLobby() {
    const lobby = await createLobby();
    sessionStore.set(`host:${lobby.code}`, { token: lobby.hostToken });
    router.push(`/host/${lobby.code}`);
  }

  if (badHost) {
    return (
      <main className="grid min-h-screen place-items-center px-6 text-center">
        <div className="glass max-w-md p-8">
          <div className="text-6xl">🎛️</div>
          <h1 className="mt-3 font-display text-3xl font-bold text-white">No host session</h1>
          <p className="mt-2 text-indigo-100/70">Create a new Fuzal lobby to display the big screen.</p>
          <button className="btn-primary mt-6 w-full" onClick={() => router.push("/")}>
            Create a lobby
          </button>
        </div>
      </main>
    );
  }

  if (connState === "error" && !state) {
    return (
      <main className="grid min-h-screen place-items-center px-6 text-center">
        <div className="glass max-w-md p-8">
          <div className="text-6xl">⚠️</div>
          <h1 className="mt-3 font-display text-2xl font-bold text-white">Lobby Connection Failed</h1>
          <p className="mt-2 text-indigo-100/70">
            Unable to connect to game lobby <strong>{code}</strong>. The lobby may have expired or the database server is unreachable.
          </p>
          <div className="mt-6 flex flex-col gap-3">
            <button className="btn-primary w-full" onClick={() => window.location.reload()}>
              Retry Connection
            </button>
            <button className="btn-secondary w-full" onClick={() => router.push("/")}>
              Back to Home
            </button>
          </div>
        </div>
      </main>
    );
  }

  if (!token || !state) {
    return (
      <main className="grid min-h-screen place-items-center">
        <div className="flex flex-col items-center gap-4">
          <div className="animate-float">
            <Logo size={64} />
          </div>
          <span className="h-10 w-10 animate-spin rounded-full border-4 border-cyan-300 border-t-transparent" />
          <p className="text-indigo-100/80">Opening lobby…</p>
        </div>
      </main>
    );
  }

  const players = state.players;
  const canStart = players.length >= 1;
  const totalPieces = state.pieceCount ?? state.gridCols * state.gridRows;

  return (
    <main className="relative min-h-screen w-full overflow-x-hidden px-3 py-6 sm:px-6 md:px-12 md:py-8">
      <div className="fz-grid-bg absolute inset-0" aria-hidden />
      <ConnBanner state={connState} />
      {toast && (
        <div className="fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-full bg-rose-500/95 px-5 py-2.5 text-sm font-bold text-white shadow-xl">
          {toast}
        </div>
      )}

      {/* FINISHED */}
      {state.status === "FINISHED" && state.result && (
        <WinnerScreen
          result={state.result}
          isHost
          onPlayAgain={actions.playAgain}
          onBackToLobby={actions.backToLobby}
          onNewLobby={newLobby}
        />
      )}

      {/* LOBBY */}
      {state.status === "LOBBY" && (
        <div className="relative mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-6xl flex-col items-center gap-6 sm:gap-8">
          <div className="animate-slide-up mt-1 sm:mt-2 flex flex-col items-center gap-2 sm:gap-3 text-center">
            <Wordmark size={44} />
            <p className="text-sm sm:text-lg font-semibold uppercase tracking-[0.3em] sm:tracking-[0.4em] text-cyan-200/90">
              Scan to Join the Game
            </p>
          </div>

          <div className="flex w-full flex-col items-center gap-6 md:grid md:grid-cols-[1.05fr_1fr] md:gap-10">
            <div className="glass flex w-full max-w-md flex-col items-center gap-4 sm:gap-6 px-4 py-6 sm:px-8 sm:py-8">
              <QRCodeDisplay code={code} size={220} />
              <p className="text-center text-xs sm:text-sm text-indigo-100/70">
                Point your phone camera at the QR code —
                <br />
                it opens instantly in your mobile browser.
              </p>
            </div>

            <div className="flex w-full max-w-md flex-col gap-4 sm:gap-6">
              <div className="glass px-5 py-4 text-center">
                <p className="text-xs font-bold uppercase tracking-[0.3em] text-indigo-200/70">
                  Players Joined
                </p>
                <p className="font-display text-4xl sm:text-6xl font-bold text-white">
                  <span className="neon-text">{players.length}</span>
                  <span className="text-2xl sm:text-3xl text-white/50"> / {state.maxPlayers}</span>
                </p>
              </div>
              <PlayerSlots players={players} maxPlayers={state.maxPlayers} />
              <button
                onClick={actions.startGame}
                disabled={!canStart}
                className="btn-primary w-full text-lg sm:text-2xl py-3 sm:py-4"
              >
                {canStart ? "🚀 START GAME" : "⏳ Waiting for players…"}
              </button>
              {!canStart && (
                <p className="text-center text-xs sm:text-sm text-indigo-200/70">
                  At least one player must join before starting.
                </p>
              )}
              <button
                onClick={newLobby}
                className="text-center text-xs sm:text-sm text-indigo-200/60 underline-offset-4 hover:underline"
              >
                Generate a new lobby / QR code
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MEMORY */}
      {state.status === "MEMORY" && (
        <div className="relative mx-auto flex min-h-[calc(100vh-4rem)] max-w-6xl flex-col items-center gap-6">
          <div className="flex w-full items-center justify-between">
            <Wordmark size={36} />
            <div className="rounded-full bg-white/5 px-5 py-2 text-sm font-bold uppercase tracking-[0.3em] text-indigo-200/80">
              {players.length} players
            </div>
          </div>

          <PhaseBanner status="MEMORY">
            <p className="text-indigo-100/70">Remember every detail!</p>
          </PhaseBanner>

          <div className="grid w-full flex-1 items-center gap-8 md:grid-cols-[1fr_auto_1fr]">
            <div className="order-2 md:order-1">
              <HostRoster players={players} progress={null} totalPieces={totalPieces} />
            </div>
            <div className="order-1 flex flex-col items-center gap-4 md:order-2">
              {state.image && (
                <MemoryImage
                  src={state.image.url}
                  name={state.image.name}
                  secondsLeft={memorySeconds}
                />
              )}
            </div>
            <div className="order-3 flex justify-center md:justify-end">
              <Countdown
                seconds={memorySeconds}
                caption="Time remaining"
                danger={memorySeconds <= 5}
              />
            </div>
          </div>
        </div>
      )}

      {/* PUZZLE — arrangements are NEVER shown here, only progress. */}
      {state.status === "PUZZLE" && (
        <div className="relative mx-auto flex min-h-[calc(100vh-4rem)] max-w-5xl flex-col items-center gap-8 py-4">
          <div className="flex w-full items-center justify-between">
            <Wordmark size={36} />
            <div className="glass flex items-center gap-4 px-7 py-3">
              <p className="text-xs font-bold uppercase tracking-[0.3em] text-indigo-200/70">
                Time Remaining
              </p>
              <p
                className={`font-display text-4xl font-bold tabular-nums ${
                  puzzleRemainingMs <= 30000
                    ? "animate-pulse text-rose-400"
                    : "text-cyan-300"
                }`}
              >
                {formatClock(puzzleRemainingMs)}
              </p>
            </div>
          </div>

          <PhaseBanner status="PUZZLE">
            <p className="text-indigo-100/70">First correct player wins!</p>
          </PhaseBanner>

          <HostRoster
            players={players}
            progress={state.puzzleProgress}
            totalPieces={totalPieces}
          />

          <div className="flex items-center gap-3 text-indigo-200/70">
            <span className="h-3 w-3 animate-pulse rounded-full bg-fuchsia-400" />
            Players are solving on their phones…
          </div>
        </div>
      )}
    </main>
  );
}
