# Rules Engine Design

The engine (`@grimoire/engine`) is a **pure, deterministic, event-sourced** TypeScript library.
No I/O, no timers, no network. Given the same seed, config, and player inputs, a game replays
identically. Everything the server, UI, bots, and simulator do goes through this package.

## Layering

```
┌─────────────────────────────────────────────────────┐
│ storyteller policy   (judgment calls a human ST makes) │
├─────────────────────────────────────────────────────┤
│ rules engine         (what is legal, what happens)     │
├─────────────────────────────────────────────────────┤
│ data                 (characters.tb.json, night order) │
└─────────────────────────────────────────────────────┘
```

- **Rules engine** — phases, night order, ability resolution, vote math, win conditions.
  Never makes a "choice"; when the rules leave a decision to the storyteller, it asks the policy.
- **Storyteller policy** (`StorytellerPolicy` interface) — decides what a human ST would:
  which false info a drunk/poisoned player receives, the Fortune Teller's red herring, which
  Townsfolk the Drunk believes they are, how Recluse/Spy register on each query, demon bluffs,
  and dramatic tie-breaks. The default implementation is procedural and seeded; personality
  and difficulty are settings. A different policy (e.g. LLM-advised) can be swapped in later
  without touching the rules.

## The step machine

The engine is pulled forward by `game.advance()`:

1. `advance()` runs internal steps until it either **needs input** or the game ends.
2. When input is needed, `game.pending` describes it (e.g. "Imp: choose a player",
   "collect votes for nominee X"). The server prompts the right phones; bots answer through
   the same API: `game.submit(playerId, action)`.
3. Every state change appends a `GameEvent` to the log and may emit `Cue`s — semantic
   audio/visual triggers (`night-falls`, `deaths-announced`, `vote-called`) that the AV
   director on the stage client turns into music, SFX, and TTS. The engine knows nothing
   about audio.

State is derived from the event log (event-sourced), so any game is replayable and the dev
panel can time-travel.

## Phases

`lobby → setup → firstNight → dawn → day (discussion → nominations → votes → execution) → dusk → night → dawn → … → gameOver`

## Key modeling decisions

- **Actual vs believed character.** The Drunk's `characterId` is `drunk`; their
  `believedCharacterId` is a Townsfolk. All prompts/info they receive are generated *as if*
  they were that Townsfolk, but their ability malfunctions. This generalizes later to
  Lunatic/Marionette.
- **Statuses** are typed effects with a source and expiry: `poisoned(source, until)`,
  `protected(monk)`, `redHerring`, `butlerMaster(seat)`, `usedDeadVote`, etc. Reminder
  tokens in the UI map 1:1 to statuses.
- **Malfunction check.** A single `isMalfunctioning(player)` gate (drunk or poisoned)
  guards every ability. Malfunctioning info roles get policy-generated false info;
  malfunctioning active roles have no effect (but are still woken and prompted identically —
  the player must not be able to tell).
- **Registration.** `registersAs(player, query)` resolves how a player *appears* to another
  ability: Recluse may register as evil / as a Minion or Demon; Spy may register as good /
  as a Townsfolk or Outsider. The policy decides *per query*, so a Recluse can ping the
  Investigator one night and read good to the Empath the next. Kill-triggers query it too
  (Slayer shot on Recluse may work; Virgin triggered by Spy may execute them).
- **Night order** is data: sort characters-in-play by the official night-sheet numbers from
  townsquare data, with Minion-info and Demon-info as fixed pseudo-steps on night one.
  Only players whose character (or believed character) wakes are prompted; malfunctioning
  players are prompted identically to healthy ones.
- **Private info** is delivered to per-player inboxes. The server's state filter guarantees a
  phone only ever sees: public state + its own seat's private state. Tested as an invariant.

## Trouble Brewing nuances the engine must honor (acceptance checklist)

- Poisoner poisons at night; effect lasts until the next dusk. Poisoned Empath/FT/etc. get
  arbitrary (policy) info; poisoned Slayer's shot fails; poisoned Soldier can die; poisoned
  Ravenkeeper gets arbitrary info; poisoned Virgin doesn't trigger.
- Drunk: permanently malfunctioning; setup swaps in a Townsfolk they believe they are.
- Baron: +2 Outsiders, −2 Townsfolk at setup.
- Fortune Teller: one good player is a red herring (reads as Demon) all game.
- Recluse/Spy registration (above), including Chef pair counts and Undertaker reads.
- Butler: may only vote if their master voted (enforced at vote collection); chooses a new
  master each night.
- Virgin: first nomination by a Townsfolk → nominator executed immediately, day ends.
  Spy registering as Townsfolk may trigger it; used up once triggered; poisoned = no trigger.
- Slayer: once per game, publicly choose a player during the day; if Demon (by registration),
  they die. Drunk/poisoned Slayer or non-demon target: nothing happens (shot still spent).
- Soldier: safe from the Demon (not from execution). Monk protects one player per night from
  the Demon; Imp choosing a protected/soldier target = no death.
- Ravenkeeper: if killed at night, wakes and learns one player's character (policy-false if
  malfunctioning).
- Undertaker: learns the character of the player executed that day (registration applies to
  Spy/Recluse; malfunction applies).
- Mayor: if only 3 alive and no execution that day, good wins; if the Demon kills the Mayor
  at night, the policy may bounce the kill to another player.
- Scarlet Woman: if the Demon dies while 5+ players alive (travellers excluded), she becomes
  the Imp immediately (execution of the demon then does NOT end the game).
- Imp star-pass: Imp may kill themself at night; a Minion (policy picks; Scarlet Woman first
  if present) becomes the Imp.
- Saint: if executed, evil wins (not if killed at night; not if... executed only). Poisoned
  Saint executed: good does not lose.
- Votes: nominee needs ≥ ⌈alive/2⌉ votes AND strictly more than any earlier nominee today;
  equal top = no execution. Each player nominates ≤1 and is nominated ≤1 per day. Dead
  players have one dead-vote for the rest of the game.
- Win checks: Demon dies → good wins (unless Scarlet Woman promotes); 2 players alive with a
  living Demon → evil wins; Saint execution → evil wins; Mayor 3-alive rule → good wins.
- Travellers (v1.1, after core): exile votes, evil travellers known to evil, etc. Deferred.

## Testing strategy

1. **Unit tests** per character and per subsystem.
2. **Golden scenario tests** — scripted games asserting exact outcomes for every checklist
   item above (e.g. "poisoned Scarlet Woman does not become Imp when Imp is executed").
3. **Property-based simulation** — thousands of seeded games driven by bots; invariants:
   game always terminates; a healthy info role's info is always true; a malfunctioning
   role's ability never changes game state; vote math always legal; exactly one Demon alive
   unless game over; win conditions fire exactly when their conditions hold.
4. **Leak tests** — serialize per-seat filtered state every step; assert no hidden info ever
   appears in another seat's payload.
