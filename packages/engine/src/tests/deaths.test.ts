// Golden tests: deaths, protection, and demon mechanics (Trouble Brewing).
//
// Every scenario is fully scripted: forced characters, forced seating, and —
// wherever a storyteller judgment call matters — a DefaultPolicy subclass that
// forces the hook. Seat comments give the fixed night order actually exercised
// (other nights: poisoner 7, monk 12, scarlet woman 19, imp 24, ravenkeeper 52,
// empath 53; the Imp does NOT act on night 1).

import { describe, expect, it } from "vitest";
import { Game } from "../game.js";
import { DefaultPolicy } from "../policy.js";
import { hasStatus } from "../status.js";
import type { CharId, Cue, GameEvent, Info } from "../types.js";

// ── Seatings ────────────────────────────────────────────────────────────────

// 7p (5 TF / 1 minion / 1 demon), monk + soldier line-up.
// seats: 0 washerwoman, 1 empath, 2 chef, 3 monk, 4 soldier, 5 poisoner, 6 imp
const MONK_7 = ["washerwoman", "empath", "chef", "monk", "soldier", "poisoner", "imp"];

// 7p mayor line-up. seats: 0 mayor, 1 washerwoman, 2 chef, 3 slayer, 4 soldier, 5 poisoner, 6 imp
const MAYOR_7 = ["mayor", "washerwoman", "chef", "slayer", "soldier", "poisoner", "imp"];

// 7p scarlet woman line-up (no night-1 prompts at all: constructor lands on day 1).
// seats: 0 washerwoman, 1 chef, 2 empath, 3 slayer, 4 soldier, 5 scarletwoman, 6 imp
const SW_7 = ["washerwoman", "chef", "empath", "slayer", "soldier", "scarletwoman", "imp"];

// 10p (7 TF / 2 minions / 1 demon): poisoner + scarlet woman together.
// seats: 0 washerwoman, 1 librarian, 2 investigator, 3 chef, 4 empath,
//        5 slayer, 6 soldier, 7 poisoner, 8 scarletwoman, 9 imp
const SW_POISONER_10 = [
  "washerwoman", "librarian", "investigator", "chef", "empath",
  "slayer", "soldier", "poisoner", "scarletwoman", "imp",
];

// 7p ravenkeeper line-up. seats: 0 ravenkeeper, 1 washerwoman, 2 chef, 3 empath,
//        4 soldier, 5 poisoner, 6 imp
const RAVENKEEPER_7 = ["ravenkeeper", "washerwoman", "chef", "empath", "soldier", "poisoner", "imp"];

// 6p (3 TF / 1 outsider / 1 minion / 1 demon) saint + virgin line-up.
// seats: 0 washerwoman, 1 chef, 2 virgin, 3 saint, 4 poisoner, 5 imp
const SAINT_6 = ["washerwoman", "chef", "virgin", "saint", "poisoner", "imp"];

// 5p (3 TF / 1 minion / 1 demon), passive minion so nights are imp-only.
// seats: 0 chef, 1 washerwoman, 2 empath, 3 scarletwoman, 4 imp
const FIVE_5 = ["chef", "washerwoman", "empath", "scarletwoman", "imp"];

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeGame(seating: string[], seed: string, policy?: DefaultPolicy): Game {
  return new Game(
    {
      seed,
      playerNames: seating.map((c, i) => `P${i}-${c}`),
      forcedCharacters: seating,
      forcedSeating: seating,
    },
    policy,
  );
}

function pendingSeat(g: Game): number {
  const p = g.pending;
  if (p?.kind !== "nightAction") throw new Error(`expected nightAction, got ${p?.kind}`);
  return p.seat;
}

function lastInfo(g: Game, seat: number): Info {
  const inbox = g.inbox(seat);
  return inbox[inbox.length - 1]!;
}

type EventOf<T extends GameEvent["t"]> = Extract<GameEvent, { t: T }>;
function eventsOf<T extends GameEvent["t"]>(g: Game, t: T): EventOf<T>[] {
  return g.events.filter((e): e is EventOf<T> => e.t === t);
}

/** Everyone still awaiting casts the same ballot. */
function voteAll(g: Game, yes: boolean): void {
  const p = g.pending;
  if (p?.kind !== "vote") throw new Error(`expected vote, got ${p?.kind}`);
  for (const seat of [...p.awaiting]) g.submit(seat, { type: "vote", vote: yes });
}

/** From pending day/nominations: nominate, unanimous yes, close nominations. */
function executeSeat(g: Game, nominator: number, nominee: number): void {
  if (g.pending?.kind === "day") g.advancePhase();
  g.submit(nominator, { type: "nominate", nominee });
  while (g.pending?.kind === "argument") g.advancePhase();
  voteAll(g, true);
  g.advancePhase(); // close nominations → execution → dusk → next night (or game over)
}

/** Skip a day with no nominations at all. */
function skipDay(g: Game): void {
  expect(g.pending?.kind).toBe("day");
  g.advancePhase(); // day → nominations
  g.advancePhase(); // nominations → (no execution) → dusk → next night
}

// ── Policy subclasses (determinism) ─────────────────────────────────────────

/** Forces the mayor-bounce decision and records whether the hook was consulted. */
class BouncePolicy extends DefaultPolicy {
  calls = 0;
  constructor(readonly target: number | null) {
    super();
  }
  override mayorBounce(): number | null {
    this.calls++;
    return this.target;
  }
}

/** Forces the star-pass recipient. */
class StarPassPolicy extends DefaultPolicy {
  constructor(readonly recipient: number) {
    super();
  }
  override starPassRecipient(): number {
    return this.recipient;
  }
}

/**
 * Malfunctioning empath always sees the sentinel count 2 (never the truth),
 * so a true reading proves the empath was healthy at their wake.
 */
class SentinelEmpathPolicy extends DefaultPolicy {
  override falseInfo(
    ...args: Parameters<DefaultPolicy["falseInfo"]>
  ): ReturnType<DefaultPolicy["falseInfo"]> {
    const role = args[2];
    if (role === "empath") return { type: "empath", count: 2 };
    return null; // everyone else: shown the truth
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Monk protection
// ═══════════════════════════════════════════════════════════════════════════

describe("monk protection", () => {
  it("blocks the imp kill, and expires: the same target dies the next night", () => {
    const g = makeGame(MONK_7, "monk-1");
    g.submit(5, { type: "nightChoice", seats: [2] }); // n1: poison chef
    skipDay(g);

    // Night 2: monk protects the washerwoman; imp attacks her → no death.
    expect(g.night).toBe(2);
    g.submit(5, { type: "nightChoice", seats: [2] }); // poison chef
    g.submit(3, { type: "nightChoice", seats: [0] }); // protect washerwoman
    g.submit(6, { type: "nightChoice", seats: [0] }); // imp → washerwoman
    expect(g.player(0).alive).toBe(true);
    expect(g.events).toContainEqual({ t: "nightDeathPrevented", seat: 0, reason: "monk" });
    expect(eventsOf(g, "death")).toHaveLength(0);

    // Night 3: monk protects someone else; the washerwoman is no longer
    // protected (protection expired at dawn) and dies.
    skipDay(g);
    expect(g.night).toBe(3);
    g.submit(5, { type: "nightChoice", seats: [2] }); // poison chef
    g.submit(3, { type: "nightChoice", seats: [1] }); // protect empath instead
    g.submit(6, { type: "nightChoice", seats: [0] }); // imp → washerwoman again
    expect(g.player(0).alive).toBe(false);
    expect(g.events).toContainEqual({
      t: "death",
      seat: 0,
      cause: { kind: "demon", source: 6 },
    });
    // Only the single night-2 save happened.
    expect(eventsOf(g, "nightDeathPrevented").filter((e) => e.reason === "monk")).toHaveLength(1);
  });

  it("poisoned monk's protection does not protect", () => {
    const g = makeGame(MONK_7, "monk-2");
    g.submit(5, { type: "nightChoice", seats: [2] }); // n1: poison chef
    skipDay(g);

    // Night 2: poison the MONK, monk "protects" the washerwoman, imp kills her.
    g.submit(5, { type: "nightChoice", seats: [3] }); // poison monk
    g.submit(3, { type: "nightChoice", seats: [0] }); // malfunctioning protect
    g.submit(6, { type: "nightChoice", seats: [0] }); // imp → washerwoman
    expect(g.player(0).alive).toBe(false);
    expect(g.events).toContainEqual({
      t: "death",
      seat: 0,
      cause: { kind: "demon", source: 6 },
    });
    expect(eventsOf(g, "nightDeathPrevented")).toHaveLength(0);
  });

  it("a dead monk does not wake to protect", () => {
    const g = makeGame(MONK_7, "monk-3");
    g.submit(5, { type: "nightChoice", seats: [2] }); // n1: poison chef
    executeSeat(g, 0, 3); // day 1: execute the monk
    expect(g.player(3).alive).toBe(false);

    // Night 2: poisoner acts, then the very next prompt is the imp — no monk.
    expect(g.night).toBe(2);
    expect(pendingSeat(g)).toBe(5);
    g.submit(5, { type: "nightChoice", seats: [2] });
    expect(pendingSeat(g)).toBe(6); // imp, monk skipped
    g.submit(6, { type: "nightChoice", seats: [1] }); // imp → empath, unhindered
    expect(g.player(1).alive).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Soldier
// ═══════════════════════════════════════════════════════════════════════════

describe("soldier", () => {
  it("is immune to the imp's night kill", () => {
    const g = makeGame(MONK_7, "soldier-1");
    g.submit(5, { type: "nightChoice", seats: [2] }); // n1: poison chef
    skipDay(g);
    g.submit(5, { type: "nightChoice", seats: [2] }); // poison chef
    g.submit(3, { type: "nightChoice", seats: [0] }); // protect washerwoman
    g.submit(6, { type: "nightChoice", seats: [4] }); // imp → soldier
    expect(g.player(4).alive).toBe(true);
    expect(g.events).toContainEqual({ t: "nightDeathPrevented", seat: 4, reason: "soldier" });
    expect(eventsOf(g, "death")).toHaveLength(0);
  });

  it("poisoned soldier dies to the imp", () => {
    const g = makeGame(MONK_7, "soldier-2");
    g.submit(5, { type: "nightChoice", seats: [2] }); // n1: poison chef
    skipDay(g);
    g.submit(5, { type: "nightChoice", seats: [4] }); // poison the SOLDIER
    g.submit(3, { type: "nightChoice", seats: [0] }); // protect washerwoman
    g.submit(6, { type: "nightChoice", seats: [4] }); // imp → soldier
    expect(g.player(4).alive).toBe(false);
    expect(g.events).toContainEqual({
      t: "death",
      seat: 4,
      cause: { kind: "demon", source: 6 },
    });
  });

  it("can still be executed by vote (immunity is demon-only)", () => {
    const g = makeGame(MONK_7, "soldier-3");
    g.submit(5, { type: "nightChoice", seats: [2] }); // n1: poison chef
    executeSeat(g, 0, 4); // day 1: execute the soldier
    expect(g.player(4).alive).toBe(false);
    expect(g.events).toContainEqual({ t: "death", seat: 4, cause: { kind: "execution" } });
    expect(g.winner).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Mayor night-kill bounce
// ═══════════════════════════════════════════════════════════════════════════

describe("mayor night-kill bounce", () => {
  it("policy bounce: the chosen target dies instead of the mayor", () => {
    const policy = new BouncePolicy(2); // bounce onto the chef
    const g = makeGame(MAYOR_7, "mayor-1", policy);
    g.submit(5, { type: "nightChoice", seats: [1] }); // n1: poison washerwoman
    skipDay(g);
    g.submit(5, { type: "nightChoice", seats: [1] }); // poison washerwoman
    g.submit(6, { type: "nightChoice", seats: [0] }); // imp → mayor
    expect(policy.calls).toBe(1);
    expect(g.player(0).alive).toBe(true); // mayor lives
    expect(g.player(2).alive).toBe(false); // chef died instead
    expect(g.events).toContainEqual({ t: "nightDeathPrevented", seat: 0, reason: "mayorBounce" });
    expect(g.events).toContainEqual({
      t: "death",
      seat: 2,
      cause: { kind: "demon", source: 6 },
    });
  });

  it("policy declines (null): the mayor dies", () => {
    const policy = new BouncePolicy(null);
    const g = makeGame(MAYOR_7, "mayor-2", policy);
    g.submit(5, { type: "nightChoice", seats: [1] }); // n1
    skipDay(g);
    g.submit(5, { type: "nightChoice", seats: [1] });
    g.submit(6, { type: "nightChoice", seats: [0] }); // imp → mayor
    expect(policy.calls).toBe(1);
    expect(g.player(0).alive).toBe(false);
    expect(g.events).toContainEqual({
      t: "death",
      seat: 0,
      cause: { kind: "demon", source: 6 },
    });
    expect(eventsOf(g, "nightDeathPrevented")).toHaveLength(0);
  });

  it("poisoned mayor dies and the bounce hook is never consulted", () => {
    const policy = new BouncePolicy(2); // WOULD bounce if consulted
    const g = makeGame(MAYOR_7, "mayor-3", policy);
    g.submit(5, { type: "nightChoice", seats: [1] }); // n1
    skipDay(g);
    g.submit(5, { type: "nightChoice", seats: [0] }); // poison the MAYOR
    g.submit(6, { type: "nightChoice", seats: [0] }); // imp → mayor
    expect(policy.calls).toBe(0); // malfunctioning mayor: no storyteller decision
    expect(g.player(0).alive).toBe(false);
    expect(g.player(2).alive).toBe(true);
    expect(g.events).toContainEqual({
      t: "death",
      seat: 0,
      cause: { kind: "demon", source: 6 },
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Scarlet Woman
// ═══════════════════════════════════════════════════════════════════════════

describe("scarlet woman", () => {
  it("imp executed with 5+ alive: she becomes the imp, the game continues, and she kills the next night", () => {
    const g = makeGame(SW_7, "sw-1"); // no night-1 prompts: already day 1
    expect(g.pending?.kind).toBe("day");
    executeSeat(g, 0, 6); // day 1: execute the imp with 7 alive

    expect(g.events).toContainEqual({
      t: "characterChanged",
      seat: 5,
      from: "scarletwoman",
      to: "imp",
      reason: "scarletWoman",
    });
    expect(g.winner).toBeNull();
    expect(g.phase).not.toBe("gameOver");
    expect(g.player(5).characterId).toBe("imp");
    expect(g.inbox(5)).toContainEqual({ type: "youAre", characterId: "imp", alignment: "evil" });

    // Night 2: the promoted imp wakes and kills.
    expect(g.night).toBe(2);
    expect(pendingSeat(g)).toBe(5);
    g.submit(5, { type: "nightChoice", seats: [0] });
    expect(g.player(0).alive).toBe(false);
    expect(g.events).toContainEqual({
      t: "death",
      seat: 0,
      cause: { kind: "demon", source: 5 },
    });
    expect(g.winner).toBeNull();
  });

  it("imp executed with exactly 5 alive (count includes the imp): she still promotes", () => {
    const g = makeGame(SW_7, "sw-2");
    executeSeat(g, 1, 0); // day 1: execute washerwoman → 6 alive
    g.submit(6, { type: "nightChoice", seats: [1] }); // night 2: imp kills chef → 5 alive
    executeSeat(g, 3, 6); // day 2: execute the imp at exactly 5 alive
    expect(g.events).toContainEqual({
      t: "characterChanged",
      seat: 5,
      from: "scarletwoman",
      to: "imp",
      reason: "scarletWoman",
    });
    expect(g.winner).toBeNull();

    // Night 3: she kills.
    expect(g.night).toBe(3);
    expect(pendingSeat(g)).toBe(5);
    g.submit(5, { type: "nightChoice", seats: [2] }); // kill empath
    expect(g.player(2).alive).toBe(false);
    expect(g.winner).toBeNull();
  });

  it("imp executed with exactly 4 alive: good wins, no promotion", () => {
    const g = makeGame(SW_7, "sw-3");
    executeSeat(g, 1, 0); // day 1: execute washerwoman → 6 alive
    g.submit(6, { type: "nightChoice", seats: [1] }); // night 2: kill chef → 5 alive
    executeSeat(g, 3, 2); // day 2: execute empath → 4 alive
    g.submit(6, { type: "nightChoice", seats: [4] }); // night 3: imp → soldier (no death)
    expect(g.events).toContainEqual({ t: "nightDeathPrevented", seat: 4, reason: "soldier" });
    expect(g.alivePlayers()).toHaveLength(4);

    executeSeat(g, 3, 6); // day 3: execute the imp with exactly 4 alive
    expect(g.winner).toEqual({ team: "good", reason: "demonKilled" });
    expect(g.phase).toBe("gameOver");
    expect(eventsOf(g, "characterChanged")).toHaveLength(0);
    expect(g.player(5).characterId).toBe("scarletwoman");
  });

  it("poisoned scarlet woman at the moment of imp execution: good wins", () => {
    const g = makeGame(SW_POISONER_10, "sw-4");
    g.submit(7, { type: "nightChoice", seats: [8] }); // n1: poison the scarlet woman
    expect(hasStatus(g.player(8), "poisoned")).toBe(true);
    executeSeat(g, 0, 9); // day 1: execute the imp (10 alive, SW poisoned)
    expect(g.winner).toEqual({ team: "good", reason: "demonKilled" });
    expect(g.phase).toBe("gameOver");
    expect(eventsOf(g, "characterChanged")).toHaveLength(0);
    expect(g.player(8).characterId).toBe("scarletwoman");
  });

  it("promotes when the imp dies to a slayer shot too", () => {
    const g = makeGame(SW_7, "sw-5");
    g.submit(3, { type: "slayerShot", target: 6 }); // day 1: slayer shoots the imp
    expect(g.events).toContainEqual({ t: "slayerShot", slayer: 3, target: 6, died: true });
    expect(g.player(6).alive).toBe(false);
    expect(g.events).toContainEqual({
      t: "characterChanged",
      seat: 5,
      from: "scarletwoman",
      to: "imp",
      reason: "scarletWoman",
    });
    expect(g.winner).toBeNull();

    // She kills on night 2.
    skipDay(g);
    expect(pendingSeat(g)).toBe(5);
    g.submit(5, { type: "nightChoice", seats: [0] });
    expect(g.player(0).alive).toBe(false);
    expect(g.winner).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. Imp star-pass
// ═══════════════════════════════════════════════════════════════════════════

describe("imp star-pass", () => {
  it("self-kill: imp dies, the scarlet woman inherits, and kills the following night", () => {
    const g = makeGame(SW_7, "star-1");
    skipDay(g); // day 1: nothing

    // Night 2: imp kills himself.
    const cues = g.submit(6, { type: "nightChoice", seats: [6] });
    expect(g.player(6).alive).toBe(false);
    expect(g.events).toContainEqual({ t: "death", seat: 6, cause: { kind: "starPass" } });
    expect(g.events).toContainEqual({
      t: "characterChanged",
      seat: 5,
      from: "scarletwoman",
      to: "imp",
      reason: "starPass",
    });
    expect(g.winner).toBeNull();
    // Dawn announced the imp's own death.
    const deaths = cues.find((c): c is Extract<Cue, { cue: "deaths" }> => c.cue === "deaths");
    expect(deaths?.seats).toEqual([6]);

    // Night 3: the new imp wakes and kills.
    skipDay(g);
    expect(g.night).toBe(3);
    expect(pendingSeat(g)).toBe(5);
    g.submit(5, { type: "nightChoice", seats: [0] });
    expect(g.player(0).alive).toBe(false);
    expect(g.events).toContainEqual({
      t: "death",
      seat: 0,
      cause: { kind: "demon", source: 5 },
    });
    expect(g.winner).toBeNull();
  });

  it("default policy hands the mantle to the scarlet woman when several minions live", () => {
    const g = makeGame(SW_POISONER_10, "star-2");
    g.submit(7, { type: "nightChoice", seats: [0] }); // n1: poison washerwoman
    skipDay(g);
    g.submit(7, { type: "nightChoice", seats: [0] }); // n2: poison washerwoman
    g.submit(9, { type: "nightChoice", seats: [9] }); // n2: imp self-kill
    expect(g.player(9).alive).toBe(false);
    expect(g.events).toContainEqual({
      t: "characterChanged",
      seat: 8, // scarlet woman preferred over the poisoner (seat 7)
      from: "scarletwoman",
      to: "imp",
      reason: "starPass",
    });
    expect(g.player(7).characterId).toBe("poisoner");
    expect(g.winner).toBeNull();
  });

  // Official: with a healthy Scarlet Woman and 5+ alive, she MUST inherit —
  // the storyteller only chooses when she can't (e.g. poisoned).
  it("policy hands the mantle to another minion when the scarlet woman is poisoned", () => {
    const g = makeGame(SW_POISONER_10, "star-3", new StarPassPolicy(7));
    g.submit(7, { type: "nightChoice", seats: [0] }); // n1
    skipDay(g);
    g.submit(7, { type: "nightChoice", seats: [8] }); // n2: poison the scarlet woman
    g.submit(9, { type: "nightChoice", seats: [9] }); // n2: imp self-kill
    expect(g.events).toContainEqual({
      t: "characterChanged",
      seat: 7,
      from: "poisoner",
      to: "imp",
      reason: "starPass",
    });
    expect(g.player(8).characterId).toBe("scarletwoman");
    expect(g.winner).toBeNull();
  });

  it("no living minions: the star-pass just kills the demon and good wins", () => {
    const g = makeGame(SW_7, "star-4");
    executeSeat(g, 0, 5); // day 1: execute the scarlet woman
    expect(g.player(5).alive).toBe(false);
    g.submit(6, { type: "nightChoice", seats: [6] }); // night 2: imp self-kill
    expect(g.player(6).alive).toBe(false);
    expect(g.winner).toEqual({ team: "good", reason: "demonKilled" });
    expect(g.phase).toBe("gameOver");
    expect(eventsOf(g, "characterChanged")).toHaveLength(0);
  });

  it("monk-protected imp cannot star-pass: no death, no promotion", () => {
    const g = makeGame(MONK_7, "star-5");
    g.submit(5, { type: "nightChoice", seats: [2] }); // n1: poison chef
    skipDay(g);
    g.submit(5, { type: "nightChoice", seats: [2] }); // poison chef
    g.submit(3, { type: "nightChoice", seats: [6] }); // monk protects the IMP
    g.submit(6, { type: "nightChoice", seats: [6] }); // imp self-kill
    expect(g.player(6).alive).toBe(true);
    expect(g.events).toContainEqual({ t: "nightDeathPrevented", seat: 6, reason: "monk" });
    expect(eventsOf(g, "death")).toHaveLength(0);
    expect(eventsOf(g, "characterChanged")).toHaveLength(0);
    expect(g.winner).toBeNull();
  });

  it("poisoned imp's attack does nothing", () => {
    const g = makeGame(MONK_7, "star-6");
    g.submit(5, { type: "nightChoice", seats: [2] }); // n1: poison chef
    skipDay(g);
    g.submit(5, { type: "nightChoice", seats: [6] }); // poison the IMP
    g.submit(3, { type: "nightChoice", seats: [0] }); // protect washerwoman
    g.submit(6, { type: "nightChoice", seats: [1] }); // imp → empath
    expect(g.player(1).alive).toBe(true);
    expect(g.events).toContainEqual({ t: "nightDeathPrevented", seat: 1, reason: "malfunction" });
    expect(eventsOf(g, "death")).toHaveLength(0);
  });

  it("poisoned imp's self-kill does nothing: no death, no star-pass", () => {
    const g = makeGame(MONK_7, "star-7");
    g.submit(5, { type: "nightChoice", seats: [2] }); // n1: poison chef
    skipDay(g);
    g.submit(5, { type: "nightChoice", seats: [6] }); // poison the IMP
    g.submit(3, { type: "nightChoice", seats: [0] }); // protect washerwoman
    g.submit(6, { type: "nightChoice", seats: [6] }); // imp self-kill
    expect(g.player(6).alive).toBe(true);
    expect(g.events).toContainEqual({ t: "nightDeathPrevented", seat: 6, reason: "malfunction" });
    expect(eventsOf(g, "death")).toHaveLength(0);
    expect(eventsOf(g, "characterChanged")).toHaveLength(0);
    expect(g.winner).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. Ravenkeeper
// ═══════════════════════════════════════════════════════════════════════════

describe("ravenkeeper", () => {
  it("killed by the imp: wakes the SAME night (after the imp) and learns a character before dawn", () => {
    const g = makeGame(RAVENKEEPER_7, "raven-1");
    g.submit(5, { type: "nightChoice", seats: [4] }); // n1: poison soldier (info-free target)
    skipDay(g);

    // Night 2: poisoner, then imp kills the ravenkeeper.
    g.submit(5, { type: "nightChoice", seats: [4] });
    expect(pendingSeat(g)).toBe(6);
    g.submit(6, { type: "nightChoice", seats: [0] }); // imp → ravenkeeper
    expect(g.player(0).alive).toBe(false);

    // Still night 2: the dead ravenkeeper is prompted next.
    expect(g.phase).toBe("night");
    expect(g.night).toBe(2);
    const p = g.pending;
    expect(p?.kind).toBe("nightAction");
    if (p?.kind === "nightAction") {
      expect(p.seat).toBe(0);
      expect(p.prompt.characterId).toBe("ravenkeeper");
    }

    // They point at the imp and learn the truth before dawn.
    const cues = g.submit(0, { type: "nightChoice", seats: [6] });
    expect(lastInfo(g, 0)).toEqual({ type: "ravenkeeper", target: 6, characterId: "imp" });
    expect(g.phase).toBe("day");
    expect(g.day).toBe(2);
    const deaths = cues.find((c): c is Extract<Cue, { cue: "deaths" }> => c.cue === "deaths");
    expect(deaths?.seats).toEqual([0]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. Saint (and virgin-caused executions)
// ═══════════════════════════════════════════════════════════════════════════

describe("saint", () => {
  it("executing a healthy saint: evil wins immediately", () => {
    const g = makeGame(SAINT_6, "saint-1");
    g.submit(4, { type: "nightChoice", seats: [1] }); // n1: poison chef
    executeSeat(g, 0, 3); // day 1: execute the saint
    expect(g.player(3).alive).toBe(false);
    expect(g.winner).toEqual({ team: "evil", reason: "saintExecuted" });
    expect(g.phase).toBe("gameOver");
  });

  it("executing a POISONED saint: the game continues", () => {
    const g = makeGame(SAINT_6, "saint-2");
    g.submit(4, { type: "nightChoice", seats: [3] }); // n1: poison the saint
    executeSeat(g, 0, 3); // day 1: execute the poisoned saint
    expect(g.player(3).alive).toBe(false);
    expect(g.winner).toBeNull();
    expect(g.night).toBe(2); // play moved on to the next night
    expect(pendingSeat(g)).toBe(4); // poisoner wakes
  });

  it("saint dying at NIGHT to the imp: the game continues", () => {
    const g = makeGame(SAINT_6, "saint-3");
    g.submit(4, { type: "nightChoice", seats: [0] }); // n1: poison washerwoman
    skipDay(g);
    g.submit(4, { type: "nightChoice", seats: [0] }); // n2: poison washerwoman
    g.submit(5, { type: "nightChoice", seats: [3] }); // n2: imp → saint
    expect(g.player(3).alive).toBe(false);
    expect(g.events).toContainEqual({
      t: "death",
      seat: 3,
      cause: { kind: "demon", source: 5 },
    });
    expect(g.winner).toBeNull();
    expect(g.phase).toBe("day");
    expect(g.day).toBe(2);
  });

  // The task asked for "saint executed via Virgin trigger → evil wins", but
  // per the official rules that scenario cannot occur: the Virgin only
  // executes a nominator who registers as a TOWNSFOLK, and the Saint is an
  // Outsider (with no misregistration hook in TB). The two tests below pin
  // both halves of the actual rules: (a) a virgin-caused death IS an
  // execution, and (b) a Saint nominator does NOT trigger the Virgin.
  it("virgin trigger executes a townsfolk nominator immediately and counts as an execution", () => {
    const g = makeGame(SAINT_6, "saint-4");
    g.submit(4, { type: "nightChoice", seats: [3] }); // n1: poison the saint (irrelevant here)
    g.advancePhase(); // → nominations
    g.submit(0, { type: "nominate", nominee: 2 }); // washerwoman nominates the virgin

    expect(g.events).toContainEqual({ t: "virginTriggered", virgin: 2, nominator: 0 });
    expect(g.events).toContainEqual({ t: "death", seat: 0, cause: { kind: "virgin", virgin: 2 } });
    expect(eventsOf(g, "execution")).toContainEqual({ t: "execution", seat: 0 });
    expect(g.lastExecution).toEqual({ seat: 0, day: 1 }); // it IS the day's execution
    expect(g.player(0).alive).toBe(false);
    expect(g.winner).toBeNull();
    expect(g.night).toBe(2); // the day ended immediately
  });

  it("a saint nominating the virgin does NOT trigger her (outsiders never do)", () => {
    const g = makeGame(SAINT_6, "saint-5");
    g.submit(4, { type: "nightChoice", seats: [0] }); // n1: poison washerwoman
    g.advancePhase(); // → nominations
    g.submit(3, { type: "nominate", nominee: 2 }); // SAINT nominates the virgin
    while (g.pending?.kind === "argument") g.advancePhase();

    expect(eventsOf(g, "virginTriggered")).toHaveLength(0);
    expect(eventsOf(g, "death")).toHaveLength(0);
    expect(g.player(3).alive).toBe(true);
    expect(hasStatus(g.player(2), "virginSpent")).toBe(true); // ability spent anyway
    expect(g.pending?.kind).toBe("vote"); // a normal vote proceeds
    voteAll(g, false);
    g.advancePhase(); // no execution → night 2
    expect(g.winner).toBeNull();
    expect(g.night).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. Two players left
// ═══════════════════════════════════════════════════════════════════════════

describe("two players left with a living demon", () => {
  it("a night kill reducing to 2 alive ends the game: evil wins", () => {
    const g = makeGame(FIVE_5, "two-1"); // 5p: no night-1 prompts
    executeSeat(g, 1, 0); // day 1: execute chef → 4 alive
    g.submit(4, { type: "nightChoice", seats: [1] }); // night 2: kill washerwoman → 3 alive
    expect(g.winner).toBeNull();
    skipDay(g);
    g.submit(4, { type: "nightChoice", seats: [2] }); // night 3: kill empath → 2 alive
    expect(g.winner).toEqual({ team: "evil", reason: "twoPlayersLeft" });
    expect(g.phase).toBe("gameOver");
    expect(g.events).toContainEqual({ t: "gameOver", winner: "evil", reason: "twoPlayersLeft" });
  });

  it("an execution reducing to 2 alive ends the game: evil wins", () => {
    const g = makeGame(FIVE_5, "two-2");
    executeSeat(g, 1, 0); // day 1: execute chef → 4 alive
    g.submit(4, { type: "nightChoice", seats: [1] }); // night 2: kill washerwoman → 3 alive
    executeSeat(g, 3, 2); // day 2: execute the empath → 2 alive (SW + imp)
    expect(g.events).toContainEqual({ t: "death", seat: 2, cause: { kind: "execution" } });
    expect(g.winner).toEqual({ team: "evil", reason: "twoPlayersLeft" });
    expect(g.phase).toBe("gameOver");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. Poison timing
// ═══════════════════════════════════════════════════════════════════════════

describe("poison timing", () => {
  it("lasts through its night and day, and is gone by the next night", () => {
    const g = makeGame(MONK_7, "poison-1");
    g.submit(5, { type: "nightChoice", seats: [2] }); // n1: poison chef
    skipDay(g);

    // Night 2: poison the soldier; imp kills elsewhere.
    g.submit(5, { type: "nightChoice", seats: [4] }); // poison soldier
    g.submit(3, { type: "nightChoice", seats: [0] }); // protect washerwoman
    g.submit(6, { type: "nightChoice", seats: [1] }); // imp → empath
    expect(g.player(1).alive).toBe(false);

    // Day 2: the soldier is still poisoned.
    expect(g.day).toBe(2);
    expect(hasStatus(g.player(4), "poisoned")).toBe(true);
    skipDay(g);

    // Night 3: poison expired at dusk; poisoner picks someone else.
    expect(g.night).toBe(3);
    expect(hasStatus(g.player(4), "poisoned")).toBe(false);
    g.submit(5, { type: "nightChoice", seats: [2] }); // poison chef instead
    expect(hasStatus(g.player(4), "poisoned")).toBe(false);
    g.submit(3, { type: "nightChoice", seats: [0] }); // protect washerwoman
    g.submit(6, { type: "nightChoice", seats: [4] }); // imp → soldier: immune again
    expect(g.player(4).alive).toBe(true);
    expect(g.events).toContainEqual({ t: "nightDeathPrevented", seat: 4, reason: "soldier" });
  });

  it("poisoned slayer's shot fails during the poison day (shot still spent)", () => {
    const g = makeGame(SW_POISONER_10, "poison-2");
    g.submit(7, { type: "nightChoice", seats: [5] }); // n1: poison the slayer
    expect(g.pending?.kind).toBe("day");
    g.submit(5, { type: "slayerShot", target: 9 }); // day 1: slayer shoots the imp
    expect(g.events).toContainEqual({ t: "slayerShot", slayer: 5, target: 9, died: false });
    expect(g.player(9).alive).toBe(true);
    expect(hasStatus(g.player(5), "slayerSpent")).toBe(true);
    expect(g.winner).toBeNull();
  });

  it("executing the poisoner ends their poison: soldier is immune again that night", () => {
    const g = makeGame(MONK_7, "poison-3");
    g.submit(5, { type: "nightChoice", seats: [2] }); // n1: poison chef
    skipDay(g);
    g.submit(5, { type: "nightChoice", seats: [4] }); // n2: poison soldier
    g.submit(3, { type: "nightChoice", seats: [0] }); // protect washerwoman
    g.submit(6, { type: "nightChoice", seats: [1] }); // imp → empath
    executeSeat(g, 0, 5); // day 2: execute the poisoner

    // Night 3: poison is gone; the imp cannot kill the soldier.
    expect(g.night).toBe(3);
    expect(hasStatus(g.player(4), "poisoned")).toBe(false);
    expect(pendingSeat(g)).toBe(3); // dead poisoner no longer wakes
    g.submit(3, { type: "nightChoice", seats: [0] }); // protect washerwoman
    g.submit(6, { type: "nightChoice", seats: [4] }); // imp → soldier
    expect(g.player(4).alive).toBe(true);
    expect(g.events).toContainEqual({ t: "nightDeathPrevented", seat: 4, reason: "soldier" });
  });

  it("poisoner killed mid-night: poison ends immediately (empath reads true later that night)", () => {
    // Sentinel policy: a malfunctioning empath ALWAYS sees count 2, so a true
    // reading (0) proves the poison had already ended when the empath woke.
    const g = makeGame(MONK_7, "poison-4", new SentinelEmpathPolicy());

    // Night 1: poison the empath — control: they get the sentinel reading.
    g.submit(5, { type: "nightChoice", seats: [1] });
    expect(lastInfo(g, 1)).toEqual({ type: "empath", count: 2 });
    skipDay(g);

    // Night 2: poison the empath again, but the imp kills the poisoner BEFORE
    // the empath wakes (poisoner 7 → monk 12 → imp 24 → empath 53).
    g.submit(5, { type: "nightChoice", seats: [1] }); // poison empath
    expect(hasStatus(g.player(1), "poisoned")).toBe(true);
    g.submit(3, { type: "nightChoice", seats: [0] }); // protect washerwoman
    g.submit(6, { type: "nightChoice", seats: [5] }); // imp → poisoner
    expect(g.player(5).alive).toBe(false);
    expect(hasStatus(g.player(1), "poisoned")).toBe(false); // ended at the death

    // The empath woke after all that and read the TRUTH: neighbors seat 0
    // (washerwoman) and seat 2 (chef), both good → 0, not the sentinel 2.
    expect(g.phase).toBe("day");
    expect(lastInfo(g, 1)).toEqual({ type: "empath", count: 0 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10. Deaths at dawn
// ═══════════════════════════════════════════════════════════════════════════

describe("deaths at dawn", () => {
  it("announces tonight's deaths in the dawn cue", () => {
    const g = makeGame(MONK_7, "dawn-1");
    g.submit(5, { type: "nightChoice", seats: [2] }); // n1: poison chef
    skipDay(g);
    g.submit(5, { type: "nightChoice", seats: [2] });
    g.submit(3, { type: "nightChoice", seats: [0] }); // protect washerwoman
    const cues = g.submit(6, { type: "nightChoice", seats: [1] }); // imp → empath
    const deaths = cues.find((c): c is Extract<Cue, { cue: "deaths" }> => c.cue === "deaths");
    expect(deaths).toBeDefined();
    expect(deaths?.seats).toEqual([1]);
    expect(g.events).toContainEqual({
      t: "death",
      seat: 1,
      cause: { kind: "demon", source: 6 },
    });
  });

  it("a peaceful night (monk save) announces an empty death list", () => {
    const g = makeGame(MONK_7, "dawn-2");
    g.submit(5, { type: "nightChoice", seats: [2] }); // n1: poison chef
    skipDay(g);
    g.submit(5, { type: "nightChoice", seats: [2] });
    g.submit(3, { type: "nightChoice", seats: [1] }); // protect empath
    const cues = g.submit(6, { type: "nightChoice", seats: [1] }); // imp → empath (saved)
    const deaths = cues.find((c): c is Extract<Cue, { cue: "deaths" }> => c.cue === "deaths");
    expect(deaths).toBeDefined();
    expect(deaths?.seats).toEqual([]);
    expect(g.alivePlayers()).toHaveLength(7);
    expect(eventsOf(g, "death")).toHaveLength(0);
  });
});
