# Fuzal — FastAPI backend

Authoritative Python game server for Fuzal, using **FastAPI**, native
**WebSockets**, **Pydantic v2** and in-memory game state behind service
classes that can be re-backed by Redis/PostgreSQL.

```
backend/
├── app/
│   ├── main.py                     # FastAPI app, CORS, static /images mount
│   ├── config.py                   # env-driven Settings (FUZAL_* prefix)
│   ├── api/
│   │   ├── health.py               # GET /api/health
│   │   ├── lobby.py                # create / public view / join
│   │   └── game.py                 # actions, cropped piece, WebSocket route
│   ├── models/schemas.py           # Pydantic DTOs, dataclasses, state machine
│   ├── services/
│   │   ├── image_service.py        # ImageService.get_random_image()
│   │   ├── puzzle_service.py       # shuffle / solved / swap helpers
│   │   └── game_service.py         # LobbyService + GameService (authority)
│   └── websocket/manager.py        # ConnectionManager (lobby channels)
├── images/                         # puzzle images (SVG, 800×800)
├── tests/test_game.py              # pytest engine suite
└── requirements.txt
```

## Run

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

- OpenAPI docs & event try-out: <http://localhost:8000/docs>
- Health: <http://localhost:8000/api/health>

### Configuration

| Env var | Default | Meaning |
 | --- | --- | --- |
| `FUZAL_MAX_PLAYERS` | 5 | Hard cap per lobby |
| `FUZAL_MEMORY_SECONDS` | 30 | Memory phase length |
| `FUZAL_GRID_COLS` / `FUZAL_GRID_ROWS` | 4 / 4 | Puzzle grid (3–6) |
| `FUZAL_DISCONNECT_GRACE_MS` | 8000 | Grace before a lobby seat is freed |
| `FUZAL_CORS_ORIGINS` | `["*"]` | Allowed browser origins (JSON list) |

## REST

| Endpoint | Description |
 | --- | --- |
| `POST /api/lobbies` | Create lobby → `{code, lobbyId, hostToken, ...}` |
| `GET  /api/lobbies/{code}` | Sanitized public lobby state |
| `POST /api/lobbies/{code}/join` | Body `{"name": "Chiku"}` → player identity + token |
| `POST /api/lobbies/{code}/actions` | `START_GAME`, `SWAP`, `PLAY_AGAIN`, `BACK_TO_LOBBY` |
| `GET  /api/lobbies/{code}/piece/{n}?p=&t=` | Single cropped SVG piece (puzzle only, token-gated) |

## WebSocket

```
ws://host:8000/ws/lobby/{code}?kind=host&t=<hostToken>
ws://host:8000/ws/lobby/{code}?kind=player&p=<playerId>&t=<playerToken>
```

On connect the server sends a role-specific `SNAPSHOT`, then the live event
stream documented in the root `README.md`
(`PLAYER_JOINED`, `LOBBY_UPDATED`, `MEMORY_PHASE_STARTED`,
`MEMORY_TIMER_UPDATED`, `PUZZLE_STARTED`, `PUZZLE_MOVE`, `PLAYER_COMPLETED`,
`GAME_FINISHED`, `NEW_GAME`, `ERROR`).

Clients may send actions as JSON text frames:

```json
{ "type": "SWAP", "token": "<playerToken>", "player_id": "p_…", "from": 0, "to": 7 }
```

`START_GAME` / `PLAY_AGAIN` / `BACK_TO_LOBBY` require the host token. Winner
status messages from clients are ignored — only the server determines the
winner (the first board that validates under the per-lobby lock).

## Pairing with a React/Vite client

The reference client speaks exactly this protocol over WebSocket:

1. `POST /api/lobbies` on the host screen.
2. QR code encodes `https://<frontend>/join/{code}`.
3. Phones `POST /api/lobbies/{code}/join`, then open the WebSocket.
4. Render puzzle tiles from
   `${BACKEND}/api/lobbies/{code}/piece/{pieceId}?p=&t=`.
5. Vite dev: set `server.proxy` for `/api` and `/ws` to `:8000`.

## Tests

```bash
pytest          # 12 engine tests incl. cap, shuffles, atomic winner, replay, reconnect
```
