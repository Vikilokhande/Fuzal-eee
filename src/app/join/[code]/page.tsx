"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Wordmark, Logo } from "@/components/Brand";
import { Avatar } from "@/components/PlayerList";
import { GameShell } from "@/components/game/GameShell";
import { GameBadge } from "@/components/game/GameBadge";
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

export default function JoinArenaPage() {
  const params = useParams<{ code: string }>();
  const code = String(params.code).toUpperCase();
  const router = useRouter();

  const [lobby, setLobby] = useState<PublicLobby | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [joining, setJoining] = useState(false);
  const [name, setName] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [existingSession] = useState(() =>
    sessionStore.get<{ player: JoinedPlayer }>(`player:${code}`),
  );

  useEffect(() => {
    let cancelled = false;
    async function fetchLobby() {
      try {
        const data = (await getLobby(code)) as PublicLobby;
        if (!cancelled) {
          setLobby(data);
          setNotFound(false);
        }
      } catch {
        if (!cancelled) {
          setNotFound(true);
        }
      }
    }
    void fetchLobby();
    const id = setInterval(() => void fetchLobby(), 2500);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [code]);

  const phase: "loading" | "form" | "notfound" | "full" | "started" | "joining" | "error" =
    (() => {
      if (joining) return "joining";
      if (notFound) return "notfound";
      if (!lobby) return "loading";
      if (lobby.started) return "started";
      if (lobby.full) return "full";
      if (errorMsg) return "error";
      return "form";
    })();

  async function doJoin(e?: React.FormEvent) {
    e?.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setErrorMsg("Please enter your player name");
      return;
    }
    setJoining(true);
    setErrorMsg(null);
    try {
      const { player } = await joinLobby(code, trimmed);
      sessionStore.set(`player:${code}`, { player });
      router.replace(
        `/play/${code}?p=${player.id}&t=${player.token}&n=${encodeURIComponent(player.name)}`,
      );
    } catch (err) {
      const msg = (err as Error).message;
      setErrorMsg(msg);
      setJoining(false);
    }
  }

  function resume() {
    if (existingSession) {
      router.replace(
        `/play/${code}?p=${existingSession.player.id}&t=${existingSession.player.token}&n=${encodeURIComponent(
          existingSession.player.name,
        )}`,
      );
    }
  }

  return (
    <GameShell maxWidth="max-w-md">
      <div className="flex w-full flex-col items-center gap-6 py-6 text-center select-none">
        {/* Brand Header */}
        <div className="flex flex-col items-center gap-3">
          <div className="animate-float">
            <Logo size={56} />
          </div>
          <Wordmark size={36} />
        </div>

        {/* LOADING STATE */}
        {phase === "loading" && (
          <div className="glass w-full p-8 flex flex-col items-center gap-4">
            <div className="flex items-center gap-3">
              <span className="h-3 w-3 animate-ping rounded-full bg-cyan-400 inline-block" />
              <p className="text-sm font-bold uppercase tracking-widest text-cyan-300">
                Connecting To Arena {code}…
              </p>
            </div>
            <p className="text-xs text-indigo-200/60">
              Verifying lobby status with server…
            </p>
          </div>
        )}

        {/* NOT FOUND */}
        {phase === "notfound" && (
          <div className="glass w-full p-8 flex flex-col items-center gap-4">
            <div className="text-5xl">🚫</div>
            <h2 className="font-display text-2xl font-bold text-white uppercase">
              Arena Not Found
            </h2>
            <p className="text-xs sm:text-sm text-indigo-200/70">
              No active FUZAL game found with code <strong className="text-cyan-300">{code}</strong>.
              Scan the QR code on the host screen again.
            </p>
          </div>
        )}

        {/* LOBBY FULL */}
        {phase === "full" && (
          <div className="glass w-full p-8 flex flex-col items-center gap-4">
            <div className="text-5xl">🛑</div>
            <h2 className="font-display text-2xl font-bold text-white uppercase">
              Arena Full
            </h2>
            <p className="text-xs sm:text-sm text-indigo-200/70">
              This game already has maximum <strong>5 players</strong>.
              Wait for the next round to begin.
            </p>
            {existingSession && (
              <button
                type="button"
                className="btn-primary w-full py-3 mt-2 font-bold"
                onClick={resume}
              >
                Re-enter as {existingSession.player.name}
              </button>
            )}
          </div>
        )}

        {/* GAME IN PROGRESS */}
        {phase === "started" && (
          <div className="glass w-full p-8 flex flex-col items-center gap-4">
            <div className="text-5xl">⏱️</div>
            <h2 className="font-display text-2xl font-bold text-white uppercase">
              Match In Progress
            </h2>
            <p className="text-xs sm:text-sm text-indigo-200/70">
              This round has already begun. Wait for the host to launch the next game.
            </p>
            {existingSession && (
              <button
                type="button"
                className="btn-primary w-full py-3 mt-2 font-bold"
                onClick={resume}
              >
                Resume My Puzzle
              </button>
            )}
          </div>
        )}

        {/* JOIN FORM */}
        {(phase === "form" || phase === "joining" || phase === "error") && lobby && (
          <div className="glass w-full p-6 sm:p-8 flex flex-col items-center gap-5 border border-cyan-500/30 shadow-[0_15px_50px_rgba(0,0,0,0.6)]">
            <GameBadge variant="ready" pulse>
              MULTIPLAYER ARENA
            </GameBadge>

            <div className="flex flex-col items-center gap-1">
              <h2 className="font-display text-3xl sm:text-4xl font-black text-white uppercase tracking-wider">
                Join The Arena
              </h2>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs uppercase tracking-widest text-indigo-200/70">
                  Game Code:
                </span>
                <span className="font-mono text-sm font-extrabold text-cyan-300 rounded-md bg-white/5 px-2 py-0.5 border border-white/10">
                  {code}
                </span>
              </div>
            </div>

            {/* Players Joined Preview Chips */}
            {lobby.playerCount > 0 && (
              <div className="flex flex-col items-center gap-2 w-full">
                <span className="text-[10px] font-bold uppercase tracking-widest text-indigo-200/60">
                  Joined Players ({lobby.playerCount}/{lobby.maxPlayers})
                </span>
                <div className="flex flex-wrap justify-center gap-1.5 w-full">
                  {lobby.players.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center gap-1.5 rounded-full bg-slate-900/80 px-2.5 py-1 border border-white/10"
                    >
                      <Avatar name={p.name} slot={p.slot} size="sm" connected={p.connected} />
                      <span className="text-xs font-semibold text-white">{p.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Player Name Form */}
            <form onSubmit={doJoin} className="flex flex-col gap-4 w-full pt-1">
              <div className="flex flex-col items-start gap-1.5 text-left w-full">
                <label
                  htmlFor="player-name-input"
                  className="text-xs font-extrabold uppercase tracking-wider text-cyan-300"
                >
                  Enter Your Player Name
                </label>
                <input
                  id="player-name-input"
                  type="text"
                  autoFocus
                  value={name}
                  maxLength={16}
                  disabled={joining}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Viki"
                  className="w-full rounded-2xl border-2 border-white/15 bg-slate-900/90 px-4 py-3.5 text-xl font-bold text-white outline-none transition-all placeholder:text-white/25 focus:border-cyan-400 focus:shadow-[0_0_20px_rgba(34,211,238,0.35)]"
                />
              </div>

              {errorMsg && (
                <div className="rounded-xl border border-rose-500/40 bg-rose-500/20 px-4 py-2 text-xs font-semibold text-rose-300">
                  {errorMsg}
                </div>
              )}

              <button
                type="submit"
                disabled={joining}
                className="btn-primary w-full py-4 text-xl font-black uppercase tracking-wider shadow-[0_8px_30px_rgba(34,211,238,0.4)]"
              >
                {joining ? (
                  <div className="flex items-center justify-center gap-2">
                    <span className="h-3 w-3 animate-ping rounded-full bg-slate-900 inline-block" />
                    <span className="text-base tracking-widest">ENTERING ARENA…</span>
                  </div>
                ) : (
                  "ENTER GAME"
                )}
              </button>
            </form>

            <p className="text-[11px] font-semibold text-indigo-200/50 uppercase tracking-wider">
              Live Event Match • Up to 5 players
            </p>

            {existingSession && (
              <button
                type="button"
                onClick={resume}
                className="text-xs text-cyan-300/80 hover:text-cyan-300 underline underline-offset-4"
              >
                Resume previous session as {existingSession.player.name}
              </button>
            )}
          </div>
        )}
      </div>
    </GameShell>
  );
}
