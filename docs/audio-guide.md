# Audio Guide — what to source and where to put it

All audio lives in a folder shaped like this (created automatically the first
time the server runs). Drop files in, refresh the stage page, and they're
live — **anything missing is simply silent**, so you can add audio piecemeal.
Formats: mp3, ogg, wav, m4a, aac, or flac.

```
user-assets/
  music/
    general/        # lobby + daytime playlist
    dusk/           # nominations & voting — tense deliberation music
    night/          # night phase, while abilities happen
  sfx/
    <event-name>/   # one FOLDER per game event — drop any number of files in
```

## Using your own library folder instead

By default that folder is `user-assets/` inside the project (gitignored, so
it's never committed). If you'd rather keep your actual music library
somewhere else on disk — so it isn't tied to this specific git checkout, and
survives re-cloning or redeploying — point the server at it instead:

- **Double-clicking `Start Grimoire.command`**: the first time you run it,
  it'll ask "Where's your music & sound effects folder?" — type a path (e.g.
  `~/Music/GrimoireAudio`) or leave it blank to keep using the bundled
  `user-assets/`. It's remembered after that; delete the
  `.grimoire-assets-path` file in the project and run again to change it.
- **Running from the terminal directly**: set `GRIMOIRE_ASSETS_DIR`, e.g.
  `GRIMOIRE_ASSETS_DIR=~/Music/GrimoireAudio npm run party`.

Either way, the folder you point at still needs this app's own structure
inside it — the server creates the `music/general`, `music/dusk`,
`music/night`, and every `sfx/<event-name>` subfolder automatically on first
run if they're missing, so pointing at a brand-new empty folder works fine:
just drop your files into the subfolders it creates.

**This only works for a server running on your own machine.** A cloud host
(Render, etc.) has no way to reach a folder that lives on your computer —
for that, either commit `user-assets/` to the repo so it deploys with the
app, or run Grimoire locally and use a tunnel (ngrok / Cloudflare Tunnel) so
your local server — audio library and all — is reachable from the internet
without deploying anywhere.

## Music

The presented cycle is **Dawn → Day → Dusk → Night**. Dawn is just the
announcements of what happened overnight, so it has no music of its own.

| Folder | When it plays | What to look for |
| --- | --- | --- |
| `music/general/` | Lobby and daytime discussion | Warm village/tavern folk — talkable background |
| `music/dusk/` | Nominations and voting | Ambient, tense — rising strings, heartbeat percussion, courtroom dread |
| `music/night/` | The whole night phase | Dark ambient drones, crickets, distant bells — fills time while night actions come in |

Multiple tracks in a folder become a shuffled, crossfading playlist; a single
track loops. Music **ducks** (drops to ~30%) while a banner sting plays, then
swells back. When the game ends the music fades out and the win sting carries
the moment.

## Sound effects — one folder per event

Each folder inside `sfx/` is a game event. Drop **one or more** files into a
folder and the game picks one at random each time the event fires — multiple
takes add variety (three different death stings beats hearing the same one
every dawn).

### Phase transitions
| Folder | Fires when | What to look for |
| --- | --- | --- |
| `sfx/game-start/` | "The tale begins" | Deep clock-tower bell, one grand strike |
| `sfx/night-falls/` | Night begins | Slow bell + owl/wind; 2–4s, settles the room |
| `sfx/dawn-breaks/` | Morning arrives, before the news | Rooster / morning birds + soft chime |
| `sfx/dusk-falls/` | Dusk begins — nominations open | Descending chime, town-crier bell |

### The night's news (dawn announcements)
| Folder | Fires when | What to look for |
| --- | --- | --- |
| `sfx/death/` | Each overnight death announced | Somber drum hit + low bell; grave, not gory |
| `sfx/no-death/` | Nobody died | Gentle relieved chord, birdsong |

### Dusk — nominations and voting
| Folder | Fires when | What to look for |
| --- | --- | --- |
| `sfx/nomination/` | Someone is nominated | Sharp dramatic sting |
| `sfx/vote-cast/` | Each ballot lands (content stays secret) | Small wooden tick/thunk — keep under half a second |
| `sfx/vote-pass/` | Enough votes — someone is on the block | Heavy judgment chord |
| `sfx/vote-fail/` | Not enough votes | Deflating note, crowd murmur |
| `sfx/vote-tie/` | Tie — nobody will hang today | Confused murmur, unresolved chord |
| `sfx/execution/` | The execution lands | Drum roll into a thud + tolling bell |
| `sfx/no-execution/` | Dusk ends with nobody executed | Soft reprieve chord |

### Ability moments (all public)
| Folder | Fires when | What to look for |
| --- | --- | --- |
| `sfx/slayer-hit/` | Slayer shot kills the Demon | Arrow loose + impact + triumphant hit |
| `sfx/slayer-miss/` | Slayer shot does nothing | Arrow loose + whiff |
| `sfx/virgin-trigger/` | Virgin's power executes the nominator | Holy flash / lightning crack |

### Endings
| Folder | Fires when | What to look for |
| --- | --- | --- |
| `sfx/good-wins/` | Good team victory | Full fanfare, bells, cheering |
| `sfx/evil-wins/` | Evil team victory | Evil laugh, dark choir hit |

### Small UI moments
| Folder | Fires when | What to look for |
| --- | --- | --- |
| `sfx/player-join/` | A phone takes a seat | Short friendly blip/chime |
| `sfx/timer-warning/` | 10 seconds left on a phase clock | Ticking clock or single warning chime |
| `sfx/your-turn/` | *On the phone*: your night action awaits | Quiet mystical chime (bedside volume) |
| `sfx/whisper/` | *On the phone*: secret info arrives | Soft page-turn / whisper swish |

## Tips for sourcing

- Keep stings under ~4 seconds; they gate the banner rhythm.
- Aim for one consistent family of sounds (all medieval/organic, or all
  game-show-brassy — mixing both breaks the spell).
- Normalize SFX loudness roughly to each other; music quieter than SFX.
  There's a mute control on the stage.
