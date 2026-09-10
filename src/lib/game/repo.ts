/**
 * Lobby repository.
 * -----------------
 * The initial version stores game state in memory (process-local Map).
 * All access goes through the `LobbyRepository` interface so a Redis or
 * PostgreSQL/Drizzle implementation can be dropped in later without touching
 * the game services:
 *
 *   - Redis:  one JSON document per lobby + pub/sub for fan-out
 *   - Postgres: `lobby` / `player` tables (see drizzle schema notes in README)
 */
import type { Lobby, Player } from "./types";

export interface LobbyRepository {
  put(lobby: Lobby): Promise<Lobby>;
  getByCode(code: string): Promise<Lobby | null>;
  deleteByCode(code: string): Promise<void>;
  size(): Promise<number>;
}

class InMemoryLobbyRepository implements LobbyRepository {
  private lobbies = new Map<string, Lobby>();

  async put(lobby: Lobby): Promise<Lobby> {
    this.lobbies.set(lobby.code, lobby);
    return lobby;
  }

  async getByCode(code: string): Promise<Lobby | null> {
    return this.lobbies.get(code) ?? null;
  }

  async deleteByCode(code: string): Promise<void> {
    this.lobbies.delete(code);
  }

  async size(): Promise<number> {
    return this.lobbies.size;
  }
}

const globalForRepo = globalThis as typeof globalThis & {
  __fuzalRepo?: LobbyRepository;
};

export const lobbyRepo: LobbyRepository =
  globalForRepo.__fuzalRepo ?? new InMemoryLobbyRepository();
if (process.env.NODE_ENV !== "production") {
  globalForRepo.__fuzalRepo = lobbyRepo;
}

/**
 * Serialize every mutating operation on a single lobby.
 * Game state is only ever changed inside `withLobbyLock`, which guarantees
 * that two simultaneous "I finished" requests can never both win.
 */
export async function withLobbyLock<T>(
  lobby: Lobby,
  fn: () => Promise<T> | T,
): Promise<T> {
  const run = lobby.lockChain.then(() => fn());
  // Keep the chain alive even if this call rejects.
  lobby.lockChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function findPlayer(lobby: Lobby, playerId: string): Player | undefined {
  return lobby.players.find((p) => p.id === playerId);
}
