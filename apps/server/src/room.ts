// A Room: lobby → running game → game over. Owns the Game instance and the
// only copy of hidden state. Everything sent out goes through the engine's
// view builders (publicState / seatView) — sockets never see the Game object.
//
// The Room is also the pacing director. The presented cycle is
// Dawn (news) → Day (discussion) → Dusk (nominations & voting) → Night.
// Progression is fully automatic: phase timers scale with the number of
// living players, and a phase advances early when every living player
// signals ready (or has acted). Bots "think" on delays; absent humans time
// out gracefully. All pacing lives here — the engine stays pure and instant.

import {
  Game,
  publicState,
  seatView,
  type Cue,
  type PlayerAction,
} from "@grimoire/engine";
import {
  DEFAULT_ROOM_SETTINGS,
  type LobbySeat,
  type PhaseTimer,
  type Readiness,
  type RoomSettings,
} from "@grimoire/shared";
import type { Server, Socket } from "socket.io";

interface SeatBinding {
  name: string;
  sessionKey: string;
  socketId: string | null; // null while disconnected
  isBot: boolean;
  avatar: string | null;
}

const BOT_AVATARS = ["🎃", "🦇", "🕯️", "🌙", "🍺", "🧹", "🔮", "🪦", "🐈‍⬛", "🦉"];

/** Sanity-bound every pacing knob so a stray host input can't wedge the game. */
function clampSettings(s: RoomSettings): RoomSettings {
  const num = (v: unknown, lo: number, hi: number, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;

  const dayMin = num(s.dayMinSeconds, 30, 3600, DEFAULT_ROOM_SETTINGS.dayMinSeconds);
  const dayMax = Math.max(dayMin, num(s.dayMaxSeconds, dayMin, 3600, DEFAULT_ROOM_SETTINGS.dayMaxSeconds));
  const duskMin = num(s.duskMinSeconds, 15, 1800, DEFAULT_ROOM_SETTINGS.duskMinSeconds);
  const duskMax = Math.max(duskMin, num(s.duskMaxSeconds, duskMin, 1800, DEFAULT_ROOM_SETTINGS.duskMaxSeconds));

  return {
    dayBaseSeconds: num(s.dayBaseSeconds, 0, 3600, DEFAULT_ROOM_SETTINGS.dayBaseSeconds),
    dayPerLivingSeconds: num(s.dayPerLivingSeconds, 0, 120, DEFAULT_ROOM_SETTINGS.dayPerLivingSeconds),
    dayMinSeconds: dayMin,
    dayMaxSeconds: dayMax,
    duskBaseSeconds: num(s.duskBaseSeconds, 0, 1800, DEFAULT_ROOM_SETTINGS.duskBaseSeconds),
    duskPerLivingSeconds: num(s.duskPerLivingSeconds, 0, 60, DEFAULT_ROOM_SETTINGS.duskPerLivingSeconds),
    duskMinSeconds: duskMin,
    duskMaxSeconds: duskMax,
    duskGraceSeconds: num(s.duskGraceSeconds, 5, 120, DEFAULT_ROOM_SETTINGS.duskGraceSeconds),
    voteSeconds: num(s.voteSeconds, 5, 120, DEFAULT_ROOM_SETTINGS.voteSeconds),
    nightActionTimeoutSeconds: num(
      s.nightActionTimeoutSeconds,
      0,
      600,
      DEFAULT_ROOM_SETTINGS.nightActionTimeoutSeconds,
    ),
    botFill: !!s.botFill,
    playerCount: Math.round(num(s.playerCount, 5, 15, DEFAULT_ROOM_SETTINGS.playerCount)),
  };
}

export class Room {
  readonly code: string;
  settings: RoomSettings;
  private io: Server;
  private seats: SeatBinding[] = [];
  private stageSocketIds = new Set<string>();
  private devSocketIds = new Set<string>();
  private game: Game | null = null;
  /** Drives bot seats and human-timeout fallbacks; wired in index.ts. */
  botDriver: ((game: Game, seat: number) => PlayerAction | null) | null = null;

  private pendingTimeouts = new Set<ReturnType<typeof setTimeout>>();
  private scheduledKeys = new Set<string>();
  private phaseTimer: PhaseTimer | null = null;
  private fastForward = false;
  private readySeats = new Set<number>();
  private readyKey = "";
  /** Dusk close deadline per day (extended by grace after late votes). */
  private duskDeadlines = new Map<number, number>();
  /** When each day's Day/Dusk phase first began — the anchor for live re-timing. */
  private dayStartedAt = new Map<number, number>();
  private duskStartedAt = new Map<number, number>();
  private dayDeadlines = new Map<number, number>();
  /** Days whose dusk grace window has already fired — no longer live-adjustable. */
  private duskGraced = new Set<number>();
  private watchdog: ReturnType<typeof setInterval> | null = null;
  /** Human-readable record of every publicly-known event. */
  private publicLog: string[] = [];

  constructor(io: Server, code: string, settings: Partial<RoomSettings>) {
    this.io = io;
    this.code = code;
    this.settings = clampSettings({ ...DEFAULT_ROOM_SETTINGS, ...settings });
  }

  private channel(): string {
    return `room:${this.code}`;
  }

  // ── Membership ────────────────────────────────────────────────────────────

  attachStage(socket: Socket): void {
    this.stageSocketIds.add(socket.id);
    socket.join(this.channel());
    this.pushLobby();
    if (this.game) this.pushAll();
    this.io.to(socket.id).emit("timer", this.phaseTimer);
    this.io.to(socket.id).emit("log", this.publicLog);
    this.pushReadiness();
  }

  attachDev(socket: Socket): void {
    this.devSocketIds.add(socket.id);
    socket.join(this.channel());
    this.pushLobby();
    if (this.game) this.pushAll();
    this.io.to(socket.id).emit("timer", this.phaseTimer);
    this.io.to(socket.id).emit("log", this.publicLog);
    this.pushReadiness();
  }

  join(socket: Socket, name: string, sessionKey: string): { ok: true; seat: number } | { ok: false; error: string } {
    // Reconnect: same sessionKey reclaims the seat, even mid-game.
    const existing = this.seats.findIndex((s) => s.sessionKey === sessionKey);
    if (existing >= 0) {
      this.seats[existing]!.socketId = socket.id;
      this.seats[existing]!.isBot = false;
      socket.join(this.channel());
      this.pushLobby();
      if (this.game) {
        // A rejoining phone needs the full picture, not just its private view.
        this.io.to(socket.id).emit("state", publicState(this.game));
        this.pushSeat(existing);
      }
      this.io.to(socket.id).emit("timer", this.phaseTimer);
      this.io.to(socket.id).emit("log", this.publicLog);
      this.pushReadiness();
      return { ok: true, seat: existing };
    }
    if (this.game) return { ok: false, error: "Game already in progress" };
    if (this.seats.length >= 15) return { ok: false, error: "Room is full" };
    if (this.seats.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
      return { ok: false, error: "That name is taken" };
    }
    this.seats.push({ name, sessionKey, socketId: socket.id, isBot: false, avatar: null });
    socket.join(this.channel());
    this.pushLobby();
    return { ok: true, seat: this.seats.length - 1 };
  }

  setAvatar(socketId: string, avatar: string): void {
    const seat = this.seatOfSocket(socketId);
    if (seat < 0) return;
    const ok =
      (avatar.length <= 8 && !avatar.startsWith("data:")) ||
      (/^data:image\/(jpeg|png|webp);base64,/.test(avatar) && avatar.length <= 160_000);
    if (!ok) return;
    this.seats[seat]!.avatar = avatar;
    this.pushLobby();
  }

  handleDisconnect(socketId: string): void {
    this.stageSocketIds.delete(socketId);
    this.devSocketIds.delete(socketId);
    const seat = this.seats.findIndex((s) => s.socketId === socketId);
    if (seat >= 0) {
      this.seats[seat]!.socketId = null;
      this.pushLobby();
    }
  }

  get isEmpty(): boolean {
    return (
      this.stageSocketIds.size === 0 &&
      this.devSocketIds.size === 0 &&
      this.seats.every((s) => s.socketId === null)
    );
  }

  dispose(): void {
    for (const t of this.pendingTimeouts) clearTimeout(t);
    this.pendingTimeouts.clear();
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = null;
  }

  seatOfSocket(socketId: string): number {
    return this.seats.findIndex((s) => s.socketId === socketId);
  }

  isStageOrDev(socketId: string): boolean {
    return this.stageSocketIds.has(socketId) || this.devSocketIds.has(socketId);
  }

  // ── Game lifecycle ────────────────────────────────────────────────────────

  start(): { ok: true } | { ok: false; error: string } {
    if (this.game) return { ok: false, error: "Already started" };
    if (this.settings.botFill) {
      let n = 1;
      while (this.seats.length < this.settings.playerCount) {
        this.seats.push({
          name: `Bot ${n}`,
          sessionKey: `bot:${this.code}:${n}`,
          socketId: null,
          isBot: true,
          avatar: BOT_AVATARS[(n - 1) % BOT_AVATARS.length]!,
        });
        n++;
      }
    }
    if (this.seats.length < 5) return { ok: false, error: "Need at least 5 players" };

    this.game = new Game({
      seed: `${this.code}:${Date.now()}`,
      playerNames: this.seats.map((s) => s.name),
    });
    this.pushLobby(); // roster changed if bots were added
    this.afterChange(this.game.drainCues());
    // Watchdog: full automation means NO phase may ever wait on input. The
    // sweep re-derives pacing every few seconds, healing any missed timer.
    this.watchdog = setInterval(() => {
      if (this.game && !this.game.winner) this.schedulePacing();
    }, 5000);
    return { ok: true };
  }

  submitAction(seat: number, action: PlayerAction): { ok: true } | { ok: false; error: string } {
    if (!this.game) return { ok: false, error: "No game in progress" };
    try {
      const cues = this.game.submit(seat, action);
      // A ballot landing is a public sound moment (its content stays secret).
      if (action.type === "vote") {
        cues.push({ cue: "announce", key: "voteCast", data: {} });
      }
      this.afterChange(cues);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  advancePhase(): void {
    if (!this.game) return;
    const cues = this.game.advancePhase();
    this.afterChange(cues);
  }

  /** A living player signals "move on". All living ready → phase advances. */
  markReady(socketId: string): void {
    const seat = this.seatOfSocket(socketId);
    if (seat < 0 || !this.game || this.game.winner) return;
    if (this.game.pending?.kind !== "day") return;
    if (!this.game.player(seat).alive) return;
    this.readySeats.add(seat);
    this.pushReadiness();
    this.checkAllReady();
  }

  private markBotReady(seat: number): void {
    if (this.game?.pending?.kind !== "day" || !this.game.player(seat).alive) return;
    this.readySeats.add(seat);
    this.pushReadiness();
    this.checkAllReady();
  }

  private checkAllReady(): void {
    if (!this.game || this.game.pending?.kind !== "day") return;
    const living = this.game.alivePlayers().map((p) => p.seat);
    if (living.every((s) => this.readySeats.has(s))) this.advancePhase();
  }

  setBot(seat: number, isBot: boolean): void {
    const s = this.seats[seat];
    if (s) {
      s.isBot = isBot;
      this.pushLobby();
      this.schedulePacing();
    }
  }

  /**
   * Host tunes pacing live. Clamped and merged into settings, then — if a
   * timed phase is currently running — its deadline is recomputed from the
   * phase's original start time (not from "now"), so raising a minimum mid-day
   * adds back only the remaining difference rather than resetting the clock.
   * Dusk stops being live-adjustable once its grace window has fired.
   */
  updateSettings(partial: Partial<RoomSettings>): void {
    this.settings = clampSettings({ ...this.settings, ...partial });
    this.pushLobby();

    if (!this.game || this.game.winner) return;
    const pend = this.game.pending;
    const day = this.game.day;
    const s = this.settings;

    if (pend?.kind === "day") {
      const start = this.dayStartedAt.get(day) ?? Date.now();
      const seconds = this.fastForward
        ? 1
        : this.scaledSeconds(s.dayBaseSeconds, s.dayPerLivingSeconds, s.dayMinSeconds, s.dayMaxSeconds);
      this.dayDeadlines.set(day, Math.max(Date.now() + 1000, start + seconds * 1000));
      this.schedulePacing();
    } else if (pend?.kind === "nominations" && !this.duskGraced.has(day)) {
      const start = this.duskStartedAt.get(day) ?? Date.now();
      const seconds = this.fastForward
        ? 1
        : this.scaledSeconds(s.duskBaseSeconds, s.duskPerLivingSeconds, s.duskMinSeconds, s.duskMaxSeconds);
      this.duskDeadlines.set(day, Math.max(Date.now() + 1000, start + seconds * 1000));
      this.schedulePacing();
    }
  }

  setFastForward(on: boolean): void {
    this.fastForward = on;
    if (on && this.game && !this.game.winner) {
      this.scheduledKeys.clear();
      this.schedulePacing();
    }
  }

  private afterChange(cues: Cue[]): void {
    this.pushAll();
    this.emitCues(cues);
    this.schedulePacing();
    this.pushReadiness();
  }

  // ── Pacing ────────────────────────────────────────────────────────────────

  private rand(min: number, max: number): number {
    return Math.floor(min + Math.random() * (max - min));
  }

  private later(ms: number, fn: () => void): void {
    const t = setTimeout(() => {
      this.pendingTimeouts.delete(t);
      fn();
    }, ms);
    this.pendingTimeouts.add(t);
  }

  /** Run `fn` after `ms` at most once per unique `key`. */
  private once(key: string, ms: number, fn: () => void): void {
    if (this.scheduledKeys.has(key)) return;
    this.scheduledKeys.add(key);
    this.later(this.fastForward ? Math.min(ms, 800) : ms, fn);
  }

  private botSeat(seat: number): boolean {
    return this.seats[seat]?.isBot ?? false;
  }

  private tryBotAction(seat: number): void {
    if (!this.game || this.game.winner || !this.botDriver) return;
    const action = this.botDriver(this.game, seat);
    if (!action) return;
    try {
      const cues = this.game.submit(seat, action);
      this.afterChange(cues);
    } catch {
      // The moment passed (someone else acted first) — that's fine.
    }
  }

  /** Timer length scales with how many players still live, within [min, max]. */
  private scaledSeconds(base: number, perLiving: number, min: number, max: number): number {
    const living = this.game?.alivePlayers().length ?? 0;
    return Math.min(max, Math.max(min, base + perLiving * living));
  }

  /** Inspect what the engine is waiting for and schedule tempo around it. */
  private schedulePacing(): void {
    if (!this.game || this.game.winner) {
      this.setTimer(null);
      return;
    }
    const g = this.game;
    const pend = g.pending;
    const s = this.settings;
    if (!pend) return;

    switch (pend.kind) {
      case "day": {
        // New day: reset readiness.
        const day = g.day;
        const key = `day:${day}`;
        if (this.readyKey !== key) {
          this.readyKey = key;
          this.readySeats.clear();
          this.pushReadiness();
        }

        // Day runs on a DEADLINE (like dusk below), not a one-shot timer, so
        // updateSettings() can shorten or extend it live without resetting
        // the clock: the deadline is anchored to when the day actually began.
        let deadline = this.dayDeadlines.get(day);
        if (deadline === undefined) {
          this.dayStartedAt.set(day, Date.now());
          const seconds = this.fastForward
            ? 1
            : this.scaledSeconds(s.dayBaseSeconds, s.dayPerLivingSeconds, s.dayMinSeconds, s.dayMaxSeconds);
          deadline = Date.now() + seconds * 1000;
          this.dayDeadlines.set(day, deadline);
        }

        this.showDeadline("day", `Day ${day} — discussion`, deadline);
        this.later(Math.max(0, deadline - Date.now()) + 100, () => {
          if (!this.game || this.game.winner || this.game.pending?.kind !== "day") return;
          if (Date.now() >= (this.dayDeadlines.get(day) ?? 0)) this.advancePhase();
        });

        // Bots drift toward ready so an all-ready table advances early.
        const secondsLeft = Math.max(1, Math.round((deadline - Date.now()) / 1000));
        for (let seat = 0; seat < this.seats.length; seat++) {
          if (!this.botSeat(seat) || !g.player(seat).alive) continue;
          this.once(`ready:${key}:${seat}`, this.rand(8000, Math.max(12_000, secondsLeft * 600)), () =>
            this.markBotReady(seat),
          );
        }
        break;
      }

      case "nominations": {
        // Dusk runs on a DEADLINE, not a one-shot timer. If the deadline
        // passes while a vote is being counted, returning to nominations
        // grants a short visible grace window for further accusations, so the
        // countdown never freezes and the phase can never wait on input.
        const day = g.day;
        const grace = (this.fastForward ? 2 : s.duskGraceSeconds) * 1000;
        let deadline = this.duskDeadlines.get(day);
        if (deadline === undefined) {
          this.duskStartedAt.set(day, Date.now());
          const seconds = this.fastForward
            ? 1
            : this.scaledSeconds(
                s.duskBaseSeconds,
                s.duskPerLivingSeconds,
                s.duskMinSeconds,
                s.duskMaxSeconds,
              );
          deadline = Date.now() + seconds * 1000;
          this.duskDeadlines.set(day, deadline);
        } else if (deadline - Date.now() < 1000) {
          deadline = Date.now() + grace;
          this.duskDeadlines.set(day, deadline);
          this.duskGraced.add(day);
        }

        this.showDeadline("dusk", "Dusk — nominations and votes", deadline);
        this.later(deadline - Date.now() + 100, () => {
          const p = this.game?.pending;
          if (!this.game || this.game.winner || p?.kind !== "nominations") return;
          // Only close if THIS deadline (or a stricter one) is still current.
          if (Date.now() >= (this.duskDeadlines.get(day) ?? 0)) this.advancePhase();
        });

        // Each bot gets one staggered nominate-or-pass moment per dusk.
        for (let seat = 0; seat < this.seats.length; seat++) {
          if (!this.botSeat(seat) || !g.player(seat).alive) continue;
          this.once(`nom:${day}:${seat}`, this.rand(4000, 15_000), () => {
            if (this.game?.pending?.kind === "nominations") this.tryBotAction(seat);
          });
        }
        break;
      }

      case "vote": {
        const voteKey = `${g.day}:${pend.nominee}`;
        this.setTimerOnce(`t:vote:${voteKey}`, {
          kind: "vote",
          label: "Cast your votes",
          seconds: s.voteSeconds,
        });
        // Bots raise (or keep down) their hands after a beat.
        for (const seat of pend.awaiting) {
          if (!this.botSeat(seat)) continue;
          this.once(`voteb:${voteKey}:${seat}`, this.rand(1500, Math.max(4000, s.voteSeconds * 700)), () =>
            this.tryBotAction(seat),
          );
        }
        // Absent humans keep their hands down when the window closes.
        this.once(`votet:${voteKey}`, s.voteSeconds * 1000, () => {
          const p = this.game?.pending;
          if (p?.kind !== "vote" || `${this.game!.day}:${p.nominee}` !== voteKey) return;
          for (const seat of p.awaiting) {
            try {
              const cues = this.game!.submit(seat, { type: "vote", vote: false });
              this.afterChange(cues);
            } catch {
              // already voted
            }
          }
        });
        break;
      }

      case "nightAction": {
        const seat = pend.seat;
        if (this.botSeat(seat)) {
          this.setTimer(null);
          this.once(`n:${g.night}:${seat}`, this.rand(2500, 7000), () => this.tryBotAction(seat));
        } else {
          if (s.nightActionTimeoutSeconds > 0) {
            this.setTimerOnce(`t:night:${g.night}:${seat}`, {
              kind: "night",
              label: "The town sleeps",
              seconds: s.nightActionTimeoutSeconds,
            });
            // If the phone never answers, the storyteller decides for them.
            this.once(`nt:${g.night}:${seat}`, s.nightActionTimeoutSeconds * 1000, () => {
              const p = this.game?.pending;
              if (p?.kind === "nightAction" && p.seat === seat) this.tryBotAction(seat);
            });
          } else {
            this.setTimer(null);
          }
        }
        break;
      }
    }
  }

  private timersByKey = new Map<string, PhaseTimer>();

  /**
   * Create the timer once per key, but RE-emit it whenever a different timer
   * was showing (e.g. the dusk countdown returns after a vote resolves).
   */
  private setTimerOnce(key: string, t: { kind: PhaseTimer["kind"]; label: string; seconds: number }): void {
    let timer = this.timersByKey.get(key);
    if (!timer) {
      const seconds = this.fastForward ? 1 : t.seconds;
      timer = { ...t, seconds, endsAt: Date.now() + seconds * 1000 };
      this.timersByKey.set(key, timer);
    }
    if (this.phaseTimer !== timer) {
      this.setTimer(timer.endsAt > Date.now() ? timer : null);
    }
  }

  /** Show a countdown to an absolute deadline, re-emitting only on change. */
  private showDeadline(kind: PhaseTimer["kind"], label: string, endsAt: number): void {
    if (
      this.phaseTimer &&
      this.phaseTimer.kind === kind &&
      Math.abs(this.phaseTimer.endsAt - endsAt) < 500
    ) {
      return;
    }
    this.setTimer({
      kind,
      label,
      endsAt,
      seconds: Math.max(1, Math.round((endsAt - Date.now()) / 1000)),
    });
  }

  private setTimer(t: PhaseTimer | null): void {
    this.phaseTimer = t;
    this.io.to(this.channel()).emit("timer", t);
  }

  // ── Outbound ──────────────────────────────────────────────────────────────

  private pushReadiness(): void {
    let r: Readiness | null = null;
    if (this.game && !this.game.winner && this.game.pending?.kind === "day") {
      r = {
        ready: [...this.readySeats].sort((a, b) => a - b),
        required: this.game.alivePlayers().map((p) => p.seat),
      };
    }
    this.io.to(this.channel()).emit("readiness", r);
  }

  private pushLobby(): void {
    const lobby: LobbySeat[] = this.seats.map((s, i) => ({
      seat: i,
      name: s.name,
      connected: s.socketId !== null || s.isBot,
      isBot: s.isBot,
      avatar: s.avatar,
    }));
    this.io.to(this.channel()).emit("lobby", {
      code: this.code,
      seats: lobby,
      settings: this.settings,
    });
  }

  private pushAll(): void {
    if (!this.game) return;
    this.io.to(this.channel()).emit("state", publicState(this.game));
    for (let seat = 0; seat < this.seats.length; seat++) this.pushSeat(seat);
    for (const id of this.devSocketIds) {
      this.io.to(id).emit("grimoire", {
        view: this.game.grimoireView(),
        pending: this.game.pending,
        night: this.game.night,
        day: this.game.day,
        phase: this.game.phase,
      });
    }
  }

  private pushSeat(seat: number): void {
    if (!this.game) return;
    const socketId = this.seats[seat]?.socketId;
    if (socketId) this.io.to(socketId).emit("seat", seatView(this.game, seat));
  }

  private emitCues(cues: Cue[]): void {
    if (cues.length === 0) return;
    for (const id of this.stageSocketIds) this.io.to(id).emit("cues", cues);
    for (const id of this.devSocketIds) this.io.to(id).emit("cues", cues);
    this.recordCues(cues);
  }

  // ── The town record ───────────────────────────────────────────────────────
  // Built exclusively from cues, which carry only public knowledge.

  private recordCues(cues: Cue[]): void {
    const name = (seat: number) => this.seats[seat]?.name ?? `Seat ${seat}`;
    const before = this.publicLog.length;
    for (const c of cues) {
      switch (c.cue) {
        case "phase":
          if (c.phase === "night") this.publicLog.push(`Night ${c.night} falls.`);
          if (c.phase === "dawn") this.publicLog.push(`Dawn breaks on day ${c.day}.`);
          if (c.phase === "nominations") this.publicLog.push(`Dusk ${c.day}: nominations open.`);
          break;
        case "deaths":
          if (c.seats.length === 0) this.publicLog.push("Nobody died in the night.");
          else for (const s of c.seats) this.publicLog.push(`${name(s)} died in the night.`);
          break;
        case "nomination":
          this.publicLog.push(`${name(c.nominator)} nominates ${name(c.nominee)}.`);
          break;
        case "voteReveal": {
          const outcome =
            c.outcome === "aboutToDie"
              ? `${name(c.nominee)} is on the block`
              : c.outcome === "tied"
                ? "a tie — the block is cleared"
                : "not enough";
          this.publicLog.push(
            `${c.votes.length} vote${c.votes.length === 1 ? "" : "s"} against ${name(c.nominee)} (${c.required} needed) — ${outcome}.`,
          );
          break;
        }
        case "execution":
          this.publicLog.push(
            c.seat === null ? "No execution today." : `${name(c.seat)} is executed.`,
          );
          break;
        case "slayerShot":
          this.publicLog.push(
            c.died
              ? `${name(c.slayer)} slays ${name(c.target)} with a single shot!`
              : `${name(c.slayer)} fires at ${name(c.target)} — nothing happens.`,
          );
          break;
        case "announce":
          if (c.key === "virginTriggered") {
            const d = c.data as { nominator: number };
            this.publicLog.push(`${name(d.nominator)} is struck down by the Virgin's power.`);
          }
          break;
        case "gameOver":
          this.publicLog.push(c.winner === "good" ? "GOOD WINS." : "EVIL WINS.");
          break;
      }
    }
    if (this.publicLog.length !== before) {
      this.io.to(this.channel()).emit("log", this.publicLog);
    }
  }
}
