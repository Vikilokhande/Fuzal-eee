import { NextRequest } from "next/server";
import { lobbyService } from "@/lib/game/service";
import { joinSchema, LOBBY_CODE_RE } from "@/lib/game/types";
import { errorResponse } from "@/lib/game/http";

export const dynamic = "force-dynamic";

/** POST /api/lobbies/:code/join { name } – the 5-player cap is enforced here. */
export async function POST(
  req: NextRequest,
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
    const body = await req.json().catch(() => ({}));
    const { name } = joinSchema.parse(body);
    const { lobby, player } = await lobbyService.join(code, name);
    return Response.json({
      player: {
        id: player.id,
        name: player.name,
        token: player.token,
        score: player.score,
        slot: player.slot,
      },
      lobby: lobbyService.publicView(lobby),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
