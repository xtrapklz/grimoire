import type { CharacterData, CharId, Team } from "./types.js";
import charactersTb from "./data/characters.tb.json" with { type: "json" };
import playerCounts from "./data/player-counts.json" with { type: "json" };

export const TB_CHARACTERS: CharacterData[] = charactersTb as CharacterData[];

const byId = new Map<CharId, CharacterData>(TB_CHARACTERS.map((c) => [c.id, c]));

export function character(id: CharId): CharacterData {
  const c = byId.get(id);
  if (!c) throw new Error(`Unknown character: ${id}`);
  return c;
}

export function charactersOfTeam(team: Team): CharacterData[] {
  return TB_CHARACTERS.filter((c) => c.team === team);
}

export interface TeamComposition {
  townsfolk: number;
  outsider: number;
  minion: number;
  demon: number;
}

export const MIN_PLAYERS = 5;
export const MAX_PLAYERS = 15;

/** Official team composition for a given number of (non-traveller) players. */
export function compositionFor(playerCount: number): TeamComposition {
  if (playerCount < MIN_PLAYERS || playerCount > MAX_PLAYERS) {
    throw new Error(`Player count ${playerCount} out of range ${MIN_PLAYERS}-${MAX_PLAYERS}`);
  }
  return (playerCounts as TeamComposition[])[playerCount - MIN_PLAYERS]!;
}

// First-night pseudo-steps from the official night sheet: minion info and demon
// info happen between Dusk and the Poisoner. townsquare's global sort keys put
// them at 5 and 8 on the first night.
export const MINION_INFO_ORDER = 5;
export const DEMON_INFO_ORDER = 8;
