"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FuzalSocket, type ConnectionState } from "./realtime";
import { pieceUrl, postAction, sessionStore } from "./api";
import { EventType, type GameEvent, type GameState } from "@/lib/game/types";
import { swapPieces, correctSlots as computeCorrect, isSolved } from "@/lib/game/puzzle";

export interface PlayerView {
  id: string;
  name: string;
  connected: boolean;
  score: number;
  slot: number;
}
export interface ProgressView extends PlayerView {
  moves: number;
  correctCount: number;
  completed: boolean;
  eliminated?: boolean;
  durationMs?: number | null;
}
export interface ResultView {
  winner: PlayerView | null;
  timeExpired?: boolean;
  finishedAt: number | null;
  durationMs: number | null;
  image: { id: string; url: string; name: string } | null;
  standings: ProgressView[];
}
export interface ClientState {
  code: string;
  lobbyId: string;
  status: GameState;
  maxPlayers: number;
  gridCols: number;
  gridRows: number;
  serverNow: number;
  players: PlayerView[];
  you: { id: string; name: string; score: number } | null;
  isHost: boolean;
  memory: { startedAt: number; endsAt: number; durationSeconds: number } | null;
  image: { id: string; url: string; name: string } | null;
  imageName: string | null;
  puzzle: {
    board: number[];
    moves: number;
    startedAt: number;
    correctSlots: boolean[];
    completed?: boolean;
    completedAt?: number;
    eliminated?: boolean;
  } | null;
  puzzleStartedAt: number | null;
  puzzleEndsAt?: number | null;
  puzzleDurationSeconds?: number | null;
  puzzleProgress: ProgressView[] | null;
  result: ResultView | null;
}

interface UseOpts {
  code: string;
  kind: "host" | "player";
  hostToken?: string;
  playerId?: string;
  playerToken?: string;
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function useFuzalGame(opts: UseOpts) {
  const [state, setState] = useState<ClientState | null>(null);
  const [connState, setConnState] = useState<ConnectionState>("connecting");
  const [toast, setToast] = useState<string | null>(null);
  const [goFlash, setGoFlash] = useState(false);
  const clockOffset = useRef(0);
  const socketRef = useRef<FuzalSocket | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }, []);

  const applyEvent = useCallback((event: GameEvent) => {
    clockOffset.current = event.at - Date.now();
    const p = (event.payload ?? {}) as Record<string, unknown>;

    setState((prev) => {
      if (event.type === EventType.SNAPSHOT) {
        return p as unknown as ClientState;
      }
      if (!prev) return prev;
      const next: ClientState = { ...prev };

      switch (event.type) {
        case EventType.LOBBY_UPDATED: {
          if (Array.isArray(p.players)) next.players = p.players as PlayerView[];
          if (typeof p.status === "string") next.status = p.status as GameState;
          break;
        }
        case EventType.PLAYER_JOINED: {
          const pl = p.player as PlayerView;
          if (pl && !next.players.some((x) => x.id === pl.id)) {
            next.players = [...next.players, pl].sort((a, b) => a.slot - b.slot);
          }
          break;
        }
        case EventType.PLAYER_LEFT: {
          next.players = next.players.filter((x) => x.id !== p.playerId);
          break;
        }
        case EventType.PLAYER_STATUS: {
          const connected = Boolean(p.connected);
          next.players = next.players.map((x) =>
            x.id === p.playerId ? { ...x, connected } : x,
          );
          break;
        }
        case EventType.GAME_STARTED: {
          next.status = "MEMORY";
          next.result = null;
          break;
        }
        case EventType.MEMORY_PHASE_STARTED: {
          next.status = "MEMORY";
          next.result = null;
          next.puzzle = null;
          next.puzzleProgress = null;
          next.puzzleStartedAt = null;
          next.memory = {
            startedAt: p.startedAt as number,
            endsAt: p.endsAt as number,
            durationSeconds: p.durationSeconds as number,
          };
          if (p.image) next.image = p.image as ClientState["image"];
          if (typeof p.imageName === "string") next.imageName = p.imageName;
          break;
        }
        case EventType.MEMORY_TIMER_UPDATED: {
          if (next.memory && typeof p.endsAt === "number") {
            next.memory = { ...next.memory, endsAt: p.endsAt };
          }
          break;
        }
        case EventType.PUZZLE_STARTED: {
          next.status = "PUZZLE";
          next.memory = null;
          next.puzzleStartedAt = (p.startedAt as number) ?? Date.now();
          next.puzzleEndsAt =
            (p.endsAt as number) ?? (next.puzzleStartedAt + 180_000);
          next.puzzleDurationSeconds = (p.durationSeconds as number) ?? 180;
          if (Array.isArray(p.players)) {
            next.puzzleProgress = p.players as ProgressView[];
          }
          if (Array.isArray(p.board)) {
            next.puzzle = {
              board: p.board as number[],
              moves: (p.moves as number) ?? 0,
              startedAt: next.puzzleStartedAt,
              correctSlots: computeCorrect(p.board as number[]),
              eliminated: false,
            };
            setGoFlash(true);
            setTimeout(() => setGoFlash(false), 950);
          }
          break;
        }
        case EventType.PUZZLE_TIMER_UPDATED: {
          if (typeof p.endsAt === "number") {
            next.puzzleEndsAt = p.endsAt as number;
          }
          break;
        }
        case EventType.PLAYER_ELIMINATED: {
          if (p.playerId === opts.playerId) {
            showToast((p.message as string) ?? "Time's up! You were eliminated.");
            if (next.puzzle) {
              next.puzzle = { ...next.puzzle, eliminated: true };
            }
          }
          if (Array.isArray(next.puzzleProgress)) {
            next.puzzleProgress = next.puzzleProgress.map((pr) =>
              pr.id === p.playerId ? { ...pr, eliminated: true } : pr,
            );
          }
          break;
        }
        case EventType.PUZZLE_MOVE: {
          if (Array.isArray(p.board)) {
            const board = p.board as number[];
            const isCompleted = Boolean(p.completed);
            next.puzzle = {
              board,
              moves: (p.moves as number) ?? next.puzzle?.moves ?? 0,
              startedAt: next.puzzle?.startedAt ?? Date.now(),
              correctSlots: computeCorrect(board),
              eliminated: next.puzzle?.eliminated ?? false,
              completed: next.puzzle?.completed || isCompleted,
            };
          }
          if (typeof p.playerId === "string" && Array.isArray(next.puzzleProgress)) {
            next.puzzleProgress = next.puzzleProgress.map((pr) =>
              pr.id === p.playerId
                ? {
                    ...pr,
                    moves: (p.moves as number) ?? pr.moves,
                    correctCount: (p.correctCount as number) ?? pr.correctCount,
                  }
                : pr,
            );
          }
          break;
        }
        case EventType.PLAYER_COMPLETED: {
          if (Array.isArray(next.puzzleProgress)) {
            next.puzzleProgress = next.puzzleProgress.map((pr) =>
              pr.id === p.playerId ? { ...pr, completed: true } : pr,
            );
          }
          break;
        }
        case EventType.GAME_FINISHED: {
          next.status = "FINISHED";
          next.result = p as unknown as ResultView;
          next.players = (p.standings as PlayerView[]) ?? next.players;
          if (p.image) next.image = p.image as ClientState["image"];
          break;
        }
        case EventType.NEW_GAME: {
          next.status = (p.status as GameState) ?? "LOBBY";
          next.result = null;
          next.puzzle = null;
          next.puzzleProgress = null;
          next.image = next.isHost ? next.image : null;
          next.imageName = null;
          next.puzzleStartedAt = null;
          next.puzzleEndsAt = null;
          next.puzzleDurationSeconds = null;
          break;
        }
        case EventType.GAME_TIMEOUT: {
          showToast("Time's up! The 3-minute limit expired.");
          if (next.puzzle && !next.puzzle.completed) {
            next.puzzle = { ...next.puzzle, eliminated: true };
          }
          break;
        }
        case EventType.RESULTS_READY: {
          next.status = "FINISHED";
          if (p) next.result = p as unknown as ResultView;
          break;
        }
        case EventType.LOBBY_RESET:
        case EventType.GAME_CLOSED: {
          next.status = "LOBBY";
          next.result = null;
          next.puzzle = null;
          next.puzzleProgress = null;
          next.players = Array.isArray(p?.players) ? (p.players as PlayerView[]) : [];
          next.memory = null;
          next.puzzleStartedAt = null;
          next.puzzleEndsAt = null;
          next.puzzleDurationSeconds = null;
          if (opts.kind === "player") {
            try {
              sessionStore.remove("fuzal_player_session");
              sessionStore.remove(`player:${opts.code}`);
            } catch {}
            showToast("Lobby was reset by host. Session closed.");
          }
          break;
        }
        case EventType.ERROR: {
          showToast((p.message as string) ?? "Something went wrong.");
          break;
        }
      }
      return next;
    });
  }, [opts.code, opts.kind, showToast]);

  useEffect(() => {
    const socket = new FuzalSocket({
      code: opts.code,
      kind: opts.kind,
      hostToken: opts.hostToken,
      playerId: opts.playerId,
      playerToken: opts.playerToken,
      onEvent: applyEvent,
      onStateChange: setConnState,
      onSessionExpired: () => {
        if (opts.kind === "player") {
          try {
            sessionStore.remove("fuzal_player_session");
            sessionStore.remove(`player:${opts.code}`);
          } catch {}
          showToast("Game session has ended or was reset by the host.");
          setState((prev) =>
            prev ? { ...prev, status: "LOBBY", puzzle: null, result: null, players: [] } : null,
          );
        }
      },
    });
    socketRef.current = socket;
    socket.connect();
    return () => socket.disconnect();
    // Re-create the socket when credentials arrive from stored sessions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    opts.code,
    opts.kind,
    opts.hostToken ?? "",
    opts.playerId ?? "",
    opts.playerToken ?? "",
  ]);

  // 4fps ticker drives server-synchronized countdowns / elapsed time.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 250);
    return () => clearInterval(id);
  }, []);

  const serverNow = useCallback(() => Date.now() + clockOffset.current, []);

  const memorySeconds = (() => {
    if (!state?.memory) return 0;
    const ms = state.memory.endsAt - (Date.now() + clockOffset.current);
    return Math.max(0, Math.ceil(ms / 1000));
  })();

  const puzzleElapsedMs = (() => {
    if (!state) return 0;
    const start = state.puzzle?.startedAt ?? state.puzzleStartedAt;
    if (!start) return 0;
    const end =
      state.status === "FINISHED"
        ? state.result?.finishedAt ?? Date.now() + clockOffset.current
        : Date.now() + clockOffset.current;
    return Math.max(0, end - start);
  })();

  const puzzleRemainingMs = (() => {
    if (!state) return 0;
    if (state.status !== "PUZZLE") return 0;
    const endsAt =
      state.puzzleEndsAt ??
      (state.puzzleStartedAt ? state.puzzleStartedAt + 180_000 : null);
    if (!endsAt) return 180_000;
    return Math.max(0, endsAt - (Date.now() + clockOffset.current));
  })();

  const isEliminated = Boolean(
    (state?.status === "PUZZLE" && puzzleRemainingMs <= 0 && !state.puzzle?.completed) ||
    state?.puzzle?.eliminated ||
    (state?.status === "FINISHED" && state.result && !state.result.winner && !state.puzzle?.completed)
  );

  /* ---------------- Actions ---------------- */

  const startGame = useCallback(async () => {
    if (!opts.hostToken) return;
    try {
      await postAction(opts.code, { type: "START_GAME", token: opts.hostToken });
    } catch (e) {
      showToast((e as Error).message);
    }
  }, [opts.code, opts.hostToken, showToast]);

  const playAgain = useCallback(async () => {
    if (!opts.hostToken) return;
    try {
      await postAction(opts.code, { type: "PLAY_AGAIN", token: opts.hostToken });
    } catch (e) {
      showToast((e as Error).message);
    }
  }, [opts.code, opts.hostToken, showToast]);

  const backToLobby = useCallback(async () => {
    if (!opts.hostToken) return;
    try {
      await postAction(opts.code, { type: "BACK_TO_LOBBY", token: opts.hostToken });
    } catch (e) {
      showToast((e as Error).message);
    }
  }, [opts.code, opts.hostToken, showToast]);

  const swap = useCallback(
    async (from: number, to: number) => {
      // Step 6: Prevent further moves if player is eliminated, parameters invalid, or puzzle already solved
      if (
        !opts.playerId ||
        !opts.playerToken ||
        from === to ||
        isEliminated ||
        state?.puzzle?.completed
      ) {
        return;
      }

      const totalPieces = (state?.gridCols ?? 3) * (state?.gridRows ?? 3);
      let isNowSolved = false;

      // Step 1: Update the board state
      // Step 2: Recalculate which positions are correct
      // Step 3: Check ALL positions against the canonical solved mapping
      // Step 4: If all positions are correct, mark the puzzle SOLVED exactly once
      setState((prev) => {
        if (!prev?.puzzle || prev.puzzle.completed) return prev;
        const nextBoard = swapPieces(prev.puzzle.board, from, to);
        const nextCorrectSlots = computeCorrect(nextBoard);
        isNowSolved = isSolved(nextBoard, totalPieces);

        return {
          ...prev,
          puzzle: {
            ...prev.puzzle,
            board: nextBoard,
            moves: prev.puzzle.moves + 1,
            correctSlots: nextCorrectSlots,
            completed: prev.puzzle.completed || isNowSolved,
            completedAt: isNowSolved && !prev.puzzle.completedAt ? Date.now() : prev.puzzle.completedAt,
          },
        };
      });

      // Step 5: Send exactly one completion/swap request to the server
      try {
        await postAction(opts.code, {
          type: "SWAP",
          token: opts.playerToken,
          playerId: opts.playerId,
          from,
          to,
        });

        if (isNowSolved) {
          try {
            await postAction(opts.code, {
              type: "COMPLETE",
              token: opts.playerToken,
              playerId: opts.playerId,
            });
          } catch {
            // Server SWAP handler already independently validates and finishes the round
          }
        }
      } catch (e) {
        showToast((e as Error).message);
      }
    },
    [
      opts.code,
      opts.playerId,
      opts.playerToken,
      isEliminated,
      state?.puzzle?.completed,
      state?.gridCols,
      state?.gridRows,
      showToast,
    ],
  );

  /* ------------- Preload puzzle pieces with retry & validation ------------- */
  const [pieceSrcs, setPieceSrcs] = useState<Record<number, string>>({});
  const [piecesLoading, setPiecesLoading] = useState(false);
  const [piecesError, setPiecesError] = useState<string | null>(null);
  const [loadAttempts, setLoadAttempts] = useState(0);

  const retryLoadPieces = useCallback(() => {
    setPiecesError(null);
    setLoadAttempts((c) => c + 1);
  }, []);

  // Reset piece srcs when returning to lobby for a new round
  useEffect(() => {
    if (state?.status === "LOBBY") {
      setPieceSrcs({});
      setPiecesError(null);
    }
  }, [state?.status]);

  useEffect(() => {
    if (
      (state?.status !== "MEMORY" && state?.status !== "PUZZLE") ||
      !opts.playerId ||
      !opts.playerToken ||
      !opts.code
    ) {
      return;
    }
    const total = (state.gridCols ?? 3) * (state.gridRows ?? 3);

    // If already loaded for this round, do nothing
    if (Object.keys(pieceSrcs).length >= total) {
      return;
    }

    let cancelled = false;
    const created: string[] = [];

    async function fetchTileWithRetry(pieceId: number, maxRetries = 3): Promise<string> {
      let lastErr = "";
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        if (cancelled) throw new Error("Cancelled");
        try {
          const url = pieceUrl(opts.code!, pieceId, opts.playerId!, opts.playerToken!);
          const res = await fetch(url);
          if (!res.ok) {
            const errText = await res.text().catch(() => "");
            lastErr = `HTTP ${res.status}: ${errText}`;
            await new Promise((r) => setTimeout(r, 150 * attempt));
            continue;
          }
          const cType = res.headers.get("content-type") ?? "";
          if (!cType.includes("image")) {
            lastErr = `Expected image content-type, got: ${cType}`;
            await new Promise((r) => setTimeout(r, 150 * attempt));
            continue;
          }
          const blob = await res.blob();
          const objectUrl = URL.createObjectURL(blob);
          created.push(objectUrl);
          return objectUrl;
        } catch (e) {
          lastErr = (e as Error).message;
          await new Promise((r) => setTimeout(r, 150 * attempt));
        }
      }
      throw new Error(`Failed to load piece #${pieceId} (${lastErr})`);
    }

    async function preload() {
      setPiecesLoading(true);
      setPiecesError(null);

      try {
        // Fast path: Single batch request for all 16 pieces (<20KB, ~50ms)
        const batchUrl = `/api/lobbies/${opts.code}/pieces?p=${encodeURIComponent(
          opts.playerId!,
        )}&t=${encodeURIComponent(opts.playerToken!)}`;
        const batchRes = await fetch(batchUrl);
        if (batchRes.ok) {
          const batchData = await batchRes.json();
          if (
            batchData.ok &&
            batchData.pieces &&
            Object.keys(batchData.pieces).length === total
          ) {
            if (!cancelled) {
              setPieceSrcs(batchData.pieces);
              setPiecesLoading(false);
              return;
            }
          }
        }

        // Fallback path: Progressive individual tile prefetching
        await Promise.all(
          Array.from({ length: total }, (_, pieceId) =>
            fetchTileWithRetry(pieceId, 3).then((url) => {
              if (!cancelled) {
                setPieceSrcs((prev) => ({ ...prev, [pieceId]: url }));
              }
            }),
          ),
        );

        if (cancelled) {
          created.forEach((u) => URL.revokeObjectURL(u));
          return;
        }

        setPiecesLoading(false);
      } catch (err) {
        if (!cancelled) {
          console.error("[PRELOAD_ERROR]", err);
          setPiecesError((err as Error).message);
          setPiecesLoading(false);
        }
      }
    }

    void preload();

    return () => {
      cancelled = true;
      created.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [
    state?.status,
    state?.gridCols,
    state?.gridRows,
    opts.playerId,
    opts.code,
    opts.playerToken,
    loadAttempts,
    pieceSrcs,
  ]);

  const exitGame = useCallback(() => {
    socketRef.current?.disconnect();
    try {
      sessionStore.remove("fuzal_player_session");
      sessionStore.remove(`player:${opts.code}`);
    } catch {}
    setState(null);
  }, [opts.code]);

  return {
    state,
    connState,
    toast,
    goFlash,
    serverNow,
    memorySeconds,
    puzzleElapsedMs,
    puzzleRemainingMs,
    isEliminated,
    pieceSrcs,
    piecesLoading,
    piecesError,
    retryLoadPieces,
    actions: { startGame, swap, playAgain, backToLobby, exitGame },
  };
}
