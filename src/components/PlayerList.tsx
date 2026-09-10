"use client";

import type { PlayerView } from "@/lib/fuzal/useFuzalGame";

export const SLOT_COLORS = [
  "from-cyan-400 to-sky-500",
  "from-fuchsia-400 to-pink-500",
  "from-amber-400 to-orange-500",
  "from-emerald-400 to-teal-500",
  "from-violet-400 to-purple-500",
];

export function Avatar({
  name,
  slot,
  connected = true,
  size = "md",
}: {
  name: string;
  slot: number;
  connected?: boolean;
  size?: "sm" | "md" | "lg";
}) {
  const dims =
    size === "lg" ? "h-12 w-12 text-lg" : size === "sm" ? "h-8 w-8 text-sm" : "h-10 w-10 text-base";
  const initials = name
    .trim()
    .split(/\s+/)
    .map((w) => w[0]?.toUpperCase())
    .slice(0, 2)
    .join("");
  return (
    <div
      className={`relative grid ${dims} shrink-0 place-items-center rounded-full bg-gradient-to-br font-bold text-slate-900 ${
        SLOT_COLORS[slot % SLOT_COLORS.length]
      } ${connected ? "" : "grayscale opacity-50"}`}
    >
      {initials}
      <span
        className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-[#0b1020] ${
          connected ? "bg-emerald-400" : "bg-rose-500"
        }`}
      />
    </div>
  );
}

/** Big-screen slot board for the lobby (● joined / ○ waiting). */
export function PlayerSlots({
  players,
  maxPlayers,
}: {
  players: PlayerView[];
  maxPlayers: number;
}) {
  const slots = Array.from({ length: maxPlayers }, (_, i) => players[i] ?? null);
  return (
    <div className="grid w-full grid-cols-1 gap-3">
      {slots.map((player, i) => (
        <div
          key={player?.id ?? `empty-${i}`}
          className={`flex items-center gap-4 rounded-2xl border px-5 py-4 transition-all duration-300 ${
            player
              ? "animate-slot-in border-cyan-300/30 bg-white/[0.07]"
              : "border-dashed border-white/15 bg-white/[0.02]"
          }`}
        >
          {player ? (
            <>
              <Avatar name={player.name} slot={player.slot} connected={player.connected} />
              <div className="min-w-0 flex-1 text-left">
                <p className="truncate text-xl font-bold text-white">{player.name}</p>
                <p className="text-sm text-indigo-200/70">
                  {player.connected ? (
                    <span className="text-emerald-300">● Connected</span>
                  ) : (
                    <span className="text-rose-300">🔴 Disconnected</span>
                  )}
                </p>
              </div>
              <span className="font-display text-sm font-bold text-cyan-300/80">
                P{i + 1}
              </span>
            </>
          ) : (
            <>
              <div className="grid h-10 w-10 place-items-center rounded-full border border-dashed border-white/20 text-xl text-white/30">
                ○
              </div>
              <p className="text-lg font-medium text-white/35">Waiting for player…</p>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

/** Compact live roster used during the game on the host screen. */
export function LiveRoster({
  players,
  progress,
}: {
  players: PlayerView[];
  progress?: { id: string; moves: number; correctCount: number; total: number; completed: boolean }[];
}) {
  return (
    <div className="grid gap-3">
      {players.map((p) => {
        const pr = progress?.find((x) => x.id === p.id);
        const pct = pr ? Math.round((pr.correctCount / pr.total) * 100) : 0;
        return (
          <div
            key={p.id}
            className="flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.05] px-5 py-3"
          >
            <Avatar name={p.name} slot={p.slot} connected={p.connected} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-lg font-bold text-white">{p.name}</p>
                <span className="text-sm font-semibold text-indigo-200/70">
                  {pr
                    ? pr.completed
                      ? "✅ Solved!"
                      : p.connected
                        ? "Solving…"
                        : "Reconnecting…"
                    : p.connected
                      ? "Ready"
                      : "Disconnected"}
                </span>
              </div>
              {pr && (
                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-fuchsia-400 transition-all duration-500"
                    style={{ width: `${pr.completed ? 100 : pct}%` }}
                  />
                </div>
              )}
            </div>
            {pr && (
              <div className="w-16 text-right text-sm font-mono text-cyan-200">
                {pr.correctCount}/{pr.total}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
