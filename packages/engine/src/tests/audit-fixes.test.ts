// Regression tests for the rules-audit fixes (docs/rules-audit.md).
import { describe, expect, it } from "vitest";
import { Game } from "../game.js";
import { DefaultPolicy } from "../policy.js";
import { hasStatus } from "../status.js";

/** Recluse always pings as the Demon; mayor bounce pinned off. */
class RecluseIsDemonPolicy extends DefaultPolicy {
  override recluseRegistersAsEvil(): boolean {
    return true;
  }
  override recluseRegistersAsDemon(): boolean {
    return true;
  }
  override mayorBounce(): number | null {
    return null;
  }
}

/** Star-pass forced toward seat `pick`; mayor bounce pinned off. */
class StarPassPickPolicy extends DefaultPolicy {
  constructor(private pick: number) {
    super();
  }
  override starPassRecipient(): number {
    return this.pick;
  }
  override mayorBounce(): number | null {
    return null;
  }
}

// 8 players: [5 townsfolk, 1 outsider, 1 minion, 1 demon].
const RECLUSE_8 = ["slayer", "empath", "chef", "monk", "soldier", "recluse", "poisoner", "imp"];
// 10 players: [7, 0, 2, 1].
const POISONER_SW_10 = [
  "washerwoman", "librarian", "investigator", "chef", "empath", "soldier",
  "poisoner", "scarletwoman", "mayor", "imp",
];
// 7 players: [5, 0, 1, 1].
const PLAIN_7 = ["washerwoman", "librarian", "chef", "empath", "soldier", "poisoner", "imp"];

function names(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `P${i}`);
}

function game(bag: string[], seed: string, policy?: DefaultPolicy): Game {
  return new Game(
    { seed, playerNames: names(bag.length), forcedCharacters: bag, forcedSeating: bag },
    policy,
  );
}

describe("audit W-1: malfunction disables misregistration", () => {
  it("poisoned recluse registers as itself: the slayer shot fails", () => {
    const g = game(RECLUSE_8, "w1-a", new RecluseIsDemonPolicy());
    g.submit(6, { type: "nightChoice", seats: [5] }); // poison the recluse
    expect(g.phase).toBe("day");
    g.submit(0, { type: "slayerShot", target: 5 });
    expect(g.player(5).alive).toBe(true); // no ability → no demon registration
    expect(g.events).toContainEqual(
      expect.objectContaining({ t: "slayerShot", died: false }),
    );
  });

  it("healthy recluse forced to register as demon dies to the slayer", () => {
    const g = game(RECLUSE_8, "w1-b", new RecluseIsDemonPolicy());
    g.submit(6, { type: "nightChoice", seats: [1] }); // poison the empath instead
    g.submit(0, { type: "slayerShot", target: 5 });
    expect(g.player(5).alive).toBe(false);
    expect(g.winner).toBeNull(); // not the real demon
  });
});

describe("audit W-2/W-4: star-pass promotion details", () => {
  it("healthy scarlet woman MUST inherit even when policy prefers another minion", () => {
    const g = game(POISONER_SW_10, "w4", new StarPassPickPolicy(6));
    g.submit(6, { type: "nightChoice", seats: [0] }); // n1 poison
    g.advancePhase();
    g.advancePhase(); // day 1 ends with no execution → night 2
    g.submit(6, { type: "nightChoice", seats: [0] }); // n2 poison washerwoman
    g.submit(9, { type: "nightChoice", seats: [9] }); // imp self-kill
    expect(g.player(7).characterId).toBe("imp"); // SW inherited, policy overruled
    expect(g.player(6).characterId).toBe("poisoner");
  });

  it("a poisoner who inherits the mantle stops poisoning (W-2)", () => {
    const g = game(POISONER_SW_10, "w2", new StarPassPickPolicy(6));
    g.submit(6, { type: "nightChoice", seats: [0] }); // n1 poison washerwoman
    g.advancePhase();
    g.advancePhase(); // → night 2
    g.submit(6, { type: "nightChoice", seats: [7] }); // n2: poison the SCARLET WOMAN
    expect(hasStatus(g.player(7), "poisoned")).toBe(true);
    g.submit(9, { type: "nightChoice", seats: [9] }); // imp self-kill
    // Poisoned SW cannot inherit; the poisoner does — and their old character's
    // ongoing effects end with the promotion: the SW is no longer poisoned.
    expect(g.player(6).characterId).toBe("imp");
    expect(hasStatus(g.player(7), "poisoned")).toBe(false);
  });
});

describe("audit W-3: dead players are legal night targets", () => {
  it("imp attacking a dead player wastes the kill (nobody dies)", () => {
    const g = game(PLAIN_7, "w3");
    g.submit(5, { type: "nightChoice", seats: [0] }); // n1 poison
    // Day 1: execute the chef (seat 2).
    g.advancePhase();
    g.submit(0, { type: "nominate", nominee: 2 });
    for (let s = 0; s < 7; s++) g.submit(s, { type: "vote", vote: true });
    g.advancePhase();
    expect(g.player(2).alive).toBe(false);
    // Night 2: poisoner acts, then the imp attacks the dead chef → peaceful night.
    g.submit(5, { type: "nightChoice", seats: [0] });
    g.submit(6, { type: "nightChoice", seats: [2] });
    expect(g.phase).toBe("day");
    expect(g.alivePlayers().length).toBe(6); // only the chef is dead
  });
});

describe("audit F-1/F-3: slayer interactions with the vote", () => {
  it("slayer may shoot mid-vote; killing the nominee voids the vote", () => {
    const g = game(RECLUSE_8, "f3", new RecluseIsDemonPolicy());
    g.submit(6, { type: "nightChoice", seats: [1] }); // poison the empath
    g.advancePhase(); // → nominations
    g.submit(1, { type: "nominate", nominee: 5 }); // nominate the recluse
    expect(g.phase).toBe("vote");
    g.submit(0, { type: "slayerShot", target: 5 }); // registers as demon → dies
    expect(g.player(5).alive).toBe(false);
    expect(g.winner).toBeNull();
    expect(g.phase).toBe("nominations"); // vote voided, day continues
  });
});
