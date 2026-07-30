# Grimoire — Automated Blood on the Clocktower

A fully automated, web-hosted Blood on the Clocktower party game. One shared **stage screen**
(TV/laptop) shows the town square with music, sound effects, and a spoken storyteller; every
player joins from their **phone** with a room code, Jackbox-style. A deterministic procedural
storyteller runs the entire game — setup, night order, information, deaths, nominations,
executions, and win conditions — with no human storyteller needed.

**Unofficial fan project.** Blood on the Clocktower is a trademark of Steven Medway and
The Pandemonium Institute. Character art and game data are reused from
[bra1n/townsquare](https://github.com/bra1n/townsquare) (GPL-3.0) under the fan-content
policy. Free, private, non-commercial play only.

## Layout

| Path | What it is |
| --- | --- |
| `packages/engine` | Pure TypeScript rules engine: state machine, character abilities, procedural storyteller policy, bots, simulation harness. No I/O, fully deterministic (seeded RNG), event-sourced. |
| `packages/shared` | Client/server protocol types. |
| `apps/server` | Node + socket.io: rooms, seats, private-state filtering, reconnection; serves the built client. |
| `apps/client` | Vue 3 app: stage view (`/stage`), phone player view (`/play`), dev puppeteer panel (`/dev`). |
| `assets/` | Art, fonts, and data harvested from townsquare. |
| `user-assets/` | Your own music playlists, SFX, and custom art (gitignored). |
| `vendor/townsquare` | Reference clone (gitignored). Re-clone with `git clone --depth 1 https://github.com/bra1n/townsquare vendor/townsquare`. |
| `tools/` | Data extraction and build scripts. |

## Development

```
npm install
npm run extract-data   # regenerate engine data from vendor/townsquare
npm test               # engine unit + rules tests
npm run sim            # headless full-game simulations
npm run dev            # server + client for live play
```

## Hosting a game night

Locally: double-click `Start Grimoire.command` (or `npm run party`) and share
the QR code on the stage screen with players on the same Wi-Fi.

Over the internet (no local network needed at all): see
[docs/deploying-render.md](docs/deploying-render.md) to host it on Render.
