import { readFile } from "node:fs/promises";
import path from "node:path";
import { lobbyService } from "@/lib/game/service";
import { findPlayer } from "@/lib/game/repo";
import { GameState } from "@/lib/game/types";
import { SOURCE_VIEWBOX } from "@/lib/game/imageService";
import { safeEqualToken } from "@/lib/game/auth";
import { errorResponse } from "@/lib/game/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SAFE_FILE = /^image_\d{3}\.svg$/;

/**
 * GET /api/lobbies/:code/piece/:pieceId?p=playerId&t=token
 *
 * Anti-cheat image delivery: returns ONLY the cropped SVG for one puzzle
 * piece (via a narrowed viewBox). The assembled original is never sent to
 * phones after the memory phase. Requires a valid player session and only
 * works while the puzzle (or finished reveal) is active.
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
      throw Object.assign(new Error("Puzzle is not active."), {
        code: "INVALID_STATE",
        httpStatus: 409,
      }) as Error & { code: string; httpStatus: number };
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
        { error: "BAD_REQUEST", message: "Invalid piece." },
        { status: 400 },
      );
    }

    const image = lobby.memory?.image;
    if (!image) {
      return Response.json(
        { error: "INVALID_STATE", message: "No image for this round." },
        { status: 409 },
      );
    }
    const file = path.basename(image.url);
    if (!SAFE_FILE.test(file)) {
      return new Response("Bad image", { status: 500 });
    }

    const filePath = path.join(process.cwd(), "public", "images", file);
    const source = await readFile(filePath, "utf8");

    const col = piece % lobby.gridCols;
    const row = Math.floor(piece / lobby.gridCols);
    const w = SOURCE_VIEWBOX / lobby.gridCols;
    const h = SOURCE_VIEWBOX / lobby.gridRows;
    const x = col * w;
    const y = row * h;

    const cropped = source
      .replace(
        /viewBox="[^"]*"/,
        `viewBox="${x} ${y} ${w} ${h}"`,
      )
      .replace(
        /<svg\b/,
        '<svg width="100%" height="100%" preserveAspectRatio="xMidYMid slice"',
      );

    return new Response(cropped, {
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    // Domain-style error thrown inline above
    if (e && typeof e === "object" && "httpStatus" in e) {
      const err = e as Error & { code: string; httpStatus: number };
      return Response.json(
        { error: err.code, message: err.message },
        { status: err.httpStatus },
      );
    }
    return errorResponse(e);
  }
}
