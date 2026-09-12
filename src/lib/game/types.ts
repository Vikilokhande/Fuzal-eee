/**
 * Fuzal domain models & event contracts.
 *
 * These are the TypeScript twins of the Pydantic models used by the reference
 * FastAPI service (see /backend/app/models). Runtime validation is done with
 * Zod so malformed WebSocket / REST payloads are rejected before touching the
 * authoritative game state.
 */
import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Enums / state machine                                               */
/* ------------------------------------------------------------------ */

/** LOBBY → MEMORY → PUZZLE → FINISHED → (LOBBY | MEMORY) */
export const GameState = {
  LOBBY: "LOBBY",
  MEMORY: "MEMORY",
  PUZZLE: "PUZZLE",
  FINISHED: "FINISHED",
} as const;
export type GameState = (typeof GameState)[keyof typeof GameState];

export const VALID_TRANSITIONS: Record<GameState, GameState[]> = {
  LOBBY: [GameState.MEMORY],
  MEMORY: [GameState.PUZZLE],
  PUZZLE: [GameState.FINISHED],
  FINISHED: [GameState.LOBBY, GameState.MEMORY],
};

export const PlayerConnection = {
  CONNECTED: "CONNECTED",
  DISCONNECTED: "DISCONNECTED",
} as const;
export type PlayerConnection =
  (typeof PlayerConnection)[keyof typeof PlayerConnection];

/* ------------------------------------------------------------------ */
/* Entity types                                                        */
/* ------------------------------------------------------------------ */

export interface PuzzleInstance {
  /** board[slotIndex] = pieceId (correct pieceId === slotIndex) */
  board: number[];
  moves: number;
  startedAt: number;
  completed: boolean;
  completedAt: number | null;
  eliminated?: boolean;
}

export interface Player {
  id: string;
  name: string;
  token: string;
  joinedAt: number;
  connectionStatus: PlayerConnection;
  score: number;
  slot: number;
  puzzle: PuzzleInstance | null;
  eliminated?: boolean;
}

export interface ImageMeta {
  id: string;
  url: string;
  name: string;
  slug?: string;
}

export interface MemoryPhase {
  image: ImageMeta;
  startedAt: number;
  endsAt: number;
  durationSeconds: number;
}

export interface Lobby {
  id: string; // e.g. FZ-A82K
  code: string; // e.g. A82K (used in /join/{code})
  hostToken: string;
  status: GameState;
  players: Player[];
  maxPlayers: number;
  gridCols: number;
  gridRows: number;
  currentGameId?: string | null;
  memory: MemoryPhase | null;
  puzzleStartedAt: number | null;
  puzzleEndsAt?: number | null;
  puzzleDurationSeconds?: number;
  winnerId: string | null;
  finishedAt: number | null;
  /** per-lobby async mutex (chained promises) – guarantees atomic winner */
  lockChain: Promise<unknown>;
  timerInterval: ReturnType<typeof setInterval> | null;
  endTimeout: ReturnType<typeof setTimeout> | null;
  disconnectTimers: Record<string, ReturnType<typeof setTimeout>>;
  usedImageIds: string[];
  createdAt: number;
}

/* ------------------------------------------------------------------ */
/* Wire events (the "WebSocket" protocol, also carried over SSE)       */
/* ------------------------------------------------------------------ */

export const EventType = {
  SNAPSHOT: "SNAPSHOT",
  ERROR: "ERROR",
  PLAYER_JOINED: "PLAYER_JOINED",
  PLAYER_LEFT: "PLAYER_LEFT",
  PLAYER_STATUS: "PLAYER_STATUS",
  LOBBY_UPDATED: "LOBBY_UPDATED",
  GAME_STARTED: "GAME_STARTED",
  MEMORY_PHASE_STARTED: "MEMORY_PHASE_STARTED",
  MEMORY_TIMER_UPDATED: "MEMORY_TIMER_UPDATED",
  PUZZLE_STARTED: "PUZZLE_STARTED",
  PUZZLE_TIMER_UPDATED: "PUZZLE_TIMER_UPDATED",
  PUZZLE_MOVE: "PUZZLE_MOVE",
  PLAYER_COMPLETED: "PLAYER_COMPLETED",
  PLAYER_ELIMINATED: "PLAYER_ELIMINATED",
  GAME_FINISHED: "GAME_FINISHED",
  NEW_GAME: "NEW_GAME",
} as const;
export type EventType = (typeof EventType)[keyof typeof EventType];

export interface GameEvent<T = unknown> {
  type: EventType;
  at: number;
  lobbyId?: string;
  payload: T;
}

/* ------------------------------------------------------------------ */
/* REST validation schemas                                            */
/* ------------------------------------------------------------------ */

export const LOBBY_CODE_RE = /^[A-Z0-9]{4}$/;
export const PLAYER_ID_RE =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|p_[A-Za-z0-9]{10,})$/i;
export const NAME_RE = /^[\p{L}\p{N} _.\-']{1,16}$/u;

export const createLobbySchema = z.object({
  gridCols: z.number().int().min(3).max(6).optional(),
  gridRows: z.number().int().min(3).max(6).optional(),
  memorySeconds: z.number().int().min(5).max(120).optional(),
});

export const joinSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Please enter your name")
    .max(16, "Name must be 16 characters or fewer")
    .regex(NAME_RE, "Name contains invalid characters"),
});

const actionBase = z.object({
  token: z.string().min(10),
});

export const startGameAction = actionBase.extend({
  type: z.literal("START_GAME"),
});
export const swapAction = actionBase.extend({
  type: z.literal("SWAP"),
  playerId: z.string().min(3),
  from: z.number().int().min(0).max(35),
  to: z.number().int().min(0).max(35),
});
export const playAgainAction = actionBase.extend({
  type: z.literal("PLAY_AGAIN"),
});
export const backToLobbyAction = actionBase.extend({
  type: z.literal("BACK_TO_LOBBY"),
});

export const actionSchema = z.union([
  startGameAction,
  swapAction,
  playAgainAction,
  backToLobbyAction,
]);
export type ActionInput = z.infer<typeof actionSchema>;
