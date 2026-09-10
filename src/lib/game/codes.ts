import { randomBytes, randomInt } from "node:crypto";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous 0/O/1/I

/** Human friendly game code, e.g. A7K9P → here 4 chars, e.g. A82K */
export function makeGameCode(length = 4): string {
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

/** Full lobby id, e.g. FZ-A82K */
export function makeLobbyId(): string {
  return `FZ-${makeGameCode(4)}`;
}

export function makePlayerId(): string {
  return `p_${randomBytes(9).toString("hex")}`;
}

export function makeToken(): string {
  return randomBytes(24).toString("hex");
}

export function codeFromLobbyId(lobbyId: string): string {
  return lobbyId.startsWith("FZ-") ? lobbyId.slice(3) : lobbyId;
}
