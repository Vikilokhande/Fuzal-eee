import { describe, it, expect } from "vitest";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { lobbyService } from "../service";
import { lobbyRepo } from "../repo";
import { GameState } from "../types";

const SLUGS = [
  "cosmic-fox",
  "futuristic-city",
  "space-explorer",
  "neon-cyberpunk",
  "abstract-geometry",
];

describe("Supabase Storage & Puzzle Asset Verification", () => {
  it("verifies all 5 puzzle image rows exist in puzzle_images table", async () => {
    const { data: rows, error } = await supabaseAdmin
      .from("puzzle_images")
      .select("*")
      .eq("active", true);

    expect(error).toBeNull();
    expect(rows).toBeTruthy();
    expect(rows!.length).toBeGreaterThanOrEqual(5);

    for (const slug of SLUGS) {
      const found = rows!.find((r) => r.storage_path === slug);
      expect(found).toBeTruthy();
      expect(found!.grid_rows).toBe(4);
      expect(found!.grid_columns).toBe(4);
      expect(found!.mime_type).toBe("image/webp");
    }
  });

  it("verifies original.webp and all 16 WebP pieces exist in Supabase Storage with HTTP 200 and image/webp", async () => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;

    const checks: Promise<void>[] = [];

    for (const slug of SLUGS) {
      // 1. Verify original image
      checks.push(
        (async () => {
          const originalUrl = `${supabaseUrl}/storage/v1/object/public/puzzle-images/${slug}/original.webp`;
          const origRes = await fetch(originalUrl, { method: "HEAD" });
          expect(origRes.status).toBe(200);
          expect(origRes.headers.get("content-type")).toContain("image/webp");
        })(),
      );

      // 2. Verify all 16 pre-generated tiles (00.webp ... 15.webp)
      for (let pieceId = 0; pieceId < 16; pieceId++) {
        const pieceStr = String(pieceId).padStart(2, "0");
        checks.push(
          (async () => {
            const tileUrl = `${supabaseUrl}/storage/v1/object/public/puzzle-images/${slug}/pieces/${pieceStr}.webp`;
            const tileRes = await fetch(tileUrl, { method: "HEAD" });
            expect(tileRes.status).toBe(200);
            expect(tileRes.headers.get("content-type")).toContain("image/webp");
          })(),
        );
      }
    }

    await Promise.all(checks);
  }, 30000);
});

describe("Supabase Relational Database Integrity", () => {
  it("creates a lobby in Supabase and verifies relational persistence", async () => {
    const lobby = await lobbyService.createLobby();
    expect(lobby.status).toBe(GameState.LOBBY);

    // Verify row in Supabase lobbies table
    const { data: lobbyRow, error: lErr } = await supabaseAdmin
      .from("lobbies")
      .select("*")
      .eq("code", lobby.code)
      .single();

    expect(lErr).toBeNull();
    expect(lobbyRow).toBeTruthy();
    expect(lobbyRow.code).toBe(lobby.code);
    expect(lobbyRow.max_players).toBe(5);

    // Join 5 players
    const names = ["Alpha", "Bravo", "Charlie", "Delta", "Echo"];
    for (let i = 0; i < 5; i++) {
      const { player } = await lobbyService.join(lobby.code, names[i]);
      expect(player.slot).toBe(i + 1);
    }

    // Verify players stored in Supabase players table
    const { data: playerRows, error: pErr } = await supabaseAdmin
      .from("players")
      .select("*")
      .eq("lobby_id", lobbyRow.id)
      .order("slot", { ascending: true });

    expect(pErr).toBeNull();
    expect(playerRows).toHaveLength(5);

    // 6th player must be rejected with 409 FULL
    await expect(lobbyService.join(lobby.code, "Foxtrot")).rejects.toMatchObject({
      code: "FULL",
      httpStatus: 409,
    });

    // Cleanup
    await lobbyRepo.deleteByCode(lobby.code);
    const deleted = await lobbyRepo.getByCode(lobby.code);
    expect(deleted).toBeNull();
  });
});
