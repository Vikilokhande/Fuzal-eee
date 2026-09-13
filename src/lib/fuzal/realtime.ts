/**
 * Socket-style realtime client over SSE.
 *
 * The serverless route rotates streams every ~25s. This client keeps only one
 * active EventSource at a time, reconnects from the last accepted cursor, and
 * never advances that cursor until the caller confirms that the event was
 * applied to client state.
 */
import { EventType, type GameEvent } from "@/lib/game/types";

export type ConnectionState = "connecting" | "open" | "reconnecting" | "error";

export interface SocketOptions {
  code: string;
  kind: "host" | "player";
  hostToken?: string;
  playerId?: string;
  playerToken?: string;
  initialLastEventId?: number;
  onEvent: (event: GameEvent) => boolean | void;
  onCursorAdvance?: (id: number) => void;
  onStateChange?: (state: ConnectionState) => void;
  onSessionExpired?: () => void;
}

type InternalState =
  | "DISCONNECTED"
  | "CONNECTING"
  | "CONNECTED"
  | "ROTATING"
  | "SESSION_EXPIRED";

const MIN_TOKEN_LENGTH = 10;
const MAX_RETRIES_BEFORE_ERROR = 5;

function parseEventId(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function logRealtime(message: string, meta: Record<string, unknown>) {
  if (process.env.NODE_ENV !== "test") {
    console.info(`[${message}]`, meta);
  }
}

export class FuzalSocket {
  private es: EventSource | null = null;
  private closedByUser = true;
  private retries = 0;
  private lastAppliedEventId = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private state: InternalState = "DISCONNECTED";

  constructor(private opts: SocketOptions) {
    this.lastAppliedEventId = parseEventId(opts.initialLastEventId) ?? 0;
  }

  connect() {
    this.closedByUser = false;
    this.clearReconnectTimer();
    this.closeCurrent("connect");
    this.open();
  }

  retry() {
    this.retries = 0;
    this.closedByUser = false;
    this.clearReconnectTimer();
    this.closeCurrent("retry");
    this.open();
  }

  disconnect() {
    this.closedByUser = true;
    this.state = "DISCONNECTED";
    this.clearReconnectTimer();
    this.closeCurrent("disconnect");
  }

  private open() {
    if (this.closedByUser || this.state === "SESSION_EXPIRED") return;

    if (!this.hasCredentials()) {
      this.state = "DISCONNECTED";
      this.opts.onStateChange?.("connecting");
      logRealtime("SSE_WAITING_FOR_CREDENTIALS", {
        code: this.opts.code,
        kind: this.opts.kind,
      });
      return;
    }

    this.clearReconnectTimer();
    this.closeCurrent("replace");
    this.state = "CONNECTING";
    this.opts.onStateChange?.(
      this.retries === 0
        ? "connecting"
        : this.retries >= MAX_RETRIES_BEFORE_ERROR
          ? "error"
          : "reconnecting",
    );

    const generation = ++this.generation;
    const url = this.buildUrl(false);
    const es = new EventSource(url);
    this.es = es;
    logRealtime("SSE_CONNECT", {
      code: this.opts.code,
      kind: this.opts.kind,
      cursor: this.lastAppliedEventId,
      generation,
    });

    es.onopen = () => {
      if (!this.isCurrent(es, generation)) return;
      this.retries = 0;
      this.state = "CONNECTED";
      this.opts.onStateChange?.("open");
    };

    es.addEventListener("stream_end", () => {
      if (!this.isCurrent(es, generation)) return;
      this.state = "ROTATING";
      this.closeCurrent("stream_end");
      this.scheduleReconnect(0, "stream_end");
    });

    es.addEventListener("session_expired", () => {
      if (!this.isCurrent(es, generation)) return;
      this.expireSession("session_expired");
    });

    es.onmessage = (msg) => {
      if (!this.isCurrent(es, generation)) return;
      this.handleMessage(msg);
    };

    es.onerror = () => {
      if (!this.isCurrent(es, generation)) return;
      const verifyUrl = this.buildUrl(true);
      this.closeCurrent("error");
      void this.verifySession(verifyUrl).then((ok) => {
        if (!ok || this.closedByUser || this.state === "SESSION_EXPIRED") return;
        this.scheduleReconnect(undefined, "error");
      });
    };
  }

  private handleMessage(msg: MessageEvent) {
    let event: GameEvent;
    try {
      event = JSON.parse(String(msg.data)) as GameEvent;
    } catch {
      logRealtime("SSE_BAD_EVENT", {
        code: this.opts.code,
        kind: this.opts.kind,
        cursor: this.lastAppliedEventId,
      });
      return;
    }

    if ((event as any).type === "SESSION_EXPIRED") {
      this.expireSession("message_session_expired");
      return;
    }

    const eventId = parseEventId(event.eventId) ?? parseEventId(msg.lastEventId);
    if (eventId !== null) {
      event = { ...event, eventId };
    }

    if (
      eventId !== null &&
      eventId <= this.lastAppliedEventId &&
      event.type !== EventType.SNAPSHOT
    ) {
      logRealtime("SSE_DUPLICATE_EVENT", {
        code: this.opts.code,
        kind: this.opts.kind,
        eventId,
        cursor: this.lastAppliedEventId,
        type: event.type,
      });
      return;
    }

    const accepted = this.opts.onEvent(event) !== false;
    if (accepted && eventId !== null && eventId > this.lastAppliedEventId) {
      this.lastAppliedEventId = eventId;
      this.opts.onCursorAdvance?.(eventId);
    }
  }

  private async verifySession(url: string): Promise<boolean> {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (res.status === 401 || res.status === 403 || res.status === 410) {
        this.expireSession(`verify_${res.status}`);
        return false;
      }
      return true;
    } catch {
      return true;
    }
  }

  private scheduleReconnect(delayOverrideMs?: number, reason = "unknown") {
    if (this.closedByUser || this.state === "SESSION_EXPIRED") return;
    if (this.reconnectTimer) return;

    this.retries += 1;
    const delay =
      delayOverrideMs ??
      Math.min(1000 * 2 ** Math.max(0, this.retries - 1), 8000);
    this.opts.onStateChange?.(
      this.retries >= MAX_RETRIES_BEFORE_ERROR ? "error" : "reconnecting",
    );
    logRealtime("SSE_RECONNECT", {
      code: this.opts.code,
      kind: this.opts.kind,
      cursor: this.lastAppliedEventId,
      retries: this.retries,
      delay,
      reason,
    });

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
  }

  private expireSession(reason: string) {
    if (this.state === "SESSION_EXPIRED") return;
    this.state = "SESSION_EXPIRED";
    this.closedByUser = true;
    this.clearReconnectTimer();
    this.closeCurrent(reason);
    this.opts.onStateChange?.("error");
    this.opts.onSessionExpired?.();
  }

  private closeCurrent(reason: string) {
    const es = this.es;
    if (!es) return;

    const generation = this.generation;
    this.es = null;
    this.generation += 1;
    try {
      es.onopen = null;
      es.onmessage = null;
      es.onerror = null;
      es.close();
    } catch {
      /* noop */
    }
    logRealtime("SSE_CLOSE", {
      code: this.opts.code,
      kind: this.opts.kind,
      cursor: this.lastAppliedEventId,
      generation,
      reason,
    });
  }

  private clearReconnectTimer() {
    if (!this.reconnectTimer) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private isCurrent(es: EventSource, generation: number): boolean {
    return this.es === es && this.generation === generation;
  }

  private hasCredentials(): boolean {
    if (this.opts.kind === "host") {
      return Boolean(this.opts.hostToken && this.opts.hostToken.length >= MIN_TOKEN_LENGTH);
    }
    return Boolean(
      this.opts.playerId &&
        this.opts.playerToken &&
        this.opts.playerToken.length >= MIN_TOKEN_LENGTH,
    );
  }

  private buildUrl(verify: boolean): string {
    const params = new URLSearchParams({ kind: this.opts.kind });
    if (this.opts.kind === "host") {
      params.set("t", this.opts.hostToken ?? "");
    } else {
      params.set("p", this.opts.playerId ?? "");
      params.set("t", this.opts.playerToken ?? "");
    }
    if (this.lastAppliedEventId > 0) {
      params.set("after", String(this.lastAppliedEventId));
    }
    if (verify) {
      params.set("verify", "1");
    }
    return `/api/lobbies/${this.opts.code}/events?${params.toString()}`;
  }
}
