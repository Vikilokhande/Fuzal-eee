"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Mobile-first puzzle board. Primary interaction:
 *   tap piece A (highlight) → tap piece B → swap.
 * Also supports HTML5 drag-and-drop where available (desktop).
 * The board rendered here is the SERVER's board (echoed back per move),
 * ensuring the client can never desync from authoritative state.
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
  const [dragSlot, setDragSlot] = useState<number | null>(null);
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
      animTimer.current = setTimeout(() => setAnimSlots([]), 340);
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
      setSelected(null);
    } else {
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
    <div className="relative w-full max-w-[min(94vw,560px)]">
      {/* Loading overlay while preloading all 16 tiles */}
      {!ready && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 rounded-2xl bg-black/75 backdrop-blur-sm">
          <span className="h-10 w-10 animate-spin rounded-full border-4 border-cyan-300 border-t-transparent" />
          <p className="text-xs font-bold uppercase tracking-[0.25em] text-cyan-300">
            Loading {Object.keys(pieceSrcs).length}/{total} pieces…
          </p>
        </div>
      )}

      <div
        className="no-select grid w-full gap-[3px] rounded-2xl bg-black/40 p-[3px] shadow-[0_18px_60px_rgba(0,0,0,0.55)] ring-1 ring-white/10"
        style={{
          gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
          aspectRatio: "1 / 1",
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
              role="gridcell"
              aria-label={`Piece position ${slot + 1}`}
              disabled={!isInteractive}
              draggable={isInteractive}
              onDragStart={() => setDragSlot(slot)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (dragSlot !== null) requestSwap(dragSlot, slot);
                setDragSlot(null);
                setSelected(null);
              }}
              onClick={() => handleTap(slot)}
              className={`relative aspect-square overflow-hidden rounded-[7px] bg-slate-800/80 outline-none transition-transform duration-150 ${
                isSelected ? "piece-selected" : ""
              } ${isCorrect && ready ? "piece-correct" : ""} ${
                isAnimating ? "animate-swap" : ""
              } ${isInteractive ? "cursor-pointer" : "cursor-default"}`}
            >
              {src ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={src}
                  alt={`Tile ${pieceId}`}
                  draggable={false}
                  className="pointer-events-none h-full w-full object-cover"
                />
              ) : (
                <span className="shimmer absolute inset-0" />
              )}
              {isCorrect && ready && (
                <span className="absolute right-0.5 top-0.5 grid h-4 w-4 place-items-center rounded-full bg-emerald-400 text-[9px] font-black text-emerald-950">
                  ✓
                </span>
              )}
              {isSelected && (
                <span className="absolute inset-0 ring-2 ring-cyan-300/90" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
