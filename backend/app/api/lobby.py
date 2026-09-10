"""REST endpoints for lobby creation, lookup and joining."""
from __future__ import annotations

import re

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.models.schemas import CreateLobbyRequest, JoinRequest
from app.services.game_service import GameError, game_service

router = APIRouter(prefix="/api/lobbies", tags=["lobby"])
CODE_RE = re.compile(r"^[A-Z0-9]{4}$")


def game_error(e: GameError) -> JSONResponse:
    return JSONResponse(
        status_code=e.status,
        content={"error": e.code, "message": e.message},
    )


@router.post("")
async def create_lobby(body: CreateLobbyRequest | None = None):
    lobby = await game_service.create_lobby(
        grid_cols=body.grid_cols if body else None,
        grid_rows=body.grid_rows if body else None,
    )
    return {
        "code": lobby.code,
        "lobbyId": lobby.id,
        "hostToken": lobby.host_token,
        "maxPlayers": lobby.max_players,
        "gridCols": lobby.grid_cols,
        "gridRows": lobby.grid_rows,
    }


@router.get("/{code}")
async def get_lobby(code: str):
    if not CODE_RE.match(code):
        return JSONResponse(
            status_code=400,
            content={"error": "BAD_REQUEST", "message": "Invalid game code."},
        )
    try:
        return game_service.public_view(game_service.get(code))
    except GameError as e:
        return game_error(e)


@router.post("/{code}/join")
async def join_lobby(code: str, body: JoinRequest):
    if not CODE_RE.match(code):
        return JSONResponse(
            status_code=400,
            content={"error": "BAD_REQUEST", "message": "Invalid game code."},
        )
    try:
        player = await game_service.join(code, body.name)
        lobby = game_service.get(code)
        return {
            "player": {
                "id": player.id,
                "name": player.name,
                "token": player.token,
                "score": player.score,
                "slot": player.slot,
            },
            "lobby": game_service.public_view(lobby),
        }
    except GameError as e:
        return game_error(e)
