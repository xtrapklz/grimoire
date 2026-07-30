// Core domain types. The engine is event-sourced: state is derived from GameEvents,
// and every audio/visual consequence is expressed as a Cue for the AV director.

export type Team = "townsfolk" | "outsider" | "minion" | "demon" | "traveller";
export type Alignment = "good" | "evil";
export type CharId = string;

export interface CharacterData {
  id: CharId;
  name: string;
  team: Team;
  ability: string;
  /** Official night-sheet sort keys (0 = does not wake). */
  firstNight: number;
  otherNight: number;
  firstNightReminder: string;
  otherNightReminder: string;
  reminders: string[];
  setup: boolean;
  icon: string;
}

// ── Statuses ────────────────────────────────────────────────────────────────
// Reminder tokens in the grimoire map 1:1 to these.

export type StatusExpiry = "dawn" | "dusk" | "never";

export type Status =
  | { type: "poisoned"; source: number; expires: StatusExpiry }
  | { type: "protected"; source: number; expires: "dawn" }
  | { type: "redHerring"; expires: "never" }
  | { type: "butlerMaster"; master: number; expires: "dusk" }
  | { type: "virginSpent"; expires: "never" }
  | { type: "slayerSpent"; expires: "never" };

export interface Player {
  seat: number; // 0-based, clockwise around the stage circle
  id: string;   // stable client identity (survives reconnects)
  name: string;
  characterId: CharId;
  /** Differs from characterId only for the Drunk (believes they are a Townsfolk). */
  believedCharacterId: CharId;
  alignment: Alignment;
  alive: boolean;
  usedDeadVote: boolean;
  statuses: Status[];
}

// ── Phases ──────────────────────────────────────────────────────────────────

export type Phase =
  | "lobby"
  | "setup"
  | "night"      // includes the first night; state.night = 1, 2, …
  | "dawn"       // death announcements
  | "day"        // open discussion
  | "nominations"
  | "argument"   // case (30s) then defense (30s) before voting opens
  | "vote"       // a specific nomination being voted on
  | "execution"  // showing the result
  | "dusk"       // day wrap-up before night falls
  | "gameOver";

export type DeathCause =
  | { kind: "demon"; source: number }
  | { kind: "execution" }
  | { kind: "virgin"; virgin: number }
  | { kind: "slayer"; slayer: number }
  | { kind: "starPass" }; // imp killed themself

// ── Private information ─────────────────────────────────────────────────────
// Semantic payloads; the narration layer renders them to text/TTS per language
// and personality. Seat numbers refer to public seats, CharIds to characters.

export type Info =
  | { type: "youAre"; characterId: CharId; alignment: Alignment }
  | { type: "minionInfo"; demon: number; fellowMinions: number[] }
  | { type: "demonInfo"; minions: number[]; bluffs: CharId[] }
  | { type: "washerwoman"; characterId: CharId; candidates: [number, number] }
  | { type: "librarian"; characterId: CharId; candidates: [number, number] }
  | { type: "librarianNone" }
  | { type: "investigator"; characterId: CharId; candidates: [number, number] }
  | { type: "chef"; count: number }
  | { type: "empath"; count: number }
  | { type: "fortuneteller"; targets: [number, number]; isDemon: boolean }
  | { type: "undertaker"; executed: number; characterId: CharId }
  | { type: "ravenkeeper"; target: number; characterId: CharId }
  | { type: "spy"; grimoire: GrimoireView };

/** What the Spy sees: the full hidden state, as the storyteller's grimoire shows it. */
export interface GrimoireView {
  players: Array<{
    seat: number;
    name: string;
    characterId: CharId;
    alive: boolean;
    statuses: Status[];
  }>;
}

// ── Player inputs ───────────────────────────────────────────────────────────

export type NightPrompt = {
  /** Which ability the prompt belongs to (the *believed* character for the Drunk). */
  characterId: CharId;
  choose: {
    count: number;
    allowSelf: boolean;
    allowDead: boolean;
  };
};

export type PlayerAction =
  | { type: "nightChoice"; seats: number[] }
  | { type: "nominate"; nominee: number }
  | { type: "passNomination" } // player declines to nominate right now
  | { type: "skipArgument" } // current speaker ends their case/defense window early
  | { type: "vote"; vote: boolean }
  | { type: "slayerShot"; target: number };

/** What the engine is waiting for. The server/bots answer via Game.submit(). */
export type Pending =
  | { kind: "nightAction"; seat: number; prompt: NightPrompt }
  | { kind: "day" }         // discussion; slayer shots allowed; server advances to nominations
  | { kind: "nominations" } // awaiting nominate/pass from alive players; server may close
  | { kind: "argument"; nominator: number; nominee: number; stage: "case" | "defense" }
  | { kind: "vote"; nominator: number; nominee: number; awaiting: number[] }
  | null;

// ── Events (append-only log; full game replay) ──────────────────────────────

export type GameEvent =
  | { t: "gameStarted"; seed: string; playerNames: string[] }
  | { t: "charactersDealt"; assignments: Array<{ seat: number; characterId: CharId; believedCharacterId: CharId; alignment: Alignment }> }
  | { t: "phase"; phase: Phase; night?: number; day?: number }
  | { t: "info"; seat: number; night: number; info: Info }
  | { t: "nightChoice"; seat: number; characterId: CharId; seats: number[]; malfunctioned: boolean }
  | { t: "statusAdded"; seat: number; status: Status }
  | { t: "statusRemoved"; seat: number; statusType: Status["type"] }
  | { t: "death"; seat: number; cause: DeathCause }
  | { t: "nightDeathPrevented"; seat: number; reason: "soldier" | "monk" | "malfunction" | "mayorBounce" }
  | { t: "nomination"; nominator: number; nominee: number }
  | { t: "argumentStage"; nominator: number; nominee: number; stage: "case" | "defense" }
  | { t: "virginTriggered"; virgin: number; nominator: number }
  | { t: "slayerShot"; slayer: number; target: number; died: boolean }
  | { t: "voteResult"; nominee: number; votes: number[]; required: number; outcome: "aboutToDie" | "tied" | "failed" }
  | { t: "execution"; seat: number | null }
  | { t: "characterChanged"; seat: number; from: CharId; to: CharId; reason: "scarletWoman" | "starPass" }
  | { t: "gameOver"; winner: Alignment; reason: WinReason };

export type WinReason =
  | "demonKilled"
  | "twoPlayersLeft"
  | "saintExecuted"
  | "mayorNoExecution";

// ── Cues for the AV director ────────────────────────────────────────────────
// Semantic triggers; the stage client maps them to music, SFX, TTS, visuals.

export type Cue =
  | { cue: "phase"; phase: Phase; night?: number; day?: number }
  | { cue: "announce"; key: string; data?: Record<string, unknown> }
  | { cue: "deaths"; seats: number[] }          // dawn reveal (may be empty = peaceful night)
  | { cue: "nomination"; nominator: number; nominee: number }
  | { cue: "argumentStage"; nominator: number; nominee: number; stage: "case" | "defense" }
  | { cue: "voteReveal"; nominee: number; votes: number[]; required: number; outcome: string }
  | { cue: "execution"; seat: number | null }
  | { cue: "slayerShot"; slayer: number; target: number; died: boolean }
  | { cue: "gameOver"; winner: Alignment; reason: WinReason };

// ── Config ──────────────────────────────────────────────────────────────────

export interface GameConfig {
  seed: string;
  playerNames: string[];
  /** Force specific characters into the bag (testing/golden scenarios). */
  forcedCharacters?: CharId[];
  /** Force seat assignments: seat index -> characterId (testing). */
  forcedSeating?: CharId[];
}
