// Night behavior for every Trouble Brewing character: what they choose, what
// happens when it resolves, and what info they learn. The Game drives waking
// order from the official night-sheet data; this table defines the effects.
//
// Malfunction contract: malfunctioning (drunk/poisoned) players are prompted
// exactly like healthy ones. Effect-roles silently do nothing; info-roles get
// policy-generated false info (Game.giveInfo handles that fork).

import type { Game } from "./game.js";
import { appearanceOf, registersAsDemon } from "./registration.js";
import { addStatus, hasStatus, isMalfunctioning } from "./status.js";
import type { CharId, Info, Player } from "./types.js";

export interface NightSpec {
  /** Present a choice to the player (absent = info-only wake). */
  choose?: { count: number; allowSelf: boolean; allowDead: boolean };
  /** Extra wake gate beyond the night-order data (default: alive). */
  wakes?: (g: Game, p: Player) => boolean;
  /** Apply the (validated) choice. Runs for malfunctioning players too — guard effects. */
  resolve: (g: Game, p: Player, seats: number[]) => void;
}

export const NIGHT_BEHAVIOR: Record<CharId, NightSpec> = {
  poisoner: {
    // Official: "choose a player" — dead players are legal targets (poisoning a
    // dead Recluse shuts off its misregistration, for instance).
    choose: { count: 1, allowSelf: false, allowDead: true },
    resolve(g, p, [target]) {
      if (!isMalfunctioning(p)) {
        addStatus(g.player(target!), { type: "poisoned", source: p.seat, expires: "dusk" });
        g.logStatusAdded(target!, "poisoned");
      }
    },
  },

  monk: {
    choose: { count: 1, allowSelf: false, allowDead: true },
    resolve(g, p, [target]) {
      if (!isMalfunctioning(p)) {
        addStatus(g.player(target!), { type: "protected", source: p.seat, expires: "dawn" });
        g.logStatusAdded(target!, "protected");
      }
    },
  },

  imp: {
    // Official Imp: "any player—alive or dead—can be chosen". Attacking a dead
    // player is the classic no-kill night; the kill pipeline no-ops on the dead.
    choose: { count: 1, allowSelf: true, allowDead: true },
    resolve(g, p, [target]) {
      g.impKill(p.seat, target!);
    },
  },

  butler: {
    choose: { count: 1, allowSelf: false, allowDead: true },
    resolve(g, p, [master]) {
      // A malfunctioning Butler is prompted but unrestricted (no status = free vote).
      if (!isMalfunctioning(p)) {
        addStatus(p, { type: "butlerMaster", master: master!, expires: "dusk" });
        g.logStatusAdded(p.seat, "butlerMaster");
      }
    },
  },

  // ── Info roles ────────────────────────────────────────────────────────────

  washerwoman: {
    resolve(g, p) {
      g.giveInfo(p, "washerwoman", {}, () => {
        const pool = g.alivePlayers().filter(
          (o) => o.seat !== p.seat && appearanceOf(o, g.policy, g.policyView(), "washerwoman").team === "townsfolk",
        );
        // Baron corner: the Washerwoman can be the only Townsfolk in play. The
        // storyteller then shows her herself (legal — "1 of 2 players IS the
        // Washerwoman"); a drunk "Washerwoman" is shown as her believed role.
        const target = pool.length > 0 ? g.rng.pick(pool) : p;
        const shown =
          target.seat === p.seat
            ? p.believedCharacterId
            : appearanceOf(target, g.policy, g.policyView(), "washerwoman").characterId;
        const decoy = g.rng.pick(g.players.filter((o) => o.seat !== p.seat && o.seat !== target.seat));
        const pair = g.rng.shuffle([target.seat, decoy.seat]) as [number, number];
        return { type: "washerwoman", characterId: shown, candidates: pair };
      });
    },
  },

  librarian: {
    resolve(g, p) {
      g.giveInfo(p, "librarian", {}, () => {
        const pool = g.players.filter(
          (o) => o.seat !== p.seat && appearanceOf(o, g.policy, g.policyView(), "librarian").team === "outsider",
        );
        if (pool.length === 0) return { type: "librarianNone" };
        const target = g.rng.pick(pool);
        // The Drunk registers as the Drunk here — a famous Librarian interaction.
        const shown = appearanceOf(target, g.policy, g.policyView(), "librarian").characterId;
        const decoy = g.rng.pick(g.players.filter((o) => o.seat !== p.seat && o.seat !== target.seat));
        const pair = g.rng.shuffle([target.seat, decoy.seat]) as [number, number];
        return { type: "librarian", characterId: shown, candidates: pair };
      });
    },
  },

  investigator: {
    resolve(g, p) {
      g.giveInfo(p, "investigator", {}, () => {
        let pool = g.players.filter(
          (o) => o.seat !== p.seat && appearanceOf(o, g.policy, g.policyView(), "investigator").team === "minion",
        );
        // If the only minion is a Spy registering good this query, fall back to actuals.
        if (pool.length === 0) {
          pool = g.players.filter((o) => o.seat !== p.seat && g.teamOf(o) === "minion");
        }
        const target = g.rng.pick(pool);
        const app = appearanceOf(target, g.policy, g.policyView(), "investigator");
        const shown = app.team === "minion" ? app.characterId : target.characterId;
        const decoy = g.rng.pick(g.players.filter((o) => o.seat !== p.seat && o.seat !== target.seat));
        const pair = g.rng.shuffle([target.seat, decoy.seat]) as [number, number];
        return { type: "investigator", characterId: shown, candidates: pair };
      });
    },
  },

  chef: {
    resolve(g, p) {
      g.giveInfo(p, "chef", {}, () => {
        // One coherent registration per player for the whole count.
        const align = g.players.map(
          (o) => appearanceOf(o, g.policy, g.policyView(), "chef").alignment,
        );
        let pairs = 0;
        const n = g.players.length;
        for (let i = 0; i < n; i++) {
          if (align[i] === "evil" && align[(i + 1) % n] === "evil") pairs++;
        }
        return { type: "chef", count: pairs };
      });
    },
  },

  empath: {
    resolve(g, p) {
      g.giveInfo(p, "empath", {}, () => {
        const neighbors = g.aliveNeighborsOf(p.seat);
        const count = neighbors.filter(
          (o) => appearanceOf(o, g.policy, g.policyView(), "empath").alignment === "evil",
        ).length;
        return { type: "empath", count };
      });
    },
  },

  fortuneteller: {
    // Official: "choose 2 players" — alive or dead, or even themself.
    choose: { count: 2, allowSelf: true, allowDead: true },
    resolve(g, p, seats) {
      g.giveInfo(p, "fortuneteller", { targets: seats }, () => {
        const isDemon = seats.some((s) => {
          const o = g.player(s);
          return (
            registersAsDemon(o, g.policy, g.policyView(), "fortuneteller") ||
            hasStatus(o, "redHerring")
          );
        });
        return { type: "fortuneteller", targets: seats as [number, number], isDemon };
      });
    },
  },

  undertaker: {
    wakes: (g, p) => p.alive && g.lastExecution !== null && g.lastExecution.day === g.night - 1,
    resolve(g, p) {
      const executed = g.lastExecution!.seat;
      g.giveInfo(p, "undertaker", { executed }, () => {
        const shown = appearanceOf(g.player(executed), g.policy, g.policyView(), "undertaker").characterId;
        return { type: "undertaker", executed, characterId: shown };
      });
    },
  },

  ravenkeeper: {
    // Wakes only if they died tonight.
    wakes: (g, p) => !p.alive && g.diedTonight.has(p.seat),
    choose: { count: 1, allowSelf: true, allowDead: true },
    resolve(g, p, [target]) {
      g.giveInfo(p, "ravenkeeper", { targets: [target!] }, () => {
        const shown = appearanceOf(g.player(target!), g.policy, g.policyView(), "ravenkeeper").characterId;
        return { type: "ravenkeeper", target: target!, characterId: shown };
      });
    },
  },

  spy: {
    resolve(g, p) {
      g.giveInfo(p, "spy", {}, (): Info => ({ type: "spy", grimoire: g.grimoireView() }));
    },
  },
};

/** Characters with no night behavior at all (day/passive abilities). */
export const PASSIVE_CHARACTERS: ReadonlySet<CharId> = new Set([
  "virgin", "slayer", "soldier", "mayor", "saint", "recluse", "drunk", "scarletwoman", "baron",
]);
