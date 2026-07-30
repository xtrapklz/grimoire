// Socket protocol between server and the three client roles:
// stage (the shared TV screen), player (a phone), dev (the puppeteer panel).

import type { Cue, PlayerAction, PublicState, SeatView } from "@grimoire/engine";

export type ClientRole = "stage" | "player" | "dev";

// The presented day cycle is Dawn (night's news) → Day (discussion) →
// Dusk (nominations & voting, tense) → Night (abilities). Engine phases map
// onto it: nominations/vote/execution all present as Dusk.

export interface RoomSettings {
  /** Day discussion: clamp(base + perLiving × living, min, max) seconds. */
  dayBaseSeconds: number;
  dayPerLivingSeconds: number;
  dayMinSeconds: number;
  dayMaxSeconds: number;
  /** Dusk (nomination window): clamp(base + perLiving × living, min, max) seconds. */
  duskBaseSeconds: number;
  duskPerLivingSeconds: number;
  duskMinSeconds: number;
  duskMaxSeconds: number;
  /** After a late vote resolves, the extra window for further nominations. */
  duskGraceSeconds: number;
  /** Seconds to cast a vote before it counts as a hand kept down. */
  voteSeconds: number;
  /** Seconds a human gets for a night action before the storyteller decides (0 = wait forever). */
  nightActionTimeoutSeconds: number;
  /** Fill empty seats with bots when starting. */
  botFill: boolean;
  /** Seats to fill up to when starting with bots. */
  playerCount: number;
}

export const DEFAULT_ROOM_SETTINGS: RoomSettings = {
  // ~5min floor for deliberation, gently growing with the crowd, capped at 8min.
  dayBaseSeconds: 240,
  dayPerLivingSeconds: 12,
  dayMinSeconds: 300,
  dayMaxSeconds: 480,
  duskBaseSeconds: 30,
  duskPerLivingSeconds: 10,
  duskMinSeconds: 60,
  duskMaxSeconds: 240,
  duskGraceSeconds: 15,
  voteSeconds: 20,
  nightActionTimeoutSeconds: 60,
  botFill: true,
  playerCount: 7,
};

/** Countdown shown on stage and phones. endsAt is server epoch ms. */
export interface PhaseTimer {
  kind: "day" | "dusk" | "vote" | "night";
  label: string;
  endsAt: number;
  seconds: number;
}

/**
 * Who has signalled "move on" for the current waiting phase. When every
 * living player is ready the phase advances early — full automation.
 */
export interface Readiness {
  ready: number[];
  /** Seats whose readiness is still needed (living players). */
  required: number[];
}

/**
 * What audio exists in user-assets/.
 * music: playlist folders (general | dusk | night) → track URLs.
 * sfx: event folder name → all files inside (one is picked at random per play).
 * Anything missing is simply silent — the game never depends on audio.
 */
export interface AudioManifest {
  music: Record<string, string[]>;
  sfx: Record<string, string[]>;
}

// ── Client → Server ─────────────────────────────────────────────────────────

export interface ClientToServer {
  /** Stage creates a room; returns the join code. */
  createRoom: (settings: Partial<RoomSettings>, cb: (resp: { code: string }) => void) => void;
  /** Phone joins a room. sessionKey lets the same phone reclaim its seat. */
  joinRoom: (
    args: { code: string; name: string; sessionKey: string },
    cb: (resp: { ok: true; seat: number } | { ok: false; error: string }) => void,
  ) => void;
  /** Phone sets its avatar: an emoji (≤8 chars) or a data:image URL (≤160KB). */
  setAvatar: (args: { avatar: string }) => void;
  /** Phone signals "I'm ready to move on" for the current phase. */
  ready: () => void;
  /** Stage (or dev) starts the game. */
  startGame: (cb: (resp: { ok: true } | { ok: false; error: string }) => void) => void;
  /**
   * Host adjusts pacing (day/dusk length, vote window, night timeout, …).
   * Values are clamped server-side. Applied immediately: if the room is
   * mid-day or mid-dusk, the countdown is recomputed from the phase's start
   * time (so it can be shortened or extended without resetting to full length).
   */
  updateSettings: (partial: Partial<RoomSettings>) => void;
  /** A seat submits a game action. */
  action: (args: { action: PlayerAction }, cb: (resp: { ok: true } | { ok: false; error: string }) => void) => void;
  /** Stage/dev advances day phases early (host override — normally automatic). */
  advancePhase: () => void;
  /** Dev panel: act as any seat. */
  devAction: (args: { seat: number; action: PlayerAction }, cb: (resp: { ok: boolean; error?: string }) => void) => void;
  devToggleBot: (args: { seat: number; bot: boolean }) => void;
  /** Dev panel: collapse all pacing delays (instant bots, 1s timers). */
  devFastForward: (args: { on: boolean }) => void;
}

// ── Server → Client ─────────────────────────────────────────────────────────

export interface LobbySeat {
  seat: number;
  name: string;
  connected: boolean;
  isBot: boolean;
  /** Emoji or data:image URL chosen by the player. */
  avatar: string | null;
}

export interface ServerToClient {
  /** Lobby roster (also kept fresh during the game for avatars/connection dots). */
  lobby: (state: { code: string; seats: LobbySeat[]; settings: RoomSettings }) => void;
  /** Public state, pushed to everyone on every change. */
  state: (state: PublicState) => void;
  /** Private per-seat view, pushed only to that seat's socket. */
  seat: (view: SeatView) => void;
  /** AV cues (banner + sound triggers) for stage and dev. */
  cues: (cues: Cue[]) => void;
  /** Current phase countdown, or null when no timer runs. */
  timer: (timer: PhaseTimer | null) => void;
  /** Ready-to-advance roster for the current phase, or null when not applicable. */
  readiness: (r: Readiness | null) => void;
  /** The town record: every publicly-known event, human-readable, in order. */
  log: (entries: string[]) => void;
  /** Omniscient state for the dev panel only. */
  grimoire: (state: unknown) => void;
  error: (message: string) => void;
}
