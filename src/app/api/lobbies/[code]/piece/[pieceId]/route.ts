import { lobbyRepo } from "@/lib/game/repo";
import { GameState } from "@/lib/game/types";
import { safeEqualToken } from "@/lib/game/auth";
import { errorResponse } from "@/lib/game/http";
import { getPieceBuffer } from "@/lib/game/puzzlePiecesData";
import { slicePiece } from "@/lib/game/slicer";

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

/**
 * Short-lived in-memory auth cache:
 * Key: `${code}:${playerId}:${token}`
 * Value: { slug: string; pieceCount: number; cols: number; rows: number; expiresAt: number }
 */
interface AuthEntry {
  slug: string;
  pieceCount: number;
  cols: number;
  rows: number;
  expiresAt: number;
}
const authCache = new Map<string, AuthEntry>();

export async function GET(
  req: Request,
  ctx: { params: Promise<{ code: string; pieceId: string }> },
) {
  try {
    const { code: rawCode, pieceId: pieceParam } = await ctx.params;
    const code = rawCode.toUpperCase();
    const url = new URL(req.url);
    const playerId = url.searchParams.get("p") ?? "";
    const token = url.searchParams.get("t") ?? "";

    const piece = Number(pieceParam);
    // Allow pieces up to 63 (supporting 8x8 = 64 pieces)
    if (!Number.isInteger(piece) || piece < 0 || piece >= 64) {
      return Response.json(
        { error: "BAD_REQUEST", message: "Invalid piece index." },
        { status: 400 },
      );
    }

    // 1. Fast Auth Check: Check in-memory session cache first
    const cacheKey = `${code}:${playerId}:${token}`;
    const cachedAuth = authCache.get(cacheKey);
    let slug = cachedAuth && cachedAuth.expiresAt > Date.now() ? cachedAuth.slug : null;
    let total = cachedAuth && cachedAuth.expiresAt > Date.now() ? cachedAuth.pieceCount : 9;
    let cols = cachedAuth && cachedAuth.expiresAt > Date.now() ? cachedAuth.cols : 3;
    let rows = cachedAuth && cachedAuth.expiresAt > Date.now() ? cachedAuth.rows : 3;

    if (!slug) {
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

      // If not in local process lobby, fetch from Supabase repo once
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

      // Cache verified session for 120 seconds
      if (slug) {
        authCache.set(cacheKey, { slug, pieceCount: total, cols, rows, expiresAt: Date.now() + 120_000 });
      }
    }

    if (!slug) {
      return Response.json(
        { error: "FORBIDDEN", message: "Unauthorized piece request." },
        { status: 403 },
      );
    }

    if (piece >= total) {
      return Response.json(
        { error: "BAD_REQUEST", message: "Invalid piece index for this puzzle." },
        { status: 400 },
      );
    }

    // 2. Fast path for 3x3 only: check embedded 300x300 bundle (0ms)
    if (cols === 3 && rows === 3) {
      const embeddedBuf = getPieceBuffer(slug, piece);
      if (embeddedBuf) {
        return new Response(embeddedBuf as unknown as BodyInit, {
          status: 200,
          headers: {
            "Content-Type": "image/webp",
            "Cache-Control": "public, max-age=86400, immutable",
          },
        });
      }
    }

    // 3. Canonical Slicing Engine: Slices directly from source image using exact mathematical formulas
    try {
      const pieceBuf = await slicePiece(slug, cols, piece);
      return new Response(pieceBuf as unknown as BodyInit, {
        status: 200,
        headers: {
          "Content-Type": "image/webp",
          "Cache-Control": "public, max-age=86400, immutable",
        },
      });
    } catch (sliceErr) {
      console.error(`[PIECE_SLICE_ERR] lobby=${code}, piece=${piece}, total=${total}:`, sliceErr);
      return Response.json(
        { error: "NOT_FOUND", message: "Failed to slice puzzle piece from source." },
        { status: 404 },
      );
    }
  } catch (e) {
    return errorResponse(e);
  }
}
