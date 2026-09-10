"""Game actions, secure puzzle-piece crops and the realtime WebSocket."""
from __future__ import annotations

import json
import re
from pathlib import Path

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse, Response
from pydantic import ValidationError

from app.config import settings
from app.models.schemas import (
    ActionRequest,
    EventType,
    GameState,
)
from app.services.game_service import GameError, event, game_service
from app.services.image_service import SOURCE_VIEWBOX
from app.websocket.manager import manager

router = APIRouter(prefix="/api/lobbies", tags=["game"])
CODE_RE = re.compile(r"^[A-Z0-9]{4}$")
SAFE_FILE = re.compile(r"^image_\d{3}\.svg$")


def game_error(e: GameError) -> JSONResponse:
    return JSONResponse(
        status_code=e.status,
        content={"error": e.code, "message": e.message},
    )


async def _dispatch(code: str, action: ActionRequest) -> None:
    if action.type == "START_GAME":
        await game_service.start_game(code, action.token)
    elif action.type == "PLAY_AGAIN":
        await game_service.play_again(code, action.token)
    elif action.type == "BACK_TO_LOBBY":
        await game_service.back_to_lobby(code, action.token)
    elif action.type == "SWAP":
        if action.player_id is None or action.frm is None or action.to is None:
            raise GameError("BAD_REQUEST", "SWAP requires player_id, from, to.", 422)
        await game_service.apply_swap(
            code, action.player_id, action.token, action.frm, action.to
        )


@router.post("/{code}/actions")
async def post_action(code: str, action: ActionRequest):
    if not CODE_RE.match(code):
        return JSONResponse(
            status_code=400,
            content={"error": "BAD_REQUEST", "message": "Invalid game code."},
        )
    try:
        await _dispatch(code, action)
        return {"ok": True}
    except GameError as e:
        return game_error(e)


@router.get("/{code}/piece/{piece_id}")
async def get_piece(code: str, piece_id: int, p: str = "", t: str = ""):
    """Return ONLY one cropped SVG piece — the full image is never served
    to players during the puzzle."""
    try:
        lobby = game_service.get(code)
        if lobby.status not in (GameState.PUZZLE, GameState.FINISHED):
            raise GameError("INVALID_STATE", "Puzzle is not active.", 409)
        player = game_service._find(lobby, p)
        if not player or not (player.token and t and player.token == t):
            return JSONResponse(
                status_code=403,
                content={"error": "FORBIDDEN", "message": "Invalid player session."},
            )
        total = lobby.grid_cols * lobby.grid_rows
        if not 0 <= piece_id < total:
            return JSONResponse(
                status_code=400,
                content={"error": "BAD_REQUEST", "message": "Invalid piece."},
            )
        if not lobby.memory:
            raise GameError("INVALID_STATE", "No image for this round.", 409)
        file_name = Path(lobby.memory.image["url"]).name
        if not SAFE_FILE.match(file_name):
            return Response("Bad image", status_code=500)
        source = (settings.images_dir / file_name).read_text(encoding="utf-8")

        col = piece_id % lobby.grid_cols
        row = piece_id // lobby.grid_cols
        w = SOURCE_VIEWBOX / lobby.grid_cols
        h = SOURCE_VIEWBOX / lobby.grid_rows
        x, y = col * w, row * h
        cropped = re.sub(
            r'viewBox="[^"]*"',
            f'viewBox="{x} {y} {w} {h}"',
            source,
            count=1,
        ).replace(
            "<svg",
            '<svg width="100%" height="100%" preserveAspectRatio="xMidYMid slice"',
            1,
        )
        return Response(
            content=cropped,
            media_type="image/svg+xml",
            headers={"Cache-Control": "no-store"},
        )
    except GameError as e:
        return game_error(e)


ws_router = APIRouter(tags=["realtime"])


@ws_router.websocket("/ws/lobby/{code}")
async def ws_lobby(
    websocket: WebSocket,
    code: str,
    kind: str = "player",
    t: str = "",
    p: str | None = None,
):
    kind = "host" if kind == "host" else "player"
    if not CODE_RE.match(code) or (kind == "host" and len(t) < 10):
        await websocket.close(code=4400)
        return
    try:
        lobby, player = await game_service.authenticate(code, kind, t, p)
    except GameError:
        await websocket.close(code=4401)
        return

    subscriber_id = manager.host_id(code) if kind == "host" else player.id  # type: ignore[union-attr]
    await manager.connect(code, subscriber_id, websocket)
    await websocket.send_text(
        json.dumps(game_service.snapshot(lobby, kind, player))
    )
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                action = ActionRequest.model_validate_json(raw)
            except ValidationError:
                await websocket.send_text(
                    json.dumps(
                        event(EventType.ERROR, {"message": "Malformed payload."})
                    )
                )
                continue
            try:
                await _dispatch(code, action)
            except GameError as e:
                await websocket.send_text(
                    json.dumps(
                        event(
                            EventType.ERROR,
                            {"code": e.code, "message": e.message},
                            lobby.id,
                        )
                    )
                )
    except WebSocketDisconnect:
        manager.disconnect(code, subscriber_id)
        if kind == "player" and player:
            await game_service.handle_disconnect(code, player.id)
