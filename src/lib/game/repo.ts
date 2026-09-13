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
import { supabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/admin";
import { imageService } from "./imageService";
import { correctSlots } from "./puzzle";
import {
  GameState,
  PlayerConnection,
  type Lobby,
  type Player,
  type PuzzleInstance,
} from "./types";
import { config } from "./config";
import { GameError } from "./errors";

export interface LobbyRepository {
  put(lobby: Lobby): Promise<Lobby>;
  getByCode(code: string): Promise<Lobby | null>;
  deleteByCode(code: string): Promise<void>;
  size(): Promise<number>;
}

/** Detects transient network / gateway errors (504 Gateway Timeout, 502, 503, connection drops) */
export function isTransientDbError(err: any): boolean {
  if (!err) return false;
  const msg = String(err?.message || err?.details || "").toLowerCase();
  const code = String(err?.code || "").toLowerCase();
  return (
    msg.includes("gateway timeout") ||
    msg.includes("bad gateway") ||
    msg.includes("service unavailable") ||
    msg.includes("fetch failed") ||
    msg.includes("timeout") ||
    msg.includes("504") ||
    msg.includes("502") ||
    msg.includes("503") ||
    msg.includes("econnreset") ||
    msg.includes("etimedout") ||
    msg.includes("und_err_connect_timeout") ||
    code === "504" ||
    code === "502" ||
    code === "503"
  );
}

function isMissingGridSchema(err: any): boolean {
  const msg = String(err?.message || err?.details || "").toLowerCase();
  return (
    msg.includes("grid_cols") ||
    msg.includes("grid_rows") ||
    msg.includes("piece_count") ||
    msg.includes("schema cache")
  );
}

/** Retries transient database operations with exponential backoff */
export async function withDbRetry<T = any>(
  opName: string,
  fn: () => PromiseLike<{ data: T | null; error: any }>,
  maxRetries = 3,
  baseDelayMs = 200,
): Promise<{ data: T | null; error: any }> {
  let res: { data: T | null; error: any } = { data: null, error: null };
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      res = (await fn()) as { data: T; error: any };
      if (!res.error) return res;

      if (!isTransientDbError(res.error) || attempt === maxRetries) {
        return res;
      }

      const delay = baseDelayMs * 2 ** (attempt - 1) + Math.random() * 50;
      console.warn(
        `[REPO_RETRY] ${opName} hit transient error "${res.error.message}". Retrying (${attempt}/${maxRetries}) in ${Math.round(delay)}ms...`,
      );
      await new Promise((r) => setTimeout(r, delay));
    } catch (thrown: any) {
      if (!isTransientDbError(thrown) || attempt === maxRetries) {
        return { data: null as any, error: thrown };
      }
      const delay = baseDelayMs * 2 ** (attempt - 1) + Math.random() * 50;
      console.warn(
        `[REPO_RETRY] ${opName} threw transient exception "${thrown?.message}". Retrying (${attempt}/${maxRetries}) in ${Math.round(delay)}ms...`,
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  return res;
}

export class SupabaseLobbyRepository implements LobbyRepository {
  // In-process runtime handle cache (retains Node.js timers and promise mutexes)
  private processLobbies = new Map<string, Lobby>();
  private lobbyDbIds = new Map<string, string>();

  async put(lobby: Lobby): Promise<Lobby> {
    const code = lobby.code.toUpperCase();
    lobby.pieceCount = lobby.gridCols * lobby.gridRows;
    this.processLobbies.set(code, lobby);

    if (!isSupabaseConfigured()) {
      console.error(
        `[REPO_CONFIG_ERROR] Cannot put lobby ${code}: Supabase environment variables are missing.`,
      );
      throw new GameError(
        "INTERNAL_ERROR",
        "Supabase database is not configured. Please ensure NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set in Vercel environment variables and redeploy.",
        503,
      );
    }

    try {
      // 1. Upsert lobby row with retry
      const lobbyPayload = {
        code,
        host_token_hash: lobby.hostToken,
        status: lobby.status,
        max_players: lobby.maxPlayers,
        grid_cols: lobby.gridCols,
        grid_rows: lobby.gridRows,
        piece_count: lobby.pieceCount,
        current_game_id: lobby.currentGameId ?? null,
        updated_at: new Date().toISOString(),
      };
      let { data: lobbyRow, error: lobbyErr } = await withDbRetry<any>(
        `upsert_lobby(${code})`,
        () =>
          supabaseAdmin
            .from("lobbies")
            .upsert(lobbyPayload, { onConflict: "code" })
            .select("id")
            .single(),
      );

      if (lobbyErr && isMissingGridSchema(lobbyErr)) {
        console.warn(
          `[REPO_SCHEMA_WARN] lobbies grid columns are missing for ${code}; run migration 004_puzzle_dimensions.sql.`,
        );
        ({ data: lobbyRow, error: lobbyErr } = await withDbRetry<any>(
          `upsert_lobby_legacy(${code})`,
          () =>
            supabaseAdmin
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
              .single(),
        ));
      }

      if (lobbyErr) {
        if (isTransientDbError(lobbyErr)) {
          console.warn(`[REPO_TRANSIENT_WARN] Supabase gateway timeout during put(${code}):`, {
            message: lobbyErr.message,
            operation: "upsert_lobby",
            lobbyCode: code,
          });
          // In-memory lobby is already cached in this.processLobbies — don't crash
          return lobby;
        }

        console.error(`[REPO_ERROR] Failed to upsert lobby ${code}:`, {
          name: lobbyErr.name,
          message: lobbyErr.message,
          code: lobbyErr.code,
          details: lobbyErr.details,
          hint: lobbyErr.hint,
          operation: "upsert_lobby",
          lobbyCode: code,
        });
        throw new GameError(
          "INTERNAL_ERROR",
          `Database error: ${lobbyErr.message}. Ensure Supabase is reachable.`,
          500,
        );
      }

      if (lobbyRow?.id) {
        this.lobbyDbIds.set(code, lobbyRow.id);
      }
      const lobbyDbId = lobbyRow?.id ?? this.lobbyDbIds.get(code);

      // 2. Batch sync players (1 query instead of sequential loop)
      if (lobby.players.length > 0 && lobbyDbId) {
        const playerRows = lobby.players.map((p) => ({
          id: p.id,
          lobby_id: lobbyDbId,
          name: p.name,
          player_token_hash: p.token,
          connected: p.connectionStatus === PlayerConnection.CONNECTED,
          score: p.score,
          slot: Math.max(1, Math.min(5, p.slot || 1)),
          active: true,
          last_seen_at: new Date().toISOString(),
        }));
        const { error: pErr } = await withDbRetry<any>(
          `batch_upsert_players(${code})`,
          () => supabaseAdmin.from("players").upsert(playerRows, { onConflict: "id" }),
        );
        if (pErr) {
          console.warn(`[REPO_WARN] Failed to batch upsert players:`, pErr.message);
        }
      }

      // 3. Sync current game & player boards in parallel
      if (lobby.currentGameId) {
        const gameStatus = lobby.status === GameState.LOBBY ? GameState.FINISHED : lobby.status;
        const gamePayload = {
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
          grid_cols: lobby.gridCols,
          grid_rows: lobby.gridRows,
          piece_count: lobby.pieceCount,
        };
        const legacyGamePayload = {
          state: gamePayload.state,
          memory_started_at: gamePayload.memory_started_at,
          memory_ends_at: gamePayload.memory_ends_at,
          puzzle_started_at: gamePayload.puzzle_started_at,
          finished_at: gamePayload.finished_at,
          winner_player_id: gamePayload.winner_player_id,
        };
        const gamePromise = withDbRetry<any>(`update_game(${lobby.currentGameId})`, () =>
          supabaseAdmin
            .from("games")
            .update(gamePayload)
            .eq("id", lobby.currentGameId!),
        );

        const gpRows = lobby.players
          .filter((p) => p.puzzle)
          .map((p) => ({
            game_id: lobby.currentGameId,
            player_id: p.id,
            board: p.puzzle!.board,
            moves: p.puzzle!.moves,
            correct_slots: correctSlots(p.puzzle!.board).filter(Boolean).length,
            completed: p.puzzle!.completed,
            started_at: new Date(p.puzzle!.startedAt).toISOString(),
            completed_at: p.puzzle!.completedAt
              ? new Date(p.puzzle!.completedAt).toISOString()
              : null,
          }));

        const gpPromise =
          gpRows.length > 0
            ? withDbRetry<any>(`batch_upsert_game_players(${lobby.currentGameId})`, () =>
                supabaseAdmin
                  .from("game_players")
                  .upsert(gpRows, { onConflict: "game_id,player_id" }),
              )
            : Promise.resolve({ data: null, error: null });

        let [gameRes, gpRes] = await Promise.all([gamePromise, gpPromise]);
        if (gameRes.error && isMissingGridSchema(gameRes.error)) {
          console.warn(
            `[REPO_SCHEMA_WARN] games grid columns are missing for ${code}; run migration 004_puzzle_dimensions_and_actions.sql.`,
          );
          gameRes = await withDbRetry<any>(`update_game_legacy(${lobby.currentGameId})`, () =>
            supabaseAdmin
              .from("games")
              .update(legacyGamePayload)
              .eq("id", lobby.currentGameId!),
          );
        }
        if (gameRes.error) {
          console.warn(`[REPO_WARN] Failed to update game ${lobby.currentGameId}:`, gameRes.error.message);
        }
        if (gpRes.error) {
          console.warn(`[REPO_WARN] Failed to batch upsert game_players:`, gpRes.error.message);
        }
      }
    } catch (err: any) {
      if (err instanceof GameError) throw err;
      if (isTransientDbError(err)) {
        console.warn(`[REPO_TRANSIENT_WARN] Transient exception during put(${code}), proceeding with in-memory state:`, err?.message);
        return lobby;
      }
      console.error(`[REPO_ERROR] Unexpected error in put(${code}):`, {
        name: err?.name,
        message: err?.message,
        causeMessage: err?.cause?.message,
        causeCode: err?.cause?.code,
        operation: "put_lobby",
        lobbyCode: code,
      });
      throw new GameError(
        "INTERNAL_ERROR",
        `Failed to persist lobby ${code} to database: ${err?.message ?? "Network error"}.`,
        500,
      );
    }

    return lobby;
  }

  async getByCode(code: string): Promise<Lobby | null> {
    const normCode = code.toUpperCase();

    if (!isSupabaseConfigured()) {
      console.error(`[REPO_CONFIG_ERROR] Cannot get lobby ${normCode}: Supabase credentials not configured.`);
      return this.processLobbies.get(normCode) ?? null;
    }

    try {
      // 1. Fetch lobby from Supabase with retry
      const { data: lobbyRow, error: lobbyErr } = await withDbRetry<any>(
        `getByCode_lobby(${normCode})`,
        () =>
          supabaseAdmin
            .from("lobbies")
            .select("*")
            .eq("code", normCode)
            .maybeSingle(),
      );

      if (lobbyErr) {
        console.error(`[REPO_ERROR] Failed to fetch lobby ${normCode}:`, {
          name: lobbyErr.name,
          message: lobbyErr.message,
          code: lobbyErr.code,
          details: lobbyErr.details,
          hint: lobbyErr.hint,
          operation: "getByCode_lobby",
          lobbyCode: normCode,
        });
        const cached = this.processLobbies.get(normCode);
        if (cached) {
          console.warn(`[REPO_FALLBACK] Serving in-memory lobby for ${normCode} after Supabase error.`);
          return cached;
        }
        return null;
      }
      if (!lobbyRow) {
        return this.processLobbies.get(normCode) ?? null;
      }

      this.lobbyDbIds.set(normCode, lobbyRow.id);

      // 2 & 3. Parallel fetch: active players, current game, and game_players with retry
      const [playersRes, gameRes, gpRes] = await Promise.all([
        withDbRetry<any[]>(`get_players(${normCode})`, () =>
          supabaseAdmin
            .from("players")
            .select("*")
            .eq("lobby_id", lobbyRow.id)
            .eq("active", true)
            .order("slot", { ascending: true }),
        ),
        lobbyRow.current_game_id
          ? withDbRetry<any>(`get_game(${lobbyRow.current_game_id})`, () =>
              supabaseAdmin
                .from("games")
                .select("*, puzzle_images(*)")
                .eq("id", lobbyRow.current_game_id)
                .maybeSingle(),
            )
          : Promise.resolve({ data: null, error: null }),
        lobbyRow.current_game_id
          ? withDbRetry<any[]>(`get_game_players(${lobbyRow.current_game_id})`, () =>
              supabaseAdmin
                .from("game_players")
                .select("*")
                .eq("game_id", lobbyRow.current_game_id),
            )
          : Promise.resolve({ data: [], error: null }),
      ]);

      const playerRows = playersRes.data ?? [];
      const gameRow: Record<string, any> | null = gameRes.data;
      const existingLobby = this.processLobbies.get(normCode);
      const gridCols =
        Number(lobbyRow.grid_cols ?? gameRow?.grid_cols ?? existingLobby?.gridCols ?? config.gridCols);
      const gridRows =
        Number(lobbyRow.grid_rows ?? gameRow?.grid_rows ?? existingLobby?.gridRows ?? config.gridRows);
      const pieceCount =
        Number(lobbyRow.piece_count ?? gameRow?.piece_count ?? gridCols * gridRows);
      const gamePlayerMap = new Map<string, Record<string, any>>();
      for (const gp of gpRes.data ?? []) {
        gamePlayerMap.set(gp.player_id, gp);
      }

      // 4. Hydrate runtime player objects
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
          gridCols,
          gridRows,
          pieceCount,
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
        lobby.gridCols = gridCols;
        lobby.gridRows = gridRows;
        lobby.pieceCount = pieceCount;
        lobby.currentGameId = lobbyRow.current_game_id ?? null;
        lobby.players = players;
        lobby.memory = memory;
        lobby.puzzleStartedAt = puzzleStartedAt;
        lobby.winnerId = winnerId;
        lobby.finishedAt = finishedAt;
      }

      return lobby;
    } catch (err: any) {
      console.error(`[REPO_ERROR] Unexpected error in getByCode(${normCode}):`, {
        name: err?.name,
        message: err?.message,
        causeMessage: err?.cause?.message,
        causeCode: err?.cause?.code,
        operation: "getByCode_lobby",
        lobbyCode: normCode,
      });
      return this.processLobbies.get(normCode) ?? null;
    }
  }

  async deleteByCode(code: string): Promise<void> {
    const normCode = code.toUpperCase();
    this.processLobbies.delete(normCode);
    this.lobbyDbIds.delete(normCode);
    try {
      await withDbRetry(`delete_lobby(${normCode})`, () =>
        supabaseAdmin.from("lobbies").delete().eq("code", normCode),
      );
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
