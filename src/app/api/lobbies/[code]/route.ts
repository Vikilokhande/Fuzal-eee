import { lobbyService } from "@/lib/game/service";
import { LOBBY_CODE_RE } from "@/lib/game/types";
import { errorResponse } from "@/lib/game/http";

export const dynamic = "force-dynamic";

/** GET /api/lobbies/:code – public, sanitized lobby info for the join page. */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ code: string }> },
) {
  try {
    const { code } = await ctx.params;
    if (!LOBBY_CODE_RE.test(code)) {
      return Response.json(
        { error: "BAD_REQUEST", message: "Invalid game code." },
        { status: 400 },
      );
    }
    const lobby = await lobbyService.getLobby(code);
    return Response.json(lobbyService.publicView(lobby));
  } catch (e) {
    return errorResponse(e);
  }
}
