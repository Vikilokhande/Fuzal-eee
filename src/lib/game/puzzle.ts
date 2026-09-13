/**
 * Canonical Puzzle Helpers & Solved-Position Mapping
 * --------------------------------------------------
 * Every tile has a permanent, stable, unique integer `pieceId` (0..15).
 * The grid has 16 slots indexed 0..15 (left-to-right, top-to-bottom).
 *
 * Explicit mapping:
 *   pieceId → correctPosition (slot 0..15)
 *
 * In a standard 4x4 grid:
 *   Tile 0  → Slot 0 (Row 0, Col 0)
 *   Tile 1  → Slot 1 (Row 0, Col 1)
 *   ...
 *   Tile 15 → Slot 15 (Row 3, Col 3)
 *
 * Solved state is determined solely by:
 *   Every slot s in 0..15 contains pieceId p where getCorrectPositionForPiece(p) === s.
 * Completion is NEVER based on image URL order, visual appearance, number of moves,
 * or temporary drag state.
 */

/** Normalizes any piece ID representation (number, single-digit string, or zero-padded string) to integer 0..15 */
export function normalizePieceId(raw: number | string): number {
  const num = typeof raw === "number" ? raw : parseInt(String(raw), 10);
  if (!Number.isInteger(num)) {
    throw new Error(`Invalid pieceId: ${raw}`);
  }
  return num;
}

/** Formats a piece ID into a two-digit storage filename prefix ("00".."15") */
export function pieceIdToStorageKey(pieceId: number | string): string {
  return String(normalizePieceId(pieceId)).padStart(2, "0");
}

/** Parses a storage filename ("00.webp" -> 0, "15.webp" -> 15) into a pieceId */
export function storageKeyToPieceId(filename: string): number {
  const match = filename.match(/^(\d{1,2})/);
  if (!match) throw new Error(`Invalid piece storage filename: ${filename}`);
  return parseInt(match[1], 10);
}

/**
 * Solved-position mapping:
 * Returns the exact target slot index where pieceId belongs in the solved puzzle.
 */
export function getCorrectPositionForPiece(pieceId: number | string): number {
  return normalizePieceId(pieceId);
}

/**
 * Returns true if and only if the piece currently at currentSlot belongs in that slot.
 */
export function isPieceCorrectAtSlot(pieceId: number | string, currentSlot: number): boolean {
  return getCorrectPositionForPiece(pieceId) === currentSlot;
}

/**
 * Recalculates correctness for every slot on the board.
 * Returns boolean[] indexed by slot: true iff board[slot] is placed correctly.
 */
export function correctSlots(board: readonly number[]): boolean[] {
  return board.map((pieceId, slot) => isPieceCorrectAtSlot(pieceId, slot));
}

/**
 * Evaluates whether ALL positions on the board match the solved mapping.
 * Verifies:
 *   1. Board is an array of exactly pieceCount elements.
 *   2. All 16 unique piece IDs (0..pieceCount-1) are present with no duplicates.
 *   3. Every slot s satisfies getCorrectPositionForPiece(board[s]) === s.
 */
export function isSolved(board: readonly number[], pieceCount?: number): boolean {
  if (!Array.isArray(board) || board.length === 0) {
    return false;
  }
  const count = pieceCount ?? board.length;
  if (board.length !== count) {
    return false;
  }
  const seen = new Set<number>();
  for (let slot = 0; slot < count; slot++) {
    const pieceId = normalizePieceId(board[slot]);
    if (pieceId < 0 || pieceId >= count || seen.has(pieceId)) {
      return false; // Duplicate or out-of-range piece
    }
    seen.add(pieceId);
    if (!isPieceCorrectAtSlot(pieceId, slot)) {
      return false;
    }
  }
  return seen.size === count;
}

export function misplacedCount(board: readonly number[]): number {
  return board.reduce(
    (n, pieceId, slot) => n + (isPieceCorrectAtSlot(pieceId, slot) ? 0 : 1),
    0,
  );
}

/** Fisher–Yates shuffle (returns a new array; input is never mutated). */
export function fisherYates<T>(input: readonly T[]): T[] {
  const arr = [...input];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Produce a shuffled board that:
 *  - is never the solved state
 *  - has at least 4 misplaced pieces (avoids trivial "one swap away" boards)
 *  - is always solvable
 */
export function generateShuffledBoard(pieceCount: number): number[] {
  const solved = Array.from({ length: pieceCount }, (_, i) => i);
  for (let attempt = 0; attempt < 200; attempt++) {
    const board = fisherYates(solved);
    if (!isSolved(board, pieceCount) && misplacedCount(board) >= 4) return board;
  }
  // Fallback: rotate by half
  return solved.map((_, i) => (i + pieceCount / 2) % pieceCount);
}

export function swapPieces(
  board: readonly number[],
  from: number,
  to: number,
): number[] {
  const next = [...board];
  const tmp = next[from];
  next[from] = next[to];
  next[to] = tmp;
  return next;
}

export function validateIndex(index: number, pieceCount: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < pieceCount;
}
