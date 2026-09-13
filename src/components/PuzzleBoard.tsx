"use client";

import React, { useEffect, useRef, useState } from "react";
import { isPieceCorrectAtSlot } from "@/lib/game/puzzle";

/**
 * Mobile-first puzzle board with unified pointer event engine.
 * Supports both:
 *   1. TAP-TO-SWAP: Tap piece A (selected) → tap piece B → swaps A and B.
 *      Tapping piece A a second time deselects piece A.
 *   2. DRAG-AND-DROP: Touch piece A → drag across grid → release on position B → swaps A and B.
 *      During drag, NO intermediate swaps ever occur.
 *      Dropping outside the board cancels the drag without swapping.
 *
 * Distinguishes TAP vs DRAG using an 8px movement threshold.
 * Prevents synthetic click double-triggers, native browser image dragging,
 * and image stretching/warping.
 */
const DRAG_THRESHOLD_PX = 8;

export function PuzzleBoard({
  board,
  cols,
  rows,
  pieceCount,
  loadedCount,
  pieceSrcs,
  interactive = true,
  completed = false,
  loading = false,
  error = null,
  onRetry,
  onSwap,
}: {
  board: number[];
  cols: number;
  rows: number;
  pieceCount?: number;
  loadedCount?: number;
  pieceSrcs: Record<number, string>;
  interactive?: boolean;
  completed?: boolean;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onSwap: (from: number, to: number) => void;
}) {
  const boardRef = useRef<HTMLDivElement | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [animSlots, setAnimSlots] = useState<number[]>([]);
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);
  const previous = useRef<number[]>(board);
  const animTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Active visual drag state for rendering the floating avatar and target hover
  const [dragVisual, setDragVisual] = useState<{
    startSlot: number;
    pointerId: number;
    currentX: number;
    currentY: number;
    hoverSlot: number | null;
    pieceSize: number;
  } | null>(null);

  // Pointer tracking ref for synchronous, accurate gesture evaluation
  const pointerTracker = useRef<{
    pointerId: number;
    startSlot: number;
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
    isDragging: boolean;
    hoverSlot: number | null;
    cellRect: DOMRect | null;
  } | null>(null);

  // Mutex lock to prevent duplicate swaps from rapid tap or synthetic events
  const swapLockRef = useRef(false);

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

  useEffect(() => {
    const update = () => setViewportHeight(window.innerHeight);
    update();
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    return () => {
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
    };
  }, []);

  const total = pieceCount ?? cols * rows;
  const boardValid =
    board.length === total &&
    new Set(board).size === total &&
    board.every((pieceId) => Number.isInteger(pieceId) && pieceId >= 0 && pieceId < total);
  const loadedRequired = board.reduce(
    (count, pieceId) => count + (pieceId >= 0 && pieceId < total && pieceSrcs[pieceId] ? 1 : 0),
    0,
  );
  const displayLoaded = loadedCount ?? loadedRequired;
  const ready = boardValid && loadedRequired >= total && !loading;
  const isInteractive = interactive && ready && !completed;
  const aspectRatio = `${cols} / ${rows}`;
  const maxBoardWidth =
    viewportHeight === null
      ? 520
      : Math.max(230, Math.min(520, Math.floor((viewportHeight - 230) * (cols / rows))));

  // Clear any active drag or selection state once the puzzle is completed
  useEffect(() => {
    if (completed) {
      setSelected(null);
      setDragVisual(null);
      pointerTracker.current = null;
    }
  }, [completed]);

  /** Calculates grid slot from screen client coordinates */
  const getSlotAtCoords = (clientX: number, clientY: number): number | null => {
    if (!boardRef.current) return null;
    const rect = boardRef.current.getBoundingClientRect();
    if (
      clientX < rect.left ||
      clientX > rect.right ||
      clientY < rect.top ||
      clientY > rect.bottom
    ) {
      return null;
    }
    const col = Math.floor(((clientX - rect.left) / rect.width) * cols);
    const row = Math.floor(((clientY - rect.top) / rect.height) * rows);
    if (col < 0 || col >= cols || row < 0 || row >= rows) return null;
    const slot = row * cols + col;
    return slot >= 0 && slot < total ? slot : null;
  };

  /** Dispatches exactly one swap and locks briefly against synthetic double-triggers */
  const executeSwap = (a: number, b: number) => {
    if (!isInteractive || a === b || swapLockRef.current) return;
    swapLockRef.current = true;
    setTimeout(() => {
      swapLockRef.current = false;
    }, 180);

    onSwap(a, b);
  };

  /* ---------------- Unified Pointer Handlers ---------------- */

  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>, slot: number) => {
    if (!isInteractive || e.button !== 0 || swapLockRef.current) return;

    const target = e.currentTarget;
    try {
      target.setPointerCapture(e.pointerId);
    } catch {}

    const cellRect = target.getBoundingClientRect();

    pointerTracker.current = {
      pointerId: e.pointerId,
      startSlot: slot,
      startX: e.clientX,
      startY: e.clientY,
      currentX: e.clientX,
      currentY: e.clientY,
      isDragging: false,
      hoverSlot: slot,
      cellRect,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const tracker = pointerTracker.current;
    if (!tracker || tracker.pointerId !== e.pointerId) return;

    tracker.currentX = e.clientX;
    tracker.currentY = e.clientY;

    const dx = e.clientX - tracker.startX;
    const dy = e.clientY - tracker.startY;
    const dist = Math.hypot(dx, dy);

    if (!tracker.isDragging && dist >= DRAG_THRESHOLD_PX) {
      tracker.isDragging = true;
      // Drag started: clear tap selection so gestures do not conflict
      setSelected(null);
    }

    if (tracker.isDragging) {
      const hover = getSlotAtCoords(e.clientX, e.clientY);
      tracker.hoverSlot = hover;

      // Update visual drag position.
      // NOTE: Logical board state is NEVER mutated during move!
      setDragVisual({
        startSlot: tracker.startSlot,
        pointerId: tracker.pointerId,
        currentX: e.clientX,
        currentY: e.clientY,
        hoverSlot: hover,
        pieceSize: tracker.cellRect?.width ?? 80,
      });
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const tracker = pointerTracker.current;
    const target = e.currentTarget;
    try {
      target.releasePointerCapture(e.pointerId);
    } catch {}

    if (!tracker || tracker.pointerId !== e.pointerId) return;

    // Clear trackers immediately
    pointerTracker.current = null;
    setDragVisual(null);

    if (tracker.isDragging) {
      // ---------- DRAG GESTURE COMPLETED ----------
      const targetSlot = getSlotAtCoords(e.clientX, e.clientY);

      if (
        targetSlot !== null &&
        targetSlot !== tracker.startSlot &&
        targetSlot >= 0 &&
        targetSlot < total
      ) {
        // Valid drop on different position: swap exactly once
        executeSwap(tracker.startSlot, targetSlot);
        setSelected(null);
        if (typeof navigator !== "undefined" && navigator.vibrate) {
          navigator.vibrate(24);
        }
      } else {
        // Dropped outside board or back on startSlot: cancel drag with zero moves
        setSelected(null);
      }
    } else {
      // ---------- TAP GESTURE COMPLETED (Movement < 8px) ----------
      const tapSlot = tracker.startSlot;
      if (selected === null) {
        // Tap piece A: becomes selected
        setSelected(tapSlot);
        if (typeof navigator !== "undefined" && navigator.vibrate) {
          navigator.vibrate(12);
        }
      } else if (selected === tapSlot) {
        // Tapping same position twice: cancel selection with no move
        setSelected(null);
      } else {
        // Tap position B: swap selected piece and B exactly once
        executeSwap(selected, tapSlot);
        setSelected(null);
        if (typeof navigator !== "undefined" && navigator.vibrate) {
          navigator.vibrate(24);
        }
      }
    }
  };

  const handlePointerCancel = (e: React.PointerEvent<HTMLButtonElement>) => {
    const tracker = pointerTracker.current;
    const target = e.currentTarget;
    try {
      target.releasePointerCapture(e.pointerId);
    } catch {}

    if (tracker && tracker.pointerId === e.pointerId) {
      pointerTracker.current = null;
      setDragVisual(null);
      setSelected(null);
    }
  };

  if (error) {
    return (
      <div
        className="glass flex w-full flex-col items-center justify-center gap-4 rounded-2xl p-8 text-center shadow-2xl ring-1 ring-rose-500/30"
        style={{
          aspectRatio,
          maxWidth: `min(94vw, ${maxBoardWidth}px)`,
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
    <div
      className="relative mx-auto w-full select-none"
      style={{
        aspectRatio,
        maxWidth: `min(94vw, ${maxBoardWidth}px)`,
      }}
    >
      {/* Loading overlay while preloading tiles */}
      {!ready && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 rounded-2xl bg-black/75 backdrop-blur-sm">
          <span className="h-10 w-10 animate-spin rounded-full border-4 border-cyan-300 border-t-transparent" />
          <p className="text-xs font-bold uppercase tracking-[0.25em] text-cyan-300">
            Loading {Math.min(displayLoaded, total)}/{total} pieces...
          </p>
        </div>
      )}

      {/* Grid container: touch-action none prevents native page scroll during touch interaction */}
      <div
        ref={boardRef}
        className="no-select grid w-full gap-[2px] sm:gap-[3px] rounded-2xl bg-black/40 p-[2px] sm:p-[3px] shadow-[0_18px_60px_rgba(0,0,0,0.55)] ring-1 ring-white/10"
        style={{
          gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
          aspectRatio,
          touchAction: "none",
        }}
        role="grid"
        aria-label="Puzzle board"
      >
        {board.map((pieceId, slot) => {
          const isCorrect = isPieceCorrectAtSlot(pieceId, slot);
          const src = pieceSrcs[pieceId];
          const isSelected = selected === slot;
          const isAnimating = animSlots.includes(slot);
          const isDragOrigin = dragVisual?.startSlot === slot;
          const isDragHover =
            dragVisual?.hoverSlot === slot && dragVisual?.startSlot !== slot;

          return (
            <button
              key={slot}
              type="button"
              role="gridcell"
              aria-label={`Piece position ${slot + 1}`}
              disabled={!isInteractive}
              onPointerDown={(e) => handlePointerDown(e, slot)}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerCancel}
              onClick={(e) => {
                // Prevent synthetic click from firing secondary swaps
                e.preventDefault();
                e.stopPropagation();
              }}
              style={{ touchAction: "none" }}
              className={`relative aspect-square overflow-hidden rounded-[7px] bg-slate-800/80 outline-none transition-all duration-100 ${
                isSelected
                  ? "ring-2 ring-cyan-400 shadow-[0_0_14px_rgba(34,211,238,0.75)] scale-[0.96] z-10"
                  : ""
              } ${isCorrect && ready && !isSelected ? "ring-1 ring-emerald-500/40" : ""} ${
                isDragHover ? "ring-2 ring-cyan-300 bg-cyan-500/20 z-10" : ""
              } ${isDragOrigin ? "opacity-30 scale-[0.95]" : ""} ${
                isAnimating ? "animate-swap" : ""
              } ${isInteractive ? "cursor-pointer" : "cursor-default"}`}
            >
              {src ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={src}
                  alt={`Tile ${pieceId}`}
                  loading="eager"
                  decoding="async"
                  draggable={false}
                  className="pointer-events-none select-none no-drag h-full w-full object-cover"
                />
              ) : (
                <span className="shimmer absolute inset-0" />
              )}
              {isCorrect && ready && !isDragOrigin && (
                <span className="absolute right-0.5 top-0.5 grid h-4 w-4 place-items-center rounded-full bg-emerald-400 text-[9px] font-black text-emerald-950 shadow">
                  ✓
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Floating drag avatar following finger/pointer during drag */}
      {dragVisual && dragVisual.startSlot !== null && pieceSrcs[board[dragVisual.startSlot]] && (
        <div
          className="pointer-events-none fixed z-50 overflow-hidden rounded-[7px] shadow-[0_10px_35px_rgba(0,0,0,0.85)] ring-2 ring-cyan-400 no-drag"
          style={{
            width: dragVisual.pieceSize,
            height: dragVisual.pieceSize,
            left: dragVisual.currentX - dragVisual.pieceSize / 2,
            top: dragVisual.currentY - dragVisual.pieceSize / 2,
            transform: "scale(1.06)",
            touchAction: "none",
            userSelect: "none",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={pieceSrcs[board[dragVisual.startSlot]]}
            alt="Dragging piece"
            draggable={false}
            className="pointer-events-none h-full w-full select-none no-drag object-cover"
          />
        </div>
      )}
    </div>
  );
}
