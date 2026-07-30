// Headless simulation runner: drives a full game to completion with RandomBots.
// Deterministic per (seed, playerCount). Hard caps on iterations and nights
// surface engine liveness bugs as descriptive errors instead of hangs.

import { RandomBot, type Bot } from "../bots/index.js";
import { Game } from "../game.js";
import { Rng } from "../rng.js";
import type { GameEvent, WinReason } from "../types.js";

export interface SimResult {
  winner: { team: "good" | "evil"; reason: WinReason };
  nights: number;
  events: GameEvent[];
}

/** Cap on main-loop iterations (each is one pending input handled). */
export const MAX_ITERATIONS = 5000;
/** Cap on night count — a random game should end far sooner. */
export const MAX_NIGHTS = 40;

export function runGame(seed: string, playerCount: number): SimResult {
  const playerNames = Array.from({ length: playerCount }, (_, i) => `Player ${i + 1}`);
  const game = new Game({ seed, playerNames });

  // One bot Rng per game, separate from the engine's own stream.
  const rng = new Rng(`${seed}:bots`);
  const bots: Bot[] = game.players.map(() => new RandomBot(rng));

  const stamp = () =>
    `seed=${seed} players=${playerCount} phase=${game.phase} night=${game.night} ` +
    `day=${game.day} pending=${JSON.stringify(game.pending)} events=${game.events.length}`;

  // Nomination round bookkeeping: which alive seats have nominated-or-passed
  // today (passes emit no event, so the runner tracks them itself).
  let nomDay = -1;
  const nomActed = new Set<number>();

  let iterations = 0;
  while (!game.winner) {
    if (++iterations > MAX_ITERATIONS) {
      throw new Error(`Sim exceeded ${MAX_ITERATIONS} iterations (liveness bug?): ${stamp()}`);
    }
    if (game.night > MAX_NIGHTS) {
      throw new Error(`Sim exceeded ${MAX_NIGHTS} nights (liveness bug?): ${stamp()}`);
    }

    const pending = game.pending;
    if (!pending) {
      throw new Error(`Engine stalled: no winner and no pending input: ${stamp()}`);
    }

    switch (pending.kind) {
      case "nightAction": {
        const action = bots[pending.seat]!.decide(game, pending.seat);
        if (!action) throw new Error(`Bot for seat ${pending.seat} had no night action: ${stamp()}`);
        game.submit(pending.seat, action);
        break;
      }

      case "day": {
        game.advancePhase(); // → nominations
        break;
      }

      case "vote": {
        // Snapshot: submitting the final ballot resolves the vote and
        // replaces `pending`.
        const awaiting = [...pending.awaiting];
        for (const seat of awaiting) {
          const action = bots[seat]!.decide(game, seat);
          if (!action) throw new Error(`Bot for seat ${seat} had no vote: ${stamp()}`);
          game.submit(seat, action);
        }
        break;
      }

      case "nominations": {
        if (nomDay !== game.day) {
          nomDay = game.day;
          nomActed.clear();
        }
        const next = game.alivePlayers().find((p) => !nomActed.has(p.seat));
        if (!next) {
          // Every alive seat has nominated-or-passed but the engine is still
          // collecting (the last actor nominated, so no pass auto-closed the
          // round) — close nominations, resolving any execution.
          game.advancePhase();
          break;
        }
        nomActed.add(next.seat);
        const action = bots[next.seat]!.decide(game, next.seat);
        if (!action) {
          throw new Error(`Bot for seat ${next.seat} had no nomination decision: ${stamp()}`);
        }
        game.submit(next.seat, action);
        break;
      }
    }
  }

  return { winner: game.winner, nights: game.night, events: game.events };
}
