"use client";

import React, { useEffect, useState } from "react";
import { getHostPlayers } from "@/lib/fuzal/api";
import { GameBadge } from "@/components/game/GameBadge";

export function PlayersTab() {
  const [players, setPlayers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  const fetchPlayers = async (s?: string) => {
    try {
      setLoading(true);
      setError(null);
      const res = await getHostPlayers(s);
      setPlayers(res.players ?? []);
    } catch (err: any) {
      setError(err?.message ?? "Failed to load players");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const t = setTimeout(() => void fetchPlayers(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  return (
    <div className="flex w-full flex-col gap-6 select-none">
      {/* Header Banner */}
      <div className="glass p-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <GameBadge variant="ready">TOURNAMENT ROSTER</GameBadge>
            <span className="text-xs text-indigo-200/60 font-mono">Player Analytics</span>
          </div>
          <h2 className="font-display text-2xl sm:text-3xl font-black text-white uppercase tracking-wider mt-1">
            Player Leaderboards &amp; History
          </h2>
          <p className="text-xs sm:text-sm text-indigo-200/70">
            Inspection of historical tournament performance, win rates, and solve metrics.
          </p>
        </div>

        {/* Search Input */}
        <div className="w-full sm:w-64">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search players by name…"
            className="w-full rounded-xl border border-white/15 bg-slate-900/80 px-3.5 py-2 text-xs text-white placeholder:text-white/30 focus:border-cyan-400 focus:outline-none"
          />
        </div>
      </div>

      {/* Players Table Card */}
      <div className="glass p-5 sm:p-6 flex flex-col gap-4">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-12 text-center gap-3">
            <span className="h-3 w-3 animate-ping rounded-full bg-cyan-400" />
            <p className="text-xs font-bold uppercase tracking-widest text-cyan-300">
              Loading Player Records…
            </p>
          </div>
        ) : error ? (
          <div className="rounded-xl border border-rose-500/40 bg-rose-500/15 p-4 text-center text-xs text-rose-300">
            {error}
          </div>
        ) : players.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/15 p-8 text-center flex flex-col items-center gap-2">
            <span className="text-3xl">👥</span>
            <p className="text-sm font-bold text-white">No Player Records Found</p>
            <p className="text-xs text-indigo-200/60">
              Players will automatically appear here once they participate in arena matches.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto w-full">
            <table className="w-full text-left text-xs sm:text-sm">
              <thead>
                <tr className="border-b border-white/10 text-[10px] font-extrabold uppercase tracking-widest text-indigo-200/60">
                  <th className="pb-3 pl-2">Rank / Player</th>
                  <th className="pb-3">Wins</th>
                  <th className="pb-3">Games</th>
                  <th className="pb-3">Best Time</th>
                  <th className="pb-3">Avg Time</th>
                  <th className="pb-3">Avg Moves</th>
                  <th className="pb-3 pr-2 text-right">Total Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 font-medium">
                {players.map((p, idx) => (
                  <tr key={p.id} className="hover:bg-white/[0.03] transition-colors">
                    <td className="py-3 pl-2">
                      <div className="flex items-center gap-2.5">
                        <span className="font-mono text-xs font-black text-white/40 w-4">
                          {idx === 0 ? "👑" : `#${idx + 1}`}
                        </span>
                        <span className="font-bold text-white text-sm">{p.name}</span>
                      </div>
                    </td>
                    <td className="py-3">
                      <span className="font-bold text-amber-300 font-mono">
                        {p.wins}
                      </span>
                    </td>
                    <td className="py-3 font-mono text-indigo-200/80">{p.gamesPlayed}</td>
                    <td className="py-3 font-mono font-bold text-emerald-400">
                      {p.bestTimeFormatted}
                    </td>
                    <td className="py-3 font-mono text-indigo-200/70">{p.avgTimeFormatted}</td>
                    <td className="py-3 font-mono text-fuchsia-300">{p.avgMoves}</td>
                    <td className="py-3 pr-2 text-right font-mono font-black text-cyan-300">
                      ★ {p.score}
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
