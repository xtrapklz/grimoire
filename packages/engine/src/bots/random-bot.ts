// RandomBot: a legal-move baseline bot. It answers whatever the engine is
// pending on with a uniformly random LEGAL action. It has no strategy — its
// job is to exercise every engine path in simulation. Smarter bots implement
// the same `Bot` interface and can be swapped into the sim runner unchanged.
//
// All randomness flows through an injected Rng so simulations are fully
// deterministic per (seed, playerCount).

import type { Game } from "../game.js";
import type { Rng } from "../rng.js";
import type { NightPrompt, PlayerAction } from "../types.js";

/**
 * A bot controls one seat. `decide` is consulted by the sim runner whenever
 * the engine's pending input could involve this seat:
 *  - pending nightAction for this seat  → return a nightChoice
 *  - pending vote with this seat awaiting → return a vote
 *  - pending nominations and this seat is alive and hasn't acted today
 *    → return nominate or passNomination
 * Return null when the pending input is not addressed to this seat.
 */
export interface Bot {
  decide(game: Game, seat: number): PlayerAction | null;
}

export class RandomBot implements Bot {
  constructor(private readonly rng: Rng) {}

  decide(game: Game, seat: number): PlayerAction | null {
    const pending = game.pending;
    if (!pending) return null;

    switch (pending.kind) {
      case "nightAction": {
        if (pending.seat !== seat) return null;
        return this.nightChoice(game, seat, pending.prompt);
      }
      case "vote": {
        if (!pending.awaiting.includes(seat)) return null;
        // Slight bias toward lynching — but rarely for oneself.
        const pYes = pending.nominee === seat ? 0.2 : 0.6;
        return { type: "vote", vote: this.rng.chance(pYes) };
      }
      case "nominations": {
        if (!game.player(seat).alive) return null;
        if (this.rng.chance(0.4)) {
          const taken = nomineesNominatedToday(game);
          const candidates = game.alivePlayers().filter((p) => !taken.has(p.seat));
          if (candidates.length > 0) {
            return { type: "nominate", nominee: this.rng.pick(candidates).seat };
          }
        }
        return { type: "passNomination" };
      }
      case "day":
        return null;
    }
  }

  /** Uniformly random legal target set for a night prompt. */
  private nightChoice(game: Game, seat: number, prompt: NightPrompt): PlayerAction {
    const { count, allowSelf, allowDead } = prompt.choose;
    const legal = game.players.filter(
      (p) => (allowSelf || p.seat !== seat) && (allowDead || p.alive),
    );
    // Dead targets are legal (official rules) but almost always a wasted turn —
    // bots stick to the living whenever enough of them remain.
    const living = legal.filter((p) => p.alive);
    const candidates = (living.length >= count ? living : legal).map((p) => p.seat);
    if (candidates.length < count) {
      throw new Error(
        `RandomBot: seat ${seat} (${prompt.characterId}) has only ${candidates.length} ` +
          `legal targets but must choose ${count}`,
      );
    }
    // Shuffle + slice = uniform unordered subset of the legal candidates.
    const seats = this.rng.shuffle(candidates).slice(0, count);
    return { type: "nightChoice", seats };
  }
}

/**
 * Seats that have already been nominated today, derived from the event log
 * (the engine rejects a second nomination of the same nominee per day).
 * The per-day sets reset when a new day phase begins.
 */
export function nomineesNominatedToday(game: Game): Set<number> {
  const taken = new Set<number>();
  for (const e of game.events) {
    if (e.t === "phase" && e.phase === "day") taken.clear();
    else if (e.t === "nomination") taken.add(e.nominee);
  }
  return taken;
}
