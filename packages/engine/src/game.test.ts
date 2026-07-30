import { describe, expect, it } from "vitest";
import { Game } from "./game.js";
import type { Info, Pending } from "./types.js";

// 7 players: 5 townsfolk / 0 outsiders / 1 minion / 1 demon.
const SEATS = ["washerwoman", "empath", "chef", "monk", "soldier", "poisoner", "imp"];
const NAMES = ["Ann", "Ben", "Cal", "Dee", "Eli", "Fay", "Gus"];

function makeGame(seed = "smoke-1") {
  return new Game({
    seed,
    playerNames: NAMES,
    forcedCharacters: SEATS,
    forcedSeating: SEATS,
  });
}

function pendingSeat(g: Game): number {
  const p: Pending = g.pending;
  if (p?.kind !== "nightAction") throw new Error(`expected nightAction, got ${p?.kind}`);
  return p.seat;
}

function lastInfo(g: Game, seat: number): Info {
  const inbox = g.inbox(seat);
  return inbox[inbox.length - 1]!;
}

describe("Game smoke test", () => {
  it("runs first night in official order with correct info", () => {
    const g = makeGame();

    // Setup: everyone got their identity.
    expect(g.inbox(0)[0]).toEqual({ type: "youAre", characterId: "washerwoman", alignment: "good" });
    expect(g.inbox(6)[0]).toEqual({ type: "youAre", characterId: "imp", alignment: "evil" });

    // 7 players → minion info + demon info fired before the Poisoner acts.
    expect(g.inbox(5).some((i) => i.type === "minionInfo")).toBe(true);
    const demonInfo = g.inbox(6).find((i) => i.type === "demonInfo");
    expect(demonInfo).toBeDefined();
    if (demonInfo?.type === "demonInfo") {
      expect(demonInfo.minions).toEqual([5]);
      expect(demonInfo.bluffs).toHaveLength(3);
    }

    // Poisoner is the first prompted wake.
    expect(g.night).toBe(1);
    expect(pendingSeat(g)).toBe(5);
    g.submit(5, { type: "nightChoice", seats: [2] }); // poison the Chef

    // Poisoned Chef gets policy info; healthy Washerwoman and Empath get truth.
    // (Info roles resolve in order 33 washerwoman, 36 chef, 37 empath.)
    expect(g.phase).toBe("day");
    const ww = lastInfo(g, 0);
    expect(ww.type).toBe("washerwoman");
    if (ww.type === "washerwoman") {
      // True info: the shown character really is one of the candidates' characters.
      const chars = ww.candidates.map((s) => g.player(s).characterId);
      expect(chars).toContain(ww.characterId);
    }
    const empath = lastInfo(g, 1);
    // Empath (seat 1) neighbors are seats 0 and 2 — both good: true reading is 0.
    expect(empath).toEqual({ type: "empath", count: 0 });
  });

  it("plays a full loop: nomination, vote, execution, night kill", () => {
    const g = makeGame("smoke-2");
    g.submit(5, { type: "nightChoice", seats: [0] }); // poison washerwoman
    expect(g.phase).toBe("day");

    // Day 1: nominate and execute the Soldier (seat 4).
    g.advancePhase(); // → nominations
    g.submit(0, { type: "nominate", nominee: 4 });
    while (g.pending?.kind === "argument") g.advancePhase();
    expect(g.phase).toBe("vote");
    for (let s = 0; s < 7; s++) g.submit(s, { type: "vote", vote: s < 4 });
    // 4 yes votes, 4 required (7 alive) → about to die.
    g.advancePhase(); // close nominations → execution → dusk → night 2
    expect(g.player(4).alive).toBe(false);
    expect(g.night).toBe(2);

    // Night 2: poisoner then imp (monk is dead? no — monk alive, acts between).
    expect(pendingSeat(g)).toBe(5);
    g.submit(5, { type: "nightChoice", seats: [0] });
    expect(pendingSeat(g)).toBe(3); // monk
    g.submit(3, { type: "nightChoice", seats: [0] }); // protect washerwoman
    expect(pendingSeat(g)).toBe(6); // imp
    g.submit(6, { type: "nightChoice", seats: [1] }); // kill empath
    expect(g.player(1).alive).toBe(false);

    // Dawn announced the death; game continues.
    expect(g.phase).toBe("day");
    expect(g.winner).toBeNull();
  });

  it("monk protection prevents the demon kill", () => {
    const g = makeGame("smoke-3");
    g.submit(5, { type: "nightChoice", seats: [1] });
    g.advancePhase();
    g.advancePhase(); // no nominations → no execution → night 2
    expect(g.night).toBe(2);
    g.submit(5, { type: "nightChoice", seats: [1] }); // poisoner
    g.submit(3, { type: "nightChoice", seats: [0] }); // monk protects washerwoman
    g.submit(6, { type: "nightChoice", seats: [0] }); // imp attacks washerwoman
    expect(g.player(0).alive).toBe(true);
    expect(g.events.some((e) => e.t === "nightDeathPrevented" && e.reason === "monk")).toBe(true);
  });

  it("soldier survives the demon; executing the imp ends the game", () => {
    const g = makeGame("smoke-4");
    g.submit(5, { type: "nightChoice", seats: [1] });
    g.advancePhase();
    g.advancePhase(); // → night 2
    g.submit(5, { type: "nightChoice", seats: [1] });
    g.submit(3, { type: "nightChoice", seats: [1] }); // monk protects empath
    g.submit(6, { type: "nightChoice", seats: [4] }); // imp attacks soldier
    expect(g.player(4).alive).toBe(true);

    // Day 2: execute the Imp → good wins (no Scarlet Woman in play).
    g.advancePhase();
    g.submit(0, { type: "nominate", nominee: 6 });
    while (g.pending?.kind === "argument") g.advancePhase();
    for (let s = 0; s < 7; s++) g.submit(s, { type: "vote", vote: true });
    g.advancePhase();
    expect(g.winner).toEqual({ team: "good", reason: "demonKilled" });
    expect(g.phase).toBe("gameOver");
  });
});
