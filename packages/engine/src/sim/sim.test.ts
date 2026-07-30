// Property-based simulation: hundreds of seeded random-bot games per player
// count, asserting engine liveness and event-log invariants on every one.

import { describe, expect, it } from "vitest";
import { character } from "../data.js";
import type { GameEvent } from "../types.js";
import { MAX_NIGHTS, runGame, type SimResult } from "./runner.js";

const GAMES_PER_COUNT = 30;

interface Replay {
  /** Seats dead by end of game (asserts no double-death along the way). */
  dead: Set<number>;
  /** seat -> actual characterId at end (charactersDealt + characterChanged). */
  charOf: Map<number, string>;
  /** Did any death event hit a player who was demon-team at that moment? */
  demonDied: boolean;
  /** Was a saint (actual) killed by execution/virgin? */
  saintExecuted: boolean;
  /** day -> seats from execution events that day (null = no-execution result). */
  executionsByDay: Map<number, Array<number | null>>;
  finalDay: number;
}

/** Walk the event log once, checking per-event invariants and building a replay. */
function replayEvents(events: GameEvent[], playerCount: number, label: string): Replay {
  const dead = new Set<number>();
  const charOf = new Map<number, string>();
  const executionsByDay = new Map<number, Array<number | null>>();
  let demonDied = false;
  let saintExecuted = false;
  let day = 0;

  for (const e of events) {
    switch (e.t) {
      case "charactersDealt":
        for (const a of e.assignments) charOf.set(a.seat, a.characterId);
        break;
      case "phase":
        if (e.phase === "day" && e.day !== undefined) day = e.day;
        break;
      case "characterChanged": {
        expect(charOf.get(e.seat), `${label}: characterChanged 'from' mismatch`).toBe(e.from);
        charOf.set(e.seat, e.to);
        break;
      }
      case "death": {
        expect(dead.has(e.seat), `${label}: death event for already-dead seat ${e.seat}`).toBe(
          false,
        );
        dead.add(e.seat);
        const char = charOf.get(e.seat)!;
        if (character(char).team === "demon") demonDied = true;
        if ((e.cause.kind === "execution" || e.cause.kind === "virgin") && char === "saint") {
          saintExecuted = true;
        }
        break;
      }
      case "execution": {
        const list = executionsByDay.get(day) ?? [];
        list.push(e.seat);
        executionsByDay.set(day, list);
        break;
      }
      case "voteResult": {
        expect(
          e.votes.length,
          `${label}: voteResult with ${e.votes.length} votes for ${playerCount} players`,
        ).toBeLessThanOrEqual(playerCount);
        expect(new Set(e.votes).size, `${label}: duplicate seats in voteResult`).toBe(
          e.votes.length,
        );
        break;
      }
      default:
        break;
    }
  }
  return { dead, charOf, demonDied, saintExecuted, executionsByDay, finalDay: day };
}

function checkInvariants(result: SimResult, playerCount: number, label: string): void {
  const { winner, events, nights } = result;

  // (a) A winner is set. (b) Ended within caps (runGame throws on the
  // iteration cap; nights re-checked here).
  expect(winner, `${label}: no winner`).not.toBeNull();
  expect(nights, `${label}: too many nights`).toBeLessThanOrEqual(MAX_NIGHTS);

  // (c) Exactly one gameOver, and it is the final event and matches winner.
  const gameOvers = events.filter((e) => e.t === "gameOver");
  expect(gameOvers, `${label}: gameOver event count`).toHaveLength(1);
  const last = events[events.length - 1]!;
  expect(last.t, `${label}: last event is not gameOver`).toBe("gameOver");
  if (last.t === "gameOver") {
    expect(last.winner, `${label}: gameOver/winner mismatch`).toBe(winner.team);
    expect(last.reason, `${label}: gameOver/reason mismatch`).toBe(winner.reason);
  }

  const replay = replayEvents(events, playerCount, label);

  // At most one execution event per day (a no-execution day logs seat: null).
  for (const [day, seats] of replay.executionsByDay) {
    expect(seats.length, `${label}: ${seats.length} execution events on day ${day}`)
      .toBeLessThanOrEqual(1);
  }

  // (d) Winner reason is consistent with what the log shows.
  const aliveAtEnd = playerCount - replay.dead.size;
  switch (winner.reason) {
    case "demonKilled": {
      expect(winner.team, label).toBe("good");
      // Some death hit a player who was actually the demon at that moment
      // (execution, slayer, or a star-pass with no minion left to inherit).
      expect(replay.demonDied, `${label}: demonKilled but no demon death in log`).toBe(true);
      break;
    }
    case "twoPlayersLeft": {
      expect(winner.team, label).toBe("evil");
      expect(aliveAtEnd, `${label}: twoPlayersLeft with ${aliveAtEnd} alive`).toBeLessThanOrEqual(2);
      break;
    }
    case "saintExecuted": {
      expect(winner.team, label).toBe("evil");
      expect(replay.saintExecuted, `${label}: saintExecuted but no saint execution in log`).toBe(
        true,
      );
      break;
    }
    case "mayorNoExecution": {
      expect(winner.team, label).toBe("good");
      const mayorSeat = [...replay.charOf.entries()].find(([, c]) => c === "mayor")?.[0];
      expect(mayorSeat, `${label}: mayorNoExecution with no mayor in play`).toBeDefined();
      expect(replay.dead.has(mayorSeat!), `${label}: mayorNoExecution but mayor is dead`).toBe(
        false,
      );
      expect(aliveAtEnd, `${label}: mayorNoExecution with ${aliveAtEnd} alive`).toBe(3);
      const finalDayExecutions = replay.executionsByDay.get(replay.finalDay) ?? [];
      expect(
        finalDayExecutions.every((s) => s === null),
        `${label}: mayorNoExecution but someone was executed on the final day`,
      ).toBe(true);
      break;
    }
  }
}

describe("random-bot simulation invariants", () => {
  for (let count = 5; count <= 15; count++) {
    it(`${count} players: ${GAMES_PER_COUNT} games complete legally`, () => {
      // Every seed runs even if one fails, so a single crash cannot hide
      // other violations; any failure still fails the test below.
      const failures: string[] = [];
      for (let i = 0; i < GAMES_PER_COUNT; i++) {
        const seed = `sim-${count}-${i}`;
        const label = `seed=${seed} players=${count}`;
        try {
          const result = runGame(seed, count); // throws on liveness-cap breach
          checkInvariants(result, count, label);
        } catch (err) {
          failures.push(`${label}: ${(err as Error).message}`);
        }
      }
      // ENGINE BUG: two seeds currently crash with "Rng.pick from empty array":
      //   seed "sim-5-8"  / 5 players  (seating: saint, baron, imp, recluse, washerwoman)
      //   seed "sim-6-14" / 6 players  (seating: imp, recluse, saint, baron, drunk, washerwoman)
      // In a Baron game at 5-6 players the bag holds exactly ONE Townsfolk. When
      // that sole Townsfolk is the Washerwoman (and no Spy is in play to register
      // as one), her true-info generator (src/characters.ts, washerwoman resolve,
      // ~line 66) filters for OTHER players registering as townsfolk, gets an
      // empty pool, and g.rng.pick(pool) throws. The Librarian has an explicit
      // `librarianNone` fallback for the analogous case; the Washerwoman has
      // none. The fix belongs in the engine (washerwoman resolve, and/or
      // DefaultPolicy.selectBag avoiding bags whose Washerwoman info cannot be
      // generated), so the failure is deliberately left visible here.
      expect(failures, failures.join("\n")).toEqual([]);
    });
  }
});

describe("simulation determinism", () => {
  it("same seed and player count produce identical event logs", () => {
    const spots: Array<[number, string]> = [
      [5, "determinism-5"],
      [8, "determinism-8"],
      [10, "determinism-10"],
      [13, "determinism-13"],
      [15, "determinism-15"],
    ];
    for (const [count, seed] of spots) {
      const a = runGame(seed, count);
      const b = runGame(seed, count);
      expect(JSON.stringify(b.events), `seed=${seed} players=${count} not deterministic`).toBe(
        JSON.stringify(a.events),
      );
    }
  });
});
