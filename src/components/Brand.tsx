export function Logo({ size = 56 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden
      className="drop-shadow-[0_0_24px_rgba(129,140,248,0.6)]"
    >
      <defs>
        <linearGradient id="fz-logo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#22d3ee" />
          <stop offset="0.55" stopColor="#818cf8" />
          <stop offset="1" stopColor="#e879f9" />
        </linearGradient>
      </defs>
      <rect x="4" y="4" width="26" height="26" rx="7" fill="url(#fz-logo)" />
      <rect x="34" y="4" width="26" height="26" rx="7" fill="url(#fz-logo)" opacity="0.55" />
      <rect x="4" y="34" width="26" height="26" rx="7" fill="url(#fz-logo)" opacity="0.55" />
      <path
        d="M47 34h6a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3h-6a3 3 0 0 0-3 3v6a3 3 0 0 1-3 3h-6a3 3 0 0 1-3-3v-6a3 3 0 0 0-3-3h-6a3 3 0 0 1-3-3v-6a3 3 0 0 1 3-3h6a3 3 0 0 0 3-3v-6a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v6a3 3 0 0 0 3 3z"
        fill="url(#fz-logo)"
      />
    </svg>
  );
}

export function Wordmark({ size = 48 }: { size?: number }) {
  return (
    <div className="flex items-center justify-center gap-3">
      <Logo size={size} />
      <h1
        className="font-display font-bold neon-text leading-none"
        style={{ fontSize: size * 1.05 }}
      >
        FUZAL
      </h1>
    </div>
  );
}
