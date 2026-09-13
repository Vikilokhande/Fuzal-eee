import { describe, it, expect } from "vitest";
import {
  fisherYates,
  isSolved,
  misplacedCount,
  generateShuffledBoard,
  swapPieces,
  correctSlots,
  validateIndex,
  normalizePieceId,
  pieceIdToStorageKey,
  storageKeyToPieceId,
  getCorrectPositionForPiece,
  isPieceCorrectAtSlot,
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

  describe("stable piece identity & normalization (0-15 vs 00-15)", () => {
    it("normalizes piece IDs from numeric or string/padded forms", () => {
      expect(normalizePieceId(0)).toBe(0);
      expect(normalizePieceId("0")).toBe(0);
      expect(normalizePieceId("00")).toBe(0);
      expect(normalizePieceId(9)).toBe(9);
      expect(normalizePieceId("09")).toBe(9);
      expect(normalizePieceId(15)).toBe(15);
      expect(normalizePieceId("15")).toBe(15);
      expect(() => normalizePieceId("invalid")).toThrow();
    });

    it("converts between piece IDs and storage keys accurately", () => {
      expect(pieceIdToStorageKey(0)).toBe("00");
      expect(pieceIdToStorageKey("0")).toBe("00");
      expect(pieceIdToStorageKey(9)).toBe("09");
      expect(pieceIdToStorageKey(15)).toBe("15");

      expect(storageKeyToPieceId("00.webp")).toBe(0);
      expect(storageKeyToPieceId("07.webp")).toBe(7);
      expect(storageKeyToPieceId("15.webp")).toBe(15);
    });

    it("preserves canonical pieceId -> correctPosition mapping", () => {
      for (let i = 0; i < 16; i++) {
        expect(getCorrectPositionForPiece(i)).toBe(i);
        expect(isPieceCorrectAtSlot(i, i)).toBe(true);
        expect(isPieceCorrectAtSlot(i, (i + 1) % 16)).toBe(false);
      }
    });

    it("isSolved validates ALL 16 positions and rejects duplicates or invalid lengths", () => {
      const solved16 = Array.from({ length: 16 }, (_, i) => i);
      expect(isSolved(solved16, 16)).toBe(true);

      // Rejects wrong length
      expect(isSolved(Array.from({ length: 15 }, (_, i) => i), 16)).toBe(false);
      expect(isSolved(Array.from({ length: 17 }, (_, i) => i), 16)).toBe(false);

      // Rejects duplicate piece even if 15 positions match
      const withDuplicate = [...solved16];
      withDuplicate[15] = 0; // two 0s, missing 15
      expect(isSolved(withDuplicate, 16)).toBe(false);

      // Rejects out-of-bound piece ID
      const outOfBounds = [...solved16];
      outOfBounds[0] = 99;
      expect(isSolved(outOfBounds, 16)).toBe(false);

      // One swap away is not solved
      const oneSwap = swapPieces(solved16, 0, 1);
      expect(isSolved(oneSwap, 16)).toBe(false);
    });
  });
});
