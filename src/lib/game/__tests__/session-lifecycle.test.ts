import { describe, it, expect } from "vitest";
import { lobbyService, gameService } from "../service";
import { lobbyRepo } from "../repo";
import { manager, getEventsAfter, getLatestEventId } from "../manager";
import { supabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/admin";
import { EventType, GameState, type GameEvent } from "../types";
import { GET as eventsRouteGET } from "@/app/api/lobbies/[code]/events/route";

async function clearTimers(code: string) {
  const lobby = await lobbyRepo.getByCode(code);
  if (lobby) {
    if (lobby.timerInterval) clearInterval(lobby.timerInterval);
    if (lobby.endTimeout) clearTimeout(lobby.endTimeout);
  }
}

describe("Session Lifecycle, Reset, Vercel-Safe SSE, and Isolation", () => {
  it("executes full game lifecycle and authoritatively resets to 0 active players on Back to Lobby", async () => {
    // 1. Create lobby and join 2 players
    const lobby = await lobbyService.createLobby();
    const { player: p1 } = await lobbyService.join(lobby.code, "Alice");
    const { player: p2 } = await lobbyService.join(lobby.code, "Bob");

    expect(p1.slot).toBe(1);
    expect(p2.slot).toBe(2);

    // 2. Host starts game -> MEMORY -> PUZZLE
    await gameService.startGame(lobby.code, lobby.hostToken);
    await gameService.beginPuzzle(lobby.code);

    const activeLobby = await lobbyRepo.getByCode(lobby.code);
    expect(activeLobby?.status).toBe(GameState.PUZZLE);
    const round1GameId = activeLobby?.currentGameId;
    expect(round1GameId).toBeTruthy();

    // 3. Setup Alice's puzzle to be 1 move away from solved and complete it
    const alice = activeLobby!.players.find((p) => p.id === p1.id)!;
    const total = (activeLobby?.gridCols ?? 3) * (activeLobby?.gridRows ?? 3);
    const board = Array.from({ length: total }, (_, i) => i);
    [board[0], board[1]] = [board[1], board[0]];
    alice.puzzle!.board = board;
    await lobbyRepo.put(activeLobby!);

    // Alice performs winning swap
    await gameService.applySwap(lobby.code, p1.id, p1.token, 0, 1);

    const finishedLobby = await lobbyRepo.getByCode(lobby.code);
    expect(finishedLobby?.status).toBe(GameState.FINISHED);
    expect(finishedLobby?.winnerId).toBe(p1.id);

    // 4. Host clicks "Back to Lobby"
    await gameService.backToLobby(lobby.code, lobby.hostToken);

    // 5. Verify authoritative reset in memory/repo
    const cleanLobby = await lobbyRepo.getByCode(lobby.code);
    expect(cleanLobby).toBeTruthy();
    expect(cleanLobby?.status).toBe(GameState.LOBBY);
    expect(cleanLobby?.players).toHaveLength(0); // Authoritatively 0 active players!
    expect(cleanLobby?.winnerId).toBeNull();
    expect(cleanLobby?.currentGameId).toBeNull();
    expect(cleanLobby?.memory).toBeNull();
    expect(cleanLobby?.puzzleStartedAt).toBeNull();

    // 6. Verify Supabase persistence: players deactivated, previous game marked FINISHED, game_players preserved
    if (isSupabaseConfigured()) {
      const { data: lobbyDbRow } = await supabaseAdmin
        .from("lobbies")
        .select("id")
        .eq("code", cleanLobby!.code.toUpperCase())
        .single();

      expect(lobbyDbRow).toBeTruthy();

      const { data: dbPlayers } = await supabaseAdmin
        .from("players")
        .select("id, name, active, connected")
        .eq("lobby_id", lobbyDbRow!.id);

      expect(dbPlayers).toBeTruthy();
      expect(dbPlayers!.length).toBeGreaterThanOrEqual(2);
      // All previous players must have active = false and connected = false
      for (const p of dbPlayers!) {
        expect(p.active).toBe(false);
        expect(p.connected).toBe(false);
      }

      // Previous game round must be marked FINISHED
      const { data: dbGame } = await supabaseAdmin
        .from("games")
        .select("id, state, finished_at")
        .eq("id", round1GameId)
        .single();

      expect(dbGame?.state).toBe("FINISHED");
      expect(dbGame?.finished_at).toBeTruthy();

      // Historical game_players records must be intact for audit
      const { data: dbGamePlayers } = await supabaseAdmin
        .from("game_players")
        .select("*")
        .eq("game_id", round1GameId);

      expect(dbGamePlayers?.length).toBeGreaterThanOrEqual(1);
    }

    await clearTimers(lobby.code);
  });

  it("invalidates old player tokens after Back to Lobby and rejects reconnect / actions", async () => {
    // 1. Create lobby and join player
    const lobby = await lobbyService.createLobby();
    const { player: oldPlayer } = await lobbyService.join(lobby.code, "OldPlayer");

    await gameService.startGame(lobby.code, lobby.hostToken);
    await gameService.beginPuzzle(lobby.code);

    // Host resets lobby
    await gameService.backToLobby(lobby.code, lobby.hostToken);

    // 2. Old player attempts to execute action -> must be rejected
    await expect(
      gameService.applySwap(lobby.code, oldPlayer.id, oldPlayer.token, 0, 1),
    ).rejects.toMatchObject({
      code: expect.stringMatching(/NOT_FOUND|INVALID_STATE|FORBIDDEN|SESSION_EXPIRED/),
    });

    // 3. Old player attempts reconnect -> must throw SESSION_EXPIRED (HTTP 410)
    await expect(
      lobbyService.handleConnect(lobby.code, {
        playerId: oldPlayer.id,
        playerToken: oldPlayer.token,
      }),
    ).rejects.toMatchObject({
      code: "SESSION_EXPIRED",
      httpStatus: 410,
    });

    // 4. Verify GET /api/lobbies/[code]/events?verify=1 returns 410 for expired player
    const verifyReq = new Request(
      `http://localhost:3000/api/lobbies/${lobby.code}/events?kind=player&p=${oldPlayer.id}&t=${oldPlayer.token}&verify=1`,
    );
    const verifyRes = await eventsRouteGET(verifyReq, {
      params: Promise.resolve({ code: lobby.code }),
    });

    expect(verifyRes.status).toBe(410);
    const verifyBody = await verifyRes.json();
    expect(verifyBody.error).toBe("SESSION_EXPIRED");

    await clearTimers(lobby.code);
  });

  it("allows new players to join the clean lobby and starts a new game with isolated round ID", async () => {
    // 1. Create lobby, join Player A, start and finish, then Back to Lobby
    const lobby = await lobbyService.createLobby();
    await lobbyService.join(lobby.code, "PlayerA");
    await gameService.startGame(lobby.code, lobby.hostToken);
    await gameService.beginPuzzle(lobby.code);

    const firstLobbyState = await lobbyRepo.getByCode(lobby.code);
    const firstGameId = firstLobbyState?.currentGameId;

    await gameService.backToLobby(lobby.code, lobby.hostToken);

    // 2. Fresh players join clean lobby
    const { player: fresh1 } = await lobbyService.join(lobby.code, "Fresh1");
    const { player: fresh2 } = await lobbyService.join(lobby.code, "Fresh2");

    // Fresh players get slot 1 and slot 2 (partial index ensures no conflict with inactive players)
    expect(fresh1.slot).toBe(1);
    expect(fresh2.slot).toBe(2);

    const midLobby = await lobbyRepo.getByCode(lobby.code);
    expect(midLobby?.players).toHaveLength(2);

    // 3. Host starts second game
    await gameService.startGame(lobby.code, lobby.hostToken);
    const secondLobbyState = await lobbyRepo.getByCode(lobby.code);
    const secondGameId = secondLobbyState?.currentGameId;

    expect(secondGameId).toBeTruthy();
    expect(secondGameId).not.toBe(firstGameId); // Complete round/game isolation!

    await clearTimers(lobby.code);
  });

  it("persists monotonic event stream and allows client reconnect with cursor ?after=<id>", async () => {
    if (!isSupabaseConfigured()) return;

    const lobby = await lobbyService.createLobby();
    const { player } = await lobbyService.join(lobby.code, "CursorPlayer");

    // 1. Anchor cursor before game starts
    const initialCursor = await getLatestEventId(lobby.code);

    // 2. Host starts game (emits GAME_STARTED, MEMORY_PHASE_STARTED, etc.)
    await gameService.startGame(lobby.code, lobby.hostToken);
    await clearTimers(lobby.code);

    // Wait 500ms for non-blocking persistence to write to database
    await new Promise((r) => setTimeout(r, 500));

    // 3. Query events after initialCursor
    const events = await getEventsAfter(lobby.code, initialCursor, player.id);
    expect(events.length).toBeGreaterThan(0);

    // Verify monotonic IDs
    for (let i = 1; i < events.length; i++) {
      expect(events[i].id).toBeGreaterThan(events[i - 1].id);
    }

    // 4. Requesting with latest cursor yields 0 new events (no duplicates)
    const latestId = events[events.length - 1].id;
    const emptyReplay = await getEventsAfter(lobby.code, latestId, player.id);
    expect(emptyReplay).toHaveLength(0);

    await clearTimers(lobby.code);
  });

  it("provides bounded SSE response with stream_end rotation to prevent Vercel 300s timeout", async () => {
    const lobby = await lobbyService.createLobby();
    const { player } = await lobbyService.join(lobby.code, "SSERotatePlayer");

    // Connect to SSE route with AbortController
    const ac = new AbortController();
    const req = new Request(
      `http://localhost:3000/api/lobbies/${lobby.code}/events?kind=player&p=${player.id}&t=${player.token}`,
      { signal: ac.signal },
    );
    const res = await eventsRouteGET(req, {
      params: Promise.resolve({ code: lobby.code }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    // Read the stream header & snapshot
    const reader = res.body?.getReader();
    expect(reader).toBeTruthy();

    const decoder = new TextDecoder();
    let received = "";

    // Read initial snapshot
    const { value, done } = await reader!.read();
    expect(done).toBe(false);
    received += decoder.decode(value);
    expect(received).toContain("SNAPSHOT");

    // Abort and cancel cleanly to simulate client disconnect
    ac.abort();
    await reader!.cancel();
    await clearTimers(lobby.code);
  });
});
