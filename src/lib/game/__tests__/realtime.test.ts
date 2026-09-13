import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventType, type GameEvent } from "../types";
import { FuzalSocket, type ConnectionState } from "../../fuzal/realtime";

class FakeEventSource {
  static instances: FakeEventSource[] = [];

  readonly url: string;
  closed = false;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  private listeners = new Map<string, EventListenerOrEventListenerObject[]>();

  constructor(url: string | URL) {
    this.url = String(url);
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  close() {
    this.closed = true;
  }

  emit(type: string) {
    const event = new Event(type);
    for (const listener of this.listeners.get(type) ?? []) {
      if (typeof listener === "function") listener(event);
      else listener.handleEvent(event);
    }
  }

  emitMessage(event: GameEvent, lastEventId?: string) {
    this.onmessage?.({
      data: JSON.stringify(event),
      lastEventId: lastEventId ?? "",
    } as MessageEvent);
  }

  emitError() {
    this.onerror?.(new Event("error"));
  }
}

describe("FuzalSocket", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource as any);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })));
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("does not open an SSE stream until required credentials exist", () => {
    const states: ConnectionState[] = [];
    const socket = new FuzalSocket({
      code: "ABCD",
      kind: "player",
      onEvent: vi.fn(),
      onStateChange: (state) => states.push(state),
    });

    socket.connect();

    expect(FakeEventSource.instances).toHaveLength(0);
    expect(states).toEqual(["connecting"]);
  });

  it("advances its cursor only after the event handler accepts the event", () => {
    const received: EventType[] = [];
    const cursors: number[] = [];
    const socket = new FuzalSocket({
      code: "ABCD",
      kind: "player",
      playerId: "11111111-1111-4111-8111-111111111111",
      playerToken: "x".repeat(24),
      onEvent: (event) => {
        received.push(event.type);
        return event.type !== EventType.MEMORY_PHASE_STARTED;
      },
      onCursorAdvance: (id) => cursors.push(id),
    });

    socket.connect();
    const es = FakeEventSource.instances[0];
    es.emitMessage({ type: EventType.MEMORY_PHASE_STARTED, at: 1, payload: {} }, "5");
    es.emitMessage({ type: EventType.PUZZLE_STARTED, at: 2, payload: {} }, "6");
    es.emitMessage({ type: EventType.PUZZLE_TIMER_UPDATED, at: 3, payload: {}, eventId: 6 }, "6");

    expect(received).toEqual([EventType.MEMORY_PHASE_STARTED, EventType.PUZZLE_STARTED]);
    expect(cursors).toEqual([6]);
    socket.disconnect();
  });

  it("keeps rejected events out of the reconnect after cursor", async () => {
    const socket = new FuzalSocket({
      code: "ABCD",
      kind: "player",
      playerId: "11111111-1111-4111-8111-111111111111",
      playerToken: "x".repeat(24),
      onEvent: () => false,
    });

    socket.connect();
    const first = FakeEventSource.instances[0];
    first.emitMessage({ type: EventType.PUZZLE_STARTED, at: 1, payload: {} }, "5");
    first.emit("stream_end");
    await vi.advanceTimersByTimeAsync(0);

    expect(FakeEventSource.instances).toHaveLength(2);
    expect(FakeEventSource.instances[1].url).not.toContain("after=5");
    socket.disconnect();
  });

  it("rotates once when stream_end and error fire on the same old stream", async () => {
    const socket = new FuzalSocket({
      code: "ABCD",
      kind: "host",
      hostToken: "x".repeat(24),
      onEvent: vi.fn(),
    });

    socket.connect();
    const first = FakeEventSource.instances[0];
    first.emit("stream_end");
    first.emitError();
    await vi.advanceTimersByTimeAsync(0);

    expect(first.closed).toBe(true);
    expect(FakeEventSource.instances).toHaveLength(2);
    socket.disconnect();
  });
});
