import { lobbyRepo } from "@/lib/game/repo";
import { GameState } from "@/lib/game/types";
import { safeEqualToken } from "@/lib/game/auth";
import { errorResponse } from "@/lib/game/http";
import { getEmbeddedAllPieces } from "@/lib/game/puzzlePiecesData";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function pieceCountFromLobby(lobby: any): number {
  const explicit = Number(lobby?.pieceCount ?? lobby?.piece_count);
  if (Number.isInteger(explicit) && explicit > 0) return explicit;
  const cols = Number(lobby?.gridCols ?? lobby?.grid_cols ?? 3);
  const rows = Number(lobby?.gridRows ?? lobby?.grid_rows ?? 3);
  return (
    (Number.isInteger(cols) && cols > 0 ? cols : 3) *
    (Number.isInteger(rows) && rows > 0 ? rows : 3)
  );
}

/** In-memory cache of assembled piece dataURLs: `${slug}:${cols}x${rows}` */
const batchPiecesCache = new Map<string, Record<number, string>>();

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  "https://dewdcxssvkvbgyyenmmu.supabase.co";

/**
 * Fast batch pieces endpoint:
 * Returns all puzzle pieces in a single compressed JSON response.
 * Uses pre-generated WebP assets from embedded bundle or Supabase Storage (zero runtime sharp).
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
      const p = localLobby.players?.find((x: any) => x.id === playerId);
      if (!p || !safeEqualToken(token, p.token)) {
        return Response.json(
          { error: "FORBIDDEN", message: "Invalid player session." },
          { status: 403 },
        );
      }
      const img = localLobby.memory?.image;
      slug = img?.slug ?? img?.name?.toLowerCase().replace(/[^a-z0-9]+/g, "-") ?? null;
      total = pieceCountFromLobby(localLobby);
      cols = Number(localLobby.gridCols ?? 3);
      rows = Number(localLobby.gridRows ?? 3);
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

    // 2. Check in-memory batch cache
    const cacheKey = `${slug}:${cols}x${rows}`;
    const cachedBatch = batchPiecesCache.get(cacheKey);
    if (cachedBatch && Object.keys(cachedBatch).length === total) {
      return Response.json(
        { ok: true, slug, pieceCount: total, gridCols: cols, gridRows: rows, pieces: cachedBatch },
        {
          status: 200,
          headers: { "Cache-Control": "private, max-age=3600" },
        },
      );
    }

    // 3. Check pre-generated embedded bundle (0ms for 2x2, 3x3, 4x4)
    let pieces: Record<number, string> | null = getEmbeddedAllPieces(slug, cols);

    // 4. For larger grids (5x5 through 8x8) or missing: fetch pre-generated WebP tiles from Supabase Storage
    if (!pieces || Object.keys(pieces).length < total) {
      try {
        const fetchedPieces: Record<number, string> = {};
        const fetchPromises: Promise<void>[] = [];

        for (let pieceId = 0; pieceId < total; pieceId++) {
          const pieceNumStr = String(pieceId).padStart(2, "0");
          const canonicalPath = `${slug}/pieces/${cols}x${rows}/${pieceNumStr}.webp`;
          const flatPath = `${slug}/pieces/${pieceNumStr}.webp`;

          fetchPromises.push(
            (async () => {
              let buf: Buffer | null = null;
              // Try Supabase Admin download for canonical path
              try {
                const { data, error } = await supabaseAdmin.storage
                  .from("puzzle-images")
                  .download(canonicalPath);
                if (data && !error) {
                  buf = Buffer.from(await data.arrayBuffer());
                }
              } catch (_) {
                // fallback below
              }

              // Fallback to flat path if 4x4 or legacy
              if (!buf) {
                try {
                  const { data, error } = await supabaseAdmin.storage
                    .from("puzzle-images")
                    .download(flatPath);
                  if (data && !error) {
                    buf = Buffer.from(await data.arrayBuffer());
                  }
                } catch (_) {
                  // fallback below
                }
              }

              // Fallback to public CDN fetch
              if (!buf) {
                try {
                  const publicUrl = `${supabaseUrl}/storage/v1/object/public/puzzle-images/${canonicalPath}`;
                  const res = await fetch(publicUrl);
                  if (res.ok) {
                    buf = Buffer.from(await res.arrayBuffer());
                  }
                } catch (_) {
                  // no-op
                }
              }

              if (buf) {
                fetchedPieces[pieceId] = `data:image/webp;base64,${buf.toString("base64")}`;
              }
            })(),
          );
        }

        await Promise.all(fetchPromises);

        if (Object.keys(fetchedPieces).length === total) {
          pieces = fetchedPieces;
          batchPiecesCache.set(cacheKey, fetchedPieces);
        }
      } catch (err) {
        console.error(`[BATCH_STORAGE_FETCH_ERR] slug=${slug}, grid=${cols}x${rows}:`, err);
      }
    }

    if (!pieces || Object.keys(pieces).length < total) {
      return Response.json(
        { error: "NOT_FOUND", message: "Failed to load all pre-generated puzzle pieces from storage." },
        { status: 404 },
      );
    }

    batchPiecesCache.set(cacheKey, pieces);

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

