"use client";

import React, { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { joinUrlFor } from "@/lib/fuzal/api";
import { GameBadge } from "./GameBadge";

export function LobbyQRCard({
  code,
  gridSize,
  pieceCount,
  size = 230,
}: {
  code: string;
  gridSize?: number;
  pieceCount?: number;
  size?: number;
}) {
  const [copied, setCopied] = useState(false);
  const url = joinUrlFor(code);

  const copyLink = async () => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      }
    } catch {
      // Fallback
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  return (
    <div className="glass flex w-full max-w-md flex-col items-center gap-5 p-6 sm:p-8 text-center relative overflow-hidden">
      {/* Top subtle badge row */}
      <div className="flex items-center justify-between w-full">
        <GameBadge variant="live" pulse>
          Arena Live
        </GameBadge>
        {gridSize && pieceCount && (
          <GameBadge variant="grid">
            {gridSize}×{gridSize} • {pieceCount} Pcs
          </GameBadge>
        )}
      </div>

      <div className="flex flex-col items-center gap-1">
        <h3 className="font-display text-2xl sm:text-3xl font-black tracking-wide text-white uppercase">
          Join The Arena
        </h3>
        <p className="text-xs sm:text-sm text-indigo-200/75">
          Scan the QR code to enter the game
        </p>
      </div>

      {/* Futuristic QR Display Frame */}
      <div className="relative group my-1">
        {/* Ambient neon back-glow */}
        <div className="absolute -inset-2 rounded-3xl bg-gradient-to-r from-cyan-500/30 to-purple-600/30 blur-xl opacity-75 group-hover:opacity-100 transition-opacity" />
        <div className="relative rounded-2xl sm:rounded-3xl bg-white p-4 sm:p-5 shadow-[0_20px_60px_rgba(34,211,238,0.35)] ring-2 ring-cyan-400/50">
          <QRCodeSVG
            value={url}
            size={size}
            level="H"
            marginSize={2}
            bgColor="#ffffff"
            fgColor="#080c1d"
            className="max-w-[min(65vw,230px)] max-h-[min(65vw,230px)] aspect-square"
            imageSettings={{
              src:
                "data:image/svg+xml;utf8," +
                encodeURIComponent(
                  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="6" y="6" width="24" height="24" rx="6" fill="#06b6d4"/><rect x="34" y="6" width="24" height="24" rx="6" fill="#8b5cf6"/><rect x="6" y="34" width="24" height="24" rx="6" fill="#d946ef"/><rect x="34" y="34" width="24" height="24" rx="6" fill="#06b6d4"/></svg>',
                ),
              height: 20,
              width: 20,
              excavate: true,
            }}
          />
        </div>
      </div>

      {/* Game Code Display */}
      <div className="flex flex-col items-center gap-1.5 w-full">
        <p className="text-[11px] font-bold uppercase tracking-[0.3em] text-cyan-300/80">
          Game Code
        </p>
        <div className="px-6 py-2 rounded-xl bg-slate-900/90 border border-cyan-400/40 shadow-[0_0_20px_rgba(34,211,238,0.2)]">
          <span className="font-mono text-4xl sm:text-5xl font-black tracking-[0.25em] text-white">
            {code}
          </span>
        </div>
      </div>

      {/* Copy Link & Direct URL */}
      <div className="flex flex-col items-center gap-2 w-full pt-1">
        <button
          type="button"
          onClick={copyLink}
          className="btn-secondary w-full py-2.5 px-4 text-xs sm:text-sm font-bold flex items-center justify-center gap-2 group transition-all"
        >
          {copied ? (
            <>
              <span className="text-emerald-400 text-base">✓</span>
              <span className="text-emerald-300 font-bold">LINK COPIED!</span>
            </>
          ) : (
            <>
              <span>🔗</span>
              <span>COPY DIRECT LINK</span>
            </>
          )}
        </button>
        <p className="max-w-[16rem] break-all text-center text-[10px] sm:text-xs text-indigo-200/50 font-mono">
          {url}
        </p>
      </div>
    </div>
  );
}
