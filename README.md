# 🧩 FUZAL — Real-Time Multiplayer Image Puzzle

**Scan. Memorize. Solve.** Fuzal is a party game for live events: one big screen
(TV / projector / laptop) hosts the game, and up to **5 players** join
instantly from their phone browsers by scanning a QR code — no app install.

```
LOBBY → PLAYERS JOIN (max 5) → HOST STARTS → 30s MEMORY PHASE
      → IMAGE HIDDEN → 16 SHUFFLED PIECES (4×4) → TAP TO SOLVE
      → FIRST CORRECT PLAYER WINS → PLAY AGAIN / NEW LOBBY
```

---

## 🏗️ Architecture & the two runtimes

This repository contains **two complete, production-shaped implementations of
the same game protocol**:

| Layer | Deployed app (this repo's root) | Reference service (`backend/`) |
| --- | --- | --- |
| Frontend | **React 19 + Next.js App Router + Tailwind v4** — host, join and mobile player pages | Pairs with any React/Vite client (same protocol) |
| Backend | **Next.js Route Handlers** (Node runtime), service layer under `src/lib/game` | **Python · FastAPI · native WebSockets** (`backend/app`) |
| Real-time | **Server-Sent Events** (socket-style client with auto-reconnect) | **WebSocket** `/ws/lobby/{code}` |
| Validation | Zod (Pydantic-equivalent models) | Pydantic v2 |
| State | In-memory, behind a swappable `LobbyRepository` interface (Redis/Postgres-ready) | Same design, in-memory services |

The game *engine* (state machine, timer, shuffle, validation, atomic winner) is
a 1:1 port between the two — same event names, same payload shapes, same
rules. The live preview uses the Next.js fullstack app; `backend/` is the
explicit **Python/FastAPI** deliverable requested in the spec and can run the
game on its own with a static/Vite frontend.

### Why SSE in the Next.js app?
Raw WebSocket upgrades aren't exposed by managed Next.js route handlers.
Server-Sent Events provide identical server-push semantics (lobby channels,
targeted fan-out, snapshot-on-reconnect) with the same client API surface
(`connect / on / reconnect`), so swapping the transport later only touches
`src/lib/fuzal/realtime.ts`.

### Project structure (deployed app)

```
src/
├── app/
│   ├── page.tsx                    # Landing → host creates a lobby
│   ├── host/[code]/page.tsx        # Big-screen lobby/memory/puzzle/winner UI
│   ├── join/[code]/page.tsx        # Phone: name entry, full/started errors
│   ├── play/[code]/page.tsx        # Phone: waiting, memory, puzzle, winner
│   └── api/
│       ├── lobbies/                # POST create / GET status / POST join
│       └── lobbies/[code]/
│           ├── events/route.ts     # SSE realtime channel (host | player)
│           ├── actions/route.ts    # START_GAME | SWAP | PLAY_AGAIN | BACK_TO_LOBBY
│           └── piece/[pieceId]/    # Anti-cheat cropped SVG piece endpoint
├── components/                     # QRCodeDisplay, PuzzleBoard, Countdown,
│                                   #   WinnerScreen, PlayerList, …
├── lib/
│   ├── game/                       # Authoritative server engine
│   │   ├── types.ts                # Zod models + state machine + events
│   │   ├── config.ts codes.ts puzzle.ts http.ts auth.ts
│   │   ├── imageService.ts         # ImageService.get_random_image()
│   │   ├── repo.ts                 # In-memory repository + per-lobby locks
│   │   ├── manager.ts              # ConnectionManager (lobby channels)
│   │   └── service.ts              # LobbyService + GameService
│   └── fuzal/                      # Client: api.ts, realtime.ts, useFuzalGame.ts
public/images/                      # 5 puzzle images (SVG, 800×800)
scripts/e2e-smoke.mjs               # Full end-to-end flow test
backend/                            # Python FastAPI implementation (see backend/README.md)
```

---

## 🚀 Quick start — Next.js fullstack app

```bash
npm install
npm run dev          # http://localhost:3000
```

1. Open `http://localhost:3000` on the big screen → **Host a Game**.
2. Scan the QR code with up to 5 phones (or open `/join/<CODE>` in browser tabs).
3. Host presses **START GAME** → 30-second memory phase → solve on phones.

Production:

```bash
npm run build && npm start
```

Configuration via environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `FUZAL_MAX_PLAYERS` | `5` | Hard player cap (enforced server-side) |
| `FUZAL_MEMORY_SECONDS` | `30` | Memory-phase length |
| `FUZAL_GRID_COLS` / `FUZAL_GRID_ROWS` | `4` / `4` | Grid size (supports 3–6) |
| `NEXT_PUBLIC_SITE_URL` | *(page origin)* | Canonical origin used inside the QR URL |

The QR code always encodes `${window.location.origin}/join/{code}` — no
hardcoded `localhost`.

---

## 🐍 Quick start — Python FastAPI backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate   # or pip install --user
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

- Interactive API docs: `http://localhost:8000/docs`
- WebSocket: `ws://localhost:8000/ws/lobby/{code}?kind=host|player&t=token&p=playerId`
- Run tests: `pytest`

Point any React/Vite client at `http://localhost:8000` (CORS is open by
default and configurable through `FUZAL_CORS_ORIGINS` as JSON). See
[`backend/README.md`](backend/README.md).

---

## 🔌 REST API

### Host

| Method & path | Body | Returns |
| --- | --- | --- |
| `POST /api/lobbies` | `{}` (optional grid config) | `{ code, lobbyId, hostToken, maxPlayers, gridCols, gridRows }` |
| `POST /api/lobbies/{code}/actions` | `{type:"START_GAME", token}` | `200/4xx` |
| `POST /api/lobbies/{code}/actions` | `{type:"PLAY_AGAIN", token}` | New round → MEMORY |
| `POST /api/lobbies/{code}/actions` | `{type:"BACK_TO_LOBBY", token}` | FINISHED → LOBBY |

### Players

| Method & path | Body | Returns |
| --- | --- | --- |
| `GET /api/lobbies/{code}` | – | Sanitized public lobby (join page) |
| `POST /api/lobbies/{code}/join` | `{name}` | `{ player:{id,name,token,score,slot}, lobby }` |
| `POST /api/lobbies/{code}/actions` | `{type:"SWAP", token, playerId, from, to}` | Server validates the swap |
| `GET /api/lobbies/{code}/piece/{pieceId}?p=&t=` | – | One cropped SVG piece (PUZZLE/FINISHED only, token-gated) |

### Realtime

- Next.js: `GET /api/lobbies/{code}/events?kind=host&t=<hostToken>` or
  `?kind=player&p=<playerId>&t=<playerToken>` → `text/event-stream`.
- FastAPI: `GET /ws/lobby/{code}` with the same query params → WebSocket.

Errors are JSON `{error, message}` with HTTP `400/403/404/409/422/500`.

---

## 📡 Real-time event protocol

Every frame: `{ "type": string, "at": <server epoch ms>, "lobbyId": "FZ-XXXX", "payload": {...} }`
The client receives a `SNAPSHOT` immediately on connect/reconnect, then live
events.

| Event | Who gets it | Payload / purpose |
| --- | --- | --- |
| `SNAPSHOT` | role-specific | Full catch-up state; phone never includes the full image or any correct order |
| `PLAYER_JOINED` | all | `{player}` |
| `PLAYER_LEFT` | all | `{playerId}` |
| `PLAYER_STATUS` | all | `{playerId, connected}` (disconnect/reconnect) |
| `LOBBY_UPDATED` | all | `{players, status}` |
| `GAME_STARTED` | all | host pressed start |
| `MEMORY_PHASE_STARTED` | **host gets `image.url`; phones get `imageName` only** | `{startedAt, endsAt, durationSeconds}` |
| `MEMORY_TIMER_UPDATED` | all | `{remaining, endsAt}` — clients interpolate from authoritative `endsAt` |
| `PUZZLE_STARTED` | all (progress) + **per-player personal shuffled `board`** | phones get their own independent shuffle |
| `PUZZLE_MOVE` | acting player (`board`, `moves`, `correctSlots`); host gets only `{playerId, moves, correctCount}` | arrangements never shown on host |
| `PLAYER_COMPLETED` | all | `{playerId, at}` |
| `GAME_FINISHED` | all | `{winner, durationMs, image(reveal), standings}` |
| `NEW_GAME` | all | play-again / back-to-lobby |
| `ERROR` | target | friendly `{code, message}` |

### Authoritative server rules

- **State machine:** `LOBBY → MEMORY → PUZZLE → FINISHED → (LOBBY|MEMORY)`;
  every other transition is rejected.
- **Clock:** server stores `startedAt/endsAt`; hard transition is fired by a
  server timer. Clients render the countdown from `endsAt` using a
  server-time offset sampled on every frame — local clock manipulation can't
  gain an advantage.
- **Winner:** the first solved board wins. Every mutation runs inside a
  per-lobby lock/mutex, so simultaneous completion requests are serialized and
  exactly one winner is possible. Clients can never report a win — only
  swaps are accepted, and the server re-validates each move.
- **Anti-cheat:** after the memory phase the original image is never sent to
  phones. Tiles are individual SVG crops (narrowed `viewBox`) from a
  token-gated endpoint; the solved ordering exists only on the server.

---

## 🧠 Game details

- **Puzzle:** 4×4 = 16 pieces (configurable 3×3 … 6×6). Each player gets an
  independent Fisher–Yates shuffle that is guaranteed to be non-solved and not
  trivially one swap away.
- **Controls (mobile):** tap piece A → it highlights → tap piece B → they swap.
  HTML5 drag-and-drop also works on desktop. Haptic feedback on supported
  phones. Correct pieces get a green ring; every swap animates.
- **Reconnect:** sessions (host token, player id+token) persist in
  `localStorage`. Reopening a stream replays a full snapshot and restores the
  player's board. A short grace window absorbs refreshes; dropped players show
  🔴 and keep their seat mid-game; in the lobby a long drop frees the seat.
- **After the round:** 🔁 **Play Again** (same players, new image, straight
  back to MEMORY), 👥 **Back to Lobby**, ✨ **New Lobby** (fresh code + QR).

---

## ✅ Testing

```bash
# Next.js engine — 22 unit tests (lobby, cap, state machine, timer,
# shuffle, validation, atomic winner, reconnect, replay)
npx vitest run
npm run build

# Full real flow against a running server (creates lobby, 5 joins, rejects
# the 6th, memory→puzzle over the wire, solves, winner, play-again):
FUZAL_MEMORY_SECONDS=6 npm start &
BASE=http://localhost:3000 node scripts/e2e-smoke.mjs

# FastAPI engine
cd backend && pytest
```

The E2E smoke verifies: lobby creation · 5 joins · 409 for the 6th · host-only
image during memory · server timer transitioning MEMORY→PUZZLE · distinct
per-player shuffles · token-gated cropped pieces · server-side solve
validation · winner broadcast to every screen · rejected post-finish moves ·
play-again.

---

## ☁️ Production deployment

**Next.js app** — deploy to any Node host (Vercel, Fly, Render, a container):

```bash
npm ci && npm run build && npm start
```

Set `NEXT_PUBLIC_SITE_URL=https://fuzal.example.com` so the QR encodes the
public HTTPS URL (phones must be able to reach that origin; WebCamera QR needs
HTTPS). In multi-instance deployments, replace the in-memory
`InMemoryLobbyRepository` + process-local `ConnectionManager` with the Redis
backed implementations behind the existing interfaces (lobby document +
pub/sub fan-out). A Postgres/Drizzle schema (`lobbies`, `players`,
`round_events`) drops in behind `LobbyRepository`.

**FastAPI service** — containerize and run
`uvicorn app.main:app --host 0.0.0.0 --port 8000` behind any ASGI server;
scale with sticky sessions or the Redis pub/sub adapter.

---

## 📦 Deliverables checklist

- [x] Complete host + mobile React UI (Tailwind, animations, confetti, GO!/countdown)
- [x] Complete authoritative backend (Next.js service layer **and** FastAPI)
- [x] QR join with 5-player cap enforced server-side (full / started / not-found states)
- [x] WebSocket-style real-time sync (SSE) + native WebSockets in FastAPI
- [x] 30s server-timed memory phase with authoritative end timestamps
- [x] Per-player independent 4×4 shuffle, tap-to-swap + drag, move validation
- [x] Atomic server-side winner detection and synchronized winner screens
- [x] Anti-cheat: no full image / no solution order on phones; cropped piece endpoint
- [x] Disconnect detection + reconnect snapshots; graceful seat handling
- [x] Play Again / Back to Lobby / New Lobby
- [x] `requirements.txt`, env example, sample images, API + event docs, tests

## ☁️ Vercel deployment — verified package

This root project is the **Next.js deployment target for Vercel**. The included
`vercel.json` uses the standard Next.js build and `npm ci` install flow.

### Vercel settings

- Framework Preset: **Next.js**
- Build Command: `npm run build`
- Install Command: `npm ci`
- Output Directory: leave the Vercel default

### Required environment variables

For the current Next.js implementation, no database variable is required for
the game itself. Optional gameplay variables are:

```text
FUZAL_MAX_PLAYERS=5
FUZAL_MEMORY_SECONDS=30
FUZAL_GRID_COLS=4
FUZAL_GRID_ROWS=4
NEXT_PUBLIC_SITE_URL=https://YOUR-VERCEL-DOMAIN.vercel.app
```

The QR code also falls back to the browser's current origin, so it remains
correct when deployed under a Vercel domain or custom domain.

### Important realtime limitation

The Next.js game state and connection manager are **process-local/in-memory**.
Vercel is therefore suitable for a demo/single-instance style deployment, but
this exact implementation should **not** be treated as horizontally-scaled
production multiplayer infrastructure. For reliable production play, move
lobby state to Redis (or another shared store) and realtime fan-out to a
WebSocket-capable service. The Python FastAPI implementation in `backend/` is
the intended authoritative WebSocket service for that architecture.
