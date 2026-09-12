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
    <main className="relative mx-auto flex min-h-screen w-full max-w-md flex-col px-4 pb-8 pt-5">
      <ConnBanner state={connState} />
      {toast && (
        <div className="fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-full bg-rose-500/95 px-5 py-2.5 text-sm font-bold text-white shadow-xl">
          {toast}
        </div>
      )}

      {/* FINISHED */}
      {state.status === "FINISHED" && state.result && (
        <WinnerScreen result={state.result} isHost={false} youId={session.player.id} />
      )}

      {state.status !== "FINISHED" && (
        <>
          <header className="flex items-center justify-between">
            <Wordmark size={26} />
            <div className="flex items-center gap-2 rounded-full bg-white/5 px-3 py-1.5">
              <Avatar name={session.player.name} slot={mySlot} connected={me?.connected ?? true} size="sm" />
              <span className="max-w-[7rem] truncate text-sm font-bold text-white">
                {session.player.name}
              </span>
              <span className="rounded-full bg-amber-400/20 px-2 py-0.5 text-xs font-bold text-amber-300">
                ★ {me?.score ?? 0}
              </span>
            </div>
          </header>

          {/* LOBBY */}
          {state.status === "LOBBY" && (
            <div className="flex flex-1 flex-col items-center justify-center gap-6 py-8 text-center">
              <div className="glass w-full p-8">
                <div className="animate-pop text-7xl">✅</div>
                <h2 className="mt-4 font-display text-4xl font-bold neon-text">
                  You&apos;re In!
                </h2>
                <p className="mt-1 text-xl font-bold text-white">
                  Player: {session.player.name}
                </p>
                <p className="mt-4 text-indigo-100/80">
                  Waiting for the host
                  <br />
                  to start the game…
                </p>
                <div className="mt-6 rounded-2xl bg-black/30 px-6 py-4">
                  <p className="text-sm uppercase tracking-[0.3em] text-indigo-200/70">
                    Players
                  </p>
                  <p className="font-display text-4xl font-bold text-cyan-300">
                    {state.players.length} / {state.maxPlayers}
                  </p>
                </div>
                <div className="mt-6 flex flex-wrap justify-center gap-2">
                  {state.players.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center gap-2 rounded-full bg-white/5 py-1 pl-1 pr-3"
                    >
                      <Avatar name={p.name} slot={p.slot} connected={p.connected} size="sm" />
                      <span className="text-sm font-semibold text-white">{p.name}</span>
                    </div>
                  ))}
                </div>
                <span className="mt-6 inline-block h-8 w-8 animate-spin rounded-full border-4 border-cyan-300 border-t-transparent" />
              </div>
            </div>
          )}

          {/* MEMORY — players must look at the big screen, image is never sent. */}
          {state.status === "MEMORY" && (
            <div className="flex flex-1 flex-col items-center justify-center gap-6 py-6">
              <div className="glass flex w-full flex-col items-center gap-5 px-6 py-10 text-center">
                <p className="text-sm font-bold uppercase tracking-[0.35em] text-amber-300">
                  Round starting
                </p>
                <Countdown seconds={memorySeconds} caption="Seconds left to memorize" />
                <div className="rounded-2xl bg-black/40 px-6 py-4">
                  <p className="text-lg text-indigo-100/80">👀 Memorize the image on the</p>
                  <p className="font-display text-2xl font-bold text-white">BIG SCREEN</p>
                  {state.imageName && (
                    <p className="mt-2 text-sm text-cyan-300">Image: {state.imageName}</p>
                  )}
                </div>
                <p className="text-sm text-indigo-200/60">
                  Remember every detail — it disappears when the timer ends!
                </p>
              </div>
            </div>
          )}

          {/* PUZZLE */}
          {state.status === "PUZZLE" && (
            <div className="flex flex-1 flex-col items-center gap-4 py-4">
              {goFlash && <GoFlash />}
              <div className="flex w-full max-w-[min(94vw,560px)] items-center justify-between rounded-2xl bg-white/5 px-5 py-3">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-indigo-200/70">
                    Time Left
                  </p>
                  <p
                    className={`font-display text-2xl font-bold tabular-nums ${
                      puzzleRemainingMs <= 30000
                        ? "animate-pulse text-rose-400"
                        : "text-cyan-300"
                    }`}
                  >
                    {formatClock(puzzleRemainingMs)}
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-indigo-200/70">
                    Arrange the image
                  </p>
                  <p className="text-sm font-semibold text-white">Tap two pieces to swap</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-indigo-200/70">
                    Moves
                  </p>
                  <p className="font-display text-2xl font-bold text-fuchsia-300">
                    {state.puzzle?.moves ?? 0}
                  </p>
                </div>
              </div>

              {isEliminated ? (
                <div className="glass flex w-full max-w-[min(94vw,560px)] flex-col items-center justify-center gap-5 rounded-2xl p-8 text-center shadow-2xl ring-1 ring-rose-500/40">
                  <div className="animate-bounce text-6xl">⏰</div>
                  <div>
                    <h3 className="font-display text-3xl font-bold text-rose-400">
                      Time&apos;s Up!
                    </h3>
                    <p className="mt-1 font-display text-lg font-bold text-white">
                      You were eliminated
                    </p>
                  </div>
                  <p className="max-w-xs text-sm text-indigo-100/70">
                    The 3-minute time limit expired before you solved the puzzle.
                  </p>
                  <div className="rounded-xl border border-white/10 bg-black/40 px-5 py-3">
                    <p className="text-xs uppercase tracking-wider text-indigo-200/60">
                      Correct Pieces
                    </p>
                    <p className="font-display text-2xl font-bold text-emerald-400">
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
                  onRetry={retryLoadPieces}
                  onSwap={game.actions.swap}
                />
              ) : (
                <div className="glass grid aspect-square w-full max-w-[min(94vw,560px)] place-items-center">
                  <span className="h-12 w-12 animate-spin rounded-full border-4 border-cyan-300 border-t-transparent" />
                </div>
              )}
              <p className="text-center text-xs text-indigo-200/60">
                {totalPieces} pieces · green-bordered pieces are in the correct spot
              </p>
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
