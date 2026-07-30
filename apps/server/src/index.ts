import { createServer } from "node:http";
import { existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir, networkInterfaces } from "node:os";
import { fileURLToPath } from "node:url";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { RandomBot, Rng } from "@grimoire/engine";
import express from "express";
import multer from "multer";
import { Server } from "socket.io";
import { Room } from "./room.js";

const PORT = Number(process.env.PORT ?? 3111);
const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

// ── User audio assets ───────────────────────────────────────────────────────
// Folders the user drops music/SFX into. Created on boot so they're always
// there to find. See docs/audio-guide.md for the full naming manifest.

// Music: general (lobby + day), dusk (nominations & voting), night (abilities).
const MUSIC_FOLDERS = ["general", "dusk", "night"];
// SFX: one folder per event; drop any number of files in — the game picks one
// at random each time it fires, so multiple takes add variety.
const SFX_FOLDERS = [
  "game-start", "night-falls", "dawn-breaks", "dusk-falls",
  "death", "no-death",
  "nomination", "vote-cast", "vote-pass", "vote-fail", "vote-tie",
  "execution", "no-execution",
  "slayer-hit", "slayer-miss", "virgin-trigger",
  "good-wins", "evil-wins",
  "player-join", "your-turn", "whisper", "timer-warning",
];
const AUDIO_EXTENSIONS = /\.(mp3|ogg|wav|m4a|aac|flac)$/i;

/**
 * Point GRIMOIRE_ASSETS_DIR at any folder on disk — your real music library,
 * kept outside the git checkout so it survives re-clones/redeploys and never
 * needs uploading. The folder still needs this app's own structure inside it
 * (music/general, music/dusk, music/night, sfx/<event>/…) — bootstrapUserAssets
 * below creates that structure automatically on first run if it's missing, so
 * pointing at a brand-new empty folder "just works": drop files into the
 * subfolders it creates. This only affects a LOCAL server — a cloud host has
 * no way to reach a folder that lives on your machine.
 */
function resolveAssetsDir(): string {
  const configured = process.env.GRIMOIRE_ASSETS_DIR?.trim();
  if (!configured) return join(root, "user-assets");
  const expanded = configured.startsWith("~") ? join(homedir(), configured.slice(1)) : configured;
  return isAbsolute(expanded) ? expanded : resolve(root, expanded);
}

const userAssets = resolveAssetsDir();

function bootstrapUserAssets(): void {
  for (const f of MUSIC_FOLDERS) mkdirSync(join(userAssets, "music", f), { recursive: true });
  for (const f of SFX_FOLDERS) mkdirSync(join(userAssets, "sfx", f), { recursive: true });
  const readme = join(userAssets, "README.md");
  writeFileSync(
    readme,
    "# Your audio lives here\n\nMusic playlists: drop tracks into music/general (lobby + daytime),\nmusic/dusk (nominations & voting) and music/night.\n\nSound effects: each folder inside sfx/ is one game event — drop one or\nmore files in and the game picks one at random each time it fires.\nSee docs/audio-guide.md in the project root for what each event means.\n",
  );
}

function listAudio(dir: string, urlBase: string): string[] {
  return existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => AUDIO_EXTENSIONS.test(f))
        .sort()
        .map((f) => `${urlBase}/${encodeURIComponent(f)}`)
    : [];
}

function audioManifest(): { music: Record<string, string[]>; sfx: Record<string, string[]> } {
  const music: Record<string, string[]> = {};
  for (const folder of MUSIC_FOLDERS) {
    music[folder] = listAudio(join(userAssets, "music", folder), `/user-assets/music/${folder}`);
  }
  // Legacy folders fold into the general playlist (files there still play).
  for (const legacy of ["day", "lobby"]) {
    music["general"]!.push(
      ...listAudio(join(userAssets, "music", legacy), `/user-assets/music/${legacy}`),
    );
  }
  const sfx: Record<string, string[]> = {};
  for (const folder of SFX_FOLDERS) {
    sfx[folder] = listAudio(join(userAssets, "sfx", folder), `/user-assets/sfx/${folder}`);
  }
  return { music, sfx };
}

bootstrapUserAssets();

// ── HTTP ────────────────────────────────────────────────────────────────────

const app = express();
const http = createServer(app);
const io = new Server(http, { cors: { origin: true }, maxHttpBufferSize: 5e5 });

// Interface names that are almost never the real Wi-Fi/Ethernet adapter a
// phone could join over: VPN tunnels, container/VM bridges, hotspot/carrier
// links, etc. A dev machine with Docker Desktop, a VPN, or Parallels running
// can easily have one of these rank first in Node's interface list — and
// that address, encoded into the QR code, would be unreachable from any
// phone even though the REAL Wi-Fi address is right there too.
const VIRTUAL_IFACE = /^(utun|tun|tap|ppp|awdl|llw|bridge|docker|veth|vboxnet|vmnet|zt|tailscale|anpi)/i;

interface LanCandidate {
  address: string;
  iface: string;
  likely: boolean;
}

/** Every non-internal IPv4 address this machine has on the LAN, best guess first. */
function lanCandidates(): LanCandidate[] {
  const out: LanCandidate[] = [];
  for (const [iface, addrs] of Object.entries(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === "IPv4" && !a.internal) {
        out.push({ address: a.address, iface, likely: !VIRTUAL_IFACE.test(iface) });
      }
    }
  }
  // Likely-real adapters first (typically en0/Wi-Fi on macOS), so the QR
  // code defaults to the address actually reachable from a phone.
  out.sort((a, b) => Number(b.likely) - Number(a.likely));
  return out;
}

function lanAddresses(): string[] {
  return lanCandidates().map((c) => c.address);
}

app.use("/user-assets", express.static(userAssets));
app.get("/api/audio", (_req, res) => res.json(audioManifest()));

// ── Audio library management ────────────────────────────────────────────────
// Lets the admin panel add/remove music & SFX through the browser instead of
// needing filesystem/SSH access — the only practical way to manage audio on a
// server that isn't running on your own machine (Render, etc). On a host with
// ephemeral storage this doesn't survive a redeploy; it's still the right
// tool for "add a track before tonight's game" without touching git.
// No auth beyond "you found the /dev/CODE URL" — matches the rest of the
// app's security posture (a private link, not a public multi-tenant service).

function validFolder(category: string, folder: string): boolean {
  if (category === "music") return MUSIC_FOLDERS.includes(folder);
  if (category === "sfx") return SFX_FOLDERS.includes(folder);
  return false;
}

interface UploadRequest extends Express.Request {
  _grimoireDestDir?: string;
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const category = String(req.body.category ?? "");
      const folder = String(req.body.folder ?? "");
      if (!validFolder(category, folder)) {
        cb(new Error("Unknown category/folder"), "");
        return;
      }
      const dir = join(userAssets, category, folder);
      mkdirSync(dir, { recursive: true });
      (req as UploadRequest)._grimoireDestDir = dir;
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      // Strip any path components and disambiguate collisions — never trust
      // the client-supplied name as a full path.
      const safeName = basename(file.originalname).replace(/[/\\]/g, "_");
      const dest = (req as UploadRequest)._grimoireDestDir ?? "";
      let finalName = safeName;
      let n = 1;
      while (dest && existsSync(join(dest, finalName))) {
        const dot = safeName.lastIndexOf(".");
        finalName = dot > 0 ? `${safeName.slice(0, dot)} (${n})${safeName.slice(dot)}` : `${safeName} (${n})`;
        n++;
      }
      cb(null, finalName);
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, AUDIO_EXTENSIONS.test(file.originalname)),
});

app.post("/api/audio/upload", upload.single("file"), (req, res) => {
  if (!req.file) {
    res.status(400).json({ ok: false, error: "No audio file (or an unsupported format) was received." });
    return;
  }
  res.json({ ok: true, manifest: audioManifest() });
});

app.delete("/api/audio/file", express.json(), (req, res) => {
  const { category, folder, filename } = req.body ?? {};
  if (!validFolder(category, folder) || typeof filename !== "string") {
    res.status(400).json({ ok: false, error: "Invalid request" });
    return;
  }
  const dir = join(userAssets, category, folder);
  const target = join(dir, basename(filename));
  // Belt and suspenders: the resolved path must still be inside dir.
  if (!target.startsWith(dir + "/") || !existsSync(target)) {
    res.status(404).json({ ok: false, error: "File not found" });
    return;
  }
  unlinkSync(target);
  res.json({ ok: true, manifest: audioManifest() });
});
// The stage uses this to build a join URL/QR that phones can actually reach —
// location.origin is wrong whenever the host opened the page via localhost.
app.get("/api/host-info", (_req, res) => {
  const candidates = lanCandidates();
  const best = candidates.find((c) => c.likely) ?? candidates[0];
  res.json({
    port: PORT,
    candidates: candidates.map((c) => ({ ...c, url: `http://${c.address}:${PORT}` })),
    lanUrls: candidates.map((c) => `http://${c.address}:${PORT}`),
    primaryUrl: best ? `http://${best.address}:${PORT}` : null,
  });
});

// Serve the built client when present (single-process party deployment); the
// Vite dev server proxies /socket.io, /api and /user-assets here during dev.
const clientDist = join(root, "apps/client/dist");
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get("*", (_req, res) => res.sendFile(join(clientDist, "index.html")));
} else {
  app.get("/", (_req, res) =>
    res.send("grimoire server running — build the client with: npm run build --workspace=@grimoire/client"),
  );
}

const rooms = new Map<string, Room>();

function newCode(): string {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I/O to avoid confusion
  let code: string;
  do {
    code = Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join("");
  } while (rooms.has(code));
  return code;
}

io.on("connection", (socket) => {
  let room: Room | null = null;

  socket.on("createRoom", (settings, cb) => {
    const r = new Room(io, newCode(), settings ?? {});
    const bot = new RandomBot(new Rng(`${r.code}:bots:${Date.now()}`));
    r.botDriver = (game, seat) => bot.decide(game, seat);
    rooms.set(r.code, r);
    room = r;
    r.attachStage(socket);
    cb({ code: r.code });
  });

  socket.on("attachStage", (args: { code: string }, cb) => {
    const r = rooms.get(args.code?.toUpperCase());
    if (!r) return cb({ ok: false, error: "Room not found" });
    room = r;
    r.attachStage(socket);
    cb({ ok: true });
  });

  socket.on("attachDev", (args: { code: string }, cb) => {
    const r = rooms.get(args.code?.toUpperCase());
    if (!r) return cb({ ok: false, error: "Room not found" });
    room = r;
    r.attachDev(socket);
    cb({ ok: true });
  });

  socket.on("joinRoom", (args, cb) => {
    const r = rooms.get(args.code?.toUpperCase());
    if (!r) return cb({ ok: false, error: "Room not found" });
    room = r;
    cb(r.join(socket, String(args.name).slice(0, 20).trim() || "Player", args.sessionKey));
  });

  socket.on("setAvatar", (args: { avatar: string }) => {
    if (room && typeof args?.avatar === "string") room.setAvatar(socket.id, args.avatar);
  });

  socket.on("ready", () => {
    room?.markReady(socket.id);
  });

  socket.on("startGame", (cb) => {
    if (!room || !room.isStageOrDev(socket.id)) return cb({ ok: false, error: "Not the host" });
    cb(room.start());
  });

  socket.on("resetGame", (cb) => {
    if (!room || !room.isStageOrDev(socket.id)) return cb({ ok: false, error: "Not the host" });
    cb(room.resetGame());
  });

  socket.on("action", (args, cb) => {
    if (!room) return cb({ ok: false, error: "Not in a room" });
    const seat = room.seatOfSocket(socket.id);
    if (seat < 0) return cb({ ok: false, error: "No seat" });
    cb(room.submitAction(seat, args.action));
  });

  socket.on("advancePhase", () => {
    if (room && room.isStageOrDev(socket.id)) room.advancePhase();
  });

  socket.on("updateSettings", (patch) => {
    if (room && room.isStageOrDev(socket.id) && patch && typeof patch === "object") {
      room.updateSettings(patch);
    }
  });

  socket.on("devAction", (args, cb) => {
    if (!room || !room.isStageOrDev(socket.id)) return cb({ ok: false, error: "Not authorized" });
    cb(room.submitAction(args.seat, args.action));
  });

  socket.on("devToggleBot", (args) => {
    if (room && room.isStageOrDev(socket.id)) room.setBot(args.seat, args.bot);
  });

  socket.on("devFastForward", (args: { on: boolean }) => {
    if (room && room.isStageOrDev(socket.id)) room.setFastForward(!!args?.on);
  });

  socket.on("disconnect", () => {
    if (!room) return;
    room.handleDisconnect(socket.id);
    if (room.isEmpty) {
      // Keep empty rooms for 10 minutes in case everyone lost Wi-Fi at once.
      const code = room.code;
      setTimeout(() => {
        const r = rooms.get(code);
        if (r?.isEmpty) {
          r.dispose();
          rooms.delete(code);
        }
      }, 10 * 60 * 1000);
    }
  });
});

// Explicit 0.0.0.0 bind: accept connections on every IPv4 interface, not just
// whatever Node's unspecified-host default happens to pick on this OS.
http.listen(PORT, "0.0.0.0", () => {
  console.log(`grimoire server listening on http://localhost:${PORT}`);
  console.log(`  audio library: ${userAssets}`);
  const candidates = lanCandidates();
  if (candidates.length === 0) {
    console.log("  no LAN address found — phones on Wi-Fi won't be able to reach this server");
    console.log("  (macOS: check System Settings > Privacy & Security > Local Network for your terminal app)");
  }
  for (const c of candidates) {
    const tag = c.likely ? "" : "  (probably NOT your Wi-Fi — VPN/Docker/virtual adapter)";
    console.log(`  phones on this Wi-Fi can reach: http://${c.address}:${PORT}  [${c.iface}]${tag}`);
  }
});
