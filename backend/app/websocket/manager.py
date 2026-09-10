"""ConnectionManager — per-lobby WebSocket fan-out.

Subscriber ids: ``host:<code>`` for the big screen, the player id for phones.
Reconnecting with the same id replaces the dead socket.
"""
from __future__ import annotations

import asyncio
import json
from collections import defaultdict
from typing import Any

from fastapi import WebSocket


class ConnectionManager:
    def __init__(self) -> None:
        # code -> {subscriber_id: WebSocket}
        self._channels: dict[str, dict[str, WebSocket]] = defaultdict(dict)
        self._lock = asyncio.Lock()

    async def connect(self, code: str, subscriber_id: str, ws: WebSocket) -> None:
        await ws.accept()
        async with self._lock:
            self._channels[code][subscriber_id] = ws

    def disconnect(self, code: str, subscriber_id: str) -> None:
        self._channels.get(code, {}).pop(subscriber_id, None)

    @staticmethod
    def host_id(code: str) -> str:
        return f"host:{code}"

    async def _deliver(
        self, code: str, predicate, event: dict[str, Any]
    ) -> None:
        frame = json.dumps(event)
        dead: list[str] = []
        for sub_id, ws in list(self._channels.get(code, {}).items()):
            if not predicate(sub_id):
                continue
            try:
                await ws.send_text(frame)
            except Exception:  # broken socket
                dead.append(sub_id)
        for sub_id in dead:
            self.disconnect(code, sub_id)

    async def broadcast(self, code: str, event: dict[str, Any]) -> None:
        await self._deliver(code, lambda _id: True, event)

    async def broadcast_to_players(self, code: str, event: dict[str, Any]) -> None:
        await self._deliver(code, lambda i: not i.startswith("host:"), event)

    async def send_to_host(self, code: str, event: dict[str, Any]) -> None:
        await self._deliver(code, lambda i: i.startswith("host:"), event)

    async def send_to_player(
        self, code: str, player_id: str, event: dict[str, Any]
    ) -> None:
        await self._deliver(code, lambda i: i == player_id, event)


manager = ConnectionManager()
