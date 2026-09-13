import { afterEach, describe, expect, it, vi } from "vitest";
import { GameState } from "../types";

function makeLocalLobby(pieceCount = 16) {
  return {
    status: GameState.PUZZLE,
    gridCols: 4,
    gridRows: 4,
    pieceCount,
    players: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        token: "x".repeat(24),
      },
    ],
    memory: {
      image: {
        slug: "sixteen-test",
        name: "Sixteen Test",
      },
    },
  };
}

function mockRouteDeps() {
  const processLobbies = new Map([["ABCD", makeLocalLobby()]]);
  vi.doMock("@/lib/game/repo", () => ({
    lobbyRepo: {
      processLobbies,
      getByCode: vi.fn(),
    },
  }));
  vi.doMock("@/lib/game/puzzlePiecesData", () => ({
    getAllPiecesForSlug: vi.fn(() => null),
    getPieceBuffer: vi.fn(() => null),
  }));
  vi.doMock("@/lib/game/slicer", () => ({
    sliceAllPieces: vi.fn(async (_slug: string, n: number) => {
      return Object.fromEntries(
        Array.from({ length: n * n }, (_, pieceId) => [
          pieceId,
          `data:image/webp;base64,piece-${pieceId}`,
        ]),
      );
    }),
    slicePiece: vi.fn(async (_slug: string, _n: number, pieceId: number) =>
      Buffer.from(`piece-${pieceId}`),
    ),
  }));
  vi.doMock("@/lib/supabase/admin", () => ({
    supabaseAdmin: {
      storage: {
        from: vi.fn(),
      },
    },
  }));
}

describe("dynamic puzzle piece routes", () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.doUnmock("@/lib/game/repo");
    vi.doUnmock("@/lib/game/puzzlePiecesData");
    vi.doUnmock("@/lib/game/slicer");
    vi.doUnmock("@/lib/supabase/admin");
  });

  it("returns exactly the active 16-piece (4x4) puzzle bundle", async () => {
    mockRouteDeps();
    const { GET } = await import("@/app/api/lobbies/[code]/pieces/route");

    const res = await GET(
      new Request(
        "http://localhost:3000/api/lobbies/ABCD/pieces?p=11111111-1111-4111-8111-111111111111&t=xxxxxxxxxxxxxxxxxxxxxxxx",
      ),
      { params: Promise.resolve({ code: "ABCD" }) },
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.pieceCount).toBe(16);
    expect(Object.keys(body.pieces)).toHaveLength(16);
    expect(body.pieces[0]).toBe("data:image/webp;base64,piece-0");
    expect(body.pieces[15]).toBe("data:image/webp;base64,piece-15");
    expect(body.pieces[16]).toBeUndefined();
  });

  it("rejects a single piece outside the active puzzle size", async () => {
    mockRouteDeps();
    const { GET } = await import("@/app/api/lobbies/[code]/piece/[pieceId]/route");

    const res = await GET(
      new Request(
        "http://localhost:3000/api/lobbies/ABCD/piece/16?p=11111111-1111-4111-8111-111111111111&t=xxxxxxxxxxxxxxxxxxxxxxxx",
      ),
      { params: Promise.resolve({ code: "ABCD", pieceId: "16" }) },
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("BAD_REQUEST");
  });
});
