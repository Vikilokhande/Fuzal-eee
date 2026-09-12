import { lobbyRepo } from "@/lib/game/repo";
import { GameState } from "@/lib/game/types";
import { safeEqualToken } from "@/lib/game/auth";
import { errorResponse } from "@/lib/game/http";
import { getAllPiecesForSlug } from "@/lib/game/puzzlePiecesData";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Fast batch pieces endpoint:
 * Returns all 16 WebP pieces in a single compressed JSON response (<20KB).
 * Eliminates 16 concurrent HTTP connections and database connection saturation on mobile.
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

    // 1. Verify player session and determine active puzzle image
    let slug: string | null = null;

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
    }

    if (!slug) {
      return Response.json(
        { error: "FORBIDDEN", message: "Unauthorized pieces request." },
        { status: 403 },
      );
    }

    // 2. Fetch pre-sliced pieces from embedded bundle (0ms)
    let pieces = getAllPiecesForSlug(slug);

    // Fallback: If not in embedded bundle, fetch from Supabase Storage
    if (!pieces) {
      pieces = {};
      const fetches = Array.from({ length: 16 }, async (_, pieceId) => {
        const pieceNumStr = String(pieceId).padStart(2, "0");
        const piecePath = `${slug}/pieces/${pieceNumStr}.webp`;
        const { data: fileData } = await supabaseAdmin.storage
          .from("puzzle-images")
          .download(piecePath);
        if (fileData) {
          const buf = Buffer.from(await fileData.arrayBuffer());
          pieces![pieceId] = `data:image/webp;base64,${buf.toString("base64")}`;
        }
      });
      await Promise.all(fetches);
    }

    return Response.json(
      { ok: true, slug, pieces },
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
