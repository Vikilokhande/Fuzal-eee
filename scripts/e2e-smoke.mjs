/*
 * Fuzal end-to-end smoke test against a running server.
 *   BASE=http://127.0.0.1:3000 node scripts/e2e-smoke.mjs
 * Start the server first, e.g. FUZAL_MEMORY_SECONDS=6 npm run start
 */
const BASE = process.env.BASE ?? "http://127.0.0.1:3100";

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const assert = (cond, msg) => {
  if (!cond) {
    console.error("ASSERT FAIL:", msg);
    process.exit(1);
  }
};

async function openSSE(url, onFrame) {
  const res = await fetch(url, { headers: { Accept: "text/event-stream" } });
  if (!res.ok || !res.body) throw new Error("SSE connect failed " + res.status);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const line = chunk.split("\n").find((l) => l.startsWith("data:"));
      if (line) onFrame(JSON.parse(line.slice(5).trim()));
    }
  }
}

const waitFor = async (check, label, timeout = 20000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const r = check();
    if (r) return r;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("timeout waiting for " + label);
};

const frames = { host: [], players: [] };

// 1. Create lobby
const create = await (await fetch(`${BASE}/api/lobbies`, { method: "POST", body: "{}" })).json();
log("lobby", create.lobbyId, "grid", create.gridCols);
const code = create.code;

// 2. Host SSE
openSSE(
  `${BASE}/api/lobbies/${code}/events?kind=host&t=${create.hostToken}`,
  (f) => frames.host.push(f),
).catch((e) => log("host sse", e.message));

// 3. Join 5 players + SSE
const players = [];
const names = ["Chiku", "Aarav", "Mira", "Kabir", "Zara"];
for (let i = 0; i < 5; i++) {
  const r = await fetch(`${BASE}/api/lobbies/${code}/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: names[i] }),
  });
  assert(r.ok, "join " + i + " status " + r.status);
  const j = await r.json();
  players.push(j.player);
  frames.players[i] = [];
  const idx = i;
  openSSE(
    `${BASE}/api/lobbies/${code}/events?kind=player&p=${j.player.id}&t=${j.player.token}`,
    (f) => frames.players[idx].push(f),
  ).catch((e) => log("p sse", e.message));
}
await new Promise((r) => setTimeout(r, 600));

// 4. Sixth player rejected
const sixth = await fetch(`${BASE}/api/lobbies/${code}/join`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: "Latecomer" }),
});
assert(sixth.status === 409, "sixth player should be 409 got " + sixth.status);
log("6th join rejected:", (await sixth.json()).message);

const bad = await fetch(`${BASE}/api/lobbies/NOPE`);
assert(bad.status === 404, "nonexistent lobby should 404");

// 5. Host starts
const start = await fetch(`${BASE}/api/lobbies/${code}/actions`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ type: "START_GAME", token: create.hostToken }),
});
assert(start.ok, "start failed");
log("game started — memory phase");

await waitFor(() => frames.host.some((f) => f.type === "MEMORY_PHASE_STARTED"), "host memory");
const hostMem = frames.host.find((f) => f.type === "MEMORY_PHASE_STARTED");
const p0Mem = frames.players[0].find((f) => f.type === "MEMORY_PHASE_STARTED");
assert(hostMem.payload.image?.url, "host must get image url");
assert(!p0Mem.payload.image, "player must NOT get image url");
log("anti-cheat OK; image:", hostMem.payload.image.name);

await waitFor(
  () => frames.host.filter((f) => f.type === "MEMORY_TIMER_UPDATED").length >= 2,
  "timer ticks",
);
log("timer ticks:", frames.host.filter((f) => f.type === "MEMORY_TIMER_UPDATED").length);

// 6. PUZZLE with personal boards
await waitFor(
  () =>
    frames.players.every((arr) =>
      arr.some((f) => f.type === "PUZZLE_STARTED" && Array.isArray(f.payload.board)),
    ),
  "personal puzzles",
  15000,
);
const boards = players.map((_, i) =>
  frames.players[i]
    .find((f) => f.type === "PUZZLE_STARTED" && Array.isArray(f.payload.board))
    .payload.board.slice(),
);
log("puzzles received; all distinct:", new Set(boards.map((b) => b.join())).size === boards.length);
assert(new Set(boards.map((b) => b.join())).size === boards.length, "boards must differ per player");
assert(boards.every((b) => b.some((x, i) => x !== i)), "boards must be shuffled");

// Piece crop endpoint
const pieceOk = await fetch(
  `${BASE}/api/lobbies/${code}/piece/0?p=${players[0].id}&t=${players[0].token}`,
);
assert(
  pieceOk.ok && (await pieceOk.text()).includes('viewBox="0 0 200 200"'),
  "piece crop should expose a 200x200 viewBox",
);
const pieceBad = await fetch(
  `${BASE}/api/lobbies/${code}/piece/0?p=${players[0].id}&t=wrong`,
);
assert(pieceBad.status === 403, "piece with bad token must be 403");
log("piece cropping + auth OK");

// 7. Solve player 0 locally with selection-sort, send each swap to server
const board = [...boards[0]];
const swaps = [];
for (let slot = 0; slot < board.length; slot++) {
  if (board[slot] === slot) continue;
  const j = board.indexOf(slot);
  swaps.push([slot, j]);
  [board[slot], board[j]] = [board[j], board[slot]];
}
assert(board.every((x, i) => x === i), "local solve failed");
for (const [from, to] of swaps) {
  const r = await fetch(`${BASE}/api/lobbies/${code}/actions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "SWAP",
      token: players[0].token,
      playerId: players[0].id,
      from,
      to,
    }),
  });
  assert(r.ok, "swap " + from + "," + to + " failed " + r.status);
  await new Promise((r) => setTimeout(r, 30));
}

// 8. Winner
await waitFor(() => frames.host.some((f) => f.type === "GAME_FINISHED"), "game finished");
const finish = frames.host.find((f) => f.type === "GAME_FINISHED");
log("WINNER:", finish.payload.winner.name, "time", finish.payload.durationMs + "ms");
assert(finish.payload.winner.name === "Chiku", "Chiku must be winner");
await waitFor(() => frames.players[1].some((f) => f.type === "GAME_FINISHED"), "phone finish");
const late = await fetch(`${BASE}/api/lobbies/${code}/actions`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    type: "SWAP",
    token: players[1].token,
    playerId: players[1].id,
    from: 0,
    to: 1,
  }),
});
assert(late.status === 409, "swap after finish must be 409");

// 9. Play again
const again = await fetch(`${BASE}/api/lobbies/${code}/actions`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ type: "PLAY_AGAIN", token: create.hostToken }),
});
assert(again.ok, "play again failed");
await waitFor(() => frames.host.some((f) => f.type === "NEW_GAME"), "new game event");
await waitFor(
  () => frames.host.filter((f) => f.type === "MEMORY_PHASE_STARTED").length >= 2,
  "second memory phase",
);
log("PLAY AGAIN OK — new round started");

console.log("\n✅ END-TO-END SMOKE TEST PASSED");
process.exit(0);
