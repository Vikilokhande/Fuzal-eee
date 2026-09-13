"use client";

import { Confetti } from "./Confetti";
import { Avatar } from "./PlayerList";
import { Wordmark } from "./Brand";
import type { ResultView } from "@/lib/fuzal/useFuzalGame";
import { formatClock } from "@/lib/fuzal/useFuzalGame";

export function WinnerScreen({
  result,
  isHost,
  youId,
  onPlayAgain,
  onBackToLobby,
  onNewLobby,
  onExit,
}: {
  result: ResultView;
  isHost: boolean;
  youId?: string;
  onPlayAgain?: () => void;
  onBackToLobby?: () => void;
  onNewLobby?: () => void;
  onExit?: () => void;
}) {
  const winner = result.winner;
  const youWon = !!winner && youId === winner.id;
  const celebrate = isHost || youWon;

  return (
    <div className="relative flex min-h-screen w-full flex-col items-center justify-center gap-6 px-3 py-6 md:px-6 md:py-10">
      <Confetti active={celebrate} />
      <Wordmark size={32} />

      <div className="animate-slide-up glass flex w-full max-w-xl flex-col items-center gap-4 px-4 py-6 md:gap-5 md:px-8 md:py-10 text-center">
        {isHost ? (
          winner ? (
            <>
              <div className="animate-winner-glow text-8xl">🏆</div>
              <p className="font-display text-2xl font-bold uppercase tracking-[0.4em] text-cyan-300">
                Winner
              </p>
              <h2 className="font-display text-6xl font-bold neon-text md:text-7xl">
                {winner.name}
              </h2>
              <p className="text-xl text-indigo-100/80">Congratulations! 🎉</p>
            </>
          ) : (
            <>
              <div className="text-8xl">⌛</div>
              <p className="font-display text-2xl font-bold uppercase tracking-[0.4em] text-rose-400">
                Time Expired
              </p>
              <h2 className="font-display text-5xl font-bold text-white md:text-6xl">
                No Winner
              </h2>
              <p className="text-xl text-indigo-100/80">
                The 3-minute limit expired before any player solved the puzzle.
              </p>
            </>
          )
        ) : youWon ? (
          <>
            <div className="animate-winner-glow text-8xl">🏆</div>
            <h2 className="font-display text-6xl font-bold neon-text">YOU WON!</h2>
            <p className="text-xl text-indigo-100/80">
              Lightning fingers, {winner?.name}!
            </p>
          </>
        ) : !winner || result.timeExpired ? (
          <>
            <div className="animate-bounce text-8xl">⏰</div>
            <h2 className="font-display text-5xl font-bold text-rose-400">Time&apos;s Up!</h2>
            <p className="text-xl font-bold text-white">You were eliminated</p>
            <p className="text-lg text-indigo-100/70">
              The 3-minute time limit expired before the puzzle was completed.
            </p>
          </>
        ) : (
          <>
            <div className="text-8xl opacity-90">🧩</div>
            <h2 className="font-display text-5xl font-bold text-white">Game Over</h2>
            <p className="text-2xl font-bold text-fuchsia-300">
              {winner?.name ?? "Someone"} won!
            </p>
            <p className="text-lg text-indigo-100/70">Better luck next time!</p>
          </>
        )}

        <div className="mt-2 rounded-2xl border border-white/10 bg-black/30 px-8 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-indigo-200/70">
            {winner ? "Winning Time" : "Round Duration"}
          </p>
          <p className="font-display text-5xl font-bold text-emerald-300">
            {formatClock(result.durationMs ?? (result.timeExpired ? 180000 : 0))}
          </p>
        </div>

        {/* Reveal of the completed image */}
        {result.image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={result.image.url}
            alt={result.image.name}
            className="h-40 w-40 rounded-2xl object-cover ring-2 ring-white/20"
          />
        )}

        {/* Standings */}
        <div className="w-full">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.3em] text-indigo-200/70">
            Standings
          </p>
          <div className="grid gap-2">
            {result.standings.map((s, i) => (
              <div
                key={s.id}
                className={`flex items-center gap-3 rounded-xl px-4 py-2.5 ${
                  s.id === winner?.id
                    ? "bg-gradient-to-r from-amber-400/20 to-fuchsia-400/20 ring-1 ring-amber-300/40"
                    : "bg-white/[0.04]"
                }`}
              >
                <span className="w-6 text-lg font-black text-indigo-200/80">
                  {i + 1}
                </span>
                <Avatar name={s.name} slot={s.slot} size="sm" connected={s.connected} />
                <span className="flex-1 truncate text-left font-bold text-white">
                  {s.name}
                  {s.id === youId && <span className="ml-2 text-cyan-300">(You)</span>}
                </span>
                <span className="font-mono text-sm text-indigo-200/80">
                  {s.correctCount} pts
                </span>
                {s.completed ? (
                  <span className="font-mono text-sm text-emerald-300">
                    {formatClock(s.durationMs ?? 0)}
                  </span>
                ) : s.eliminated ? (
                  <span className="rounded-full bg-rose-500/20 px-2.5 py-0.5 text-xs font-bold text-rose-300">
                    ELIMINATED
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        </div>

        {isHost ? (
          <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
            <button className="btn-primary" onClick={onPlayAgain}>
              🔁 Play Again
            </button>
            <button className="btn-ghost" onClick={onBackToLobby}>
              👥 Back to Lobby
            </button>
            <button className="btn-ghost" onClick={onNewLobby}>
              ✨ New Lobby
            </button>
          </div>
        ) : (
          <div className="mt-4 flex w-full flex-col items-center gap-3">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-indigo-200/70">
              Round Finished
            </p>
            <div className="flex w-full flex-col sm:flex-row items-center justify-center gap-2">
              <button
                type="button"
                className="btn-secondary w-full sm:w-auto px-6 py-2.5 text-sm font-bold"
                onClick={onBackToLobby}
              >
                👥 Back to Lobby
              </button>
              <button
                type="button"
                className="btn-ghost w-full sm:w-auto px-6 py-2.5 text-sm font-bold"
                onClick={onExit}
              >
                🚪 Exit Game
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
