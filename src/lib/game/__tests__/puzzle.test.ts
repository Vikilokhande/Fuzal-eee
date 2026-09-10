import { describe, it, expect } from "vitest";
import {
  fisherYates,
  isSolved,
  misplacedCount,
  generateShuffledBoard,
  swapPieces,
  correctSlots,
  validateIndex,
} from "../puzzle";

describe("puzzle helpers", () => {
  it("detects the solved layout", () => {
    expect(isSolved([0, 1, 2, 3])).toBe(true);
    expect(isSolved([1, 0, 2, 3])).toBe(false);
  });

  it("counts misplaced pieces", () => {
    expect(misplacedCount([0, 1, 2, 3])).toBe(0);
    expect(misplacedCount([1, 0, 2, 3])).toBe(2);
  });

  it("fisher-yates preserves multiset", () => {
    const input = [1, 2, 3, 4, 5];
    const out = fisherYates(input);
    expect(out.slice().sort()).toEqual(input.slice().sort());
    expect(input).toEqual([1, 2, 3, 4, 5]); // never mutates input
  });

  it("never generates a solved or trivial board", () => {
    for (let i = 0; i < 500; i++) {
      const board = generateShuffledBoard(16);
      expect(board).toHaveLength(16);
      expect(isSolved(board)).toBe(false);
      expect(misplacedCount(board)).toBeGreaterThanOrEqual(4);
      expect(board.slice().sort((a, b) => a - b)).toEqual(
        Array.from({ length: 16 }, (_, i) => i),
      );
    }
  });

  it("swaps pieces immutably", () => {
    const board = [0, 1, 2, 3];
    const next = swapPieces(board, 0, 3);
    expect(next).toEqual([3, 1, 2, 0]);
    expect(board).toEqual([0, 1, 2, 3]);
  });

  it("reports correct slots", () => {
    expect(correctSlots([0, 2, 1, 3])).toEqual([true, false, false, true]);
  });

  it("validates indexes", () => {
    expect(validateIndex(0, 16)).toBe(true);
    expect(validateIndex(15, 16)).toBe(true);
    expect(validateIndex(16, 16)).toBe(false);
    expect(validateIndex(-1, 16)).toBe(false);
    expect(validateIndex(1.5, 16)).toBe(false);
  });
});
