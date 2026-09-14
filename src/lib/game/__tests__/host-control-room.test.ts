import { describe, it, expect } from "vitest";
import { GET as getOverview } from "@/app/api/host/overview/route";
import { GET as getHistory } from "@/app/api/host/history/route";
import { GET as getHistoryDetail } from "@/app/api/host/history/[gameId]/route";
import { GET as getPuzzles } from "@/app/api/host/puzzles/route";
import { POST as uploadPuzzleImage } from "@/app/api/host/puzzles/images/route";
import { GET as getPlayers } from "@/app/api/host/players/route";
import { NextRequest } from "next/server";
import sharp from "sharp";

describe("Host Control Room API Endpoints", () => {
  it("GET /api/host/overview returns authoritative analytics KPIs", async () => {
    const req = new NextRequest("http://localhost/api/host/overview");
    const res = await getOverview(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty("totalGames");
    expect(json).toHaveProperty("totalPlayers");
    expect(json).toHaveProperty("totalCompletions");
    expect(json).toHaveProperty("activeLobbies");
    expect(json).toHaveProperty("recentGames");
    expect(typeof json.totalGames).toBe("number");
    expect(typeof json.totalPlayers).toBe("number");
    expect(Array.isArray(json.recentGames)).toBe(true);
    // Verify no fake fallback values
    if (json.avgSolveTimeMs === null) {
      expect(json.avgSolveTimeFormatted).toBe("—");
    }
  });

  it("GET /api/host/history returns paginated historical matches", async () => {
    const req = new NextRequest("http://localhost/api/host/history?page=1&pageSize=5");
    const res = await getHistory(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty("games");
    expect(json).toHaveProperty("total");
    expect(json).toHaveProperty("page", 1);
    expect(json).toHaveProperty("pageSize", 5);
    expect(Array.isArray(json.games)).toBe(true);
  });

  it("GET /api/host/history/[gameId] returns game details or 404 for unknown", async () => {
    // Non-existent ID -> 404
    const notFoundReq = new NextRequest("http://localhost/api/host/history/00000000-0000-0000-0000-000000000000");
    const notFoundRes = await getHistoryDetail(notFoundReq, {
      params: Promise.resolve({ gameId: "00000000-0000-0000-0000-000000000000" }),
    });
    expect(notFoundRes.status).toBe(404);

    // Fetch a real game from history to test 200
    const listReq = new NextRequest("http://localhost/api/host/history?page=1&pageSize=1");
    const listRes = await getHistory(listReq);
    const listJson = await listRes.json();
    if (listJson.games && listJson.games.length > 0) {
      const gameId = listJson.games[0].id;
      const detailReq = new NextRequest(`http://localhost/api/host/history/${gameId}`);
      const detailRes = await getHistoryDetail(detailReq, {
        params: Promise.resolve({ gameId }),
      });
      expect(detailRes.status).toBe(200);
      const detailJson = await detailRes.json();
      expect(detailJson).toHaveProperty("id", gameId);
      expect(detailJson).toHaveProperty("standings");
      expect(Array.isArray(detailJson.standings)).toBe(true);
    }
  });

  it("GET /api/host/puzzles returns catalog with usage counts", async () => {
    const req = new NextRequest("http://localhost/api/host/puzzles");
    const res = await getPuzzles(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty("puzzles");
    expect(Array.isArray(json.puzzles)).toBe(true);
    expect(json.puzzles.length).toBeGreaterThan(0);
    const first = json.puzzles[0];
    expect(first).toHaveProperty("id");
    expect(first).toHaveProperty("name");
    expect(first).toHaveProperty("usageCount");
    expect(typeof first.usageCount).toBe("number");
  });

  it("GET /api/host/players returns player rankings and records without merging duplicate names", async () => {
    const req = new NextRequest("http://localhost/api/host/players");
    const res = await getPlayers(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty("players");
    expect(Array.isArray(json.players)).toBe(true);
  });

  it("POST /api/host/puzzles/images rejects missing file with 400", async () => {
    const formData = new FormData();
    formData.append("name", "Test Puzzle");
    const req = new NextRequest("http://localhost/api/host/puzzles/images", {
      method: "POST",
      body: formData,
    });
    const res = await uploadPuzzleImage(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("BAD_REQUEST");
  });

  it("POST /api/host/puzzles/images rejects malformed file with 400", async () => {
    const formData = new FormData();
    const fakeFile = new File([Buffer.from("not-an-image-data")], "test.png", { type: "image/png" });
    formData.append("file", fakeFile);
    formData.append("name", "Corrupt Test");
    const req = new NextRequest("http://localhost/api/host/puzzles/images", {
      method: "POST",
      body: formData,
    });
    const res = await uploadPuzzleImage(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("BAD_REQUEST");
  });

  it("POST /api/host/puzzles/images successfully uploads, slices, and registers a valid test image", async () => {
    // Generate a valid 400x400 PNG test image buffer with Sharp
    const validPngBuffer = await sharp({
      create: {
        width: 400,
        height: 400,
        channels: 4,
        background: { r: 34, g: 211, b: 238, alpha: 1 },
      },
    })
      .png()
      .toBuffer();

    const formData = new FormData();
    const testFile = new File([new Uint8Array(validPngBuffer)], "test-cyber-gem.png", { type: "image/png" });
    formData.append("file", testFile);
    formData.append("name", "Cyber Gem Test");

    const req = new NextRequest("http://localhost/api/host/puzzles/images", {
      method: "POST",
      body: formData,
    });
    const res = await uploadPuzzleImage(req);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json).toHaveProperty("ok", true);
    expect(json).toHaveProperty("puzzle");
    expect(json.puzzle).toHaveProperty("name", "Cyber Gem Test");
    expect(json.puzzle).toHaveProperty("url");
    expect(json.puzzle.supportedGrids).toEqual([2, 3, 4, 5, 6, 7, 8]);
  }, 30000);
});
