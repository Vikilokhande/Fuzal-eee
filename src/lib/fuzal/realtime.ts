/**
 * Socket-style realtime client over SSE.
 * Mirrors the WebSocket client in the FastAPI/Vite reference design:
 * connect() / on(event) / disconnect(), with transparent exponential
 * reconnection and connection-state callbacks.
 */
import type { GameEvent } from "@/lib/game/types";

export type ConnectionState = "connecting" | "open" | "reconnecting";

export interface SocketOptions {
  code: string;
  kind: "host" | "player";
  hostToken?: string;
  playerId?: string;
  playerToken?: string;
  onEvent: (event: GameEvent) => void;
  onStateChange?: (state: ConnectionState) => void;
}

export class FuzalSocket {
  private es: EventSource | null = null;
  private closedByUser = false;
  private retries = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private opts: SocketOptions) {}

  connect() {
    this.closedByUser = false;
    this.open();
  }

  private open() {
    const params = new URLSearchParams({ kind: this.opts.kind });
    if (this.opts.kind === "host" && this.opts.hostToken) {
      params.set("t", this.opts.hostToken);
    } else if (this.opts.playerId && this.opts.playerToken) {
      params.set("p", this.opts.playerId);
      params.set("t", this.opts.playerToken);
    }
    const url = `/api/lobbies/${this.opts.code}/events?${params.toString()}`;
    this.opts.onStateChange?.(this.retries === 0 ? "connecting" : "reconnecting");
    const es = new EventSource(url);
    this.es = es;

    es.onopen = () => {
      this.retries = 0;
      this.opts.onStateChange?.("open");
    };

    es.onmessage = (msg) => {
      try {
        const event = JSON.parse(msg.data) as GameEvent;
        this.opts.onEvent(event);
      } catch (e) {
        console.error("[fuzal] bad event frame", e);
      }
    };

    es.onerror = () => {
      // EventSource auto-retries; we force our own backoff as well.
      es.close();
      if (this.closedByUser) return;
      this.retries += 1;
      this.opts.onStateChange?.("reconnecting");
      const delay = Math.min(800 * 2 ** Math.min(this.retries, 5), 8000);
      this.reconnectTimer = setTimeout(() => this.open(), delay);
    };
  }

  disconnect() {
    this.closedByUser = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.es?.close();
    this.es = null;
  }
}
