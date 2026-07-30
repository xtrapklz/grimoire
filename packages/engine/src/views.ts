// View builders: the ONLY shapes that ever leave the server for a client.
// publicState() is safe for everyone (the stage screen shows it to the room).
// seatView() adds one seat's private knowledge. grimoire stays server-side
// (dev panel / spy info only). Keeping these in the engine makes the no-leak
// guarantee testable: nothing here may read a hidden field into a public shape.

import type { Game } from "./game.js";
import type { Alignment, CharId, Info, Phase, Status, WinReason } from "./types.js";

export interface PublicSeat {
  seat: number;
  name: string;
  alive: boolean;
  usedDeadVote: boolean;
  /** Revealed only at game over. */
  characterId?: CharId;
  alignment?: Alignment;
}

export interface PublicState {
  phase: Phase;
  night: number;
  day: number;
  seats: PublicSeat[];
  aliveCount: number;
  votesRequired: number;
  winner: { team: Alignment; reason: WinReason } | null;
  /** Current vote in progress, if any (votes are public as they resolve). */
  vote: { nominator: number; nominee: number; awaiting: number[] } | null;
  /** Who stands to be executed at day's end (public knowledge). */
  onTheBlock: { seat: number; votes: number } | null;
}

export interface SeatView {
  seat: number;
  /** What this player believes they are (Drunk sees their believed role). */
  characterId: CharId;
  alignment: Alignment;
  inbox: Info[];
  /** Set when the engine is waiting on THIS seat. */
  prompt:
    | { kind: "nightAction"; characterId: CharId; choose: { count: number; allowSelf: boolean; allowDead: boolean } }
    | { kind: "vote"; nominee: number; nominator: number }
    | null;
  canNominate: boolean;
  canVote: boolean;
  /** Own visible statuses only (things the player knows about themself). */
  slayerSpent: boolean;
}

export function publicState(g: Game): PublicState {
  const over = g.winner !== null;
  return {
    phase: g.phase,
    night: g.night,
    day: g.day,
    seats: g.players.map((p) => ({
      seat: p.seat,
      name: p.name,
      alive: p.alive,
      usedDeadVote: p.usedDeadVote,
      ...(over ? { characterId: p.characterId, alignment: p.alignment } : {}),
    })),
    aliveCount: g.alivePlayers().length,
    votesRequired: Math.ceil(g.alivePlayers().length / 2),
    winner: g.winner === null ? null : { team: g.winner.team, reason: g.winner.reason },
    vote:
      g.pending?.kind === "vote"
        ? { nominator: g.pending.nominator, nominee: g.pending.nominee, awaiting: g.pending.awaiting }
        : null,
    onTheBlock: g.onTheBlock,
  };
}

export function seatView(g: Game, seat: number): SeatView {
  const p = g.player(seat);
  const pend = g.pending;
  let prompt: SeatView["prompt"] = null;
  if (pend?.kind === "nightAction" && pend.seat === seat) {
    prompt = {
      kind: "nightAction",
      characterId: pend.prompt.characterId,
      choose: pend.prompt.choose,
    };
  } else if (pend?.kind === "vote" && pend.awaiting.includes(seat)) {
    prompt = { kind: "vote", nominee: pend.nominee, nominator: pend.nominator };
  }
  return {
    seat,
    characterId: p.believedCharacterId,
    alignment: p.alignment,
    inbox: g.inbox(seat),
    prompt,
    canNominate: pend?.kind === "nominations" && p.alive,
    canVote: pend?.kind === "vote" && pend.awaiting.includes(seat),
    slayerSpent: p.statuses.some((s: Status) => s.type === "slayerSpent"),
  };
}
