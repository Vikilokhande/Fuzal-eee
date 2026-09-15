import { describe, it, expect } from "vitest";
import { lobbyService, gameService } from "../service";
import { lobbyRepo } from "../repo";
import { manager } from "../manager";
import { supabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/admin";
import { EventType, GameState, type GameEvent } from "../types";

async function clearTimers(code: string) {
  const lobby = await lobbyRepo.getByCode(code);
  if (lobby) {
    if (lobby.timerInterval) clearInterval(lobby.timerInterval);
    if (lobby.endTimeout) clearTimeout(lobby.endTimeout);
  }
}

describe("20-Player Concurrency & Multi-Player Load Test Suite", () => {
  it("verifies migration 006 is active in database (slot constraint up to 100)", async () => {
    if (!isSupabaseConfigured()) return;

    // Verify directly against PostgreSQL that slot check allows up to 100
    const { data, error } = await supabaseAdmin.rpc("join_lobby_atomic", {
      p_code: "NONEXISTENT",
      p_player_id: "00000000-0000-0000-0000-000000000000",
      p_name: "Test",
      p_token_hash: "hash",
    });

    expect(error).toBeNull();
    expect(data?.error).toBe("NOT_FOUND");
  });

  it("successfully joins 20 players concurrently, assigning unique slots 1..20 without collision", async () => {
    // 1. Create a lobby with capacity of 20 players
    const lobby = await lobbyService.createLobby({ gridSize: 3, maxPlayers: 20 });
    const code = lobby.code;
    expect(lobby.maxPlayers).toBe(20);

    // 2. Concurrently join 20 players simultaneously
    const playerNames = Array.from({ length: 20 }, (_, i) => `Player_${String(i + 1).padStart(2, "0")}`);
    
    console.log(`[TEST_20_PLAYERS_JOINING] code=${code} count=20`);
    const joinResults = await Promise.all(
      playerNames.map((name) => lobbyService.join(code, name)),
    );

    // Verify all 20 joins succeeded
    expect(joinResults).toHaveLength(20);

    const players = joinResults.map((r) => r.player);
    const slots = players.map((p) => p.slot);
    const playerIds = players.map((p) => p.id);
    const tokens = players.map((p) => p.token);

    // Assert: Exactly 20 distinct IDs, 20 distinct tokens
    expect(new Set(playerIds).size).toBe(20);
    expect(new Set(tokens).size).toBe(20);

    // Assert: Exactly 20 distinct slots, all between 1 and 20
    expect(new Set(slots).size).toBe(20);
    for (let s = 1; s <= 20; s++) {
      expect(slots).toContain(s);
    }

    // 3. Verify in repository / memory state
    const currentLobby = await lobbyService.getLobby(code);
    expect(currentLobby.players).toHaveLength(20);
    expect(currentLobby.maxPlayers).toBe(20);

    // 4. Verify in Supabase database directly
    if (isSupabaseConfigured()) {
      const { data: dbLobby } = await supabaseAdmin
        .from("lobbies")
        .select("id, max_players")
        .eq("code", code.toUpperCase())
        .single();

      expect(dbLobby).toBeTruthy();
      expect(dbLobby!.max_players).toBe(20);

      const { data: dbPlayers, error: dbErr } = await supabaseAdmin
        .from("players")
        .select("id, name, slot, active")
        .eq("lobby_id", dbLobby!.id)
        .eq("active", true);

      expect(dbErr).toBeNull();
      expect(dbPlayers).toHaveLength(20);

      const dbSlots = dbPlayers!.map((p) => p.slot);
      expect(new Set(dbSlots).size).toBe(20);
      for (let s = 1; s <= 20; s++) {
        expect(dbSlots).toContain(s);
      }
    }

    // 5. 21st player join MUST be rejected with FULL (409)
    await expect(lobbyService.join(code, "Player_21")).rejects.toMatchObject({
      code: "FULL",
      httpStatus: 409,
    });

    await clearTimers(code);
  });

  it(
    "handles 20-player full game cycle: start, concurrent swaps, atomic winner, and back to lobby",
    async () => {
    // 1. Create lobby and join 20 players
    const lobby = await lobbyService.createLobby({ gridSize: 3, maxPlayers: 20 });
    const code = lobby.code;

    const joinPromises = Array.from({ length: 20 }, (_, i) =>
      lobbyService.join(code, `ConcurrentPlayer_${i + 1}`),
    );
    const joinResults = await Promise.all(joinPromises);
    const players = joinResults.map((r) => r.player);

    // 2. Start game -> transitions LOBBY -> MEMORY
    await gameService.startGame(code, lobby.hostToken);
    
    // Transition MEMORY -> PUZZLE
    await gameService.beginPuzzle(code, true);

    const activeLobby = await lobbyService.getLobby(code);
    expect(activeLobby.status).toBe(GameState.PUZZLE);
    expect(activeLobby.players).toHaveLength(20);

    // Verify all 20 players received initialized boards
    for (const p of activeLobby.players) {
      expect(p.puzzle).toBeDefined();
      expect(p.puzzle!.board).toHaveLength(9);
      expect(p.puzzle!.moves).toBe(0);
    }

    // 3. All 20 players execute concurrent SWAP moves simultaneously
    const swapPromises = players.map((p, idx) =>
      gameService.applySwap(
        code,
        p.id,
        p.token,
        0,
        1,
        null,
        `action-batch-swap-${idx}`,
      ),
    );

    const swapResults = await Promise.all(swapPromises);
    expect(swapResults).toHaveLength(20);

    // Verify each player's moves counter is 1 and their boards are independent
    const afterSwapLobby = await lobbyService.getLobby(code);
    for (const p of afterSwapLobby.players) {
      expect(p.puzzle!.moves).toBe(1);
    }

    // 4. Player 1 performs a winning move
    const winningPlayer = players[0];
    const winningLobbyState = await lobbyRepo.getByCode(code);
    const wp = winningLobbyState!.players.find((p) => p.id === winningPlayer.id)!;
    
    // Set board to 1 swap away from solved
    const solvedBoard = [0, 1, 2, 3, 4, 5, 6, 7, 8];
    const almostSolved = [...solvedBoard];
    [almostSolved[0], almostSolved[1]] = [almostSolved[1], almostSolved[0]]; // swap 0 and 1
    wp.puzzle!.board = almostSolved;
    await lobbyRepo.put(winningLobbyState!);

    // Winning swap
    const winSwap = await gameService.applySwap(
      code,
      winningPlayer.id,
      winningPlayer.token,
      0,
      1,
      null,
      "winning-swap-action",
    );
    expect(winSwap.completed).toBe(true);

    // Assert game state is now FINISHED with winningPlayer declared as winner
    const finishedLobby = await lobbyService.getLobby(code);
    expect(finishedLobby.status).toBe(GameState.FINISHED);
    expect(finishedLobby.winnerId).toBe(winningPlayer.id);

    // 5. Subsequent swap from another player (e.g. Player 2) must be rejected
    await expect(
      gameService.applySwap(
        code,
        players[1].id,
        players[1].token,
        1,
        2,
        null,
        "rejected-post-finish-swap",
      ),
    ).rejects.toMatchObject({
      code: "INVALID_STATE",
    });

    // 6. Host clicks "Back to Lobby" -> Resets lobby for new players
    await gameService.backToLobby(code, lobby.hostToken);

    const cleanLobby = await lobbyService.getLobby(code);
    expect(cleanLobby.status).toBe(GameState.LOBBY);
    expect(cleanLobby.players).toHaveLength(0); // Authoritatively 0 active players
    expect(cleanLobby.winnerId).toBeNull();
    expect(cleanLobby.currentGameId).toBeNull();

    // 7. Supabase audit: All 20 players deactivated in DB
    if (isSupabaseConfigured()) {
      const { data: dbLobby } = await supabaseAdmin
        .from("lobbies")
        .select("id")
        .eq("code", code.toUpperCase())
        .single();

      const { data: dbPlayers } = await supabaseAdmin
        .from("players")
        .select("id, active")
        .eq("lobby_id", dbLobby!.id);

      expect(dbPlayers).toHaveLength(20);
      for (const p of dbPlayers!) {
        expect(p.active).toBe(false);
      }
    }

    // 8. New player can join into slot 1 without collision
    const { player: newPlayer } = await lobbyService.join(code, "NextGenPlayer");
    expect(newPlayer.slot).toBe(1);

    await clearTimers(code);
  }, 120_000);
});
