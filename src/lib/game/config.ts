/** Central runtime configuration (mirrors backend/app/config.py). */
export const config = {
  maxPlayers: Number(process.env.FUZAL_MAX_PLAYERS ?? 5),
  memorySeconds: Number(process.env.FUZAL_MEMORY_SECONDS ?? 30),
  puzzleSeconds: Number(process.env.FUZAL_PUZZLE_SECONDS ?? 180),
  gridCols: Number(process.env.FUZAL_GRID_COLS ?? 4),
  gridRows: Number(process.env.FUZAL_GRID_ROWS ?? 4),
  /** Grace period before a disconnected player frees their slot in LOBBY. */
  disconnectGraceMs: 8000,
  /** Public origin used to build QR URLs. Falls back at request time. */
  publicUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "",
};

export type FuzalConfig = typeof config;
