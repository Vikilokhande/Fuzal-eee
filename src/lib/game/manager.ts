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

export interface Subscriber {
  /** `host:<tokenhash>` for the big screen, the player id for phones. */
  id: string;
  send: (frame: string, eventId?: number) => void;
}

/** Records an event in Supabase lobby_events and returns its authoritative cursor id. */
async function persistEvent(
  code: string,
  event: GameEvent,
  targetId?: string | null,
  gameId?: string | null,
): Promise<number | undefined> {
  if (!isSupabaseConfigured()) return undefined;
  try {
    const { data, error } = await supabaseAdmin
      .from("lobby_events")
      .insert({
        lobby_code: code.toUpperCase(),
        game_id: gameId ?? null,
        event_type: event.type,
        payload: event.payload as any,
        target_id: targetId ?? null,
      })
      .select("id")
      .single();

    if (error) {
      console.warn(`[EVENT_PERSIST_WARN] ${event.type}:`, error.message);
      return undefined;
    }
    return data?.id ? Number(data.id) : undefined;
  } catch (err: any) {
    console.warn(`[EVENT_PERSIST_ERR] ${event.type}:`, err?.message);
    return undefined;
  }
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
      .map((row) => ({
        id: Number(row.id),
        type: row.event_type as EventType,
        payload: row.payload,
        at: new Date(row.created_at).getTime(),
        gameId: row.game_id,
      }));
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

