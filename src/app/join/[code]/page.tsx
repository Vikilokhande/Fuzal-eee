"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Wordmark } from "@/components/Brand";
import { Avatar } from "@/components/PlayerList";
import {
  getLobby,
  joinLobby,
  sessionStore,
  type JoinedPlayer,
} from "@/lib/fuzal/api";

interface PublicLobby {
  code: string;
  status: string;
  maxPlayers: number;
  playerCount: number;
  players: { id: string; name: string; connected: boolean; slot: number }[];
  started: boolean;
  full: boolean;
}

export default function JoinPage() {
  const params = useParams<{ code: string }>();
  const code = String(params.code).toUpperCase();
  const router = useRouter();

  const [lobby, setLobby] = useState<PublicLobby | null>(null);
  const [phase, setPhase] = useState<
    "loading" | "form" | "notfound" | "full" | "started" | "joining" | "error"
  >("loading");
  const [name, setName] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const existing = useRef(sessionStore.get<{ player: JoinedPlayer }>(`player:${code}`));

  const poll = useCallback(async () => {
    try {
      const data = (await getLobby(code)) as PublicLobby;
      setLobby(data);
      setPhase((p) => (p === "loading" || p === "form" || p === "full" ? "form" : p));
    } catch {
      setPhase((p) => (p === "joining" ? p : "notfound"));
    }
  }, [code]);

  useEffect(() => {
    void poll();
    const id = setInterval(() => void poll(), 2500);
    return () => clearInterval(id);
  }, [poll]);

  // If the lobby starts before this player joins, block entry.
  useEffect(() => {
    if (lobby?.started) setPhase("started");
    else if (lobby?.full && phase !== "joining") setPhase("full");
    else if (lobby && !lobby.started && !lobby.full && (phase === "full" || phase === "started")) {
      setPhase("form");
    }
  }, [lobby, phase]);

  async function doJoin(e?: React.FormEvent) {
    e?.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setErrorMsg("Please enter your name");
      return;
    }
    setPhase("joining");
    setErrorMsg(null);
    try {
      const { player } = await joinLobby(code, trimmed);
      sessionStore.set(`player:${code}`, { player });
      router.replace(`/play/${code}?p=${player.id}&t=${player.token}&n=${encodeURIComponent(player.name)}`);
    } catch (err) {
      const msg = (err as Error).message;
      setErrorMsg(msg);
      if (msg.includes("full")) setPhase("full");
      else if (msg.includes("started")) setPhase("started");
      else setPhase("error");
    }
  }

  function resume() {
    const s = existing.current;
    if (s) {
      router.replace(`/play/${code}?p=${s.player.id}&t=${s.player.token}&n=${encodeURIComponent(s.player.name)}`);
    }
  }

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center px-5 py-10">
      <div className="fz-grid-bg absolute inset-0" aria-hidden />
      <div className="relative w-full max-w-sm">
        <div className="mb-7 flex justify-center">
          <Wordmark size={40} />
        </div>

        {phase === "loading" && <Card>
          <div className="flex flex-col items-center gap-4 py-8">
            <span className="h-10 w-10 animate-spin rounded-full border-4 border-cyan-300 border-t-transparent" />
            <p className="text-indigo-100/80">Finding game <b className="text-white">{code}</b>…</p>
          </div>
        </Card>}

        {phase === "notfound" && <Card>
          <div className="text-center text-6xl">🚫</div>
          <h2 className="mt-3 text-center font-display text-3xl font-bold text-white">Lobby not found</h2>
          <p className="mt-2 text-center text-indigo-100/70">
            No Fuzal game with code <b>{code}</b>. Check the QR code or ask the host for a new one.
          </p>
        </Card>}

        {phase === "full" && <Card>
          <div className="text-center text-6xl">🧩</div>
          <h2 className="mt-3 text-center font-display text-3xl font-bold text-white">Lobby Full</h2>
          <p className="mt-3 text-center text-indigo-100/80">
            This Fuzal game already has <b>5 players</b>.
            <br />Please wait for the next game.
          </p>
          {existing.current && (
            <button className="btn-ghost mt-5 w-full" onClick={resume}>
              Rejoin as {existing.current.player.name}
            </button>
          )}
        </Card>}

        {phase === "started" && <Card>
          <div className="text-center text-6xl">⏱️</div>
          <h2 className="mt-3 text-center font-display text-3xl font-bold text-white">
            Game already started
          </h2>
          <p className="mt-3 text-center text-indigo-100/80">
            This round is in progress. Wait for the host to start the next game.
          </p>
          {existing.current && (
            <button className="btn-primary mt-5 w-full" onClick={resume}>
              Resume my game
            </button>
          )}
        </Card>}

        {(phase === "form" || phase === "joining" || phase === "error") && lobby && (
          <Card>
            <h2 className="text-center font-display text-3xl font-bold text-white">Join Game</h2>
            <p className="mt-1 text-center text-sm uppercase tracking-[0.3em] text-cyan-300">
              {code} · {lobby.playerCount}/{lobby.maxPlayers} joined
            </p>

            {lobby.playerCount > 0 && (
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                {lobby.players.map((p) => (
                  <div key={p.id} className="flex items-center gap-2 rounded-full bg-white/5 py-1 pl-1 pr-3">
                    <Avatar name={p.name} slot={p.slot} size="sm" connected={p.connected} />
                    <span className="text-sm font-semibold text-white">{p.name}</span>
                  </div>
                ))}
              </div>
            )}

            <form onSubmit={doJoin} className="mt-6 grid gap-4">
              <label className="text-sm font-semibold text-indigo-100/80">
                Enter your name
                <input
                  autoFocus
                  value={name}
                  maxLength={16}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Chiku"
                  className="mt-2 w-full rounded-2xl border border-white/15 bg-black/40 px-5 py-4 text-xl font-bold text-white outline-none placeholder:text-white/30 focus:border-cyan-300/70 focus:ring-2 focus:ring-cyan-300/30"
                />
              </label>
              {errorMsg && <p className="text-center text-sm text-rose-300">{errorMsg}</p>}
              <button type="submit" disabled={phase === "joining"} className="btn-primary w-full text-xl">
                {phase === "joining" ? (
                  <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-900 border-t-transparent" />
                ) : (
                  "JOIN GAME"
                )}
              </button>
            </form>

            {existing.current && (
              <button onClick={resume} className="mt-3 w-full text-center text-sm text-cyan-300 underline">
                Resume as {existing.current.player.name}
              </button>
            )}
          </Card>
        )}
      </div>
    </main>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="glass animate-slide-up p-7">{children}</div>;
}
