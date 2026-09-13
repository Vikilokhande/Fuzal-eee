import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/admin";
import { formatClock } from "@/lib/fuzal/useFuzalGame";
import type { GameHistoryItem } from "@/lib/game/types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    if (!isSupabaseConfigured()) {
      return NextResponse.json({ games: [], total: 0, page: 1, totalPages: 1 });
    }

    const { searchParams } = new URL(req.url);
    const page = Math.max(1, Number(searchParams.get("page") ?? 1));
    const limit = Math.min(
      100,
      Math.max(1, Number(searchParams.get("pageSize") ?? searchParams.get("limit") ?? 20)),
    );
    const offset = (page - 1) * limit;

    const gridFilter = searchParams.get("grid");
    const statusFilter = searchParams.get("status");
    const search = searchParams.get("search")?.trim().toLowerCase();
    const dateRange = searchParams.get("date"); // 'today' | 'week' | 'month' | 'all'

    let query = supabaseAdmin
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
      `, { count: "exact" });

    if (gridFilter && Number(gridFilter) > 0) {
      query = query.eq("grid_cols", Number(gridFilter));
    }

    if (statusFilter && statusFilter !== "ALL") {
      query = query.eq("state", statusFilter);
    }

    if (dateRange && dateRange !== "all") {
      const now = new Date();
      if (dateRange === "today") {
        now.setHours(0, 0, 0, 0);
        query = query.gte("created_at", now.toISOString());
      } else if (dateRange === "week") {
        now.setDate(now.getDate() - 7);
        query = query.gte("created_at", now.toISOString());
      } else if (dateRange === "month") {
        now.setMonth(now.getMonth() - 1);
        query = query.gte("created_at", now.toISOString());
      }
    }

    const { data: rows, count, error } = await query
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error("[HOST_HISTORY_QUERY_ERROR]", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const games: GameHistoryItem[] = [];
    if (rows && rows.length > 0) {
      const gameIds = rows.map((r: any) => r.id);
      const { data: gpRows } = await supabaseAdmin
        .from("game_players")
        .select("game_id, moves, completed, started_at, completed_at, player_id")
        .in("game_id", gameIds);

      const gpByGame = new Map<string, any[]>();
      if (gpRows) {
        for (const gp of gpRows) {
          const list = gpByGame.get(gp.game_id) ?? [];
          list.push(gp);
          gpByGame.set(gp.game_id, list);
        }
      }

      for (const row of rows as any[]) {
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

        const cols = row.grid_cols ?? 3;
        const rCount = row.grid_rows ?? 3;
        const pieces = row.piece_count ?? cols * rCount;

        const item: GameHistoryItem = {
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
          gridDisplay: `${cols}×${rCount}`,
          pieceCount: pieces,
          playerCount: gameGps.length,
          winnerName: row.players?.name ?? null,
          winnerMoves: winnerGp?.moves ?? null,
          winnerDurationFormatted: durationMs ? formatClock(durationMs) : null,
          status: row.state,
        };

        // Client search filter if provided
        if (search) {
          const matchCode = item.lobbyCode.toLowerCase().includes(search);
          const matchPuzzle = item.puzzleName.toLowerCase().includes(search);
          const matchWinner = item.winnerName?.toLowerCase().includes(search);
          if (!matchCode && !matchPuzzle && !matchWinner) continue;
        }

        games.push(item);
      }
    }

    const total = count ?? games.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));

    return NextResponse.json({ games, total, page, pageSize: limit, limit, totalPages });
  } catch (err: any) {
    console.error("[HOST_HISTORY_ERR]", err);
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: err?.message ?? "Failed to load history" },
      { status: 500 },
    );
  }
}
