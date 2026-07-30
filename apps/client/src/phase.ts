// Shared presentation mapping of engine phases onto the Dawn → Day → Dusk →
// Night cycle, used by both the stage and the phones.

import type { PublicState } from "@grimoire/engine";

export type SkyPhase = "" | "day" | "dawn" | "dusk" | "night";

/** CSS tint class for the current time of day. */
export function skyPhaseOf(pub: PublicState | null): SkyPhase {
  const p = pub?.phase;
  if (!p || pub?.winner) return "";
  if (p === "night" || p === "dusk") return "night";
  if (p === "nominations" || p === "vote" || p === "execution") return "dusk";
  if (p === "dawn") return "dawn";
  return "day";
}

/** Icon + label for the phase indicator. */
export function phaseInfoOf(pub: PublicState | null): { icon: string; text: string } {
  if (!pub) return { icon: "clock", text: "Waiting in the lobby" };
  if (pub.winner) return { icon: "flag", text: "Game over" };
  if (pub.phase === "night" || pub.phase === "dusk") return { icon: "moon", text: `Night ${pub.night}` };
  if (pub.phase === "nominations" || pub.phase === "vote" || pub.phase === "execution") {
    return { icon: "sunset", text: `Dusk ${pub.day}` };
  }
  if (pub.phase === "dawn") return { icon: "sunrise", text: `Dawn ${pub.day}` };
  return { icon: "sun", text: `Day ${pub.day}` };
}
