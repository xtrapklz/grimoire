// How a player *appears* to another ability. The Recluse might register as evil
// and as a Minion or Demon; the Spy might register as good and as a Townsfolk or
// Outsider — even while dead. The storyteller policy decides per query (so the
// same Recluse can ping one ability and read clean to another), but within a
// single query the alignment, team, and shown character are always coherent.

import { character } from "./data.js";
import type { StorytellerPolicy, PolicyView } from "./policy.js";
import { isMalfunctioning } from "./status.js";
import type { Alignment, CharId, Player, Team } from "./types.js";

export interface Appearance {
  alignment: Alignment;
  team: Team;
  characterId: CharId;
}

/** Resolve how `player` registers to the ability `asker` for this one query. */
export function appearanceOf(
  player: Player,
  policy: StorytellerPolicy,
  view: PolicyView,
  asker: CharId,
): Appearance {
  // Misregistration IS the Recluse/Spy ability — a poisoned one has no ability
  // and registers as what they truly are. (Death does NOT stop it: "even if dead".)
  if (isMalfunctioning(player)) {
    return {
      alignment: player.alignment,
      team: character(player.characterId).team,
      characterId: player.characterId,
    };
  }
  if (player.characterId === "recluse" && policy.recluseRegistersAsEvil(view, player.seat, asker)) {
    const asDemon = policy.recluseRegistersAsDemon(view, player.seat, asker);
    const shown = asDemon ? "imp" : policy.recluseRegistersAsCharacter(view, player.seat, asker);
    return { alignment: "evil", team: character(shown).team, characterId: shown };
  }
  if (player.characterId === "spy" && policy.spyRegistersAsGood(view, player.seat, asker)) {
    const shown = policy.spyRegistersAsCharacter(view, player.seat, asker);
    return { alignment: "good", team: character(shown).team, characterId: shown };
  }
  return {
    alignment: player.alignment,
    team: character(player.characterId).team,
    characterId: player.characterId,
  };
}

/** Demon-detection queries (Fortune Teller ping, Slayer shot). */
export function registersAsDemon(
  player: Player,
  policy: StorytellerPolicy,
  view: PolicyView,
  asker: CharId,
): boolean {
  if (character(player.characterId).team === "demon") return true;
  if (player.characterId === "recluse" && !isMalfunctioning(player)) {
    return policy.recluseRegistersAsDemon(view, player.seat, asker);
  }
  return false;
}
