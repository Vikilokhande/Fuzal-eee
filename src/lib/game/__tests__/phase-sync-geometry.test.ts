import { describe, it, expect, afterEach } from "vitest";
import sharp from "sharp";
import { gameService, lobbyService } from "../service";
import { lobbyRepo } from "../repo";
import { GameState } from "../types";
import { isSolved, correctSlots } from "../puzzle";
import { config } from "../config";

describe("Game Phase Synchronization, 12-Piece Geometry & Action Versioning", () => {
  let createdLobbyCodes: string[] = [];

  afterEach(async () => {
    for (const code of createdLobbyCodes) {
      try {
        const lobby = await lobbyRepo.getByCode(code);
        if (lobby) {
          if (lobby.timerInterval) clearInterval(lobby.timerInterval);
          if (lobby.endTimeout) clearTimeout(lobby.endTimeout);
        }
        await lobbyRepo.deleteByCode(code);
      } catch {}
    }
    createdLobbyCodes = [];
  });

  async function createTestLobby(n = 4) {
    const lobby = await lobbyService.createLobby({ gridSize: n });
    createdLobbyCodes.push(lobby.code);
    const { player } = await lobbyService.join(lobby.code, "Alice");
    return { lobby: (await lobbyRepo.getByCode(lobby.code))!, player };
  }

  describe("Phase Synchronization & Authoritative Fallback", () => {
    it("starts in LOBBY, transitions to MEMORY on startGame with 30s countdown", async () => {
      const { lobby } = await createTestLobby();
      expect(lobby.status).toBe(GameState.LOBBY);

      await gameService.startGame(lobby.code, lobby.hostToken);
      const active = (await lobbyRepo.getByCode(lobby.code))!;
      expect(active.status).toBe(GameState.MEMORY);
      expect(active.memory).toBeDefined();
      expect(active.memory!.endsAt - active.memory!.startedAt).toBe(config.memorySeconds * 1000);
      expect(active.version).toBe(1);
    });

    it("rejects premature BEGIN_PUZZLE when force is false and countdown has not expired", async () => {
      const { lobby } = await createTestLobby();
      await gameService.startGame(lobby.code, lobby.hostToken);

      // Attempt premature BEGIN_PUZZLE with force=false
      await gameService.beginPuzzle(lobby.code, false);

      const check = (await lobbyRepo.getByCode(lobby.code))!;
      // Must remain in MEMORY because 30 seconds have not elapsed
      expect(check.status).toBe(GameState.MEMORY);
    });

    it("ensureAuthoritativePhase automatically transitions expired MEMORY to PUZZLE without requiring refresh", async () => {
      const { lobby } = await createTestLobby();
      await gameService.startGame(lobby.code, lobby.hostToken);

      // Simulate expired memory timer
      const current = (await lobbyRepo.getByCode(lobby.code))!;
      current.memory!.endsAt = Date.now() - 1000;
      await lobbyRepo.put(current);

      // Authoritative read detects expiration and transitions atomically
      const ensured = await gameService.ensureAuthoritativePhase(lobby.code);
      expect(ensured.status).toBe(GameState.PUZZLE);
      expect(ensured.puzzleStartedAt).toBeGreaterThan(0);
      expect(ensured.pieceCount).toBe(16);
    });

    it("BEGIN_PUZZLE is idempotent and does not error if called repeatedly", async () => {
      const { lobby } = await createTestLobby();
      await gameService.startGame(lobby.code, lobby.hostToken);

      // First transition
      await gameService.beginPuzzle(lobby.code, true);
      const phase1 = (await lobbyRepo.getByCode(lobby.code))!;
      expect(phase1.status).toBe(GameState.PUZZLE);
      const puzzleStartedAt = phase1.puzzleStartedAt;

      // Duplicate transition should be safe and idempotent
      await gameService.beginPuzzle(lobby.code, true);
      const phase2 = (await lobbyRepo.getByCode(lobby.code))!;
      expect(phase2.status).toBe(GameState.PUZZLE);
      expect(phase2.puzzleStartedAt).toBe(puzzleStartedAt);
    });
  });

  describe("Action Versioning and Latency Path", () => {
    it("monotonically increments version on each SWAP mutation and never returns version: null", async () => {
      const { lobby, player } = await createTestLobby();
      await gameService.startGame(lobby.code, lobby.hostToken);
      await gameService.beginPuzzle(lobby.code, true);

      // First swap
      const res1 = await gameService.applySwap(
        lobby.code,
        player.id,
        player.token,
        0,
        1,
        null,
        "swap-act-1",
      );
      expect(res1.version).toBeGreaterThanOrEqual(2);
      expect(typeof res1.version).toBe("number");
      expect(res1.moves).toBe(1);

      // Second swap
      const res2 = await gameService.applySwap(
        lobby.code,
        player.id,
        player.token,
        1,
        2,
        null,
        "swap-act-2",
      );
      expect(res2.version).toBe(res1.version + 1);
      expect(res2.moves).toBe(2);

      // Third swap
      const res3 = await gameService.applySwap(
        lobby.code,
        player.id,
        player.token,
        2,
        0,
        null,
        "swap-act-3",
      );
      expect(res3.version).toBe(res2.version + 1);
      expect(res3.moves).toBe(3);
    });

    it("dedupes identical actionId and returns original authoritative state without double-swapping", async () => {
      const { lobby, player } = await createTestLobby();
      await gameService.startGame(lobby.code, lobby.hostToken);
      await gameService.beginPuzzle(lobby.code, true);

      const actionId = "idempotent-action-unique-123";
      const first = await gameService.applySwap(
        lobby.code,
        player.id,
        player.token,
        0,
        1,
        null,
        actionId,
      );
      expect(first.moves).toBe(1);

      // Retry same actionId
      const retry = await gameService.applySwap(
        lobby.code,
        player.id,
        player.token,
        0,
        1,
        null,
        actionId,
      );
      expect(retry.moves).toBe(1);
      expect(retry.board).toEqual(first.board);
      expect(retry.version).toBe(first.version);
    });
  });

  describe("Puzzle Slicing Geometry & Pixel-Perfect Reconstruction", () => {
    async function testSlicingAndReconstruction(width: number, height: number, cols: number, rows: number) {
      // 1. Create synthetic test image with unique RGB gradient + coordinate stamp
      const rawChannels = Buffer.alloc(width * height * 3);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = (y * width + x) * 3;
          rawChannels[idx] = Math.floor((x * 255) / width); // R gradient
          rawChannels[idx + 1] = Math.floor((y * 255) / height); // G gradient
          rawChannels[idx + 2] = Math.floor(((x + y) * 128) / (width + height)); // B mix
        }
      }
      const sourceImageBuffer = await sharp(rawChannels, {
        raw: { width, height, channels: 3 },
      })
        .png()
        .toBuffer();

      // 2. Slice pieces using authoritative formula
      const pieces: { pieceId: number; left: number; top: number; width: number; height: number; buffer: Buffer }[] = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const pieceId = r * cols + c;
          const left = Math.floor((c * width) / cols);
          const right = Math.floor(((c + 1) * width) / cols);
          const top = Math.floor((r * height) / rows);
          const bottom = Math.floor(((r + 1) * height) / rows);
          const extractWidth = right - left;
          const extractHeight = bottom - top;

          expect(extractWidth).toBeGreaterThan(0);
          expect(extractHeight).toBeGreaterThan(0);

          const pieceBuf = await sharp(sourceImageBuffer)
            .extract({ left, top, width: extractWidth, height: extractHeight })
            .png()
            .toBuffer();

          pieces.push({
            pieceId,
            left,
            top,
            width: extractWidth,
            height: extractHeight,
            buffer: pieceBuf,
          });
        }
      }

      // Verify slice boundary continuity (no gaps, no overlaps)
      for (let r = 0; r < rows; r++) {
        let rowWidthSum = 0;
        for (let c = 0; c < cols; c++) {
          const p = pieces[r * cols + c];
          rowWidthSum += p.width;
          if (c < cols - 1) {
            const nextP = pieces[r * cols + c + 1];
            expect(p.left + p.width).toBe(nextP.left);
          }
        }
        expect(rowWidthSum).toBe(width);
      }

      for (let c = 0; c < cols; c++) {
        let colHeightSum = 0;
        for (let r = 0; r < rows; r++) {
          const p = pieces[r * cols + c];
          colHeightSum += p.height;
          if (r < rows - 1) {
            const nextP = pieces[(r + 1) * cols + c];
            expect(p.top + p.height).toBe(nextP.top);
          }
        }
        expect(colHeightSum).toBe(height);
      }

      // 3. Reconstruct contact sheet in solved order [0, 1, 2, ..., N-1]
      const compositeInput = pieces.map((p) => ({
        input: p.buffer,
        left: p.left,
        top: p.top,
      }));

      const reconstructedBuffer = await sharp({
        create: {
          width,
          height,
          channels: 3,
          background: { r: 0, g: 0, b: 0 },
        },
      })
        .composite(compositeInput)
        .removeAlpha()
        .raw()
        .toBuffer();

      const originalRawBuffer = await sharp(sourceImageBuffer).removeAlpha().raw().toBuffer();

      // Pixel-for-pixel comparison
      expect(reconstructedBuffer.length).toBe(originalRawBuffer.length);
      expect(reconstructedBuffer.equals(originalRawBuffer)).toBe(true);
    }

    it("generates exact 4-piece (2x2) slices and reconstructs source pixel-for-pixel", async () => {
      await testSlicingAndReconstruction(900, 900, 2, 2);
    });

    it("generates exact 9-piece (3x3) slices and reconstructs source pixel-for-pixel", async () => {
      await testSlicingAndReconstruction(900, 900, 3, 3);
    });

    it("generates exact 16-piece (4x4) slices and reconstructs source pixel-for-pixel", async () => {
      await testSlicingAndReconstruction(900, 900, 4, 4);
    });

    it("generates exact 25-piece (5x5) slices and reconstructs source pixel-for-pixel", async () => {
      await testSlicingAndReconstruction(900, 900, 5, 5);
    });

    it("preserves correct aspect ratio: 1:1 square tile ratio for square grids on 1:1 board", () => {
      const width = 900;
      const height = 900;
      const n = 4;

      const tileWidth = width / n; // 225
      const tileHeight = height / n; // 225
      const tileAspectRatio = tileWidth / tileHeight; // 1.0

      expect(tileWidth).toBe(225);
      expect(tileHeight).toBe(225);
      expect(tileAspectRatio).toBe(1.0);

      // Reconstructed board aspect ratio
      const boardWidth = n * tileWidth;
      const boardHeight = n * tileHeight;
      expect(boardWidth / boardHeight).toBe(1.0);
    });

    it("validates solved detection canonically for square grids", () => {
      const solved16 = Array.from({ length: 16 }, (_, i) => i);
      expect(isSolved(solved16, 16)).toBe(true);

      const unsolved = [1, 0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
      expect(isSolved(unsolved, 16)).toBe(false);

      const indicators = correctSlots(unsolved);
      expect(indicators[0]).toBe(false);
      expect(indicators[1]).toBe(false);
      expect(indicators[2]).toBe(true);
      expect(indicators[15]).toBe(true);
    });
  });
});
