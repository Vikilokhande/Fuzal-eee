"""Pydantic models, dataclasses and the explicit game state machine."""
from __future__ import annotations

import enum
from dataclasses import dataclass, field
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator


class GameState(str, enum.Enum):
    LOBBY = "LOBBY"
    MEMORY = "MEMORY"
    PUZZLE = "PUZZLE"
    FINISHED = "FINISHED"


class PlayerConnection(str, enum.Enum):
    CONNECTED = "CONNECTED"
    DISCONNECTED = "DISCONNECTED"


# LOBBY → MEMORY → PUZZLE → FINISHED → (LOBBY | MEMORY)
VALID_TRANSITIONS: dict[GameState, set[GameState]] = {
    GameState.LOBBY: {GameState.MEMORY},
    GameState.MEMORY: {GameState.PUZZLE},
    GameState.PUZZLE: {GameState.FINISHED},
    GameState.FINISHED: {GameState.LOBBY, GameState.MEMORY},
}


class EventType(str, enum.Enum):
    SNAPSHOT = "SNAPSHOT"
    ERROR = "ERROR"
    PLAYER_JOINED = "PLAYER_JOINED"
    PLAYER_LEFT = "PLAYER_LEFT"
    PLAYER_STATUS = "PLAYER_STATUS"
    LOBBY_UPDATED = "LOBBY_UPDATED"
    GAME_STARTED = "GAME_STARTED"
    MEMORY_PHASE_STARTED = "MEMORY_PHASE_STARTED"
    MEMORY_TIMER_UPDATED = "MEMORY_TIMER_UPDATED"
    PUZZLE_STARTED = "PUZZLE_STARTED"
    PUZZLE_MOVE = "PUZZLE_MOVE"
    PLAYER_COMPLETED = "PLAYER_COMPLETED"
    GAME_FINISHED = "GAME_FINISHED"
    NEW_GAME = "NEW_GAME"


@dataclass
class PuzzleInstance:
    board: list[int]
    moves: int = 0
    started_at: float = 0.0
    completed: bool = False
    completed_at: Optional[float] = None


@dataclass
class Player:
    id: str
    name: str
    token: str
    joined_at: float
    slot: int
    connection_status: PlayerConnection = PlayerConnection.CONNECTED
    score: int = 0
    puzzle: Optional[PuzzleInstance] = None


@dataclass
class MemoryPhase:
    image: dict
    started_at: float
    ends_at: float
    duration_seconds: int


@dataclass
class Lobby:
    id: str
    code: str
    host_token: str
    max_players: int
    grid_cols: int
    grid_rows: int
    status: GameState = GameState.LOBBY
    players: list[Player] = field(default_factory=list)
    memory: Optional[MemoryPhase] = None
    puzzle_started_at: Optional[float] = None
    winner_id: Optional[str] = None
    finished_at: Optional[float] = None
    used_image_ids: list[str] = field(default_factory=list)
    timer_tasks: dict[str, object] = field(default_factory=dict)
    disconnect_tasks: dict[str, object] = field(default_factory=dict)


# ---------------------------------------------------------------- request DTOs


class CreateLobbyRequest(BaseModel):
    grid_cols: Optional[int] = Field(default=None, ge=3, le=6)
    grid_rows: Optional[int] = Field(default=None, ge=3, le=6)
    memory_seconds: Optional[int] = Field(default=None, ge=5, le=120)


class JoinRequest(BaseModel):
    name: str = Field(min_length=1, max_length=16)

    @field_validator("name")
    @classmethod
    def name_charset(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Please enter your name")
        return v


class ActionRequest(BaseModel):
    type: Literal["START_GAME", "SWAP", "PLAY_AGAIN", "BACK_TO_LOBBY"]
    token: str = Field(min_length=10)
    player_id: Optional[str] = None
    frm: Optional[int] = Field(default=None, alias="from", ge=0, le=35)
    to: Optional[int] = Field(default=None, ge=0, le=35)

    model_config = {"populate_by_name": True}
