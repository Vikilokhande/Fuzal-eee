import { describe, it, expect } from "vitest";
import { GET as getOverview } from "@/app/api/host/overview/route";
import { GET as getHistory } from "@/app/api/host/history/route";
import { GET as getPuzzles } from "@/app/api/host/puzzles/route";
import { GET as getPlayers } from "@/app/api/host/players/route";
import { NextRequest } from "next/server";

describe("Host Control Room API Endpoints", () => {
  it("GET /api/host/overview returns authoritative analytics KPIs", async () => {
    const res = await getOverview();
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

  it("GET /api/host/puzzles returns catalog with usage counts", async () => {
    const res = await getPuzzles();
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

  it("GET /api/host/players returns player rankings and records", async () => {
    const req = new NextRequest("http://localhost/api/host/players");
    const res = await getPlayers(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty("players");
    expect(Array.isArray(json.players)).toBe(true);
  });
});
