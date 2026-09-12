/** REST client for Fuzal (frontend/src/services/api.js equivalent). */

export interface CreatedLobby {
  code: string;
  lobbyId: string;
  hostToken: string;
  maxPlayers: number;
  gridCols: number;
  gridRows: number;
}

export interface JoinedPlayer {
  id: string;
  name: string;
  token: string;
  score: number;
  slot: number;
}

async function parseError(res: Response): Promise<Error> {
  try {
    const data = await res.json();
    return new Error(data.message ?? "Something went wrong. Please try again.");
  } catch {
    return new Error("Something went wrong. Please try again.");
  }
}

export async function createLobby(): Promise<CreatedLobby> {
  const res = await fetch("/api/lobbies", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw await parseError(res);
  return res.json();
}

export async function getLobby(code: string) {
  const res = await fetch(`/api/lobbies/${code}`, { cache: "no-store" });
  if (!res.ok) throw await parseError(res);
  return res.json();
}

export async function joinLobby(
  code: string,
  name: string,
): Promise<{ player: JoinedPlayer; lobby: unknown }> {
  const res = await fetch(`/api/lobbies/${code}/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw await parseError(res);
  return res.json();
}

export async function postAction(
  code: string,
  body: Record<string, unknown>,
): Promise<void> {
  const res = await fetch(`/api/lobbies/${code}/actions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await parseError(res);
}

export function pieceUrl(
  code: string,
  pieceId: number,
  playerId: string,
  token: string,
): string {
  return `/api/lobbies/${code}/piece/${pieceId}?p=${encodeURIComponent(
    playerId,
  )}&t=${encodeURIComponent(token)}`;
}

import { getJoinUrl } from "@/lib/urls";

/** QR payload — uses canonical site URL priority: NEXT_PUBLIC_SITE_URL > VERCEL_URL > origin. */
export function joinUrlFor(code: string): string {
  return getJoinUrl(code);
}

const KEY_PREFIX = "fuzal:v1:";
export const sessionStore = {
  get<T>(key: string): T | null {
    try {
      const raw = localStorage.getItem(KEY_PREFIX + key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  },
  set(key: string, value: unknown) {
    try {
      localStorage.setItem(KEY_PREFIX + key, JSON.stringify(value));
    } catch {
      /* private mode etc. */
    }
  },
  remove(key: string) {
    try {
      localStorage.removeItem(KEY_PREFIX + key);
    } catch {
      /* noop */
    }
  },
};
