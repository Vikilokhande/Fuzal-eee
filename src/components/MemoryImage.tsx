"use client";

export function MemoryImage({
  src,
  name,
  secondsLeft,
}: {
  src: string;
  name?: string;
  secondsLeft: number;
}) {
  const urgent = secondsLeft <= 5;
  return (
    <div className="relative flex flex-col items-center gap-5">
      <div
        className={`relative overflow-hidden rounded-[2rem] border-4 p-2 transition-colors duration-500 ${
          urgent ? "border-rose-400/80" : "border-cyan-300/40"
        }`}
        style={{
          boxShadow: urgent
            ? "0 0 90px rgba(244,63,94,0.45)"
            : "0 0 90px rgba(34,211,238,0.35)",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={name ? `Memorize: ${name}` : "Memorize this image"}
          className="h-[42vh] w-[42vh] max-h-[620px] max-w-[82vw] rounded-3xl object-cover md:h-[52vh] md:w-[52vh]"
          draggable={false}
        />
        <div className="pointer-events-none absolute inset-2 rounded-3xl ring-1 ring-white/20" />
      </div>
      {name && (
        <p className="text-lg font-semibold uppercase tracking-[0.3em] text-indigo-200/80">
          {name}
        </p>
      )}
    </div>
  );
}
