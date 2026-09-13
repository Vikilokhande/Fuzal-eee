"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Wordmark, Logo } from "@/components/Brand";
import { createLobby, sessionStore } from "@/lib/fuzal/api";

export default function LandingPage() {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [gridSize, setGridSize] = useState<number>(3);

  async function hostGame() {
    setCreating(true);
    setError(null);
    try {
      const lobby = await createLobby({ gridSize });
      sessionStore.set(`host:${lobby.code}`, {
        token: lobby.hostToken,
        createdAt: Date.now(),
      });
      router.push(`/host/${lobby.code}`);
    } catch (e) {
      setError((e as Error).message);
      setCreating(false);
    }
  }

  const gridOptions = [
    { n: 2, label: "2×2", pieces: 4 },
    { n: 3, label: "3×3", pieces: 9 },
    { n: 4, label: "4×4", pieces: 16 },
    { n: 5, label: "5×5", pieces: 25 },
    { n: 6, label: "6×6", pieces: 36 },
    { n: 7, label: "7×7", pieces: 49 },
    { n: 8, label: "8×8", pieces: 64 },
  ];

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 py-14">
      <div className="fz-grid-bg absolute inset-0" aria-hidden />
      <div className="relative flex flex-col items-center gap-8 text-center">
        <div className="animate-slide-up flex flex-col items-center gap-5">
          <div className="animate-float">
            <Logo size={88} />
          </div>
          <Wordmark size={72} />
          <p className="max-w-xl text-lg text-indigo-100/80 md:text-xl">
            The real-time multiplayer image puzzle for live events.
            <br />
            One big screen. Up to five phones. Memorize, scramble, win.
          </p>
        </div>

        {/* Grid Size Selection: Strictly square 2x2 through 8x8 */}
        <div className="animate-slide-up flex flex-col items-center gap-2" style={{ animationDelay: "80ms" }}>
          <label className="text-xs font-bold uppercase tracking-[0.25em] text-cyan-300/80">
            Puzzle Grid Size
          </label>
          <div className="flex flex-wrap items-center justify-center gap-1.5 rounded-2xl bg-black/40 p-1.5 ring-1 ring-white/10 backdrop-blur-sm">
            {gridOptions.map((opt) => {
              const active = gridSize === opt.n;
              return (
                <button
                  key={opt.n}
                  type="button"
                  onClick={() => setGridSize(opt.n)}
                  className={`rounded-xl px-3 py-1.5 text-xs font-bold transition-all duration-150 ${
                    active
                      ? "bg-cyan-500 text-slate-950 shadow-[0_0_12px_rgba(6,182,212,0.6)] scale-[1.05]"
                      : "text-indigo-200/70 hover:text-white hover:bg-white/5"
                  }`}
                >
                  <span>{opt.label}</span>
                  <span className="ml-1 text-[10px] opacity-75">({opt.pieces})</span>
                </button>
              );
            })}
          </div>
        </div>

        <button
          onClick={hostGame}
          disabled={creating}
          className="btn-primary animate-slide-up text-xl"
          style={{ animationDelay: "120ms" }}
        >
          {creating ? (
            <>
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-900 border-t-transparent" />
              Creating lobby…
            </>
          ) : (
            <>🎮 Host a Game ({gridSize}×{gridSize})</>
          )}
        </button>
        {error && <p className="text-rose-300">{error}</p>}

        <div
          className="animate-slide-up grid max-w-3xl grid-cols-1 gap-4 sm:grid-cols-3"
          style={{ animationDelay: "220ms" }}
        >
          {[
            { icon: "📱", title: "1 · Scan to join", text: "Players scan the lobby QR with their phone — no app install." },
            { icon: "👁️", title: "2 · Memorize", text: "An image flashes on the big screen for 30 seconds." },
            { icon: "🧩", title: "3 · Solve first", text: "16 shuffled pieces on every phone. Fastest solver wins." },
          ].map((s) => (
            <div key={s.title} className="glass p-5 text-left">
              <div className="mb-2 text-3xl">{s.icon}</div>
              <p className="font-display text-lg font-bold text-white">{s.title}</p>
              <p className="mt-1 text-sm text-indigo-100/70">{s.text}</p>
            </div>
          ))}
        </div>

        <p className="text-xs uppercase tracking-[0.3em] text-indigo-200/50">
          Host view · optimized for TV &amp; projectors
        </p>
      </div>
    </main>
  );
}
