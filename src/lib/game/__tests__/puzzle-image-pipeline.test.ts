import { describe, it, expect, afterEach, vi } from "vitest";
import { gameService, lobbyService } from "../service";
import { lobbyRepo } from "../repo";
import { GameState } from "../types";
import { imageService } from "../imageService";
import { supabaseAdmin } from "@/lib/supabase/admin";

describe("FUZAL — Puzzle Image Pipeline & Bug Fixes", () => {
  let createdLobbyCodes: string[] = [];

  afterEach(async () => {
    // Cleanup created test lobbies
    for (const code of createdLobbyCodes) {
      try {
        const l = await lobbyRepo.getByCode(code);
        if (l) {
          (lobbyRepo as any).processLobbies?.delete(code);
        }
      } catch (_) {
        // ignore cleanup errors
      }
    }
    createdLobbyCodes = [];
    vi.restoreAllMocks();
  });

  async function createTestLobbyWithPlayer() {
    const lobby = await lobbyService.createLobby({ gridSize: 3, maxPlayers: 5 });
    createdLobbyCodes.push(lobby.code);
    const joinRes = await lobbyService.join(lobby.code, "TestPlayer");
    return {
      lobby,
      player: joinRes.player,
      hostToken: lobby.hostToken,
      code: lobby.code,
    };
  }

  describe("Mandatory Serverless Test (No In-Memory Dependency)", () => {
    it("starts a game using an uploaded puzzle UUID after discarding all in-memory registration", async () => {
      const { code, hostToken, player } = await createTestLobbyWithPlayer();

      // Query an existing uploaded puzzle from Supabase DB
      const { data: dbPuzzles, error: qErr } = await supabaseAdmin
        .from("puzzle_images")
        .select("id, name, storage_path, active")
        .eq("active", true);

      expect(qErr).toBeNull();
      expect(dbPuzzles).toBeTruthy();
      expect(dbPuzzles!.length).toBeGreaterThan(0);

      // Pick an uploaded puzzle
      const targetPuzzle = dbPuzzles![0];

      // SIMULATION: Request/Process A did upload and registered in-memory.
      // Now Process B starts: Ensure target puzzle is NOT in local imageService memory
      const inMem = imageService.get(targetPuzzle.id);
      expect(inMem).toBeUndefined(); // Proves imageService does NOT know about this puzzle

      // REQUEST/PROCESS B: Start game with exact imageId
      await gameService.startGame(code, hostToken, targetPuzzle.id);

      // Verify lobby state
      const runningLobby = await lobbyRepo.getByCode(code);
      expect(runningLobby).toBeTruthy();
      expect(runningLobby!.status).toBe(GameState.MEMORY);
      expect(runningLobby!.memory).toBeTruthy();
      expect(runningLobby!.memory!.image).toBeTruthy();

      // Canonical GameImage assertions
      const memImage = runningLobby!.memory!.image;
      expect(memImage.id).toBe(targetPuzzle.id);
      expect(memImage.slug).toBe(targetPuzzle.storage_path);
      expect(memImage.source).toBe("uploaded");
      expect(memImage.name).toBe(targetPuzzle.name);
      expect(memImage.url).toContain(targetPuzzle.storage_path);

      // Verify game record in Supabase DB references exact puzzle_images.id
      expect(runningLobby!.currentGameId).toBeTruthy();
      const { data: gameRow, error: gErr } = await supabaseAdmin
        .from("games")
        .select("id, image_id")
        .eq("id", runningLobby!.currentGameId!)
        .single();

      expect(gErr).toBeNull();
      expect(gameRow!.image_id).toBe(targetPuzzle.id);
    });
  });

  describe("Mandatory Slug Collision Test (BUG E Resolution)", () => {
    it("serves UPLOADED pieces and never embedded assets when puzzle source is uploaded even if slug collides", async () => {
      // Mock Supabase storage download returning custom uploaded test piece
      const customUploadedMarker = "CUSTOM_UPLOADED_WEBP_MARKER";
      const customBuffer = Buffer.from(customUploadedMarker);

      // Create a test lobby with a colliding slug "cosmic-fox" marked as source="uploaded"
      const fakeUploadedId = "00000000-0000-4000-8000-000000000001";
      const collidingSlug = "cosmic-fox"; // Built-in slug!

      const testLobby = {
        id: "FZ-COLLIDE",
        code: "CLID",
        hostToken: "hosttoken1234567890",
        status: GameState.PUZZLE,
        gridCols: 3,
        gridRows: 3,
        pieceCount: 9,
        players: [
          {
            id: "player-collide-id",
            name: "CollisionPlayer",
            token: "playertoken1234567890",
            slot: 1,
            connected: true,
            score: 0,
            puzzle: null,
          },
        ],
        memory: {
          image: {
            id: fakeUploadedId,
            name: "Cosmic Fox Uploaded",
            slug: collidingSlug,
            url: `https://test.supabase.co/storage/v1/object/public/puzzle-images/${collidingSlug}/original.webp`,
            source: "uploaded" as const, // Explicit uploaded source
          },
          startedAt: Date.now() - 35000,
          endsAt: Date.now() - 5000,
          durationSeconds: 30,
        },
        usedImageIds: [fakeUploadedId],
      };

      (lobbyRepo as any).processLobbies.set("CLID", testLobby);
      createdLobbyCodes.push("CLID");

      // Spy on Supabase Storage .from() to return our custom buffer
      const downloadMock = vi.fn().mockImplementation(async () => ({
        data: {
          arrayBuffer: async () => customBuffer.buffer.slice(customBuffer.byteOffset, customBuffer.byteOffset + customBuffer.byteLength),
        },
        error: null,
      }));

      const fromSpy = vi.spyOn(supabaseAdmin.storage, "from").mockReturnValue({
        download: downloadMock,
      } as any);

      try {
        // 1. Test single piece endpoint
        const { GET: getPiece } = await import("@/app/api/lobbies/[code]/piece/[pieceId]/route");
        const pieceRes = await getPiece(
          new Request("http://localhost:3000/api/lobbies/CLID/piece/0?p=player-collide-id&t=playertoken1234567890"),
          { params: Promise.resolve({ code: "CLID", pieceId: "0" }) },
        );

        expect(pieceRes.status).toBe(200);
        const arrayBuf = await pieceRes.arrayBuffer();
        const pieceContent = Buffer.from(arrayBuf).toString();

        // Must match our uploaded storage buffer, NOT the embedded cosmic-fox buffer!
        expect(pieceContent).toBe(customUploadedMarker);
        expect(downloadMock).toHaveBeenCalled();

        // 2. Test batch pieces endpoint
        const { GET: getBatchPieces } = await import("@/app/api/lobbies/[code]/pieces/route");
        const batchRes = await getBatchPieces(
          new Request("http://localhost:3000/api/lobbies/CLID/pieces?p=player-collide-id&t=playertoken1234567890"),
          { params: Promise.resolve({ code: "CLID" }) },
        );

        expect(batchRes.status).toBe(200);
        const batchJson = await batchRes.json();
        expect(batchJson.ok).toBe(true);
        // Base64 encoded customUploadedMarker
        expect(batchJson.pieces[0]).toBe(`data:image/webp;base64,${customBuffer.toString("base64")}`);
      } finally {
        fromSpy.mockRestore();
      }
    });
  });

  describe("Controlled Failure on Missing / Inactive imageId (No Silent Fallback)", () => {
    it("rejects START_GAME with 404 when requested imageId does not exist and does NOT start random puzzle", async () => {
      const { code, hostToken } = await createTestLobbyWithPlayer();

      const nonExistentId = "ffffffff-ffff-4fff-8fff-ffffffffffff";

      // Attempt to start game with missing imageId
      await expect(gameService.startGame(code, hostToken, nonExistentId)).rejects.toMatchObject({
        httpStatus: 404,
        code: "NOT_FOUND",
      });

      // Verify lobby is still in LOBBY state and was NOT started with a fallback
      const lobby = await lobbyRepo.getByCode(code);
      expect(lobby!.status).toBe(GameState.LOBBY);
      expect(lobby!.memory).toBeFalsy();
    });
  });

  describe("START_GAME Action Schema & Dispatch", () => {
    it("accepts imageId in POST /api/lobbies/:code/actions", async () => {
      const { code, hostToken } = await createTestLobbyWithPlayer();

      // Query an existing active puzzle
      const { data: dbPuzzles } = await supabaseAdmin
        .from("puzzle_images")
        .select("id")
        .eq("active", true)
        .limit(1);

      const targetId = dbPuzzles![0].id;

      const { POST } = await import("@/app/api/lobbies/[code]/actions/route");

      const req = new Request(`http://localhost:3000/api/lobbies/${code}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "START_GAME",
          token: hostToken,
          imageId: targetId,
        }),
      });

      const res = await POST(req, { params: Promise.resolve({ code }) });
      expect(res.status).toBe(200);

      const runningLobby = await lobbyRepo.getByCode(code);
      expect(runningLobby!.status).toBe(GameState.MEMORY);
      expect(runningLobby!.memory!.image.id).toBe(targetId);
    });
  });
});
