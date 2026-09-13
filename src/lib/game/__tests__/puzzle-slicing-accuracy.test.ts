import { describe, it, expect, beforeEach } from "vitest";
import sharp from "sharp";
import {
  calculatePieceRect,
  slicePiece,
  sliceAllPieces,
  clearSlicerCache,
} from "../slicer";
import { createLobbySchema, SUPPORTED_GRID_SIZES, isSupportedGridSize } from "../types";
import { lobbyService } from "../service";

describe("FUZAL Slicing & Grid Accuracy — Supported 2x2 through 8x8 Grids", () => {
  const SIZES = [2, 3, 4, 5, 6, 7, 8] as const;
  const TEST_DIMENSIONS = [
    { width: 900, height: 900 },
    { width: 800, height: 800 },
    { width: 1024, height: 1024 },
  ];

  describe("1. Geometric Boundary Verification (No Gaps, No Overlaps, Exact Coverage)", () => {
    for (const N of SIZES) {
      for (const { width, height } of TEST_DIMENSIONS) {
        it(`verifies ${N}x${N} grid on ${width}x${height} source has zero gaps, zero overlaps, and exact coverage`, () => {
          const total = N * N;
          const rects = Array.from({ length: total }, (_, pieceId) =>
            calculatePieceRect(width, height, N, pieceId),
          );

          // 1. Piece count
          expect(rects).toHaveLength(total);

          // 2. Every piece has positive width and height
          for (const r of rects) {
            expect(r.width).toBeGreaterThan(0);
            expect(r.height).toBeGreaterThan(0);
            expect(r.x0).toBeGreaterThanOrEqual(0);
            expect(r.y0).toBeGreaterThanOrEqual(0);
            expect(r.x1).toBeLessThanOrEqual(width);
            expect(r.y1).toBeLessThanOrEqual(height);
          }

          // 3. Check horizontal continuity within each row (zero gaps, zero overlaps)
          for (let row = 0; row < N; row++) {
            let expectedX = 0;
            for (let col = 0; col < N; col++) {
              const pieceId = row * N + col;
              const r = rects[pieceId];
              expect(r.col).toBe(col);
              expect(r.row).toBe(row);
              expect(r.x0).toBe(expectedX);
              expectedX = r.x1;
            }
            expect(expectedX).toBe(width);
          }

          // 4. Check vertical continuity within each column (zero gaps, zero overlaps)
          for (let col = 0; col < N; col++) {
            let expectedY = 0;
            for (let row = 0; row < N; row++) {
              const pieceId = row * N + col;
              const r = rects[pieceId];
              expect(r.y0).toBe(expectedY);
              expectedY = r.y1;
            }
            expect(expectedY).toBe(height);
          }

          // 5. Total area equals source area
          const totalPieceArea = rects.reduce((sum, r) => sum + r.width * r.height, 0);
          expect(totalPieceArea).toBe(width * height);
        });
      }
    }
  });

  describe("2. Lossless Pixel-Level Reconstruction Test", () => {
    for (const N of SIZES) {
      it(`losslessly reconstructs original image for ${N}x${N} grid (${N * N} pieces) with byte-for-byte pixel match`, async () => {
        const width = 800;
        const height = 800;

        // Generate synthetic patterned raw pixel buffer with gradients and markers
        const rawPixels = Buffer.alloc(width * height * 4);
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * 4;
            rawPixels[idx + 0] = (x * 255) / width; // R gradient
            rawPixels[idx + 1] = (y * 255) / height; // G gradient
            rawPixels[idx + 2] = ((x ^ y) & 0xff); // B pattern
            rawPixels[idx + 3] = 255; // Alpha
          }
        }

        const masterSharp = sharp(rawPixels, {
          raw: { width, height, channels: 4 },
        });

        // Slice into N*N tiles
        const tiles: { left: number; top: number; input: Buffer }[] = [];
        for (let pieceId = 0; pieceId < N * N; pieceId++) {
          const rect = calculatePieceRect(width, height, N, pieceId);
          const tileRaw = await masterSharp
            .clone()
            .extract({
              left: rect.x0,
              top: rect.y0,
              width: rect.width,
              height: rect.height,
            })
            .raw()
            .toBuffer();

          tiles.push({
            left: rect.x0,
            top: rect.y0,
            input: tileRaw,
          });
        }

        // Stitch pieces together onto a new blank canvas
        const reconstructedRaw = Buffer.alloc(width * height * 4);
        for (let pieceId = 0; pieceId < N * N; pieceId++) {
          const rect = calculatePieceRect(width, height, N, pieceId);
          const tile = tiles[pieceId];

          // Copy tile lines into reconstructed canvas
          for (let row = 0; row < rect.height; row++) {
            const srcStart = row * rect.width * 4;
            const srcEnd = srcStart + rect.width * 4;
            const destStart = ((rect.y0 + row) * width + rect.x0) * 4;
            tile.input.copy(reconstructedRaw, destStart, srcStart, srcEnd);
          }
        }

        // Byte-for-byte comparison: Reconstructed image MUST be 100% identical to source
        expect(Buffer.compare(rawPixels, reconstructedRaw)).toBe(0);
      });
    }
  });

  describe("3. Production Slicer Integration (Space Explorer WebP pieces)", () => {
    beforeEach(() => {
      clearSlicerCache();
    });

    for (const N of SIZES) {
      it(`slices Space Explorer into ${N}x${N} (${N * N} pieces) WebP buffers successfully`, async () => {
        const pieces = await sliceAllPieces("space-explorer", N);
        expect(Object.keys(pieces)).toHaveLength(N * N);

        for (let pieceId = 0; pieceId < N * N; pieceId++) {
          const dataUrl = pieces[pieceId];
          expect(dataUrl).toBeDefined();
          expect(dataUrl.startsWith("data:image/webp;base64,")).toBe(true);

          // Verify slicePiece returns the same piece buffer
          const singleBuf = await slicePiece("space-explorer", N, pieceId);
          expect(singleBuf.length).toBeGreaterThan(100);
          expect(dataUrl).toBe(`data:image/webp;base64,${singleBuf.toString("base64")}`);
        }
      });
    }
  });

  describe("4. End-to-End Server & Schema Validation", () => {
    it("accepts only 2x2 through 8x8 square grids in schema validation", () => {
      // Valid inputs
      for (const n of SUPPORTED_GRID_SIZES) {
        expect(createLobbySchema.safeParse({ gridSize: n }).success).toBe(true);
        expect(createLobbySchema.safeParse({ gridCols: n, gridRows: n }).success).toBe(true);
        expect(createLobbySchema.safeParse({ gridSize: n, gridCols: n, gridRows: n }).success).toBe(true);
      }

      // Invalid inputs: out of bounds
      expect(createLobbySchema.safeParse({ gridSize: 1 }).success).toBe(false);
      expect(createLobbySchema.safeParse({ gridSize: 9 }).success).toBe(false);
      expect(createLobbySchema.safeParse({ gridSize: 0 }).success).toBe(false);
      expect(createLobbySchema.safeParse({ gridSize: -1 }).success).toBe(false);

      // Invalid inputs: rectangular grids MUST be rejected
      expect(createLobbySchema.safeParse({ gridCols: 3, gridRows: 4 }).success).toBe(false);
      expect(createLobbySchema.safeParse({ gridCols: 4, gridRows: 3 }).success).toBe(false);
      expect(createLobbySchema.safeParse({ gridCols: 5, gridRows: 4 }).success).toBe(false);
      expect(createLobbySchema.safeParse({ gridCols: 6, gridRows: 4 }).success).toBe(false);
    });

    it("creates lobbies with canonical gridSize and derives rows, cols, pieceCount", async () => {
      for (const n of SUPPORTED_GRID_SIZES) {
        const lobby = await lobbyService.createLobby({ gridSize: n });
        expect(lobby.gridCols).toBe(n);
        expect(lobby.gridRows).toBe(n);
        expect(lobby.pieceCount).toBe(n * n);
      }
    });

    it("rejects creation of rectangular lobbies with GameError", async () => {
      await expect(
        lobbyService.createLobby({ gridCols: 3, gridRows: 4 } as any),
      ).rejects.toThrow();

      await expect(
        lobbyService.createLobby({ gridCols: 4, gridRows: 3 } as any),
      ).rejects.toThrow();
    });
  });
});
