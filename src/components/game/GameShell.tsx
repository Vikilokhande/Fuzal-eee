"use client";

import React from "react";

export function GameShell({
  children,
  className = "",
  maxWidth = "max-w-5xl",
  header,
  footer,
}: {
  children: React.ReactNode;
  className?: string;
  maxWidth?: string;
  header?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-[100dvh] w-full flex-col justify-between overflow-x-hidden bg-[#030611] text-[#f1f5ff]">
      {/* Background cybernetic grid */}
      <div className="fz-grid-bg absolute inset-0 z-0" aria-hidden="true" />

      {/* Atmospheric ambient glow orbs */}
      <div
        className="pointer-events-none absolute -left-28 -top-28 h-96 w-96 rounded-full bg-cyan-500/15 blur-[120px]"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute -right-28 top-1/4 h-[420px] w-[420px] rounded-full bg-fuchsia-600/15 blur-[140px]"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute bottom-0 left-1/3 h-80 w-80 rounded-full bg-violet-600/15 blur-[130px]"
        aria-hidden="true"
      />

      {/* Optional Top Bar */}
      {header && <header className="relative z-10 w-full px-4 pt-3 sm:px-6">{header}</header>}

      {/* Main content arena */}
      <main
        className={`relative z-10 mx-auto flex w-full flex-1 flex-col items-center justify-center px-4 py-4 sm:px-6 md:px-8 ${maxWidth} ${className}`}
      >
        {children}
      </main>

      {/* Optional Footer */}
      {footer && <footer className="relative z-10 w-full px-4 pb-4 sm:px-6">{footer}</footer>}
    </div>
  );
}
