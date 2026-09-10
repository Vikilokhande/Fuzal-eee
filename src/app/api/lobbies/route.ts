import { NextRequest } from "next/server";
import { lobbyService } from "@/lib/game/service";
import { createLobbySchema } from "@/lib/game/types";
import { errorResponse } from "@/lib/game/http";

export const dynamic = "force-dynamic";

/** POST /api/lobbies – host creates a new lobby (returns the host token). */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const opts = createLobbySchema.parse(body);
    const lobby = await lobbyService.createLobby(opts);
    return Response.json({
      code: lobby.code,
      lobbyId: lobby.id,
      hostToken: lobby.hostToken,
      maxPlayers: lobby.maxPlayers,
      gridCols: lobby.gridCols,
      gridRows: lobby.gridRows,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
