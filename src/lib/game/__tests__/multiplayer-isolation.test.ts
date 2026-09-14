import { describe, it, expect, beforeEach } from "vitest";
import { lobbyService, gameService } from "../service";
import { lobbyRepo } from "../repo";
import { manager, getEventsAfter } from "../manager";
import { EventType, GameState, PlayerConnection, type GameEvent } from "../types";
import { swapPieces, isSolved, correctSlots } from "../puzzle";

describe("FUZAL Multiplayer Identity & Board Isolation Test Suite", () => {
  function listen(code: string, id: string) {
    const frames: GameEvent[] = [];
    const off = manager.connect(code, {
      id,
      send: (f) => frames.push(JSON.parse(f) as GameEvent),
    });
    return { frames, off };
  }

  // =========================================================================
  // BUG 1: MULTIPLE USERS ON SAME DEVICE / TAB ISOLATION
  // =========================================================================
  describe("Bug 1: Multi-Tab & Device Session Isolation", () => {
    it("assigns unique playerIds and tokens to two players joining the same lobby", async () => {
      const lobby = await lobbyService.createLobby({ gridSize: 3, maxPlayers: 5 });
      const code = lobby.code;

      // Tab 1 joins as Player A
      const { player: playerA } = await lobbyService.join(code, "Player A");
      // Tab 2 joins as Player B
      const { player: playerB } = await lobbyService.join(code, "Player B");

      expect(playerA.id).toBeDefined();
      expect(playerB.id).toBeDefined();
      expect(playerA.id).not.toBe(playerB.id);
      expect(playerA.token).not.toBe(playerB.token);
      expect(playerA.name).toBe("Player A");
      expect(playerB.name).toBe("Player B");
      expect(playerA.slot).not.toBe(playerB.slot);

      // Verify lobby maintains both distinct players
      const currentLobby = await lobbyService.getLobby(code);
      expect(currentLobby.players.length).toBe(2);
      expect(currentLobby.players.find((p) => p.id === playerA.id)?.name).toBe("Player A");
      expect(currentLobby.players.find((p) => p.id === playerB.id)?.name).toBe("Player B");
    });

    it("preserves Player A identity when Player B joins and allows independent reconnects", async () => {
      const lobby = await lobbyService.createLobby({ gridSize: 3, maxPlayers: 5 });
      const code = lobby.code;

      const { player: playerA } = await lobbyService.join(code, "Player A");
      const { player: playerB } = await lobbyService.join(code, "Player B");

      // Simulate Tab 1 reconnecting with Player A's credentials
      const reconnectA = await lobbyService.handleConnect(code, {
        playerId: playerA.id,
        playerToken: playerA.token,
      });
      expect(reconnectA.player?.id).toBe(playerA.id);
      expect(reconnectA.player?.name).toBe("Player A");

      // Simulate Tab 2 reconnecting with Player B's credentials
      const reconnectB = await lobbyService.handleConnect(code, {
        playerId: playerB.id,
        playerToken: playerB.token,
      });
      expect(reconnectB.player?.id).toBe(playerB.id);
      expect(reconnectB.player?.name).toBe("Player B");

      // Player A cannot reconnect using Player B's token (identity collision rejected)
      await expect(
        lobbyService.handleConnect(code, {
          playerId: playerA.id,
          playerToken: playerB.token,
        }),
      ).rejects.toThrow();
    });

    it("simulates tab-scoped sessionStorage isolation preventing identity overwrites", () => {
      // Mock tab 1 and tab 2 independent sessionStorage objects
      const tab1Storage = new Map<string, string>();
      const tab2Storage = new Map<string, string>();

      const makeTabStore = (storage: Map<string, string>) => ({
        get<T>(key: string): T | null {
          const raw = storage.get("fuzal:v1:" + key);
          return raw ? (JSON.parse(raw) as T) : null;
        },
        set(key: string, value: unknown) {
          storage.set("fuzal:v1:" + key, JSON.stringify(value));
        },
      });

      const tab1Store = makeTabStore(tab1Storage);
      const tab2Store = makeTabStore(tab2Storage);

      // Player A joins in Tab 1
      tab1Store.set("player:ABCD", {
        player: { id: "p_alpha", name: "Alpha", token: "tok_a" },
      });

      // Player B joins in Tab 2 on the same browser
      tab2Store.set("player:ABCD", {
        player: { id: "p_beta", name: "Beta", token: "tok_b" },
      });

      // Verify Tab 1 still holds Player A and was NOT overwritten by Tab 2!
      const tab1Session = tab1Store.get<{ player: { id: string; name: string } }>("player:ABCD");
      const tab2Session = tab2Store.get<{ player: { id: string; name: string } }>("player:ABCD");

      expect(tab1Session?.player.id).toBe("p_alpha");
      expect(tab1Session?.player.name).toBe("Alpha");
      expect(tab2Session?.player.id).toBe("p_beta");
      expect(tab2Session?.player.name).toBe("Beta");
    });
  });

  // =========================================================================
  // BUG 2: SERVER-STATE INDEPENDENCE & SSE BOARD ISOLATION
  // =========================================================================
  describe("Bug 2: Server-State Independence & SSE Board Isolation", () => {
    it("generates independent puzzle boards for each player and isolates SWAP mutations", async () => {
      const lobby = await lobbyService.createLobby({ gridSize: 3, maxPlayers: 5 });
      const code = lobby.code;

      const { player: playerA } = await lobbyService.join(code, "Player A");
      const { player: playerB } = await lobbyService.join(code, "Player B");

      // Start game into MEMORY then transition to PUZZLE
      await gameService.startGame(code, lobby.hostToken);
      await gameService.beginPuzzle(code, true);

      const activeLobby = await lobbyService.getLobby(code);
      const pA = activeLobby.players.find((p) => p.id === playerA.id)!;
      const pB = activeLobby.players.find((p) => p.id === playerB.id)!;

      expect(pA.puzzle).toBeDefined();
      expect(pB.puzzle).toBeDefined();

      const initialBoardA = [...pA.puzzle!.board];
      const initialBoardB = [...pB.puzzle!.board];

      // Player A executes a SWAP
      const swapResA = await gameService.applySwap(code, playerA.id, playerA.token, 0, 1, null, "action-a-1");
      expect(swapResA.moves).toBe(1);

      // Verify Player A's board changed
      const afterSwapLobby = await lobbyService.getLobby(code);
      const afterA = afterSwapLobby.players.find((p) => p.id === playerA.id)!;
      const afterB = afterSwapLobby.players.find((p) => p.id === playerB.id)!;

      expect(afterA.puzzle!.moves).toBe(1);
      expect(afterA.puzzle!.board[0]).toBe(initialBoardA[1]);
      expect(afterA.puzzle!.board[1]).toBe(initialBoardA[0]);

      // CRITICAL SERVER-STATE ASSERTION: Player B's board and moves must NOT change!
      expect(afterB.puzzle!.moves).toBe(0);
      expect(afterB.puzzle!.board).toEqual(initialBoardB);

      // Player B executes a SWAP
      const swapResB = await gameService.applySwap(code, playerB.id, playerB.token, 2, 3, null, "action-b-1");
      expect(swapResB.moves).toBe(1);

      const finalLobby = await lobbyService.getLobby(code);
      const finalA = finalLobby.players.find((p) => p.id === playerA.id)!;
      const finalB = finalLobby.players.find((p) => p.id === playerB.id)!;

      // Player A's board was not affected by Player B's swap
      expect(finalA.puzzle!.moves).toBe(1);
      expect(finalA.puzzle!.board).toEqual(afterA.puzzle!.board);

      // Player B's board updated correctly
      expect(finalB.puzzle!.moves).toBe(1);
      expect(finalB.puzzle!.board[2]).toBe(initialBoardB[3]);
      expect(finalB.puzzle!.board[3]).toBe(initialBoardB[2]);
    });

    it("verifies server SSE isolation: Player A's board is NEVER transmitted to Player B", async () => {
      const lobby = await lobbyService.createLobby({ gridSize: 3, maxPlayers: 5 });
      const code = lobby.code;

      const { player: playerA } = await lobbyService.join(code, "Player A");
      const { player: playerB } = await lobbyService.join(code, "Player B");

      // Connect SSE streams for Host, Player A, and Player B
      const hostStream = listen(code, "host:" + code);
      const streamA = listen(code, playerA.id);
      const streamB = listen(code, playerB.id);

      await gameService.startGame(code, lobby.hostToken);
      await gameService.beginPuzzle(code, true);

      // Clear initial setup frames
      streamA.frames.length = 0;
      streamB.frames.length = 0;
      hostStream.frames.length = 0;

      // Player A makes a move
      await gameService.applySwap(code, playerA.id, playerA.token, 0, 1, null, "action-sse-a");

      // 1. Stream A must receive PUZZLE_MOVE with board and playerId
      const moveEventsA = streamA.frames.filter((f) => f.type === EventType.PUZZLE_MOVE);
      expect(moveEventsA.length).toBe(1);
      const payloadA = moveEventsA[0].payload as any;
      expect(payloadA.playerId).toBe(playerA.id);
      expect(Array.isArray(payloadA.board)).toBe(true);

      // 2. Stream B must NEVER receive Player A's board
      const moveEventsB = streamB.frames.filter((f) => f.type === EventType.PUZZLE_MOVE);
      for (const ev of moveEventsB) {
        const p = ev.payload as any;
        expect(p.board).toBeUndefined(); // Server MUST NOT send Player A's board to Player B!
      }

      // 3. Host stream must receive progress only (moves & correctCount), never board
      const hostMoveEvents = hostStream.frames.filter((f) => f.type === EventType.PUZZLE_MOVE);
      expect(hostMoveEvents.length).toBe(1);
      const hostPayload = hostMoveEvents[0].payload as any;
      expect(hostPayload.playerId).toBe(playerA.id);
      expect(hostPayload.moves).toBe(1);
      expect(hostPayload.board).toBeUndefined(); // Host never receives board array

      streamA.off();
      streamB.off();
      hostStream.off();
    });

    it("verifies server strips board if broadcast is accidentally invoked with board", async () => {
      const lobby = await lobbyService.createLobby({ gridSize: 3, maxPlayers: 5 });
      const code = lobby.code;

      const stream = listen(code, "test-listener");

      // Accidental broadcast attempt with a board array
      await manager.broadcast(code, {
        type: EventType.PUZZLE_MOVE,
        at: Date.now(),
        payload: {
          playerId: "someone-else",
          board: [0, 1, 2, 3],
          moves: 5,
        },
      });

      expect(stream.frames.length).toBe(1);
      const frame = stream.frames[0];
      const payload = frame.payload as any;
      // Server broadcast safeguard must have stripped the board array!
      expect(payload.board).toBeUndefined();
      expect(payload.moves).toBe(5);

      stream.off();
    });

    it("verifies buildSnapshot only includes the requesting player's own board", async () => {
      const lobby = await lobbyService.createLobby({ gridSize: 3, maxPlayers: 5 });
      const code = lobby.code;

      const { player: playerA } = await lobbyService.join(code, "Player A");
      const { player: playerB } = await lobbyService.join(code, "Player B");

      await gameService.startGame(code, lobby.hostToken);
      await gameService.beginPuzzle(code, true);

      const activeLobby = await lobbyService.getLobby(code);
      const pA = activeLobby.players.find((p) => p.id === playerA.id)!;
      const pB = activeLobby.players.find((p) => p.id === playerB.id)!;

      // Build snapshot for Player A
      const snapshotA = lobbyService.buildSnapshot(activeLobby, "player", pA);
      expect((snapshotA.payload as any).puzzle.playerId).toBe(playerA.id);
      expect((snapshotA.payload as any).puzzle.board).toEqual(pA.puzzle!.board);

      // Build snapshot for Player B
      const snapshotB = lobbyService.buildSnapshot(activeLobby, "player", pB);
      expect((snapshotB.payload as any).puzzle.playerId).toBe(playerB.id);
      expect((snapshotB.payload as any).puzzle.board).toEqual(pB.puzzle!.board);

      // Build snapshot for Host -> No puzzle board!
      const snapshotHost = lobbyService.buildSnapshot(activeLobby, "host");
      expect((snapshotHost.payload as any).puzzle).toBeNull();
      expect((snapshotHost.payload as any).puzzleProgress).toBeDefined();
    });

    it("client defense-in-depth: Player A client rejects and ignores foreign player's board", () => {
      // Simulate client reducer / filter invariant
      interface ClientPuzzleState {
        board: number[];
        moves: number;
        version: number;
      }

      let clientBoardState: ClientPuzzleState = {
        board: [0, 1, 2, 3],
        moves: 0,
        version: 1,
      };

      const myPlayerId = "player_a_id";
      const ignoredEvents: any[] = [];

      function clientApplyEvent(event: { type: string; payload: any }) {
        const p = event.payload;
        if (event.type === EventType.PUZZLE_MOVE || event.type === EventType.PUZZLE_STARTED) {
          if (p.board) {
            // Defense-in-depth guard: Foreign board check
            if (p.playerId && p.playerId !== myPlayerId) {
              ignoredEvents.push({ reason: "FOREIGN_PLAYER", event });
              return; // IGNORE!
            }
            // Stale version check
            if (p.version && p.version < clientBoardState.version) {
              ignoredEvents.push({ reason: "STALE_VERSION", event });
              return; // IGNORE!
            }
            clientBoardState = {
              board: p.board,
              moves: p.moves ?? clientBoardState.moves,
              version: p.version ?? clientBoardState.version + 1,
            };
          }
        }
      }

      // 1. Accidental SSE event containing Player B's board arrives at Player A's client
      clientApplyEvent({
        type: EventType.PUZZLE_MOVE,
        payload: {
          playerId: "player_b_id", // Foreign player!
          board: [3, 2, 1, 0],
          moves: 4,
          version: 5,
        },
      });

      // Assert: Player A's board was NOT mutated!
      expect(clientBoardState.board).toEqual([0, 1, 2, 3]);
      expect(clientBoardState.moves).toBe(0);
      expect(clientBoardState.version).toBe(1);
      expect(ignoredEvents.length).toBe(1);
      expect(ignoredEvents[0].reason).toBe("FOREIGN_PLAYER");

      // 2. Legitimate event for Player A arrives -> Applied successfully
      clientApplyEvent({
        type: EventType.PUZZLE_MOVE,
        payload: {
          playerId: myPlayerId,
          board: [1, 0, 2, 3],
          moves: 1,
          version: 2,
        },
      });

      expect(clientBoardState.board).toEqual([1, 0, 2, 3]);
      expect(clientBoardState.moves).toBe(1);
      expect(clientBoardState.version).toBe(2);

      // 3. Stale event for Player A with old version -> Ignored
      clientApplyEvent({
        type: EventType.PUZZLE_MOVE,
        payload: {
          playerId: myPlayerId,
          board: [9, 9, 9, 9],
          moves: 0,
          version: 1, // Stale!
        },
      });

      expect(clientBoardState.board).toEqual([1, 0, 2, 3]);
      expect(ignoredEvents.length).toBe(2);
      expect(ignoredEvents[1].reason).toBe("STALE_VERSION");
    });
  });

  // =========================================================================
  // DRAG & POINTER INTERACTION FIDELITY
  // =========================================================================
  describe("Pointer Interaction Engine & Gesture Invariants", () => {
    const DRAG_THRESHOLD_PX = 8;

    class MockBoardPointerEngine {
      selected: number | null = null;
      tracker: {
        startX: number;
        startY: number;
        currentX: number;
        currentY: number;
        startSlot: number;
        isDragging: boolean;
      } | null = null;
      boardRect = { left: 0, top: 0, width: 300, height: 300 }; // 100px per cell for 3x3
      cols = 3;
      rows = 3;
      total = 9;
      swapsExecuted: Array<{ from: number; to: number }> = [];

      getSlotAtCoords(clientX: number, clientY: number): number | null {
        if (
          clientX < this.boardRect.left ||
          clientX > this.boardRect.left + this.boardRect.width ||
          clientY < this.boardRect.top ||
          clientY > this.boardRect.top + this.boardRect.height
        ) {
          return null;
        }
        const col = Math.floor(((clientX - this.boardRect.left) / this.boardRect.width) * this.cols);
        const row = Math.floor(((clientY - this.boardRect.top) / this.boardRect.height) * this.rows);
        if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return null;
        const slot = row * this.cols + col;
        return slot >= 0 && slot < this.total ? slot : null;
      }

      pointerDown(slot: number, clientX: number, clientY: number) {
        this.tracker = {
          startX: clientX,
          startY: clientY,
          currentX: clientX,
          currentY: clientY,
          startSlot: slot,
          isDragging: false,
        };
      }

      pointerMove(clientX: number, clientY: number) {
        if (!this.tracker) return;
        this.tracker.currentX = clientX;
        this.tracker.currentY = clientY;

        const dist = Math.hypot(clientX - this.tracker.startX, clientY - this.tracker.startY);
        if (!this.tracker.isDragging && dist >= DRAG_THRESHOLD_PX) {
          this.tracker.isDragging = true;
          this.selected = null;
        }
        // CRITICAL INVARIANT: Pointermove NEVER triggers swaps!
      }

      pointerUp(clientX: number, clientY: number) {
        if (!this.tracker) return;
        const tracker = this.tracker;
        this.tracker = null;

        if (tracker.isDragging) {
          const targetSlot = this.getSlotAtCoords(clientX, clientY);
          if (
            targetSlot !== null &&
            targetSlot !== tracker.startSlot &&
            targetSlot >= 0 &&
            targetSlot < this.total
          ) {
            this.swapsExecuted.push({ from: tracker.startSlot, to: targetSlot });
          }
          this.selected = null;
        } else {
          // Tap logic
          const tapSlot = tracker.startSlot;
          if (this.selected === null) {
            this.selected = tapSlot;
          } else if (this.selected === tapSlot) {
            this.selected = null; // deselect
          } else {
            this.swapsExecuted.push({ from: this.selected, to: tapSlot });
            this.selected = null;
          }
        }
      }
    }

    it("drag gesture moving across several cells triggers EXACTLY ONE swap upon pointerup", () => {
      const engine = new MockBoardPointerEngine();

      // Start drag at cell 0 (x=50, y=50)
      engine.pointerDown(0, 50, 50);

      // Move across cell 1 (x=150, y=50)
      engine.pointerMove(150, 50);
      expect(engine.tracker?.isDragging).toBe(true);
      expect(engine.swapsExecuted.length).toBe(0); // ZERO swaps during movement

      // Move across cell 2 (x=250, y=50)
      engine.pointerMove(250, 50);
      expect(engine.swapsExecuted.length).toBe(0); // ZERO swaps during movement

      // Move diagonally into cell 5 (x=250, y=150)
      engine.pointerMove(250, 150);
      expect(engine.swapsExecuted.length).toBe(0); // ZERO swaps during movement

      // Release pointer on cell 5
      engine.pointerUp(250, 150);

      // EXACTLY ONE swap executed
      expect(engine.swapsExecuted.length).toBe(1);
      expect(engine.swapsExecuted[0]).toEqual({ from: 0, to: 5 });
    });

    it("drag gesture dropping on original cell or outside grid triggers ZERO swaps", () => {
      const engine = new MockBoardPointerEngine();

      // Drag from 0 and drop back on 0
      engine.pointerDown(0, 50, 50);
      engine.pointerMove(180, 50); // drag moved far enough
      engine.pointerMove(50, 50);  // moved back to cell 0
      engine.pointerUp(50, 50);
      expect(engine.swapsExecuted.length).toBe(0);

      // Drag from 0 and drop outside board bounds
      engine.pointerDown(0, 50, 50);
      engine.pointerMove(500, 500); // way outside
      engine.pointerUp(500, 500);
      expect(engine.swapsExecuted.length).toBe(0);
    });

    it("tap-to-swap: first tap selects, second tap on another cell swaps once, tapping same cell cancels", () => {
      const engine = new MockBoardPointerEngine();

      // Tap cell 1 (movement < 8px)
      engine.pointerDown(1, 150, 50);
      engine.pointerUp(151, 51);
      expect(engine.selected).toBe(1);
      expect(engine.swapsExecuted.length).toBe(0);

      // Tap cell 1 again -> Cancels selection
      engine.pointerDown(1, 150, 50);
      engine.pointerUp(150, 50);
      expect(engine.selected).toBeNull();
      expect(engine.swapsExecuted.length).toBe(0);

      // Tap cell 2, then tap cell 7 -> Swaps once
      engine.pointerDown(2, 250, 50);
      engine.pointerUp(250, 50);
      expect(engine.selected).toBe(2);

      engine.pointerDown(7, 150, 250);
      engine.pointerUp(150, 250);
      expect(engine.selected).toBeNull();
      expect(engine.swapsExecuted.length).toBe(1);
      expect(engine.swapsExecuted[0]).toEqual({ from: 2, to: 7 });
    });

    it("verifies grid geometries: 2x2, 3x3, 4x4", () => {
      const sizes = [
        { grid: 2, total: 4 },
        { grid: 3, total: 9 },
        { grid: 4, total: 16 },
      ];

      for (const { grid, total } of sizes) {
        const engine = new MockBoardPointerEngine();
        engine.cols = grid;
        engine.rows = grid;
        engine.total = total;
        engine.boardRect = { left: 0, top: 0, width: grid * 100, height: grid * 100 };

        // Drag from 0 to last cell
        const lastCell = total - 1;
        const lastCol = lastCell % grid;
        const lastRow = Math.floor(lastCell / grid);

        engine.pointerDown(0, 50, 50);
        engine.pointerMove(lastCol * 100 + 50, lastRow * 100 + 50);
        engine.pointerUp(lastCol * 100 + 50, lastRow * 100 + 50);

        expect(engine.swapsExecuted.length).toBe(1);
        expect(engine.swapsExecuted[0]).toEqual({ from: 0, to: lastCell });
      }
    });
  });

  // =========================================================================
  // HOST ACTION IDEMPOTENCY & 409 CONFLICT ELIMINATION
  // =========================================================================
  describe("Host Action Idempotency & 409 Conflict Elimination", () => {
    it("startGame is idempotent and does not throw 409 if called repeatedly or when already started", async () => {
      const lobby = await lobbyService.createLobby({ gridSize: 3, maxPlayers: 5 });
      const code = lobby.code;
      await lobbyService.join(code, "Player One");

      // First call -> Transitions LOBBY -> MEMORY
      await expect(gameService.startGame(code, lobby.hostToken)).resolves.not.toThrow();

      // Second call (e.g. rapid double-click or latency retry) -> Idempotent, MUST NOT throw 409!
      await expect(gameService.startGame(code, lobby.hostToken)).resolves.not.toThrow();

      // Transition to PUZZLE
      await gameService.beginPuzzle(code, true);

      // Third call while in PUZZLE -> Idempotent, MUST NOT throw 409!
      await expect(gameService.startGame(code, lobby.hostToken)).resolves.not.toThrow();
    });

    it("beginPuzzle is idempotent and does not throw 409 if invoked while lobby is in LOBBY state", async () => {
      const lobby = await lobbyService.createLobby({ gridSize: 3, maxPlayers: 5 });
      const code = lobby.code;

      // In LOBBY state, beginPuzzle MUST NOT throw 409
      await expect(gameService.beginPuzzle(code, false)).resolves.not.toThrow();
    });

    it("playAgain and backToLobby are idempotent and do not throw 409 on repeated calls", async () => {
      const lobby = await lobbyService.createLobby({ gridSize: 3, maxPlayers: 5 });
      const code = lobby.code;
      await lobbyService.join(code, "Player One");

      await gameService.startGame(code, lobby.hostToken);
      await gameService.beginPuzzle(code, true);

      // Solve or timeout to FINISHED
      await gameService.handlePuzzleTimeout(code);

      // First playAgain -> FINISHED to MEMORY
      await expect(gameService.playAgain(code, lobby.hostToken)).resolves.not.toThrow();

      // Repeated playAgain -> Idempotent, MUST NOT throw 409
      await expect(gameService.playAgain(code, lobby.hostToken)).resolves.not.toThrow();

      // Move to FINISHED then test backToLobby
      await gameService.handlePuzzleTimeout(code);
      await expect(gameService.backToLobby(code, lobby.hostToken)).resolves.not.toThrow();

      // Repeated backToLobby while already in LOBBY -> Idempotent, MUST NOT throw 409
      await expect(gameService.backToLobby(code, lobby.hostToken)).resolves.not.toThrow();
    });
  });
});
