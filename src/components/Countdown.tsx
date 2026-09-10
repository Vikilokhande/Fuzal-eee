"use client";

export function Countdown({
  seconds,
  caption,
  size = "xl",
  danger = false,
}: {
  seconds: number;
  caption?: string;
  size?: "lg" | "xl";
  danger?: boolean;
}) {
  const dims = size === "xl" ? "text-[9rem] md:text-[13rem]" : "text-8xl md:text-9xl";
  return (
    <div className="flex flex-col items-center">
      <div className="relative grid place-items-center">
        <div
          className={`absolute h-56 w-56 rounded-full blur-3xl md:h-72 md:w-72 ${
            danger ? "bg-rose-500/30" : "bg-indigo-500/30"
          }`}
        />
        <span
          key={seconds}
          className={`animate-count relative font-display font-bold leading-none ${dims} ${
            danger ? "text-rose-300" : "neon-text"
          }`}
        >
          {seconds}
        </span>
      </div>
      {caption && (
        <p className="mt-2 text-center text-sm font-semibold uppercase tracking-[0.35em] text-indigo-200/70">
          {caption}
        </p>
      )}
    </div>
  );
}

/** Full-screen "GO!" flash when the puzzle starts. */
export function GoFlash() {
  return (
    <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center">
      <span className="animate-go font-display text-8xl font-bold neon-text md:text-9xl">
        GO!
      </span>
    </div>
  );
}
