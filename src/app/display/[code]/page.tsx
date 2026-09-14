"use client";

import { useEffect, useState, useRef } from "react";
import { useParams } from "next/navigation";
import { useFuzalGame } from "@/lib/fuzal/useFuzalGame";
import { formatClock } from "@/lib/game/format";
import { Wordmark, Logo } from "@/components/Brand";
import { QRCodeSVG } from "qrcode.react";
import { joinUrlFor } from "@/lib/fuzal/api";
import { MemoryImage } from "@/components/MemoryImage";
import { Confetti } from "@/components/Confetti";
import { Avatar } from "@/components/PlayerList";
import { GameBadge } from "@/components/game/GameBadge";

export default function BigScreenDisplayPage() {
  const params = useParams<{ code: string }>();
  const code = String(params.code).toUpperCase();

  // Read-only big-screen connection
  const game = useFuzalGame({ code, kind: "host" });
  const { state, connState, memorySeconds, puzzleRemainingMs } = game;

  const [recentJoiner, setRecentJoiner] = useState<string | null>(null);
  const prevCount = useRef(state?.players.length ?? 0);

  useEffect(() => {
    if (!state) return;
    if (state.players.length > prevCount.current) {
      const newest = state.players[state.players.length - 1];
      if (newest) {
        setRecentJoiner(newest.name);
        const t = setTimeout(() => setRecentJoiner(null), 4500);
        return () => clearTimeout(t);
      }
    }
    prevCount.current = state.players.length;
  }, [state?.players]);

  if (!state) {
    return (
      <main className="relative flex min-h-screen w-full flex-col items-center justify-center bg-[#030611] p-6 text-center select-none">
        <div className="fz-grid-bg absolute inset-0" aria-hidden="true" />
        <div className="relative z-10 flex flex-col items-center gap-4">
          <div className="animate-float">
            <Logo size={80} />
          </div>
          <div className="flex items-center gap-3">
            <span className="h-3 w-3 animate-ping rounded-full bg-cyan-400 inline-block" />
            <span className="text-base font-bold uppercase tracking-widest text-cyan-300">
              Connecting to Arena {code}…
            </span>
          </div>
        </div>
      </main>
    );
  }

  const players = state.players;
  const maxPlayers = state.maxPlayers || 8;
  const totalPieces = state.pieceCount ?? state.gridCols * state.gridRows;
  const joinUrl = joinUrlFor(code);

  return (
    <main className="relative flex min-h-screen w-full flex-col justify-between overflow-hidden bg-[#030611] text-[#f1f5ff] p-6 md:p-10 select-none">
      {/* Background cyber grid & ambient glows */}
      <div className="fz-grid-bg absolute inset-0 z-0" aria-hidden="true" />
      <div className="pointer-events-none absolute -left-32 -top-32 h-[500px] w-[500px] rounded-full bg-cyan-500/15 blur-[150px]" />
      <div className="pointer-events-none absolute -right-32 top-1/4 h-[500px] w-[500px] rounded-full bg-fuchsia-600/15 blur-[150px]" />
      <div className="pointer-events-none absolute bottom-0 left-1/3 h-[400px] w-[400px] rounded-full bg-violet-600/15 blur-[150px]" />

      {/* Top Bar for Big Screen */}
      <header className="relative z-10 flex items-center justify-between w-full border-b border-white/10 pb-4">
        <div className="flex items-center gap-4">
          <Wordmark size={36} />
          <span className="hidden sm:inline-block h-6 w-px bg-white/20" />
          <span className="hidden sm:inline-block font-mono text-sm font-black uppercase tracking-[0.3em] text-cyan-300">
            Live Arena
          </span>
        </div>

        <div className="flex items-center gap-3">
          <GameBadge variant="code" className="text-sm px-4 py-1.5">
            {code}
          </GameBadge>
          <GameBadge variant="grid" className="text-sm px-4 py-1.5">
            {state.gridCols}×{state.gridRows} • {totalPieces} Pieces
          </GameBadge>
          <GameBadge variant="live" pulse className="text-sm px-4 py-1.5">
            ● LIVE ARENA
          </GameBadge>
        </div>
      </header>

      {/* 1. LOBBY PRESENTATION */}
      {state.status === "LOBBY" && (
        <div className="relative z-10 flex flex-1 items-center justify-center w-full max-w-7xl mx-auto py-6">
          <div className="grid w-full grid-cols-1 lg:grid-cols-2 gap-10 xl:gap-16 items-center">
            {/* Left: Giant High-Impact QR Display */}
            <div className="glass p-8 xl:p-12 flex flex-col items-center text-center gap-6 border border-cyan-400/30 shadow-[0_20px_70px_rgba(0,0,0,0.6)]">
              <div className="flex flex-col items-center gap-1">
                <GameBadge variant="ready" pulse>
                  SCAN TO PARTICIPATE
                </GameBadge>
                <h1 className="font-display text-4xl xl:text-5xl font-black text-white uppercase tracking-wider mt-1">
                  Join The Arena
                </h1>
                <p className="text-sm xl:text-base text-indigo-200/80">
                  Point your mobile phone camera at the QR code to enter
                </p>
              </div>

              {/* Giant QR Code */}
              <div className="relative rounded-3xl bg-white p-6 shadow-[0_25px_80px_rgba(34,211,238,0.4)] ring-4 ring-cyan-400/50">
                <QRCodeSVG
                  value={joinUrl}
                  size={260}
                  level="H"
                  marginSize={2}
                  bgColor="#ffffff"
                  fgColor="#080c1d"
                  className="max-w-[min(65vw,280px)] max-h-[min(65vw,280px)] aspect-square"
                />
              </div>

              {/* Game Code Display */}
              <div className="flex flex-col items-center gap-1">
                <span className="text-xs font-black uppercase tracking-[0.3em] text-cyan-300">
                  Arena Code
                </span>
                <div className="rounded-2xl bg-slate-900/90 border-2 border-cyan-400/40 px-8 py-2.5 shadow-[0_0_30px_rgba(34,211,238,0.3)]">
                  <span className="font-mono text-5xl xl:text-6xl font-black tracking-[0.25em] text-white">
                    {code}
                  </span>
                </div>
                <p className="font-mono text-xs text-indigo-200/50 mt-1">{joinUrl}</p>
              </div>
            </div>

            {/* Right: Real-time Player Roster & Slot Display */}
            <div className="flex flex-col gap-6 w-full">
              {/* Slot Counter Banner */}
              <div className="glass p-6 flex items-center justify-between border border-white/10">
                <div>
                  <span className="text-xs font-black uppercase tracking-[0.3em] text-indigo-200/60">
                    Contenders Joined
                  </span>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className="font-display text-5xl xl:text-6xl font-black text-cyan-300">
                      {players.length}
                    </span>
                    <span className="text-2xl xl:text-3xl font-bold text-white/40">
                      / {maxPlayers} PLAYERS
                    </span>
                  </div>
                </div>

                <div className="flex flex-col items-end gap-1">
                  <GameBadge variant="live" pulse>
                    Lobby Open
                  </GameBadge>
                  <span className="text-xs font-mono text-indigo-200/60">
                    {Math.max(0, maxPlayers - players.length)} slots open
                  </span>
                </div>
              </div>

              {/* Join Notification Alert */}
              {recentJoiner && (
                <div className="animate-slide-up flex items-center gap-3 rounded-2xl border border-emerald-400/60 bg-emerald-500/20 px-5 py-3 shadow-[0_0_30px_rgba(52,211,153,0.4)]">
                  <span className="h-3 w-3 animate-ping rounded-full bg-emerald-400" />
                  <span className="text-xs font-black uppercase tracking-wider text-emerald-300">
                    New Contender:
                  </span>
                  <span className="text-sm font-black text-white truncate">
                    {recentJoiner} entered the arena!
                  </span>
                </div>
              )}

              {/* Player Slots Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full">
                {Array.from({ length: Math.min(12, maxPlayers) }).map((_, i) => {
                  const p = players[i];
                  return (
                    <div
                      key={p?.id ?? `slot-${i}`}
                      className={`flex items-center gap-3.5 rounded-2xl border px-4 py-3.5 transition-all ${
                        p
                          ? "border-cyan-400/40 bg-slate-900/80 shadow-[0_5px_20px_rgba(0,0,0,0.4)]"
                          : "border-dashed border-white/10 bg-white/[0.02]"
                      }`}
                    >
                      {p ? (
                        <>
                          <Avatar name={p.name} slot={p.slot} connected={p.connected} size="md" />
                          <div className="min-w-0 flex-1">
                            <p className="font-bold text-base xl:text-lg text-white truncate">
                              {p.name}
                            </p>
                            <span className="text-xs text-emerald-400 font-semibold flex items-center gap-1">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                              Ready
                            </span>
                          </div>
                          <span className="font-mono text-xs font-bold text-cyan-300">P{i + 1}</span>
                        </>
                      ) : (
                        <>
                          <div className="grid h-10 w-10 place-items-center rounded-full border border-dashed border-white/20 text-xs font-bold text-white/25">
                            {i + 1}
                          </div>
                          <p className="text-sm font-medium text-white/30 italic">Waiting…</p>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center justify-center gap-3 pt-2 text-indigo-200/60 text-xs">
                <span className="h-2 w-2 animate-ping rounded-full bg-cyan-400" />
                <span className="uppercase tracking-widest font-mono">Waiting for host to launch game…</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2. MEMORY PHASE PRESENTATION */}
      {state.status === "MEMORY" && (
        <div className="relative z-10 flex flex-1 flex-col items-center justify-center w-full max-w-5xl mx-auto py-4 text-center">
          <div className="flex flex-col items-center gap-2 mb-4">
            <GameBadge variant="memory" pulse className="text-sm px-4 py-1.5">
              MEMORY PHASE
            </GameBadge>
            <h1 className="font-display text-4xl sm:text-6xl font-black text-white uppercase tracking-wider">
              Memorize The Image
            </h1>
            <p className="text-base text-indigo-200/80">
              Study the details carefully before the puzzle scramble starts!
            </p>
          </div>

          <div className="grid w-full grid-cols-1 md:grid-cols-[1fr_auto] gap-8 items-center justify-items-center">
            {/* Center: Large High-Resolution Image */}
            <div className="flex flex-col items-center gap-3">
              {state.image && (
                <MemoryImage
                  src={state.image.url}
                  name={state.image.name}
                  secondsLeft={memorySeconds}
                />
              )}
            </div>

            {/* Right: Giant Dominant Countdown */}
            <div className="glass p-8 sm:p-12 flex flex-col items-center rounded-3xl border-2 border-amber-400/40 shadow-[0_0_60px_rgba(251,191,36,0.25)]">
              <span className="text-xs font-black uppercase tracking-[0.3em] text-amber-300">
                Time Left
              </span>
              <span
                className={`font-display text-8xl sm:text-9xl font-black leading-none tabular-nums mt-2 ${
                  memorySeconds <= 5
                    ? "animate-pulse text-rose-400 drop-shadow-[0_0_30px_rgba(244,63,94,0.9)]"
                    : "text-amber-300 drop-shadow-[0_0_30px_rgba(251,191,36,0.7)]"
                }`}
              >
                {memorySeconds < 10 ? `0${memorySeconds}` : memorySeconds}
              </span>
              <span className="text-xs text-indigo-200/60 uppercase tracking-widest mt-3">
                SECONDS TO MEMORIZE
              </span>
            </div>
          </div>
        </div>
      )}

      {/* 3. PUZZLE PHASE (Audience Live Spectator Battle) */}
      {state.status === "PUZZLE" && (
        <div className="relative z-10 flex flex-1 flex-col justify-between w-full max-w-6xl mx-auto py-6">
          {/* Top Battle HUD */}
          <div className="glass p-6 flex flex-wrap items-center justify-between gap-4 border border-fuchsia-500/30 shadow-[0_10px_40px_rgba(0,0,0,0.5)]">
            <div>
              <GameBadge variant="puzzle" pulse>
                LIVE PUZZLE BATTLE
              </GameBadge>
              <h2 className="font-display text-3xl sm:text-4xl font-black text-white uppercase tracking-wider mt-1">
                Race To Solve The Puzzle
              </h2>
              <p className="text-xs sm:text-sm text-indigo-200/70">
                First player to arrange all {totalPieces} pieces correctly wins!
              </p>
            </div>

            {/* Time Remaining */}
            <div className="flex flex-col items-end rounded-2xl bg-black/50 px-8 py-3.5 border border-white/10 shadow-inner">
              <span className="text-[10px] font-black uppercase tracking-[0.3em] text-indigo-200/70">
                Time Remaining
              </span>
              <span
                className={`font-display text-4xl sm:text-5xl font-black tabular-nums ${
                  puzzleRemainingMs <= 30000
                    ? "animate-pulse text-rose-400 drop-shadow-[0_0_20px_rgba(244,63,94,0.8)]"
                    : "text-cyan-300 drop-shadow-[0_0_20px_rgba(34,211,238,0.5)]"
                }`}
              >
                {formatClock(puzzleRemainingMs)}
              </span>
            </div>
          </div>

          {/* Live Progress Leaderboard for Audience */}
          <div className="glass p-6 sm:p-8 flex flex-col gap-4 border border-white/10 my-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <span className="text-xs font-black uppercase tracking-[0.3em] text-cyan-300">
                Live Contender Standings
              </span>
              <span className="font-mono text-xs text-indigo-200/60">
                {players.length} Competitors
              </span>
            </div>

            <div className="flex flex-col gap-3">
              {players.map((p, idx) => {
                const pr = state.puzzleProgress?.find((x) => x.id === p.id);
                const correct = pr?.correctCount ?? 0;
                const completed = pr?.completed ?? false;
                const moves = pr?.moves ?? 0;
                const pct = Math.round((correct / totalPieces) * 100);

                return (
                  <div
                    key={p.id}
                    className={`flex items-center gap-5 p-4 rounded-2xl border transition-all ${
                      completed
                        ? "border-emerald-400/80 bg-emerald-500/20 shadow-[0_0_25px_rgba(52,211,153,0.3)]"
                        : "border-white/10 bg-slate-900/70"
                    }`}
                  >
                    {/* Rank */}
                    <span className="font-mono text-xl font-black text-white/50 w-8 text-center">
                      {completed ? "🏆" : `#${idx + 1}`}
                    </span>

                    <Avatar name={p.name} slot={p.slot} connected={p.connected} size="md" />

                    {/* Name */}
                    <div className="w-40 sm:w-56 min-w-0">
                      <p className="font-display text-lg sm:text-xl font-bold text-white truncate">
                        {p.name}
                      </p>
                      <span className="text-xs font-mono text-indigo-200/60">
                        {moves} moves
                      </span>
                    </div>

                    {/* Big Progress Bar */}
                    <div className="flex-1 flex flex-col gap-1.5">
                      <div className="flex items-center justify-between text-xs font-mono">
                        <span className="text-indigo-200/80">
                          {correct} / {totalPieces} Pieces
                        </span>
                        <span className={completed ? "text-emerald-400 font-bold" : "text-cyan-300 font-bold"}>
                          {completed ? "SOLVED!" : `${pct}%`}
                        </span>
                      </div>
                      <div className="h-3.5 w-full overflow-hidden rounded-full bg-slate-800/90 border border-white/5">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${
                            completed
                              ? "bg-gradient-to-r from-emerald-400 to-teal-300 shadow-[0_0_15px_rgba(52,211,153,0.8)]"
                              : "bg-gradient-to-r from-cyan-400 via-purple-500 to-fuchsia-400 shadow-[0_0_10px_rgba(34,211,238,0.5)]"
                          }`}
                          style={{ width: `${completed ? 100 : Math.max(3, pct)}%` }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-center gap-3 text-xs text-indigo-200/60">
            <span className="h-2.5 w-2.5 rounded-full bg-cyan-400 animate-pulse" />
            <span>Players are actively solving on their mobile devices • No hints or solutions leaked</span>
          </div>
        </div>
      )}

      {/* 4. RESULTS / WINNER PRESENTATION */}
      {state.status === "FINISHED" && state.result && (
        <div className="relative z-10 flex flex-1 flex-col items-center justify-center w-full max-w-4xl mx-auto py-6 text-center">
          <Confetti active={true} />

          <div className="glass p-8 sm:p-12 flex flex-col items-center gap-6 border-2 border-amber-400/50 shadow-[0_25px_90px_rgba(251,191,36,0.25)] w-full">
            {state.result.winner ? (
              <div className="flex flex-col items-center gap-2">
                <span className="text-8xl sm:text-9xl animate-winner-glow inline-block filter drop-shadow-[0_0_35px_rgba(251,191,36,0.7)]">
                  🏆
                </span>
                <span className="rounded-full bg-amber-400 px-4 py-1 text-xs font-black uppercase tracking-widest text-slate-950 shadow-lg">
                  MATCH CHAMPION
                </span>
                <h1 className="font-display text-6xl sm:text-7xl xl:text-8xl font-black text-transparent bg-clip-text bg-gradient-to-r from-amber-300 via-yellow-200 to-amber-400 drop-shadow-[0_0_30px_rgba(251,191,36,0.6)] mt-2">
                  {state.result.winner.name}
                </h1>
                <p className="text-xl sm:text-2xl text-indigo-100/90 font-semibold">
                  Solved the puzzle first and conquered the arena!
                </p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <span className="text-8xl">⌛</span>
                <h1 className="font-display text-5xl font-black text-white uppercase">
                  Time Expired
                </h1>
                <p className="text-lg text-indigo-200/80">
                  The round time limit expired before any player solved the puzzle.
                </p>
              </div>
            )}

            {/* Winning Time Display */}
            <div className="rounded-2xl border border-white/10 bg-slate-900/80 px-8 py-4 flex flex-col items-center">
              <span className="text-xs font-black uppercase tracking-[0.3em] text-indigo-200/70">
                Winning Time
              </span>
              <span className="font-display text-4xl sm:text-5xl font-black text-emerald-400 font-mono mt-1">
                {formatClock(state.result.durationMs ?? 0)}
              </span>
            </div>

            {/* Solved Image Reveal */}
            {state.result.image && (
              <div className="flex flex-col items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-widest text-indigo-200/60">
                  Completed Puzzle
                </span>
                <div className="rounded-2xl overflow-hidden p-1.5 bg-gradient-to-r from-cyan-400 via-purple-500 to-pink-500 shadow-2xl">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={state.result.image.url}
                    alt={state.result.image.name}
                    className="h-44 w-44 rounded-xl object-cover"
                  />
                </div>
              </div>
            )}

            {/* Standings Podium */}
            <div className="w-full flex flex-col gap-2 mt-2">
              <span className="text-xs font-black uppercase tracking-[0.3em] text-cyan-300">
                Final Leaderboard
              </span>
              <div className="flex flex-col gap-2">
                {state.result.standings.map((s, i) => (
                  <div
                    key={s.id}
                    className={`flex items-center justify-between p-3.5 rounded-xl text-sm ${
                      s.id === state.result?.winner?.id
                        ? "border-2 border-amber-400/60 bg-amber-500/20 font-bold"
                        : "border border-white/10 bg-slate-900/50"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-mono font-black text-white/60 w-6">
                        {i === 0 && s.completed ? "👑" : `#${i + 1}`}
                      </span>
                      <span className="font-bold text-white text-base">{s.name}</span>
                    </div>
                    <div className="flex items-center gap-4 font-mono">
                      <span className="text-indigo-200/60">{s.moves} moves</span>
                      <span className="text-emerald-400 font-bold">
                        {s.completed ? formatClock(s.durationMs ?? 0) : "—"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Footer Branding for Big Screen */}
      <footer className="relative z-10 flex items-center justify-between w-full border-t border-white/10 pt-4 text-xs text-indigo-200/50 font-mono">
        <span>FUZZAL MULTIPLAYER ARENA • EVENT DISPLAY SYSTEM</span>
        <span>AUDIENCE BROADCAST</span>
      </footer>
    </main>
  );
}
