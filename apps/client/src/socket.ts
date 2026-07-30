// One shared socket + reactive game state for whichever view is mounted.

import { io, type Socket } from "socket.io-client";
import { reactive } from "vue";
import type { Cue, PlayerAction, PublicState, SeatView } from "@grimoire/engine";
import type { LobbySeat, PhaseTimer, Readiness, RoomSettings } from "@grimoire/shared";

export interface GrimoireSnapshot {
  view: {
    players: Array<{
      seat: number;
      name: string;
      characterId: string;
      alive: boolean;
      statuses: Array<{ type: string; [k: string]: unknown }>;
    }>;
  };
  pending: unknown;
  night: number;
  day: number;
  phase: string;
}

export const state = reactive({
  connected: false,
  code: "" as string,
  lobby: null as { code: string; seats: LobbySeat[]; settings: RoomSettings } | null,
  pub: null as PublicState | null,
  seat: null as SeatView | null,
  grimoire: null as GrimoireSnapshot | null,
  timer: null as PhaseTimer | null,
  readiness: null as Readiness | null,
  log: [] as string[],
  lastError: "" as string,
});

/** Cue listeners (the AV director subscribes here). */
const cueListeners = new Set<(cues: Cue[]) => void>();
export function onCues(fn: (cues: Cue[]) => void): () => void {
  cueListeners.add(fn);
  return () => cueListeners.delete(fn);
}

/**
 * The active view registers how to rejoin its room. Runs on every reconnect
 * (Wi-Fi blip, phone slept, dev-server restart) — rooms live in server memory,
 * so the client must always know how to claim its place back.
 */
let rejoin: (() => void) | null = null;
export function onReconnect(fn: () => void): void {
  rejoin = fn;
}

let socket: Socket | null = null;
let everConnected = false;

export function getSocket(): Socket {
  if (socket) return socket;
  socket = io({ transports: ["websocket", "polling"] });
  socket.on("connect", () => {
    state.connected = true;
    if (everConnected) rejoin?.();
    everConnected = true;
  });
  socket.on("disconnect", () => (state.connected = false));
  socket.on("lobby", (lobby) => (state.lobby = lobby));
  socket.on("state", (pub) => (state.pub = pub));
  socket.on("seat", (seat) => (state.seat = seat));
  socket.on("grimoire", (g) => (state.grimoire = g));
  socket.on("timer", (t: PhaseTimer | null) => (state.timer = t));
  socket.on("readiness", (r: Readiness | null) => (state.readiness = r));
  socket.on("log", (entries: string[]) => (state.log = entries));
  socket.on("cues", (cues: Cue[]) => {
    for (const fn of cueListeners) fn(cues);
  });
  socket.on("error", (message: string) => (state.lastError = message));
  return socket;
}

/** Clear game views when binding to a brand-new room (e.g. after a server restart). */
export function resetGameState(): void {
  state.pub = null;
  state.seat = null;
  state.grimoire = null;
  state.lobby = null;
}

export function sessionKey(): string {
  let key = localStorage.getItem("grimoire-session");
  if (!key) {
    key = crypto.randomUUID();
    localStorage.setItem("grimoire-session", key);
  }
  return key;
}

export function sendAction(action: PlayerAction): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    getSocket().emit("action", { action }, (resp: { ok: boolean; error?: string }) => {
      if (!resp.ok && resp.error) state.lastError = resp.error;
      resolve(resp);
    });
  });
}

export function sendDevAction(seat: number, action: PlayerAction): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    getSocket().emit("devAction", { seat, action }, (resp: { ok: boolean; error?: string }) => {
      if (!resp.ok && resp.error) state.lastError = resp.error;
      resolve(resp);
    });
  });
}

export function setAvatar(avatar: string): void {
  getSocket().emit("setAvatar", { avatar });
}

export function sendReady(): void {
  getSocket().emit("ready");
}

export function sendUpdateSettings(partial: Partial<RoomSettings>): void {
  getSocket().emit("updateSettings", partial);
}
