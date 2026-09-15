"use client";

import React, { useState, useEffect, useRef } from "react";
import type { PlayerView, ProgressView } from "@/lib/fuzal/useFuzalGame";
import { formatClock } from "@/lib/game/format";
import { Avatar } from "@/components/PlayerList";
import { GameBadge } from "@/components/game/GameBadge";

import { LobbyQRCard } from "@/components/game/LobbyQRCard";
import { MemoryImage } from "@/components/MemoryImage";

export interface ActivityFeedItem {
  id: string;
  time: string;
  text: string;
  type: "join" | "leave" | "start" | "memory" | "puzzle" | "move" | "correct" | "solve" | "finish";
}

export function LiveGameTab({
  lobbyCode,
  status,
  players,
  progress,
  gridCols,
  gridRows,
  pieceCount,
  puzzleName,
  timerMs,
  canStart,
  image,
  memorySeconds,
  result,
  maxPlayers = 8,
  selectedPuzzle,
  onSelectPuzzle,
  onClearSelectedPuzzle,
  onStartGame,
  onPlayAgain,
  onBackToLobby,
  onNewLobby,
  onOpenDisplay,
}: {
  lobbyCode: string;
  status: string;
  players: PlayerView[];
  progress: ProgressView[] | null;
  gridCols: number;
  gridRows: number;
  pieceCount: number;
  puzzleName?: string | null;
  timerMs?: number | null;
  canStart: boolean;
  image?: { url: string; name?: string } | null;
  memorySeconds?: number;
  result?: any;
  maxPlayers?: number;
  selectedPuzzle?: { id: string; name: string; url: string } | null;
  onSelectPuzzle?: () => void;
  onClearSelectedPuzzle?: () => void;
  onStartGame: () => void;
  onPlayAgain?: () => void;
  onBackToLobby?: () => void;
  onNewLobby?: () => void;
  onOpenDisplay?: () => void;
}) {
  const [confirmClose, setConfirmClose] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [activityFeed, setActivityFeed] = useState<ActivityFeedItem[]>([]);
  const prevPlayersCount = useRef(players.length);
  const prevStatus = useRef(status);
  const prevMoves = useRef<Record<string, number>>({});
  const prevCorrect = useRef<Record<string, number>>({});

  const handleStartGame = async () => {
    if (isStarting || !canStart) return;
    setIsStarting(true);
    try {
      await onStartGame();
    } finally {
      setIsStarting(false);
    }
  };

  const handlePlayAgain = async () => {
    if (isRestarting || !onPlayAgain) return;
    setIsRestarting(true);
    try {
      await onPlayAgain();
    } finally {
      setIsRestarting(false);
    }
  };

  const handleBackToLobby = async () => {
    if (isResetting || !onBackToLobby) return;
    setIsResetting(true);
    try {
      await onBackToLobby();
    } finally {
      setIsResetting(false);
    }
  };

  const nowTime = () =>
    new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });

  // Add initial activity
  useEffect(() => {
    setActivityFeed((cur) => {
      if (cur.length === 0) {
        return [
          {
            id: `init-${Date.now()}`,
            time: nowTime(),
            text: `Arena ${lobbyCode} initialized (${gridCols}×${gridRows} • ${pieceCount} Pcs)`,
            type: "start",
          },
        ];
      }
      return cur;
    });
  }, [lobbyCode, gridCols, gridRows, pieceCount]);

  // Track player joins / leaves
  useEffect(() => {
    if (players.length > prevPlayersCount.current) {
      const newest = players[players.length - 1];
      if (newest) {
        setActivityFeed((prev) => [
          {
            id: `join-${Date.now()}-${Math.random()}`,
            time: nowTime(),
            text: `${newest.name} joined the arena`,
            type: "join",
          },
          ...prev.slice(0, 49),
        ]);
      }
    }
    prevPlayersCount.current = players.length;
  }, [players]);

  // Track phase transitions
  useEffect(() => {
    if (status !== prevStatus.current) {
      let text = `Phase transitioned to ${status}`;
      let type: ActivityFeedItem["type"] = "puzzle";

      if (status === "MEMORY") {
        text = `Memory phase started (${puzzleName || "Puzzle Image"})`;
        type = "memory";
      } else if (status === "PUZZLE") {
        text = "Memory complete. Puzzle battle started!";
        type = "puzzle";
      } else if (status === "FINISHED") {
        text = "Game completed. Final results ready!";
        type = "finish";
      } else if (status === "LOBBY") {
        text = "Reset back to arena lobby";
        type = "start";
      }

      setActivityFeed((prev) => [
        {
          id: `phase-${Date.now()}-${Math.random()}`,
          time: nowTime(),
          text,
          type,
        },
        ...prev.slice(0, 49),
      ]);
    }
    prevStatus.current = status;
  }, [status, puzzleName]);

  // Track player progress events
  useEffect(() => {
    if (!progress) return;
    for (const pr of progress) {
      const prevM = prevMoves.current[pr.id] ?? 0;
      const prevC = prevCorrect.current[pr.id] ?? 0;

      if (pr.completed && prevC < pr.correctCount) {
        setActivityFeed((prev) => [
          {
            id: `solve-${Date.now()}-${pr.id}`,
            time: nowTime(),
            text: `🏆 ${pr.name} solved the entire puzzle!`,
            type: "solve",
          },
          ...prev.slice(0, 49),
        ]);
      } else if (pr.correctCount > prevC) {
        setActivityFeed((prev) => [
          {
            id: `corr-${Date.now()}-${pr.id}-${pr.correctCount}`,
            time: nowTime(),
            text: `${pr.name} placed a correct piece (${pr.correctCount}/${pieceCount})`,
            type: "correct",
          },
          ...prev.slice(0, 49),
        ]);
      } else if (pr.moves > prevM && pr.moves % 5 === 0) {
        setActivityFeed((prev) => [
          {
            id: `move-${Date.now()}-${pr.id}-${pr.moves}`,
            time: nowTime(),
            text: `${pr.name} reached ${pr.moves} moves`,
            type: "move",
          },
          ...prev.slice(0, 49),
        ]);
      }

      prevMoves.current[pr.id] = pr.moves;
      prevCorrect.current[pr.id] = pr.correctCount;
    }
  }, [progress, pieceCount]);

  return (
    <div className="flex w-full flex-col gap-6 select-none">
      {/* Active Arena Hero Card */}
      <div className="glass p-5 sm:p-6 flex flex-wrap items-center justify-between gap-4 border border-cyan-400/30 shadow-[0_10px_40px_rgba(0,0,0,0.5)]">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <GameBadge variant="code">LOBBY {lobbyCode}</GameBadge>
            <GameBadge variant="grid">
              {gridCols}×{gridRows} • {pieceCount} Pcs
            </GameBadge>
            <GameBadge
              variant={
                status === "PUZZLE"
                  ? "puzzle"
                  : status === "MEMORY"
                    ? "memory"
                    : status === "FINISHED"
                      ? "solved"
                      : "ready"
              }
              pulse
            >
              {status}
            </GameBadge>
          </div>
          <h2 className="font-display text-2xl sm:text-3xl font-black text-white uppercase tracking-wider mt-1">
            {puzzleName || "Cosmic Arena Match"}
          </h2>
          <p className="text-xs sm:text-sm text-indigo-200/70">
            Real-time live battle operations and player telemetry.
          </p>
        </div>
      </div>

      {/* Phase Specific Visuals */}
      {status === "LOBBY" && (
        <div className="flex flex-col sm:flex-row items-center justify-center gap-6 p-4 rounded-3xl bg-slate-900/40 border border-white/10">
          <LobbyQRCard code={lobbyCode} gridSize={gridCols} pieceCount={pieceCount} size={200} />
          <div className="flex flex-col gap-3 max-w-sm text-center sm:text-left">
            <GameBadge variant="ready" pulse>ARENA LOBBY OPEN</GameBadge>
            <h3 className="font-display text-2xl sm:text-3xl font-black text-white uppercase">
              Scan &amp; Enter Match
            </h3>
            <p className="text-xs sm:text-sm text-indigo-200/70 leading-relaxed">
              Players scan the QR code with their mobile device. The arena supports up to{" "}
              <strong className="text-cyan-300">{maxPlayers} players</strong> in this battle.
            </p>

            {/* Selected Puzzle Indicator & Selector */}
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-black/40 border border-white/10 text-xs my-1">
              <div className="flex items-center gap-2.5 min-w-0">
                {selectedPuzzle ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={selectedPuzzle.url}
                      alt={selectedPuzzle.name}
                      className="h-9 w-9 rounded-lg object-cover border border-cyan-400/40 flex-shrink-0"
                    />
                    <div className="min-w-0 text-left">
                      <span className="text-[10px] uppercase font-mono text-cyan-400 font-bold block">Selected Puzzle</span>
                      <span className="text-white font-bold truncate block">{selectedPuzzle.name}</span>
                    </div>
                  </>
                ) : (
                  <div className="flex items-center gap-2 text-left">
                    <span className="text-base">🎲</span>
                    <div>
                      <span className="text-[10px] uppercase font-mono text-indigo-200/60 font-bold block">Puzzle Selection</span>
                      <span className="text-indigo-200 font-medium">Random / Persistent Ready</span>
                    </div>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {selectedPuzzle && onClearSelectedPuzzle && (
                  <button
                    type="button"
                    onClick={onClearSelectedPuzzle}
                    className="text-xs px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-indigo-200"
                    title="Clear Selection"
                  >
                    ✕
                  </button>
                )}
                {onSelectPuzzle && (
                  <button
                    type="button"
                    onClick={onSelectPuzzle}
                    className="btn-secondary px-2.5 py-1 text-xs font-bold text-cyan-300 border-cyan-400/30"
                  >
                    {selectedPuzzle ? "Change" : "Choose"}
                  </button>
                )}
              </div>
            </div>

            <div className="pt-1">
              <button
                type="button"
                onClick={handleStartGame}
                disabled={!canStart || isStarting}
                className="btn-primary w-full py-3.5 text-sm font-black flex items-center justify-center gap-2 shadow-[0_0_25px_rgba(34,211,238,0.4)]"
              >
                <span>🚀</span>
                <span>{canStart ? (isStarting ? "LAUNCHING..." : "LAUNCH ARENA MATCH") : "WAITING FOR PLAYERS (MIN 1)"}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {status === "MEMORY" && image && (
        <div className="glass p-6 flex flex-col md:flex-row items-center justify-between gap-6 border border-amber-400/30">
          <div className="flex flex-col items-center gap-2">
            <MemoryImage src={image.url} name={image.name} secondsLeft={memorySeconds ?? 0} />
            {image.name && (
              <span className="text-xs font-mono font-bold text-cyan-300">
                {image.name} • {gridCols}×{gridRows} ({pieceCount} Pieces)
              </span>
            )}
          </div>
          <div className="flex flex-col items-center text-center p-6 rounded-2xl bg-black/40 border border-amber-400/20">
            <span className="text-xs font-black uppercase tracking-[0.3em] text-amber-300">
              Memorization Phase
            </span>
            <span
              className={`font-display text-7xl sm:text-8xl font-black tabular-nums mt-1 ${
                (memorySeconds ?? 0) <= 5 ? "animate-pulse text-rose-400" : "text-amber-300"
              }`}
            >
              {memorySeconds !== undefined && memorySeconds < 10
                ? `0${memorySeconds}`
                : memorySeconds ?? 30}
            </span>
            <p className="text-xs text-indigo-200/60 uppercase tracking-widest mt-2">
              Seconds until scramble
            </p>
          </div>
        </div>
      )}

      {status === "FINISHED" && result && (
        <div className="glass p-6 flex flex-col items-center text-center gap-4 border border-emerald-400/40 bg-gradient-to-b from-emerald-500/10 to-transparent">
          <span className="text-6xl animate-bounce">🏆</span>
          <h3 className="font-display text-3xl font-black text-white uppercase tracking-wider">
            {result.winner ? `${result.winner.name} Solved the Arena!` : "Arena Battle Complete!"}
          </h3>
          <p className="text-sm text-indigo-200/70">
            Solved in {formatClock(result.durationMs)} • {pieceCount} Pieces Reconstructed
          </p>
          <div className="flex flex-wrap items-center gap-3 mt-2">
            {onPlayAgain && (
              <button
                type="button"
                onClick={handlePlayAgain}
                disabled={isRestarting}
                className="btn-primary px-6 py-2.5 text-xs sm:text-sm font-black flex items-center gap-1.5"
              >
                {isRestarting ? (
                  <>
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent inline-block" />
                    <span>STARTING REMATCH...</span>
                  </>
                ) : (
                  <>
                    <span>🔁</span>
                    <span>Rematch (Play Again)</span>
                  </>
                )}
              </button>
            )}
            {onBackToLobby && (
              <button
                type="button"
                onClick={handleBackToLobby}
                disabled={isResetting}
                className="btn-secondary px-6 py-2.5 text-xs sm:text-sm font-bold flex items-center gap-1.5"
              >
                {isResetting ? (
                  <>
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent inline-block" />
                    <span>RETURNING...</span>
                  </>
                ) : (
                  <>
                    <span>👥</span>
                    <span>Return to Lobby</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Main 2-Column Live Operational Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Left 2 Cols: Player Live Status Table */}
        <div className="lg:col-span-2 flex flex-col gap-4">
          <div className="glass p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-display text-lg sm:text-xl font-bold text-white uppercase tracking-wider">
                  Player Live Telemetry
                </h3>
                <p className="text-xs text-indigo-200/60">
                  Authoritative board accuracy, moves, and completion tracking.
                </p>
              </div>
              <span className="font-mono text-xs font-bold text-cyan-300">
                {players.length} Active Players
              </span>
            </div>

            {players.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/15 p-8 text-center flex flex-col items-center gap-2">
                <span className="h-3 w-3 animate-ping rounded-full bg-cyan-400" />
                <p className="text-sm font-bold text-white">Waiting for Players to Join</p>
                <p className="text-xs text-indigo-200/60">
                  Direct players to scan the lobby QR code or visit the join URL with code <b>{lobbyCode}</b>.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-2.5">
                {players.map((p, idx) => {
                  const pr = progress?.find((x) => x.id === p.id);
                  const correct = pr?.correctCount ?? 0;
                  const moves = pr?.moves ?? 0;
                  const completed = pr?.completed ?? false;
                  const pct = Math.round((correct / pieceCount) * 100);

                  return (
                    <div
                      key={p.id}
                      className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-2xl border transition-all ${
                        completed
                          ? "border-emerald-400/60 bg-emerald-500/10 shadow-[0_0_15px_rgba(52,211,153,0.2)]"
                          : "border-white/10 bg-slate-900/60 hover:border-cyan-400/30"
                      }`}
                    >
                      {/* Player Info */}
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="font-mono text-xs font-bold text-white/40 w-4">
                          #{idx + 1}
                        </span>
                        <Avatar name={p.name} slot={p.slot} connected={p.connected} size="md" />
                        <div className="min-w-0">
                          <p className="font-bold text-sm sm:text-base text-white truncate flex items-center gap-2">
                            {p.name}
                            {completed && <span className="text-xs">🏆</span>}
                          </p>
                          <p className="text-[11px] text-indigo-200/60 flex items-center gap-1.5">
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${
                                p.connected ? "bg-emerald-400" : "bg-rose-400"
                              }`}
                            />
                            <span>{p.connected ? "Active" : "Disconnected"}</span>
                          </p>
                        </div>
                      </div>

                      {/* Progress Bar & Telemetry */}
                      <div className="flex items-center gap-4 sm:w-64 justify-between sm:justify-end">
                        <div className="flex flex-col items-start sm:items-end w-full sm:w-36">
                          <div className="flex items-center justify-between w-full text-[11px] font-mono">
                            <span className="text-indigo-200/70">{correct}/{pieceCount}</span>
                            <span className={completed ? "text-emerald-400 font-bold" : "text-cyan-300"}>
                              {completed ? "SOLVED" : `${pct}%`}
                            </span>
                          </div>
                          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                            <div
                              className={`h-full rounded-full transition-all duration-300 ${
                                completed
                                  ? "bg-emerald-400"
                                  : "bg-gradient-to-r from-cyan-400 to-fuchsia-400"
                              }`}
                              style={{ width: `${completed ? 100 : Math.max(5, pct)}%` }}
                            />
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          <span className="font-mono text-xs text-indigo-200/80">
                            {moves} moves
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Host Game Control Actions */}
          <div className="glass p-5 flex flex-col gap-4 border border-white/10">
            <h3 className="font-display text-base sm:text-lg font-bold text-white uppercase tracking-wider">
              Host Arena Controls
            </h3>

            <div className="flex flex-wrap items-center gap-3">
              {status === "LOBBY" && (
                <button
                  type="button"
                  onClick={handleStartGame}
                  disabled={!canStart || isStarting}
                  className="btn-primary px-6 py-3 text-sm font-black flex items-center gap-2"
                >
                  {isStarting ? (
                    <>
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent inline-block" />
                      <span>STARTING ARENA...</span>
                    </>
                  ) : (
                    <>
                      <span>🚀</span>
                      <span>START ARENA MATCH</span>
                    </>
                  )}
                </button>
              )}

              {status === "FINISHED" && (
                <>
                  {onPlayAgain && (
                    <button
                      type="button"
                      onClick={handlePlayAgain}
                      disabled={isRestarting}
                      className="btn-primary px-5 py-2.5 text-xs font-bold flex items-center gap-2"
                    >
                      {isRestarting ? (
                        <>
                          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent inline-block" />
                          <span>STARTING REMATCH...</span>
                        </>
                      ) : (
                        <>
                          <span>🔁</span>
                          <span>PLAY AGAIN</span>
                        </>
                      )}
                    </button>
                  )}
                  {onBackToLobby && (
                    <button
                      type="button"
                      onClick={handleBackToLobby}
                      disabled={isResetting}
                      className="btn-secondary px-5 py-2.5 text-xs font-bold flex items-center gap-2"
                    >
                      {isResetting ? (
                        <>
                          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent inline-block" />
                          <span>RETURNING...</span>
                        </>
                      ) : (
                        <>
                          <span>👥</span>
                          <span>BACK TO LOBBY</span>
                        </>
                      )}
                    </button>
                  )}
                </>
              )}

              {onNewLobby && (
                <button
                  type="button"
                  onClick={() => setConfirmClose(true)}
                  className="btn-ghost px-4 py-2.5 text-xs font-bold text-rose-300 hover:text-rose-200 flex items-center gap-1.5 ml-auto"
                >
                  <span>🛑</span>
                  <span>Close Arena</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Right Col: Live Activity Feed */}
        <div className="glass p-5 flex flex-col gap-3.5 border border-white/10 max-h-[580px] overflow-hidden">
          <div className="flex items-center justify-between pb-1 border-b border-white/10">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse" />
              <h3 className="font-display text-sm font-bold text-white uppercase tracking-wider">
                Live Activity Feed
              </h3>
            </div>
            <span className="text-[10px] font-mono text-indigo-200/50">Events Stream</span>
          </div>

          <div className="flex flex-col gap-2 overflow-y-auto pr-1 no-scrollbar text-xs">
            {activityFeed.length === 0 ? (
              <p className="text-indigo-200/40 text-center py-6">Listening for events…</p>
            ) : (
              activityFeed.map((item) => (
                <div
                  key={item.id}
                  className="flex items-start gap-2.5 p-2 rounded-xl bg-slate-900/50 border border-white/5"
                >
                  <span className="font-mono text-[10px] text-indigo-200/40 shrink-0 mt-0.5">
                    {item.time}
                  </span>
                  <p className="text-white text-xs leading-tight min-w-0 break-words flex-1">
                    {item.text}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Confirmation Modal for Destructive Action */}
      {confirmClose && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="glass max-w-sm w-full p-6 flex flex-col items-center gap-4 text-center border border-rose-500/40 shadow-2xl">
            <div className="text-4xl">⚠️</div>
            <h4 className="font-display text-xl font-bold text-white uppercase">Close Live Arena?</h4>
            <p className="text-xs text-indigo-200/70">
              This will end the active lobby <strong>{lobbyCode}</strong> and return to game creation.
            </p>
            <div className="flex items-center gap-2.5 w-full mt-2">
              <button
                type="button"
                onClick={() => setConfirmClose(false)}
                className="btn-secondary flex-1 py-2.5 text-xs font-bold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmClose(false);
                  onNewLobby?.();
                }}
                className="btn-primary flex-1 py-2.5 text-xs font-bold bg-gradient-to-r from-rose-500 to-pink-600"
              >
                Confirm Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
