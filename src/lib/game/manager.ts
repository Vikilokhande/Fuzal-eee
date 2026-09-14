/**
 * ConnectionManager
 * -----------------
 * Authoritative real-time fan-out, one channel per lobby
 * (equivalent to the FastAPI "/lobby/{id}" WebSocket channel).
 *
 * In this deployment the transport is Server-Sent Events (HTTP streaming),
 * which provides the same publish/subscribe semantics and automatic client
 * reconnection as a raw WebSocket while running inside Next.js route
 * handlers. The client API (`services/realtime.ts`) exposes a socket-style
 * on/connect/disconnect interface.
 *
 * Responsibilities:
 *  - connect / disconnect clients
 *  - broadcast lobby updates to every subscriber
 *  - send player-specific messages (personal shuffled puzzle, move results)
 *  - host-only messages (full image during memory phase)
 *  - seamless reconnects (same player id replaces a dead socket; the service
 *    layer then replays a full SNAPSHOT)
 */
import { supabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/admin";
import type { GameEvent, EventType } from "./types";

import { isTransientDbError } from "./repo";

export interface Subscriber {
  /** `host:<tokenhash>` for the big screen, the player id for phones. */
  id: string;
  send: (frame: string, eventId?: number) => void;
}

/** Records an event in Supabase lobby_events and returns its authoritative cursor id.
 * Non-authoritative event history write: bounded retries with fast backoff,
 * idempotency deduplication, and non-blocking timeout handling.
 */
export async function persistEvent(
  code: string,
  event: GameEvent,
  targetId?: string | null,
  gameId?: string | null,
): Promise<number | undefined> {
  if (!isSupabaseConfigured()) return undefined;

  const maxAttempts = 3;
  const timeoutMs = 1500;
  const startTime = Date.now();
  const upperCode = code.toUpperCase();
  const payloadObj = (event.payload ?? {}) as Record<string, any>;
  const actionId = payloadObj.actionId ? String(payloadObj.actionId) : null;
  const previousGameId = payloadObj.previousGameId ? String(payloadObj.previousGameId) : null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // Idempotency check on retry: if attempt > 1, verify whether the event was already persisted
      // in PostgreSQL before the previous attempt timed out on the gateway.
      if (attempt > 1) {
        const checkCtrl = new AbortController();
        const checkHandle = setTimeout(() => checkCtrl.abort(), 1000);
        try {
          if (actionId) {
            const { data: existing } = await supabaseAdmin
              .from("lobby_events")
              .select("id")
              .eq("lobby_code", upperCode)
              .eq("payload->>actionId", actionId)
              .abortSignal(checkCtrl.signal)
              .limit(1)
              .maybeSingle();
            if (existing?.id) return Number(existing.id);
          } else if (event.type === "GAME_CLOSED" && previousGameId) {
            const { data: existing } = await supabaseAdmin
              .from("lobby_events")
              .select("id")
              .eq("lobby_code", upperCode)
              .eq("event_type", "GAME_CLOSED")
              .eq("payload->>previousGameId", previousGameId)
              .abortSignal(checkCtrl.signal)
              .limit(1)
              .maybeSingle();
            if (existing?.id) return Number(existing.id);
          } else if (event.type === "LOBBY_RESET" && previousGameId) {
            const { data: existing } = await supabaseAdmin
              .from("lobby_events")
              .select("id")
              .eq("lobby_code", upperCode)
              .eq("event_type", "LOBBY_RESET")
              .eq("payload->>previousGameId", previousGameId)
              .abortSignal(checkCtrl.signal)
              .limit(1)
              .maybeSingle();
            if (existing?.id) return Number(existing.id);
          }
        } catch {
          // Ignore idempotency check timeout, fall through to insertion attempt
        } finally {
          clearTimeout(checkHandle);
        }
      }

      // Bounded insert with AbortSignal timeout to prevent hanging on gateway timeout
      const controller = new AbortController();
      const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

      let insertRes: { data: any; error: any };
      try {
        insertRes = await supabaseAdmin
          .from("lobby_events")
          .insert({
            lobby_code: upperCode,
            game_id: gameId ?? null,
            event_type: event.type,
            payload: event.payload as any,
            target_id: targetId ?? null,
          })
          .select("id")
          .abortSignal(controller.signal)
          .single();
      } finally {
        clearTimeout(timeoutHandle);
      }

      const { data, error } = insertRes;

      if (!error && data?.id) {
        return Number(data.id);
      }

      const isTransient = isTransientDbError(error);
      const isLast = attempt === maxAttempts;

      if (!isTransient || isLast) {
        console.warn(`[EVENT_PERSIST_WARN] ${event.type}: ${error?.message ?? "Gateway Timeout"}`, {
          operation: "persist_event",
          eventType: event.type,
          lobbyCode: upperCode,
          gameId: gameId ?? null,
          actionId,
          attempt,
          maxAttempts,
          totalDurationMs: Date.now() - startTime,
          errorName: error?.name ?? "DatabaseError",
          errorMessage: error?.message ?? "Unknown error",
          errorCode: error?.code ?? null,
        });
        return undefined;
      }

      // Short backoff: attempt 1 -> 50ms, attempt 2 -> 150ms
      const backoffMs = attempt === 1 ? 50 : 150;
      await new Promise((r) => setTimeout(r, backoffMs));
    } catch (thrown: any) {
      const isTransient = isTransientDbError(thrown) || thrown?.name === "AbortError";
      const isLast = attempt === maxAttempts;

      if (!isTransient || isLast) {
        console.warn(`[EVENT_PERSIST_WARN] ${event.type}: ${thrown?.message ?? "Timeout exception"}`, {
          operation: "persist_event",
          eventType: event.type,
          lobbyCode: upperCode,
          gameId: gameId ?? null,
          actionId,
          attempt,
          maxAttempts,
          totalDurationMs: Date.now() - startTime,
          errorName: thrown?.name ?? "Exception",
          errorMessage: thrown?.message ?? "Unknown exception",
          errorCode: thrown?.code ?? null,
        });
        return undefined;
      }

      const backoffMs = attempt === 1 ? 50 : 150;
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }

  return undefined;
}

/** Fetches missed events after a given monotonic cursor */
export async function getEventsAfter(
  code: string,
  afterId: number,
  targetId?: string,
): Promise<Array<{ id: number; type: EventType; payload: any; at: number; gameId?: string | null }>> {
  if (!isSupabaseConfigured()) return [];
  try {
    const { data, error } = await supabaseAdmin
      .from("lobby_events")
      .select("id, event_type, payload, target_id, game_id, created_at")
      .eq("lobby_code", code.toUpperCase())
      .gt("id", afterId)
      .order("id", { ascending: true })
      .limit(100);

    if (error || !data) return [];

    return data
      .filter((row) => {
        if (!row.target_id) return true; // broadcast
        if (targetId?.startsWith("host:") && row.target_id === "host") return true;
        if (targetId && !targetId.startsWith("host:") && row.target_id === "players") return true;
        if (targetId && row.target_id === targetId) return true;
        return false;
      })
      .map((row) => {
        let payload = row.payload;
        // SSE ISOLATION: Ensure catch-up replay never delivers another player's board
        if (payload && Array.isArray(payload.board) && payload.playerId && targetId) {
          if (payload.playerId !== targetId) {
            const sanitized = { ...payload };
            delete sanitized.board;
            payload = sanitized;
          }
        }
        return {
          id: Number(row.id),
          type: row.event_type as EventType,
          payload,
          at: new Date(row.created_at).getTime(),
          gameId: row.game_id,
        };
      });
  } catch {
    return [];
  }
}

/** Gets the latest event ID for cursor anchoring */
export async function getLatestEventId(code: string): Promise<number> {
  if (!isSupabaseConfigured()) return 0;
  try {
    const { data } = await supabaseAdmin
      .from("lobby_events")
      .select("id")
      .eq("lobby_code", code.toUpperCase())
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();
    return data?.id ? Number(data.id) : 0;
  } catch {
    return 0;
  }
}

class ConnectionManager {
  private channels = new Map<string, Set<Subscriber>>();
  private localEventId = 0;

  connect(code: string, sub: Subscriber): () => void {
    let channel = this.channels.get(code);
    if (!channel) {
      channel = new Set();
      this.channels.set(code, channel);
    }
    for (const existing of channel) {
      if (existing.id === sub.id) channel.delete(existing);
    }
    channel.add(sub);
    return () => {
      const ch = this.channels.get(code);
      ch?.delete(sub);
      if (ch && ch.size === 0) this.channels.delete(code);
    };
  }

  subscriberCount(code: string): number {
    return this.channels.get(code)?.size ?? 0;
  }

  /** Send to everyone in the lobby. */
  async broadcast(code: string, event: GameEvent, gameId?: string | null): Promise<void> {
    // SSE ISOLATION: A puzzle board must NEVER be broadcast to all players!
    if ((event.payload as any)?.board) {
      console.error("[SECURITY_VIOLATION] Attempted to broadcast an event containing a puzzle board!", {
        code,
        type: event.type,
      });
      const sanitized = { ...(event.payload as any) };
      delete sanitized.board;
      event = { ...event, payload: sanitized };
    }
    await this.persistAndDeliver(code, null, () => true, event, gameId);
  }

  /** Send to every phone (never the host). */
  async broadcastToPlayers(code: string, event: GameEvent, gameId?: string | null): Promise<void> {
    await this.persistAndDeliver(
      code,
      "players",
      (id) => !id.startsWith("host:"),
      event,
      gameId,
    );
  }

  /** Send to the host only. */
  async sendToHost(code: string, event: GameEvent, gameId?: string | null): Promise<void> {
    await this.persistAndDeliver(
      code,
      "host",
      (id) => id.startsWith("host:"),
      event,
      gameId,
    );
  }

  /** Send to a single player. */
  async sendToPlayer(
    code: string,
    playerId: string,
    event: GameEvent,
    gameId?: string | null,
  ): Promise<void> {
    await this.persistAndDeliver(code, playerId, (id) => id === playerId, event, gameId);
  }

  private async persistAndDeliver(
    code: string,
    targetId: string | null,
    match: (subscriberId: string) => boolean,
    event: GameEvent,
    explicitGameId?: string | null,
  ): Promise<void> {
    const gameId = event.gameId ?? explicitGameId ?? null;
    const persistedId = await persistEvent(code, { ...event, gameId }, targetId, gameId);
    const eventId =
      persistedId ??
      event.eventId ??
      (!isSupabaseConfigured() ? ++this.localEventId : undefined);
    const outbound: GameEvent = {
      ...event,
      gameId,
      eventId,
    };
    this.deliver(code, match, outbound);
  }

  private deliver(
    code: string,
    match: (subscriberId: string) => boolean,
    event: GameEvent,
  ): void {
    const channel = this.channels.get(code);
    if (!channel) return;
    const frame = JSON.stringify(event);
    for (const sub of channel) {
      if (!match(sub.id)) continue;
      // SSE ISOLATION: If event payload contains a player's puzzle board,
      // verify that subscriber matches that player id. Never deliver Player A's board to Player B!
      const p = (event.payload ?? {}) as Record<string, unknown>;
      if (Array.isArray(p.board)) {
        const targetPlayerId = typeof p.playerId === "string" ? p.playerId : null;
        if (targetPlayerId && targetPlayerId !== sub.id) {
          continue; // Block delivery of foreign player's board
        }
      }
      try {
        sub.send(frame, event.eventId);
      } catch {
        channel.delete(sub);
      }
    }
  }
}

const globalForManager = globalThis as typeof globalThis & {
  __fuzalManager?: ConnectionManager;
};

export const manager: ConnectionManager =
  globalForManager.__fuzalManager ?? new ConnectionManager();
if (process.env.NODE_ENV !== "production") {
  globalForManager.__fuzalManager = manager;
}

