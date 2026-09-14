import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/admin";
import { formatClock } from "@/lib/game/format";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") || crypto.randomUUID();
  const startTime = performance.now();

  console.log(`[HOST_PLAYERS_START] requestId=${requestId} method=GET endpoint=/api/host/players`);

  try {
    if (!isSupabaseConfigured()) {
      console.warn(`[HOST_PLAYERS_DB] requestId=${requestId} Supabase not configured`);
      return NextResponse.json({ players: [] });
    }

    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search")?.trim().toLowerCase();

    console.log(`[HOST_PLAYERS_DB] requestId=${requestId} operation=query_players search=${search ?? "none"}`);

    // Query players
    const { data: playersData, error: pErr } = await supabaseAdmin
      .from("players")
      .select(`
        id,
        name,
        score,
        connected,
        joined_at,
        last_seen_at
      `)
      .order("joined_at", { ascending: false });

    if (pErr) {
      console.error(`[HOST_PLAYERS_DB_ERROR] requestId=${requestId} query=players error=${pErr.message}`);
      return NextResponse.json({ error: "Failed to query players from database" }, { status: 500 });
    }

    // Query game_players to compute authoritative performance per player
    const { data: gpData, error: gpErr } = await supabaseAdmin
      .from("game_players")
      .select("player_id, moves, completed, started_at, completed_at");

    if (gpErr) {
      console.error(`[HOST_PLAYERS_DB_ERROR] requestId=${requestId} query=game_players error=${gpErr.message}`);
    }

    const statsByPlayer = new Map<
      string,
      {
        gamesPlayed: number;
        completions: number;
        bestTimeMs: number | null;
        totalTimeMs: number;
        totalMoves: number;
      }
    >();

    if (gpData) {
      for (const gp of gpData) {
        if (!gp.player_id) continue;
        const cur = statsByPlayer.get(gp.player_id) ?? {
          gamesPlayed: 0,
          completions: 0,
          bestTimeMs: null,
          totalTimeMs: 0,
          totalMoves: 0,
        };
        cur.gamesPlayed++;
        cur.totalMoves += gp.moves ?? 0;

        if (gp.completed) {
          cur.completions++;
          if (gp.started_at && gp.completed_at) {
            const dur =
              new Date(gp.completed_at).getTime() - new Date(gp.started_at).getTime();
            if (dur > 0 && dur < 600000) {
              cur.totalTimeMs += dur;
              if (cur.bestTimeMs === null || dur < cur.bestTimeMs) {
                cur.bestTimeMs = dur;
              }
            }
          }
        }
        statsByPlayer.set(gp.player_id, cur);
      }
    }

    // Map each distinct player session (keyed by unique player id, NOT conflating duplicate display names)
    let players = (playersData ?? []).map((p) => {
      const s = statsByPlayer.get(p.id) ?? {
        gamesPlayed: 0,
        completions: 0,
        bestTimeMs: null,
        totalTimeMs: 0,
        totalMoves: 0,
      };

      return {
        id: p.id,
        name: p.name ? p.name.trim() : "Guest",
        score: p.score ?? 0,
        gamesPlayed: s.gamesPlayed,
        wins: s.completions,
        bestTimeMs: s.bestTimeMs,
        bestTimeFormatted: s.bestTimeMs ? formatClock(s.bestTimeMs) : "—",
        avgTimeFormatted:
          s.completions > 0
            ? formatClock(Math.round(s.totalTimeMs / s.completions))
            : "—",
        avgMoves: s.gamesPlayed > 0 ? Math.round(s.totalMoves / s.gamesPlayed) : 0,
        lastSeenAt: p.last_seen_at ?? p.joined_at,
        connected: p.connected ?? false,
      };
    });

    if (search) {
      players = players.filter((p) => p.name.toLowerCase().includes(search));
    }

    // Sort by wins desc, score desc, games played desc
    players.sort(
      (a, b) =>
        b.wins - a.wins ||
        b.score - a.score ||
        b.gamesPlayed - a.gamesPlayed ||
        new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime(),
    );

    const duration = Math.round(performance.now() - startTime);
    console.log(
      `[HOST_PLAYERS_SUCCESS] requestId=${requestId} duration=${duration}ms count=${players.length}`,
    );

    return NextResponse.json({ players });
  } catch (err: any) {
    const duration = Math.round(performance.now() - startTime);
    console.error(
      `[HOST_PLAYERS_ERROR] requestId=${requestId} duration=${duration}ms error=${err?.message}`,
    );
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "Failed to list players" },
      { status: 500 },
    );
  }
}
