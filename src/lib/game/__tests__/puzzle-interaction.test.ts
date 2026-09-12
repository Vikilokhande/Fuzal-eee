import { describe, it, expect, vi } from "vitest";
import { swapPieces, isSolved, correctSlots } from "../puzzle";

describe("Puzzle Interaction Engine — Tap & Drag Invariants", () => {
  const DRAG_THRESHOLD_PX = 8;
  const cols = 4;
  const rows = 4;
  const total = cols * rows;

  // Emulates getSlotAtCoords from PuzzleBoard
  function getSlotAtCoords(
    clientX: number,
    clientY: number,
    boardRect: { left: number; top: number; width: number; height: number },
  ): number | null {
    if (
      clientX < boardRect.left ||
      clientX > boardRect.left + boardRect.width ||
      clientY < boardRect.top ||
      clientY > boardRect.top + boardRect.height
    ) {
      return null;
    }
    const col = Math.floor(((clientX - boardRect.left) / boardRect.width) * cols);
    const row = Math.floor(((clientY - boardRect.top) / boardRect.height) * rows);
    if (col < 0 || col >= cols || row < 0 || row >= rows) return null;
    const slot = row * cols + col;
    return slot >= 0 && slot < total ? slot : null;
  }

  // Model representing PuzzleBoard's unified pointer event handler
  class TestBoardPointerEngine {
    selected: number | null = null;
    tracker: {
      startX: number;
      startY: number;
      currentX: number;
      currentY: number;
      startSlot: number;
      isDragging: boolean;
      hoverSlot: number | null;
    } | null = null;
    boardRect = { left: 100, top: 100, width: 400, height: 400 }; // 100px per cell
    swapCalls: Array<{ from: number; to: number }> = [];
    isLocked = false;

    // Helper: Slot center coordinate
    getSlotCenter(slot: number) {
      const col = slot % cols;
      const row = Math.floor(slot / cols);
      return {
        x: this.boardRect.left + col * 100 + 50,
        y: this.boardRect.top + row * 100 + 50,
      };
    }

    pointerDown(slot: number) {
      if (this.isLocked) return;
      const center = this.getSlotCenter(slot);
      this.tracker = {
        startX: center.x,
        startY: center.y,
        currentX: center.x,
        currentY: center.y,
        startSlot: slot,
        isDragging: false,
        hoverSlot: slot,
      };
    }

    pointerMove(x: number, y: number) {
      if (!this.tracker) return;
      this.tracker.currentX = x;
      this.tracker.currentY = y;

      const dist = Math.hypot(x - this.tracker.startX, y - this.tracker.startY);
      if (!this.tracker.isDragging && dist >= DRAG_THRESHOLD_PX) {
        this.tracker.isDragging = true;
        this.selected = null; // Clear tap selection
      }

      if (this.tracker.isDragging) {
        this.tracker.hoverSlot = getSlotAtCoords(x, y, this.boardRect);
        // CRITICAL INVARIANT: NEVER SWAP ON MOVE!
      }
    }

    pointerUp(x: number, y: number) {
      if (!this.tracker) return;
      const tracker = this.tracker;
      this.tracker = null;

      if (tracker.isDragging) {
        // Drag completed
        const targetSlot = getSlotAtCoords(x, y, this.boardRect);
        if (
          targetSlot !== null &&
          targetSlot !== tracker.startSlot &&
          targetSlot >= 0 &&
          targetSlot < total
        ) {
          this.executeSwap(tracker.startSlot, targetSlot);
        }
        this.selected = null;
      } else {
        // Tap completed
        const tapSlot = tracker.startSlot;
        if (this.selected === null) {
          this.selected = tapSlot;
        } else if (this.selected === tapSlot) {
          // Tapped same position twice: cancel selection
          this.selected = null;
        } else {
          // Tapped second piece: swap
          this.executeSwap(this.selected, tapSlot);
          this.selected = null;
        }
      }
    }

    pointerCancel() {
      this.tracker = null;
      this.selected = null;
    }

    executeSwap(a: number, b: number) {
      if (a === b || this.isLocked) return;
      this.isLocked = true;
      this.swapCalls.push({ from: a, to: b });
      setTimeout(() => {
        this.isLocked = false;
      }, 180);
    }
  }

  it("TAP-TO-SWAP: tap A → tap B executes exactly one swap", () => {
    const engine = new TestBoardPointerEngine();

    // Tap piece 2 (< 8px movement)
    engine.pointerDown(2);
    engine.pointerMove(engine.getSlotCenter(2).x + 2, engine.getSlotCenter(2).y + 1);
    engine.pointerUp(engine.getSlotCenter(2).x + 2, engine.getSlotCenter(2).y + 1);

    expect(engine.selected).toBe(2);
    expect(engine.swapCalls.length).toBe(0);

    // Tap piece 7 (< 8px movement)
    engine.pointerDown(7);
    engine.pointerUp(engine.getSlotCenter(7).x, engine.getSlotCenter(7).y);

    expect(engine.selected).toBeNull();
    expect(engine.swapCalls.length).toBe(1);
    expect(engine.swapCalls[0]).toEqual({ from: 2, to: 7 });
  });

  it("TAP: tapping the same slot twice cancels selection with zero moves", () => {
    const engine = new TestBoardPointerEngine();

    // Tap slot 5
    engine.pointerDown(5);
    engine.pointerUp(engine.getSlotCenter(5).x, engine.getSlotCenter(5).y);
    expect(engine.selected).toBe(5);

    // Tap slot 5 again
    engine.pointerDown(5);
    engine.pointerUp(engine.getSlotCenter(5).x, engine.getSlotCenter(5).y);
    expect(engine.selected).toBeNull();
    expect(engine.swapCalls.length).toBe(0);
  });

  it("DRAG-AND-DROP: dragging A across multiple slots to B swaps ONLY A and B upon release", () => {
    const engine = new TestBoardPointerEngine();

    // Start drag at slot 0
    engine.pointerDown(0);

    // Drag across slots 1, 2, 6, 10
    const slot1 = engine.getSlotCenter(1);
    engine.pointerMove(slot1.x, slot1.y);
    expect(engine.tracker?.isDragging).toBe(true);
    expect(engine.tracker?.hoverSlot).toBe(1);
    expect(engine.swapCalls.length).toBe(0); // NO INTERMEDIATE SWAP!

    const slot6 = engine.getSlotCenter(6);
    engine.pointerMove(slot6.x, slot6.y);
    expect(engine.tracker?.hoverSlot).toBe(6);
    expect(engine.swapCalls.length).toBe(0); // NO INTERMEDIATE SWAP!

    const slot10 = engine.getSlotCenter(10);
    engine.pointerMove(slot10.x, slot10.y);
    expect(engine.tracker?.hoverSlot).toBe(10);
    expect(engine.swapCalls.length).toBe(0); // NO INTERMEDIATE SWAP!

    // Release at slot 10
    engine.pointerUp(slot10.x, slot10.y);

    expect(engine.swapCalls.length).toBe(1);
    expect(engine.swapCalls[0]).toEqual({ from: 0, to: 10 });
    expect(engine.selected).toBeNull();
  });

  it("DRAG: dropping outside the board cancels the drag with zero swaps", () => {
    const engine = new TestBoardPointerEngine();

    engine.pointerDown(3);
    // Drag way outside the board
    engine.pointerMove(50, 50);
    expect(engine.tracker?.isDragging).toBe(true);
    expect(engine.tracker?.hoverSlot).toBeNull();

    // Release outside
    engine.pointerUp(50, 50);

    expect(engine.swapCalls.length).toBe(0);
    expect(engine.selected).toBeNull();
  });

  it("DRAG: dragging and releasing back on origin slot cancels with zero swaps", () => {
    const engine = new TestBoardPointerEngine();

    engine.pointerDown(4);
    engine.pointerMove(engine.getSlotCenter(8).x, engine.getSlotCenter(8).y);
    expect(engine.tracker?.isDragging).toBe(true);

    // Move back to origin slot 4
    const slot4 = engine.getSlotCenter(4);
    engine.pointerMove(slot4.x, slot4.y);
    engine.pointerUp(slot4.x, slot4.y);

    expect(engine.swapCalls.length).toBe(0);
  });

  it("Distinguishes TAP vs DRAG using movement threshold", () => {
    const engine = new TestBoardPointerEngine();

    // 5px movement (< 8px threshold): Classified as TAP
    engine.pointerDown(1);
    engine.pointerMove(engine.getSlotCenter(1).x + 4, engine.getSlotCenter(1).y + 3); // dist = 5
    expect(engine.tracker?.isDragging).toBe(false);
    engine.pointerUp(engine.getSlotCenter(1).x + 4, engine.getSlotCenter(1).y + 3);
    expect(engine.selected).toBe(1); // Selection registered

    // 10px movement (>= 8px threshold): Classified as DRAG
    engine.pointerDown(2);
    engine.pointerMove(engine.getSlotCenter(2).x + 6, engine.getSlotCenter(2).y + 8); // dist = 10
    expect(engine.tracker?.isDragging).toBe(true);
    expect(engine.selected).toBeNull(); // Tap selection was cleared
  });

  it("Mutates logical board accurately when swap is executed", () => {
    const initial = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    const swapped = swapPieces(initial, 3, 12);
    expect(swapped[3]).toBe(12);
    expect(swapped[12]).toBe(3);
    expect(swapped[0]).toBe(0);
    expect(swapped.length).toBe(16);
  });
});
