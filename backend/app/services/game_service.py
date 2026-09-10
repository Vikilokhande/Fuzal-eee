"""Authoritative lobby + game engine.

The server owns game state, the clock, every player's board, puzzle
validation and winner determination. All mutations run under a per-lobby
asyncio.Lock so two concurrent completion requests cannot both win.
"""
from __future__ import annotations

import asyncio
import secrets
import time
from collections import defaultdict
from typing import Any

from app.config import settings
from app.models.schemas import (
    EventType,
    GameState,
    Lobby,
    MemoryPhase,
    Player,
    PlayerConnection,
    PuzzleInstance,
    VALID_TRANSITIONS,
)
from app.services.image_service import image_service
from app.services.puzzle_service import (
    correct_slots,
    generate_shuffled_board,
    is_solved,
    swap_pieces,
)
from app.websocket.manager import manager

ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


class GameError(Exception):
    def __init__(self, code: str, message: str, status: int = 400):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


def now_ms() -> int:
    return int(time.time() * 1000)


def make_code(length: int = 4) -> str:
    return "".join(secrets.choice(ALPHABET) for _ in range(length))


def make_player_id() -> str:
    return "p_" + secrets.token_hex(9)


def make_token() -> str:
    return secrets.token_hex(24)


def event(kind: EventType, payload: Any, lobby_id: str | None = None) -> dict:
    return {"type": kind.value, "at": now_ms(), "lobbyId": lobby_id, "payload": payload}


def constant_time_eq(a: str, b: str) -> bool:
    return secrets.compare_digest(a, b)


class GameService:
    def __init__(self) -> None:
        self.lobbies: dict[str, Lobby] = {}
        self.locks: dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)

    # ------------------------------------------------------------ helpers

    def _lock(self, lobby: Lobby) -> asyncio.Lock:
        return self.locks[lobby.code]

    def get(self, code: str) -> Lobby:
        lobby = self.lobbies.get(code)
        if not lobby:
            raise GameError("NOT_FOUND", "Lobby not found.", 404)
        return lobby

    @staticmethod
    def _find(lobby: Lobby, player_id: str) -> Player | None:
        return next((p for p in lobby.players if p.id == player_id), None)

    @staticmethod
    def _cancel_timers(lobby: Lobby) -> None:
        for t in list(lobby.timer_tasks.values()):
            if isinstance(t, asyncio.Task):
                t.cancel()
        lobby.timer_tasks.clear()
        for h in list(lobby.disconnect_tasks.values()):
            h.cancel()
        lobby.disconnect_tasks.clear()

    @staticmethod
    def _free_slot(lobby: Lobby) -> int:
        used = {p.slot for p in lobby.players}
        for i in range(lobby.max_players):
            if i not in used:
                return i
        return len(lobby.players)

    # ------------------------------------------------------------ DTOs

    @staticmethod
    def public_player(p: Player) -> dict:
        return {
            "id": p.id,
            "name": p.name,
            "connected": p.connection_status == PlayerConnection.CONNECTED,
            "score": p.score,
            "slot": p.slot,
        }

    def _progress(self, p: Player) -> dict:
        board = p.puzzle.board if p.puzzle else []
        return {
            **self.public_player(p),
            "moves": p.puzzle.moves if p.puzzle else 0,
            "correctCount": sum(correct_slots(board)),
            "completed": bool(p.puzzle and p.puzzle.completed),
        }

    def public_view(self, lobby: Lobby) -> dict:
        return {
            "code": lobby.code,
            "lobbyId": lobby.id,
            "status": lobby.status.value,
            "maxPlayers": lobby.max_players,
            "playerCount": len(lobby.players),
            "players": [self.public_player(p) for p in lobby.players],
            "started": lobby.status in (GameState.MEMORY, GameState.PUZZLE),
            "full": len(lobby.players) >= lobby.max_players,
        }

    def _result(self, lobby: Lobby) -> dict:
        winner = next((p for p in lobby.players if p.id == lobby.winner_id), None)
        started = lobby.puzzle_started_at or now_ms()
        standings = []
        for p in lobby.players:
            standings.append(
                {
                    **self._progress(p),
                    "durationMs": (
                        p.puzzle.completed_at - started
                        if p.puzzle and p.puzzle.completed_at
                        else None
                    ),
                }
            )
        win_id = winner.id if winner else None
        standings.sort(
            key=lambda s: (
                s["id"] != win_id,
                -s["correctCount"],
                s["moves"],
            )
        )
        return {
            "winner": self.public_player(winner) if winner else None,
            "finishedAt": lobby.finished_at,
            "durationMs": (
                lobby.finished_at - started
                if lobby.finished_at and lobby.puzzle_started_at
                else None
            ),
            "image": dict(lobby.memory.image) if lobby.memory else None,
            "standings": standings,
        }

    def snapshot(self, lobby: Lobby, kind: str, you: Player | None) -> dict:
        payload: dict[str, Any] = {
            "code": lobby.code,
            "lobbyId": lobby.id,
            "status": lobby.status.value,
            "maxPlayers": lobby.max_players,
            "gridCols": lobby.grid_cols,
            "gridRows": lobby.grid_rows,
            "serverNow": now_ms(),
            "players": [self.public_player(p) for p in lobby.players],
            "you": (
                {"id": you.id, "name": you.name, "score": you.score} if you else None
            ),
            "isHost": kind == "host",
            "memory": None,
            "image": None,
            "imageName": None,
            "puzzle": None,
            "puzzleProgress": None,
            "result": None,
            "puzzleStartedAt": lobby.puzzle_started_at,
        }
        if lobby.status == GameState.MEMORY and lobby.memory:
            m = lobby.memory
            payload["memory"] = {
                "startedAt": m.started_at,
                "endsAt": m.ends_at,
                "durationSeconds": m.duration_seconds,
                "remaining": max(0, (m.ends_at - now_ms() + 999) // 1000),
            }
            if kind == "host":
                payload["image"] = dict(m.image)
            else:
                payload["imageName"] = m.image["name"]
        if lobby.status in (GameState.PUZZLE, GameState.FINISHED):
            payload["puzzleProgress"] = [self._progress(p) for p in lobby.players]
            if kind == "player" and you and you.puzzle:
                payload["puzzle"] = {
                    "board": list(you.puzzle.board),
                    "moves": you.puzzle.moves,
                    "startedAt": you.puzzle.started_at,
                    "correctSlots": correct_slots(you.puzzle.board),
                }
        if lobby.status == GameState.FINISHED:
            payload["result"] = self._result(lobby)
            if kind == "host" and lobby.memory:
                payload["image"] = dict(lobby.memory.image)
        return event(EventType.SNAPSHOT, payload, lobby.id)

    # ------------------------------------------------------------ lifecycle

    async def create_lobby(
        self,
        grid_cols: int | None = None,
        grid_rows: int | None = None,
    ) -> Lobby:
        code = make_code()
        lobby = Lobby(
            id=f"FZ-{code}",
            code=code,
            host_token=make_token(),
            max_players=settings.max_players,
            grid_cols=grid_cols or settings.grid_cols,
            grid_rows=grid_rows or settings.grid_rows,
        )
        self.lobbies[code] = lobby
        return lobby

    async def join(self, code: str, name: str) -> Player:
        lobby = self.get(code)
        async with self._lock(lobby):
            if lobby.status in (GameState.MEMORY, GameState.PUZZLE):
                raise GameError(
                    "ALREADY_STARTED",
                    "Game has already started. Wait for the next round.",
                    403,
                )
            if len(lobby.players) >= lobby.max_players:
                raise GameError(
                    "FULL",
                    "Lobby is full (5/5). Please wait for the next game.",
                    409,
                )
            if any(p.name.lower() == name.strip().lower() for p in lobby.players):
                raise GameError("CONFLICT", "That name is already taken.", 409)
            player = Player(
                id=make_player_id(),
                name=name.strip(),
                token=make_token(),
                joined_at=now_ms(),
                slot=self._free_slot(lobby),
            )
            lobby.players.append(player)
            await manager.broadcast(
                code, event(EventType.PLAYER_JOINED, {"player": self.public_player(player)}, lobby.id)
            )
            await manager.broadcast(
                code,
                event(
                    EventType.LOBBY_UPDATED,
                    {"players": [self.public_player(p) for p in lobby.players],
                     "status": lobby.status.value},
                    lobby.id,
                ),
            )
            return player

    async def authenticate(
        self, code: str, kind: str, token: str, player_id: str | None
    ) -> tuple[Lobby, Player | None]:
        lobby = self.get(code)
        if kind == "host":
            if not constant_time_eq(token, lobby.host_token):
                raise GameError("FORBIDDEN", "Invalid host token.", 403)
            return lobby, None
        player = self._find(lobby, player_id or "")
        if not player or not constant_time_eq(token, player.token):
            raise GameError("FORBIDDEN", "Invalid player session.", 403)
        handle = lobby.disconnect_tasks.pop(player.id, None)
        remove_handle = lobby.disconnect_tasks.pop(f"{player.id}:remove", None)
        if handle:
            handle.cancel()
        if remove_handle:
            remove_handle.cancel()
        if player.connection_status == PlayerConnection.DISCONNECTED:
            player.connection_status = PlayerConnection.CONNECTED
            await manager.broadcast(
                code,
                event(
                    EventType.PLAYER_STATUS,
                    {"playerId": player.id, "connected": True,
                     "player": self.public_player(player)},
                    lobby.id,
                ),
            )
        return lobby, player

    async def handle_disconnect(self, code: str, player_id: str) -> None:
        lobby = self.lobbies.get(code)
        if not lobby:
            return
        player = self._find(lobby, player_id)
        if not player:
            return
        loop = asyncio.get_running_loop()

        def mark_disconnected() -> None:
            if self._find(lobby, player_id) is None:
                return
            player.connection_status = PlayerConnection.DISCONNECTED
            asyncio.create_task(
                manager.broadcast(
                    code,
                    event(
                        EventType.PLAYER_STATUS,
                        {"playerId": player_id, "connected": False,
                         "player": self.public_player(player)},
                        lobby.id,
                    ),
                )
            )
            if lobby.status == GameState.LOBBY:
                def remove() -> None:
                    fresh = self.lobbies.get(code)
                    p = fresh and self._find(fresh, player_id)
                    if (
                        fresh
                        and p
                        and p.connection_status == PlayerConnection.DISCONNECTED
                        and fresh.status == GameState.LOBBY
                    ):
                        fresh.players = [x for x in fresh.players if x.id != player_id]
                        asyncio.create_task(
                            manager.broadcast(
                                code, event(EventType.PLAYER_LEFT, {"playerId": player_id}, fresh.id)
                            )
                        )
                        asyncio.create_task(
                            manager.broadcast(
                                code,
                                event(
                                    EventType.LOBBY_UPDATED,
                                    {"players": [self.public_player(x) for x in fresh.players],
                                     "status": fresh.status.value},
                                    fresh.id,
                                ),
                            )
                        )

                lobby.disconnect_tasks[f"{player_id}:remove"] = loop.call_later(
                    settings.disconnect_grace_ms / 1000, remove
                )

        lobby.disconnect_tasks[player_id] = loop.call_later(2.5, mark_disconnected)

    # ------------------------------------------------------------ phases

    async def _memory_loop(self, code: str, ends_at: int) -> None:
        try:
            while True:
                remaining = max(0, -(-(ends_at - now_ms()) // 1000))  # ceil
                await manager.broadcast(
                    code, event(EventType.MEMORY_TIMER_UPDATED,
                                {"remaining": remaining, "endsAt": ends_at})
                )
                if remaining <= 0:
                    break
                await asyncio.sleep(min(1.0, (ends_at - now_ms()) / 1000))
            await self.begin_puzzle(code)
        except asyncio.CancelledError:
            pass

    def _assert_host(self, lobby: Lobby, token: str) -> None:
        if not constant_time_eq(token, lobby.host_token):
            raise GameError("FORBIDDEN", "Only the host can do that.", 403)

    def _enter_memory(self, lobby: Lobby) -> None:
        image = image_service.get_random_image(lobby.used_image_ids)
        lobby.used_image_ids.append(image.id)
        duration = settings.memory_seconds
        started_at, ends_at = now_ms(), now_ms() + duration * 1000
        lobby.status = GameState.MEMORY
        lobby.memory = MemoryPhase(
            image={"id": image.id, "url": image.url, "name": image.name},
            started_at=started_at,
            ends_at=ends_at,
            duration_seconds=duration,
        )
        lobby.winner_id = None
        lobby.finished_at = None
        task = asyncio.create_task(self._memory_loop(lobby.code, ends_at))
        lobby.timer_tasks["memory"] = task

    async def start_game(self, code: str, host_token: str) -> None:
        lobby = self.get(code)
        async with self._lock(lobby):
            self._assert_host(lobby, host_token)
            if GameState.MEMORY not in VALID_TRANSITIONS[lobby.status]:
                raise GameError("INVALID_STATE", f"Cannot start from {lobby.status}", 409)
            if not lobby.players:
                raise GameError("BAD_REQUEST", "At least one player must join.", 400)
            for p in lobby.players:
                p.puzzle = None
            self._enter_memory(lobby)
            image = lobby.memory.image  # type: ignore[union-attr]
            await manager.broadcast(
                code, event(EventType.GAME_STARTED, {"status": GameState.MEMORY.value}, lobby.id)
            )
            await manager.send_to_host(
                code,
                event(EventType.MEMORY_PHASE_STARTED, {
                    "image": dict(image), "startedAt": lobby.memory.started_at,
                    "endsAt": lobby.memory.ends_at,
                    "durationSeconds": lobby.memory.duration_seconds,
                }, lobby.id),
            )
            await manager.broadcast_to_players(
                code,
                event(EventType.MEMORY_PHASE_STARTED, {
                    "imageName": image["name"], "startedAt": lobby.memory.started_at,
                    "endsAt": lobby.memory.ends_at,
                    "durationSeconds": lobby.memory.duration_seconds,
                }, lobby.id),
            )

    async def begin_puzzle(self, code: str) -> None:
        lobby = self.get(code)
        async with self._lock(lobby):
            if lobby.status == GameState.PUZZLE:
                return
            if GameState.PUZZLE not in VALID_TRANSITIONS[lobby.status]:
                raise GameError("INVALID_STATE", "Invalid transition to PUZZLE", 409)
            self._cancel_timers(lobby)
            lobby.status = GameState.PUZZLE
            lobby.puzzle_started_at = now_ms()
            total = lobby.grid_cols * lobby.grid_rows
            for p in lobby.players:
                p.puzzle = PuzzleInstance(
                    board=generate_shuffled_board(total),
                    started_at=lobby.puzzle_started_at,
                )
            await manager.broadcast(
                code,
                event(EventType.PUZZLE_STARTED, {
                    "startedAt": lobby.puzzle_started_at,
                    "gridCols": lobby.grid_cols,
                    "gridRows": lobby.grid_rows,
                    "players": [self._progress(p) for p in lobby.players],
                }, lobby.id),
            )
            for p in lobby.players:
                await manager.send_to_player(
                    code, p.id,
                    event(EventType.PUZZLE_STARTED, {
                        "board": list(p.puzzle.board), "moves": 0,
                        "startedAt": lobby.puzzle_started_at,
                        "gridCols": lobby.grid_cols, "gridRows": lobby.grid_rows,
                    }, lobby.id),
                )

    async def apply_swap(
        self, code: str, player_id: str, token: str, frm: int, to: int
    ) -> None:
        lobby = self.get(code)
        async with self._lock(lobby):
            player = self._find(lobby, player_id)
            if not player:
                raise GameError("NOT_FOUND", "Player not found.", 404)
            if not constant_time_eq(token, player.token):
                raise GameError("FORBIDDEN", "Invalid player token.", 403)
            if lobby.status != GameState.PUZZLE:
                raise GameError("INVALID_STATE", "The puzzle is not active.", 409)
            puzzle = player.puzzle
            if not puzzle or puzzle.completed:
                raise GameError("INVALID_STATE", "No active puzzle for player.", 409)
            total = lobby.grid_cols * lobby.grid_rows
            if not (0 <= frm < total and 0 <= to < total):
                raise GameError("BAD_REQUEST", "Invalid puzzle index.", 422)
            if frm == to:
                return
            puzzle.board = swap_pieces(puzzle.board, frm, to)
            puzzle.moves += 1
            solved = is_solved(puzzle.board)
            if solved:
                puzzle.completed = True
                puzzle.completed_at = now_ms()
                await manager.send_to_player(
                    code, player.id,
                    event(EventType.PUZZLE_MOVE, {
                        "board": list(puzzle.board), "moves": puzzle.moves,
                        "correctSlots": correct_slots(puzzle.board), "completed": True,
                    }, lobby.id),
                )
                await manager.broadcast(
                    code,
                    event(EventType.PLAYER_COMPLETED,
                          {"playerId": player.id, "at": puzzle.completed_at}, lobby.id),
                )
                await self._finish(lobby, player)
                return
            await manager.send_to_player(
                code, player.id,
                event(EventType.PUZZLE_MOVE, {
                    "board": list(puzzle.board), "moves": puzzle.moves,
                    "correctSlots": correct_slots(puzzle.board), "completed": False,
                }, lobby.id),
            )
            await manager.send_to_host(
                code,
                event(EventType.PUZZLE_MOVE, {
                    "playerId": player.id, "moves": puzzle.moves,
                    "correctCount": sum(correct_slots(puzzle.board)),
                }, lobby.id),
            )

    async def _finish(self, lobby: Lobby, winner: Player) -> None:
        if lobby.status == GameState.FINISHED:  # atomic: only one winner
            return
        if GameState.FINISHED not in VALID_TRANSITIONS[lobby.status]:
            raise GameError("INVALID_STATE", "Invalid transition to FINISHED", 409)
        lobby.status = GameState.FINISHED
        lobby.winner_id = winner.id
        lobby.finished_at = now_ms()
        winner.score += 1
        self._cancel_timers(lobby)
        await manager.broadcast(lobby.code,
                                event(EventType.GAME_FINISHED, self._result(lobby), lobby.id))

    async def play_again(self, code: str, host_token: str) -> None:
        lobby = self.get(code)
        async with self._lock(lobby):
            self._assert_host(lobby, host_token)
            if GameState.MEMORY not in VALID_TRANSITIONS[lobby.status]:
                raise GameError("INVALID_STATE", "Cannot replay from this state", 409)
            self._cancel_timers(lobby)
            for p in lobby.players:
                p.puzzle = None
            self._enter_memory(lobby)
            await manager.broadcast(
                code, event(EventType.NEW_GAME, {"status": GameState.MEMORY.value}, lobby.id)
            )
            image = lobby.memory.image  # type: ignore[union-attr]
            await manager.send_to_host(
                code, event(EventType.MEMORY_PHASE_STARTED, {
                    "image": dict(image),
                    "startedAt": lobby.memory.started_at,
                    "endsAt": lobby.memory.ends_at,
                    "durationSeconds": lobby.memory.duration_seconds,
                }, lobby.id),
            )
            await manager.broadcast_to_players(
                code, event(EventType.MEMORY_PHASE_STARTED, {
                    "imageName": image["name"],
                    "startedAt": lobby.memory.started_at,
                    "endsAt": lobby.memory.ends_at,
                    "durationSeconds": lobby.memory.duration_seconds,
                }, lobby.id),
            )

    async def back_to_lobby(self, code: str, host_token: str) -> None:
        lobby = self.get(code)
        async with self._lock(lobby):
            self._assert_host(lobby, host_token)
            if GameState.LOBBY not in VALID_TRANSITIONS[lobby.status]:
                raise GameError("INVALID_STATE", "Cannot return to lobby", 409)
            self._cancel_timers(lobby)
            lobby.status = GameState.LOBBY
            lobby.memory = None
            lobby.puzzle_started_at = None
            lobby.winner_id = None
            lobby.finished_at = None
            for p in lobby.players:
                p.puzzle = None
            await manager.broadcast(
                code, event(EventType.NEW_GAME, {"status": GameState.LOBBY.value}, lobby.id)
            )
            await manager.broadcast(
                code, event(EventType.LOBBY_UPDATED, {
                    "players": [self.public_player(p) for p in lobby.players],
                    "status": lobby.status.value,
                }, lobby.id),
            )


game_service = GameService()
