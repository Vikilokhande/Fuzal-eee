import { lobbyRepo } from "@/lib/game/repo";
import { GameState } from "@/lib/game/types";
import { safeEqualToken } from "@/lib/game/auth";
import { errorResponse } from "@/lib/game/http";
import { getEmbeddedPieceBuffer } from "@/lib/game/puzzlePiecesData";
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

/**
 * In-memory cache of verified player sessions
 * Key: `${code}:${playerId}:${token}`
 */
interface AuthEntry {
  gameId: string | null;
  slug: string;
  pieceCount: number;
  cols: number;
  rows: number;
  expiresAt: number;
}
const authCache = new Map<string, AuthEntry>();

/**
 * In-memory cache of pre-generated WebP buffers: `${slug}:${cols}x${rows}:${pieceId}`
 */
const pieceBufferCache = new Map<string, Buffer>();

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  "https://dewdcxssvkvbgyyenmmu.supabase.co";

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

    // 1. Validate piece ID format: strictly positive integer
    const piece = Number(pieceParam);
    if (!Number.isInteger(piece) || piece < 0 || piece >= 64) {
      return Response.json(
        { error: "BAD_REQUEST", message: "Invalid piece index." },
        { status: 400 },
      );
    }

    // 2. Authentication & authorization check
    const authKey = `${code}:${playerId}:${token}`;
    const cachedAuth = authCache.get(authKey);
    let gameId = cachedAuth && cachedAuth.expiresAt > Date.now() ? cachedAuth.gameId : null;
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
        const p = localLobby.players?.find((x: any) => x.id === playerId);
        if (!p || !safeEqualToken(token, p.token)) {
          return Response.json(
            { error: "FORBIDDEN", message: "Invalid player session." },
            { status: 403 },
          );
        }
        const img = localLobby.memory?.image;
        slug = img?.slug ?? img?.name?.toLowerCase().replace(/[^a-z0-9]+/g, "-") ?? null;
        gameId = localLobby.gameId ?? localLobby.id ?? null;
        total = pieceCountFromLobby(localLobby);
        cols = Number(localLobby.gridCols ?? 3);
        rows = Number(localLobby.gridRows ?? 3);
      }

      // Supabase repository check
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
        gameId = lobby.currentGameId ?? (lobby as any).gameId ?? lobby.id ?? null;
        total = pieceCountFromLobby(lobby);
        cols = Number(lobby.gridCols ?? 3);
        rows = Number(lobby.gridRows ?? 3);
      }

      if (slug) {
        authCache.set(authKey, {
          gameId,
          slug,
          pieceCount: total,
          cols,
          rows,
          expiresAt: Date.now() + 120_000,
        });
      }
    }

    if (!slug) {
      return Response.json(
        { error: "FORBIDDEN", message: "Unauthorized piece request." },
        { status: 403 },
      );
    }

    // 3. Validate piece ID against active game bounds: 0 <= pieceId < pieceCount
    if (piece >= total) {
      return Response.json(
        { error: "BAD_REQUEST", message: "Invalid piece index for this puzzle." },
        { status: 400 },
      );
    }

    // Structured logging: [PIECE_REQUEST]
    console.log(
      `[PIECE_REQUEST] ${JSON.stringify({
        lobbyCode: code,
        gameId,
        pieceId: piece,
        gridSize: cols,
        pieceCount: total,
      })}`,
    );

    // 4. Check in-memory buffer cache (0ms)
    const cacheKey = `${slug}:${cols}x${rows}:${piece}`;
    const memBuf = pieceBufferCache.get(cacheKey);
    if (memBuf) {
      return new Response(memBuf as unknown as BodyInit, {
        status: 200,
        headers: {
          "Content-Type": "image/webp",
          "Cache-Control": "public, max-age=86400, immutable",
        },
      });
    }

    // 5. Check pre-generated embedded bundle (0ms for 2x2, 3x3, 4x4)
    const embeddedBuf = getEmbeddedPieceBuffer(slug, cols, piece);
    if (embeddedBuf) {
      pieceBufferCache.set(cacheKey, embeddedBuf);
      return new Response(embeddedBuf as unknown as BodyInit, {
        status: 200,
        headers: {
          "Content-Type": "image/webp",
          "Cache-Control": "public, max-age=86400, immutable",
        },
      });
    }

    // 6. Deliver pre-generated WebP from Supabase Storage
    const pieceNumStr = String(piece).padStart(2, "0");
    const canonicalStoragePath = `${slug}/pieces/${cols}x${rows}/${pieceNumStr}.webp`;
    const flatStoragePath = `${slug}/pieces/${pieceNumStr}.webp`;

    const start = performance.now();
    let pieceBuf: Buffer | null = null;
    let resolvedPath = canonicalStoragePath;
    let lastError: any = null;

    // Try canonical path via Supabase Admin SDK download
    try {
      const { data, error } = await supabaseAdmin.storage
        .from("puzzle-images")
        .download(canonicalStoragePath);

      if (data && !error) {
        pieceBuf = Buffer.from(await data.arrayBuffer());
        resolvedPath = canonicalStoragePath;
      } else {
        lastError = error;
      }
    } catch (sdkErr) {
      lastError = sdkErr;
    }

    // If canonical path not found in SDK, try flat path (for 4x4 or backward-compatible layouts)
    if (!pieceBuf) {
      try {
        const { data, error } = await supabaseAdmin.storage
          .from("puzzle-images")
          .download(flatStoragePath);

        if (data && !error) {
          pieceBuf = Buffer.from(await data.arrayBuffer());
          resolvedPath = flatStoragePath;
        } else {
          lastError = error;
        }
      } catch (sdkErr) {
        lastError = sdkErr;
      }
    }

    // Direct public CDN fetch fallback if SDK encountered a transient issue
    if (!pieceBuf) {
      try {
        const publicUrl = `${supabaseUrl}/storage/v1/object/public/puzzle-images/${canonicalStoragePath}`;
        const res = await fetch(publicUrl);
        if (res.ok) {
          pieceBuf = Buffer.from(await res.arrayBuffer());
          resolvedPath = canonicalStoragePath;
        }
      } catch (fetchErr) {
        lastError = fetchErr;
      }
    }

    if (pieceBuf) {
      const durationMs = Math.round(performance.now() - start);
      pieceBufferCache.set(cacheKey, pieceBuf);

      // Structured logging: [PIECE_STORAGE_SUCCESS]
      console.log(
        `[PIECE_STORAGE_SUCCESS] ${JSON.stringify({
          pieceId: piece,
          storagePath: resolvedPath,
          durationMs,
          contentType: "image/webp",
          byteLength: pieceBuf.byteLength,
        })}`,
      );

      return new Response(pieceBuf as unknown as BodyInit, {
        status: 200,
        headers: {
          "Content-Type": "image/webp",
          "Cache-Control": "public, max-age=86400, immutable",
        },
      });
    }

    // Storage asset does not exist or failed
    const errorName = lastError?.name || "StorageError";
    const errorMessage = lastError?.message || "Piece asset not found in storage";
    const errorCode = lastError?.status || lastError?.code || "NOT_FOUND";

    // Structured logging: [PIECE_STORAGE_ERROR]
    console.error(
      `[PIECE_STORAGE_ERROR] ${JSON.stringify({
        pieceId: piece,
        operation: "download",
        errorName,
        errorMessage,
        errorCode,
      })}`,
    );

    return Response.json(
      { error: "NOT_FOUND", message: "Piece asset not found in storage." },
      { status: 404 },
    );
  } catch (e) {
    return errorResponse(e);
  }
}

