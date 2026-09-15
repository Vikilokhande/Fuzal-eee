import { lobbyRepo } from "@/lib/game/repo";
import { GameState, type ImageMeta } from "@/lib/game/types";
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

/** In-memory cache of assembled piece dataURLs: `${source}:${slug}:${cols}x${rows}` */
const batchPiecesCache = new Map<string, Record<number, string>>();

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  "https://dewdcxssvkvbgyyenmmu.supabase.co";

/**
 * Fast batch pieces endpoint:
 * Returns all puzzle pieces in a single compressed JSON response.
 * Uses pre-generated WebP assets from embedded bundle (for builtin) or Supabase Storage (for uploaded).
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
    let activeImage: ImageMeta | null = null;
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
      activeImage = localLobby.memory?.image ?? null;
      slug = activeImage?.slug ?? activeImage?.name?.toLowerCase().replace(/[^a-z0-9]+/g, "-") ?? null;
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
      activeImage = lobby.memory?.image ?? null;
      if (!activeImage) {
        return Response.json(
          { error: "INVALID_STATE", message: "No active puzzle image." },
          { status: 409 },
        );
      }
      slug = activeImage.slug ?? activeImage.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
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

    const isUploaded =
      activeImage?.source === "uploaded" ||
      Boolean(activeImage?.id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(activeImage.id));
    const source = isUploaded ? "uploaded" : "builtin";

    console.log("[PUZZLE_IMAGE_REQUEST]", {
      code,
      playerId,
      slug,
      source,
      grid: `${cols}x${rows}`,
      pieceCount: total,
    });

    // 2. Check in-memory batch cache with source namespace
    const cacheKey = `${source}:${slug}:${cols}x${rows}`;
    const cachedBatch = batchPiecesCache.get(cacheKey);
    if (cachedBatch && Object.keys(cachedBatch).length === total) {
      console.log("[PUZZLE_IMAGE_SUCCESS]", {
        slug,
        source,
        cached: true,
        grid: `${cols}x${rows}`,
        piecesCount: total,
      });
      return Response.json(
        { ok: true, slug, pieceCount: total, gridCols: cols, gridRows: rows, pieces: cachedBatch },
        {
          status: 200,
          headers: { "Cache-Control": "private, max-age=3600" },
        },
      );
    }

    let pieces: Record<number, string> | null = null;

    // 3. For built-in puzzles ONLY, check pre-generated embedded bundle (0ms for 2x2, 3x3, 4x4)
    if (!isUploaded) {
      pieces = getEmbeddedAllPieces(slug, cols);
    }

    // 4. For uploaded puzzles OR missing/large built-in grids: fetch pre-generated WebP tiles from Supabase Storage
    if (!pieces || Object.keys(pieces).length < total) {
      try {
        const fetchedPieces: Record<number, string> = {};
        const fetchPromises: Promise<void>[] = [];
        let missingCount = 0;

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
              } else {
                missingCount++;
                console.error("[PUZZLE_STORAGE_OBJECT_MISSING]", {
                  slug,
                  source,
                  grid: `${cols}x${rows}`,
                  pieceId,
                  canonicalPath,
                });
              }
            })(),
          );
        }

        await Promise.all(fetchPromises);

        if (Object.keys(fetchedPieces).length === total) {
          pieces = fetchedPieces;
          batchPiecesCache.set(cacheKey, fetchedPieces);
          console.log("[PUZZLE_IMAGE_SUCCESS]", {
            slug,
            source,
            cached: false,
            grid: `${cols}x${rows}`,
            piecesCount: total,
          });
        } else {
          console.error("[PUZZLE_IMAGE_LOAD_FAILED]", {
            slug,
            source,
            grid: `${cols}x${rows}`,
            received: Object.keys(fetchedPieces).length,
            expected: total,
            missingCount,
          });
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

