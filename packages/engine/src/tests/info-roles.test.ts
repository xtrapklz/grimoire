// Golden tests for the Trouble Brewing INFO ROLES: Washerwoman, Librarian,
// Investigator, Chef, Empath, Fortune Teller, Undertaker, Ravenkeeper — plus
// the Drunk/poison malfunction paths and Spy/Recluse misregistration effects
// on each of them.
//
// Every test is deterministic: seeded games, forced seating, and a TestPolicy
// subclass that pins down each storyteller judgment call (misregistration,
// red herring, drunk's believed role, false info) that the DefaultPolicy
// would otherwise randomize.

import { describe, expect, it } from "vitest";
import { Game } from "../game.js";
import { DefaultPolicy, type PolicyView } from "../policy.js";
import type { CharId, Info, Player } from "../types.js";
import type { Rng } from "../rng.js";

// ── Deterministic storyteller policy ────────────────────────────────────────

interface TestPolicyConfig {
  /** Force Spy registration: good (with spyChar) or evil (actual spy). */
  spyGood?: boolean;
  spyChar?: CharId;
  /** Force Recluse registration. */
  recluseEvil?: boolean;
  recluseDemon?: boolean;
  recluseChar?: CharId;
  /** Force the Fortune Teller's red herring seat. */
  herringSeat?: number;
  /** Force which Townsfolk the Drunk believes they are (must not be in play). */
  drunkRole?: CharId;
  /** Force malfunction info. Return null = "show them the truth anyway". */
  falseInfo?: (
    view: PolicyView,
    player: Player,
    role: CharId,
    args: { targets?: number[]; executed?: number },
  ) => Info | null;
}

class TestPolicy extends DefaultPolicy {
  constructor(private readonly cfg: TestPolicyConfig = {}) {
    super();
  }
  override spyRegistersAsGood(view: PolicyView): boolean {
    return this.cfg.spyGood ?? super.spyRegistersAsGood(view);
  }
  override spyRegistersAsCharacter(view: PolicyView): CharId {
    return this.cfg.spyChar ?? super.spyRegistersAsCharacter(view);
  }
  override recluseRegistersAsEvil(view: PolicyView): boolean {
    return this.cfg.recluseEvil ?? super.recluseRegistersAsEvil(view);
  }
  override recluseRegistersAsDemon(view: PolicyView): boolean {
    return this.cfg.recluseDemon ?? super.recluseRegistersAsDemon(view);
  }
  override recluseRegistersAsCharacter(view: PolicyView): CharId {
    return this.cfg.recluseChar ?? super.recluseRegistersAsCharacter(view);
  }
  override redHerring(view: PolicyView, ftSeat: number): number {
    return this.cfg.herringSeat ?? super.redHerring(view, ftSeat);
  }
  override drunkBelievedRole(rng: Rng, inPlay: CharId[]): CharId {
    return this.cfg.drunkRole ?? super.drunkBelievedRole(rng, inPlay);
  }
  override falseInfo(
    view: PolicyView,
    player: Player,
    role: CharId,
    args: { targets?: number[]; executed?: number },
  ): Info | null {
    if (this.cfg.falseInfo) return this.cfg.falseInfo(view, player, role, args);
    return super.falseInfo(view, player, role, args);
  }
  /** Determinism: the Imp killing the Mayor never bounces in these tests. */
  override mayorBounce(): number | null {
    return null;
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function names(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `P${i}`);
}

function makeGame(seating: CharId[], seed: string, policy?: TestPolicy): Game {
  return new Game(
    {
      seed,
      playerNames: names(seating.length),
      forcedCharacters: seating,
      forcedSeating: seating,
    },
    policy ?? new TestPolicy(),
  );
}

function infosOf<T extends Info["type"]>(
  g: Game,
  seat: number,
  type: T,
): Array<Extract<Info, { type: T }>> {
  return g.inbox(seat).filter((i): i is Extract<Info, { type: T }> => i.type === type);
}

function lastInfoOf<T extends Info["type"]>(g: Game, seat: number, type: T): Extract<Info, { type: T }> {
  const all = infosOf(g, seat, type);
  if (all.length === 0) throw new Error(`no "${type}" info in seat ${seat}'s inbox`);
  return all[all.length - 1]!;
}

function expectNightPrompt(g: Game, seat: number, characterId?: CharId): void {
  const p = g.pending;
  if (p?.kind !== "nightAction") {
    throw new Error(`expected nightAction for seat ${seat}, got ${JSON.stringify(p)}`);
  }
  expect(p.seat).toBe(seat);
  if (characterId) expect(p.prompt.characterId).toBe(characterId);
}

/** Open nominations, nominate, everyone votes yes, close the day. */
function executeSeat(g: Game, nominator: number, nominee: number): void {
  if (g.pending?.kind === "day") g.advancePhase();
  g.submit(nominator, { type: "nominate", nominee });
  const pend = g.pending;
  if (pend?.kind !== "vote") throw new Error("expected a vote to be pending");
  for (const s of [...pend.awaiting]) g.submit(s, { type: "vote", vote: true });
  g.advancePhase(); // nominations → execution → dusk → next night
}

/** Day passes with no nomination at all (no execution). */
function passDay(g: Game): void {
  g.advancePhase(); // day → nominations
  g.advancePhase(); // nominations → (no execution) → dusk → night
}

// ── Washerwoman / Librarian / Investigator ──────────────────────────────────

describe("Washerwoman", () => {
  it("true info: shown character is an actual in-play Townsfolk and matches a candidate", () => {
    // No Spy/Recluse/Drunk in play → no misregistration is possible at all.
    const seating: CharId[] = ["washerwoman", "chef", "empath", "mayor", "slayer", "scarletwoman", "imp"];
    for (const seed of ["ww-true-1", "ww-true-2", "ww-true-3", "ww-true-4"]) {
      const g = makeGame(seating, seed);
      const info = lastInfoOf(g, 0, "washerwoman");
      expect(info.candidates).toHaveLength(2);
      expect(info.candidates[0]).not.toBe(info.candidates[1]);
      expect(info.candidates).not.toContain(0); // never includes herself
      // The target is among the candidates: some candidate really IS that Townsfolk.
      const actual = info.candidates.filter((s) => g.player(s).characterId === info.characterId);
      expect(actual.length).toBeGreaterThan(0);
      expect(["chef", "empath", "mayor", "slayer"]).toContain(info.characterId);
    }
  });
});

describe("Librarian", () => {
  it("shows the Drunk as the DRUNK (actual character), not their believed Townsfolk", () => {
    // 6p: 3 townsfolk / 1 outsider (drunk) / 1 minion / 1 demon.
    const seating: CharId[] = ["librarian", "chef", "soldier", "drunk", "scarletwoman", "imp"];
    const g = makeGame(seating, "lib-drunk-1", new TestPolicy({ drunkRole: "mayor" }));
    const info = lastInfoOf(g, 0, "librarian");
    expect(info.characterId).toBe("drunk"); // famously the actual character, never "mayor"
    expect(info.candidates).toContain(3);
    expect(info.candidates).not.toContain(0);
  });

  it("learns 'no outsiders' when none are in play", () => {
    const seating: CharId[] = ["librarian", "chef", "soldier", "mayor", "slayer", "scarletwoman", "imp"];
    const g = makeGame(seating, "lib-none-1");
    expect(lastInfoOf(g, 0, "librarianNone")).toEqual({ type: "librarianNone" });
    expect(infosOf(g, 0, "librarian")).toHaveLength(0);
  });
});

describe("Investigator", () => {
  it("shows an in-play Minion with that Minion among the candidates", () => {
    // Baron game: 7p becomes 3 townsfolk / 2 outsiders / baron / imp.
    // Baron is the only Minion → the target is forced, fully deterministic.
    const seating: CharId[] = ["investigator", "empath", "chef", "saint", "drunk", "baron", "imp"];
    const g = makeGame(seating, "inv-minion-1", new TestPolicy({ drunkRole: "mayor" }));
    const info = lastInfoOf(g, 0, "investigator");
    expect(info.characterId).toBe("baron");
    expect(info.candidates).toContain(5);
    expect(info.candidates).not.toContain(0);
  });
});

describe("Spy misregistration to the info trio", () => {
  it("washerwoman can be shown the Spy as a Townsfolk when the Spy registers good", () => {
    // "chef" is NOT in the bag — only the Spy (forced to register as the Chef)
    // can produce that ping, proving the Spy was the Washerwoman's target.
    const seating: CharId[] = ["washerwoman", "empath", "undertaker", "spy", "imp"];
    let shownSpyAsChef = false;
    for (let i = 0; i < 40; i++) {
      const g = makeGame(
        seating,
        `spy-ww-${i}`,
        new TestPolicy({ spyGood: true, spyChar: "chef" }),
      );
      const info = lastInfoOf(g, 0, "washerwoman");
      if (info.characterId === "chef") {
        expect(info.candidates).toContain(3); // the Spy must be a candidate
        shownSpyAsChef = true;
      } else {
        // Otherwise it must be honest info about a real Townsfolk.
        const match = info.candidates.some((s) => g.player(s).characterId === info.characterId);
        expect(match).toBe(true);
      }
    }
    expect(shownSpyAsChef).toBe(true);
  });

  it("investigator sees the Spy as 'spy' when the Spy registers evil", () => {
    const seating: CharId[] = ["investigator", "empath", "chef", "spy", "imp"];
    const g = makeGame(seating, "spy-inv-1", new TestPolicy({ spyGood: false }));
    const info = lastInfoOf(g, 0, "investigator");
    expect(info.characterId).toBe("spy");
    expect(info.candidates).toContain(3);
  });
});

// ── Chef ────────────────────────────────────────────────────────────────────

describe("Chef", () => {
  it("counts 1 for one adjacent evil pair", () => {
    // Poisoner(5) and Imp(6) sit together; the wrap 6→0 pairs evil with good.
    const seating: CharId[] = ["chef", "soldier", "empath", "mayor", "slayer", "poisoner", "imp"];
    const g = makeGame(seating, "chef-adj-1");
    expectNightPrompt(g, 5, "poisoner");
    g.submit(5, { type: "nightChoice", seats: [1] }); // poison the Soldier (irrelevant to Chef)
    expect(lastInfoOf(g, 0, "chef")).toEqual({ type: "chef", count: 1 });
  });

  it("counts 0 when the evils are separated", () => {
    const seating: CharId[] = ["chef", "soldier", "poisoner", "mayor", "slayer", "imp", "empath"];
    const g = makeGame(seating, "chef-sep-1");
    expectNightPrompt(g, 2, "poisoner");
    g.submit(2, { type: "nightChoice", seats: [1] });
    expect(lastInfoOf(g, 0, "chef")).toEqual({ type: "chef", count: 0 });
  });

  it("counts 2 for three evils in a row (10 players, 2 minions)", () => {
    // 10p: 7 townsfolk / 0 outsiders / 2 minions / 1 demon.
    const seating: CharId[] = [
      "chef", "soldier", "mayor", "slayer", "virgin",
      "monk", "ravenkeeper", "poisoner", "scarletwoman", "imp",
    ];
    const g = makeGame(seating, "chef-row-1");
    expectNightPrompt(g, 7, "poisoner");
    g.submit(7, { type: "nightChoice", seats: [1] });
    // Evil pairs: (7,8) and (8,9); wrap (9,0) is evil–good.
    expect(lastInfoOf(g, 0, "chef")).toEqual({ type: "chef", count: 2 });
  });

  it("a Recluse forced to register evil next to the Imp adds a pair", () => {
    // Evils are Imp(3) and ScarletWoman(5) — not adjacent, so any pair must
    // come from the Recluse(2) registering evil beside the Imp.
    const seating: CharId[] = ["chef", "soldier", "recluse", "imp", "mayor", "scarletwoman"];
    const evil = makeGame(
      seating,
      "chef-recluse-1",
      new TestPolicy({ recluseEvil: true, recluseDemon: false, recluseChar: "poisoner" }),
    );
    expect(lastInfoOf(evil, 0, "chef")).toEqual({ type: "chef", count: 1 });

    const clean = makeGame(seating, "chef-recluse-2", new TestPolicy({ recluseEvil: false }));
    expect(lastInfoOf(clean, 0, "chef")).toEqual({ type: "chef", count: 0 });
  });
});

// ── Empath ──────────────────────────────────────────────────────────────────

describe("Empath", () => {
  it("counts evil living neighbors, skipping dead players to the next living one", () => {
    const seating: CharId[] = ["empath", "soldier", "poisoner", "chef", "mayor", "slayer", "imp"];
    const g = makeGame(seating, "empath-skip-1");

    // Night 1: neighbors are Soldier(1, good) and Imp(6, evil) → 1.
    expectNightPrompt(g, 2, "poisoner");
    g.submit(2, { type: "nightChoice", seats: [5] }); // poison the Slayer (irrelevant)
    expect(lastInfoOf(g, 0, "empath")).toEqual({ type: "empath", count: 1 });

    // Day 1: execute the Soldier — the Empath's living neighbor becomes the Poisoner.
    executeSeat(g, 3, 1);
    expect(g.player(1).alive).toBe(false);

    // Night 2: poisoner acts, imp kills the Slayer; Empath now reads
    // Poisoner(2, evil) + Imp(6, evil) → 2.
    expectNightPrompt(g, 2, "poisoner");
    g.submit(2, { type: "nightChoice", seats: [5] });
    expectNightPrompt(g, 6, "imp");
    g.submit(6, { type: "nightChoice", seats: [5] });
    expect(lastInfoOf(g, 0, "empath")).toEqual({ type: "empath", count: 2 });
    expect(infosOf(g, 0, "empath").map((i) => i.count)).toEqual([1, 2]);
  });

  it("a Spy neighbor registering good is not counted; registering evil is", () => {
    const seating: CharId[] = ["spy", "empath", "chef", "imp", "soldier"];
    const asGood = makeGame(seating, "empath-spy-1", new TestPolicy({ spyGood: true, spyChar: "butler" }));
    expect(lastInfoOf(asGood, 1, "empath")).toEqual({ type: "empath", count: 0 });

    const asEvil = makeGame(seating, "empath-spy-2", new TestPolicy({ spyGood: false }));
    expect(lastInfoOf(asEvil, 1, "empath")).toEqual({ type: "empath", count: 1 });
  });

  it("a Recluse neighbor counts only when registering evil", () => {
    const seating: CharId[] = ["recluse", "empath", "chef", "soldier", "imp", "scarletwoman"];
    const evil = makeGame(
      seating,
      "empath-recluse-1",
      new TestPolicy({ recluseEvil: true, recluseDemon: false, recluseChar: "poisoner" }),
    );
    expect(lastInfoOf(evil, 1, "empath")).toEqual({ type: "empath", count: 1 });

    const clean = makeGame(seating, "empath-recluse-2", new TestPolicy({ recluseEvil: false }));
    expect(lastInfoOf(clean, 1, "empath")).toEqual({ type: "empath", count: 0 });
  });
});

// ── Fortune Teller ──────────────────────────────────────────────────────────

describe("Fortune Teller", () => {
  const seating: CharId[] = ["fortuneteller", "chef", "soldier", "mayor", "slayer", "scarletwoman", "imp"];
  const policy = () => new TestPolicy({ herringSeat: 3 }); // Mayor is the red herring

  it("reads YES when a chosen player is the Demon", () => {
    const g = makeGame(seating, "ft-demon-1", policy());
    expectNightPrompt(g, 0, "fortuneteller");
    g.submit(0, { type: "nightChoice", seats: [6, 1] });
    expect(lastInfoOf(g, 0, "fortuneteller")).toEqual({
      type: "fortuneteller",
      targets: [6, 1],
      isDemon: true,
    });
  });

  it("reads YES when a chosen player is the red herring", () => {
    const g = makeGame(seating, "ft-herring-1", policy());
    expectNightPrompt(g, 0, "fortuneteller");
    g.submit(0, { type: "nightChoice", seats: [3, 1] });
    expect(lastInfoOf(g, 0, "fortuneteller")).toEqual({
      type: "fortuneteller",
      targets: [3, 1],
      isDemon: true,
    });
  });

  it("reads NO on two clean good players", () => {
    // No Spy/Recluse in play and the herring is pinned elsewhere: no
    // misregistration can occur on Chef + Soldier.
    const g = makeGame(seating, "ft-clean-1", policy());
    expectNightPrompt(g, 0, "fortuneteller");
    g.submit(0, { type: "nightChoice", seats: [1, 2] });
    expect(lastInfoOf(g, 0, "fortuneteller")).toEqual({
      type: "fortuneteller",
      targets: [1, 2],
      isDemon: false,
    });
  });

  // ENGINE BUG: the official Fortune Teller "may choose any two players — alive
  // or dead, or even themself" (wiki example: "The Fortune Teller chooses an
  // alive Butler and a dead Imp, and learns a 'yes'"). The engine forbids dead
  // targets: characters.ts:146 declares `choose: { count: 2, allowSelf: true,
  // allowDead: false }`, so Game.handleNightChoice (game.ts:324) throws
  // "Must choose a living player" instead of delivering the reading.
  it("may choose a dead player and still gets a reading (official rules)", () => {
    const g = makeGame(seating, "ft-dead-1", policy());
    expectNightPrompt(g, 0, "fortuneteller");
    g.submit(0, { type: "nightChoice", seats: [1, 2] }); // night 1: routine reading
    executeSeat(g, 2, 1); // day 1: execute the Chef

    // Night 2: imp kills the Slayer, then the Fortune Teller reads the
    // dead Chef together with the living Imp → official answer is YES.
    expectNightPrompt(g, 6, "imp");
    g.submit(6, { type: "nightChoice", seats: [4] });
    expectNightPrompt(g, 0, "fortuneteller");
    g.submit(0, { type: "nightChoice", seats: [1, 6] });
    expect(lastInfoOf(g, 0, "fortuneteller")).toEqual({
      type: "fortuneteller",
      targets: [1, 6],
      isDemon: true,
    });
  });

  it("a Recluse forced to register as the Demon reads YES; otherwise NO", () => {
    const seating6: CharId[] = ["fortuneteller", "chef", "soldier", "recluse", "scarletwoman", "imp"];
    const yes = makeGame(
      seating6,
      "ft-recluse-1",
      new TestPolicy({ herringSeat: 1, recluseEvil: true, recluseDemon: true }),
    );
    expectNightPrompt(yes, 0, "fortuneteller");
    yes.submit(0, { type: "nightChoice", seats: [3, 2] });
    expect(lastInfoOf(yes, 0, "fortuneteller").isDemon).toBe(true);

    const no = makeGame(
      seating6,
      "ft-recluse-2",
      new TestPolicy({ herringSeat: 1, recluseEvil: false, recluseDemon: false }),
    );
    expectNightPrompt(no, 0, "fortuneteller");
    no.submit(0, { type: "nightChoice", seats: [3, 2] });
    expect(lastInfoOf(no, 0, "fortuneteller").isDemon).toBe(false);
  });
});

// ── Undertaker ──────────────────────────────────────────────────────────────

describe("Undertaker", () => {
  it("wakes only after an execution day and learns the executed character", () => {
    const seating: CharId[] = ["undertaker", "chef", "soldier", "mayor", "slayer", "scarletwoman", "imp"];
    const g = makeGame(seating, "ut-basic-1");
    expect(g.phase).toBe("day");
    expect(infosOf(g, 0, "undertaker")).toHaveLength(0); // never on night 1

    // Day 1: execute the Chef.
    executeSeat(g, 2, 1);

    // Night 2: imp kills, then the Undertaker learns the Chef.
    expectNightPrompt(g, 6, "imp");
    g.submit(6, { type: "nightChoice", seats: [4] });
    expect(lastInfoOf(g, 0, "undertaker")).toEqual({
      type: "undertaker",
      executed: 1,
      characterId: "chef",
    });

    // Day 2 passes with NO execution → the Undertaker does not wake night 3.
    passDay(g);
    expectNightPrompt(g, 6, "imp");
    g.submit(6, { type: "nightChoice", seats: [3] });
    expect(g.phase).toBe("day");
    expect(infosOf(g, 0, "undertaker")).toHaveLength(1); // still just the one reading
  });

  it("shows the executed Drunk as the DRUNK, not their believed role", () => {
    const seating: CharId[] = ["undertaker", "chef", "soldier", "drunk", "scarletwoman", "imp"];
    const g = makeGame(seating, "ut-drunk-1", new TestPolicy({ drunkRole: "mayor" }));
    executeSeat(g, 1, 3);
    expectNightPrompt(g, 5, "imp");
    g.submit(5, { type: "nightChoice", seats: [2] });
    expect(lastInfoOf(g, 0, "undertaker")).toEqual({
      type: "undertaker",
      executed: 3,
      characterId: "drunk",
    });
  });

  it("executed Spy: shown per forced registration (good → forced char, evil → 'spy')", () => {
    const seating: CharId[] = ["undertaker", "chef", "soldier", "mayor", "slayer", "spy", "imp"];

    const asGood = makeGame(seating, "ut-spy-1", new TestPolicy({ spyGood: true, spyChar: "librarian" }));
    executeSeat(asGood, 1, 5);
    expectNightPrompt(asGood, 6, "imp");
    asGood.submit(6, { type: "nightChoice", seats: [4] });
    expect(lastInfoOf(asGood, 0, "undertaker")).toEqual({
      type: "undertaker",
      executed: 5,
      characterId: "librarian",
    });

    const asEvil = makeGame(seating, "ut-spy-2", new TestPolicy({ spyGood: false }));
    executeSeat(asEvil, 1, 5);
    expectNightPrompt(asEvil, 6, "imp");
    asEvil.submit(6, { type: "nightChoice", seats: [4] });
    expect(lastInfoOf(asEvil, 0, "undertaker")).toEqual({
      type: "undertaker",
      executed: 5,
      characterId: "spy",
    });
  });

  it("a Virgin-triggered execution counts: the nominator is shown to the Undertaker", () => {
    const seating: CharId[] = ["undertaker", "virgin", "chef", "soldier", "mayor", "scarletwoman", "imp"];
    const g = makeGame(seating, "ut-virgin-1");
    g.advancePhase(); // day → nominations
    g.submit(2, { type: "nominate", nominee: 1 }); // Chef nominates the Virgin
    expect(g.events.some((e) => e.t === "virginTriggered" && e.nominator === 2)).toBe(true);
    expect(g.player(2).alive).toBe(false);

    // The Virgin's proc ended the day immediately → night 2.
    expectNightPrompt(g, 6, "imp");
    g.submit(6, { type: "nightChoice", seats: [3] });
    expect(lastInfoOf(g, 0, "undertaker")).toEqual({
      type: "undertaker",
      executed: 2,
      characterId: "chef",
    });
  });
});

// ── Ravenkeeper ─────────────────────────────────────────────────────────────

describe("Ravenkeeper", () => {
  const seating: CharId[] = ["ravenkeeper", "chef", "soldier", "mayor", "slayer", "scarletwoman", "imp"];

  it("dies at night → is prompted and learns the chosen player's character", () => {
    const g = makeGame(seating, "rk-dies-1");
    passDay(g); // day 1: nothing happens
    expectNightPrompt(g, 6, "imp");
    g.submit(6, { type: "nightChoice", seats: [0] }); // imp kills the Ravenkeeper
    expect(g.player(0).alive).toBe(false);

    // Dead, but woken for the once-per-death ability.
    expectNightPrompt(g, 0, "ravenkeeper");
    g.submit(0, { type: "nightChoice", seats: [6] });
    expect(lastInfoOf(g, 0, "ravenkeeper")).toEqual({
      type: "ravenkeeper",
      target: 6,
      characterId: "imp",
    });
    expect(g.phase).toBe("day");
  });

  it("stays asleep (never prompted) when alive", () => {
    const g = makeGame(seating, "rk-alive-1");
    passDay(g);
    expectNightPrompt(g, 6, "imp");
    g.submit(6, { type: "nightChoice", seats: [1] }); // kill the Chef instead
    expect(g.phase).toBe("day"); // night ended without a Ravenkeeper prompt
    expect(infosOf(g, 0, "ravenkeeper")).toHaveLength(0);
  });

  it("poisoned Ravenkeeper killed by the Imp gets the policy's false info", () => {
    const withPoisoner: CharId[] = ["ravenkeeper", "chef", "soldier", "mayor", "slayer", "poisoner", "imp"];
    const g = makeGame(
      withPoisoner,
      "rk-poisoned-1",
      new TestPolicy({
        falseInfo: (_view, _player, role, args) =>
          role === "ravenkeeper"
            ? { type: "ravenkeeper", target: args.targets![0]!, characterId: "soldier" }
            : null,
      }),
    );
    expectNightPrompt(g, 5, "poisoner");
    g.submit(5, { type: "nightChoice", seats: [3] }); // night 1: poison the Mayor
    passDay(g);
    expectNightPrompt(g, 5, "poisoner");
    g.submit(5, { type: "nightChoice", seats: [0] }); // night 2: poison the Ravenkeeper
    expectNightPrompt(g, 6, "imp");
    g.submit(6, { type: "nightChoice", seats: [0] }); // and the Imp kills them
    expect(g.player(0).alive).toBe(false);

    // Prompted exactly like a healthy Ravenkeeper — but the info is the policy's lie.
    expectNightPrompt(g, 0, "ravenkeeper");
    g.submit(0, { type: "nightChoice", seats: [6] });
    expect(lastInfoOf(g, 0, "ravenkeeper")).toEqual({
      type: "ravenkeeper",
      target: 6,
      characterId: "soldier", // truth would be "imp"
    });
  });
});

// ── Drunk ───────────────────────────────────────────────────────────────────

describe("Drunk", () => {
  it("is woken and prompted as the believed character and receives policy info", () => {
    // Drunk believes they are the Fortune Teller (not in play) → gets the FT's
    // choose-2 prompt, and the reading comes from the policy, not the rules.
    const seating: CharId[] = ["empath", "chef", "soldier", "drunk", "scarletwoman", "imp"];
    const g = makeGame(
      seating,
      "drunk-ft-1",
      new TestPolicy({
        drunkRole: "fortuneteller",
        falseInfo: (_view, _player, role, args) =>
          role === "fortuneteller"
            ? { type: "fortuneteller", targets: args.targets as [number, number], isDemon: true }
            : null,
      }),
    );
    // Identity info shows the believed character.
    expect(g.inbox(3)[0]).toEqual({ type: "youAre", characterId: "fortuneteller", alignment: "good" });

    expectNightPrompt(g, 3, "fortuneteller");
    g.submit(3, { type: "nightChoice", seats: [0, 1] }); // two clean good players
    // Truth would be isDemon:false (no demon chosen and drunks get no herring):
    // the sentinel YES proves the info came from the policy.
    expect(lastInfoOf(g, 3, "fortuneteller")).toEqual({
      type: "fortuneteller",
      targets: [0, 1],
      isDemon: true,
    });
    expect(g.phase).toBe("day");
  });

  it("believing an info role, wakes automatically and gets the policy's sentinel info", () => {
    const seating: CharId[] = ["empath", "washerwoman", "soldier", "drunk", "scarletwoman", "imp"];
    const g = makeGame(
      seating,
      "drunk-chef-1",
      new TestPolicy({
        drunkRole: "chef",
        falseInfo: (_view, _player, role) =>
          role === "chef" ? { type: "chef", count: 42 } : null,
      }),
    );
    expect(g.inbox(3)[0]).toEqual({ type: "youAre", characterId: "chef", alignment: "good" });
    // A true Chef reading could never be 42: the sentinel proves the policy path.
    expect(lastInfoOf(g, 3, "chef")).toEqual({ type: "chef", count: 42 });
  });
});

// ── Poisoned info roles ─────────────────────────────────────────────────────

describe("Poisoned info roles", () => {
  const seating: CharId[] = ["empath", "chef", "soldier", "mayor", "slayer", "poisoner", "imp"];

  it("a poisoned Empath receives the policy's false info", () => {
    const g = makeGame(
      seating,
      "poison-empath-1",
      new TestPolicy({
        falseInfo: (_view, _player, role) =>
          role === "empath" ? { type: "empath", count: 99 } : null,
      }),
    );
    expectNightPrompt(g, 5, "poisoner");
    g.submit(5, { type: "nightChoice", seats: [0] }); // poison the Empath
    expect(lastInfoOf(g, 0, "empath")).toEqual({ type: "empath", count: 99 });
  });

  it("policy returning null shows the poisoned player the TRUE info (classic ST move)", () => {
    let policyConsulted = false;
    const g = makeGame(
      seating,
      "poison-truth-1",
      new TestPolicy({
        falseInfo: () => {
          policyConsulted = true;
          return null; // storyteller declines to lie
        },
      }),
    );
    expectNightPrompt(g, 5, "poisoner");
    g.submit(5, { type: "nightChoice", seats: [0] }); // poison the Empath
    expect(policyConsulted).toBe(true);
    // True reading: neighbors are Chef(1, good) and Imp(6, evil) → 1.
    expect(lastInfoOf(g, 0, "empath")).toEqual({ type: "empath", count: 1 });
  });
});
