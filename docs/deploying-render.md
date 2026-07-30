# Deploying to Render

Hosting Grimoire on Render means players join over the real internet — no
shared Wi-Fi, no firewall/VPN/Local-Network-permission dance, and as a bonus,
Render serves everything over HTTPS, which unlocks the live in-page camera
preview for avatars (over plain local HTTP, phones fall back to the
camera-app file picker instead).

This is a single Node process — the same server that runs your game also
serves the built client — so it's one Render **Web Service**, nothing else
to provision.

## One-time setup

**1. Get this repo on GitHub** (Render deploys from a git provider — GitHub,
GitLab, or Bitbucket). If it isn't already:

```bash
git add -A
git commit -m "Initial commit"
```

Then create an empty repo on GitHub and push:

```bash
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

**2. Decide what to do about your music/SFX.** Render's disk is *ephemeral*
on the free/starter plans — anything not committed to the repo disappears on
the next deploy. `user-assets/` is gitignored by default (so your local game
nights don't bloat the repo with your music library by accident). For a
Render deployment, either:

- Commit just the folder structure and skip music for the hosted version
  (silence is the graceful fallback — nothing breaks), or
- Remove `user-assets/` from `.gitignore` and commit the SFX stings at least
  (they're small) and any music you're happy to have in the repo, or
- Upgrade to a paid Render instance type and attach a **Persistent Disk**
  mounted at `user-assets/`, and manage files by SSHing in instead of git.

**3. Deploy.** Two ways — pick one:

- **Blueprint (recommended, one click):** In the Render dashboard, "New +" →
  "Blueprint", pick this repo. Render reads `render.yaml` at the repo root
  and configures the service automatically.
- **Manual Web Service:** "New +" → "Web Service", pick this repo, and set:
  - **Build Command:** `npm install && npm run build`
  - **Start Command:** `npm run start --workspace=@grimoire/server`
  - **Plan:** Free is fine to start.

Render injects `PORT` automatically — the server already reads
`process.env.PORT`, so there's nothing to configure there.

## After it's live

Render gives you a URL like `https://grimoire-xyz.onrender.com`. Open that
as the stage — the join QR code and link now just point at that same public
URL, reachable from any phone with internet, anywhere.

## Things worth knowing

- **Free tier spins down after ~15 minutes of no traffic**, and takes 30–60s
  to wake back up on the next request. Fine for game night (the stage and
  phones keep the connection alive while anyone's connected), just don't
  create the room and then wander off for twenty minutes before starting.
- **Game state still lives entirely in server memory** (nothing is persisted
  to a database yet — see the open task to fix this). If Render restarts the
  service mid-game (a redeploy, a crash, a plan-level restart), the running
  game is lost the same way a local crash would lose it. Worth being aware
  of before a real session; ask if you'd like persistence prioritized before
  relying on this for something you don't want to risk losing.
- **CORS is wide open** (`origin: true`) — fine for a private party game with
  no login/auth, since there's nothing sensitive to protect. Don't put
  anything requiring real access control behind this without adding auth.
