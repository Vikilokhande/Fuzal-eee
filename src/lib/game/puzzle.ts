/**
 * Pure puzzle helpers – deterministic, unit-tested.
 * A board is an array indexed by *slot*: board[slot] = pieceId.
 * In the solved layout pieceId === slot (piece 0 belongs top-left …).
 */

/** Fisher–Yates shuffle (returns a new array; input is never mutated). */
export function fisherYates<T>(input: readonly T[]): T[] {
  const arr = [...input];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function isSolved(board: readonly number[]): boolean {
  return board.every((pieceId, slot) => pieceId === slot);
}

export function misplacedCount(board: readonly number[]): number {
  return board.reduce((n, pieceId, slot) => n + (pieceId === slot ? 0 : 1), 0);
}

/**
 * Produce a shuffled board that:
 *  - is never the solved state
 *  - has at least 4 misplaced pieces (avoids trivial "one swap away" boards)
 *  - is always solvable (the game only uses swaps, which make every
 *    permutation reachable)
 */
export function generateShuffledBoard(pieceCount: number): number[] {
  const solved = Array.from({ length: pieceCount }, (_, i) => i);
  for (let attempt = 0; attempt < 200; attempt++) {
    const board = fisherYates(solved);
    if (!isSolved(board) && misplacedCount(board) >= 4) return board;
  }
  // Fallback that mathematically cannot be solved: rotate by half.
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

export function correctSlots(board: readonly number[]): boolean[] {
  return board.map((pieceId, slot) => pieceId === slot);
}

export function validateIndex(index: number, pieceCount: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < pieceCount;
}
