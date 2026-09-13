import { describe, it, expect, vi } from "vitest";
import { withDbRetry, isTransientDbError } from "../repo";

describe("Database Resilience & Gateway Timeout Recovery", () => {
  it("isTransientDbError detects Gateway Timeout and transient codes", () => {
    expect(isTransientDbError({ message: "Gateway Timeout" })).toBe(true);
    expect(isTransientDbError({ message: "504 Gateway Time-out" })).toBe(true);
    expect(isTransientDbError({ message: "Bad Gateway" })).toBe(true);
    expect(isTransientDbError({ message: "Service Unavailable" })).toBe(true);
    expect(isTransientDbError({ message: "fetch failed" })).toBe(true);
    expect(isTransientDbError({ message: "connect ETIMEDOUT" })).toBe(true);
    expect(isTransientDbError({ code: "504" })).toBe(true);

    // Permanent errors must not be flagged as transient
    expect(isTransientDbError({ message: "violates foreign key constraint" })).toBe(false);
    expect(isTransientDbError({ message: "duplicate key value" })).toBe(false);
    expect(isTransientDbError(null)).toBe(false);
  });

  it("withDbRetry retries on Gateway Timeout and succeeds on subsequent attempt", async () => {
    let callCount = 0;
    const mockDbCall = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        return { data: null, error: { message: "Gateway Timeout" } };
      }
      return { data: { id: "lobby-123" }, error: null };
    });

    const result = await withDbRetry<{ id: string }>(
      "test_upsert_lobby",
      mockDbCall,
      3,
      10, // fast delay for test
    );

    expect(callCount).toBe(2);
    expect(result.data).toEqual({ id: "lobby-123" });
    expect(result.error).toBeNull();
  });

  it("withDbRetry retries on transient thrown exceptions and recovers", async () => {
    let callCount = 0;
    const mockDbCall = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error("TypeError: fetch failed");
      }
      return { data: [{ id: "p1" }], error: null };
    });

    const result = await withDbRetry<any[]>(
      "test_get_players",
      mockDbCall,
      3,
      10,
    );

    expect(callCount).toBe(2);
    expect(result.data).toEqual([{ id: "p1" }]);
    expect(result.error).toBeNull();
  });

  it("withDbRetry does not retry permanent errors (fails immediately)", async () => {
    let callCount = 0;
    const mockDbCall = vi.fn(async () => {
      callCount++;
      return { data: null, error: { message: "duplicate key value violates unique constraint" } };
    });

    const result = await withDbRetry<any>(
      "test_constraint_error",
      mockDbCall,
      3,
      10,
    );

    // Permanent error must NOT be retried 3 times
    expect(callCount).toBe(1);
    expect(result.error?.message).toContain("duplicate key");
  });

  it("persistEvent handles transient Gateway Timeout with bounded retries and returns undefined without throwing", async () => {
    const { persistEvent } = await import("../manager");
    const { supabaseAdmin } = await import("@/lib/supabase/admin");

    let insertAttempts = 0;
    const originalFrom = supabaseAdmin.from;

    // Spy on supabaseAdmin.from("lobby_events")
    supabaseAdmin.from = vi.fn((table: string) => {
      if (table === "lobby_events") {
        return {
          insert: vi.fn(() => ({
            select: vi.fn(() => ({
              abortSignal: vi.fn(() => ({
                single: vi.fn(async () => {
                  insertAttempts++;
                  return { data: null, error: { message: "Gateway Timeout", name: "GatewayTimeout" } };
                }),
              })),
            })),
          })),
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn(async () => ({ data: null, error: null })),
          })),
        } as any;
      }
      return originalFrom.call(supabaseAdmin, table);
    }) as any;

    try {
      const res = await persistEvent(
        "TEST",
        {
          type: "GAME_CLOSED" as any,
          payload: { reason: "HOST_RESET", previousGameId: "game-abc-123" },
          at: Date.now(),
        },
        null,
        null,
      );

      // Must be bounded to 3 attempts, must return undefined, must NOT throw
      expect(insertAttempts).toBe(3);
      expect(res).toBeUndefined();
    } finally {
      supabaseAdmin.from = originalFrom;
    }
  });

  it("persistEvent idempotency deduplicates on retry when row was already committed", async () => {
    const { persistEvent } = await import("../manager");
    const { supabaseAdmin } = await import("@/lib/supabase/admin");

    let insertAttempts = 0;
    const originalFrom = supabaseAdmin.from;

    supabaseAdmin.from = vi.fn((table: string) => {
      if (table === "lobby_events") {
        return {
          insert: vi.fn(() => ({
            select: vi.fn(() => ({
              abortSignal: vi.fn(() => ({
                single: vi.fn(async () => {
                  insertAttempts++;
                  // First attempt times out on the HTTP gateway after DB wrote the row
                  return { data: null, error: { message: "Gateway Timeout" } };
                }),
              })),
            })),
          })),
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            abortSignal: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn(async () => {
              // Attempt 2 idempotency check discovers the existing row in PostgreSQL
              return { data: { id: 9988 }, error: null };
            }),
          })),
        } as any;
      }
      return originalFrom.call(supabaseAdmin, table);
    }) as any;

    try {
      const res = await persistEvent(
        "TEST",
        {
          type: "PUZZLE_MOVE" as any,
          payload: { actionId: "swap-action-uuid-1", board: [0, 1] },
          at: Date.now(),
        },
        "player-1",
        "game-1",
      );

      // Succeeded via idempotency check on retry, avoided duplicate insertion!
      expect(res).toBe(9988);
      expect(insertAttempts).toBe(1);
    } finally {
      supabaseAdmin.from = originalFrom;
    }
  });

  it("getByCode preserves in-memory players when get_players encounters transient Gateway Timeout", async () => {
    const { SupabaseLobbyRepository } = await import("../repo");
    const { supabaseAdmin } = await import("@/lib/supabase/admin");
    const { GameState, PlayerConnection } = await import("../types");

    const repo = new SupabaseLobbyRepository();
    const testCode = "PTEST";

    // Populate repository in-memory state with active players
    const existingPlayer = {
      id: "p-uuid-1",
      name: "Player 1",
      token: "token-1234567890",
      joinedAt: Date.now(),
      connectionStatus: PlayerConnection.CONNECTED,
      score: 0,
      slot: 1,
      puzzle: null,
    };

    (repo as any).processLobbies.set(testCode, {
      code: testCode,
      status: GameState.LOBBY,
      hostToken: "host-token-1234567890",
      players: [existingPlayer],
      gridCols: 3,
      gridRows: 3,
      pieceCount: 9,
      version: 1,
      createdAt: Date.now(),
      maxPlayers: 5,
      usedImageIds: [],
      disconnectTimers: {},
    });

    const originalFrom = supabaseAdmin.from;

    supabaseAdmin.from = vi.fn((table: string) => {
      if (table === "lobbies") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn(async () => ({
            data: {
              id: "lobby-db-1",
              code: testCode,
              status: "LOBBY",
              host_token_hash: "host-token-1234567890",
              current_game_id: null,
              version: 1,
            },
            error: null,
          })),
        } as any;
      }
      if (table === "players") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn(async () => {
            // Simulated Gateway Timeout on players table
            return { data: null, error: { message: "Gateway Timeout" } };
          }),
        } as any;
      }
      return originalFrom.call(supabaseAdmin, table);
    }) as any;

    try {
      const lobby = await repo.getByCode(testCode);

      // Must NOT be null, and must NOT have wiped out the players array to []
      expect(lobby).not.toBeNull();
      expect(lobby?.players).toHaveLength(1);
      expect(lobby?.players[0].id).toBe("p-uuid-1");
      expect(lobby?.players[0].name).toBe("Player 1");
    } finally {
      supabaseAdmin.from = originalFrom;
    }
  });
});
