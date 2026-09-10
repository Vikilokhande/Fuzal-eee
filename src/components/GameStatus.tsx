"use client";

import type { PlayerView, ProgressView } from "@/lib/fuzal/useFuzalGame";
import { LiveRoster } from "./PlayerList";

const PHASE_LABEL: Record<string, { label: string; tone: string }> = {
  LOBBY: { label: "Waiting for players", tone: "text-cyan-300" },
  MEMORY: { label: "Memorize Image", tone: "text-amber-300" },
  PUZZLE: { label: "Puzzle in Progress", tone: "text-fuchsia-300" },
  FINISHED: { label: "Round Complete", tone: "text-emerald-300" },
};

export function PhaseBanner({
  status,
  children,
}: {
  status: string;
  children?: React.ReactNode;
}) {
  const phase = PHASE_LABEL[status] ?? PHASE_LABEL.LOBBY;
  return (
    <div className="flex flex-col items-center gap-2">
      <p className={`text-sm font-bold uppercase tracking-[0.4em] ${phase.tone}`}>
        Game Status
      </p>
      <h2 className="font-display text-3xl font-bold text-white md:text-4xl">
        {phase.label}
      </h2>
      {children}
    </div>
  );
}

export function HostRoster({
  players,
  progress,
  totalPieces,
}: {
  players: PlayerView[];
  progress: ProgressView[] | null;
  totalPieces: number;
}) {
  const enriched = progress?.map((p) => ({
    ...p,
    total: totalPieces,
  }));
  return (
    <div className="w-full max-w-xl">
      <p className="mb-3 text-sm font-bold uppercase tracking-[0.4em] text-indigo-200/70">
        Players
      </p>
      <LiveRoster
        players={players}
        progress={enriched ?? undefined}
      />
    </div>
  );
}
