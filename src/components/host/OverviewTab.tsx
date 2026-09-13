"use client";

import React, { useEffect, useState } from "react";
import { getHostOverview } from "@/lib/fuzal/api";
import type { HostAnalyticsOverview } from "@/lib/game/types";
import { GameBadge } from "@/components/game/GameBadge";

export function OverviewTab({
  onSelectTab,
  onNewArena,
}: {
  onSelectTab?: (tab: string) => void;
  onNewArena?: () => void;
} = {}) {
  const [data, setData] = useState<HostAnalyticsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOverview = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await getHostOverview();
      setData(res);
    } catch (err: any) {
      setError(err?.message ?? "Failed to load overview data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchOverview();
  }, []);

  return (
    <div className="flex w-full flex-col gap-6 select-none">
      {/* Overview Header Banner */}
      <div className="glass p-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <GameBadge variant="ready">ARENA INTELLIGENCE</GameBadge>
            <span className="text-xs text-indigo-200/60 font-mono">Live Operations</span>
          </div>
          <h2 className="font-display text-2xl sm:text-3xl font-black text-white uppercase tracking-wider mt-1">
            Event Operations Overview
          </h2>
          <p className="text-xs sm:text-sm text-indigo-200/70">
            Real-time tournament stats, historical games, and overall solve metrics.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={fetchOverview}
            disabled={loading}
            className="btn-secondary px-3 py-2 text-xs font-bold flex items-center gap-1.5"
          >
            <span>🔄</span>
            <span>Refresh</span>
          </button>
          <button
            type="button"
            onClick={onNewArena}
            className="btn-primary px-4 py-2.5 text-xs sm:text-sm font-black flex items-center gap-1.5"
          >
            <span>🚀</span>
            <span>Create New Game</span>
          </button>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: "Total Games", value: data?.totalGames ?? "—", icon: "🎮", color: "text-cyan-300" },
          { label: "Total Players", value: data?.totalPlayers ?? "—", icon: "👥", color: "text-purple-300" },
          { label: "Completions", value: data?.totalCompletions ?? "—", icon: "🏆", color: "text-emerald-400" },
          { label: "Active Lobbies", value: data?.activeLobbies ?? 0, icon: "⚡", color: "text-amber-300" },
          { label: "Avg Solve Time", value: data?.avgSolveTimeFormatted ?? "—", icon: "⏱️", color: "text-fuchsia-300" },
          { label: "Best Solve Time", value: data?.bestSolveTimeFormatted ?? "—", icon: "⚡", color: "text-yellow-300" },
        ].map((kpi) => (
          <div
            key={kpi.label}
            className="glass p-4 flex flex-col justify-between rounded-2xl border border-white/10 hover:border-cyan-400/40 transition-colors"
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-indigo-200/60">
                {kpi.label}
              </span>
              <span className="text-base opacity-80">{kpi.icon}</span>
            </div>
            <div className="mt-2">
              <span className={`font-display text-2xl sm:text-3xl font-black ${kpi.color}`}>
                {loading ? "…" : kpi.value}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Recent Games Table */}
      <div className="glass p-5 sm:p-6 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-display text-lg sm:text-xl font-bold text-white uppercase tracking-wide">
              Recent Completed Games
            </h3>
            <p className="text-xs text-indigo-200/60">
              Latest arena matches recorded across all sessions.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onSelectTab?.("history")}
            className="text-xs font-bold text-cyan-300 hover:underline underline-offset-4"
          >
            View Full History →
          </button>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-12 text-center gap-3">
            <span className="h-3 w-3 animate-ping rounded-full bg-cyan-400" />
            <p className="text-xs font-bold uppercase tracking-widest text-cyan-300">
              Loading Overview Metrics…
            </p>
          </div>
        ) : error ? (
          <div className="rounded-xl border border-rose-500/40 bg-rose-500/15 p-4 text-center text-xs text-rose-300">
            {error}
          </div>
        ) : !data?.recentGames || data.recentGames.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/15 p-8 text-center flex flex-col items-center gap-2">
            <span className="text-3xl">🎮</span>
            <p className="text-sm font-bold text-white">No Completed Games Recorded</p>
            <p className="text-xs text-indigo-200/60">
              Launch a live arena lobby and complete matches to populate analytics.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto w-full">
            <table className="w-full text-left text-xs sm:text-sm">
              <thead>
                <tr className="border-b border-white/10 text-[10px] font-extrabold uppercase tracking-widest text-indigo-200/60">
                  <th className="pb-3 pl-2">Lobby / Date</th>
                  <th className="pb-3">Puzzle Image</th>
                  <th className="pb-3">Grid</th>
                  <th className="pb-3">Players</th>
                  <th className="pb-3">Winner</th>
                  <th className="pb-3 pr-2 text-right">Winning Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 font-medium">
                {data.recentGames.map((g) => (
                  <tr key={g.id} className="hover:bg-white/[0.03] transition-colors">
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
                        <span className="text-indigo-200/40 italic">No Winner</span>
                      )}
                    </td>
                    <td className="py-3 pr-2 text-right font-mono font-bold text-emerald-400">
                      {g.winnerDurationFormatted ?? g.durationFormatted}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
