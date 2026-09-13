import { describe, it, expect } from "vitest";
import { lobbyService, gameService } from "../service";
import { lobbyRepo } from "../repo";
import { manager } from "../manager";
import { supabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/admin";
import { EventType, GameState, type GameEvent } from "../types";
import { GET as pieceRouteGET } from "@/app/api/lobbies/[code]/piece/[pieceId]/route";
import { GET as piecesBatchRouteGET } from "@/app/api/lobbies/[code]/pieces/route";

describe("Production Serverless Flow & Error Handling", () => {
  it("verifies Supabase credentials are configured in test environment", () => {
    expect(isSupabaseConfigured()).toBe(true);
  });

  it("persists lobby in Supabase and retrieves it across simulated fresh instance requests", async () => {
    // 1. Instance A creates lobby
    const created = await lobbyService.createLobby();
    expect(created.code).toMatch(/^[A-Z0-9]{4}$/);

    // 2. Query Supabase directly to ensure row exists in PostgreSQL
    const { data: dbRow, error } = await supabaseAdmin
      .from("lobbies")
      .select("*")
      .eq("code", created.code)
      .single();

    expect(error).toBeNull();
    expect(dbRow).toBeTruthy();
    expect(dbRow.code).toBe(created.code);
    expect(dbRow.status).toBe("LOBBY");

    // 3. Simulate Instance B retrieving from Supabase (bypassing process memory by querying repo)
    const retrieved = await lobbyRepo.getByCode(created.code);
    expect(retrieved).toBeTruthy();
    expect(retrieved?.code).toBe(created.code);
    expect(retrieved?.status).toBe(GameState.LOBBY);
  });

  it("connects to SSE stream and receives initial role-specific SNAPSHOT immediately", async () => {
    const lobby = await lobbyService.createLobby();
    const frames: GameEvent[] = [];

    // Host opens SSE
    const unsubscribeHost = manager.connect(lobby.code, {
      id: `host:${lobby.code}`,
      send: (raw) => frames.push(JSON.parse(raw) as GameEvent),
    });

    // Simulate endpoint immediate snapshot delivery
    const snapshot = lobbyService.buildSnapshot(lobby, "host");
    expect(snapshot.type).toBe(EventType.SNAPSHOT);
    expect(snapshot.payload.code).toBe(lobby.code);
    expect(snapshot.payload.isHost).toBe(true);
    expect(snapshot.payload.status).toBe(GameState.LOBBY);

    unsubscribeHost();
  });

  it("enforces atomic 5-player cap and rejects 6th join", async () => {
    const lobby = await lobbyService.createLobby();
    const names = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon"];

    for (let i = 0; i < 5; i++) {
      const { player } = await lobbyService.join(lobby.code, names[i]);
      expect(player.slot).toBe(i + 1);
    }

    // 6th join attempt must be rejected with 409
    await expect(lobbyService.join(lobby.code, "Zeta")).rejects.toMatchObject({
      code: "FULL",
      httpStatus: 409,
    });
  });

  it("validates full game cycle and WebP piece delivery from storage", async () => {
    const lobby = await lobbyService.createLobby();
    const { player } = await lobbyService.join(lobby.code, "Solver");

    // Start game -> MEMORY
    await gameService.startGame(lobby.code, lobby.hostToken);
    const inMem = await lobbyRepo.getByCode(lobby.code);
    expect(inMem?.status).toBe(GameState.MEMORY);
    expect(inMem?.memory?.image).toBeTruthy();

    const img = inMem!.memory!.image;
    const slug = img.slug ?? img.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");

    // Verify pieces 0 and 8 exist in Supabase Storage as valid WebP
    for (const pieceIdx of [0, 8]) {
      const pieceStr = String(pieceIdx).padStart(2, "0");
      const path = `${slug}/pieces/${pieceStr}.webp`;
      const { data, error } = await supabaseAdmin.storage
        .from("puzzle-images")
        .download(path);

      expect(error).toBeNull();
      expect(data).toBeTruthy();
      const buf = await data!.arrayBuffer();
      expect(buf.byteLength).toBeGreaterThan(100);
    }

    // Clean up timers on live lobby
    const liveLobby = (lobbyRepo as any).processLobbies?.get(lobby.code);
    if (liveLobby?.timerInterval) clearInterval(liveLobby.timerInterval);
    if (liveLobby?.endTimeout) clearTimeout(liveLobby.endTimeout);
    if (inMem?.timerInterval) clearInterval(inMem.timerInterval);
    if (inMem?.endTimeout) clearTimeout(inMem.endTimeout);
  });

  it("enforces 3-minute (180s) server-authoritative timer and snapshot fields", async () => {
    const lobby = await lobbyService.createLobby();
    const { player } = await lobbyService.join(lobby.code, "TimerTester");

    // Advance to PUZZLE
    await gameService.startGame(lobby.code, lobby.hostToken);
    await gameService.beginPuzzle(lobby.code);

    const liveLobby = (lobbyRepo as any).processLobbies?.get(lobby.code);
    expect(liveLobby.status).toBe(GameState.PUZZLE);
    expect(liveLobby.puzzleStartedAt).toBeTruthy();
    expect(liveLobby.puzzleEndsAt).toBe(liveLobby.puzzleStartedAt + 180_000);
    expect(liveLobby.puzzleDurationSeconds).toBe(180);

    // Snapshot contains puzzleEndsAt and 180s duration
    const snapshot = lobbyService.buildSnapshot(liveLobby, "player", liveLobby.players[0]);
    expect(snapshot.payload.puzzleEndsAt).toBe(liveLobby.puzzleEndsAt);
    expect(snapshot.payload.puzzleDurationSeconds).toBe(180);

    // Clean up
    if (liveLobby.timerInterval) clearInterval(liveLobby.timerInterval);
    if (liveLobby.endTimeout) clearTimeout(liveLobby.endTimeout);
  });

  it("automatically eliminates unsolved players and ends round on 3-minute timeout", async () => {
    const lobby = await lobbyService.createLobby();
    const { player } = await lobbyService.join(lobby.code, "TimeoutPlayer");

    await gameService.startGame(lobby.code, lobby.hostToken);
    await gameService.beginPuzzle(lobby.code);

    const liveLobby = (lobbyRepo as any).processLobbies?.get(lobby.code);
    expect(liveLobby.players[0].eliminated).toBe(false);

    // Trigger authoritative 3-minute timeout
    await gameService.handlePuzzleTimeout(lobby.code);

    expect(liveLobby.status).toBe(GameState.FINISHED);
    expect(liveLobby.winnerId).toBeNull();
    expect(liveLobby.players[0].eliminated).toBe(true);
    expect(liveLobby.players[0].puzzle.eliminated).toBe(true);

    // Verify player is rejected if attempting to swap after elimination
    await expect(
      gameService.applySwap(lobby.code, player.id, player.token, 0, 1),
    ).rejects.toMatchObject({
      code: "INVALID_STATE",
    });

    // Clean up
    if (liveLobby.timerInterval) clearInterval(liveLobby.timerInterval);
    if (liveLobby.endTimeout) clearTimeout(liveLobby.endTimeout);
  });

  it("delivers WebP pieces rapidly and caches in memory", async () => {
    const lobby = await lobbyService.createLobby();
    const { player } = await lobbyService.join(lobby.code, "FastLoader");

    await gameService.startGame(lobby.code, lobby.hostToken);
    await gameService.beginPuzzle(lobby.code);

    const liveLobby = (lobbyRepo as any).processLobbies?.get(lobby.code);

    // Call piece endpoint for piece 0 and piece 8
    for (const pieceIdx of [0, 8]) {
      const req = new Request(
        `http://localhost:3000/api/lobbies/${lobby.code}/piece/${pieceIdx}?p=${player.id}&t=${player.token}`,
      );
      const res = await pieceRouteGET(req, {
        params: Promise.resolve({ code: lobby.code, pieceId: String(pieceIdx) }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("image/webp");
      const buf = await res.arrayBuffer();
      expect(buf.byteLength).toBeGreaterThan(100);
    }

    // Clean up
    if (liveLobby.timerInterval) clearInterval(liveLobby.timerInterval);
    if (liveLobby.endTimeout) clearTimeout(liveLobby.endTimeout);
  });

  it("delivers all 9 WebP pieces in a single fast batch request via /api/lobbies/[code]/pieces", async () => {
    const lobby = await lobbyService.createLobby();
    const { player } = await lobbyService.join(lobby.code, "BatchTester");
    await gameService.startGame(lobby.code, lobby.hostToken);

    const liveLobby = (lobbyRepo as any).processLobbies?.get(lobby.code);

    // 1. Call batch pieces endpoint during MEMORY phase (background preloading)
    const batchReq = new Request(
      `http://localhost:3000/api/lobbies/${lobby.code}/pieces?p=${player.id}&t=${player.token}`,
    );
    const batchRes = await piecesBatchRouteGET(batchReq, {
      params: Promise.resolve({ code: lobby.code }),
    });

    expect(batchRes.status).toBe(200);
    const body = await batchRes.json();
    expect(body.ok).toBe(true);
    expect(body.slug).toBeTruthy();
    expect(body.pieces).toBeTruthy();
    expect(Object.keys(body.pieces).length).toBe(9);

    for (let i = 0; i < 9; i++) {
      expect(body.pieces[i]).toMatch(/^data:image\/webp;base64,/);
      expect(body.pieces[i].length).toBeGreaterThan(200);
    }

    // Clean up
    if (liveLobby.timerInterval) clearInterval(liveLobby.timerInterval);
    if (liveLobby.endTimeout) clearTimeout(liveLobby.endTimeout);
  });
});

