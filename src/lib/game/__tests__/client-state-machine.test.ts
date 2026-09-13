import { describe, expect, it } from "vitest";
import { EventType, GameState, type GameEvent } from "../types";
import {
  getPieceCount,
  isValidPuzzleBoard,
  shouldAcceptGameEvent,
} from "../../fuzal/stateMachine";

function event(
  type: EventType,
  payload: Record<string, unknown> = {},
  eventId = 1,
  gameId: string | null = "game-a",
): GameEvent {
  return { type, at: Date.now(), eventId, gameId, payload };
}

describe("client realtime state gate", () => {
  it("rejects duplicate or older event ids", () => {
    const decision = shouldAcceptGameEvent(
      {
        currentStatus: GameState.PUZZLE,
        currentGameId: "game-a",
        lastAppliedEventId: 9,
      },
      event(EventType.PUZZLE_MOVE, { board: [0, 1, 2, 3] }, 9),
    );

    expect(decision).toMatchObject({
      accept: false,
      reason: "DUPLICATE_OR_OLD_EVENT",
    });
  });

  it("rejects old-round events but allows explicit resets", () => {
    const oldRound = shouldAcceptGameEvent(
      {
        currentStatus: GameState.PUZZLE,
        currentGameId: "game-b",
        lastAppliedEventId: 4,
      },
      event(EventType.PUZZLE_MOVE, { board: [0, 1, 2, 3] }, 5, "game-a"),
    );
    expect(oldRound).toMatchObject({ accept: false, reason: "OLD_GAME_EVENT" });

    const reset = shouldAcceptGameEvent(
      {
        currentStatus: GameState.FINISHED,
        currentGameId: "game-b",
        lastAppliedEventId: 5,
      },
      event(EventType.LOBBY_RESET, { status: GameState.LOBBY }, 6, null),
    );
    expect(reset.accept).toBe(true);
  });

  it("rejects stale phase rollback events", () => {
    const decision = shouldAcceptGameEvent(
      {
        currentStatus: GameState.PUZZLE,
        currentGameId: "game-a",
        lastAppliedEventId: 10,
      },
      event(EventType.MEMORY_PHASE_STARTED, {}, 11, "game-a"),
    );

    expect(decision).toMatchObject({
      accept: false,
      reason: "STALE_STATE_TRANSITION",
    });
  });

  it("validates dynamic 12-piece boards", () => {
    expect(getPieceCount(3, 4, null)).toBe(12);
    expect(isValidPuzzleBoard(Array.from({ length: 12 }, (_, i) => i), 12)).toBe(true);
    expect(isValidPuzzleBoard(Array.from({ length: 9 }, (_, i) => i), 12)).toBe(false);
    expect(isValidPuzzleBoard([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10], 12)).toBe(false);
  });
});
