import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/admin";
import { formatClock } from "@/lib/fuzal/useFuzalGame";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    if (!isSupabaseConfigured()) {
      return NextResponse.json({ players: [] });
    }

    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search")?.trim().toLowerCase();

    // Query players and aggregate game_players performance
    const { data: playersData, error } = await supabaseAdmin
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

    if (error) {
      console.error("[HOST_PLAYERS_ERR]", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const { data: gpData } = await supabaseAdmin
      .from("game_players")
      .select("player_id, moves, completed, started_at, completed_at");

    const statsByPlayer = new Map<string, {
      gamesPlayed: number;
      completions: number;
      bestTimeMs: number | null;
      totalTimeMs: number;
      totalMoves: number;
    }>();

    if (gpData) {
      for (const gp of gpData) {
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
            const dur = new Date(gp.completed_at).getTime() - new Date(gp.started_at).getTime();
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

    // Deduplicate/group players by name for historical tournament analytics
    const grouped = new Map<string, any>();
    for (const p of playersData ?? []) {
      const key = p.name.trim().toLowerCase();
      const existing = grouped.get(key);
      const s = statsByPlayer.get(p.id) ?? {
        gamesPlayed: 1,
        completions: 0,
        bestTimeMs: null,
        totalTimeMs: 0,
        totalMoves: 0,
      };

      if (!existing) {
        grouped.set(key, {
          id: p.id,
          name: p.name.trim(),
          score: p.score ?? 0,
          gamesPlayed: s.gamesPlayed,
          wins: s.completions,
          bestTimeMs: s.bestTimeMs,
          bestTimeFormatted: s.bestTimeMs ? formatClock(s.bestTimeMs) : "—",
          avgTimeFormatted: s.completions > 0 ? formatClock(Math.round(s.totalTimeMs / s.completions)) : "—",
          avgMoves: s.gamesPlayed > 0 ? Math.round(s.totalMoves / s.gamesPlayed) : 0,
          lastSeenAt: p.last_seen_at ?? p.joined_at,
        });
      } else {
        existing.score += p.score ?? 0;
        existing.gamesPlayed += s.gamesPlayed;
        existing.wins += s.completions;
        if (s.bestTimeMs !== null && (existing.bestTimeMs === null || s.bestTimeMs < existing.bestTimeMs)) {
          existing.bestTimeMs = s.bestTimeMs;
          existing.bestTimeFormatted = formatClock(s.bestTimeMs);
        }
      }
    }

    let players = Array.from(grouped.values());
    if (search) {
      players = players.filter((p) => p.name.toLowerCase().includes(search));
    }

    // Sort by wins desc, score desc
    players.sort((a, b) => b.wins - a.wins || b.score - a.score || b.gamesPlayed - a.gamesPlayed);

    return NextResponse.json({ players });
  } catch (err: any) {
    console.error("[HOST_PLAYERS_ERR]", err);
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: err?.message ?? "Failed to list players" },
      { status: 500 },
    );
  }
}
