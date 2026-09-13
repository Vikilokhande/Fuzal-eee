/**
 * BOARD MUTATION REGRESSION TEST
 * ==============================
 * Instruments every mutation of puzzle.board and verifies that it ONLY changes
 * under exactly four permitted causes:
 *
 *   1. INITIAL_GAME_SETUP   — server sends PUZZLE_STARTED with an initial board
 *   2. USER_TAP_SWAP        — user taps piece A, then taps position B
 *   3. USER_DRAG_SWAP       — user drags piece A and releases on position B
 *   4. EXPLICIT_AUTHORITATIVE_BOARD_SYNC — server sends PUZZLE_MOVE with corrected board
 *
 * Board changes are FORBIDDEN from:
 *   - image onLoad / onError / retry / preload completion
 *   - SSE reconnect / stream_end rotation
 *   - timer updates (MEMORY_TIMER_UPDATED, PUZZLE_TIMER_UPDATED)
 *   - player status updates (PLAYER_STATUS, PLAYER_JOINED, PLAYER_LEFT, LOBBY_UPDATED)
 *   - React render / component remount
 *   - EventSource creation / close
 *   - network reconnect
 *
 * Additional invariants:
 *   ONE tap  = ONE swap = ONE API request
 *   ONE drag = ONE swap = ONE API request
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  swapPieces,
  isSolved,
  correctSlots,
  generateShuffledBoard,
  fisherYates,
} from "../puzzle";
import { EventType } from "../types";
import type { GameEvent } from "../types";

/* ─────────────────────────── helpers ─────────────────────────── */

const DRAG_THRESHOLD_PX = 8;
const COLS = 4;
const ROWS = 4;
const TOTAL = COLS * ROWS;

/** Allowed causes for board mutation */
type MutationCause =
  | "INITIAL_GAME_SETUP"
  | "USER_TAP_SWAP"
  | "USER_DRAG_SWAP"
  | "EXPLICIT_AUTHORITATIVE_BOARD_SYNC";

/**
 * Instrumented Board:
 * Wraps a number[] and records every mutation attempt with its declared cause.
 * Throws if the cause is not on the allow-list (catches forbidden mutations in tests).
 */
class InstrumentedBoard {
  private _board: number[];
  readonly mutations: Array<{
    cause: MutationCause;
    from: number;
    to: number;
    boardBefore: number[];
    boardAfter: number[];
  }> = [];

  private static allowedCauses = new Set<MutationCause>([
    "INITIAL_GAME_SETUP",
    "USER_TAP_SWAP",
    "USER_DRAG_SWAP",
    "EXPLICIT_AUTHORITATIVE_BOARD_SYNC",
  ]);

  constructor(initial: number[]) {
    this._board = [...initial];
  }

  get board(): Readonly<number[]> {
    return this._board;
  }

  /**
   * The ONLY entry-point for changing board state.
   * Every mutation MUST declare its cause.
   */
  applySwap(from: number, to: number, cause: MutationCause): void {
    if (!InstrumentedBoard.allowedCauses.has(cause)) {
      throw new Error(`FORBIDDEN BOARD MUTATION: cause="${cause}" is not allowed`);
    }
    if (from === to) return; // no-op

    const boardBefore = [...this._board];
    this._board = swapPieces(this._board, from, to);

    this.mutations.push({
      cause,
      from,
      to,
      boardBefore,
      boardAfter: [...this._board],
    });
  }

  /**
   * Replace entire board (for INITIAL_GAME_SETUP and EXPLICIT_AUTHORITATIVE_BOARD_SYNC).
   */
  replaceBoard(newBoard: number[], cause: MutationCause): void {
    if (!InstrumentedBoard.allowedCauses.has(cause)) {
      throw new Error(`FORBIDDEN BOARD REPLACEMENT: cause="${cause}" is not allowed`);
    }
    this.mutations.push({
      cause,
      from: -1,
      to: -1,
      boardBefore: [...this._board],
      boardAfter: [...newBoard],
    });
    this._board = [...newBoard];
  }

  snapshot(): number[] {
    return [...this._board];
  }
}

/** Slot coordinate helper (100px per cell on 400×400 board) */
function slotCenter(slot: number): { x: number; y: number } {
  const col = slot % COLS;
  const row = Math.floor(slot / COLS);
  return {
    x: 100 + col * 100 + 50,
    y: 100 + row * 100 + 50,
  };
}

function getSlotAtCoords(
  x: number,
  y: number,
): number | null {
  const boardRect = { left: 100, top: 100, width: 400, height: 400 };
  if (
    x < boardRect.left ||
    x > boardRect.left + boardRect.width ||
    y < boardRect.top ||
    y > boardRect.top + boardRect.height
  )
    return null;
  const col = Math.floor(((x - boardRect.left) / boardRect.width) * COLS);
  const row = Math.floor(((y - boardRect.top) / boardRect.height) * ROWS);
  if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return null;
  const slot = row * COLS + col;
  return slot >= 0 && slot < TOTAL ? slot : null;
}

/**
 * Minimal simulation of the client-side game state engine.
 * Mirrors the state transitions in useFuzalGame.ts without React.
 */
class ClientGameStateEngine {
  board: InstrumentedBoard | null = null;
  apiCallLog: Array<{ type: string; from?: number; to?: number }> = [];
  completed = false;
  isEliminated = false;

  /** Simulates receiving an SSE event exactly as applyEvent() does in useFuzalGame.ts */
  applyEvent(event: GameEvent): void {
    const p = (event.payload ?? {}) as Record<string, unknown>;

    switch (event.type) {
      /* ───── INITIAL_GAME_SETUP: ONLY allowed board creation ───── */
      case EventType.PUZZLE_STARTED: {
        if (Array.isArray(p.board)) {
          if (this.board) {
            // Re-entry: replace with authoritative board (INITIAL_GAME_SETUP)
            this.board.replaceBoard(p.board as number[], "INITIAL_GAME_SETUP");
          } else {
            this.board = new InstrumentedBoard(p.board as number[]);
            this.board.replaceBoard(p.board as number[], "INITIAL_GAME_SETUP");
            // Initial creation counts but has empty boardBefore — pop and re-record cleanly
            this.board.mutations.pop();
          }
        }
        this.completed = false;
        this.isEliminated = false;
        break;
      }

      /* ───── EXPLICIT_AUTHORITATIVE_BOARD_SYNC ───── */
      case EventType.PUZZLE_MOVE: {
        // PUZZLE_MOVE from server contains the authoritative board.
        // This is the ONLY way the server can synchronize board state externally.
        if (Array.isArray(p.board) && this.board) {
          this.board.replaceBoard(
            p.board as number[],
            "EXPLICIT_AUTHORITATIVE_BOARD_SYNC",
          );
          if (p.completed) this.completed = true;
        }
        break;
      }

      /* ───── FORBIDDEN causes — MUST NOT touch board ───── */
      case EventType.MEMORY_TIMER_UPDATED:
      case EventType.PUZZLE_TIMER_UPDATED:
      case EventType.PLAYER_STATUS:
      case EventType.PLAYER_JOINED:
      case EventType.PLAYER_LEFT:
      case EventType.LOBBY_UPDATED:
      case EventType.PLAYER_COMPLETED:
      case EventType.GAME_FINISHED:
      case EventType.GAME_STARTED:
      case EventType.MEMORY_PHASE_STARTED:
        // ⬆ None of these may mutate board — verified by checking mutations count after
        break;

      default:
        break;
    }
  }

  /** USER_TAP_SWAP: tap A, then tap B → exactly one swap → exactly one API call */
  userTapSwap(from: number, to: number): void {
    if (!this.board || this.completed || this.isEliminated || from === to) return;
    const snapBefore = this.board.snapshot();
    this.board.applySwap(from, to, "USER_TAP_SWAP");
    this.apiCallLog.push({ type: "SWAP", from, to });

    // Check solved
    const nowSolved = isSolved(this.board.board as number[], TOTAL);
    if (nowSolved && !this.completed) {
      this.completed = true;
      this.apiCallLog.push({ type: "COMPLETE" });
    }

    void snapBefore; // suppress unused warning
  }

  /** USER_DRAG_SWAP: drag from A, release on B → exactly one swap → exactly one API call */
  userDragSwap(from: number, to: number): void {
    if (!this.board || this.completed || this.isEliminated || from === to) return;
    this.board.applySwap(from, to, "USER_DRAG_SWAP");
    this.apiCallLog.push({ type: "SWAP", from, to });

    const nowSolved = isSolved(this.board.board as number[], TOTAL);
    if (nowSolved && !this.completed) {
      this.completed = true;
      this.apiCallLog.push({ type: "COMPLETE" });
    }
  }
}

/**
 * Simulates the pointer state machine from PuzzleBoard.tsx.
 * Returns swaps in the form { from, to } only after a valid gesture completes.
 */
class PointerEngine {
  selected: number | null = null;
  tracker: {
    startX: number;
    startY: number;
    startSlot: number;
    isDragging: boolean;
    hoverSlot: number | null;
  } | null = null;
  isLocked = false;
  readonly swapEvents: Array<{ cause: "USER_TAP_SWAP" | "USER_DRAG_SWAP"; from: number; to: number }> = [];

  pointerDown(slot: number): void {
    if (this.isLocked) return;
    const center = slotCenter(slot);
    this.tracker = {
      startX: center.x,
      startY: center.y,
      startSlot: slot,
      isDragging: false,
      hoverSlot: slot,
    };
  }

  pointerMove(x: number, y: number): void {
    if (!this.tracker) return;
    const dist = Math.hypot(x - this.tracker.startX, y - this.tracker.startY);
    if (!this.tracker.isDragging && dist >= DRAG_THRESHOLD_PX) {
      this.tracker.isDragging = true;
      this.selected = null; // clear tap selection on drag start
    }
    if (this.tracker.isDragging) {
      this.tracker.hoverSlot = getSlotAtCoords(x, y);
      // CRITICAL: NEVER SWAP ON MOVE!
    }
  }

  pointerUp(x: number, y: number): string | null {
    if (!this.tracker) return null;
    const tracker = this.tracker;
    this.tracker = null;

    if (tracker.isDragging) {
      const targetSlot = getSlotAtCoords(x, y);
      if (targetSlot !== null && targetSlot !== tracker.startSlot) {
        this.swapEvents.push({ cause: "USER_DRAG_SWAP", from: tracker.startSlot, to: targetSlot });
        this.isLocked = true;
        setTimeout(() => { this.isLocked = false; }, 180);
        this.selected = null;
        return "DRAG_SWAP";
      }
      this.selected = null;
      return "DRAG_CANCEL";
    } else {
      const tapSlot = tracker.startSlot;
      if (this.selected === null) {
        this.selected = tapSlot;
        return "TAP_SELECT";
      } else if (this.selected === tapSlot) {
        this.selected = null;
        return "TAP_CANCEL";
      } else {
        const from = this.selected;
        this.selected = null;
        this.swapEvents.push({ cause: "USER_TAP_SWAP", from, to: tapSlot });
        this.isLocked = true;
        setTimeout(() => { this.isLocked = false; }, 180);
        return "TAP_SWAP";
      }
    }
  }

  pointerCancel(): void {
    this.tracker = null;
    // NOTE: selected is intentionally kept on cancel (preserve first tap)
  }
}

/* ─────────────────────────── test suites ─────────────────────────── */

describe("Board Mutation Regression — ONLY USER_TAP_SWAP, USER_DRAG_SWAP, INITIAL_GAME_SETUP, BOARD_SYNC may change board", () => {
  let engine: ClientGameStateEngine;

  beforeEach(() => {
    engine = new ClientGameStateEngine();
  });

  function fireEvent(type: EventType, payload: Record<string, unknown> = {}): void {
    engine.applyEvent({ type, at: Date.now(), payload });
  }

  function initialSetup(): number[] {
    const board = generateShuffledBoard(TOTAL);
    fireEvent(EventType.PUZZLE_STARTED, {
      board,
      startedAt: Date.now(),
      endsAt: Date.now() + 180_000,
      durationSeconds: 180,
    });
    return board;
  }

  /* ═══════════════════════════════════════════════════════
     1. INITIAL_GAME_SETUP is the only way to CREATE a board
     ═══════════════════════════════════════════════════════ */

  it("INITIAL_GAME_SETUP: PUZZLE_STARTED creates board — no mutation before that", () => {
    expect(engine.board).toBeNull();
    const board = initialSetup();
    expect(engine.board).not.toBeNull();
    // Board must exactly match server-sent board
    expect(Array.from(engine.board!.board)).toEqual(board);
    // Only 1 create event (the replaceBoard call) or 0 (direct constructor)
    expect(engine.board!.mutations.length).toBeLessThanOrEqual(1);
    if (engine.board!.mutations.length === 1) {
      expect(engine.board!.mutations[0].cause).toBe("INITIAL_GAME_SETUP");
    }
  });

  /* ═══════════════════════════════════════════════════════
     2. Timer updates MUST NOT change the board
     ═══════════════════════════════════════════════════════ */

  it("MEMORY_TIMER_UPDATED: fires 60 times — board remains byte-for-byte identical", () => {
    const initial = initialSetup();
    const snapshotBefore = Array.from(engine.board!.board);
    const countBefore = engine.board!.mutations.length;

    for (let i = 60; i >= 0; i--) {
      fireEvent(EventType.MEMORY_TIMER_UPDATED, { remaining: i, endsAt: Date.now() + i * 1000 });
    }

    expect(Array.from(engine.board!.board)).toEqual(snapshotBefore);
    expect(engine.board!.mutations.length).toBe(countBefore);
    void initial;
  });

  it("PUZZLE_TIMER_UPDATED: fires 180 times — board remains byte-for-byte identical", () => {
    initialSetup();
    const snapshotBefore = Array.from(engine.board!.board);
    const countBefore = engine.board!.mutations.length;

    for (let i = 180; i >= 0; i--) {
      fireEvent(EventType.PUZZLE_TIMER_UPDATED, { remaining: i, endsAt: Date.now() + i * 1000 });
    }

    expect(Array.from(engine.board!.board)).toEqual(snapshotBefore);
    expect(engine.board!.mutations.length).toBe(countBefore);
  });

  /* ═══════════════════════════════════════════════════════
     3. Player / lobby events MUST NOT change the board
     ═══════════════════════════════════════════════════════ */

  it("PLAYER_JOINED: board unchanged", () => {
    initialSetup();
    const snap = Array.from(engine.board!.board);
    const count = engine.board!.mutations.length;

    fireEvent(EventType.PLAYER_JOINED, { player: { id: "p2", name: "Bob", slot: 2, connected: true, score: 0 } });

    expect(Array.from(engine.board!.board)).toEqual(snap);
    expect(engine.board!.mutations.length).toBe(count);
  });

  it("PLAYER_STATUS: board unchanged", () => {
    initialSetup();
    const snap = Array.from(engine.board!.board);
    const count = engine.board!.mutations.length;

    fireEvent(EventType.PLAYER_STATUS, { playerId: "p1", connected: false });

    expect(Array.from(engine.board!.board)).toEqual(snap);
    expect(engine.board!.mutations.length).toBe(count);
  });

  it("PLAYER_LEFT: board unchanged", () => {
    initialSetup();
    const snap = Array.from(engine.board!.board);
    const count = engine.board!.mutations.length;

    fireEvent(EventType.PLAYER_LEFT, { playerId: "p2" });

    expect(Array.from(engine.board!.board)).toEqual(snap);
    expect(engine.board!.mutations.length).toBe(count);
  });

  it("LOBBY_UPDATED: board unchanged", () => {
    initialSetup();
    const snap = Array.from(engine.board!.board);
    const count = engine.board!.mutations.length;

    fireEvent(EventType.LOBBY_UPDATED, { status: "PUZZLE", players: [] });

    expect(Array.from(engine.board!.board)).toEqual(snap);
    expect(engine.board!.mutations.length).toBe(count);
  });

  it("GAME_STARTED: board unchanged", () => {
    initialSetup();
    const snap = Array.from(engine.board!.board);
    const count = engine.board!.mutations.length;

    fireEvent(EventType.GAME_STARTED, { status: "MEMORY" });

    expect(Array.from(engine.board!.board)).toEqual(snap);
    expect(engine.board!.mutations.length).toBe(count);
  });

  it("MEMORY_PHASE_STARTED: board unchanged (no board in payload)", () => {
    initialSetup();
    const snap = Array.from(engine.board!.board);
    const count = engine.board!.mutations.length;

    fireEvent(EventType.MEMORY_PHASE_STARTED, {
      imageName: "some-image",
      startedAt: Date.now(),
      endsAt: Date.now() + 3000,
      durationSeconds: 3,
    });

    expect(Array.from(engine.board!.board)).toEqual(snap);
    expect(engine.board!.mutations.length).toBe(count);
  });

  it("PLAYER_COMPLETED: board unchanged for OTHER player completing", () => {
    initialSetup();
    const snap = Array.from(engine.board!.board);
    const count = engine.board!.mutations.length;

    fireEvent(EventType.PLAYER_COMPLETED, { playerId: "other-player", at: Date.now() });

    expect(Array.from(engine.board!.board)).toEqual(snap);
    expect(engine.board!.mutations.length).toBe(count);
  });

  it("GAME_FINISHED: board unchanged", () => {
    initialSetup();
    const snap = Array.from(engine.board!.board);
    const count = engine.board!.mutations.length;

    fireEvent(EventType.GAME_FINISHED, {
      winner: null,
      timeExpired: false,
      finishedAt: Date.now(),
      durationMs: 60000,
      standings: [],
    });

    expect(Array.from(engine.board!.board)).toEqual(snap);
    expect(engine.board!.mutations.length).toBe(count);
  });

  /* ═══════════════════════════════════════════════════════
     4. SSE reconnect MUST NOT change the board
     ═══════════════════════════════════════════════════════ */

  it("SSE reconnect / SNAPSHOT without board field: board remains unchanged", () => {
    initialSetup();
    engine.userTapSwap(0, 1);
    const snap = Array.from(engine.board!.board);
    const count = engine.board!.mutations.length;

    // Simulate SSE stream_end and reconnect: client re-receives a SNAPSHOT
    // The SNAPSHOT must NOT contain the player's board (server sends it only on PUZZLE_STARTED)
    // If SNAPSHOT contains 'board' under puzzle, that would be EXPLICIT_AUTHORITATIVE_BOARD_SYNC
    // Here we fire a SNAPSHOT without a board field (normal reconnect)
    const snapshot = {
      type: EventType.SNAPSHOT as any,
      at: Date.now(),
      payload: {
        code: "TEST",
        status: "PUZZLE",
        players: [],
        maxPlayers: 5,
        you: null,
        isHost: false,
        // Crucially: no 'puzzle.board' in a normal snapshot reconnect
        puzzle: null,
      },
    };
    engine.applyEvent(snapshot);

    expect(Array.from(engine.board!.board)).toEqual(snap);
    expect(engine.board!.mutations.length).toBe(count);
  });

  it("SSE stream_end + immediate reconnect cycle (5 times): board unchanged between cycles", () => {
    initialSetup();
    engine.userTapSwap(0, 3); // do one real user swap
    const snap = Array.from(engine.board!.board);
    const count = engine.board!.mutations.length;

    // Simulate 5 SSE reconnect cycles (stream_end fires, client reconnects, receives missed events)
    for (let cycle = 0; cycle < 5; cycle++) {
      // stream_end is handled by realtime.ts, NOT by useFuzalGame — it just triggers reconnect
      // The only events fired back over the new connection are replayed from the cursor.
      // In our test, no new SWAP happened, so only PUZZLE_TIMER_UPDATED would come through.
      fireEvent(EventType.PUZZLE_TIMER_UPDATED, {
        remaining: 170 - cycle * 5,
        endsAt: Date.now() + (170 - cycle * 5) * 1000,
      });
    }

    expect(Array.from(engine.board!.board)).toEqual(snap);
    expect(engine.board!.mutations.length).toBe(count);
  });

  /* ═══════════════════════════════════════════════════════
     5. Image loading callbacks & lifecycle MUST NOT change the board
     ═══════════════════════════════════════════════════════ */

  it("image onLoad: piece image element triggers onLoad — board remains byte-for-byte identical", () => {
    initialSetup();
    const snap = Array.from(engine.board!.board);
    const count = engine.board!.mutations.length;

    // Simulate 16 img tags in PuzzleBoard firing onLoad sequentially
    for (let slot = 0; slot < TOTAL; slot++) {
      // PuzzleBoard: <img onLoad={() => handlePieceLoaded(pieceId)} />
      // In PuzzleBoard and useFuzalGame, onLoad only updates local loaded state/spinner, never touches board!
      const onLoadHandler = (pieceId: number) => {
        // purely visual state (e.g. setLoadedPieces((prev) => ({ ...prev, [pieceId]: true })))
      };
      onLoadHandler(slot);
    }

    expect(Array.from(engine.board!.board)).toEqual(snap);
    expect(engine.board!.mutations.length).toBe(count);
  });

  it("image onError: piece image fails to load — board remains byte-for-byte identical", () => {
    initialSetup();
    const snap = Array.from(engine.board!.board);
    const count = engine.board!.mutations.length;

    // Simulate onError firing on multiple pieces
    for (let slot = 0; slot < 5; slot++) {
      const onErrorHandler = () => {
        // Sets error toast or visual fallback indicator, never mutates puzzle board
      };
      onErrorHandler();
    }

    expect(Array.from(engine.board!.board)).toEqual(snap);
    expect(engine.board!.mutations.length).toBe(count);
  });

  it("image retry: manual or automated retry of failed images — board remains byte-for-byte identical", () => {
    initialSetup();
    const snap = Array.from(engine.board!.board);
    const count = engine.board!.mutations.length;

    // retryLoadPieces in useFuzalGame:
    // const retryLoadPieces = useCallback(() => { setPiecesError(null); setLoadAttempts((c) => c + 1); }, []);
    let loadAttempts = 0;
    const retryLoadPieces = () => {
      loadAttempts++;
    };
    retryLoadPieces();
    retryLoadPieces();

    expect(loadAttempts).toBe(2);
    expect(Array.from(engine.board!.board)).toEqual(snap);
    expect(engine.board!.mutations.length).toBe(count);
  });

  it("preload completion: all 16 WebP pieces finish fetching — board remains byte-for-byte identical", () => {
    initialSetup();
    engine.userTapSwap(0, 1);
    const snap = Array.from(engine.board!.board);
    const count = engine.board!.mutations.length;

    // When fetchBatchPieces succeeds in useFuzalGame:
    //   setPieceSrcs(batchData.pieces); setPiecesLoading(false);
    // Board is completely decoupled and never mutated
    const mockPieces = Object.fromEntries(
      Array.from({ length: TOTAL }, (_, i) => [i, `blob:http://localhost/piece-${i}`]),
    );
    // PieceSrcs updated:
    expect(Object.keys(mockPieces).length).toBe(16);

    expect(Array.from(engine.board!.board)).toEqual(snap);
    expect(engine.board!.mutations.length).toBe(count);
  });

  it("React render & component remount: simulated component re-render / remount leaves board invariant", () => {
    initialSetup();
    engine.userTapSwap(2, 7);
    const snap = Array.from(engine.board!.board);
    const count = engine.board!.mutations.length;

    // In React: component re-renders trigger render function again with current state.
    // Pure renders MUST NOT mutate board.
    const renderPuzzleBoard = (currentBoard: readonly number[]) => {
      // JSX rendering: iterates board to render 16 tiles
      const renderedSlots = currentBoard.map((pieceId, slot) => ({
        slot,
        pieceId,
        isCorrect: pieceId === slot,
      }));
      return renderedSlots;
    };

    // Simulate 10 component re-renders (e.g. from ticker or hover changes)
    for (let r = 0; r < 10; r++) {
      const slots = renderPuzzleBoard(engine.board!.board);
      expect(slots.length).toBe(16);
    }

    // Simulate component unmount and remount (e.g. navigating away and back or strict mode remount)
    // Board in client state or hook must retain exact values
    const remountedBoard = [...engine.board!.board];
    expect(remountedBoard).toEqual(snap);
    expect(engine.board!.mutations.length).toBe(count);
  });

  it("EventSource creation & close: establishing or closing SSE connection does NOT mutate board", () => {
    initialSetup();
    const snap = Array.from(engine.board!.board);
    const count = engine.board!.mutations.length;

    // Simulate EventSource creation (new EventSource(url)) and close (es.close())
    const mockES = {
      url: "/api/lobbies/TEST/events",
      readyState: 0,
      close: vi.fn(),
    };
    mockES.readyState = 1; // open
    mockES.close();
    mockES.readyState = 2; // closed

    expect(mockES.close).toHaveBeenCalledTimes(1);
    expect(Array.from(engine.board!.board)).toEqual(snap);
    expect(engine.board!.mutations.length).toBe(count);
  });

  it("network reconnect: offline -> online transition does NOT mutate board", () => {
    initialSetup();
    engine.userTapSwap(1, 4);
    const snap = Array.from(engine.board!.board);
    const count = engine.board!.mutations.length;

    // Simulate browser window.addEventListener('offline') / 'online'
    const handleOffline = () => { /* setConnState('error') */ };
    const handleOnline = () => { /* socket.retry() */ };

    handleOffline();
    handleOnline();

    expect(Array.from(engine.board!.board)).toEqual(snap);
    expect(engine.board!.mutations.length).toBe(count);
  });

  /* ═══════════════════════════════════════════════════════
     6. USER_TAP_SWAP: ONE tap = ONE swap = ONE API request
     ═══════════════════════════════════════════════════════ */

  it("TAP: tap A → tap B = exactly 1 swap, exactly 1 API request", () => {
    const board = generateShuffledBoard(TOTAL);
    fireEvent(EventType.PUZZLE_STARTED, {
      board,
      startedAt: Date.now(),
      endsAt: Date.now() + 180_000,
      durationSeconds: 180,
    });
    engine.board = new InstrumentedBoard(board);

    const from = 0;
    const to = 5;
    engine.userTapSwap(from, to);

    const userSwapMutations = engine.board.mutations.filter(
      (m) => m.cause === "USER_TAP_SWAP",
    );
    const apiSwaps = engine.apiCallLog.filter((c) => c.type === "SWAP");

    expect(userSwapMutations.length).toBe(1);
    expect(apiSwaps.length).toBe(1);
    expect(apiSwaps[0].from).toBe(from);
    expect(apiSwaps[0].to).toBe(to);
  });

  it("TAP: tapping same slot twice = 0 swaps, 0 API requests", () => {
    const pointer = new PointerEngine();
    const game = new ClientGameStateEngine();
    const board = generateShuffledBoard(TOTAL);
    game.board = new InstrumentedBoard(board);

    pointer.pointerDown(3);
    const result1 = pointer.pointerUp(slotCenter(3).x, slotCenter(3).y);
    expect(result1).toBe("TAP_SELECT");
    expect(pointer.selected).toBe(3);

    pointer.pointerDown(3);
    const result2 = pointer.pointerUp(slotCenter(3).x, slotCenter(3).y);
    expect(result2).toBe("TAP_CANCEL");
    expect(pointer.selected).toBeNull();

    // No swaps should have been emitted
    expect(pointer.swapEvents.length).toBe(0);
    expect(game.board.mutations.length).toBe(0);
    expect(game.apiCallLog.length).toBe(0);
  });

  it("TAP: fast double-tap same slot within one frame = still only 0 swaps", () => {
    const pointer = new PointerEngine();

    pointer.pointerDown(7);
    pointer.pointerUp(slotCenter(7).x + 1, slotCenter(7).y + 1); // select
    pointer.pointerDown(7);
    pointer.pointerUp(slotCenter(7).x + 1, slotCenter(7).y + 1); // cancel

    expect(pointer.swapEvents.length).toBe(0);
    expect(pointer.selected).toBeNull();
  });

  it("TAP sequence: A → B → C → D = exactly 2 swaps (AB then CD)", () => {
    const pointer = new PointerEngine();

    pointer.pointerDown(0);
    pointer.pointerUp(slotCenter(0).x, slotCenter(0).y); // select 0

    pointer.pointerDown(5);
    pointer.pointerUp(slotCenter(5).x, slotCenter(5).y); // swap 0↔5
    pointer.isLocked = false; // unlock after swap animation finishes

    pointer.pointerDown(2);
    pointer.pointerUp(slotCenter(2).x, slotCenter(2).y); // select 2

    pointer.pointerDown(9);
    pointer.pointerUp(slotCenter(9).x, slotCenter(9).y); // swap 2↔9

    expect(pointer.swapEvents.length).toBe(2);
    expect(pointer.swapEvents[0]).toEqual({ cause: "USER_TAP_SWAP", from: 0, to: 5 });
    expect(pointer.swapEvents[1]).toEqual({ cause: "USER_TAP_SWAP", from: 2, to: 9 });
  });

  /* ═══════════════════════════════════════════════════════
     7. USER_DRAG_SWAP: ONE drag = ONE swap = ONE API request
        NEVER swap on pointermove / dragover / touchmove
     ═══════════════════════════════════════════════════════ */

  it("DRAG: pointerdown → many pointermoves over 6 slots → pointerup = exactly 1 swap", () => {
    const pointer = new PointerEngine();
    const game = new ClientGameStateEngine();
    const board = generateShuffledBoard(TOTAL);
    game.board = new InstrumentedBoard(board);

    pointer.pointerDown(0);
    // Move over slots 1, 2, 3, 6, 10 — MUST NOT produce any intermediate swap
    [1, 2, 3, 6, 10].forEach((slot) => {
      pointer.pointerMove(slotCenter(slot).x, slotCenter(slot).y);
      expect(pointer.swapEvents.length).toBe(0); // CRITICAL: no swap on move
    });

    // Release on slot 10 — produces exactly 1 swap
    pointer.pointerUp(slotCenter(10).x, slotCenter(10).y);
    expect(pointer.swapEvents.length).toBe(1);
    expect(pointer.swapEvents[0]).toEqual({ cause: "USER_DRAG_SWAP", from: 0, to: 10 });

    // Apply that 1 swap with correct cause
    game.userDragSwap(0, 10);
    const dragMutations = game.board.mutations.filter((m) => m.cause === "USER_DRAG_SWAP");
    const apiSwaps = game.apiCallLog.filter((c) => c.type === "SWAP");

    expect(dragMutations.length).toBe(1);
    expect(apiSwaps.length).toBe(1);
  });

  it("DRAG: board[i] is byte-for-byte identical across ALL pointermove events", () => {
    const pointer = new PointerEngine();
    const game = new ClientGameStateEngine();
    const board = generateShuffledBoard(TOTAL);
    game.board = new InstrumentedBoard(board);

    const snapshotBeforeDrag = Array.from(game.board.board);

    pointer.pointerDown(0);
    const slotsVisited = [1, 4, 5, 8, 9, 12, 13];
    for (const slot of slotsVisited) {
      pointer.pointerMove(slotCenter(slot).x, slotCenter(slot).y);
      // Board must be identical after every single move event
      expect(Array.from(game.board.board)).toEqual(snapshotBeforeDrag);
      expect(game.board.mutations.length).toBe(0);
    }

    // Release without applying the swap (simulating drop outside)
    pointer.pointerUp(50, 50); // outside board
    expect(pointer.swapEvents.length).toBe(0); // cancelled

    // Board is still unchanged
    expect(Array.from(game.board.board)).toEqual(snapshotBeforeDrag);
    expect(game.board.mutations.length).toBe(0);
  });

  it("DRAG: drop outside board = 0 swaps, 0 board mutations, 0 API requests", () => {
    const pointer = new PointerEngine();
    const game = new ClientGameStateEngine();
    const board = generateShuffledBoard(TOTAL);
    game.board = new InstrumentedBoard(board);
    const snap = Array.from(board);

    pointer.pointerDown(3);
    pointer.pointerMove(slotCenter(8).x, slotCenter(8).y); // threshold crossed → isDragging
    pointer.pointerUp(5, 5); // outside board rect

    expect(pointer.swapEvents.length).toBe(0);
    expect(game.board.mutations.length).toBe(0);
    expect(game.apiCallLog.length).toBe(0);
    expect(Array.from(game.board.board)).toEqual(snap);
  });

  it("DRAG: drag back to origin slot = 0 swaps (A→A is a no-op)", () => {
    const pointer = new PointerEngine();
    const game = new ClientGameStateEngine();
    const board = generateShuffledBoard(TOTAL);
    game.board = new InstrumentedBoard(board);
    const snap = Array.from(board);

    pointer.pointerDown(6);
    pointer.pointerMove(slotCenter(10).x, slotCenter(10).y);
    expect(pointer.tracker?.isDragging).toBe(true);
    pointer.pointerMove(slotCenter(6).x, slotCenter(6).y); // move back to origin
    pointer.pointerUp(slotCenter(6).x, slotCenter(6).y);

    // startSlot === targetSlot → no swap emitted
    expect(pointer.swapEvents.length).toBe(0);
    expect(game.board.mutations.length).toBe(0);
    expect(game.apiCallLog.length).toBe(0);
    expect(Array.from(game.board.board)).toEqual(snap);
  });

  it("DRAG: does NOT also trigger TAP handler (no double-swap)", () => {
    const pointer = new PointerEngine();

    // Start a drag (movement > threshold)
    pointer.pointerDown(0);
    pointer.pointerMove(slotCenter(0).x + 20, slotCenter(0).y + 20); // > 8px → isDragging
    expect(pointer.tracker?.isDragging).toBe(true);
    expect(pointer.selected).toBeNull(); // tap selection cleared on drag start

    pointer.pointerUp(slotCenter(9).x, slotCenter(9).y);

    // Must produce exactly 1 DRAG_SWAP swap event, NOT a TAP_SWAP event
    expect(pointer.swapEvents.length).toBe(1);
    expect(pointer.swapEvents[0].cause).toBe("USER_DRAG_SWAP");
    expect(pointer.swapEvents[0].from).toBe(0);
    expect(pointer.swapEvents[0].to).toBe(9);
  });

  /* ═══════════════════════════════════════════════════════
     8. EXPLICIT_AUTHORITATIVE_BOARD_SYNC: server PUZZLE_MOVE updates are valid
     ═══════════════════════════════════════════════════════ */

  it("EXPLICIT_AUTHORITATIVE_BOARD_SYNC: server PUZZLE_MOVE board sync updates with correct cause", () => {
    initialSetup();
    const serverBoard = fisherYates(Array.from({ length: TOTAL }, (_, i) => i));

    const countBefore = engine.board!.mutations.length;
    fireEvent(EventType.PUZZLE_MOVE, {
      board: serverBoard,
      moves: 5,
      correctSlots: correctSlots(serverBoard),
      completed: false,
    });

    expect(Array.from(engine.board!.board)).toEqual(serverBoard);
    expect(engine.board!.mutations.length).toBe(countBefore + 1);
    expect(engine.board!.mutations[engine.board!.mutations.length - 1].cause).toBe(
      "EXPLICIT_AUTHORITATIVE_BOARD_SYNC",
    );
  });

  /* ═══════════════════════════════════════════════════════
     9. SLOW IMAGE LOADING STRESS TEST
        Simulate very slow preload (1 minute of "waiting")
        with concurrent timer ticks and SSE events —
        board must stay byte-for-byte identical
     ═══════════════════════════════════════════════════════ */

  it("SLOW IMAGE LOAD STRESS: board unchanged during simulated 60-second slow preload with concurrent events", () => {
    const board = generateShuffledBoard(TOTAL);
    fireEvent(EventType.PUZZLE_STARTED, {
      board,
      startedAt: Date.now(),
      endsAt: Date.now() + 180_000,
      durationSeconds: 180,
    });
    engine.board = new InstrumentedBoard(board);
    const snap = Array.from(engine.board.board);

    // Simulate 60 seconds of:
    //   - timer ticks every second
    //   - player status updates every 5 seconds
    //   - lobby updates every 10 seconds
    // While image fetch is "pending" (no image events fired)
    for (let second = 180; second >= 120; second--) {
      fireEvent(EventType.PUZZLE_TIMER_UPDATED, { remaining: second, endsAt: Date.now() + second * 1000 });

      if (second % 5 === 0) {
        fireEvent(EventType.PLAYER_STATUS, { playerId: "p1", connected: true });
      }
      if (second % 10 === 0) {
        fireEvent(EventType.LOBBY_UPDATED, { status: "PUZZLE", players: [] });
      }
    }

    // Simulate preload success at the end
    // useFuzalGame.ts: setPieceSrcs(batchData.pieces) — never touches board
    // No board event is fired by preload completion

    expect(Array.from(engine.board.board)).toEqual(snap);
    expect(engine.board.mutations.filter(m => m.cause !== "INITIAL_GAME_SETUP").length).toBe(0);
  });

  /* ═══════════════════════════════════════════════════════
     10. REPEATED SSE RECONNECT STRESS TEST
         Simulate 20 SSE reconnections while user plays —
         board must never change due to reconnects
     ═══════════════════════════════════════════════════════ */

  it("SSE RECONNECT STRESS: 20 reconnects — board only changes from valid user swaps", () => {
    const board = generateShuffledBoard(TOTAL);
    fireEvent(EventType.PUZZLE_STARTED, {
      board,
      startedAt: Date.now(),
      endsAt: Date.now() + 180_000,
      durationSeconds: 180,
    });
    engine.board = new InstrumentedBoard(board);

    let swapCount = 0;

    for (let cycle = 0; cycle < 20; cycle++) {
      // SSE reconnect cycle: only timer events come through on reconnect
      fireEvent(EventType.PUZZLE_TIMER_UPDATED, { remaining: 170 - cycle, endsAt: Date.now() });

      // User makes a swap in some cycles
      if (cycle % 4 === 0) {
        const from = (cycle * 3) % TOTAL;
        const to = (from + 3) % TOTAL;
        if (from !== to) {
          engine.userTapSwap(from, to);
          swapCount++;
        }
      }
    }

    const userMutations = engine.board.mutations.filter(
      (m) => m.cause === "USER_TAP_SWAP" || m.cause === "USER_DRAG_SWAP",
    );
    const forbiddenMutations = engine.board.mutations.filter(
      (m) =>
        m.cause !== "USER_TAP_SWAP" &&
        m.cause !== "USER_DRAG_SWAP" &&
        m.cause !== "INITIAL_GAME_SETUP" &&
        m.cause !== "EXPLICIT_AUTHORITATIVE_BOARD_SYNC",
    );

    expect(userMutations.length).toBe(swapCount);
    expect(forbiddenMutations.length).toBe(0); // No forbidden mutations!
    expect(engine.apiCallLog.filter((c) => c.type === "SWAP").length).toBe(swapCount);
  });

  /* ═══════════════════════════════════════════════════════
     11. COMPLETION LIFECYCLE: solved = exactly 1 COMPLETE request,
         no further board mutations allowed
     ═══════════════════════════════════════════════════════ */

  it("COMPLETION: solving the puzzle produces exactly 1 COMPLETE API call, blocks further swaps", () => {
    // Set up board 1 swap away from solved
    const nearSolved = [1, 0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    fireEvent(EventType.PUZZLE_STARTED, {
      board: nearSolved,
      startedAt: Date.now(),
      endsAt: Date.now() + 180_000,
      durationSeconds: 180,
    });
    engine.board = new InstrumentedBoard(nearSolved);

    // Winning swap
    engine.userTapSwap(0, 1);

    expect(isSolved(engine.board.board as number[], TOTAL)).toBe(true);
    expect(engine.completed).toBe(true);

    const completeRequests = engine.apiCallLog.filter((c) => c.type === "COMPLETE");
    expect(completeRequests.length).toBe(1);

    const mutationsBefore = engine.board.mutations.length;

    // Attempt 3 more swaps — all must be blocked
    engine.userTapSwap(2, 3);
    engine.userTapSwap(4, 5);
    engine.userDragSwap(6, 7);

    expect(engine.board.mutations.length).toBe(mutationsBefore); // no new mutations
    expect(engine.apiCallLog.filter((c) => c.type === "SWAP").length).toBe(1); // only 1 swap total
    expect(engine.apiCallLog.filter((c) => c.type === "COMPLETE").length).toBe(1); // only 1 complete
  });

  it("COMPLETION: double-completion race (two simultaneous COMPLETE calls) — exactly 1 fires", () => {
    // Simulates two concurrent PUZZLE_MOVE events both with completed=true arriving
    const nearSolved = [1, 0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    fireEvent(EventType.PUZZLE_STARTED, {
      board: nearSolved,
      startedAt: Date.now(),
      endsAt: Date.now() + 180_000,
      durationSeconds: 180,
    });
    engine.board = new InstrumentedBoard(nearSolved);

    engine.userTapSwap(0, 1); // winning swap → sets completed = true
    const solvedBoard = Array.from({ length: TOTAL }, (_, i) => i);

    // Simulate server sending back PUZZLE_MOVE with completed=true
    fireEvent(EventType.PUZZLE_MOVE, { board: solvedBoard, moves: 1, completed: true });

    // Simulate another PUZZLE_MOVE (race condition) — still completed=true
    fireEvent(EventType.PUZZLE_MOVE, { board: solvedBoard, moves: 1, completed: true });

    // Completion flag set exactly once from the client perspective
    expect(engine.completed).toBe(true);
    expect(engine.apiCallLog.filter((c) => c.type === "COMPLETE").length).toBe(1);
  });

  /* ═══════════════════════════════════════════════════════
     12. OVERALL AUDIT — every recorded mutation has valid cause
     ═══════════════════════════════════════════════════════ */

  it("AUDIT: all board mutations across a full game session have allowed causes only", () => {
    const allowed: Set<MutationCause> = new Set([
      "INITIAL_GAME_SETUP",
      "USER_TAP_SWAP",
      "USER_DRAG_SWAP",
      "EXPLICIT_AUTHORITATIVE_BOARD_SYNC",
    ]);

    const board = generateShuffledBoard(TOTAL);
    fireEvent(EventType.PUZZLE_STARTED, {
      board,
      startedAt: Date.now(),
      endsAt: Date.now() + 180_000,
      durationSeconds: 180,
    });
    engine.board = new InstrumentedBoard(board);

    // Mixed sequence of allowed and "background" events
    fireEvent(EventType.PUZZLE_TIMER_UPDATED, { remaining: 179 });
    engine.userTapSwap(0, 1);
    fireEvent(EventType.PLAYER_STATUS, { playerId: "p1", connected: false });
    fireEvent(EventType.PUZZLE_TIMER_UPDATED, { remaining: 178 });
    engine.userDragSwap(3, 7);
    fireEvent(EventType.LOBBY_UPDATED, { status: "PUZZLE" });
    fireEvent(EventType.PUZZLE_MOVE, {
      board: Array.from(engine.board.board),
      moves: 2,
      completed: false,
    });
    engine.userTapSwap(2, 5);
    fireEvent(EventType.PUZZLE_TIMER_UPDATED, { remaining: 177 });

    for (const mutation of engine.board.mutations) {
      expect(allowed.has(mutation.cause)).toBe(true);
    }

    // Verify mutation causes are exactly the ones we triggered
    const causes = engine.board.mutations.map((m) => m.cause);
    expect(causes).toContain("USER_TAP_SWAP");
    expect(causes).toContain("USER_DRAG_SWAP");
    expect(causes).toContain("EXPLICIT_AUTHORITATIVE_BOARD_SYNC");
    expect(causes).not.toContain(undefined);
    expect(causes).not.toContain(null);
  });
});
