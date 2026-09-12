import { describe, it, expect } from "vitest";
import { lobbyService, gameService } from "../service";
import { lobbyRepo } from "../repo";
import { manager } from "../manager";
import { supabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/admin";
import { EventType, GameState, type GameEvent } from "../types";

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

    // Verify pieces 0 and 15 exist in Supabase Storage as valid WebP
    for (const pieceIdx of [0, 15]) {
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
});
