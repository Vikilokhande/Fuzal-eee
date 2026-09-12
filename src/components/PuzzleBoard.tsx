"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Mobile-first puzzle board. Pure Tap-to-Swap interaction:
 *   1. Tap piece A → highlighted with cyan border/glow.
 *   2. Tap piece B → pieces swap authoritatively on server.
 *   3. Tap piece A again → deselects piece A.
 *
 * Drag-and-drop has been completely removed to prevent ghost-dragging,
 * touch scroll interception, and image stretching/movement issues on mobile.
 */
export function PuzzleBoard({
  board,
  cols,
  rows,
  pieceSrcs,
  interactive = true,
  loading = false,
  error = null,
  onRetry,
  onSwap,
}: {
  board: number[];
  cols: number;
  rows: number;
  pieceSrcs: Record<number, string>;
  interactive?: boolean;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onSwap: (from: number, to: number) => void;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [animSlots, setAnimSlots] = useState<number[]>([]);
  const previous = useRef<number[]>(board);
  const animTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const prev = previous.current;
    const changed = board
      .map((piece, slot) => (prev[slot] !== piece ? slot : -1))
      .filter((s) => s >= 0);
    previous.current = board;
    if (changed.length > 0) {
      setAnimSlots(changed);
      if (animTimer.current) clearTimeout(animTimer.current);
      animTimer.current = setTimeout(() => setAnimSlots([]), 250);
    }
    return () => {
      if (animTimer.current) clearTimeout(animTimer.current);
    };
  }, [board]);

  const total = cols * rows;
  const ready = Object.keys(pieceSrcs).length >= total && !loading;
  const isInteractive = interactive && ready;

  const requestSwap = (a: number, b: number) => {
    if (!isInteractive || a === b) return;
    onSwap(a, b);
  };

  const handleTap = (slot: number) => {
    if (!isInteractive) return;
    if (selected === null) {
      setSelected(slot);
      if (typeof navigator !== "undefined" && navigator.vibrate) {
        navigator.vibrate(12);
      }
    } else if (selected === slot) {
      // Tap selected piece again to deselect
      setSelected(null);
    } else {
      // Tap different piece to swap
      requestSwap(selected, slot);
      setSelected(null);
      if (typeof navigator !== "undefined" && navigator.vibrate) {
        navigator.vibrate(24);
      }
    }
  };

  if (error) {
    return (
      <div
        className="glass flex w-full flex-col items-center justify-center gap-4 rounded-2xl p-8 text-center shadow-2xl ring-1 ring-rose-500/30"
        style={{
          aspectRatio: "1 / 1",
          maxWidth: "min(94vw, 560px)",
        }}
      >
        <div className="text-5xl">⚠️</div>
        <h3 className="font-display text-xl font-bold text-white">
          Piece Loading Interrupted
        </h3>
        <p className="max-w-xs text-xs text-rose-200/80">{error}</p>
        {onRetry && (
          <button
            onClick={onRetry}
            className="btn-primary mt-2 flex items-center gap-2 px-6 py-2.5 text-sm font-bold"
          >
            <span>🔄</span> Retry Loading Pieces
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="relative w-full max-w-[min(94vw,560px)] select-none">
      {/* Loading overlay while preloading all 16 tiles */}
      {!ready && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 rounded-2xl bg-black/75 backdrop-blur-sm">
          <span className="h-10 w-10 animate-spin rounded-full border-4 border-cyan-300 border-t-transparent" />
          <p className="text-xs font-bold uppercase tracking-[0.25em] text-cyan-300">
            Loading {Object.keys(pieceSrcs).length}/{total} pieces…
          </p>
        </div>
      )}

      {/* Touch action manipulation prevents pinch-zoom and scroll interference during gameplay */}
      <div
        className="no-select grid w-full gap-[3px] rounded-2xl bg-black/40 p-[3px] shadow-[0_18px_60px_rgba(0,0,0,0.55)] ring-1 ring-white/10"
        style={{
          gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
          aspectRatio: "1 / 1",
          touchAction: "manipulation",
        }}
        role="grid"
        aria-label="Puzzle board"
      >
        {board.map((pieceId, slot) => {
          const isCorrect = pieceId === slot;
          const src = pieceSrcs[pieceId];
          const isSelected = selected === slot;
          const isAnimating = animSlots.includes(slot);
          return (
            <button
              key={slot}
              type="button"
              role="gridcell"
              aria-label={`Piece position ${slot + 1}`}
              disabled={!isInteractive}
              onClick={() => handleTap(slot)}
              style={{ touchAction: "manipulation" }}
              className={`relative aspect-square overflow-hidden rounded-[7px] bg-slate-800/80 outline-none transition-all duration-100 ${
                isSelected
                  ? "ring-2 ring-cyan-400 shadow-[0_0_14px_rgba(34,211,238,0.75)] scale-[0.96] z-10"
                  : ""
              } ${isCorrect && ready && !isSelected ? "ring-1 ring-emerald-500/40" : ""} ${
                isAnimating ? "animate-swap" : ""
              } ${isInteractive ? "cursor-pointer active:opacity-90" : "cursor-default"}`}
            >
              {src ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={src}
                  alt={`Tile ${pieceId}`}
                  loading="eager"
                  decoding="async"
                  draggable={false}
                  className="pointer-events-none select-none h-full w-full object-cover"
                />
              ) : (
                <span className="shimmer absolute inset-0" />
              )}
              {isCorrect && ready && (
                <span className="absolute right-0.5 top-0.5 grid h-4 w-4 place-items-center rounded-full bg-emerald-400 text-[9px] font-black text-emerald-950 shadow">
                  ✓
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
