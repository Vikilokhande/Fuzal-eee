"use client";

import React from "react";

export type HostTab =
  | "overview"
  | "live"
  | "players"
  | "history"
  | "puzzles"
  | "config";

export interface NavItem {
  id: HostTab;
  label: string;
  icon: string;
  badge?: string | number;
}

const NAV_ITEMS: NavItem[] = [
  { id: "overview", label: "Overview", icon: "📊" },
  { id: "live", label: "Live Game", icon: "🎮" },
  { id: "players", label: "Players", icon: "👥" },
  { id: "history", label: "History", icon: "📜" },
  { id: "puzzles", label: "Puzzle Images", icon: "🖼️" },
  { id: "config", label: "Configuration", icon: "⚙️" },
];

export function ControlRoomNav({
  activeTab,
  onTabChange,
  isLive = false,
  playersCount = 0,
}: {
  activeTab: HostTab;
  onTabChange: (tab: HostTab) => void;
  isLive?: boolean;
  playersCount?: number;
}) {
  return (
    <aside className="w-full lg:w-56 xl:w-64 shrink-0 select-none">
      {/* Desktop / Large Screen Vertical Sidebar */}
      <nav className="hidden lg:flex flex-col gap-1.5 p-3 rounded-2xl border border-cyan-500/20 bg-slate-950/70 backdrop-blur-md shadow-[0_10px_35px_rgba(0,0,0,0.5)]">
        <p className="px-3 py-1 text-[10px] font-black uppercase tracking-[0.3em] text-indigo-200/50">
          Arena Operations
        </p>

        {NAV_ITEMS.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onTabChange(item.id)}
              className={`flex items-center justify-between rounded-xl px-3.5 py-3 text-sm font-bold transition-all text-left ${
                isActive
                  ? "bg-gradient-to-r from-cyan-500/25 to-purple-600/25 text-white border border-cyan-400/40 shadow-[0_0_15px_rgba(34,211,238,0.3)]"
                  : "text-indigo-200/70 hover:text-white hover:bg-white/5 border border-transparent"
              }`}
            >
              <div className="flex items-center gap-3">
                <span className="text-lg">{item.icon}</span>
                <span className="tracking-wide">{item.label}</span>
              </div>

              {item.id === "live" && isLive && (
                <span className="flex h-2 w-2 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                </span>
              )}

              {item.id === "players" && playersCount > 0 && (
                <span className="rounded-full bg-cyan-500/20 px-2 py-0.5 text-[10px] font-mono font-bold text-cyan-300">
                  {playersCount}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Mobile / Tablet Horizontal Navigation Bar */}
      <nav className="flex lg:hidden overflow-x-auto no-scrollbar gap-1.5 p-2 rounded-2xl border border-white/10 bg-slate-950/80 backdrop-blur-md">
        {NAV_ITEMS.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onTabChange(item.id)}
              className={`flex items-center gap-2 whitespace-nowrap rounded-xl px-3 py-2 text-xs font-bold transition-all shrink-0 ${
                isActive
                  ? "bg-cyan-500/20 text-cyan-200 border border-cyan-400/40"
                  : "text-indigo-200/60 hover:text-white"
              }`}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
              {item.id === "live" && isLive && (
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              )}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
