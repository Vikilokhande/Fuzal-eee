import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/admin";
import { formatClock } from "@/lib/game/format";
import type { GameHistoryDetail, HistoricalPlayerParticipation } from "@/lib/game/types";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ gameId: string }> },
) {
  const requestId = req.headers.get("x-request-id") || crypto.randomUUID();
  const startTime = performance.now();

  try {
    const { gameId } = await ctx.params;
    console.log(`[GAME_DETAIL_START] requestId=${requestId} gameId=${gameId}`);

    if (!isSupabaseConfigured()) {
      return NextResponse.json({ error: "DB_NOT_CONFIGURED" }, { status: 503 });
    }

    if (!gameId) {
      return NextResponse.json({ error: "Missing game ID" }, { status: 400 });
    }

    console.log(`[GAME_DETAIL_DB] requestId=${requestId} operation=query_game_detail gameId=${gameId}`);

    const { data: gameRow, error: gErr } = await supabaseAdmin
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
        puzzle_images!games_image_id_fkey(id, name, storage_path),
        players!games_winner_player_id_fkey(id, name)
      `)
      .eq("id", gameId)
      .maybeSingle();

    if (gErr) {
      console.error(`[GAME_DETAIL_DB_ERROR] requestId=${requestId} query=game error=${gErr.message}`);
      return NextResponse.json({ error: "Failed to query game details" }, { status: 500 });
    }

    if (!gameRow) {
      console.warn(`[GAME_DETAIL_NOT_FOUND] requestId=${requestId} gameId=${gameId}`);
      return NextResponse.json({ error: "NOT_FOUND", message: "Game not found" }, { status: 404 });
    }

    // Fetch players and game_players for this game
    const { data: gpRows, error: gpErr } = await supabaseAdmin
      .from("game_players")
      .select(`
        id,
        player_id,
        board,
        moves,
        correct_slots,
        completed,
        started_at,
        completed_at,
        players!game_players_player_id_fkey(id, name, slot, score)
      `)
      .eq("game_id", gameId);

    if (gpErr) {
      console.error(`[GAME_DETAIL_DB_ERROR] requestId=${requestId} query=game_players error=${gpErr.message}`);
    }

    const standings: HistoricalPlayerParticipation[] = [];

    if (gpRows && gpRows.length > 0) {
      for (const gp of gpRows as any[]) {
        let durationMs: number | null = null;
        if (gp.started_at && gp.completed_at) {
          durationMs =
            new Date(gp.completed_at).getTime() - new Date(gp.started_at).getTime();
        }

        const isWinner = gp.player_id === gameRow.winner_player_id;
        const finalStatus = isWinner || gp.completed
          ? "SOLVED"
          : gameRow.state === "FINISHED"
            ? "ELIMINATED"
            : "DID_NOT_FINISH";

        standings.push({
          id: gp.player_id,
          name: gp.players?.name ?? "Player",
          slot: gp.players?.slot ?? 1,
          score: gp.players?.score ?? (isWinner ? 1 : 0),
          moves: gp.moves ?? 0,
          correctSlots: gp.correct_slots ?? 0,
          completed: gp.completed ?? false,
          durationMs,
          durationFormatted: durationMs ? formatClock(durationMs) : "—",
          finalStatus,
        });
      }

      // Sort: Completed first (by duration ascending, moves ascending), then by correct slots descending
      standings.sort((a, b) => {
        if (a.completed && !b.completed) return -1;
        if (!a.completed && b.completed) return 1;
        if (a.completed && b.completed) {
          return (a.durationMs ?? 999999) - (b.durationMs ?? 999999) || a.moves - b.moves;
        }
        return b.correctSlots - a.correctSlots || a.moves - b.moves;
      });
    }

    let overallDurationMs: number | null = null;
    if (gameRow.puzzle_started_at && gameRow.finished_at) {
      overallDurationMs =
        new Date(gameRow.finished_at).getTime() -
        new Date(gameRow.puzzle_started_at).getTime();
    }

    const cols = gameRow.grid_cols ?? 3;
    const rows = gameRow.grid_rows ?? 3;
    const winnerStanding = standings.find((s) => s.id === gameRow.winner_player_id);

    const detail: GameHistoryDetail = {
      id: gameRow.id,
      lobbyCode: (gameRow.lobbies as any)?.code ?? "—",
      status: gameRow.state,
      gridSize: cols,
      gridDisplay: `${cols}×${rows}`,
      pieceCount: gameRow.piece_count ?? cols * rows,
      startedAt: gameRow.puzzle_started_at ?? gameRow.created_at,
      endedAt: gameRow.finished_at,
      durationFormatted: overallDurationMs ? formatClock(overallDurationMs) : "—",
      puzzle: {
        id: (gameRow.puzzle_images as any)?.id ?? "",
        name: (gameRow.puzzle_images as any)?.name ?? "Cosmic Puzzle",
        url: (gameRow.puzzle_images as any)?.storage_path
          ? `${process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://dewdcxssvkvbgyyenmmu.supabase.co"}/storage/v1/object/public/puzzle-images/${(gameRow.puzzle_images as any).storage_path}/original.webp`
          : undefined,
      },
      winner: (gameRow.players as any)?.name
        ? {
            name: (gameRow.players as any).name,
            moves: winnerStanding?.moves ?? null,
            durationFormatted: winnerStanding?.durationFormatted ?? null,
          }
        : null,
      standings,
      players: standings,
    };

    const duration = Math.round(performance.now() - startTime);
    console.log(`[GAME_DETAIL_SUCCESS] requestId=${requestId} gameId=${gameId} duration=${duration}ms standings=${standings.length}`);

    return NextResponse.json(detail);
  } catch (err: any) {
    const duration = Math.round(performance.now() - startTime);
    console.error(`[GAME_DETAIL_ERR] requestId=${requestId} duration=${duration}ms error=${err?.message}`);
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "Failed to load game details" },
      { status: 500 },
    );
  }
}
