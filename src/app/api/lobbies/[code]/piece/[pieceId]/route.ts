import { lobbyRepo } from "@/lib/game/repo";
import { GameState } from "@/lib/game/types";
import { safeEqualToken } from "@/lib/game/auth";
import { errorResponse } from "@/lib/game/http";
import { getPieceBuffer } from "@/lib/game/puzzlePiecesData";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * In-memory global piece buffer cache:
 * Key: `${slug}:${pieceId}`
 * Value: ArrayBuffer of the 200x200 WebP tile (~850 bytes)
 */
const pieceCache = new Map<string, ArrayBuffer>();

/**
 * Short-lived in-memory auth cache:
 * Key: `${code}:${playerId}:${token}`
 * Value: { slug: string; expiresAt: number }
 */
interface AuthEntry {
  slug: string;
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
    if (!Number.isInteger(piece) || piece < 0 || piece >= 16) {
      return Response.json(
        { error: "BAD_REQUEST", message: "Invalid piece index (must be 0..15)." },
        { status: 400 },
      );
    }

    // 1. Fast Auth Check: Check in-memory session cache first
    const cacheKey = `${code}:${playerId}:${token}`;
    const cachedAuth = authCache.get(cacheKey);
    let slug = cachedAuth && cachedAuth.expiresAt > Date.now() ? cachedAuth.slug : null;

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
      }

      // Cache verified session for 120 seconds
      if (slug) {
        authCache.set(cacheKey, { slug, expiresAt: Date.now() + 120_000 });
      }
    }

    if (!slug) {
      return Response.json(
        { error: "FORBIDDEN", message: "Unauthorized piece request." },
        { status: 403 },
      );
    }

    // 2. Ultra-Fast: Check pre-sliced 200x200 WebP bundle first (0ms)
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

    // 3. Fallback: In-memory piece cache or storage
    const pieceNumStr = String(piece).padStart(2, "0");
    const piecePath = `${slug}/pieces/${pieceNumStr}.webp`;
    let arrayBuffer = pieceCache.get(piecePath);

    if (!arrayBuffer) {
      // Fast path: Fetch directly from Supabase public CDN endpoint
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, "");
      const cdnUrl = `${supabaseUrl}/storage/v1/object/public/puzzle-images/${piecePath}`;

      let fetchedData: ArrayBuffer | null = null;
      try {
        const cdnRes = await fetch(cdnUrl);
        if (cdnRes.ok) {
          fetchedData = await cdnRes.arrayBuffer();
        }
      } catch {
        // Fallback to Supabase JS SDK download
      }

      if (!fetchedData) {
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
        fetchedData = await fileData.arrayBuffer();
      }

      arrayBuffer = fetchedData;
      pieceCache.set(piecePath, arrayBuffer);
    }

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
