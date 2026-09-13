import { afterEach, describe, expect, it, vi } from "vitest";
import { GameState } from "../types";

function makeLocalLobby(pieceCount = 12) {
  return {
    status: GameState.PUZZLE,
    gridCols: 3,
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
        slug: "twelve-test",
        name: "Twelve Test",
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
    getAllPiecesForSlug: vi.fn(() =>
      Object.fromEntries(
        Array.from({ length: 16 }, (_, pieceId) => [
          pieceId,
          `data:image/webp;base64,piece-${pieceId}`,
        ]),
      ),
    ),
    getPieceBuffer: vi.fn((_slug: string, pieceId: number) =>
      pieceId < 12 ? Buffer.from(`piece-${pieceId}`) : null,
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
    vi.doUnmock("@/lib/supabase/admin");
  });

  it("returns exactly the active 12-piece puzzle bundle", async () => {
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
    expect(body.pieceCount).toBe(12);
    expect(Object.keys(body.pieces)).toHaveLength(12);
    expect(body.pieces[0]).toBe("data:image/webp;base64,piece-0");
    expect(body.pieces[11]).toBe("data:image/webp;base64,piece-11");
    expect(body.pieces[12]).toBeUndefined();
  });

  it("rejects a single piece outside the active puzzle size", async () => {
    mockRouteDeps();
    const { GET } = await import("@/app/api/lobbies/[code]/piece/[pieceId]/route");

    const res = await GET(
      new Request(
        "http://localhost:3000/api/lobbies/ABCD/piece/12?p=11111111-1111-4111-8111-111111111111&t=xxxxxxxxxxxxxxxxxxxxxxxx",
      ),
      { params: Promise.resolve({ code: "ABCD", pieceId: "12" }) },
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("BAD_REQUEST");
  });
});
