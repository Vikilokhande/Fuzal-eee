"use client";

import React, { useEffect, useState } from "react";
import { getHostHistory, getGameDetail } from "@/lib/fuzal/api";
import type { GameHistoryItem, GameHistoryDetail } from "@/lib/game/types";
import { GameBadge } from "@/components/game/GameBadge";

export function HistoryTab() {
  const [games, setGames] = useState<GameHistoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState("");
  const [gridFilter, setGridFilter] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [dateFilter, setDateFilter] = useState<string>("all");

  // Detail modal state
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [gameDetail, setGameDetail] = useState<GameHistoryDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const fetchHistory = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await getHostHistory({
        page,
        limit: 15,
        grid: gridFilter !== "ALL" ? Number(gridFilter) : undefined,
        status: statusFilter !== "ALL" ? statusFilter : undefined,
        search: search ? search : undefined,
        date: dateFilter !== "all" ? dateFilter : undefined,
      });
      setGames(res.games ?? []);
      setTotal(res.total ?? 0);
      setTotalPages(res.totalPages ?? 1);
    } catch (err: any) {
      setError(err?.message ?? "Failed to load game history");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const t = setTimeout(() => void fetchHistory(), 250);
    return () => clearTimeout(t);
  }, [page, gridFilter, statusFilter, dateFilter, search]);

  const openGameDetail = async (id: string) => {
    setSelectedGameId(id);
    setDetailLoading(true);
    try {
      const detail = await getGameDetail(id);
      setGameDetail(detail);
    } catch (err) {
      console.error(err);
    } finally {
      setDetailLoading(false);
    }
  };

  return (
    <div className="flex w-full flex-col gap-6 select-none">
      {/* Header Banner */}
      <div className="glass p-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <GameBadge variant="ready">ARCHIVED ARENAS</GameBadge>
            <span className="text-xs text-indigo-200/60 font-mono">{total} Total Games</span>
          </div>
          <h2 className="font-display text-2xl sm:text-3xl font-black text-white uppercase tracking-wider mt-1">
            Historical Games Archive
          </h2>
          <p className="text-xs sm:text-sm text-indigo-200/70">
            Audit trail of completed arena rounds, puzzle challenges, and individual player outcomes.
          </p>
        </div>

        {/* Filter Controls Row */}
        <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">
          {/* Search */}
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search code, puzzle, winner…"
            className="rounded-xl border border-white/15 bg-slate-900/80 px-3 py-1.5 text-xs text-white placeholder:text-white/30 focus:border-cyan-400 focus:outline-none w-full sm:w-48"
          />

          {/* Grid filter */}
          <select
            value={gridFilter}
            onChange={(e) => {
              setGridFilter(e.target.value);
              setPage(1);
            }}
            className="rounded-xl border border-white/15 bg-slate-900 px-3 py-1.5 text-xs text-white focus:border-cyan-400 focus:outline-none"
          >
            <option value="ALL">All Grids</option>
            <option value="2">2×2 (4)</option>
            <option value="3">3×3 (9)</option>
            <option value="4">4×4 (16)</option>
            <option value="5">5×5 (25)</option>
            <option value="6">6×6 (36)</option>
            <option value="7">7×7 (49)</option>
            <option value="8">8×8 (64)</option>
          </select>

          {/* Date Range filter */}
          <select
            value={dateFilter}
            onChange={(e) => {
              setDateFilter(e.target.value);
              setPage(1);
            }}
            className="rounded-xl border border-white/15 bg-slate-900 px-3 py-1.5 text-xs text-white focus:border-cyan-400 focus:outline-none"
          >
            <option value="all">All Time</option>
            <option value="today">Today</option>
            <option value="week">Past Week</option>
            <option value="month">Past Month</option>
          </select>

          {/* Status filter */}
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            className="rounded-xl border border-white/15 bg-slate-900 px-3 py-1.5 text-xs text-white focus:border-cyan-400 focus:outline-none"
          >
            <option value="ALL">All Statuses</option>
            <option value="FINISHED">Finished</option>
            <option value="PUZZLE">Puzzle</option>
            <option value="MEMORY">Memory</option>
            <option value="LOBBY">Lobby</option>
          </select>
        </div>
      </div>

      {/* Main Games Table Card */}
      <div className="glass p-5 sm:p-6 flex flex-col gap-4">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-12 text-center gap-3">
            <span className="h-3 w-3 animate-ping rounded-full bg-cyan-400" />
            <p className="text-xs font-bold uppercase tracking-widest text-cyan-300">
              Querying Historical Archives…
            </p>
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-8 text-center flex flex-col items-center gap-3">
            <span className="text-3xl">⚠️</span>
            <p className="text-base font-bold text-white uppercase tracking-wider">DATA UNAVAILABLE</p>
            <p className="text-xs text-rose-300 max-w-sm">Unable to load game history. {error}</p>
            <button
              type="button"
              onClick={() => void fetchHistory()}
              className="btn-secondary mt-2 px-5 py-2 text-xs font-bold flex items-center gap-2"
            >
              <span>🔄</span>
              <span>RETRY</span>
            </button>
          </div>
        ) : games.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/15 p-8 text-center flex flex-col items-center gap-2">
            <span className="text-3xl">📜</span>
            <p className="text-sm font-bold text-white">No Historical Games Matching Filters</p>
            <p className="text-xs text-indigo-200/60">
              Try adjusting search terms or date range filters.
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto w-full">
              <table className="w-full text-left text-xs sm:text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-[10px] font-extrabold uppercase tracking-widest text-indigo-200/60">
                    <th className="pb-3 pl-2">Lobby / Date</th>
                    <th className="pb-3">Puzzle Image</th>
                    <th className="pb-3">Grid Size</th>
                    <th className="pb-3">Players</th>
                    <th className="pb-3">Winner</th>
                    <th className="pb-3">Solve Time</th>
                    <th className="pb-3">Status</th>
                    <th className="pb-3 pr-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 font-medium">
                  {games.map((g) => (
                    <tr
                      key={g.id}
                      onClick={() => openGameDetail(g.id)}
                      className="hover:bg-white/[0.04] transition-colors cursor-pointer"
                    >
                      <td className="py-3 pl-2">
                        <div className="flex flex-col">
                          <span className="font-mono font-bold text-cyan-300">{g.lobbyCode}</span>
                          <span className="text-[11px] text-indigo-200/50">{g.date}</span>
                        </div>
                      </td>
                      <td className="py-3 font-bold text-white">{g.puzzleName}</td>
                      <td className="py-3 font-mono text-purple-300 font-bold">{g.gridDisplay}</td>
                      <td className="py-3 font-mono text-indigo-200/80">{g.playerCount}</td>
                      <td className="py-3">
                        {g.winnerName ? (
                          <span className="font-bold text-amber-300 flex items-center gap-1">
                            <span>🏆</span> {g.winnerName}
                          </span>
                        ) : (
                          <span className="text-indigo-200/40 italic">—</span>
                        )}
                      </td>
                      <td className="py-3 font-mono font-bold text-emerald-400">
                        {g.winnerDurationFormatted ?? g.durationFormatted}
                      </td>
                      <td className="py-3">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-mono font-bold uppercase ${
                            g.status === "FINISHED"
                              ? "bg-emerald-500/20 text-emerald-300"
                              : "bg-cyan-500/20 text-cyan-300"
                          }`}
                        >
                          {g.status}
                        </span>
                      </td>
                      <td className="py-3 pr-2 text-right">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openGameDetail(g.id);
                          }}
                          className="rounded-lg bg-white/5 hover:bg-cyan-500/20 px-2.5 py-1 text-xs font-bold text-cyan-300 transition-colors"
                        >
                          Inspect →
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            <div className="flex items-center justify-between border-t border-white/10 pt-4 text-xs text-indigo-200/60">
              <span>
                Page {page} of {totalPages} ({total} games)
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="rounded-xl border border-white/10 bg-slate-900 px-3 py-1.5 font-bold hover:bg-white/5 disabled:opacity-30 disabled:pointer-events-none"
                >
                  ← Previous
                </button>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="rounded-xl border border-white/10 bg-slate-900 px-3 py-1.5 font-bold hover:bg-white/5 disabled:opacity-30 disabled:pointer-events-none"
                >
                  Next →
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Game Details Drilldown Modal */}
      {selectedGameId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="glass max-w-2xl w-full p-6 sm:p-8 flex flex-col gap-6 border border-cyan-400/40 shadow-2xl my-auto">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-widest text-indigo-200/60">
                  Game Details
                </span>
                <h3 className="font-display text-2xl font-black text-white uppercase mt-0.5">
                  Arena {gameDetail?.lobbyCode ?? "…"} • {gameDetail?.gridDisplay}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedGameId(null);
                  setGameDetail(null);
                }}
                className="text-white/60 hover:text-white text-xl p-1 font-bold"
              >
                ✕
              </button>
            </div>

            {detailLoading || !gameDetail ? (
              <div className="flex flex-col items-center justify-center py-10 gap-2">
                <span className="h-3 w-3 animate-ping rounded-full bg-cyan-400" />
                <p className="text-xs font-bold text-cyan-300">Loading Game Details…</p>
              </div>
            ) : (
              <div className="flex flex-col gap-5">
                {/* Summary Info Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <div className="rounded-xl bg-slate-900/80 p-3 border border-white/10">
                    <span className="text-[10px] font-bold uppercase text-indigo-200/60">Puzzle</span>
                    <p className="font-bold text-white text-sm truncate">{gameDetail.puzzle.name}</p>
                  </div>
                  <div className="rounded-xl bg-slate-900/80 p-3 border border-white/10">
                    <span className="text-[10px] font-bold uppercase text-indigo-200/60">Pieces</span>
                    <p className="font-bold text-purple-300 text-sm font-mono">{gameDetail.pieceCount} Pcs</p>
                  </div>
                  <div className="rounded-xl bg-slate-900/80 p-3 border border-white/10">
                    <span className="text-[10px] font-bold uppercase text-indigo-200/60">Duration</span>
                    <p className="font-bold text-emerald-400 text-sm font-mono">{gameDetail.durationFormatted}</p>
                  </div>
                  <div className="rounded-xl bg-slate-900/80 p-3 border border-white/10">
                    <span className="text-[10px] font-bold uppercase text-indigo-200/60">Winner</span>
                    <p className="font-bold text-amber-300 text-sm truncate">
                      {gameDetail.winner ? gameDetail.winner.name : "None"}
                    </p>
                  </div>
                </div>

                {/* Final Standings Table */}
                <div className="flex flex-col gap-2">
                  <h4 className="text-xs font-extrabold uppercase tracking-wider text-cyan-300">
                    Final Standings &amp; Player Performance
                  </h4>

                  {gameDetail.standings.length === 0 ? (
                    <p className="text-xs text-indigo-200/50 italic">No player records recorded for this round.</p>
                  ) : (
                    <div className="flex flex-col gap-2 max-h-60 overflow-y-auto pr-1">
                      {gameDetail.standings.map((p, idx) => (
                        <div
                          key={p.id}
                          className="flex items-center justify-between p-2.5 rounded-xl bg-slate-900/60 border border-white/5 text-xs"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span className="font-mono font-bold text-white/50 w-4">
                              {idx === 0 && p.completed ? "👑" : `#${idx + 1}`}
                            </span>
                            <span className="font-bold text-white truncate">{p.name}</span>
                          </div>

                          <div className="flex items-center gap-4">
                            <span className="text-indigo-200/60 font-mono">
                              {p.moves} moves
                            </span>
                            <span className="text-indigo-200/70 font-mono">
                              {p.correctSlots}/{gameDetail.pieceCount} correct
                            </span>
                            <span className="font-mono font-bold text-emerald-400 min-w-12 text-right">
                              {p.durationFormatted}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedGameId(null);
                      setGameDetail(null);
                    }}
                    className="btn-secondary px-4 py-2 text-xs font-bold"
                  >
                    Close Inspector
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
