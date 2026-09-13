import { NextRequest } from "next/server";
import { gameService, lobbyService } from "@/lib/game/service";
import { actionSchema, LOBBY_CODE_RE } from "@/lib/game/types";
import { errorResponse } from "@/lib/game/http";

export const dynamic = "force-dynamic";

/**
 * POST /api/lobbies/:code/actions
 * Mutating commands (the "send" side of the realtime protocol):
 *   START_GAME | BEGIN_PUZZLE | SWAP | COMPLETE | PLAY_AGAIN | BACK_TO_LOBBY
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
      case "BEGIN_PUZZLE": {
        await gameService.beginPuzzle(code, false);
        const currentLobby = await gameService.ensureAuthoritativePhase(code);
        const beginData = action.data as { playerId?: string };
        const player = beginData.playerId
          ? currentLobby.players.find((p) => p.id === beginData.playerId)
          : null;
        return Response.json({
          ok: true,
          status: currentLobby.status,
          gameId: currentLobby.currentGameId ?? null,
          startedAt: currentLobby.puzzleStartedAt,
          endsAt: currentLobby.puzzleEndsAt,
          durationSeconds: currentLobby.puzzleDurationSeconds,
          pieceCount: currentLobby.pieceCount,
          gridCols: currentLobby.gridCols,
          gridRows: currentLobby.gridRows,
          board: player?.puzzle?.board ?? null,
          moves: player?.puzzle?.moves ?? 0,
        });
      }
      case "SWAP": {
        const swapResult = await gameService.applySwap(
          code,
          action.data.playerId,
          action.data.token,
          action.data.from,
          action.data.to,
          action.data.gameId ?? null,
          action.data.actionId,
        );
        return Response.json({
          ok: true,
          actionId: action.data.actionId ?? null,
          ...swapResult,
        });
      }
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
    // Authoritative Reliability Invariant:
    // Once authoritative mutation succeeds, non-authoritative event-history timeouts
    // never fail the user action or return 500.
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
