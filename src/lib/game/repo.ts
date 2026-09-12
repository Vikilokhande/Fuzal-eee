/**
 * Lobby repository.
 * -----------------
 * Persistent, production-grade repository powered by Supabase PostgreSQL.
 * Maps relational tables:
 *   lobbies → players
 *   lobbies → games → game_players
 *   puzzle_images
 *
 * Preserves the `LobbyRepository` interface and per-lobby in-process mutexes
 * while persisting all authoritative game state in Supabase.
 */
import { supabaseAdmin } from "@/lib/supabase/admin";
import { imageService } from "./imageService";
import { correctSlots } from "./puzzle";
import {
  GameState,
  PlayerConnection,
  type Lobby,
  type Player,
  type PuzzleInstance,
} from "./types";

export interface LobbyRepository {
  put(lobby: Lobby): Promise<Lobby>;
  getByCode(code: string): Promise<Lobby | null>;
  deleteByCode(code: string): Promise<void>;
  size(): Promise<number>;
}

export class SupabaseLobbyRepository implements LobbyRepository {
  // In-process runtime handle cache (retains Node.js timers and promise mutexes)
  private processLobbies = new Map<string, Lobby>();

  async put(lobby: Lobby): Promise<Lobby> {
    const code = lobby.code.toUpperCase();
    this.processLobbies.set(code, lobby);

    try {
      // 1. Upsert lobby row
      const { data: lobbyRow, error: lobbyErr } = await supabaseAdmin
        .from("lobbies")
        .upsert(
          {
            code,
            host_token_hash: lobby.hostToken,
            status: lobby.status,
            max_players: lobby.maxPlayers,
            current_game_id: lobby.currentGameId ?? null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "code" },
        )
        .select("id")
        .single();

      if (lobbyErr) {
        console.error(`[REPO_ERROR] Failed to upsert lobby ${code}:`, lobbyErr.message);
        return lobby;
      }

      const lobbyDbId = lobbyRow.id;

      // 2. Sync players
      if (lobby.players.length > 0) {
        for (const p of lobby.players) {
          const { error: pErr } = await supabaseAdmin.from("players").upsert(
            {
              id: p.id,
              lobby_id: lobbyDbId,
              name: p.name,
              player_token_hash: p.token,
              connected: p.connectionStatus === PlayerConnection.CONNECTED,
              score: p.score,
              slot: Math.max(1, Math.min(5, p.slot || 1)),
              last_seen_at: new Date().toISOString(),
            },
            { onConflict: "id" },
          );
          if (pErr) {
            console.error(`[REPO_ERROR] Failed to upsert player ${p.id}:`, pErr.message);
          }
        }
      }

      // 3. Sync current game if active
      if (lobby.currentGameId) {
        const gameStatus = lobby.status === GameState.LOBBY ? GameState.FINISHED : lobby.status;
        const { error: gameErr } = await supabaseAdmin
          .from("games")
          .update({
            state: gameStatus,
            memory_started_at: lobby.memory?.startedAt
              ? new Date(lobby.memory.startedAt).toISOString()
              : null,
            memory_ends_at: lobby.memory?.endsAt
              ? new Date(lobby.memory.endsAt).toISOString()
              : null,
            puzzle_started_at: lobby.puzzleStartedAt
              ? new Date(lobby.puzzleStartedAt).toISOString()
              : null,
            finished_at: lobby.finishedAt
              ? new Date(lobby.finishedAt).toISOString()
              : null,
            winner_player_id: lobby.winnerId ?? null,
          })
          .eq("id", lobby.currentGameId);

        if (gameErr) {
          console.error(`[REPO_ERROR] Failed to update game ${lobby.currentGameId}:`, gameErr.message);
        }

        // 4. Sync player boards in game_players
        for (const p of lobby.players) {
          if (p.puzzle) {
            const { error: gpErr } = await supabaseAdmin
              .from("game_players")
              .upsert(
                {
                  game_id: lobby.currentGameId,
                  player_id: p.id,
                  board: p.puzzle.board,
                  moves: p.puzzle.moves,
                  correct_slots: correctSlots(p.puzzle.board).filter(Boolean).length,
                  completed: p.puzzle.completed,
                  started_at: new Date(p.puzzle.startedAt).toISOString(),
                  completed_at: p.puzzle.completedAt
                    ? new Date(p.puzzle.completedAt).toISOString()
                    : null,
                },
                { onConflict: "game_id,player_id" },
              );
            if (gpErr) {
              console.error(`[REPO_ERROR] Failed to sync game_player for ${p.id}:`, gpErr.message);
            }
          }
        }
      }
    } catch (err) {
      console.error(`[REPO_ERROR] Unexpected error in put(${code}):`, err);
    }

    return lobby;
  }

  async getByCode(code: string): Promise<Lobby | null> {
    const normCode = code.toUpperCase();

    try {
      // 1. Fetch lobby from Supabase
      const { data: lobbyRow, error: lobbyErr } = await supabaseAdmin
        .from("lobbies")
        .select("*")
        .eq("code", normCode)
        .maybeSingle();

      if (lobbyErr || !lobbyRow) {
        return null;
      }

      // 2. Fetch players for this lobby
      const { data: playerRows } = await supabaseAdmin
        .from("players")
        .select("*")
        .eq("lobby_id", lobbyRow.id)
        .order("slot", { ascending: true });

      // 3. Fetch current game if exists
      let gameRow: Record<string, any> | null = null;
      let gamePlayerMap = new Map<string, Record<string, any>>();

      if (lobbyRow.current_game_id) {
        const { data: g } = await supabaseAdmin
          .from("games")
          .select("*, puzzle_images(*)")
          .eq("id", lobbyRow.current_game_id)
          .maybeSingle();
        gameRow = g;

        if (gameRow) {
          const { data: gpRows } = await supabaseAdmin
            .from("game_players")
            .select("*")
            .eq("game_id", lobbyRow.current_game_id);
          for (const gp of gpRows ?? []) {
            gamePlayerMap.set(gp.player_id, gp);
          }
        }
      }

      // 4. Hydrate runtime player objects
      const existingLobby = this.processLobbies.get(normCode);
      const players: Player[] = (playerRows ?? []).map((row) => {
        const existingPlayer = existingLobby?.players.find((p) => p.id === row.id);
        const gp = gamePlayerMap.get(row.id);

        const puzzle: PuzzleInstance | null = existingPlayer?.puzzle
          ? {
              ...existingPlayer.puzzle,
              board:
                gp && Array.isArray(gp.board)
                  ? gp.board
                  : existingPlayer.puzzle.board,
              moves: gp?.moves ?? existingPlayer.puzzle.moves,
              completed:
                existingPlayer.puzzle.completed || (gp?.completed ?? false),
              completedAt:
                existingPlayer.puzzle.completedAt ??
                (gp?.completed_at
                  ? new Date(gp.completed_at).getTime()
                  : null),
            }
          : gp
            ? {
                board: Array.isArray(gp.board) ? gp.board : [],
                moves: gp.moves ?? 0,
                startedAt: gp.started_at
                  ? new Date(gp.started_at).getTime()
                  : Date.now(),
                completed: gp.completed ?? false,
                completedAt: gp.completed_at
                  ? new Date(gp.completed_at).getTime()
                  : null,
              }
            : null;

        return {
          id: row.id,
          name: row.name,
          token: row.player_token_hash,
          joinedAt: new Date(row.joined_at).getTime(),
          connectionStatus:
            existingPlayer?.connectionStatus ??
            (row.connected
              ? PlayerConnection.CONNECTED
              : PlayerConnection.DISCONNECTED),
          score: row.score ?? 0,
          slot: row.slot,
          puzzle,
        };
      });

      // 5. Reconstruct memory phase if active
      let memory = existingLobby?.memory ?? null;
      if (lobbyRow.status === GameState.LOBBY) {
        memory = null;
      } else if (gameRow?.puzzle_images && !memory) {
        const pzImg = gameRow.puzzle_images;
        const meta = imageService.get(pzImg.id) ?? {
          id: pzImg.id,
          name: pzImg.name,
          slug: pzImg.storage_path,
          url: `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/puzzle-images/${pzImg.storage_path}/original.webp`,
        };
        const startedAt = gameRow.memory_started_at
          ? new Date(gameRow.memory_started_at).getTime()
          : Date.now();
        const endsAt = gameRow.memory_ends_at
          ? new Date(gameRow.memory_ends_at).getTime()
          : startedAt + 30000;
        memory = {
          image: meta,
          startedAt,
          endsAt,
          durationSeconds: Math.round((endsAt - startedAt) / 1000),
        };
      }

      const puzzleStartedAt = gameRow?.puzzle_started_at
        ? new Date(gameRow.puzzle_started_at).getTime()
        : existingLobby?.puzzleStartedAt ?? null;

      const finishedAt = gameRow?.finished_at
        ? new Date(gameRow.finished_at).getTime()
        : existingLobby?.finishedAt ?? null;

      const winnerId = gameRow?.winner_player_id ?? existingLobby?.winnerId ?? null;

      // 6. Reuse existing process lobby instance to preserve lockChain and timers
      let lobby = this.processLobbies.get(normCode);
      if (!lobby) {
        lobby = {
          id: `FZ-${normCode}`,
          code: normCode,
          hostToken: lobbyRow.host_token_hash,
          status: lobbyRow.status as GameState,
          players,
          maxPlayers: lobbyRow.max_players ?? 5,
          gridCols: 4,
          gridRows: 4,
          currentGameId: lobbyRow.current_game_id ?? null,
          memory,
          puzzleStartedAt,
          winnerId,
          finishedAt,
          lockChain: Promise.resolve(),
          timerInterval: null,
          endTimeout: null,
          disconnectTimers: {},
          usedImageIds: [],
          createdAt: new Date(lobbyRow.created_at).getTime(),
        };
        this.processLobbies.set(normCode, lobby);
      } else {
        lobby.hostToken = lobbyRow.host_token_hash;
        lobby.status = lobbyRow.status as GameState;
        lobby.maxPlayers = lobbyRow.max_players ?? 5;
        lobby.currentGameId = lobbyRow.current_game_id ?? null;
        lobby.players = players;
        lobby.memory = memory;
        lobby.puzzleStartedAt = puzzleStartedAt;
        lobby.winnerId = winnerId;
        lobby.finishedAt = finishedAt;
      }

      return lobby;
    } catch (err) {
      console.error(`[REPO_ERROR] Unexpected error in getByCode(${normCode}):`, err);
      return this.processLobbies.get(normCode) ?? null;
    }
  }

  async deleteByCode(code: string): Promise<void> {
    const normCode = code.toUpperCase();
    this.processLobbies.delete(normCode);
    try {
      await supabaseAdmin.from("lobbies").delete().eq("code", normCode);
    } catch (err) {
      console.error(`[REPO_ERROR] Failed to delete lobby ${normCode}:`, err);
    }
  }

  async size(): Promise<number> {
    try {
      const { count } = await supabaseAdmin
        .from("lobbies")
        .select("*", { count: "exact", head: true });
      return count ?? this.processLobbies.size;
    } catch {
      return this.processLobbies.size;
    }
  }
}

export class InMemoryLobbyRepository implements LobbyRepository {
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

// Use SupabaseLobbyRepository as the authoritative production repository
export const lobbyRepo: LobbyRepository =
  globalForRepo.__fuzalRepo ?? new SupabaseLobbyRepository();

if (process.env.NODE_ENV !== "production") {
  globalForRepo.__fuzalRepo = lobbyRepo;
}

/**
 * Serialize every mutating operation on a single lobby.
 * Guarantees that in-process concurrent requests are executed sequentially.
 */
export async function withLobbyLock<T>(
  lobby: Lobby,
  fn: () => Promise<T> | T,
): Promise<T> {
  const run = lobby.lockChain.then(() => fn());
  lobby.lockChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function findPlayer(lobby: Lobby, playerId: string): Player | undefined {
  return lobby.players.find((p) => p.id === playerId);
}
