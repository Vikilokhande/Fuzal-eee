import { manager } from "@/lib/game/manager";
import { lobbyService } from "@/lib/game/service";
import { LOBBY_CODE_RE, PLAYER_ID_RE } from "@/lib/game/types";
import { errorResponse } from "@/lib/game/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/lobbies/:code/events?kind=host&t=hostToken
 * GET /api/lobbies/:code/events?kind=player&p=playerId&t=playerToken
 *
 * Server-Sent Events channel (lobby-scoped, like /lobby/FZ-XXXX on the
 * FastAPI reference). Delivers a full role-specific SNAPSHOT first, then live
 * events. The client auto-reconnects with EventSource; reconnecting with the
 * same player id restores the session and game state.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ code: string }> },
) {
  const { code } = await ctx.params;
  if (!LOBBY_CODE_RE.test(code)) {
    return Response.json(
      { error: "BAD_REQUEST", message: "Invalid game code." },
      { status: 400 },
    );
  }

  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") === "host" ? "host" : "player";
  const hostToken = url.searchParams.get("t") ?? "";
  const playerId = url.searchParams.get("p") ?? "";
  const playerToken = url.searchParams.get("t") ?? "";

  if (kind === "host" ? hostToken.length < 10 : !PLAYER_ID_RE.test(playerId)) {
    return Response.json(
      { error: "FORBIDDEN", message: "Invalid connection parameters." },
      { status: 403 },
    );
  }

  let connected: Awaited<ReturnType<typeof lobbyService.handleConnect>>;
  try {
    connected = await lobbyService.handleConnect(code, {
      hostToken: kind === "host" ? hostToken : undefined,
      playerId: kind === "player" ? playerId : undefined,
      playerToken: kind === "player" ? playerToken : undefined,
    });
  } catch (e) {
    return errorResponse(e);
  }
  const { lobby, player } = connected;

  const encoder = new TextEncoder();
  const subscribeId = kind === "host" ? `host:${code}` : playerId!;
  let closed = false;

  const stream = new ReadableStream({
    start(controller) {
      const sendFrame = (frame: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${frame}\n\n`));
        } catch {
          closed = true;
        }
      };

      const unsubscribe = manager.connect(code, {
        id: subscribeId,
        send: (frame) => sendFrame(frame),
      });

      // Authoritative catch-up snapshot (covers disconnect/reconnect gaps).
      sendFrame(JSON.stringify(lobbyService.buildSnapshot(lobby, kind, player)));

      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          /* closed */
        }
      }, 20000);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        if (kind === "player" && playerId) {
          void lobbyService.handleDisconnect(code, playerId);
        }
        try {
          controller.close();
        } catch {
          /* noop */
        }
      };

      req.signal.addEventListener("abort", cleanup);
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
