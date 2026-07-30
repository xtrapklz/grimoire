// The game machine. Pure and deterministic: pulled forward by advance(),
// fed by submit(seat, action) / advancePhase(), observed via events + cues +
// per-seat views. No timers, no I/O.

import { NIGHT_BEHAVIOR } from "./characters.js";
import {
  character,
  compositionFor,
  DEMON_INFO_ORDER,
  MINION_INFO_ORDER,
} from "./data.js";
import { DefaultPolicy, validateBag, type PolicyView, type StorytellerPolicy } from "./policy.js";
import { appearanceOf, registersAsDemon } from "./registration.js";
import {
  addStatus,
  expireStatuses,
  getStatus,
  hasStatus,
  isMalfunctioning,
  removeEffectsFrom,
} from "./status.js";
import { Rng } from "./rng.js";
import type {
  CharId,
  Cue,
  DeathCause,
  GameConfig,
  GameEvent,
  GrimoireView,
  Info,
  NightPrompt,
  Pending,
  Phase,
  Player,
  PlayerAction,
  Team,
  WinReason,
} from "./types.js";

interface NightStep {
  order: number;
  step: { kind: "wake"; seat: number } | { kind: "minionInfo" } | { kind: "demonInfo" };
}

export class Game {
  readonly rng: Rng;
  readonly policy: StorytellerPolicy;
  readonly players: Player[] = [];
  readonly events: GameEvent[] = [];
  readonly inPlay: CharId[] = [];

  phase: Phase = "lobby";
  night = 0;
  day = 0;
  pending: Pending = null;
  winner: { team: "good" | "evil"; reason: WinReason } | null = null;

  lastExecution: { seat: number; day: number } | null = null;
  diedTonight = new Set<number>();

  private cues: Cue[] = [];
  private inboxes = new Map<number, Info[]>();
  private nightQueue: NightStep[] = [];
  private nightIndex = 0;
  private nominatedToday = new Set<number>(); // seats that have nominated
  private beenNominatedToday = new Set<number>();
  private passedToday = new Set<number>();
  private topVotes = 0;
  private aboutToDie: number | null = null;
  private executionOccurredToday = false;
  private voteBallots = new Map<number, boolean>();

  constructor(config: GameConfig, policy: StorytellerPolicy = new DefaultPolicy()) {
    const n = config.playerNames.length;
    this.rng = new Rng(config.seed);
    this.policy = policy;
    this.event({ t: "gameStarted", seed: config.seed, playerNames: config.playerNames });
    this.setup(config);
    this.advance();
  }

  // ── Setup ─────────────────────────────────────────────────────────────────

  private setup(config: GameConfig): void {
    this.phase = "setup";
    const n = config.playerNames.length;
    const comp = compositionFor(n);

    let bag = config.forcedCharacters ?? this.policy.selectBag(this.rng, comp);
    validateBag(bag, comp);
    this.inPlay.push(...bag);

    const seating = config.forcedSeating ?? this.rng.shuffle(bag);
    if (config.forcedSeating) {
      const a = [...seating].sort();
      const b = [...bag].sort();
      if (a.length !== b.length || a.some((x, i) => x !== b[i])) {
        throw new Error("forcedSeating must be a permutation of the bag");
      }
    }

    for (let seat = 0; seat < n; seat++) {
      const charId = seating[seat]!;
      const team = character(charId).team;
      this.players.push({
        seat,
        id: `p${seat}`,
        name: config.playerNames[seat]!,
        characterId: charId,
        believedCharacterId:
          charId === "drunk" ? this.policy.drunkBelievedRole(this.rng, bag) : charId,
        alignment: team === "minion" || team === "demon" ? "evil" : "good",
        alive: true,
        usedDeadVote: false,
        statuses: [],
      });
      this.inboxes.set(seat, []);
    }

    this.event({
      t: "charactersDealt",
      assignments: this.players.map((p) => ({
        seat: p.seat,
        characterId: p.characterId,
        believedCharacterId: p.believedCharacterId,
        alignment: p.alignment,
      })),
    });

    // Fortune Teller's red herring: only the real FT needs one.
    const ft = this.players.find((p) => p.characterId === "fortuneteller");
    if (ft) {
      const seat = this.policy.redHerring(this.policyView(), ft.seat);
      addStatus(this.player(seat), { type: "redHerring", expires: "never" });
    }

    for (const p of this.players) {
      this.sendInfo(p.seat, {
        type: "youAre",
        characterId: p.believedCharacterId,
        alignment: p.alignment,
      });
    }

    this.startNight();
  }

  // ── Night machinery ───────────────────────────────────────────────────────

  private startNight(): void {
    this.night++;
    this.phase = "night";
    this.diedTonight.clear();
    this.event({ t: "phase", phase: "night", night: this.night });
    this.cue({ cue: "phase", phase: "night", night: this.night });

    const first = this.night === 1;
    const steps: NightStep[] = [];
    if (first && this.players.length >= 7) {
      steps.push({ order: MINION_INFO_ORDER, step: { kind: "minionInfo" } });
      steps.push({ order: DEMON_INFO_ORDER, step: { kind: "demonInfo" } });
    }
    for (const p of this.players) {
      const data = character(p.believedCharacterId);
      const order = first ? data.firstNight : data.otherNight;
      if (order > 0) steps.push({ order, step: { kind: "wake", seat: p.seat } });
    }
    steps.sort((a, b) => a.order - b.order);
    this.nightQueue = steps;
    this.nightIndex = 0;
  }

  /** Progress until input is needed or the game ends. */
  advance(): void {
    while (this.winner === null && this.pending === null) {
      if (this.phase === "night") {
        if (!this.stepNight()) break;
      } else {
        break; // day phases progress via submit()/advancePhase()
      }
    }
  }

  /** Returns false when it set pending (or dawn transition happened). */
  private stepNight(): boolean {
    if (this.nightIndex >= this.nightQueue.length) {
      this.startDawn();
      return false;
    }
    const { step } = this.nightQueue[this.nightIndex]!;
    if (step.kind === "minionInfo") {
      this.nightIndex++;
      this.giveMinionInfo();
      return true;
    }
    if (step.kind === "demonInfo") {
      this.nightIndex++;
      this.giveDemonInfo();
      return true;
    }

    const p = this.player(step.seat);
    const spec = NIGHT_BEHAVIOR[p.believedCharacterId];
    if (!spec) {
      this.nightIndex++;
      return true;
    }
    const awake = spec.wakes ? spec.wakes(this, p) : p.alive;
    if (!awake) {
      this.nightIndex++;
      return true;
    }
    if (spec.choose) {
      this.pending = {
        kind: "nightAction",
        seat: p.seat,
        prompt: { characterId: p.believedCharacterId, choose: spec.choose },
      };
      return false;
    }
    this.nightIndex++;
    spec.resolve(this, p, []);
    return true;
  }

  private giveMinionInfo(): void {
    const demon = this.players.find((p) => this.teamOf(p) === "demon")!;
    const minions = this.players.filter((p) => this.teamOf(p) === "minion");
    for (const m of minions) {
      this.sendInfo(m.seat, {
        type: "minionInfo",
        demon: demon.seat,
        fellowMinions: minions.filter((x) => x.seat !== m.seat).map((x) => x.seat),
      });
    }
  }

  private giveDemonInfo(): void {
    const demon = this.players.find((p) => this.teamOf(p) === "demon")!;
    const minions = this.players.filter((p) => this.teamOf(p) === "minion");
    // Bluffs must not be in play — and a kind storyteller also avoids the
    // Drunk's believed character, or two players end up claiming it.
    const avoid = [
      ...this.inPlay,
      ...this.players.filter((p) => p.characterId === "drunk").map((p) => p.believedCharacterId),
    ];
    this.sendInfo(demon.seat, {
      type: "demonInfo",
      minions: minions.map((m) => m.seat),
      bluffs: this.policy.demonBluffs(this.rng, avoid),
    });
  }

  private startDawn(): void {
    this.phase = "dawn";
    this.day = this.night;
    for (const p of this.players) expireStatuses(p, "dawn");
    this.nominatedToday.clear();
    this.beenNominatedToday.clear();
    this.passedToday.clear();
    this.topVotes = 0;
    this.aboutToDie = null;
    this.executionOccurredToday = false;

    const deaths = [...this.diedTonight].sort((a, b) => a - b);
    this.event({ t: "phase", phase: "dawn", day: this.day });
    this.cue({ cue: "phase", phase: "dawn", day: this.day });
    this.cue({ cue: "deaths", seats: deaths });

    if (this.winner) return; // a night death may have ended the game
    this.phase = "day";
    this.event({ t: "phase", phase: "day", day: this.day });
    this.cue({ cue: "phase", phase: "day", day: this.day });
    this.pending = { kind: "day" };
  }

  // ── Day machinery ─────────────────────────────────────────────────────────

  /** Server-driven transitions: day → nominations, nominations → (execution) → night. */
  advancePhase(): Cue[] {
    if (this.winner) return this.drainCues();
    if (this.pending?.kind === "day") {
      this.phase = "nominations";
      this.pending = { kind: "nominations" };
      this.event({ t: "phase", phase: "nominations", day: this.day });
      this.cue({ cue: "phase", phase: "nominations", day: this.day });
    } else if (this.pending?.kind === "nominations") {
      this.resolveExecution();
    }
    this.advance();
    return this.drainCues();
  }

  submit(seat: number, action: PlayerAction): Cue[] {
    if (this.winner) return this.drainCues();
    switch (action.type) {
      case "nightChoice":
        this.handleNightChoice(seat, action.seats);
        break;
      case "nominate":
        this.handleNomination(seat, action.nominee);
        break;
      case "passNomination":
        this.handlePass(seat);
        break;
      case "vote":
        this.handleVote(seat, action.vote);
        break;
      case "slayerShot":
        this.handleSlayerShot(seat, action.target);
        break;
    }
    this.advance();
    return this.drainCues();
  }

  private handleNightChoice(seat: number, seats: number[]): void {
    const pend = this.pending;
    if (pend?.kind !== "nightAction" || pend.seat !== seat) {
      throw new Error(`No night action pending for seat ${seat}`);
    }
    const p = this.player(seat);
    const { choose } = NIGHT_BEHAVIOR[p.believedCharacterId]!;
    if (!choose) throw new Error("Character has no choice");
    if (seats.length !== choose.count) throw new Error(`Must choose ${choose.count}`);
    if (new Set(seats).size !== seats.length) throw new Error("Duplicate choices");
    for (const s of seats) {
      const target = this.player(s);
      if (!choose.allowSelf && s === seat) throw new Error("Cannot choose yourself");
      if (!choose.allowDead && !target.alive) throw new Error("Must choose a living player");
    }
    this.event({
      t: "nightChoice",
      seat,
      characterId: p.believedCharacterId,
      seats,
      malfunctioned: isMalfunctioning(p),
    });
    this.pending = null;
    this.nightIndex++;
    NIGHT_BEHAVIOR[p.believedCharacterId]!.resolve(this, p, seats);
  }

  private handleNomination(nominator: number, nominee: number): void {
    if (this.pending?.kind !== "nominations") throw new Error("Nominations are not open");
    const from = this.player(nominator);
    const to = this.player(nominee);
    if (!from.alive) throw new Error("Dead players cannot nominate");
    if (!to.alive) throw new Error("Dead players cannot be nominated");
    if (this.nominatedToday.has(nominator)) throw new Error("Already nominated today");
    if (this.beenNominatedToday.has(nominee)) throw new Error("Already been nominated today");

    this.nominatedToday.add(nominator);
    this.beenNominatedToday.add(nominee);
    this.event({ t: "nomination", nominator, nominee });
    this.cue({ cue: "nomination", nominator, nominee });

    // Virgin: spent on the first nomination ever, triggered only when healthy
    // and the nominator registers as a Townsfolk.
    if (to.characterId === "virgin" && !hasStatus(to, "virginSpent")) {
      addStatus(to, { type: "virginSpent", expires: "never" });
      if (
        !isMalfunctioning(to) &&
        appearanceOf(from, this.policy, this.policyView(), "virgin").team === "townsfolk"
      ) {
        this.event({ t: "virginTriggered", virgin: nominee, nominator });
        this.cue({ cue: "announce", key: "virginTriggered", data: { virgin: nominee, nominator } });
        this.executeNow(nominator, { kind: "virgin", virgin: nominee });
        return;
      }
    }

    this.pending = {
      kind: "vote",
      nominator,
      nominee,
      awaiting: this.eligibleVoters(),
    };
    this.phase = "vote";
    this.voteBallots.clear();
  }

  private handlePass(seat: number): void {
    if (this.pending?.kind !== "nominations") return;
    this.passedToday.add(seat);
    const alive = this.alivePlayers().map((p) => p.seat);
    const done = alive.every((s) => this.passedToday.has(s) || this.nominatedToday.has(s));
    if (done) this.resolveExecution();
  }

  private eligibleVoters(): number[] {
    return this.players
      .filter((p) => p.alive || !p.usedDeadVote)
      .map((p) => p.seat);
  }

  private handleVote(seat: number, vote: boolean): void {
    const pend = this.pending;
    if (pend?.kind !== "vote") throw new Error("No vote in progress");
    if (!pend.awaiting.includes(seat)) throw new Error("Not eligible to vote");
    if (this.voteBallots.has(seat)) throw new Error("Already voted");
    this.voteBallots.set(seat, vote);
    if (this.voteBallots.size === pend.awaiting.length) this.resolveVote();
  }

  private resolveVote(): void {
    const pend = this.pending;
    if (pend?.kind !== "vote") return;
    const counted: number[] = [];
    for (const [seat, vote] of this.voteBallots) {
      if (!vote) continue;
      const voter = this.player(seat);
      // Butler restriction: only while alive (dead players have no ability).
      const master = getStatus(voter, "butlerMaster");
      if (voter.alive && master && this.voteBallots.get(master.master) !== true) continue;
      counted.push(seat);
      if (!voter.alive) voter.usedDeadVote = true;
    }
    counted.sort((a, b) => a - b);
    const required = Math.ceil(this.alivePlayers().length / 2);
    const votes = counted.length;

    let outcome: "aboutToDie" | "tied" | "failed";
    if (votes >= required && votes > this.topVotes) {
      outcome = "aboutToDie";
      this.aboutToDie = pend.nominee;
    } else if (votes >= required && votes === this.topVotes) {
      outcome = "tied";
      this.aboutToDie = null;
    } else {
      outcome = "failed";
    }
    this.topVotes = Math.max(this.topVotes, votes);

    this.event({ t: "voteResult", nominee: pend.nominee, votes: counted, required, outcome });
    this.cue({ cue: "voteReveal", nominee: pend.nominee, votes: counted, required, outcome });
    this.phase = "nominations";
    this.pending = { kind: "nominations" };
  }

  private handleSlayerShot(seat: number, target: number): void {
    // Legal any time during the day — discussion, nominations, even mid-vote.
    if (
      this.pending?.kind !== "day" &&
      this.pending?.kind !== "nominations" &&
      this.pending?.kind !== "vote"
    ) {
      throw new Error("Slayer shot only during the day");
    }
    const p = this.player(seat);
    if (!p.alive) throw new Error("Dead players cannot act");
    if (p.believedCharacterId !== "slayer") throw new Error("You are not the Slayer");
    if (hasStatus(p, "slayerSpent")) throw new Error("Slayer power already used");
    addStatus(p, { type: "slayerSpent", expires: "never" });

    const t = this.player(target);
    const died =
      p.characterId === "slayer" &&
      !isMalfunctioning(p) &&
      t.alive &&
      registersAsDemon(t, this.policy, this.policyView(), "slayer");
    this.event({ t: "slayerShot", slayer: seat, target, died });
    this.cue({ cue: "slayerShot", slayer: seat, target, died });
    if (died) this.death(target, { kind: "slayer", slayer: seat });

    // If the shot killed the current nominee mid-vote, the vote is moot.
    if (!this.winner && this.pending?.kind === "vote" && !this.player(this.pending.nominee).alive) {
      this.voteBallots.clear();
      this.phase = "nominations";
      this.pending = { kind: "nominations" };
    }
  }

  /** Immediate execution (Virgin trigger). Ends the day. */
  private executeNow(seat: number, cause: DeathCause): void {
    this.executionOccurredToday = true;
    this.lastExecution = { seat, day: this.day };
    this.event({ t: "execution", seat });
    this.cue({ cue: "execution", seat });
    this.death(seat, cause);
    if (!this.winner) this.startDusk();
  }

  private resolveExecution(): void {
    this.phase = "execution";
    // The about-to-die player may have died since the vote (e.g. Slayer shot):
    // the dead cannot be executed, so the day ends with no execution.
    if (this.aboutToDie !== null && !this.player(this.aboutToDie).alive) {
      this.aboutToDie = null;
    }
    if (this.aboutToDie !== null) {
      const seat = this.aboutToDie;
      this.executionOccurredToday = true;
      this.lastExecution = { seat, day: this.day };
      this.event({ t: "execution", seat });
      this.cue({ cue: "execution", seat });
      this.death(seat, { kind: "execution" });
    } else {
      this.event({ t: "execution", seat: null });
      this.cue({ cue: "execution", seat: null });
    }
    if (!this.winner) this.startDusk();
  }

  private startDusk(): void {
    this.phase = "dusk";
    this.pending = null;
    this.event({ t: "phase", phase: "dusk", day: this.day });
    this.cue({ cue: "phase", phase: "dusk", day: this.day });

    // Mayor: only 3 alive and no execution today → good wins (while statuses
    // like poison are still active, so check before dusk expiry).
    const mayor = this.players.find((p) => p.characterId === "mayor");
    if (
      !this.executionOccurredToday &&
      this.alivePlayers().length === 3 &&
      mayor?.alive &&
      !isMalfunctioning(mayor)
    ) {
      this.endGame("good", "mayorNoExecution");
      return;
    }
    for (const p of this.players) expireStatuses(p, "dusk");
    this.startNight();
  }

  // ── Deaths and wins ───────────────────────────────────────────────────────

  /** The Imp's night kill (also handles the star-pass self-kill). */
  impKill(impSeat: number, target: number): void {
    const imp = this.player(impSeat);
    if (isMalfunctioning(imp)) {
      this.event({ t: "nightDeathPrevented", seat: target, reason: "malfunction" });
      return;
    }
    this.attemptDemonKill(impSeat, target, target === impSeat);
  }

  private attemptDemonKill(impSeat: number, target: number, isStarPass: boolean): void {
    const t = this.player(target);
    if (!t.alive) return;
    if (hasStatus(t, "protected")) {
      this.event({ t: "nightDeathPrevented", seat: target, reason: "monk" });
      return;
    }
    if (t.characterId === "soldier" && !isMalfunctioning(t)) {
      this.event({ t: "nightDeathPrevented", seat: target, reason: "soldier" });
      return;
    }
    if (t.characterId === "mayor" && !isMalfunctioning(t) && !isStarPass) {
      const bounce = this.policy.mayorBounce(this.policyView(), target, impSeat);
      if (bounce !== null && bounce !== target) {
        this.event({ t: "nightDeathPrevented", seat: target, reason: "mayorBounce" });
        // A bounce onto a dead player means nobody dies (the pipeline no-ops).
        this.attemptDemonKill(impSeat, bounce, false);
        return;
      }
    }
    this.death(target, isStarPass ? { kind: "starPass" } : { kind: "demon", source: impSeat });
  }

  death(seat: number, cause: DeathCause): void {
    const p = this.player(seat);
    if (!p.alive || this.winner) return;
    const aliveBefore = this.alivePlayers().length;
    p.alive = false;
    if (this.phase === "night") this.diedTonight.add(seat);
    this.event({ t: "death", seat, cause });

    // Ongoing effects sourced by the dead player end (poison, protection).
    removeEffectsFrom(this.players, seat);

    if (this.teamOf(p) === "demon") {
      this.handleDemonDeath(cause, aliveBefore);
      if (this.winner) return;
    }

    const isExecution = cause.kind === "execution" || cause.kind === "virgin";
    if (isExecution && p.characterId === "saint" && !isMalfunctioning(p)) {
      this.endGame("evil", "saintExecuted");
      return;
    }

    if (this.alivePlayers().length <= 2 && this.demonAlive()) {
      this.endGame("evil", "twoPlayersLeft");
    }
  }

  private handleDemonDeath(cause: DeathCause, aliveBefore: number): void {
    // Scarlet Woman catches the demon mantle if 5+ were alive (travellers
    // excluded). On a star-pass this is mandatory, not a storyteller choice.
    const sw = this.alivePlayers().find((p) => p.characterId === "scarletwoman");
    if (sw && !isMalfunctioning(sw) && aliveBefore >= 5) {
      this.promoteToImp(sw.seat, cause.kind === "starPass" ? "starPass" : "scarletWoman");
      return;
    }
    if (cause.kind === "starPass") {
      const minions = this.alivePlayers().filter((p) => this.teamOf(p) === "minion");
      if (minions.length > 0) {
        const seat = this.policy.starPassRecipient(this.policyView(), minions.map((m) => m.seat));
        this.promoteToImp(seat, "starPass");
        return;
      }
    }
    this.endGame("good", "demonKilled");
  }

  private promoteToImp(seat: number, reason: "scarletWoman" | "starPass"): void {
    const p = this.player(seat);
    this.event({ t: "characterChanged", seat, from: p.characterId, to: "imp", reason });
    // The old character's ongoing effects end with the character (a Poisoner
    // who becomes the Imp is no longer poisoning anyone).
    removeEffectsFrom(this.players, seat);
    p.characterId = "imp";
    p.believedCharacterId = "imp";
    this.sendInfo(seat, { type: "youAre", characterId: "imp", alignment: "evil" });
  }

  private endGame(team: "good" | "evil", reason: WinReason): void {
    this.winner = { team, reason };
    this.phase = "gameOver";
    this.pending = null;
    this.event({ t: "gameOver", winner: team, reason });
    this.cue({ cue: "gameOver", winner: team, reason });
  }

  // ── Info plumbing ─────────────────────────────────────────────────────────

  /**
   * Deliver info for an info-role wake: healthy players get the true generator;
   * malfunctioning players get policy false info (or the truth if the policy
   * declines — the classic "poisoned but told the truth" storyteller move).
   */
  giveInfo(
    p: Player,
    role: CharId,
    args: { targets?: number[]; executed?: number },
    trueGen: () => Info,
  ): void {
    let info: Info | null = null;
    if (isMalfunctioning(p)) {
      info = this.policy.falseInfo(this.policyView(), p, role, args);
    }
    this.sendInfo(p.seat, info ?? trueGen());
  }

  sendInfo(seat: number, info: Info): void {
    this.inboxes.get(seat)!.push(info);
    this.event({ t: "info", seat, night: this.night, info });
  }

  logStatusAdded(seat: number, statusType: string): void {
    const status = this.player(seat).statuses.find((s) => s.type === statusType);
    if (status) this.event({ t: "statusAdded", seat, status });
  }

  // ── Views and helpers ─────────────────────────────────────────────────────

  player(seat: number): Player {
    const p = this.players[seat];
    if (!p) throw new Error(`No player in seat ${seat}`);
    return p;
  }

  /** Who currently stands to be executed at day's end (public knowledge). */
  get onTheBlock(): { seat: number; votes: number } | null {
    return this.aboutToDie === null ? null : { seat: this.aboutToDie, votes: this.topVotes };
  }

  alivePlayers(): Player[] {
    return this.players.filter((p) => p.alive);
  }

  demonAlive(): boolean {
    return this.alivePlayers().some((p) => this.teamOf(p) === "demon");
  }

  teamOf(p: Player): Team {
    return character(p.characterId).team;
  }

  /** Both nearest living neighbors (deduped when only two players remain). */
  aliveNeighborsOf(seat: number): Player[] {
    const n = this.players.length;
    const found: Player[] = [];
    for (const dir of [1, -1]) {
      for (let i = 1; i < n; i++) {
        const p = this.players[(((seat + dir * i) % n) + n) % n]!;
        if (p.seat === seat) break;
        if (p.alive) {
          found.push(p);
          break;
        }
      }
    }
    return [...new Map(found.map((p) => [p.seat, p])).values()];
  }

  policyView(): PolicyView {
    return { rng: this.rng, night: this.night, players: this.players, inPlay: this.inPlay };
  }

  /**
   * A frozen snapshot for the Spy's night info. Must copy `statuses` — the
   * live array is later mutated in place (addStatus pushes onto it), so a
   * bare reference here would let a Spy's info from three nights ago silently
   * grow new statuses it never actually saw.
   */
  grimoireView(): GrimoireView {
    return {
      players: this.players.map((p) => ({
        seat: p.seat,
        name: p.name,
        characterId: p.characterId,
        alive: p.alive,
        statuses: p.statuses.map((s) => ({ ...s })),
      })),
    };
  }

  inbox(seat: number): Info[] {
    return this.inboxes.get(seat) ?? [];
  }

  private event(e: GameEvent): void {
    this.events.push(e);
  }

  private cue(c: Cue): void {
    this.cues.push(c);
  }

  drainCues(): Cue[] {
    const out = this.cues;
    this.cues = [];
    return out;
  }
}
