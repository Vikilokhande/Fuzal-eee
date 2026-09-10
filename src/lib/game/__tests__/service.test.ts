import { describe, it, expect } from "vitest";
import { lobbyService, gameService } from "../service";
import { lobbyRepo } from "../repo";
import { manager } from "../manager";
import { EventType, GameState, PlayerConnection } from "../types";
import type { GameEvent } from "../types";

const NAMES = ["Chiku", "Aarav", "Mira", "Kabir", "Zara", "Sixth"];

async function setupLobby(playerCount = 0) {
  const lobby = await lobbyService.createLobby();
  const players: { id: string; name: string; token: string }[] = [];
  for (let i = 0; i < playerCount; i++) {
    const { player } = await lobbyService.join(lobby.code, NAMES[i]);
    players.push({ id: player.id, name: player.name, token: player.token });
  }
  return { code: lobby.code, hostToken: lobby.hostToken, players };
}

function listen(code: string, id: string) {
  const frames: GameEvent[] = [];
  const off = manager.connect(code, {
    id,
    send: (f) => frames.push(JSON.parse(f) as GameEvent),
  });
  return { frames, off };
}

const types = (frames: GameEvent[]) => frames.map((f) => f.type);
const payloadsOf = (frames: GameEvent[], t: string) =>
  frames.filter((f) => f.type === t).map((f) => f.payload as Record<string, unknown>);

async function clearTimers(code: string) {
  const lobby = await lobbyRepo.getByCode(code);
  if (lobby) {
    if (lobby.timerInterval) clearInterval(lobby.timerInterval);
    if (lobby.endTimeout) clearTimeout(lobby.endTimeout);
  }
}

async function moveOneFromSolved(code: string, playerIndex: number, swap: [number, number]) {
  const lobby = await lobbyRepo.getByCode(code);
  const player = lobby!.players[playerIndex];
  const board = Array.from({ length: 16 }, (_, i) => i);
  const [a, b] = swap;
  [board[a], board[b]] = [board[b], board[a]];
  player.puzzle!.board = board;
}

describe("lobby lifecycle", () => {
  it("creates a lobby with FZ id and LOBBY state", async () => {
    const lobby = await lobbyService.createLobby();
    expect(lobby.id).toMatch(/^FZ-[A-Z0-9]{4}$/);
    expect(lobby.status).toBe(GameState.LOBBY);
    expect(lobby.players).toHaveLength(0);
    expect(lobby.maxPlayers).toBe(5);
  });

  it("joins players and broadcasts PLAYER_JOINED / LOBBY_UPDATED", async () => {
    const { code } = await setupLobby(0);
    const { frames, off } = listen(code, `host:${code}`);
    await lobbyService.join(code, "Chiku");
    expect(types(frames)).toContain(EventType.PLAYER_JOINED);
    expect(types(frames)).toContain(EventType.LOBBY_UPDATED);
    off();
  });

  it("enforces the 5-player server-side cap", async () => {
    const setup = await setupLobby(5);
    await expect(lobbyService.join(setup.code, NAMES[5])).rejects.toMatchObject({
      code: "FULL",
      httpStatus: 409,
    });
  });

  it("rejects duplicate player names", async () => {
    const setup = await setupLobby(1);
    await expect(lobbyService.join(setup.code, "chiku")).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("blocks joining once the game has started", async () => {
    const setup = await setupLobby(1);
    await gameService.startGame(setup.code, setup.hostToken);
    await expect(lobbyService.join(setup.code, "Late")).rejects.toMatchObject({
      code: "ALREADY_STARTED",
    });
    await clearTimers(setup.code);
  });

  it("requires at least one player to start", async () => {
    const lobby = await lobbyService.createLobby();
    await expect(gameService.startGame(lobby.code, lobby.hostToken)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("rejects host actions from non-hosts", async () => {
    const setup = await setupLobby(1);
    await expect(gameService.startGame(setup.code, "deadbeef")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

describe("state machine & timer", () => {
  it("runs LOBBY → MEMORY → PUZZLE → FINISHED and blocks invalid transitions", async () => {
    const setup = await setupLobby(2);
    // MEMORY → PUZZLE directly from LOBBY is illegal
    await expect(gameService.beginPuzzle(setup.code)).rejects.toBeDefined();

    const host = listen(setup.code, `host:${setup.code}`);
    const p0 = listen(setup.code, setup.players[0].id);
    const p1 = listen(setup.code, setup.players[1].id);

    await gameService.startGame(setup.code, setup.hostToken);
    let lobby = await lobbyRepo.getByCode(setup.code);
    expect(lobby!.status).toBe(GameState.MEMORY);
    expect(lobby!.memory?.endsAt).toBeGreaterThan(lobby!.memory!.startedAt);

    // Host gets the full image URL; phones only get the image name (anti-cheat).
    const hostMem = payloadsOf(host.frames, EventType.MEMORY_PHASE_STARTED);
    const phoneMem = payloadsOf(p0.frames, EventType.MEMORY_PHASE_STARTED);
    expect(hostMem[0].image).toBeTruthy();
    expect(phoneMem[0].image).toBeUndefined();
    expect(phoneMem[0].imageName).toBeTruthy();

    // Simulate the authoritative server timer elapsing.
    await gameService.beginPuzzle(setup.code);
    lobby = await lobbyRepo.getByCode(setup.code);
    expect(lobby!.status).toBe(GameState.PUZZLE);
    expect(lobby!.puzzleStartedAt).toBeGreaterThan(0);

    const hostPuzzle = payloadsOf(host.frames, EventType.PUZZLE_STARTED);
    const p0Puzzle = payloadsOf(p0.frames, EventType.PUZZLE_STARTED);
    expect(hostPuzzle.some((p) => Array.isArray(p.board))).toBe(false); // host never sees boards
    const personalPuzzle = p0Puzzle.find((p) => Array.isArray(p.board));
    expect(personalPuzzle?.board).toHaveLength(16); // personal shuffled board

    host.off();
    p0.off();
    p1.off();
  });

  it("gives each player an independent, non-solved shuffle", async () => {
    const setup = await setupLobby(3);
    await gameService.startGame(setup.code, setup.hostToken);
    await gameService.beginPuzzle(setup.code);
    const lobby = await lobbyRepo.getByCode(setup.code);
    const boards = lobby!.players.map((p) => p.puzzle!.board);
    for (const b of boards) {
      expect(b).toHaveLength(16);
      expect(b.every((piece, slot) => piece === slot)).toBe(false);
    }
    // Independent shuffles: not every board identical (overwhelmingly likely).
    const unique = new Set(boards.map((b) => b.join(",")));
    expect(unique.size).toBeGreaterThan(1);
  });
});

describe("moves, validation & winner", () => {
  it("rejects invalid indexes and foreign tokens", async () => {
    const setup = await setupLobby(1);
    await gameService.startGame(setup.code, setup.hostToken);
    await gameService.beginPuzzle(setup.code);
    const p = setup.players[0];
    await expect(
      gameService.applySwap(setup.code, p.id, p.token, 0, 99),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      gameService.applySwap(setup.code, p.id, "wrong-token", 0, 1),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("validates moves and declares the first solver the winner", async () => {
    const setup = await setupLobby(2);
    const host = listen(setup.code, `host:${setup.code}`);
    await gameService.startGame(setup.code, setup.hostToken);
    await gameService.beginPuzzle(setup.code);

    const winner = setup.players[0];
    await moveOneFromSolved(setup.code, 0, [0, 1]);
    await gameService.applySwap(setup.code, winner.id, winner.token, 0, 1);

    const lobby = await lobbyRepo.getByCode(setup.code);
    expect(lobby!.status).toBe(GameState.FINISHED);
    expect(lobby!.winnerId).toBe(winner.id);
    const finishEvents = payloadsOf(host.frames, EventType.GAME_FINISHED);
    expect(finishEvents[0].winner).toMatchObject({ name: winner.name });

    const winningPlayer = lobby!.players[0];
    expect(winningPlayer.score).toBe(1);
    expect(lobby!.timerInterval).toBeNull();
    host.off();
  });

  it("atomic winner: only one of two simultaneous completions wins", async () => {
    const setup = await setupLobby(2);
    await gameService.startGame(setup.code, setup.hostToken);
    await gameService.beginPuzzle(setup.code);
    const a = setup.players[0];
    const b = setup.players[1];
    await moveOneFromSolved(setup.code, 0, [0, 1]);
    await moveOneFromSolved(setup.code, 1, [2, 3]);

    const results = await Promise.allSettled([
      gameService.applySwap(setup.code, a.id, a.token, 0, 1),
      gameService.applySwap(setup.code, b.id, b.token, 2, 3),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const lobby = await lobbyRepo.getByCode(setup.code);
    expect(lobby!.status).toBe(GameState.FINISHED);
    expect([a.id, b.id]).toContain(lobby!.winnerId);
    const completed = lobby!.players.filter((p) => p.puzzle?.completed);
    expect(completed).toHaveLength(1);
  });

  it("ignores moves once the game is finished", async () => {
    const setup = await setupLobby(1);
    await gameService.startGame(setup.code, setup.hostToken);
    await gameService.beginPuzzle(setup.code);
    const p = setup.players[0];
    await moveOneFromSolved(setup.code, 0, [0, 1]);
    await gameService.applySwap(setup.code, p.id, p.token, 0, 1);
    await expect(
      gameService.applySwap(setup.code, p.id, p.token, 2, 3),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
  });
});

describe("replay, reconnect", () => {
  it("PLAY AGAIN resets to MEMORY with fresh puzzles, BACK TO LOBBY works", async () => {
    const setup = await setupLobby(2);
    await gameService.startGame(setup.code, setup.hostToken);
    await gameService.beginPuzzle(setup.code);
    await moveOneFromSolved(setup.code, 0, [0, 1]);
    await gameService.applySwap(
      setup.code,
      setup.players[0].id,
      setup.players[0].token,
      0,
      1,
    );

    const firstImage = (await lobbyRepo.getByCode(setup.code))!.memory!.image.id;
    await gameService.playAgain(setup.code, setup.hostToken);
    let lobby = await lobbyRepo.getByCode(setup.code);
    expect(lobby!.status).toBe(GameState.MEMORY);
    expect(lobby!.players.every((p) => p.puzzle === null)).toBe(true);
    expect(lobby!.winnerId).toBeNull();
    expect(lobby!.memory!.image.id).not.toBe(firstImage);

    // Go to puzzle then finish again so timers get cleaned, then back to lobby.
    await gameService.beginPuzzle(setup.code);
    await moveOneFromSolved(setup.code, 0, [0, 1]);
    await gameService.applySwap(
      setup.code,
      setup.players[0].id,
      setup.players[0].token,
      0,
      1,
    );
    await gameService.backToLobby(setup.code, setup.hostToken);
    lobby = await lobbyRepo.getByCode(setup.code);
    expect(lobby!.status).toBe(GameState.LOBBY);
    expect(lobby!.memory).toBeNull();
  });

  it("restores a disconnected player on reconnect with state intact", async () => {
    const setup = await setupLobby(1);
    const p = setup.players[0];
    await gameService.startGame(setup.code, setup.hostToken);
    await gameService.beginPuzzle(setup.code);
    const lobby = (await lobbyRepo.getByCode(setup.code))!;
    const player = lobby.players[0];
    const boardBefore = [...player.puzzle!.board];
    player.connectionStatus = PlayerConnection.DISCONNECTED;

    const { frames, off } = listen(setup.code, `host2:${setup.code}`);
    const restored = await lobbyService.handleConnect(setup.code, {
      playerId: p.id,
      playerToken: p.token,
    });
    expect(restored.player!.connectionStatus).toBe(PlayerConnection.CONNECTED);
    expect(restored.player!.puzzle!.board).toEqual(boardBefore);
    expect(types(frames)).toContain(EventType.PLAYER_STATUS);
    off();
  });
});
