"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Wordmark, Logo } from "@/components/Brand";
import { createLobby, sessionStore } from "@/lib/fuzal/api";
import { GAME_CONFIG } from "@/lib/game/config";
import { GameBadge } from "@/components/game/GameBadge";
import { GridSelector } from "@/components/game/GridSelector";
import { ControlRoomNav, HostTab } from "@/components/host/ControlRoomNav";
import { OverviewTab } from "@/components/host/OverviewTab";
import { PlayersTab } from "@/components/host/PlayersTab";
import { HistoryTab } from "@/components/host/HistoryTab";
import { PuzzleLibraryTab } from "@/components/host/PuzzleLibraryTab";
import { ConfigTab } from "@/components/host/ConfigTab";

const CAPACITY_PRESETS = [4, 8, 16, 32, 50, 100];

function HostControlRoomContent() {
  const router = useRouter();
  const search = useSearchParams();

  const [activeTab, setActiveTab] = useState<HostTab>(() => {
    const t = search.get("tab") as HostTab;
    if (["overview", "players", "history", "puzzles", "config"].includes(t)) {
      return t;
    }
    return "overview";
  });

  const [gridSize, setGridSize] = useState<number>(3);
  const [maxPlayers, setMaxPlayers] = useState<number>(GAME_CONFIG.defaultCapacity ?? 8);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check for existing host sessions in sessionStore
  const [activeSessions, setActiveSessions] = useState<string[]>([]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const keys = Object.keys(sessionStorage);
      const hostCodes = keys
        .filter((k) => k.startsWith("host:"))
        .map((k) => k.replace("host:", ""))
        .filter(Boolean);
      setActiveSessions(hostCodes);
    } catch {
      // ignore
    }
  }, []);

  async function handleCreateArena() {
    setCreating(true);
    setError(null);
    try {
      const lobby = await createLobby({ gridSize, maxPlayers });
      sessionStore.set(`host:${lobby.code}`, {
        token: lobby.hostToken,
        createdAt: Date.now(),
      });
      router.push(`/host/${lobby.code}`);
    } catch (e) {
      setError((e as Error).message);
      setCreating(false);
    }
  }

  const pieceCount = gridSize * gridSize;

  return (
    <div className="flex min-h-screen flex-col bg-[#050816] text-white selection:bg-cyan-500 selection:text-black">
      {/* Cockpit Top Bar */}
      <header className="sticky top-0 z-40 w-full border-b border-cyan-500/20 bg-slate-950/90 backdrop-blur-md px-4 py-3 sm:px-6">
        <div className="mx-auto flex flex-wrap items-center justify-between gap-3 max-w-7xl">
          <div className="flex items-center gap-3">
            <Logo size={28} />
            <Wordmark size={20} />
            <div className="hidden sm:block h-5 w-px bg-white/15" />
            <span className="font-mono text-xs font-black uppercase tracking-[0.25em] text-cyan-300">
              Control Room
            </span>
          </div>

          <div className="flex items-center gap-3">
            {activeSessions.length > 0 && (
              <button
                type="button"
                onClick={() => router.push(`/host/${activeSessions[0]}`)}
                className="btn-secondary px-3 py-1.5 text-xs font-bold flex items-center gap-2 border-emerald-400/40 text-emerald-300"
              >
                <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                <span>Resume Arena {activeSessions[0]}</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setActiveTab("config")}
              className="btn-primary px-3.5 py-1.5 text-xs font-bold flex items-center gap-1.5"
            >
              <span>⚙️</span>
              <span>Arena Config</span>
            </button>
          </div>
        </div>
      </header>

      {/* Cockpit Main Area */}
      <main className="mx-auto flex-1 w-full max-w-7xl px-3 py-4 sm:px-6 sm:py-6">
        <div className="flex flex-col lg:flex-row gap-6 items-start">
          {/* Navigation Sidebar */}
          <ControlRoomNav
            activeTab={activeTab}
            onTabChange={setActiveTab}
            isLive={activeSessions.length > 0}
            playersCount={0}
          />

          {/* Active Workspace View */}
          <div className="flex-1 w-full min-w-0">
            {/* If user clicks "live" tab from the root, provide an Arena Launch or Resume hero */}
            {activeTab === "live" && (
              <div className="flex flex-col gap-6">
                <div className="glass p-6 sm:p-8 flex flex-col items-center text-center gap-6 border border-cyan-400/30">
                  <span className="text-5xl animate-float">🎛️</span>
                  <div className="flex flex-col items-center gap-2 max-w-md">
                    <GameBadge variant="ready" pulse>ARENA LAUNCH COCKPIT</GameBadge>
                    <h2 className="font-display text-3xl sm:text-4xl font-black text-white uppercase">
                      Start An Arena Match
                    </h2>
                    <p className="text-xs sm:text-sm text-indigo-200/70">
                      Configure your grid dimensions and player capacity to launch a new live game lobby.
                    </p>
                  </div>

                  {/* Dynamic Grid Selector */}
                  <div className="w-full flex flex-col items-center">
                    <GridSelector
                      value={gridSize}
                      onChange={setGridSize}
                      disabled={creating}
                    />
                  </div>

                  {/* Capacity Selector */}
                  <div className="flex flex-col items-center gap-3 w-full max-w-md p-4 rounded-2xl bg-slate-900/50 border border-white/10">
                    <div className="flex items-center justify-between w-full text-xs">
                      <span className="font-bold uppercase tracking-wider text-indigo-200/70">
                        Player Capacity
                      </span>
                      <span className="font-mono font-bold text-cyan-300">
                        {maxPlayers} Players Max
                      </span>
                    </div>

                    <div className="flex items-center justify-center gap-4">
                      <button
                        type="button"
                        disabled={creating || maxPlayers <= 1}
                        onClick={() => setMaxPlayers((m) => Math.max(1, m - 1))}
                        className="h-9 w-9 rounded-lg bg-slate-800 border border-white/10 hover:border-cyan-400 text-white font-bold"
                      >
                        −
                      </button>
                      <span className="font-display text-2xl font-black text-white w-16 text-center tabular-nums">
                        {maxPlayers}
                      </span>
                      <button
                        type="button"
                        disabled={creating || maxPlayers >= 100}
                        onClick={() => setMaxPlayers((m) => Math.min(100, m + 1))}
                        className="h-9 w-9 rounded-lg bg-slate-800 border border-white/10 hover:border-cyan-400 text-white font-bold"
                      >
                        +
                      </button>
                    </div>

                    <div className="flex flex-wrap items-center justify-center gap-1.5 pt-1">
                      {CAPACITY_PRESETS.map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          disabled={creating}
                          onClick={() => setMaxPlayers(preset)}
                          className={`px-2.5 py-0.5 text-xs font-mono font-bold rounded-lg border transition-all ${
                            maxPlayers === preset
                              ? "border-cyan-400 bg-cyan-500/25 text-white"
                              : "border-white/10 bg-slate-800/40 text-indigo-200/60"
                          }`}
                        >
                          {preset}P
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Launch Button */}
                  <div className="flex flex-col items-center gap-2 w-full max-w-md">
                    <button
                      type="button"
                      onClick={handleCreateArena}
                      disabled={creating}
                      className="btn-primary w-full py-3.5 text-base font-black uppercase flex items-center justify-center gap-2"
                    >
                      {creating ? (
                        <span>LAUNCHING ARENA…</span>
                      ) : (
                        <>
                          <span>🚀</span>
                          <span>LAUNCH {gridSize}×{gridSize} ARENA ({pieceCount} PCS)</span>
                        </>
                      )}
                    </button>
                    {error && (
                      <p className="text-xs text-rose-400 font-bold">{error}</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {activeTab === "overview" && <OverviewTab />}
            {activeTab === "players" && <PlayersTab />}
            {activeTab === "history" && <HistoryTab />}
            {activeTab === "puzzles" && <PuzzleLibraryTab />}
            {activeTab === "config" && (
              <ConfigTab maxPlayers={maxPlayers} currentGridSize={gridSize} />
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

export default function HostControlRoomRoot() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[#050816]">
          <span className="h-3 w-3 animate-ping rounded-full bg-cyan-400" />
        </div>
      }
    >
      <HostControlRoomContent />
    </Suspense>
  );
}

