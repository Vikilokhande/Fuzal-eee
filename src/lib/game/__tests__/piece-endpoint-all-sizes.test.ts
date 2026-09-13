import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GameState } from "../types";

const TEST_TOKEN = "x".repeat(24);
const TEST_PLAYER_ID = "22222222-2222-4222-8222-222222222222";
const TEST_GAME_ID = "33333333-3333-4333-8333-333333333333";

function makeLobbyForGrid(N: number) {
  return {
    id: TEST_GAME_ID,
    gameId: TEST_GAME_ID,
    status: GameState.PUZZLE,
    gridCols: N,
    gridRows: N,
    pieceCount: N * N,
    players: [
      {
        id: TEST_PLAYER_ID,
        token: TEST_TOKEN,
      },
    ],
    memory: {
      image: {
        slug: "cosmic-fox",
        name: "Cosmic Fox",
      },
    },
  };
}

describe("Piece Delivery Route — All Supported Sizes (2x2 to 8x8)", () => {
  const SIZES = [2, 3, 4, 5, 6, 7, 8] as const;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  for (const N of SIZES) {
    const totalPieces = N * N;

    describe(`Grid ${N}x${N} (${totalPieces} pieces)`, () => {
      function setupMocks() {
        const processLobbies = new Map([[`FZ${N}`, makeLobbyForGrid(N)]]);
        vi.doMock("@/lib/game/repo", () => ({
          lobbyRepo: {
            processLobbies,
            getByCode: vi.fn(),
          },
        }));

        vi.doMock("@/lib/supabase/admin", () => ({
          supabaseAdmin: {
            storage: {
              from: vi.fn(() => ({
                download: vi.fn(async (storagePath: string) => {
                  // Simulate downloading stored WebP tile
                  const dummyWebPHeader = Buffer.from([
                    0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00,
                    0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x4c,
                  ]);
                  return {
                    data: new Blob([dummyWebPHeader, Buffer.from(`tile-${storagePath}`)]),
                    error: null,
                  };
                }),
              })),
            },
          },
        }));
      }

      it(`returns HTTP 200 with valid image/webp for valid piece IDs (e.g. piece 0 and piece ${totalPieces - 1})`, async () => {
        setupMocks();
        const { GET } = await import("@/app/api/lobbies/[code]/piece/[pieceId]/route");

        // Test first piece (0)
        const res0 = await GET(
          new Request(
            `http://localhost:3000/api/lobbies/FZ${N}/piece/0?p=${TEST_PLAYER_ID}&t=${TEST_TOKEN}`,
          ),
          { params: Promise.resolve({ code: `FZ${N}`, pieceId: "0" }) },
        );
        expect(res0.status).toBe(200);
        expect(res0.headers.get("Content-Type")).toBe("image/webp");
        const buf0 = await res0.arrayBuffer();
        expect(buf0.byteLength).toBeGreaterThan(0);

        // Test last piece (totalPieces - 1)
        const lastIndex = totalPieces - 1;
        const resLast = await GET(
          new Request(
            `http://localhost:3000/api/lobbies/FZ${N}/piece/${lastIndex}?p=${TEST_PLAYER_ID}&t=${TEST_TOKEN}`,
          ),
          { params: Promise.resolve({ code: `FZ${N}`, pieceId: String(lastIndex) }) },
        );
        expect(resLast.status).toBe(200);
        expect(resLast.headers.get("Content-Type")).toBe("image/webp");
        const bufLast = await resLast.arrayBuffer();
        expect(bufLast.byteLength).toBeGreaterThan(0);
      });

      it(`rejects invalid piece ID (${totalPieces} is out of bounds for ${N}x${N})`, async () => {
        setupMocks();
        const { GET } = await import("@/app/api/lobbies/[code]/piece/[pieceId]/route");

        const res = await GET(
          new Request(
            `http://localhost:3000/api/lobbies/FZ${N}/piece/${totalPieces}?p=${TEST_PLAYER_ID}&t=${TEST_TOKEN}`,
          ),
          { params: Promise.resolve({ code: `FZ${N}`, pieceId: String(totalPieces) }) },
        );
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toBe("BAD_REQUEST");
      });

      it(`rejects negative piece ID (-1)`, async () => {
        setupMocks();
        const { GET } = await import("@/app/api/lobbies/[code]/piece/[pieceId]/route");

        const res = await GET(
          new Request(
            `http://localhost:3000/api/lobbies/FZ${N}/piece/-1?p=${TEST_PLAYER_ID}&t=${TEST_TOKEN}`,
          ),
          { params: Promise.resolve({ code: `FZ${N}`, pieceId: "-1" }) },
        );
        expect(res.status).toBe(400);
      });

      it(`rejects unauthorized requests with invalid token`, async () => {
        setupMocks();
        const { GET } = await import("@/app/api/lobbies/[code]/piece/[pieceId]/route");

        const res = await GET(
          new Request(
            `http://localhost:3000/api/lobbies/FZ${N}/piece/0?p=${TEST_PLAYER_ID}&t=invalid-token`,
          ),
          { params: Promise.resolve({ code: `FZ${N}`, pieceId: "0" }) },
        );
        expect(res.status).toBe(403);
      });

      it(`prevents requesting original image or path traversal`, async () => {
        setupMocks();
        const { GET } = await import("@/app/api/lobbies/[code]/piece/[pieceId]/route");

        // Attempt requesting "original" as pieceId
        const resTraverse = await GET(
          new Request(
            `http://localhost:3000/api/lobbies/FZ${N}/piece/original?p=${TEST_PLAYER_ID}&t=${TEST_TOKEN}`,
          ),
          { params: Promise.resolve({ code: `FZ${N}`, pieceId: "original" }) },
        );
        expect(resTraverse.status).toBe(400);

        // Attempt requesting "../original" as pieceId
        const resPath = await GET(
          new Request(
            `http://localhost:3000/api/lobbies/FZ${N}/piece/..%2Foriginal?p=${TEST_PLAYER_ID}&t=${TEST_TOKEN}`,
          ),
          { params: Promise.resolve({ code: `FZ${N}`, pieceId: "../original" }) },
        );
        expect(resPath.status).toBe(400);
      });
    });
  }
});
