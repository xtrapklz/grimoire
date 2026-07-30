# Rules Audit — Trouble Brewing engine vs. official rules

Audited 2026-07-28 against wiki.bloodontheclocktower.com (character "How to Run" / "Examples"
sections) and the core rulebook voting rules. Scope: `packages/engine/src` at 111-passing-tests
state. This audit hunts for what the tests and the implementation got wrong or missed; it does
not re-verify behavior the tests already assert correctly.

Legend: **CORRECT** = engine matches official. **WRONG** = engine deviates from an official
ruling. **JUDGMENT-CALL** = official rules leave it to the Storyteller or the situation is
unreachable/underspecified; engine's choice is defensible. **UNVERIFIED** = wiki did not
confirm; falling back to rules knowledge.

## Verdict table

| # | Item | Verdict | Official basis (one line) |
|---|------|---------|---------------------------|
| 1 | Scarlet Woman: 5+ alive counted immediately before demon's death, dying demon included | **CORRECT** | Wiki SW: "five or more players alive just before the Demon dies—that is, four or more players left alive after the Demon dies" |
| 2 | Poisoner dies → poison ends immediately | **CORRECT** (but see F-2) | Wiki Poisoner example: "The Mayor is no longer poisoned because there is no Poisoner in play"; dead players have no ability |
| 3 | Virgin trigger consumed on first nomination even if poisoned | **CORRECT** | Wiki Virgin: "the Virgin loses their ability ... even if the Virgin was poisoned or drunk" |
| 4 | Virgin trigger death is an execution (Saint loses, Undertaker sees it, day ends) | **CORRECT** | Wiki Virgin: "executed immediately ... End the nomination process ... (No one else can be executed today)"; Wiki Undertaker: "A player who dies because of the Virgin is considered executed" |
| 5 | Dead Butler ghost-votes unrestricted | **CORRECT** | Wiki Butler: "Because dead players have no ability, the Butler may vote with their vote token at any time" |
| 6 | Butler yes counted iff master voted yes in same collection | **JUDGMENT-CALL** (acceptable) | Wiki Butler: Butler may vote "if the Master's vote has already been counted" — simultaneous ballots give the same outcomes |
| 7 | Monk-protected Imp self-kill: death prevented entirely, no new Imp | **CORRECT** | Wiki Monk example: "The Imp chooses to kill themself tonight, but nothing happens ... a new Imp is not created" |
| 8 | Minion info / Demon info (+3 bluffs) only at 7+ players | **CORRECT** (rulebook/night sheet; wiki fetch did not restate the threshold) | TB night sheet: Minion/Demon info steps are marked for 7+ player games; demon learns "three not-in-play good characters" |
| 9 | FT red herring: any good player incl. FT, assigned at setup, permanent | **CORRECT** | Wiki FT: "may be any good player, even the Fortune Teller themself"; "the same player throughout the entire game" |
| 10 | Mayor bounce: ST redirects; redirected kill respects Soldier/Monk | **CORRECT** (caveat F-7: bounce to a dead player) | Wiki Mayor: ST "instead chooses a dead player, the Soldier, or a player protected by the Monk, that player does not die tonight" |
| 11 | Saint: evil wins only on execution of a healthy Saint | **CORRECT** | Wiki Saint: "If the Saint dies in any way other than execution ... the game continues"; Wiki Poisoner examples include a poisoned Saint whose ability fails |
| 12 | Spy sees true grimoire even when poisoned (v1 simplification) | **WRONG** (flagged; cosmetic in TB) | Wiki Poisoner: "A poisoned player has no ability, but the Storyteller pretends they do" — a poisoned Spy should get a policy-alterable (false) grimoire |
| 13 | Star-pass recipient: policy choice, SW preferred | **WRONG** (partial — see W-4) | Wiki SW: "If five or more players are alive when the Imp kills themself at night, the Scarlet Woman **must** become the new Imp"; otherwise ST choice (Wiki Imp: "choose an alive Minion") |
| 14 | Vote threshold ≥ ⌈alive/2⌉ AND > day's top; equal-to-top clears about-to-die | **CORRECT** | Rulebook: "needs a vote tally of at least 50% of the living players or no execution occurs. On a tie, neither player is executed" |
| 15 | Ghost vote spent on counted YES regardless of outcome | **CORRECT** | Rulebook: dead players "have only one vote for the rest of the game" — token is spent when used; the Butler-discard path can never apply to a dead voter (dead Butler is unrestricted) |
| 16 | Empath with both neighbors the same player counted once | **JUDGMENT-CALL** (unreachable) | Game always ends at ≤2 alive (evil at 2 with living demon; good when demon dead), so a 2-alive night never happens; the official 3-alive example ("learns a '2'") uses two distinct neighbors, which the engine also counts separately |
| 17 | Poisoned Imp: kill fails entirely (incl. self-kill) | **CORRECT** | Wiki Poisoner: "A poisoned player has no ability"; poisoned player abilities fail (examples list) |
| 18 | Registration: per-query coherent re-roll for Recluse/Spy | **CORRECT** as design (but see W-1) | Wiki Recluse: "may register as either good or evil ... at different parts of the same night. The Storyteller chooses"; Wiki Spy example: Chef sees evil, Empath sees good the same night. All five sanity cases confirmed official. Official guidance is ST discretion ("whatever is most interesting"), so a seeded per-query roll is legal; more cross-night consistency is a storytelling-quality choice, not a rules requirement |
| 19 | Night order via townsquare sheet numbers; minion=5, demon=8 pseudo-steps | **CORRECT** | Sorted engine data reproduces the official TB sheet exactly — First: Minion info, Demon info, Poisoner, Washerwoman, Librarian, Investigator, Chef, Empath, FT, Butler, Spy; Other: Poisoner, Monk, Scarlet Woman, Imp, Ravenkeeper, Empath, FT, Undertaker, Butler, Spy |
| W-1 | Poisoned/drunk Recluse & Spy still misregister | **WRONG** — noticeable | "A poisoned player has no ability" — misregistration IS their ability |
| W-2 | Star-pass to the Poisoner: their active poison persists | **WRONG** — noticeable (edge) | Poison ends when there "is no Poisoner in play" |
| W-3 | Imp (and Poisoner/Monk/Butler) cannot choose dead players | **WRONG** — noticeable for Imp | Wiki Imp: "Whenever a character's ability says 'choose a player,' that means that any player—alive or dead—can be chosen"; "If the Imp attacks a dead player at night, let them do so" |
| W-4 | SW-must-become-Imp on star-pass at 5+ alive not enforced by rules layer | **WRONG** — noticeable in principle, default-policy-safe | Wiki SW: "must become the new Imp" |
| W-5 | Ravenkeeper cannot choose themself | **WRONG** — cosmetic | Ability says "choose a player" with no self-exclusion (contrast Monk/Butler "not yourself") |

## WRONG items in detail

### W-1. Registration ignores malfunction: a poisoned/drunk Recluse or Spy still misregisters

- **Engine**: `appearanceOf()` and `registersAsDemon()` in
  `/Users/rickyjohnson/Documents/Blood on the Clock Tower/packages/engine/src/registration.ts`
  consult the policy for any Recluse/Spy with no `isMalfunctioning()` gate. A Recluse poisoned
  by the Poisoner can still register as the Imp to the Fortune Teller, still die to the
  Slayer, still ping the Empath as evil; a (hypothetically) poisoned Spy could still register
  as a Townsfolk and trigger the Virgin.
- **Official**: "A poisoned player has no ability, but the Storyteller pretends they do"
  (https://wiki.bloodontheclocktower.com/Poisoner). Misregistration is the Recluse's/Spy's
  ability ("You might register as evil…"), so while poisoned they register as their true
  self. (While merely **dead** they DO keep misregistering — "even if dead" — which the
  engine gets right.)
- **Severity**: noticeable. Reachable in real TB games (Poisoner → Recluse is a legal, if
  unusual, play) and it changes kill outcomes (Slayer shot on a poisoned Recluse must never
  kill; a poisoned Recluse must read good/Outsider everywhere).
- **Fix location**: `registration.ts` — `appearanceOf()` and `registersAsDemon()` should
  return the true appearance when `isMalfunctioning(player)` (import from `status.ts`).
  All call sites (Virgin check in `game.ts handleNomination`, `handleSlayerShot`, FT/Empath/
  Chef/info roles in `characters.ts`) then inherit the fix.

### W-2. `promoteToImp` does not end the promoted player's ongoing effects

- **Engine**: `Game.promoteToImp()` in
  `/Users/rickyjohnson/Documents/Blood on the Clock Tower/packages/engine/src/game.ts`
  only rewrites `characterId`/`believedCharacterId`. If the Imp star-passes to the
  **Poisoner** (who poisoned someone earlier that same night, Poisoner order 7 < Imp 24),
  the victim stays poisoned until dusk even though the Poisoner no longer exists.
  (`death()` handles the died-Poisoner case correctly via `removeEffectsFrom`.)
- **Official**: "The Poisoner poisons the Mayor, then becomes the Imp. The Mayor is no
  longer poisoned because there is no Poisoner in play."
  (https://wiki.bloodontheclocktower.com/Poisoner)
- **Severity**: noticeable (edge): the stale poison can falsify the victim's info later that
  night (Empath/FT wake after the Imp) or on the next day (Slayer/Virgin/Saint checks before
  dusk expiry).
- **Fix location**: `game.ts` — `promoteToImp()` should call
  `removeEffectsFrom(this.players, seat)` (same call `death()` makes).

### W-3. Night choices forbid dead targets that official rules allow

- **Engine**: `NIGHT_BEHAVIOR` in
  `/Users/rickyjohnson/Documents/Blood on the Clock Tower/packages/engine/src/characters.ts`
  sets `allowDead: false` for `imp`, `poisoner`, `monk`, `butler`; `game.ts
  handleNightChoice()` enforces it ("Must choose a living player").
- **Official**: "Whenever a character's ability says 'choose a player,' that means that any
  player—alive or dead—can be chosen ... If the Imp attacks a dead player at night, let them
  do so." (https://wiki.bloodontheclocktower.com/Imp)
- **Severity**: noticeable for the **Imp** — attacking a dead player is a legitimate
  no-kill play (fake a Monk block / Soldier hit, keep the town count high). For the
  **Poisoner** it removes a real tech (poisoning a dead Recluse/Spy stops their
  "even if dead" misregistration, e.g. before an Undertaker read). Monk/Butler dead targets
  are legal-but-pointless: cosmetic.
- **Fix location**: `characters.ts` — flip `allowDead` to `true` for imp/poisoner (monk/
  butler for strictness). Resolvers already cope: `attemptDemonKill` early-returns on a dead
  target (`if (!t.alive) return`) — though it should still emit an event so the "nobody died"
  dawn is replayable; poisoning a dead player just adds the status, which W-1's fix makes
  meaningful.

### W-4. Scarlet Woman is not *forced* to catch a star-pass at 5+ alive

- **Engine**: `handleDemonDeath()` in `game.ts` routes every star-pass to
  `policy.starPassRecipient(candidates)` — an unconstrained Storyteller choice. The default
  policy (`policy.ts starPassRecipient`) happens to prefer the Scarlet Woman, so tests pass,
  but the rules layer would accept any minion, and the default preference also ignores
  whether the SW is poisoned/drunk (choosing her anyway is still legal as an ST choice, so
  only the healthy-SW case is a genuine rules gap).
- **Official**: "If five or more players are alive when the Imp kills themself at night, the
  Scarlet Woman **must** become the new Imp."
  (https://wiki.bloodontheclocktower.com/Scarlet_Woman) — because her ability triggers on any
  demon death at 5+. Below 5 alive it is a free ST choice among living minions
  (https://wiki.bloodontheclocktower.com/Imp: "choose an alive Minion").
- **Severity**: noticeable in principle (the rules engine's contract permits an illegal
  game under a non-default policy); invisible with `DefaultPolicy`.
- **Fix location**: `game.ts handleDemonDeath()` — in the `starPass` branch, before asking
  the policy: if a living, non-malfunctioning Scarlet Woman exists and `aliveBefore >= 5`,
  promote her directly (reason `"scarletWoman"`); only otherwise consult
  `policy.starPassRecipient`.

### W-5. Ravenkeeper may not choose themself

- **Engine**: `characters.ts` ravenkeeper `choose: { count: 1, allowSelf: false, allowDead: true }`.
- **Official**: ability text is "choose a player" with no "(not yourself)" clause — the wiki
  places no self-restriction (https://wiki.bloodontheclocktower.com/Ravenkeeper). A (dead)
  Ravenkeeper choosing themself is legal (and a drunk-"Ravenkeeper" doing so should get
  policy info).
- **Severity**: cosmetic.
- **Fix location**: `characters.ts` — set `allowSelf: true` on ravenkeeper.

### Item 12 (flagged). Poisoned Spy shown the true grimoire

- **Engine**: `characters.ts` spy resolver passes a true `grimoireView()`; `policy.ts
  falseInfo()` returns `null` (truth) for `spy`. The engine cannot express an altered
  grimoire.
- **Official**: the Spy page is silent; the governing rule is "A poisoned player has no
  ability, but the Storyteller pretends they do" — so a poisoned Spy is still woken and
  shown *a* grimoire, but the ST may (should) alter it. Correct behavior: policy-generated
  false/perturbed grimoire, with the usual "truth anyway" ST option.
- **Severity**: cosmetic in practice — TB's only poison source is the (evil) Poisoner, who
  will essentially never poison their own Spy, and the Spy cannot be the Drunk. Fix when
  generalizing beyond TB.
- **Fix location**: `policy.ts falseInfo()` (handle `role === "spy"` by returning a
  perturbed `GrimoireView`) — no engine change needed since `giveInfo` already forks on
  malfunction.

## Additional findings (item 20)

- **F-1. Executing an already-dead "about to die" player feeds the Undertaker.** If the
  about-to-die nominee dies mid-day (only path in v1: Slayer shot on a Recluse registering
  as the Demon), `resolveExecution()` in `game.ts` still emits `execution` for that seat and
  sets `lastExecution`, so the Undertaker "learns which character died by execution today" —
  but officially that player died to the Slayer, not execution, and the Undertaker should
  not wake ("Deaths during the day for other reasons ... do not count",
  https://wiki.bloodontheclocktower.com/Undertaker). `death()` no-ops on the corpse so no
  double-death occurs. Cosmetic (very narrow edge). Fix: in `resolveExecution()`, skip the
  execution (treat as no-execution) if `!this.player(seat).alive`, or at least don't set
  `lastExecution`.
- **F-2. Mayor bounce cannot target a dead player.** `attemptDemonKill()` requires the
  bounce target be alive, else the Mayor dies. Officially the ST *may* redirect onto a dead
  player / Soldier / protected player and then "that player does not die tonight" — i.e.
  nobody dies, the Mayor is still saved. The Soldier/protected redirects work (recursion
  hits the prevention branches); only the dead-target redirect is unrepresentable, and the
  engine's fallback (Mayor dies) is the opposite of official. DefaultPolicy never returns a
  dead seat, so impact is nil today. Cosmetic. Fix: in `game.ts attemptDemonKill()`, accept
  a dead bounce target and emit `nightDeathPrevented` for the Mayor with no further death
  (pairs with W-3's dead-target support).
- **F-3. Slayer shot rejected while a vote is open.** `handleSlayerShot()` only accepts
  during `day`/`nominations` pending. Official: "Once per game, **during the day**" with no
  finer restriction. Nomination/vote time is still daytime. Cosmetic/procedural — decide and
  document; if allowing it mid-vote, handle the nominee-dies-mid-vote case.
- **F-4. Demon bluffs may collide with the Drunk's believed character.** `policy.ts
  demonBluffs()` excludes in-play ids and `drunk` itself, but the Drunk's
  `believedCharacterId` is not in `inPlay`, so the demon can be handed the very Townsfolk
  the Drunk is claiming. This is *legal* (bluffs must merely be good characters not in
  play) and some STs do it deliberately, but most avoid it; worth a policy option. Cosmetic.
- **F-5. Washerwoman empty-pool fallback (shows herself).** The Baron-corner fallback (only
  Townsfolk in play is the Washerwoman) has no wiki coverage; official "How to Run" only says
  to show an in-play Townsfolk and point at two players. Showing "Washerwoman + self among
  the pair" is a defensible ST improvisation; an alternative official-flavored option is
  using a Spy registering as a Townsfolk when one exists (the engine's registration pool
  already does this when the policy rolls the Spy as good). JUDGMENT-CALL — leave as is.
- **F-6. Butler nuances verified correct**: Butler can nominate (restriction is votes only);
  a Butler whose master is dead with a spent ghost vote can never vote yes; the butlerMaster
  status expiring at dusk matches "tomorrow day". First-night Butler action matches the
  sheet.
- **F-7. Confirmed-correct sweep (no action)**: dead players never wake (except the
  Ravenkeeper death-night prompt); dead Spy does not see the grimoire but keeps
  misregistering (Undertaker/Ravenkeeper reads on dead Recluse/Spy work — official per
  "even if dead"); Undertaker gates on last-*day* execution only; Ravenkeeper triggers on
  any night death incl. Mayor-bounce, day deaths never; Drunk registers as the Drunk to
  Librarian/Undertaker/Ravenkeeper and their believed role is never in play (matches token
  setup); Virgin: dead nominators are impossible (engine rejects dead nominators, official
  agrees nomination "does not count" and ability is kept); self-nomination allowed; one
  nomination made/received per player per day; only living players nominate/are nominated;
  at most one execution per day and Virgin execution ends the day; Mayor 3-alive win checked
  at dusk before poison expiry, requires living healthy Mayor, tied vote counts as no
  execution; poison spans night+next day (dusk expiry); Monk protection is demon-only and
  dies with the Monk; star-pass with no living minion ends the game (good wins); new Imp
  does not act the night they are promoted; night-1 has no Imp kill; evil two-left and
  demon-death win checks fire in the right order.

## Count of WRONG items by severity

- **Game-breaking**: 0
- **Noticeable**: 4 — W-1 (registration ignores poison/drunk), W-2 (star-pass Poisoner keeps
  poison), W-3 (dead targets forbidden — chiefly the Imp no-kill), W-4 (SW star-pass "must"
  not enforced by the rules layer)
- **Cosmetic**: 4 — W-5 (Ravenkeeper self-choice), item 12 (poisoned-Spy grimoire, flagged),
  F-1 (dead "execution" feeds Undertaker), F-2 (dead bounce target), plus F-3 timing nit
