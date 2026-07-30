import type { Player, Status, StatusExpiry } from "./types.js";

export function hasStatus(player: Player, type: Status["type"]): boolean {
  return player.statuses.some((s) => s.type === type);
}

export function getStatus<T extends Status["type"]>(
  player: Player,
  type: T,
): Extract<Status, { type: T }> | undefined {
  return player.statuses.find((s) => s.type === type) as
    | Extract<Status, { type: T }>
    | undefined;
}

export function addStatus(player: Player, status: Status): void {
  player.statuses.push(status);
}

export function removeStatus(player: Player, type: Status["type"]): boolean {
  const before = player.statuses.length;
  player.statuses = player.statuses.filter((s) => s.type !== type);
  return player.statuses.length !== before;
}

/** Remove statuses whose lifetime ends at this boundary. */
export function expireStatuses(player: Player, boundary: Exclude<StatusExpiry, "never">): Status[] {
  const expired = player.statuses.filter((s) => s.expires === boundary);
  player.statuses = player.statuses.filter((s) => s.expires !== boundary);
  return expired;
}

/** Remove ongoing effects that emanate FROM a player (used when they die). */
export function removeEffectsFrom(players: Player[], sourceSeat: number): void {
  for (const p of players) {
    p.statuses = p.statuses.filter(
      (s) => !("source" in s) || s.source !== sourceSeat,
    );
  }
}

/**
 * Drunk or poisoned: the single gate guarding every ability. Malfunctioning
 * players are woken and prompted exactly like healthy ones — they must not be
 * able to tell — but their ability has no effect / yields policy-chosen info.
 */
export function isMalfunctioning(player: Player): boolean {
  return player.characterId === "drunk" || hasStatus(player, "poisoned");
}
