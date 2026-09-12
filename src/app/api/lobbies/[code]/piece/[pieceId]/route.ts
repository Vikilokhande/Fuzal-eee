import { lobbyService } from "@/lib/game/service";
import { findPlayer } from "@/lib/game/repo";
import { GameState } from "@/lib/game/types";
import { safeEqualToken } from "@/lib/game/auth";
import { errorResponse } from "@/lib/game/http";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/lobbies/:code/piece/:pieceId?p=playerId&t=token
 *
 * Storage-backed piece delivery:
 * Serves pre-generated 200x200 WebP tiles directly from Supabase Storage.
 * Completely eliminates runtime SVG manipulation and filesystem dependencies.
 * Only accessible during PUZZLE or FINISHED states with valid player credentials.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ code: string; pieceId: string }> },
) {
  try {
    const { code, pieceId: pieceParam } = await ctx.params;
    const url = new URL(req.url);
    const playerId = url.searchParams.get("p") ?? "";
    const token = url.searchParams.get("t") ?? "";

    const lobby = await lobbyService.getLobby(code);
    if (
      lobby.status !== GameState.PUZZLE &&
      lobby.status !== GameState.FINISHED
    ) {
      return Response.json(
        { error: "INVALID_STATE", message: "Puzzle is not active." },
        { status: 409 },
      );
    }

    const player = findPlayer(lobby, playerId);
    if (!player || !safeEqualToken(token, player.token)) {
      return Response.json(
        { error: "FORBIDDEN", message: "Invalid player session." },
        { status: 403 },
      );
    }

    const total = lobby.gridCols * lobby.gridRows;
    const piece = Number(pieceParam);
    if (!Number.isInteger(piece) || piece < 0 || piece >= total) {
      return Response.json(
        { error: "BAD_REQUEST", message: "Invalid piece index." },
        { status: 400 },
      );
    }

    const image = lobby.memory?.image;
    if (!image) {
      return Response.json(
        { error: "INVALID_STATE", message: "No active puzzle image." },
        { status: 409 },
      );
    }

    const slug = image.slug ?? image.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const pieceNumStr = String(piece).padStart(2, "0");
    const piecePath = `${slug}/pieces/${pieceNumStr}.webp`;

    const { data: fileData, error: storageErr } = await supabaseAdmin.storage
      .from("puzzle-images")
      .download(piecePath);

    if (storageErr || !fileData) {
      console.error(
        `[PIECE_ERROR] Failed to fetch piece: lobby=${code}, piece=${piece}, path=${piecePath}, error=${storageErr?.message}`,
      );
      return Response.json(
        { error: "NOT_FOUND", message: "Piece asset not found in storage." },
        { status: 404 },
      );
    }

    const arrayBuffer = await fileData.arrayBuffer();

    return new Response(arrayBuffer, {
      status: 200,
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "public, max-age=86400, immutable",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
