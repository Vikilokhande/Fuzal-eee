"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useFuzalGame, formatClock } from "@/lib/fuzal/useFuzalGame";
import { sessionStore, type JoinedPlayer } from "@/lib/fuzal/api";
import { Wordmark } from "@/components/Brand";
import { Avatar } from "@/components/PlayerList";
import { Countdown, GoFlash } from "@/components/Countdown";
import { PuzzleBoard } from "@/components/PuzzleBoard";
import { WinnerScreen } from "@/components/WinnerScreen";
import { ConnBanner } from "@/components/ConnBanner";

interface Session {
  player: JoinedPlayer;
}

export default function PlayerGamePage() {
  const params = useParams<{ code: string }>();
  const code = String(params.code).toUpperCase();
  const search = useSearchParams();
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [badSession, setBadSession] = useState(false);

  // Accept session via query string (from join), persist it, clean the URL.
  useEffect(() => {
    const p = search.get("p");
    const t = search.get("t");
    const n = search.get("n");
    if (p && t && n) {
      const s: Session = {
        player: { id: p, token: t, name: n, score: 0, slot: 0 },
      };
      sessionStore.set(`player:${code}`, s);
      setSession(s);
      window.history.replaceState(null, "", `/play/${code}`);
      return;
    }
    const stored = sessionStore.get<Session>(`player:${code}`);
    if (stored) setSession(stored);
    else setBadSession(true);
  }, [code, search]);

  const game = useFuzalGame(
    session
      ? {
          code,
          kind: "player",
          playerId: session.player.id,
          playerToken: session.player.token,
        }
      : { code, kind: "player" },
  );
  const {
    state,
    connState,
    toast,
    goFlash,
    memorySeconds,
    puzzleElapsedMs,
    puzzleRemainingMs,
    isEliminated,
    pieceSrcs,
    piecesLoading,
    piecesError,
    retryLoadPieces,
  } = game;

  const totalPieces = useMemo(
    () => (state ? state.gridCols * state.gridRows : 16),
    [state],
  );

  if (badSession) {
    return (
      <Center>
        <div className="glass max-w-sm p-8 text-center">
          <div className="text-6xl">🔌</div>
          <h2 className="mt-3 font-display text-2xl font-bold text-white">
            Unable to join the game
          </h2>
          <p className="mt-2 text-indigo-100/70">
            Your session is missing. Please scan the QR code again.
          </p>
          <button className="btn-primary mt-6 w-full" onClick={() => router.push(`/join/${code}`)}>
            Go to join page
          </button>
        </div>
      </Center>
    );
  }

  if (connState === "error" && !state) {
    return (
      <Center>
        <div className="glass max-w-sm p-8 text-center">
          <div className="text-6xl">⚠️</div>
          <h2 className="mt-3 font-display text-2xl font-bold text-white">Connection Failed</h2>
          <p className="mt-2 text-indigo-100/70">
            Unable to connect to game lobby <strong>{code}</strong>. The lobby may have ended or the server is unreachable.
          </p>
          <div className="mt-6 flex flex-col gap-3">
            <button className="btn-primary w-full" onClick={() => window.location.reload()}>
              Retry Connection
            </button>
            <button className="btn-secondary w-full" onClick={() => router.push(`/join/${code}`)}>
              Back to Join
            </button>
          </div>
        </div>
      </Center>
    );
  }

  if (!session || !state) {
    return (
      <Center>
        <span className="h-12 w-12 animate-spin rounded-full border-4 border-cyan-300 border-t-transparent" />
        <p className="mt-4 text-indigo-100/80">Connecting to game…</p>
      </Center>
    );
  }

  const me = state.players.find((p) => p.id === session.player.id);
  const mySlot = me?.slot ?? 0;

  return (
    <main className="relative mx-auto flex min-h-[100dvh] w-full max-w-md flex-col justify-between overflow-x-hidden px-3 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] pt-3 sm:px-4 sm:pt-4">
      <ConnBanner state={connState} />
      {toast && (
        <div className="fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-full bg-rose-500/95 px-5 py-2.5 text-sm font-bold text-white shadow-xl">
          {toast}
        </div>
      )}

      {/* FINISHED */}
      {state.status === "FINISHED" && (
        <WinnerScreen
          result={
            state.result ?? {
              winner: null,
              finishedAt: Date.now(),
              durationMs: 0,
              image: state.image,
              standings: state.players.map((p) => ({
                id: p.id,
                name: p.name,
                slot: p.slot,
                score: p.score,
                moves: 0,
                correctCount: 0,
                completed: false,
                connected: p.connected,
              })),
            }
          }
          isHost={false}
          youId={session.player.id}
          onBackToLobby={() => {
            game.actions.exitGame();
            router.push(`/join/${code}`);
          }}
          onExit={() => {
            game.actions.exitGame();
            router.push("/");
          }}
        />
      )}

      {state.status !== "FINISHED" && (
        <>
          <header className="flex shrink-0 items-center justify-between pb-2">
            <Wordmark size={24} />
            <div className="flex items-center gap-2 rounded-full bg-white/5 px-2.5 py-1">
              <Avatar name={session.player.name} slot={mySlot} connected={me?.connected ?? true} size="sm" />
              <span className="max-w-[6.5rem] truncate text-xs font-bold text-white">
                {session.player.name}
              </span>
              <span className="rounded-full bg-amber-400/20 px-1.5 py-0.5 text-[11px] font-bold text-amber-300">
                ★ {me?.score ?? 0}
              </span>
            </div>
          </header>

          {/* LOBBY */}
          {state.status === "LOBBY" && (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 py-4 text-center">
              <div className="glass w-full p-6 sm:p-8">
                <div className="animate-pop text-6xl">✅</div>
                <h2 className="mt-3 font-display text-3xl font-bold neon-text">
                  You&apos;re In!
                </h2>
                <p className="mt-1 text-lg font-bold text-white">
                  Player: {session.player.name}
                </p>
                <p className="mt-3 text-sm text-indigo-100/80">
                  Waiting for the host to start…
                </p>
                <div className="mt-5 rounded-2xl bg-black/30 px-5 py-3">
                  <p className="text-xs uppercase tracking-[0.25em] text-indigo-200/70">
                    Players
                  </p>
                  <p className="font-display text-3xl font-bold text-cyan-300">
                    {state.players.length} / {state.maxPlayers}
                  </p>
                </div>
                <div className="mt-5 flex flex-wrap justify-center gap-2">
                  {state.players.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center gap-1.5 rounded-full bg-white/5 py-1 pl-1 pr-2.5"
                    >
                      <Avatar name={p.name} slot={p.slot} connected={p.connected} size="sm" />
                      <span className="text-xs font-semibold text-white">{p.name}</span>
                    </div>
                  ))}
                </div>
                <span className="mt-5 inline-block h-7 w-7 animate-spin rounded-full border-4 border-cyan-300 border-t-transparent" />
                <div className="mt-4">
                  <button
                    type="button"
                    onClick={() => {
                      game.actions.exitGame();
                      router.push("/");
                    }}
                    className="text-xs text-indigo-200/60 underline-offset-4 hover:underline"
                  >
                    Exit Lobby
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* MEMORY */}
          {state.status === "MEMORY" && (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 py-4">
              <div className="glass flex w-full flex-col items-center gap-4 px-5 py-8 text-center">
                <p className="text-xs font-bold uppercase tracking-[0.3em] text-amber-300">
                  Round starting
                </p>
                <Countdown seconds={memorySeconds} caption="Seconds to memorize" />
                <div className="rounded-2xl bg-black/40 px-5 py-3">
                  <p className="text-base text-indigo-100/80">👀 Look at the</p>
                  <p className="font-display text-xl font-bold text-white">HOST SCREEN</p>
                  {state.imageName && (
                    <p className="mt-1 text-xs text-cyan-300">Image: {state.imageName}</p>
                  )}
                </div>
                <p className="text-xs text-indigo-200/60">
                  Memorize every piece before the timer ends!
                </p>
              </div>
            </div>
          )}

          {/* PUZZLE */}
          {state.status === "PUZZLE" && (
            <div className="flex flex-1 flex-col items-center justify-between gap-2 py-1">
              {goFlash && <GoFlash />}

              {/* Top HUD */}
              <div className="flex w-full items-center justify-between rounded-xl bg-white/5 px-4 py-2">
                <div>
                  <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-indigo-200/70">
                    Time
                  </p>
                  <p
                    className={`font-display text-lg font-bold tabular-nums ${
                      puzzleRemainingMs <= 30000
                        ? "animate-pulse text-rose-400"
                        : "text-cyan-300"
                    }`}
                  >
                    {formatClock(puzzleRemainingMs)}
                  </p>
                </div>
                <div className="text-center">
                  <p
                    className={`text-[9px] font-bold uppercase tracking-[0.2em] ${
                      state.puzzle?.completed ? "text-emerald-400" : "text-indigo-200/70"
                    }`}
                  >
                    {state.puzzle?.completed ? "Status" : "Arrange"}
                  </p>
                  <p className="text-xs font-semibold text-white">
                    {state.puzzle?.completed ? "🎉 Solved!" : "Tap or Drag"}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-indigo-200/70">
                    Moves
                  </p>
                  <p className="font-display text-lg font-bold text-fuchsia-300">
                    {state.puzzle?.moves ?? 0}
                  </p>
                </div>
              </div>

              {state.puzzle?.completed && !isEliminated && (
                <div className="flex w-full items-center justify-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/20 py-1.5 text-center text-xs font-semibold text-emerald-300 shadow">
                  <span>🎉</span>
                  <span>PUZZLE SOLVED! Waiting for results…</span>
                </div>
              )}

              {/* Main Board */}
              <div className="flex flex-1 items-center justify-center w-full py-1">
                {isEliminated ? (
                  <div className="glass flex w-full max-w-sm flex-col items-center justify-center gap-4 rounded-2xl p-6 text-center shadow-2xl ring-1 ring-rose-500/40">
                    <div className="animate-bounce text-5xl">⏰</div>
                    <div>
                      <h3 className="font-display text-2xl font-bold text-rose-400">
                        Time&apos;s Up!
                      </h3>
                      <p className="mt-1 text-sm font-bold text-white">
                        You were eliminated
                      </p>
                    </div>
                    <p className="text-xs text-indigo-100/70">
                      3-minute time limit expired.
                    </p>
                    <div className="rounded-xl border border-white/10 bg-black/40 px-4 py-2">
                      <p className="text-[10px] uppercase tracking-wider text-indigo-200/60">
                        Correct Pieces
                      </p>
                      <p className="font-display text-xl font-bold text-emerald-400">
                        {state.puzzle ? state.puzzle.correctSlots.filter(Boolean).length : 0} / {totalPieces}
                      </p>
                    </div>
                  </div>
                ) : state.puzzle ? (
                  <PuzzleBoard
                    board={state.puzzle.board}
                    cols={state.gridCols}
                    rows={state.gridRows}
                    pieceSrcs={pieceSrcs}
                    loading={piecesLoading}
                    error={piecesError}
                    completed={Boolean(state.puzzle.completed)}
                    onRetry={retryLoadPieces}
                    onSwap={game.actions.swap}
                  />
                ) : (
                  <div className="glass grid aspect-square w-full max-w-[min(94vw,480px)] place-items-center">
                    <span className="h-10 w-10 animate-spin rounded-full border-4 border-cyan-300 border-t-transparent" />
                  </div>
                )}
              </div>

              {/* Bottom Info */}
              <div className="flex w-full items-center justify-between px-2 text-[11px] text-indigo-200/60">
                <span>{state.puzzle ? state.puzzle.correctSlots.filter(Boolean).length : 0}/{totalPieces} correct</span>
                <span>Green border = correct spot</span>
              </div>
            </div>
          )}
        </>
      )}
    </main>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="fz-grid-bg absolute inset-0" aria-hidden />
      <div className="relative flex flex-col items-center">{children}</div>
    </main>
  );
}
