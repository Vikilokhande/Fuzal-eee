import { manager, getEventsAfter, getLatestEventId } from "@/lib/game/manager";
import { lobbyService } from "@/lib/game/service";
import { LOBBY_CODE_RE, PLAYER_ID_RE, EventType } from "@/lib/game/types";
import { errorResponse } from "@/lib/game/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/lobbies/:code/events?kind=host&t=hostToken
 * GET /api/lobbies/:code/events?kind=player&p=playerId&t=playerToken&after=123
 *
 * Vercel-safe Server-Sent Events channel:
 * - Bounded stream duration (25s) prevents Vercel 300s serverless task timeouts.
 * - Monotonically increasing event IDs with ?after=<cursor> replay ensures zero lost events across serverless instances.
 * - Graceful session expiration returns controlled status codes to stop reconnect loops.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ code: string }> },
) {
  const { code } = await ctx.params;
  const upperCode = code.toUpperCase();
  if (!LOBBY_CODE_RE.test(upperCode)) {
    return Response.json(
      { error: "BAD_REQUEST", message: "Invalid game code." },
      { status: 400 },
    );
  }

  const url = new URL(req.url);
  const isVerifyOnly = url.searchParams.get("verify") === "1";
  const kind = url.searchParams.get("kind") === "host" ? "host" : "player";
  const hostToken = url.searchParams.get("t") ?? "";
  const playerId = url.searchParams.get("p") ?? "";
  const playerToken = url.searchParams.get("t") ?? "";
  const afterParam = url.searchParams.get("after");
  const afterId = afterParam !== null && afterParam !== "" ? parseInt(afterParam, 10) : null;

  if (kind === "host" ? hostToken.length < 10 : !PLAYER_ID_RE.test(playerId)) {
    return Response.json(
      { error: "FORBIDDEN", code: "INVALID_PARAMETERS", message: "Invalid connection parameters." },
      { status: 403 },
    );
  }

  let connected: Awaited<ReturnType<typeof lobbyService.handleConnect>>;
  try {
    connected = await lobbyService.handleConnect(upperCode, {
      hostToken: kind === "host" ? hostToken : undefined,
      playerId: kind === "player" ? playerId : undefined,
      playerToken: kind === "player" ? playerToken : undefined,
    });
  } catch (e: any) {
    if (isVerifyOnly) {
      return errorResponse(e);
    }
    // If the client requested SSE, return a controlled SESSION_EXPIRED frame before closing
    const encoder = new TextEncoder();
    return new Response(
      new ReadableStream({
        start(controller) {
          const frame = JSON.stringify({
            type: "SESSION_EXPIRED",
            error: e?.code ?? "SESSION_EXPIRED",
            message: e?.message ?? "Session expired or lobby was reset.",
          });
          controller.enqueue(encoder.encode(`event: session_expired\ndata: ${frame}\n\n`));
          controller.close();
        },
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
        },
      },
    );
  }

  if (isVerifyOnly) {
    return Response.json({ ok: true, status: connected.lobby.status });
  }

  const { lobby, player } = connected;
  const encoder = new TextEncoder();
  const subscribeId = kind === "host" ? `host:${upperCode}` : playerId!;
  let closed = false;
  let cleanup = () => {};

  const stream = new ReadableStream({
    async start(controller) {
      const sendFrame = (frame: string, eventId?: number, eventName?: string) => {
        if (closed) return;
        try {
          const idPrefix = eventId !== undefined ? `id: ${eventId}\n` : "";
          const eventPrefix = eventName ? `event: ${eventName}\n` : "";
          controller.enqueue(encoder.encode(`${eventPrefix}${idPrefix}data: ${frame}\n\n`));
        } catch {
          closed = true;
        }
      };

      // 1. Subscribe to in-process broadcasts
      const unsubscribe = manager.connect(upperCode, {
        id: subscribeId,
        send: (frame, eventId) => sendFrame(frame, eventId),
      });

      // 2. Deliver catch-up: either missed events after cursor, or initial full snapshot
      try {
        if (afterId !== null && !isNaN(afterId) && afterId >= 0) {
          const missedEvents = await getEventsAfter(upperCode, afterId, subscribeId);
          for (const ev of missedEvents) {
            sendFrame(
              JSON.stringify({
                type: ev.type,
                payload: ev.payload,
                at: ev.at,
                eventId: ev.id,
              }),
              ev.id,
            );
          }
        } else {
          // Fresh connection: anchor cursor with latest event ID
          const latestId = await getLatestEventId(upperCode);
          sendFrame(JSON.stringify(lobbyService.buildSnapshot(lobby, kind, player)), latestId);
        }
      } catch (catchUpErr) {
        console.warn("[CATCHUP_WARN]", catchUpErr);
      }

      // 3. Heartbeat every 8s
      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          cleanup();
        }
      }, 8000);
      heartbeat.unref?.();

      // 4. Bounded connection: rotate cleanly after 25s (prevents Vercel 300s timeout)
      const rotateTimer = setTimeout(() => {
        if (closed) return;
        sendFrame(JSON.stringify({ type: "STREAM_END", at: Date.now() }), undefined, "stream_end");
        cleanup();
      }, 25000);
      rotateTimer.unref?.();

      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        clearTimeout(rotateTimer);
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* noop */
        }
      };

      req.signal.addEventListener("abort", cleanup);
    },
    cancel() {
      cleanup();
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

