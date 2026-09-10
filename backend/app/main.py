"""Fuzal FastAPI application.

Run locally:
    uvicorn app.main:app --reload --port 8000
"""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.game import router as game_router, ws_router
from app.api.health import router as health_router
from app.api.lobby import router as lobby_router
from app.config import settings

app = FastAPI(
    title="Fuzal — Real-Time Multiplayer Puzzle",
    version="1.0.0",
    description="Authoritative game server: lobbies, WebSocket sync, "
    "server timers, puzzle validation and atomic winner detection.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router)
app.include_router(lobby_router)
app.include_router(game_router)
app.include_router(ws_router)

settings.images_dir.mkdir(parents=True, exist_ok=True)
app.mount(
    "/images",
    StaticFiles(directory=str(settings.images_dir)),
    name="images",
)


@app.get("/", tags=["health"])
async def root() -> dict[str, str]:
    return {"name": "Fuzal API", "docs": "/docs", "websocket": "/ws/lobby/{code}"}
