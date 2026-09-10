"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Wordmark, Logo } from "@/components/Brand";
import { createLobby, sessionStore } from "@/lib/fuzal/api";

export default function LandingPage() {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function hostGame() {
    setCreating(true);
    setError(null);
    try {
      const lobby = await createLobby();
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

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 py-14">
      <div className="fz-grid-bg absolute inset-0" aria-hidden />
      <div className="relative flex flex-col items-center gap-10 text-center">
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
            <>🎮 Host a Game</>
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
