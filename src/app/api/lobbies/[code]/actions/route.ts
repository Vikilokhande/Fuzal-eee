import { NextRequest } from "next/server";
import { gameService } from "@/lib/game/service";
import { actionSchema, LOBBY_CODE_RE } from "@/lib/game/types";
import { errorResponse } from "@/lib/game/http";

export const dynamic = "force-dynamic";

/**
 * POST /api/lobbies/:code/actions
 * Mutating commands (the "send" side of the realtime protocol):
 *   START_GAME | SWAP | PLAY_AGAIN | BACK_TO_LOBBY
 * Winner status is NEVER accepted from clients – the server decides.
 */
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
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return Response.json(
        { error: "BAD_REQUEST", message: "Malformed request payload." },
        { status: 400 },
      );
    }
    const action = actionSchema.safeParse(body);
    if (!action.success) {
      return errorResponse(action.error);
    }
    switch (action.data.type) {
      case "START_GAME":
        await gameService.startGame(code, action.data.token);
        break;
      case "SWAP":
        await gameService.applySwap(
          code,
          action.data.playerId,
          action.data.token,
          action.data.from,
          action.data.to,
          action.data.gameId ?? null,
          action.data.actionId,
        );
        break;
      case "COMPLETE":
        await gameService.verifyCompletion(
          code,
          action.data.playerId,
          action.data.token,
          action.data.gameId ?? null,
          action.data.actionId,
        );
        break;
      case "PLAY_AGAIN":
        await gameService.playAgain(code, action.data.token);
        break;
      case "BACK_TO_LOBBY":
        await gameService.backToLobby(code, action.data.token);
        break;
    }
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
