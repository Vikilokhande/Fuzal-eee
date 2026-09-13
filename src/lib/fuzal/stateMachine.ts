import { EventType, GameState, type GameEvent } from "@/lib/game/types";
import { isValidBoard } from "@/lib/game/puzzle";

const STATE_ORDER: Record<GameState, number> = {
  [GameState.LOBBY]: 0,
  [GameState.MEMORY]: 1,
  [GameState.PUZZLE]: 2,
  [GameState.FINISHED]: 3,
};

export type StateRejectReason =
  | "DUPLICATE_OR_OLD_EVENT"
  | "OLD_GAME_EVENT"
  | "STALE_STATE_TRANSITION"
  | "INVALID_BOARD";

export interface EventDecisionContext {
  currentStatus: GameState | null;
  currentGameId: string | null;
  lastAppliedEventId: number;
}

export interface EventDecision {
  accept: boolean;
  reason?: StateRejectReason;
  current?: GameState | null;
  incoming?: GameState | null;
  eventId?: number | null;
  gameId?: string | null;
}

export function isGameState(value: unknown): value is GameState {
  return (
    value === GameState.LOBBY ||
    value === GameState.MEMORY ||
    value === GameState.PUZZLE ||
    value === GameState.FINISHED
  );
}

export function getPieceCount(
  gridCols?: number | null,
  gridRows?: number | null,
  pieceCount?: number | null,
): number {
  if (Number.isInteger(pieceCount) && Number(pieceCount) > 0) {
    return Number(pieceCount);
  }
  const cols = Number.isInteger(gridCols) && Number(gridCols) > 0 ? Number(gridCols) : 3;
  const rows = Number.isInteger(gridRows) && Number(gridRows) > 0 ? Number(gridRows) : 3;
  return cols * rows;
}

export function isValidPuzzleBoard(board: unknown, pieceCount: number): board is number[] {
  return Array.isArray(board) && isValidBoard(board, pieceCount);
}

export function getEventGameId(event: GameEvent): string | null {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const fromEvent = typeof event.gameId === "string" ? event.gameId : null;
  const fromPayload =
    typeof payload.gameId === "string"
      ? payload.gameId
      : typeof payload.currentGameId === "string"
        ? payload.currentGameId
        : null;
  return fromEvent ?? fromPayload;
}

export function getEventStatus(event: GameEvent): GameState | null {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const payloadStatus = isGameState(payload.status) ? payload.status : null;

  switch (event.type) {
    case EventType.SNAPSHOT:
      return payloadStatus;
    case EventType.GAME_STARTED:
    case EventType.MEMORY_PHASE_STARTED:
      return GameState.MEMORY;
    case EventType.PUZZLE_STARTED:
      return GameState.PUZZLE;
    case EventType.GAME_FINISHED:
    case EventType.RESULTS_READY:
      return GameState.FINISHED;
    case EventType.NEW_GAME:
      return payloadStatus ?? GameState.MEMORY;
    case EventType.LOBBY_RESET:
    case EventType.GAME_CLOSED:
      return GameState.LOBBY;
    case EventType.LOBBY_UPDATED:
      return payloadStatus;
    default:
      return null;
  }
}

export function isExplicitNewRoundOrReset(event: GameEvent): boolean {
  return (
    event.type === EventType.NEW_GAME ||
    event.type === EventType.LOBBY_RESET ||
    event.type === EventType.GAME_CLOSED
  );
}

export function canApplyStatusTransition(
  current: GameState,
  incoming: GameState,
  eventType: EventType,
): boolean {
  if (current === incoming) return true;
  if (eventType === EventType.SNAPSHOT) return true;
  if (isExplicitNewRoundOrReset({ type: eventType, at: 0, payload: {} })) return true;
  return STATE_ORDER[incoming] >= STATE_ORDER[current];
}

export function shouldAcceptGameEvent(
  ctx: EventDecisionContext,
  event: GameEvent,
): EventDecision {
  const eventId = Number.isInteger(event.eventId) ? Number(event.eventId) : null;
  const gameId = getEventGameId(event);
  const incoming = getEventStatus(event);
  const current = ctx.currentStatus;

  if (eventId !== null && eventId <= ctx.lastAppliedEventId) {
    return {
      accept: false,
      reason: "DUPLICATE_OR_OLD_EVENT",
      current,
      incoming,
      eventId,
      gameId,
    };
  }

  if (
    event.type !== EventType.SNAPSHOT &&
    gameId &&
    ctx.currentGameId &&
    gameId !== ctx.currentGameId &&
    !isExplicitNewRoundOrReset(event)
  ) {
    return {
      accept: false,
      reason: "OLD_GAME_EVENT",
      current,
      incoming,
      eventId,
      gameId,
    };
  }

  if (current && incoming && !canApplyStatusTransition(current, incoming, event.type)) {
    return {
      accept: false,
      reason: "STALE_STATE_TRANSITION",
      current,
      incoming,
      eventId,
      gameId,
    };
  }

  return { accept: true, current, incoming, eventId, gameId };
}
