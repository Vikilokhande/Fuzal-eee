import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/admin";
import { formatClock } from "@/lib/game/format";
import type { HostAnalyticsOverview, GameHistoryItem } from "@/lib/game/types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") || crypto.randomUUID();
  const startTime = performance.now();

  console.log(`[HOST_OVERVIEW_START] requestId=${requestId} method=GET endpoint=/api/host/overview`);

  try {
    if (!isSupabaseConfigured()) {
      console.warn(`[HOST_OVERVIEW_DB] requestId=${requestId} Supabase not configured, returning empty defaults`);
      return NextResponse.json(
        {
          totalGames: 0,
          totalPlayers: 0,
          totalCompletions: 0,
          activeLobbies: 0,
          avgSolveTimeMs: null,
          avgSolveTimeFormatted: "—",
          bestSolveTimeMs: null,
          bestSolveTimeFormatted: "—",
          recentGames: [],
        } satisfies HostAnalyticsOverview,
      );
    }

    console.log(`[HOST_OVERVIEW_DB] requestId=${requestId} operation=aggregate_metrics_start`);

    // 1. Total games count
    const { count: totalGames, error: tgErr } = await supabaseAdmin
      .from("games")
      .select("id", { count: "exact", head: true });

    if (tgErr) {
      console.error(`[HOST_OVERVIEW_DB_ERROR] requestId=${requestId} query=totalGames error=${tgErr.message}`);
    }

    // 2. Total players count
    const { count: totalPlayers, error: tpErr } = await supabaseAdmin
      .from("players")
      .select("id", { count: "exact", head: true });

    if (tpErr) {
      console.error(`[HOST_OVERVIEW_DB_ERROR] requestId=${requestId} query=totalPlayers error=${tpErr.message}`);
    }

    // 3. Total completions
    const { count: totalCompletions, error: tcErr } = await supabaseAdmin
      .from("game_players")
      .select("id", { count: "exact", head: true })
      .eq("completed", true);

    if (tcErr) {
      console.error(`[HOST_OVERVIEW_DB_ERROR] requestId=${requestId} query=totalCompletions error=${tcErr.message}`);
    }

    // 4. Active lobbies
    const { count: activeLobbies, error: alErr } = await supabaseAdmin
      .from("lobbies")
      .select("id", { count: "exact", head: true })
      .in("status", ["LOBBY", "MEMORY", "PUZZLE"]);

    if (alErr) {
      console.error(`[HOST_OVERVIEW_DB_ERROR] requestId=${requestId} query=activeLobbies error=${alErr.message}`);
    }

    // 5. Recent finished games
    const { data: recentRows, error: rgErr } = await supabaseAdmin
      .from("games")
      .select(`
        id,
        state,
        grid_cols,
        grid_rows,
        piece_count,
        created_at,
        puzzle_started_at,
        finished_at,
        winner_player_id,
        lobbies!games_lobby_id_fkey(code),
        puzzle_images!games_image_id_fkey(name, storage_path),
        players!games_winner_player_id_fkey(name)
      `)
      .order("created_at", { ascending: false })
      .limit(10);

    if (rgErr) {
      console.error(`[HOST_OVERVIEW_DB_ERROR] requestId=${requestId} query=recentGames error=${rgErr.message}`);
    }

    // 6. Calculate best and avg solve times from completed games
    let bestSolveTimeMs: number | null = null;
    let totalSolveTimeMs = 0;
    let solveCount = 0;

    const recentGames: GameHistoryItem[] = [];

    if (recentRows && recentRows.length > 0) {
      const gameIds = recentRows.map((r: any) => r.id);
      const { data: gpRows, error: gpErr } = await supabaseAdmin
        .from("game_players")
        .select("game_id, moves, completed, started_at, completed_at, player_id")
        .in("game_id", gameIds);

      if (gpErr) {
        console.error(`[HOST_OVERVIEW_DB_ERROR] requestId=${requestId} query=game_players error=${gpErr.message}`);
      }

      const gpByGame = new Map<string, any[]>();
      if (gpRows) {
        for (const gp of gpRows) {
          const list = gpByGame.get(gp.game_id) ?? [];
          list.push(gp);
          gpByGame.set(gp.game_id, list);
        }
      }

      for (const row of recentRows as any[]) {
        const gameGps = gpByGame.get(row.id) ?? [];
        const winnerGp = row.winner_player_id
          ? gameGps.find((x) => x.player_id === row.winner_player_id)
          : null;

        let durationMs: number | null = null;
        if (winnerGp?.started_at && winnerGp?.completed_at) {
          durationMs =
            new Date(winnerGp.completed_at).getTime() -
            new Date(winnerGp.started_at).getTime();
        } else if (row.puzzle_started_at && row.finished_at) {
          durationMs =
            new Date(row.finished_at).getTime() -
            new Date(row.puzzle_started_at).getTime();
        }

        if (row.winner_player_id && durationMs && durationMs > 0 && durationMs < 600000) {
          solveCount++;
          totalSolveTimeMs += durationMs;
          if (bestSolveTimeMs === null || durationMs < bestSolveTimeMs) {
            bestSolveTimeMs = durationMs;
          }
        }

        const cols = row.grid_cols ?? 3;
        const rows = row.grid_rows ?? 3;
        const pieces = row.piece_count ?? cols * rows;

        recentGames.push({
          id: row.id,
          lobbyCode: row.lobbies?.code ?? "—",
          date: new Date(row.created_at).toLocaleDateString("en-US", {
            day: "numeric",
            month: "short",
            year: "numeric",
          }),
          startedAt: row.puzzle_started_at ?? row.created_at,
          finishedAt: row.finished_at,
          durationMs,
          durationFormatted: durationMs ? formatClock(durationMs) : "—",
          puzzleName: row.puzzle_images?.name ?? "Cosmic Puzzle",
          puzzleSlug: row.puzzle_images?.storage_path ?? "cosmic-fox",
          gridSize: cols,
          gridDisplay: `${cols}×${rows}`,
          pieceCount: pieces,
          playerCount: gameGps.length,
          winnerName: row.players?.name ?? null,
          winnerMoves: winnerGp?.moves ?? null,
          winnerDurationFormatted: durationMs ? formatClock(durationMs) : null,
          status: row.state,
        });
      }
    }

    const avgSolveTimeMs = solveCount > 0 ? Math.round(totalSolveTimeMs / solveCount) : null;

    const payload: HostAnalyticsOverview = {
      totalGames: totalGames ?? recentGames.length,
      totalPlayers: totalPlayers ?? 0,
      totalCompletions: totalCompletions ?? 0,
      activeLobbies: activeLobbies ?? 0,
      avgSolveTimeMs,
      avgSolveTimeFormatted: avgSolveTimeMs ? formatClock(avgSolveTimeMs) : "—",
      bestSolveTimeMs,
      bestSolveTimeFormatted: bestSolveTimeMs ? formatClock(bestSolveTimeMs) : "—",
      recentGames,
    };

    const duration = Math.round(performance.now() - startTime);
    console.log(
      `[HOST_OVERVIEW_SUCCESS] requestId=${requestId} duration=${duration}ms totalGames=${payload.totalGames} totalPlayers=${payload.totalPlayers} activeLobbies=${payload.activeLobbies}`,
    );

    return NextResponse.json(payload);
  } catch (err: any) {
    const duration = Math.round(performance.now() - startTime);
    console.error(`[HOST_OVERVIEW_ERROR] requestId=${requestId} duration=${duration}ms error=${err?.message}`);
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "Failed to load overview analytics" },
      { status: 500 },
    );
  }
}
