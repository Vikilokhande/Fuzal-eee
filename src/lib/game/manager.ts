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
import type { GameEvent } from "./types";

export interface Subscriber {
  /** `host:<tokenhash>` for the big screen, the player id for phones. */
  id: string;
  send: (frame: string) => void;
}

class ConnectionManager {
  private channels = new Map<string, Set<Subscriber>>();

  connect(code: string, sub: Subscriber): () => void {
    let channel = this.channels.get(code);
    if (!channel) {
      channel = new Set();
      this.channels.set(code, channel);
    }
    // A reconnecting client replaces its previous dead socket.
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
  broadcast(code: string, event: GameEvent): void {
    this.deliver(code, () => true, event);
  }

  /** Send to every phone (never the host). */
  broadcastToPlayers(code: string, event: GameEvent): void {
    this.deliver(code, (id) => !id.startsWith("host:"), event);
  }

  /** Send to the host only (e.g. the un-cropped memory image). */
  sendToHost(code: string, event: GameEvent): void {
    this.deliver(code, (id) => id.startsWith("host:"), event);
  }

  /** Send to a single player (personal puzzle/move results). */
  sendToPlayer(code: string, playerId: string, event: GameEvent): void {
    this.deliver(code, (id) => id === playerId, event);
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
        sub.send(frame);
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
