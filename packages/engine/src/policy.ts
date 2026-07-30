// The storyteller policy: every decision the rules delegate to a human
// storyteller, extracted behind an interface. The default implementation is
// procedural and seeded. Swapping in a different policy (harsher, kinder,
// LLM-advised) never touches the rules engine.

import { character, charactersOfTeam, type TeamComposition } from "./data.js";
import type { Rng } from "./rng.js";
import type { CharId, Info, Player } from "./types.js";

/** Omniscient snapshot the policy may inspect (it is the storyteller, after all). */
export interface PolicyView {
  rng: Rng;
  night: number;
  players: ReadonlyArray<Player>;
  /** Actual characters in the bag this game. */
  inPlay: CharId[];
}

export interface PolicyOptions {
  /**
   * 0..1 — how misleading false info and misregistration lean. Low: gentle,
   * mostly random noise. High: actively frames good players and shields evil.
   */
  deviousness: number;
  /** Chance a malfunctioning info role is shown the truth anyway (classic ST move). */
  truthWhilePoisonedChance: number;
}

export const DEFAULT_POLICY_OPTIONS: PolicyOptions = {
  deviousness: 0.6,
  truthWhilePoisonedChance: 0.1,
};

export interface StorytellerPolicy {
  /** Which characters go in the bag (composition already Baron-adjusted by caller contract below). */
  selectBag(rng: Rng, composition: TeamComposition): CharId[];
  /** Which Townsfolk the Drunk believes they are (must not be in play). */
  drunkBelievedRole(rng: Rng, inPlay: CharId[]): CharId;
  /** Fortune Teller's red herring: seat of a good player (may be the FT). */
  redHerring(view: PolicyView, ftSeat: number): number;
  /** Three good characters not in play, shown to the demon as safe bluffs. */
  demonBluffs(rng: Rng, inPlay: CharId[]): CharId[];

  // Per-query misregistration (asked once per info generation / trigger check).
  recluseRegistersAsEvil(view: PolicyView, seat: number, asker: CharId): boolean;
  recluseRegistersAsDemon(view: PolicyView, seat: number, asker: CharId): boolean;
  recluseRegistersAsCharacter(view: PolicyView, seat: number, asker: CharId): CharId;
  spyRegistersAsGood(view: PolicyView, seat: number, asker: CharId): boolean;
  spyRegistersAsCharacter(view: PolicyView, seat: number, asker: CharId): CharId;

  /**
   * Info for a malfunctioning (drunk/poisoned) info role. Return null to show
   * them the TRUE info anyway — the engine falls back to the real generator.
   */
  falseInfo(
    view: PolicyView,
    player: Player,
    role: CharId,
    args: { targets?: number[]; executed?: number },
  ): Info | null;

  /** Demon killed the Mayor: bounce the kill to this seat instead, or null to let it stand. */
  mayorBounce(view: PolicyView, mayorSeat: number, impSeat: number): number | null;
  /** Imp self-kill: which alive minion inherits (Scarlet Woman first is convention). */
  starPassRecipient(view: PolicyView, candidates: number[]): number;
}

// ── Default procedural policy ───────────────────────────────────────────────

export class DefaultPolicy implements StorytellerPolicy {
  constructor(readonly opts: PolicyOptions = DEFAULT_POLICY_OPTIONS) {}

  selectBag(rng: Rng, comp: TeamComposition): CharId[] {
    const minions = rng.sample(charactersOfTeam("minion").map((c) => c.id), comp.minion);
    let outsiderCount = comp.outsider;
    let townsfolkCount = comp.townsfolk;
    if (minions.includes("baron")) {
      outsiderCount += 2;
      townsfolkCount -= 2;
    }
    const outsiders = rng.sample(charactersOfTeam("outsider").map((c) => c.id), outsiderCount);
    const townsfolk = rng.sample(charactersOfTeam("townsfolk").map((c) => c.id), townsfolkCount);
    return [...townsfolk, ...outsiders, ...minions, "imp"];
  }

  drunkBelievedRole(rng: Rng, inPlay: CharId[]): CharId {
    const candidates = charactersOfTeam("townsfolk")
      .map((c) => c.id)
      .filter((id) => !inPlay.includes(id));
    return rng.pick(candidates);
  }

  redHerring(view: PolicyView, ftSeat: number): number {
    const goods = view.players.filter((p) => p.alignment === "good");
    return view.rng.pick(goods).seat;
  }

  demonBluffs(rng: Rng, inPlay: CharId[]): CharId[] {
    const candidates = [...charactersOfTeam("townsfolk"), ...charactersOfTeam("outsider")]
      .map((c) => c.id)
      .filter((id) => !inPlay.includes(id) && id !== "drunk");
    return rng.sample(candidates, 3);
  }

  // A Recluse that always pings evil is a dead giveaway; lean on deviousness.
  recluseRegistersAsEvil(view: PolicyView): boolean {
    return view.rng.chance(0.5 + this.opts.deviousness * 0.3);
  }
  recluseRegistersAsDemon(view: PolicyView): boolean {
    return view.rng.chance(0.25 + this.opts.deviousness * 0.25);
  }
  recluseRegistersAsCharacter(view: PolicyView): CharId {
    // Which MINION the Recluse shows as (demon case is handled via recluseRegistersAsDemon).
    return view.rng.pick(charactersOfTeam("minion").map((c) => c.id));
  }
  spyRegistersAsGood(view: PolicyView): boolean {
    return view.rng.chance(0.5 + this.opts.deviousness * 0.4);
  }
  spyRegistersAsCharacter(view: PolicyView): CharId {
    const good = [...charactersOfTeam("townsfolk"), ...charactersOfTeam("outsider")].map((c) => c.id);
    return view.rng.pick(good);
  }

  falseInfo(
    view: PolicyView,
    player: Player,
    role: CharId,
    args: { targets?: number[]; executed?: number },
  ): Info | null {
    const { rng } = view;
    if (rng.chance(this.opts.truthWhilePoisonedChance)) return null;

    const others = view.players.filter((p) => p.seat !== player.seat);
    const devious = rng.chance(this.opts.deviousness);
    const evilSeats = others.filter((p) => p.alignment === "evil");
    const goodSeats = others.filter((p) => p.alignment === "good");

    // Prefer pointing suspicion at good players / away from evil when devious.
    const frameTarget = () =>
      devious && goodSeats.length > 0 ? rng.pick(goodSeats) : rng.pick(others);
    const shieldTarget = () =>
      devious && evilSeats.length > 0 ? rng.pick(evilSeats) : rng.pick(others);

    switch (role) {
      case "washerwoman": {
        const shown = shieldTarget(); // an evil player "confirmed" as townsfolk
        const decoy = rng.pick(others.filter((p) => p.seat !== shown.seat));
        const char = rng.pick(charactersOfTeam("townsfolk")).id;
        return { type: "washerwoman", characterId: char, candidates: [shown.seat, decoy.seat] };
      }
      case "librarian": {
        if (rng.chance(0.15)) return { type: "librarianNone" };
        const shown = rng.pick(others);
        const decoy = rng.pick(others.filter((p) => p.seat !== shown.seat));
        const char = rng.pick(charactersOfTeam("outsider")).id;
        return { type: "librarian", characterId: char, candidates: [shown.seat, decoy.seat] };
      }
      case "investigator": {
        const framed = frameTarget(); // a good player "confirmed" as a minion
        const decoy = rng.pick(others.filter((p) => p.seat !== framed.seat));
        const char = rng.pick(charactersOfTeam("minion")).id;
        return { type: "investigator", characterId: char, candidates: [framed.seat, decoy.seat] };
      }
      case "chef":
        return { type: "chef", count: rng.pick([0, 0, 1, 1, 2]) };
      case "empath":
        return { type: "empath", count: rng.pick([0, 0, 1, 1, 2]) };
      case "fortuneteller": {
        const targets = (args.targets ?? []) as [number, number];
        const anyEvilTargeted = targets.some(
          (s) => view.players.find((p) => p.seat === s)?.alignment === "evil",
        );
        // Devious: say NO on evil (shield), YES on good (frame). Otherwise noise.
        const isDemon = devious ? !anyEvilTargeted : rng.chance(0.35);
        return { type: "fortuneteller", targets, isDemon };
      }
      case "undertaker": {
        const executed = args.executed!;
        const actual = view.players.find((p) => p.seat === executed)!;
        const pool =
          actual.alignment === "evil"
            ? [...charactersOfTeam("townsfolk"), ...charactersOfTeam("outsider")]
            : [...charactersOfTeam("minion"), ...charactersOfTeam("demon")];
        const shown = devious ? rng.pick(pool).id : rng.pick(charactersOfTeam("townsfolk")).id;
        return { type: "undertaker", executed, characterId: shown };
      }
      case "ravenkeeper": {
        const target = args.targets![0]!;
        const actual = view.players.find((p) => p.seat === target)!;
        const pool =
          actual.alignment === "evil"
            ? [...charactersOfTeam("townsfolk"), ...charactersOfTeam("outsider")]
            : [...charactersOfTeam("minion"), ...charactersOfTeam("demon")];
        const shown = devious ? rng.pick(pool).id : rng.pick(charactersOfTeam("townsfolk")).id;
        return { type: "ravenkeeper", target, characterId: shown };
      }
      default:
        // Roles without info (or the Spy's grimoire, shown true in v1): truth.
        return null;
    }
  }

  mayorBounce(view: PolicyView, mayorSeat: number, impSeat: number): number | null {
    // A kind ST bounces sometimes; never onto the demon itself.
    if (!view.rng.chance(0.5)) return null;
    const candidates = view.players.filter(
      (p) => p.alive && p.seat !== mayorSeat && p.seat !== impSeat,
    );
    if (candidates.length === 0) return null;
    return view.rng.pick(candidates).seat;
  }

  starPassRecipient(view: PolicyView, candidates: number[]): number {
    const sw = candidates.find(
      (s) => view.players.find((p) => p.seat === s)?.characterId === "scarletwoman",
    );
    if (sw !== undefined) return sw;
    return view.rng.pick(candidates);
  }
}

/** Sanity helper used by tests: a bag must contain exactly these team counts. */
export function validateBag(bag: CharId[], comp: TeamComposition): void {
  const counts = { townsfolk: 0, outsider: 0, minion: 0, demon: 0, traveller: 0 };
  for (const id of bag) counts[character(id).team]++;
  const baron = bag.includes("baron") ? 2 : 0;
  if (
    counts.demon !== comp.demon ||
    counts.minion !== comp.minion ||
    counts.outsider !== comp.outsider + baron ||
    counts.townsfolk !== comp.townsfolk - baron
  ) {
    throw new Error(`Invalid bag for composition: ${bag.join(",")}`);
  }
}
