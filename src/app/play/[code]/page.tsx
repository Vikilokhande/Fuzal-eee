"use client";

import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useFuzalGame } from "@/lib/fuzal/useFuzalGame";
import { formatClock } from "@/lib/game/format";
import { sessionStore, type JoinedPlayer } from "@/lib/fuzal/api";
import { Wordmark, Logo } from "@/components/Brand";
import { Avatar } from "@/components/PlayerList";
import { PuzzleBoard } from "@/components/PuzzleBoard";
import { WinnerScreen } from "@/components/WinnerScreen";
import { ConnBanner } from "@/components/ConnBanner";
import { GameShell } from "@/components/game/GameShell";
import { GameBadge } from "@/components/game/GameBadge";
import { PuzzleHUD } from "@/components/game/PuzzleHUD";
import { CinematicTransition } from "@/components/game/CinematicTransition";
import { ParticipationScreen } from "@/components/game/ParticipationScreen";

interface Session {
  player: JoinedPlayer;
}

export default function PlayerGamePage() {
  const params = useParams<{ code: string }>();
  const code = String(params.code).toUpperCase();
  const router = useRouter();

  const [showParticipation, setShowParticipation] = useState(false);

  const [session] = useState<Session | null>(() => {
    if (typeof window === "undefined") return null;
    const sp = new URLSearchParams(window.location.search);
    const p = sp.get("p");
    const t = sp.get("t");
    const n = sp.get("n");
    if (p && t && n) {
      const s: Session = {
        player: { id: p, token: t, name: n, score: 0, slot: 0 },
      };
      sessionStore.set(`player:${code}`, s);
      window.history.replaceState(null, "", `/play/${code}`);
      console.log("[PLAYER_SESSION_CREATED]", { code, playerId: p, name: n, source: "url_query" });
      console.log("[PLAYER_SESSION]", { code, playerId: p, name: n, source: "url_query" });
      return s;
    }
    const stored = sessionStore.get<Session>(`player:${code}`);
    if (stored?.player) {
      console.log("[PLAYER_RECONNECT]", { code, playerId: stored.player.id, name: stored.player.name });
      console.log("[PLAYER_SESSION]", {
        code,
        playerId: stored.player.id,
        name: stored.player.name,
        source: "session_storage",
      });
    }
    return stored;
  });

  const [badSession] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    const sp = new URLSearchParams(window.location.search);
    const p = sp.get("p");
    const t = sp.get("t");
    const n = sp.get("n");
    if (p && t && n) return false;
    const stored = sessionStore.get<Session>(`player:${code}`);
    return !stored?.player?.token;
  });

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
    piecesLoadedCount,
    piecesError,
    retryLoadPieces,
  } = game;

  const totalPieces = useMemo(
    () => (state ? state.pieceCount ?? state.gridCols * state.gridRows : 9),
    [state],
  );

  const me = state?.players.find((p) => p.id === session?.player.id);
  const mySlot = me?.slot ?? 0;
  const correctCount = state?.puzzle ? state.puzzle.correctSlots.filter(Boolean).length : 0;
  const isWinner = Boolean(state?.result?.winner && state.result.winner.id === session?.player.id);

  /* ------------------- SESSION ERROR STATES ------------------- */
  if (badSession) {
    return (
      <GameShell maxWidth="max-w-sm">
        <div className="glass w-full p-8 text-center flex flex-col items-center gap-4">
          <div className="text-5xl">🔌</div>
          <h2 className="font-display text-2xl font-bold text-white uppercase">
            Session Missing
          </h2>
          <p className="text-xs sm:text-sm text-indigo-200/70">
            Player credentials not found for arena {code}. Please join the lobby again.
          </p>
          <button
            type="button"
            className="btn-primary w-full py-3 mt-2"
            onClick={() => router.push(`/join/${code}`)}
          >
            Go to Join Screen
          </button>
        </div>
      </GameShell>
    );
  }

  if (connState === "error" && !state) {
    return (
      <GameShell maxWidth="max-w-sm">
        <div className="glass w-full p-8 text-center flex flex-col items-center gap-4">
          <div className="text-5xl">⚠️</div>
          <h2 className="font-display text-2xl font-bold text-white uppercase">
            Connection Lost
          </h2>
          <p className="text-xs sm:text-sm text-indigo-200/70">
            Unable to reach the game server for arena <strong className="text-cyan-300">{code}</strong>.
          </p>
          <div className="flex flex-col gap-2 w-full mt-2">
            <button
              type="button"
              className="btn-primary w-full py-3"
              onClick={() => window.location.reload()}
            >
              Retry
            </button>
            <button
              type="button"
              className="btn-secondary w-full py-2.5"
              onClick={() => router.push(`/join/${code}`)}
            >
              Return to Join
            </button>
          </div>
        </div>
      </GameShell>
    );
  }

  if (connState === "session_invalid" && session && !state) {
    return (
      <GameShell maxWidth="max-w-sm">
        <div className="glass w-full p-8 text-center flex flex-col items-center gap-4">
          <div className="text-5xl">🔒</div>
          <h2 className="font-display text-2xl font-bold text-white uppercase">
            Session Expired
          </h2>
          <p className="text-xs sm:text-sm text-indigo-200/70">
            Your player session has ended. Join the game again to participate.
          </p>
          <button
            type="button"
            className="btn-primary w-full py-3 mt-2"
            onClick={() => router.push(`/join/${code}`)}
          >
            Join Again
          </button>
        </div>
      </GameShell>
    );
  }

  if (!session || !state) {
    return (
      <GameShell maxWidth="max-w-sm">
        <div className="flex flex-col items-center gap-4 py-8 select-none">
          <div className="animate-float">
            <Logo size={56} />
          </div>
          <div className="flex items-center gap-3">
            <span className="h-3 w-3 animate-ping rounded-full bg-cyan-400 inline-block" />
            <p className="text-sm font-bold uppercase tracking-widest text-cyan-300">
              Entering Game Arena…
            </p>
          </div>
        </div>
      </GameShell>
    );
  }

  /* ------------------- DEDICATED PARTICIPATION SCREEN ------------------- */
  if (showParticipation) {
    return (
      <ParticipationScreen
        playerName={session.player.name}
        gameCode={code}
        result={isWinner ? "WINNER" : state.result?.timeExpired ? "TIME_EXPIRED" : "PARTICIPANT"}
        score={me?.score ?? 0}
        onPlayAgain={() => {
          setShowParticipation(false);
          router.push(`/join/${code}`);
        }}
        onReturnHome={() => {
          game.actions.exitGame();
          router.push(`/join/${code}`);
        }}
      />
    );
  }

  /* ------------------- MAIN PLAYER GAME SCREENS ------------------- */
  return (
    <div className="relative flex min-h-[100dvh] w-full flex-col justify-between overflow-x-hidden bg-[#030611] text-[#f1f5ff] px-2.5 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] pt-2 select-none">
      {/* Background cyber grid */}
      <div className="fz-grid-bg absolute inset-0 z-0" aria-hidden="true" />
      <div className="pointer-events-none absolute -left-20 -top-20 h-64 w-64 rounded-full bg-cyan-500/15 blur-[100px]" />
      <div className="pointer-events-none absolute -right-20 bottom-10 h-64 w-64 rounded-full bg-fuchsia-600/15 blur-[100px]" />

      <ConnBanner state={connState} />

      {/* Cinematic Transition Overlay (3, 2, 1, GO!) */}
      <CinematicTransition active={goFlash} countdown={state.status === "MEMORY" ? memorySeconds : undefined} />

      {/* Action Toast Alert */}
      {toast && (
        <div className="fixed left-1/2 top-3 z-50 -translate-x-1/2 rounded-full bg-rose-500/95 px-5 py-2 text-xs font-bold text-white shadow-[0_0_20px_rgba(244,63,94,0.6)]">
          {toast}
        </div>
      )}

      {/* FINISHED STATE */}
      {state.status === "FINISHED" && (
        <div className="relative z-10 w-full flex-1 flex flex-col items-center justify-center">
          <WinnerScreen
            result={
              state.result ?? {
                winner: null,
                finishedAt: state.serverNow ?? 0,
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
            onExit={() => setShowParticipation(true)}
          />
        </div>
      )}

      {state.status !== "FINISHED" && (
        <>
          {/* Top Compact Player Navigation Bar */}
          <header className="relative z-10 flex shrink-0 items-center justify-between w-full max-w-md mx-auto px-1 pb-1">
            <div className="flex items-center gap-1.5">
              <Logo size={22} />
              <Wordmark size={18} />
            </div>

            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] font-extrabold text-cyan-300 rounded-md bg-white/5 px-2 py-0.5 border border-white/10">
                {code}
              </span>
              <div className="flex items-center gap-1.5 rounded-full bg-slate-900/80 px-2.5 py-1 border border-white/10">
                <Avatar name={session.player.name} slot={mySlot} connected={me?.connected ?? true} size="sm" />
                <span className="max-w-[5.5rem] truncate text-xs font-bold text-white">
                  {session.player.name}
                </span>
              </div>
            </div>
          </header>

          {/* 1. PLAYER WAITING ROOM (LOBBY) */}
          {state.status === "LOBBY" && (
            <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-4 py-4 max-w-md mx-auto w-full text-center">
              <div className="glass w-full p-6 sm:p-8 flex flex-col items-center gap-4 border border-cyan-500/30 shadow-[0_15px_50px_rgba(0,0,0,0.6)]">
                <div className="text-5xl animate-bounce">🎮</div>

                <div className="flex flex-col items-center gap-1">
                  <h2 className="font-display text-3xl font-black text-white uppercase tracking-wider">
                    You&apos;re In!
                  </h2>
                  <p className="text-xs sm:text-sm text-indigo-200/80">
                    Waiting for the host to start the arena…
                  </p>
                </div>

                {/* Player Profile Box */}
                <div className="w-full rounded-2xl bg-slate-900/80 p-4 border border-white/10 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Avatar name={session.player.name} slot={mySlot} connected={true} size="md" />
                    <div className="text-left">
                      <p className="text-xs font-bold uppercase tracking-widest text-indigo-200/60">
                        Your Player
                      </p>
                      <p className="text-base font-extrabold text-white">
                        {session.player.name}
                      </p>
                    </div>
                  </div>
                  <GameBadge variant="ready">READY</GameBadge>
                </div>

                {/* Player Roster Grid */}
                <div className="w-full flex flex-col gap-2">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-indigo-200/60">
                      Arena Roster
                    </span>
                    <span className="text-xs font-bold font-mono text-cyan-300">
                      {state.players.length} / {state.maxPlayers}
                    </span>
                  </div>

                  <div className="flex flex-col gap-2 w-full">
                    {state.players.map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center justify-between rounded-xl bg-white/5 px-3 py-2 text-sm border border-white/5"
                      >
                        <div className="flex items-center gap-2">
                          <Avatar name={p.name} slot={p.slot} connected={p.connected} size="sm" />
                          <span className="font-bold text-white truncate text-xs sm:text-sm">
                            {p.name} {p.id === session.player.id ? "(You)" : ""}
                          </span>
                        </div>
                        <span className="text-[11px] font-bold text-emerald-400 flex items-center gap-1">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 inline-block" />
                          READY
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Connection Status Footnote */}
                <div className="mt-2 flex items-center gap-2 text-xs text-indigo-200/70">
                  <span className="h-2 w-2 animate-ping rounded-full bg-emerald-400" />
                  <span>Stay on this screen — the game will start automatically.</span>
                </div>

                <button
                  type="button"
                  onClick={() => setShowParticipation(true)}
                  className="text-xs text-indigo-200/50 hover:text-rose-400 transition-colors pt-2"
                >
                  Leave Lobby
                </button>
              </div>
            </div>
          )}

          {/* 2. PLAYER MEMORY PHASE */}
          {state.status === "MEMORY" && (
            <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-5 py-4 max-w-md mx-auto w-full text-center">
              <div className="glass w-full p-6 sm:p-8 flex flex-col items-center gap-5 border border-amber-400/40 shadow-[0_15px_50px_rgba(251,191,36,0.15)]">
                <GameBadge variant="memory" pulse>
                  GET READY • MEMORIZE
                </GameBadge>

                <div className="flex flex-col items-center gap-1">
                  <p className="text-sm font-extrabold uppercase tracking-widest text-indigo-200/80">
                    Look At The
                  </p>
                  <h2 className="font-display text-4xl sm:text-5xl font-black text-white uppercase tracking-wider">
                    HOST SCREEN
                  </h2>
                </div>

                {/* Large Dominant Countdown */}
                <div className="flex flex-col items-center justify-center my-2">
                  <span className="text-[10px] font-extrabold uppercase tracking-[0.3em] text-amber-300/90">
                    Seconds To Memorize
                  </span>
                  <span
                    className={`font-display text-7xl sm:text-8xl font-black leading-none tabular-nums mt-1 ${
                      memorySeconds <= 5
                        ? "animate-pulse text-rose-400 drop-shadow-[0_0_20px_rgba(244,63,94,0.8)]"
                        : "text-amber-300 drop-shadow-[0_0_20px_rgba(251,191,36,0.6)]"
                    }`}
                  >
                    {memorySeconds < 10 ? `0${memorySeconds}` : memorySeconds}
                  </span>
                </div>

                {state.imageName && (
                  <div className="rounded-xl bg-slate-900/80 px-4 py-2 border border-white/10">
                    <span className="text-xs font-mono text-cyan-300 font-bold">
                      Puzzle: {state.imageName}
                    </span>
                  </div>
                )}

                <p className="text-xs text-indigo-200/70 max-w-xs">
                  Memorize every detail before the puzzle pieces scramble!
                </p>
              </div>
            </div>
          )}

          {/* 3. PLAYER PUZZLE PHASE */}
          {state.status === "PUZZLE" && (
            <div className="relative z-10 flex flex-1 flex-col items-center justify-between gap-1 w-full max-w-md mx-auto py-0">
              {/* Compact Gaming HUD */}
              <PuzzleHUD
                puzzleRemainingMs={puzzleRemainingMs}
                moves={state.puzzle?.moves ?? 0}
                correctCount={correctCount}
                totalPieces={totalPieces}
                completed={Boolean(state.puzzle?.completed)}
                connState={connState}
              />

              {/* Solved Banner Alert */}
              {state.puzzle?.completed && !isEliminated && (
                <div className="w-full flex items-center justify-center gap-2 rounded-xl border border-emerald-400/50 bg-emerald-500/20 py-2 text-center text-xs sm:text-sm font-black text-emerald-300 shadow-[0_0_20px_rgba(52,211,153,0.3)] animate-scale-up">
                  <span className="text-base">🎉</span>
                  <span>PUZZLE SOLVED! Waiting for final standings…</span>
                </div>
              )}

              {/* Main Puzzle Arena Focus */}
              <div className="flex flex-1 items-center justify-center w-full py-1 min-h-0">
                {isEliminated ? (
                  <div className="glass flex w-full max-w-sm flex-col items-center justify-center gap-3 rounded-2xl p-6 text-center shadow-2xl ring-1 ring-rose-500/40">
                    <div className="text-5xl">⏰</div>
                    <div>
                      <h3 className="font-display text-2xl font-bold text-rose-400 uppercase">
                        Time&apos;s Up!
                      </h3>
                      <p className="text-sm font-bold text-white">
                        Eliminated from round
                      </p>
                    </div>
                    <p className="text-xs text-indigo-200/70">
                      The 3-minute arena limit expired.
                    </p>
                    <div className="rounded-xl border border-white/10 bg-slate-900/80 px-4 py-2 mt-1">
                      <p className="text-[10px] uppercase tracking-wider text-indigo-200/60">
                        Pieces Solved
                      </p>
                      <p className="font-display text-xl font-bold text-emerald-400">
                        {correctCount} / {totalPieces}
                      </p>
                    </div>
                  </div>
                ) : state.puzzle ? (
                  <PuzzleBoard
                    board={state.puzzle.board}
                    cols={state.gridCols}
                    rows={state.gridRows}
                    pieceCount={totalPieces}
                    loadedCount={piecesLoadedCount}
                    pieceSrcs={pieceSrcs}
                    loading={piecesLoading}
                    error={piecesError}
                    completed={Boolean(state.puzzle.completed)}
                    isPuzzleActive={
                      state.status === "PUZZLE" &&
                      puzzleRemainingMs > 0 &&
                      !isEliminated &&
                      !state.puzzle.completed
                    }
                    onRetry={retryLoadPieces}
                    onSwap={game.actions.swap}
                  />
                ) : (
                  <div className="glass grid aspect-square w-full max-w-[min(94vw,480px)] place-items-center">
                    <div className="flex items-center gap-2">
                      <span className="h-3 w-3 animate-ping rounded-full bg-cyan-400 inline-block" />
                      <span className="text-xs font-bold uppercase tracking-widest text-cyan-300">
                        Loading Puzzle…
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Compact Bottom Footer Status */}
              <div className="flex w-full items-center justify-between px-2 text-[10px] sm:text-[11px] text-indigo-200/60 shrink-0">
                <span className="font-mono">
                  {correctCount}/{totalPieces} pieces correct ({Math.round((correctCount / totalPieces) * 100)}%)
                </span>
                <span>Green border = correct spot</span>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
