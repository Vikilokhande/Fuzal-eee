"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[APP_ERROR_BOUNDARY]", error);
  }, [error]);

  return (
    <div className="flex min-h-[100dvh] w-full flex-col items-center justify-center p-4 text-center">
      <div className="glass max-w-sm p-8 text-center">
        <div className="text-5xl">⚡</div>
        <h2 className="mt-4 font-display text-xl font-bold text-white">
          Game Interrupted
        </h2>
        <p className="mt-2 text-sm text-indigo-100/70">
          A temporary network or connection glitch occurred. Your game session is preserved.
        </p>
        <div className="mt-6 flex flex-col gap-3">
          <button
            type="button"
            className="btn-primary w-full"
            onClick={() => reset()}
          >
            Resume Game
          </button>
          <button
            type="button"
            className="btn-secondary w-full"
            onClick={() => window.location.reload()}
          >
            Refresh
          </button>
        </div>
      </div>
    </div>
  );
}
