"use client";

import { QRCodeSVG } from "qrcode.react";
import { joinUrlFor } from "@/lib/fuzal/api";

export function QRCodeDisplay({
  code,
  size = 260,
}: {
  code: string;
  size?: number;
}) {
  const url = joinUrlFor(code);
  return (
    <div className="flex flex-col items-center gap-5">
      <div className="relative animate-float rounded-[2rem] bg-white p-5 shadow-[0_24px_80px_rgba(34,211,238,0.35)]">
        <QRCodeSVG
          value={url}
          size={size}
          level="H"
          marginSize={2}
          bgColor="#ffffff"
          fgColor="#0b1020"
          imageSettings={{
            src:
              "data:image/svg+xml;utf8," +
              encodeURIComponent(
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="6" y="6" width="24" height="24" rx="6" fill="#0ea5e9"/><rect x="34" y="6" width="24" height="24" rx="6" fill="#8b5cf6"/><rect x="6" y="34" width="24" height="24" rx="6" fill="#d946ef"/><rect x="34" y="34" width="24" height="24" rx="6" fill="#0ea5e9"/></svg>',
              ),
            height: 16,
            width: 16,
            excavate: true,
          }}
        />
        <div className="pointer-events-none absolute inset-0 rounded-[2rem] ring-1 ring-white/40" />
      </div>
      <div className="flex flex-col items-center gap-1">
        <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-200/80">
          Game Code
        </p>
        <p className="font-display text-5xl font-bold tracking-[0.35em] text-white">
          {code}
        </p>
        <p className="mt-1 max-w-[16rem] break-all text-center text-xs text-indigo-200/70">
          {url}
        </p>
      </div>
    </div>
  );
}
