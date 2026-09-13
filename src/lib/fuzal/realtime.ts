/**
 * Socket-style realtime client over SSE.
 * Mirrors the WebSocket client in the FastAPI/Vite reference design:
 * connect() / on(event) / disconnect(), with transparent exponential
 * reconnection and connection-state callbacks.
 */
import type { GameEvent } from "@/lib/game/types";

export type ConnectionState = "connecting" | "open" | "reconnecting" | "error";

export interface SocketOptions {
  code: string;
  kind: "host" | "player";
  hostToken?: string;
  playerId?: string;
  playerToken?: string;
  onEvent: (event: GameEvent) => void;
  onStateChange?: (state: ConnectionState) => void;
  onSessionExpired?: () => void;
}

export class FuzalSocket {
  private es: EventSource | null = null;
  private closedByUser = false;
  private retries = 0;
  private lastProcessedEventId = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private opts: SocketOptions) {}

  connect() {
    this.closedByUser = false;
    this.open();
  }

  private open() {
    if (this.closedByUser) return;
    const params = new URLSearchParams({ kind: this.opts.kind });
    if (this.opts.kind === "host" && this.opts.hostToken) {
      params.set("t", this.opts.hostToken);
    } else if (this.opts.playerId && this.opts.playerToken) {
      params.set("p", this.opts.playerId);
      params.set("t", this.opts.playerToken);
    }
    if (this.lastProcessedEventId > 0) {
      params.set("after", String(this.lastProcessedEventId));
    }

    const url = `/api/lobbies/${this.opts.code}/events?${params.toString()}`;
    this.opts.onStateChange?.(
      this.retries === 0 ? "connecting" : this.retries >= 5 ? "error" : "reconnecting",
    );

    const es = new EventSource(url);
    this.es = es;

    es.onopen = () => {
      this.retries = 0;
      this.opts.onStateChange?.("open");
    };

    // Clean bounded rotation event from server
    es.addEventListener("stream_end", () => {
      es.close();
      if (!this.closedByUser) {
        // Immediate clean reconnect with ?after cursor
        this.open();
      }
    });

    // Controlled session expiration event from server
    es.addEventListener("session_expired", () => {
      this.disconnect();
      this.opts.onSessionExpired?.();
    });

    es.onmessage = (msg) => {
      try {
        if (msg.lastEventId) {
          const id = parseInt(msg.lastEventId, 10);
          if (!isNaN(id) && id > this.lastProcessedEventId) {
            this.lastProcessedEventId = id;
          }
        }
        const event = JSON.parse(msg.data) as GameEvent;
        if (event.type === "SESSION_EXPIRED" as any) {
          this.disconnect();
          this.opts.onSessionExpired?.();
          return;
        }
        if (event.eventId) {
          if (event.eventId <= this.lastProcessedEventId && event.type !== "SNAPSHOT") {
            return; // Duplicate frame, ignore
          }
          this.lastProcessedEventId = Math.max(this.lastProcessedEventId, event.eventId);
        }
        this.opts.onEvent(event);
      } catch (e) {
        console.error("[fuzal] bad event frame", e);
      }
    };

    es.onerror = () => {
      es.close();
      if (this.closedByUser) return;

      // Check if the disconnect was caused by session expiration (HTTP 401/403/410)
      const verifyUrl = `/api/lobbies/${this.opts.code}/events?verify=1&${params.toString()}`;
      fetch(verifyUrl)
        .then((res) => {
          if (res.status === 401 || res.status === 403 || res.status === 410) {
            this.disconnect();
            this.opts.onSessionExpired?.();
            return;
          }
          this.scheduleReconnect();
        })
        .catch(() => {
          this.scheduleReconnect();
        });
    };
  }

  private scheduleReconnect() {
    if (this.closedByUser) return;
    this.retries += 1;
    if (this.retries >= 5) {
      this.opts.onStateChange?.("error");
    } else {
      this.opts.onStateChange?.("reconnecting");
    }
    const delay = Math.min(800 * 2 ** Math.min(this.retries, 5), 8000);
    this.reconnectTimer = setTimeout(() => this.open(), delay);
  }

  retry() {
    this.retries = 0;
    this.disconnect();
    this.connect();
  }

  disconnect() {
    this.closedByUser = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.es?.close();
    this.es = null;
  }
}

