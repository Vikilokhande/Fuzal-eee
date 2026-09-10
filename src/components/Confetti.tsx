"use client";

import { useEffect, useRef } from "react";
import confetti from "canvas-confetti";

/** Celebration burst that keeps firing for a few seconds, then settles. */
export function Confetti({ active }: { active: boolean }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!active) return;
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = confetti.create(canvas, { resize: true, useWorker: false });

    const colors = ["#22d3ee", "#818cf8", "#e879f9", "#34d399", "#fde047"];
    const fire = (particleRatio: number, opts: confetti.Options) =>
      ctx({
        origin: { x: 0.5, y: 0.55 },
        colors,
        particleCount: Math.floor(220 * particleRatio),
        spread: 75,
        startVelocity: 45,
        ...opts,
      });

    fire(0.25, { spread: 30, startVelocity: 55 });
    fire(0.35, { spread: 100 });
    fire(0.15, { spread: 120, decay: 0.91, scalar: 0.9 });
    fire(0.2, { spread: 120, startVelocity: 25, decay: 0.92, scalar: 1.2 });

    const sideCannons = setInterval(() => {
      ctx({
        particleCount: 36,
        angle: 60,
        spread: 60,
        origin: { x: 0, y: 0.8 },
        colors,
      });
      ctx({
        particleCount: 36,
        angle: 120,
        spread: 60,
        origin: { x: 1, y: 0.8 },
        colors,
      });
    }, 1300);

    const stop = setTimeout(() => clearInterval(sideCannons), 4200);
    return () => {
      clearInterval(sideCannons);
      clearTimeout(stop);
      ctx.reset();
    };
  }, [active]);

  if (!active) return null;
  return (
    <canvas
      ref={ref}
      className="pointer-events-none fixed inset-0 z-40 h-full w-full"
      aria-hidden
    />
  );
}
