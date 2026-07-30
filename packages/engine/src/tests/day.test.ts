// Golden tests for DAY MECHANICS: nominations, voting, executions, and day
// abilities (Virgin, Slayer, Butler vote restriction, Mayor 3-alive win).
//
// Every game here is fully forced (forcedCharacters + forcedSeating) and every
// storyteller judgment call that matters is pinned by a policy subclass, so the
// scenarios are deterministic regardless of seed.

import { describe, expect, it } from "vitest";
import { Game } from "../game.js";
import { DefaultPolicy } from "../policy.js";
import { hasStatus } from "../status.js";
import type { CharId, GameEvent } from "../types.js";

// ── Fixtures ────────────────────────────────────────────────────────────────

const NAMES7 = ["Ann", "Ben", "Cal", "Dee", "Eli", "Fay", "Gus"];

// 7 players, Baron composition [3 TF, 2 O, 1 M, 1 D]. No night prompts at all
// on night 1 (chef info is automatic), and only the Imp acts on later nights.
// seats: 0 chef, 1 mayor, 2 soldier, 3 recluse, 4 saint, 5 baron, 6 imp
const BAG_PLAIN: CharId[] = ["chef", "mayor", "soldier", "recluse", "saint", "baron", "imp"];

// seats: 0 undertaker, 1 virgin, 2 chef, 3 soldier, 4 mayor, 5 scarletwoman, 6 imp
const BAG_VIRGIN: CharId[] = ["undertaker", "virgin", "chef", "soldier", "mayor", "scarletwoman", "imp"];

// seats: 0 virgin, 1 chef, 2 soldier, 3 saint, 4 recluse, 5 baron, 6 imp
const BAG_VIRGIN_OUTSIDER: CharId[] = ["virgin", "chef", "soldier", "saint", "recluse", "baron", "imp"];

// seats: 0 virgin, 1 chef, 2 soldier, 3 mayor, 4 slayer, 5 spy, 6 imp
const BAG_VIRGIN_SPY: CharId[] = ["virgin", "chef", "soldier", "mayor", "slayer", "spy", "imp"];

// seats: 0 virgin, 1 chef, 2 soldier, 3 mayor, 4 slayer, 5 poisoner, 6 imp
const BAG_VIRGIN_POISON: CharId[] = ["virgin", "chef", "soldier", "mayor", "slayer", "poisoner", "imp"];

// seats: 0 slayer, 1 chef, 2 soldier, 3 recluse, 4 saint, 5 baron, 6 imp
const BAG_SLAYER: CharId[] = ["slayer", "chef", "soldier", "recluse", "saint", "baron", "imp"];

// seats: 0 slayer, 1 chef, 2 soldier, 3 mayor, 4 virgin, 5 poisoner, 6 imp
const BAG_SLAYER_POISON: CharId[] = ["slayer", "chef", "soldier", "mayor", "virgin", "poisoner", "imp"];

// seats: 0 chef, 1 mayor, 2 soldier, 3 slayer, 4 virgin, 5 poisoner, 6 imp
const BAG_MAYOR_POISON: CharId[] = ["chef", "mayor", "soldier", "slayer", "virgin", "poisoner", "imp"];

// 6 players [3 TF, 1 O, 1 M, 1 D].
// seats: 0 chef, 1 mayor, 2 soldier, 3 butler, 4 scarletwoman, 5 imp
const BAG_BUTLER: CharId[] = ["chef", "mayor", "soldier", "butler", "scarletwoman", "imp"];

// seats: 0 chef, 1 mayor, 2 soldier, 3 butler, 4 poisoner, 5 imp
const BAG_BUTLER_POISON: CharId[] = ["chef", "mayor", "soldier", "butler", "poisoner", "imp"];

// seats: 0 chef, 1 soldier, 2 mayor, 3 drunk, 4 scarletwoman, 5 imp
const BAG_DRUNK: CharId[] = ["chef", "soldier", "mayor", "drunk", "scarletwoman", "imp"];

function make(seats: CharId[], seed = "day-tests", policy?: DefaultPolicy): Game {
  return new Game(
    {
      seed,
      playerNames: NAMES7.slice(0, seats.length),
      forcedCharacters: seats,
      forcedSeating: seats,
    },
    policy,
  );
}

// ── Policy pins ─────────────────────────────────────────────────────────────

class RecluseIsDemonPolicy extends DefaultPolicy {
  override recluseRegistersAsEvil(): boolean {
    return true;
  }
  override recluseRegistersAsDemon(): boolean {
    return true;
  }
}

class SpyIsTownsfolkPolicy extends DefaultPolicy {
  override spyRegistersAsGood(): boolean {
    return true;
  }
  override spyRegistersAsCharacter(): CharId {
    return "washerwoman"; // a Townsfolk, not in play
  }
}

class DrunkThinksSlayerPolicy extends DefaultPolicy {
  override drunkBelievedRole(): CharId {
    return "slayer"; // not in the bag
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function events<T extends GameEvent["t"]>(g: Game, t: T): Array<Extract<GameEvent, { t: T }>> {
  return g.events.filter((e): e is Extract<GameEvent, { t: T }> => e.t === t);
}

function lastVoteResult(g: Game): Extract<GameEvent, { t: "voteResult" }> {
  const vs = events(g, "voteResult");
  if (vs.length === 0) throw new Error("no voteResult events");
  return vs[vs.length - 1]!;
}

function votePending(g: Game): Extract<NonNullable<Game["pending"]>, { kind: "vote" }> {
  const p = g.pending;
  if (p?.kind !== "vote") throw new Error(`expected vote pending, got ${p?.kind ?? g.phase}`);
  return p;
}

function nominate(g: Game, nominator: number, nominee: number): void {
  g.submit(nominator, { type: "nominate", nominee });
  // Skip the case/defense argument window — most tests here assume voting
  // opens immediately, matching pre-argument-phase behavior.
  while (g.pending?.kind === "argument") g.advancePhase();
}

/** Every awaiting seat votes; `yes` lists the seats voting yes. */
function runVote(g: Game, yes: number[]): void {
  const awaiting = [...votePending(g).awaiting];
  for (const s of awaiting) g.submit(s, { type: "vote", vote: yes.includes(s) });
}

// ── 0. Argument phase (case → defense → vote) ───────────────────────────────

describe("argument phase", () => {
  it("a nomination opens a case window, not the vote", () => {
    const g = make(BAG_PLAIN);
    g.advancePhase(); // day → nominations
    g.submit(0, { type: "nominate", nominee: 3 });
    expect(g.pending).toEqual({ kind: "argument", nominator: 0, nominee: 3, stage: "case" });
    expect(g.phase).toBe("argument");
  });

  it("advancePhase() (the timeout path) moves case → defense, then defense → vote", () => {
    const g = make(BAG_PLAIN);
    g.advancePhase();
    g.submit(0, { type: "nominate", nominee: 3 });
    g.advancePhase(); // case → defense
    expect(g.pending).toEqual({ kind: "argument", nominator: 0, nominee: 3, stage: "defense" });
    g.advancePhase(); // defense → vote
    const pend = votePending(g);
    expect(pend.nominator).toBe(0);
    expect(pend.nominee).toBe(3);
  });

  it("the nominator can skip their case window early", () => {
    const g = make(BAG_PLAIN);
    g.advancePhase();
    g.submit(0, { type: "nominate", nominee: 3 });
    g.submit(0, { type: "skipArgument" });
    expect(g.pending).toEqual({ kind: "argument", nominator: 0, nominee: 3, stage: "defense" });
  });

  it("the nominee can skip their defense window early", () => {
    const g = make(BAG_PLAIN);
    g.advancePhase();
    g.submit(0, { type: "nominate", nominee: 3 });
    g.advancePhase(); // case → defense
    g.submit(3, { type: "skipArgument" });
    expect(votePending(g).nominee).toBe(3);
  });

  it("only the current speaker may skip — anyone else throws", () => {
    const g = make(BAG_PLAIN);
    g.advancePhase();
    g.submit(0, { type: "nominate", nominee: 3 });
    expect(() => g.submit(1, { type: "skipArgument" })).toThrow();
    expect(() => g.submit(3, { type: "skipArgument" })).toThrow(); // defends later, not now
  });

  it("skipArgument with no argument pending throws", () => {
    const g = make(BAG_PLAIN);
    expect(() => g.submit(0, { type: "skipArgument" })).toThrow();
  });
});

// ── 1. Vote math ────────────────────────────────────────────────────────────

describe("vote math", () => {
  it("7 alive → 4 required; exactly the required count puts the nominee about to die", () => {
    const g = make(BAG_PLAIN);
    expect(g.phase).toBe("day");
    g.advancePhase(); // day → nominations

    nominate(g, 0, 3);
    expect(g.phase).toBe("vote");
    // Everyone is alive, so everyone is awaiting.
    expect(votePending(g).awaiting).toEqual([0, 1, 2, 3, 4, 5, 6]);

    runVote(g, [0, 1, 2, 5]); // exactly 4 yes
    const vr = lastVoteResult(g);
    expect(vr.required).toBe(4); // ceil(7/2)
    expect(vr.votes).toEqual([0, 1, 2, 5]);
    expect(vr.outcome).toBe("aboutToDie");
    expect(g.phase).toBe("nominations");

    g.advancePhase(); // close the day → execution resolves
    expect(g.player(3).alive).toBe(false);
    expect(events(g, "execution")).toEqual([{ t: "execution", seat: 3 }]);
    expect(g.night).toBe(2);
  });

  it("below the required count fails and nobody is executed", () => {
    const g = make(BAG_PLAIN);
    g.advancePhase();
    nominate(g, 0, 3);
    runVote(g, [0, 1, 6]); // 3 yes < 4 required
    expect(lastVoteResult(g).outcome).toBe("failed");

    g.advancePhase();
    expect(g.player(3).alive).toBe(true);
    expect(events(g, "execution")).toEqual([{ t: "execution", seat: null }]);
    expect(g.night).toBe(2);
  });

  it("a later nominee with MORE votes supersedes the earlier about-to-die", () => {
    const g = make(BAG_PLAIN);
    g.advancePhase();

    nominate(g, 0, 2);
    runVote(g, [0, 1, 2, 5]); // 4 votes
    expect(lastVoteResult(g).outcome).toBe("aboutToDie");

    nominate(g, 1, 3);
    runVote(g, [0, 1, 2, 5, 6]); // 5 votes > 4
    expect(lastVoteResult(g).outcome).toBe("aboutToDie");

    g.advancePhase();
    expect(g.player(3).alive).toBe(false); // superseding nominee dies
    expect(g.player(2).alive).toBe(true); // earlier about-to-die was cleared
    expect(events(g, "execution")).toEqual([{ t: "execution", seat: 3 }]);
  });

  it("a later nominee TYING the top → nobody is executed at day end", () => {
    const g = make(BAG_PLAIN);
    g.advancePhase();

    nominate(g, 0, 2);
    runVote(g, [0, 1, 2, 5]); // 4 votes, about to die
    nominate(g, 1, 3);
    runVote(g, [0, 1, 2, 6]); // 4 votes, ties the top
    expect(lastVoteResult(g).outcome).toBe("tied");

    g.advancePhase();
    expect(g.player(2).alive).toBe(true);
    expect(g.player(3).alive).toBe(true);
    expect(events(g, "execution")).toEqual([{ t: "execution", seat: null }]);
    expect(g.night).toBe(2);
  });

  it("after a tie, a still-later nominee beating the top is executed", () => {
    const g = make(BAG_PLAIN);
    g.advancePhase();

    nominate(g, 0, 2);
    runVote(g, [0, 1, 2, 5]); // 4
    nominate(g, 1, 3);
    runVote(g, [0, 1, 2, 6]); // 4 — tied, nobody about to die
    nominate(g, 2, 5);
    runVote(g, [0, 1, 2, 4, 6]); // 5 — beats the tie
    expect(lastVoteResult(g).outcome).toBe("aboutToDie");

    g.advancePhase();
    expect(g.player(5).alive).toBe(false);
    expect(g.player(2).alive).toBe(true);
    expect(g.player(3).alive).toBe(true);
  });

  it("a later nominee with FEWER votes (even ≥ required) leaves the earlier about-to-die standing", () => {
    const g = make(BAG_PLAIN);
    g.advancePhase();

    nominate(g, 0, 2);
    runVote(g, [0, 1, 2, 5, 6]); // 5 votes, about to die
    nominate(g, 1, 3);
    runVote(g, [0, 1, 2, 6]); // 4 votes: ≥ required but fewer than 5
    expect(lastVoteResult(g).outcome).not.toBe("aboutToDie");

    g.advancePhase();
    expect(g.player(2).alive).toBe(false); // earlier nominee still dies
    expect(g.player(3).alive).toBe(true);
    expect(events(g, "execution")).toEqual([{ t: "execution", seat: 2 }]);
  });
});

// ── 2. Nomination limits ────────────────────────────────────────────────────

describe("nomination limits", () => {
  it("the same player cannot nominate twice in one day", () => {
    const g = make(BAG_PLAIN);
    g.advancePhase();
    nominate(g, 0, 2);
    runVote(g, []);
    expect(() => nominate(g, 0, 3)).toThrow(/Already nominated/);
  });

  it("the same player cannot be nominated twice in one day", () => {
    const g = make(BAG_PLAIN);
    g.advancePhase();
    nominate(g, 0, 2);
    runVote(g, []);
    expect(() => nominate(g, 1, 2)).toThrow(/Already been nominated/);
  });

  it("dead players can neither nominate nor be nominated", () => {
    const g = make(BAG_PLAIN);
    g.advancePhase();
    nominate(g, 0, 3);
    runVote(g, [0, 1, 2, 5]);
    g.advancePhase(); // recluse (3) executed → night 2
    g.submit(6, { type: "nightChoice", seats: [4] }); // imp kills the saint
    expect(g.day).toBe(2);
    g.advancePhase(); // → nominations

    expect(() => nominate(g, 3, 0)).toThrow(/Dead players cannot nominate/);
    expect(() => nominate(g, 0, 3)).toThrow(/Dead players cannot be nominated/);
  });

  it("nomination limits reset the next day", () => {
    const g = make(BAG_PLAIN);
    g.advancePhase();
    nominate(g, 0, 2);
    runVote(g, []); // fails, nobody dies
    g.advancePhase(); // → night 2
    g.submit(6, { type: "nightChoice", seats: [4] }); // imp kills the saint
    expect(g.day).toBe(2);
    g.advancePhase(); // → nominations

    // Same nominator, same nominee as yesterday: legal again.
    expect(() => nominate(g, 0, 2)).not.toThrow();
    expect(g.phase).toBe("vote");
  });
});

// ── 3. Dead votes ───────────────────────────────────────────────────────────

describe("dead votes", () => {
  it("a dead yes vote is counted once and spends the token; a dead no vote does not", () => {
    const g = make(BAG_PLAIN);
    g.advancePhase();
    nominate(g, 0, 3);
    runVote(g, [0, 1, 2, 5]);
    g.advancePhase(); // recluse (3) executed
    g.submit(6, { type: "nightChoice", seats: [4] }); // imp kills the saint (4)
    expect(g.day).toBe(2);
    g.advancePhase(); // → nominations

    // 5 alive (0,1,2,5,6); dead 3 and 4 both still hold their token.
    nominate(g, 0, 2);
    expect(votePending(g).awaiting).toEqual([0, 1, 2, 3, 4, 5, 6]);
    runVote(g, [3]); // dead seat 3 votes yes; dead seat 4 votes no
    const vr = lastVoteResult(g);
    expect(vr.required).toBe(3); // ceil(5 alive / 2) — dead don't raise the bar
    expect(vr.votes).toEqual([3]); // the dead yes was counted
    expect(vr.outcome).toBe("failed");
    expect(g.player(3).usedDeadVote).toBe(true); // token spent on yes
    expect(g.player(4).usedDeadVote).toBe(false); // token kept on no

    // Next vote the same day: seat 3 is no longer eligible, seat 4 still is.
    nominate(g, 1, 5);
    expect(votePending(g).awaiting).toEqual([0, 1, 2, 4, 5, 6]);
    expect(() => g.submit(3, { type: "vote", vote: true })).toThrow(/Not eligible/);
    runVote(g, []);
  });
});

// ── 4. Butler ───────────────────────────────────────────────────────────────

describe("butler", () => {
  it("butler's yes counts when the master also voted yes", () => {
    const g = make(BAG_BUTLER);
    g.submit(3, { type: "nightChoice", seats: [0] }); // butler picks seat 0 as master
    expect(g.phase).toBe("day");
    g.advancePhase();

    nominate(g, 1, 2);
    runVote(g, [0, 1, 3]); // master yes + butler yes + one more
    const vr = lastVoteResult(g);
    expect(vr.votes).toEqual([0, 1, 3]); // butler counted
    expect(vr.required).toBe(3); // 6 alive
    expect(vr.outcome).toBe("aboutToDie");
  });

  it("butler yes + master no → the butler's vote is not counted", () => {
    const g = make(BAG_BUTLER);
    g.submit(3, { type: "nightChoice", seats: [0] });
    g.advancePhase();

    nominate(g, 1, 2);
    runVote(g, [1, 2, 3]); // butler yes, master (0) no
    const vr = lastVoteResult(g);
    expect(vr.votes).toEqual([1, 2]); // no seat 3
    expect(vr.outcome).toBe("failed"); // 2 < 3 once the butler is discounted
  });

  it("a DEAD butler's ghost vote is unrestricted (dead players have no ability)", () => {
    const g = make(BAG_BUTLER);
    g.submit(3, { type: "nightChoice", seats: [0] });
    g.advancePhase();
    nominate(g, 0, 3);
    runVote(g, [0, 1, 2]); // execute the butler
    g.advancePhase(); // → night 2
    g.submit(5, { type: "nightChoice", seats: [0] }); // imp kills seat 0
    expect(g.day).toBe(2);
    g.advancePhase();

    // Alive: 1,2,4,5 (required 2). Only the dead butler votes yes.
    nominate(g, 1, 2);
    runVote(g, [3]);
    const vr = lastVoteResult(g);
    expect(vr.votes).toEqual([3]); // counted with no master voting at all
    expect(g.player(3).usedDeadVote).toBe(true);
  });

  it("a POISONED butler is still prompted at night but votes freely by day", () => {
    const g = make(BAG_BUTLER_POISON);
    // Night 1: poisoner (order 17) then butler (order 39).
    expect(g.pending).toMatchObject({ kind: "nightAction", seat: 4 });
    g.submit(4, { type: "nightChoice", seats: [3] }); // poison the butler
    // Malfunction contract: the butler is prompted exactly like a healthy one.
    expect(g.pending).toMatchObject({ kind: "nightAction", seat: 3 });
    g.submit(3, { type: "nightChoice", seats: [0] }); // picks a "master"

    expect(hasStatus(g.player(3), "poisoned")).toBe(true);
    expect(hasStatus(g.player(3), "butlerMaster")).toBe(false); // no restriction applied

    g.advancePhase();
    nominate(g, 1, 2);
    runVote(g, [3]); // butler yes, chosen master (0) votes no
    expect(lastVoteResult(g).votes).toEqual([3]); // counted anyway
  });
});

// ── 5. Virgin ───────────────────────────────────────────────────────────────

describe("virgin", () => {
  it("townsfolk nominating a healthy virgin: nominator executed immediately, day ends, undertaker learns it", () => {
    const g = make(BAG_VIRGIN);
    expect(g.phase).toBe("day");
    g.advancePhase();

    nominate(g, 2, 1); // chef (townsfolk) nominates the virgin
    // No vote: the nomination itself ends the day.
    expect(events(g, "virginTriggered")).toEqual([{ t: "virginTriggered", virgin: 1, nominator: 2 }]);
    expect(events(g, "execution")).toEqual([{ t: "execution", seat: 2 }]);
    expect(g.player(2).alive).toBe(false);
    expect(events(g, "death")).toContainEqual({
      t: "death",
      seat: 2,
      cause: { kind: "virgin", virgin: 1 },
    });
    expect(g.lastExecution).toEqual({ seat: 2, day: 1 });
    // The day is over: we passed through dusk into night 2.
    expect(events(g, "phase")).toContainEqual({ t: "phase", phase: "dusk", day: 1 });
    expect(g.phase).toBe("night");
    expect(g.night).toBe(2);

    // Night 2: the execution counts as an execution — the Undertaker sees it.
    g.submit(6, { type: "nightChoice", seats: [1] }); // imp kills the virgin
    expect(g.inbox(0)).toContainEqual({ type: "undertaker", executed: 2, characterId: "chef" });
  });

  it("an OUTSIDER (saint) nominating the virgin does not trigger; a normal vote proceeds (and the ability is spent)", () => {
    const g = make(BAG_VIRGIN_OUTSIDER);
    g.advancePhase();

    nominate(g, 3, 0); // saint nominates the virgin
    expect(events(g, "virginTriggered")).toEqual([]);
    expect(g.player(3).alive).toBe(true);
    expect(g.phase).toBe("vote"); // normal vote on the virgin
    expect(hasStatus(g.player(0), "virginSpent")).toBe(true); // first nomination spends it
    runVote(g, []);
    g.advancePhase(); // no execution → night 2
    g.submit(6, { type: "nightChoice", seats: [1] }); // imp kills the chef
    expect(g.day).toBe(2);
    g.advancePhase();

    // Second-ever nomination, now by a Townsfolk: still no trigger — spent.
    nominate(g, 2, 0);
    expect(events(g, "virginTriggered")).toEqual([]);
    expect(g.player(2).alive).toBe(true);
    expect(g.phase).toBe("vote");
  });

  it("a SPY registering as a Townsfolk triggers the virgin and is executed", () => {
    const g = make(BAG_VIRGIN_SPY, "day-tests", new SpyIsTownsfolkPolicy());
    g.advancePhase();

    nominate(g, 5, 0); // the spy nominates the virgin
    expect(events(g, "virginTriggered")).toEqual([{ t: "virginTriggered", virgin: 0, nominator: 5 }]);
    expect(g.player(5).alive).toBe(false);
    expect(events(g, "execution")).toEqual([{ t: "execution", seat: 5 }]);
    expect(g.phase).toBe("night");
    expect(g.night).toBe(2);
  });

  it("a POISONED virgin does not trigger — and is spent, so she never triggers even after the poison ends", () => {
    const g = make(BAG_VIRGIN_POISON);
    g.submit(5, { type: "nightChoice", seats: [0] }); // poison the virgin
    expect(g.phase).toBe("day");
    g.advancePhase();

    nominate(g, 1, 0); // chef (townsfolk) nominates the poisoned virgin
    expect(events(g, "virginTriggered")).toEqual([]);
    expect(g.player(1).alive).toBe(true);
    expect(g.phase).toBe("vote"); // day continues with a normal vote
    expect(hasStatus(g.player(0), "virginSpent")).toBe(true); // spent while poisoned
    runVote(g, []);
    g.advancePhase(); // → night 2

    g.submit(5, { type: "nightChoice", seats: [3] }); // poisoner moves off the virgin
    g.submit(6, { type: "nightChoice", seats: [4] }); // imp kills the slayer
    expect(g.day).toBe(2);
    expect(hasStatus(g.player(0), "poisoned")).toBe(false); // healthy again
    g.advancePhase();

    // Healthy virgin, townsfolk nominator — but the ability was spent while poisoned.
    nominate(g, 2, 0);
    expect(events(g, "virginTriggered")).toEqual([]);
    expect(g.player(2).alive).toBe(true);
    expect(g.phase).toBe("vote");
  });
});

// ── 6. Slayer ───────────────────────────────────────────────────────────────

describe("slayer", () => {
  it("slayer shoots the imp: imp dies publicly and good wins", () => {
    const g = make(BAG_SLAYER);
    expect(g.phase).toBe("day");
    g.submit(0, { type: "slayerShot", target: 6 });
    expect(events(g, "slayerShot")).toEqual([{ t: "slayerShot", slayer: 0, target: 6, died: true }]);
    expect(g.player(6).alive).toBe(false);
    expect(g.winner).toEqual({ team: "good", reason: "demonKilled" });
    expect(g.phase).toBe("gameOver");
  });

  it("slayer shoots a recluse registering as the demon: recluse dies, game continues", () => {
    const g = make(BAG_SLAYER, "day-tests", new RecluseIsDemonPolicy());
    g.submit(0, { type: "slayerShot", target: 3 });
    expect(events(g, "slayerShot")).toEqual([{ t: "slayerShot", slayer: 0, target: 3, died: true }]);
    expect(g.player(3).alive).toBe(false);
    expect(events(g, "death")).toContainEqual({
      t: "death",
      seat: 3,
      cause: { kind: "slayer", slayer: 0 },
    });
    expect(g.winner).toBeNull();
    expect(g.phase).toBe("day"); // the day goes on
  });

  it("slayer shoots a plain townsfolk: nothing happens, and the shot is spent (second shot throws)", () => {
    const g = make(BAG_SLAYER);
    g.submit(0, { type: "slayerShot", target: 2 }); // the soldier
    expect(events(g, "slayerShot")).toEqual([{ t: "slayerShot", slayer: 0, target: 2, died: false }]);
    expect(g.player(2).alive).toBe(true);
    expect(g.winner).toBeNull();
    expect(hasStatus(g.player(0), "slayerSpent")).toBe(true);
    expect(() => g.submit(0, { type: "slayerShot", target: 6 })).toThrow(/already used/);
  });

  it("a POISONED slayer's shot on the imp does nothing — and the power is still spent", () => {
    const g = make(BAG_SLAYER_POISON);
    g.submit(5, { type: "nightChoice", seats: [0] }); // poison the slayer
    expect(g.phase).toBe("day");
    g.submit(0, { type: "slayerShot", target: 6 });
    expect(events(g, "slayerShot")).toEqual([{ t: "slayerShot", slayer: 0, target: 6, died: false }]);
    expect(g.player(6).alive).toBe(true);
    expect(g.winner).toBeNull();
    expect(hasStatus(g.player(0), "slayerSpent")).toBe(true);
    expect(() => g.submit(0, { type: "slayerShot", target: 6 })).toThrow(/already used/);
  });

  it("the DRUNK who believes they are the slayer can press the button; nothing happens", () => {
    const g = make(BAG_DRUNK, "day-tests", new DrunkThinksSlayerPolicy());
    expect(g.player(3).believedCharacterId).toBe("slayer");
    expect(g.phase).toBe("day");
    g.submit(3, { type: "slayerShot", target: 5 }); // "shoots" the imp
    expect(events(g, "slayerShot")).toEqual([{ t: "slayerShot", slayer: 3, target: 5, died: false }]);
    expect(g.player(5).alive).toBe(true);
    expect(g.winner).toBeNull();
    expect(hasStatus(g.player(3), "slayerSpent")).toBe(true); // spent all the same
  });

  it("a dead slayer cannot shoot", () => {
    const g = make(BAG_SLAYER);
    g.advancePhase();
    nominate(g, 1, 0);
    runVote(g, [1, 2, 3, 4]); // execute the slayer
    g.advancePhase(); // → night 2
    g.submit(6, { type: "nightChoice", seats: [1] }); // imp kills the chef
    expect(g.day).toBe(2);
    expect(() => g.submit(0, { type: "slayerShot", target: 6 })).toThrow(/Dead players cannot act/);
  });
});

// ── 7. Mayor (3 alive, no execution) ────────────────────────────────────────

/** BAG_PLAIN, played down to 3 alive: mayor (1), baron (5), imp (6) on day 3. */
function playToThreeAlive(): Game {
  const g = make(BAG_PLAIN);
  g.advancePhase();
  nominate(g, 0, 3);
  runVote(g, [0, 1, 2, 6]); // execute the recluse
  g.advancePhase(); // → night 2
  g.submit(6, { type: "nightChoice", seats: [0] }); // imp kills the chef
  expect(g.day).toBe(2);
  g.advancePhase();
  nominate(g, 4, 2);
  runVote(g, [4, 5, 6]); // 3 of 5 alive → execute the soldier
  g.advancePhase(); // → night 3
  g.submit(6, { type: "nightChoice", seats: [4] }); // imp kills the saint
  expect(g.day).toBe(3);
  expect(g.alivePlayers().map((p) => p.seat)).toEqual([1, 5, 6]);
  return g;
}

describe("mayor", () => {
  it("exactly 3 alive and the day ends with no execution → good wins at dusk", () => {
    const g = playToThreeAlive();
    g.advancePhase(); // day → nominations
    g.advancePhase(); // close nominations: no execution → dusk → mayor win
    expect(g.winner).toEqual({ team: "good", reason: "mayorNoExecution" });
    expect(g.phase).toBe("gameOver");
  });

  it("a POISONED mayor at 3 alive with no execution → no win, the game continues", () => {
    const g = make(BAG_MAYOR_POISON);
    // seats: 0 chef, 1 mayor, 2 soldier, 3 slayer, 4 virgin, 5 poisoner, 6 imp
    g.submit(5, { type: "nightChoice", seats: [0] }); // night 1 poison (irrelevant)
    g.advancePhase();
    nominate(g, 0, 3);
    runVote(g, [0, 1, 2, 6]); // execute the slayer
    g.advancePhase(); // → night 2
    g.submit(5, { type: "nightChoice", seats: [0] });
    g.submit(6, { type: "nightChoice", seats: [4] }); // imp kills the virgin
    expect(g.day).toBe(2);
    g.advancePhase();
    nominate(g, 0, 2);
    runVote(g, [0, 1, 6]); // 3 of 5 alive → execute the soldier
    g.advancePhase(); // → night 3
    g.submit(5, { type: "nightChoice", seats: [1] }); // poison the MAYOR
    g.submit(6, { type: "nightChoice", seats: [0] }); // imp kills the chef
    expect(g.day).toBe(3);
    expect(g.alivePlayers().map((p) => p.seat)).toEqual([1, 5, 6]);
    expect(hasStatus(g.player(1), "poisoned")).toBe(true);

    g.advancePhase(); // → nominations
    g.advancePhase(); // no execution → dusk: mayor is poisoned → no win
    expect(g.winner).toBeNull();
    expect(g.phase).toBe("night");
    expect(g.night).toBe(4);
  });

  it("3 alive WITH an execution → no mayor win (executing a non-demon leaves 2 → evil wins)", () => {
    const g = playToThreeAlive();
    g.advancePhase();
    nominate(g, 1, 5); // mayor nominates the baron
    runVote(g, [1, 6]); // 2 of 3 alive → about to die
    g.advancePhase(); // baron executed → 2 left with a living demon
    expect(g.winner).toEqual({ team: "evil", reason: "twoPlayersLeft" });
    expect(g.winner?.reason).not.toBe("mayorNoExecution");
  });

  it("4+ alive with no execution → no mayor win", () => {
    const g = make(BAG_PLAIN); // 7 alive, mayor healthy
    g.advancePhase();
    g.advancePhase(); // day 1 ends with no execution
    expect(g.winner).toBeNull();
    expect(g.night).toBe(2);
  });
});

// ── 8/9. Nomination closing and self-nomination ─────────────────────────────

describe("nomination flow", () => {
  it("nominations close automatically once every alive player has nominated or passed", () => {
    const g = make(BAG_PLAIN);
    g.advancePhase();
    nominate(g, 0, 3);
    runVote(g, [0, 1, 2, 5]); // recluse about to die

    // Everyone else passes — no advancePhase() call at all.
    for (const s of [1, 2, 3, 4, 5, 6]) g.submit(s, { type: "passNomination" });

    expect(g.player(3).alive).toBe(false); // execution resolved on its own
    expect(events(g, "execution")).toEqual([{ t: "execution", seat: 3 }]);
    expect(g.phase).toBe("night");
    expect(g.night).toBe(2);
  });

  it("self-nomination is legal", () => {
    const g = make(BAG_PLAIN);
    g.advancePhase();
    nominate(g, 2, 2);
    expect(events(g, "nomination")).toEqual([{ t: "nomination", nominator: 2, nominee: 2 }]);
    expect(g.phase).toBe("vote");
    expect(votePending(g)).toMatchObject({ nominator: 2, nominee: 2 });
    runVote(g, [0, 1, 2, 4]); // the nominee may vote for themself
    expect(lastVoteResult(g).outcome).toBe("aboutToDie");
    g.advancePhase();
    expect(g.player(2).alive).toBe(false);
  });
});
