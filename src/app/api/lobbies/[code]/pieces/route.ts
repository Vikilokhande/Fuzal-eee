import { lobbyRepo } from "@/lib/game/repo";
import { GameState } from "@/lib/game/types";
import { safeEqualToken } from "@/lib/game/auth";
import { errorResponse } from "@/lib/game/http";
import { getAllPiecesForSlug } from "@/lib/game/puzzlePiecesData";
import { sliceAllPieces } from "@/lib/game/slicer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function pieceCountFromLobby(lobby: any): number {
  const explicit = Number(lobby?.pieceCount ?? lobby?.piece_count);
  if (Number.isInteger(explicit) && explicit > 0) return explicit;
  const cols = Number(lobby?.gridCols ?? lobby?.grid_cols ?? 3);
  const rows = Number(lobby?.gridRows ?? lobby?.grid_rows ?? 3);
  return (Number.isInteger(cols) && cols > 0 ? cols : 3) *
    (Number.isInteger(rows) && rows > 0 ? rows : 3);
}

function selectRequiredPieces(
  bundled: Record<number, string> | null | undefined,
  total: number,
): Record<number, string> | null {
  if (!bundled) return null;
  const selected: Record<number, string> = {};
  for (let pieceId = 0; pieceId < total; pieceId += 1) {
    if (typeof bundled[pieceId] !== "string") return null;
    selected[pieceId] = bundled[pieceId];
  }
  return selected;
}

/**
 * Fast batch pieces endpoint:
 * Returns all puzzle pieces in a single compressed JSON response (<20KB).
 * Uses canonical master image slicing for all N x N grids (2x2 through 8x8).
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ code: string }> },
) {
  try {
    const { code: rawCode } = await ctx.params;
    const code = rawCode.toUpperCase();
    const url = new URL(req.url);
    const playerId = url.searchParams.get("p") ?? "";
    const token = url.searchParams.get("t") ?? "";

    if (!playerId || !token) {
      return Response.json(
        { error: "BAD_REQUEST", message: "Missing player ID or token." },
        { status: 400 },
      );
    }

    // 1. Verify player session and determine active puzzle image & dimensions
    let slug: string | null = null;
    let total = 9;
    let cols = 3;
    let rows = 3;

    // Check in-process lobby first (0ms)
    const localLobby = (lobbyRepo as any).processLobbies?.get(code);
    if (
      localLobby &&
      (localLobby.status === GameState.MEMORY ||
        localLobby.status === GameState.PUZZLE ||
        localLobby.status === GameState.FINISHED)
    ) {
      const p = localLobby.players.find((x: any) => x.id === playerId);
      if (p && safeEqualToken(token, p.token)) {
        const img = localLobby.memory?.image;
        slug = img?.slug ?? img?.name?.toLowerCase().replace(/[^a-z0-9]+/g, "-") ?? null;
        total = pieceCountFromLobby(localLobby);
        cols = Number(localLobby.gridCols ?? 3);
        rows = Number(localLobby.gridRows ?? 3);
      }
    }

    // Supabase repo fallback if not in local memory
    if (!slug) {
      const lobby = await lobbyRepo.getByCode(code);
      if (!lobby) {
        return Response.json({ error: "NOT_FOUND", message: "Lobby not found." }, { status: 404 });
      }
      if (
        lobby.status !== GameState.MEMORY &&
        lobby.status !== GameState.PUZZLE &&
        lobby.status !== GameState.FINISHED
      ) {
        return Response.json(
          { error: "INVALID_STATE", message: "Puzzle is not active or memorizing." },
          { status: 409 },
        );
      }
      const player = lobby.players.find((p) => p.id === playerId);
      if (!player || !safeEqualToken(token, player.token)) {
        return Response.json(
          { error: "FORBIDDEN", message: "Invalid player session." },
          { status: 403 },
        );
      }
      const image = lobby.memory?.image;
      if (!image) {
        return Response.json(
          { error: "INVALID_STATE", message: "No active puzzle image." },
          { status: 409 },
        );
      }
      slug = image.slug ?? image.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      total = pieceCountFromLobby(lobby);
      cols = Number(lobby.gridCols ?? 3);
      rows = Number(lobby.gridRows ?? 3);
    }

    if (!slug) {
      return Response.json(
        { error: "FORBIDDEN", message: "Unauthorized pieces request." },
        { status: 403 },
      );
    }

    // 2. For 3x3 only: Check embedded bundle (0ms)
    let pieces: Record<number, string> | null = null;
    if (cols === 3 && rows === 3 && total === 9) {
      pieces = selectRequiredPieces(getAllPiecesForSlug(slug), total);
    }

    // 3. For all other grids (2x2, 4x4, 5x5, 6x6, 7x7, 8x8) or fallback:
    // Slices directly from the canonical master image using the exact mathematical formula.
    if (!pieces || Object.keys(pieces).length < total) {
      try {
        pieces = await sliceAllPieces(slug, cols);
      } catch (sliceErr) {
        console.error(`[BATCH_SLICE_ERR] slug=${slug}, grid=${cols}x${rows}:`, sliceErr);
        return Response.json(
          { error: "INTERNAL_ERROR", message: "Failed to slice puzzle pieces." },
          { status: 500 },
        );
      }
    }

    return Response.json(
      { ok: true, slug, pieceCount: total, gridCols: cols, gridRows: rows, pieces },
      {
        status: 200,
        headers: {
          "Cache-Control": "private, max-age=3600",
        },
      },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
