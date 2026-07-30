<script setup lang="ts">
// The shared "TV" screen: town square circle, full-screen event banners with
// SFX, phase countdown clock, phase-driven music, and the join QR code.
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRouter } from "vue-router";
import QRCode from "qrcode";
import { getSocket, onCues, onReconnect, resetGameState, sendUpdateSettings, state } from "@/socket";
import { audio } from "@/audio";
import { phaseInfoOf, skyPhaseOf } from "@/phase";
import ConnectionBanner from "@/components/ConnectionBanner.vue";
import Icon from "@/components/Icon.vue";
import TimerClock from "@/components/TimerClock.vue";
import type { Cue } from "@grimoire/engine";
import type { RoomSettings } from "@grimoire/shared";

const props = defineProps<{ code?: string }>();
const created = ref(false);
const qrDataUrl = ref("");
const muted = ref(false);
const voiceOn = ref(true);

// ── Reachable-from-phones address ───────────────────────────────────────────
// If the host opened this page via localhost (e.g. the desktop launcher), a
// QR/URL built from location.origin would point phones at localhost too —
// unreachable from any other device. Ask the server for its real LAN address
// and use that for anything a phone needs to open.
//
// This ONLY applies when the page itself was loaded via localhost. Any other
// hostname the browser used to load the page — a LAN IP typed directly, or a
// real public domain (Render, a custom domain, anything) — is by definition
// already reachable by whoever loaded it, so location.origin is trusted as-is
// and this whole LAN-guessing dance is skipped. Doing this unconditionally
// would be actively wrong on a cloud host: the server would report its own
// container-internal network address, which is unreachable from the public
// internet and would silently break every join link.
const isLocalhost = location.hostname === "localhost" || location.hostname === "127.0.0.1";
const lanOrigin = ref("");
const lanUnavailable = ref(false);
// Every candidate address the server found, beyond the one picked for the QR
// — a dev machine with a VPN, Docker Desktop, or a virtual adapter running
// can have several, and the "likely" guess is occasionally wrong. Shown as a
// fallback list so the host can try another one without needing a debugger.
interface HostCandidate {
  url: string;
  iface: string;
  likely: boolean;
}
const lanCandidates = ref<HostCandidate[]>([]);

async function loadHostInfo() {
  if (!isLocalhost) return;
  try {
    const resp = await fetch("/api/host-info");
    if (!resp.ok) return;
    const info = (await resp.json()) as {
      primaryUrl: string | null;
      candidates: HostCandidate[];
    };
    if (info.primaryUrl) lanOrigin.value = info.primaryUrl;
    else lanUnavailable.value = true;
    lanCandidates.value = info.candidates ?? [];
  } catch {
    // dev server or offline — fall back to location.origin below
  }
}

const otherCandidates = computed(() =>
  lanCandidates.value.filter((c) => `${c.url}` !== lanOrigin.value),
);

// ── Storyteller voice settings ──────────────────────────────────────────────

const voicePanelOpen = ref(false);
const voices = ref<SpeechSynthesisVoice[]>([]);
const selectedVoice = ref(audio.voiceURI ?? "");
const speechRate = ref(audio.speechRate);
const speechVolume = ref(audio.speechVolume);

function refreshVoices() {
  voices.value = audio.getVoices();
}

function applyVoice() {
  audio.setVoice(selectedVoice.value || null);
}

function applyRate() {
  audio.setSpeechRate(speechRate.value);
}

function applyVolume() {
  audio.setSpeechVolume(speechVolume.value);
}

function testVoice() {
  void audio.speak("Night falls on the town. Sleep well... if you can.");
}

// ── Sound levels (independent of the storyteller voice) ────────────────────

const musicVolume = ref(audio.musicVolume);
const sfxVolume = ref(audio.sfxVolume);

function applyMusicVolume() {
  audio.setMusicVolume(musicVolume.value);
}

function applySfxVolume() {
  audio.setSfxVolume(sfxVolume.value);
}

// ── Local audio folder ──────────────────────────────────────────────────────
// Reads music/SFX straight from a folder on THIS computer's disk — nothing is
// uploaded or sent to the server at all. Only works in this browser tab, on
// this machine (Chrome/Edge only — the File System Access API isn't in
// Firefox or Safari), which is fine since the stage is the one place that
// plays music anyway.

const localFolderBusy = ref(false);
const localFolderError = ref("");

async function pickLocalFolder() {
  localFolderError.value = "";
  localFolderBusy.value = true;
  try {
    const ok = await audio.pickLocalFolder();
    if (!ok) localFolderError.value = "No folder was selected.";
  } finally {
    localFolderBusy.value = false;
  }
}

async function reconnectLocalFolder() {
  localFolderError.value = "";
  localFolderBusy.value = true;
  try {
    const ok = await audio.reconnectLocalFolder();
    if (!ok) localFolderError.value = "Couldn't reconnect — try choosing the folder again.";
  } finally {
    localFolderBusy.value = false;
  }
}

async function disconnectLocalFolder() {
  await audio.disconnectLocalFolder();
}

// ── Pacing settings (live-adjustable) ───────────────────────────────────────
// A local editable copy of the room's settings; every change is pushed to the
// server, which clamps it and — if a timed phase is running — re-times the
// current countdown from when that phase began (never resets it to full length).

const PACING_FIELDS: Array<{
  key: keyof RoomSettings;
  label: string;
  hint: string;
  min: number;
  max: number;
  step?: number;
}> = [
  { key: "dayMinSeconds", label: "Day — minimum", hint: "floor, even with few players", min: 30, max: 3600, step: 15 },
  { key: "dayMaxSeconds", label: "Day — maximum", hint: "ceiling, even with a full table", min: 30, max: 3600, step: 15 },
  { key: "dayBaseSeconds", label: "Day — base length", hint: "before the per-player bonus", min: 0, max: 3600, step: 15 },
  { key: "dayPerLivingSeconds", label: "Day — extra per living player", hint: "seconds added per player", min: 0, max: 120, step: 1 },
  { key: "duskMinSeconds", label: "Dusk — minimum", hint: "nominations & voting floor", min: 15, max: 1800, step: 10 },
  { key: "duskMaxSeconds", label: "Dusk — maximum", hint: "nominations & voting ceiling", min: 15, max: 1800, step: 10 },
  { key: "duskBaseSeconds", label: "Dusk — base length", hint: "before the per-player bonus", min: 0, max: 1800, step: 10 },
  { key: "duskPerLivingSeconds", label: "Dusk — extra per living player", hint: "seconds added per player", min: 0, max: 60, step: 1 },
  { key: "duskGraceSeconds", label: "Dusk grace window", hint: "extra time after a late vote resolves", min: 5, max: 120, step: 5 },
  { key: "voteSeconds", label: "Vote window", hint: "time to raise a hand once called", min: 5, max: 120, step: 5 },
  { key: "nightActionTimeoutSeconds", label: "Night action timeout", hint: "before the storyteller decides for them", min: 0, max: 600, step: 5 },
];

const pacingForm = reactive<Record<string, number>>({});
/** The field the host is actively editing right now — never clobbered by a sync. */
const pacingFocused = ref<string | null>(null);

watch(
  () => state.lobby?.settings,
  (s) => {
    if (!s) return;
    // Keep every field live-synced from the server (which is the source of
    // truth and may auto-adjust a dependent field, e.g. bumping max to stay
    // ≥ min) — except whichever field the host has mid-edit right now.
    for (const f of PACING_FIELDS) {
      if (f.key !== pacingFocused.value) pacingForm[f.key] = s[f.key] as number;
    }
  },
  { immediate: true },
);

function applyPacing(key: string) {
  sendUpdateSettings({ [key]: pacingForm[key] });
}

// ── Banner queue: one dramatic beat at a time ───────────────────────────────

interface Banner {
  title: string;
  sub?: string;
  sfx?: string;
  dur: number;
  klass?: string;
  persist?: boolean;
}

const bannerQueue: Banner[] = reactive([]);
const activeBanner = ref<Banner | null>(null);

function enqueue(b: Banner) {
  bannerQueue.push(b);
  void pumpBanners();
}

async function pumpBanners() {
  if (activeBanner.value || bannerQueue.length === 0) return;
  const b = bannerQueue.shift()!;
  activeBanner.value = b;
  audio.duck();
  audio.sfx(b.sfx);
  // Let the sting land first, then the storyteller speaks; the banner holds
  // until both the minimum display time AND the voice are finished.
  const speech = new Promise<void>((r) => setTimeout(r, 1000)).then(() =>
    audio.speak(b.sub ? `${b.title}. ${b.sub}` : b.title),
  );
  if (!b.persist) {
    await Promise.all([new Promise((r) => setTimeout(r, b.dur)), speech]);
    if (activeBanner.value === b) activeBanner.value = null;
    audio.unduck();
    void pumpBanners();
  }
}

// ── Cue handling ────────────────────────────────────────────────────────────

function seatName(seat: number): string {
  return state.pub?.seats[seat]?.name ?? state.lobby?.seats[seat]?.name ?? `Seat ${seat}`;
}

const WIN_SUBTITLES: Record<string, string> = {
  demonKilled: "The Demon is dead",
  twoPlayersLeft: "Too few remain to resist",
  saintExecuted: "The town executed the Saint",
  mayorNoExecution: "The Mayor lived to see peace",
};

function handleCues(cues: Cue[]) {
  for (const c of cues) {
    switch (c.cue) {
      case "phase":
        if (c.phase === "night") {
          if (c.night === 1) {
            enqueue({ title: "The tale begins", sub: "Night falls on the town… close your eyes", sfx: "game-start", dur: 5000, klass: "night" });
          } else {
            enqueue({ title: `Night ${c.night}`, sub: "The town falls asleep…", sfx: "night-falls", dur: 4000, klass: "night" });
          }
        }
        if (c.phase === "dawn") {
          enqueue({ title: `Dawn breaks`, sub: `Day ${c.day}`, sfx: "dawn-breaks", dur: 3000, klass: "dawn" });
        }
        if (c.phase === "nominations") {
          enqueue({ title: "Dusk falls", sub: "Nominations are open — who do you accuse?", sfx: "dusk-falls", dur: 3200, klass: "night" });
        }
        break;
      case "deaths":
        if (c.seats.length === 0) {
          enqueue({ title: "A peaceful night", sub: "Nobody died", sfx: "no-death", dur: 3500, klass: "dawn" });
        } else {
          for (const s of c.seats) {
            enqueue({ title: `${seatName(s)} died in the night`, sfx: "death", dur: 3800, klass: "death" });
          }
        }
        break;
      case "nomination":
        enqueue({ title: `${seatName(c.nominator)} nominates ${seatName(c.nominee)}`, sub: "Cast your votes", sfx: "nomination", dur: 3200 });
        break;
      case "voteReveal": {
        const n = c.votes.length;
        const sfx = c.outcome === "aboutToDie" ? "vote-pass" : c.outcome === "tied" ? "vote-tie" : "vote-fail";
        const sub =
          c.outcome === "aboutToDie"
            ? `${seatName(c.nominee)} is on the block`
            : c.outcome === "tied"
              ? "A tie — nobody will hang today"
              : `Not enough (${c.required} needed)`;
        enqueue({ title: `${n} vote${n === 1 ? "" : "s"}`, sub, sfx, dur: 3800, klass: c.outcome === "aboutToDie" ? "death" : "" });
        break;
      }
      case "execution":
        if (c.seat === null) {
          enqueue({ title: "No execution today", sub: "The town spares everyone", sfx: "no-execution", dur: 3200 });
        } else {
          enqueue({ title: `${seatName(c.seat)} is executed`, sfx: "execution", dur: 5000, klass: "execution" });
        }
        break;
      case "slayerShot":
        enqueue(
          c.died
            ? { title: `${seatName(c.slayer)} SLAYS ${seatName(c.target)}!`, sub: "The arrow finds its mark", sfx: "slayer-hit", dur: 5000, klass: "execution" }
            : { title: `${seatName(c.slayer)} takes aim…`, sub: `${seatName(c.target)} doesn't even flinch`, sfx: "slayer-miss", dur: 4000 },
        );
        break;
      case "announce":
        if (c.key === "voteCast") {
          audio.sfx("vote-cast"); // a ballot landed — sound only, no banner
        }
        if (c.key === "virginTriggered") {
          const d = c.data as { virgin: number; nominator: number };
          enqueue({
            title: "The Virgin's power strikes!",
            sub: `${seatName(d.nominator)} is executed on the spot`,
            sfx: "virgin-trigger",
            dur: 5000,
            klass: "execution",
          });
        }
        break;
      case "gameOver":
        enqueue({
          title: c.winner === "good" ? "GOOD WINS" : "EVIL WINS",
          sub: WIN_SUBTITLES[c.reason] ?? "",
          sfx: c.winner === "good" ? "good-wins" : "evil-wins",
          dur: 8000,
          klass: c.winner === "good" ? "win-good" : "win-evil",
        });
        break;
    }
  }
}

// ── Music per phase ─────────────────────────────────────────────────────────

// general (lobby + day) → dusk (nominations & votes) → night. Crossfades wait
// a beat so the phase sting and storyteller line land clean. Victory moments
// are carried by the win sting; the music simply fades out.
watch(
  () => [state.pub?.phase, state.pub?.winner?.team] as const,
  ([phase, winTeam]) => {
    const delayMs = 2500;
    if (winTeam) {
      audio.stopMusic();
    } else if (!phase) {
      audio.playMusic("general"); // lobby: no sting to wait for
    } else if (phase === "day" || phase === "dawn") {
      audio.playMusic("general", { delayMs });
    } else if (phase === "night" || phase === "dusk") {
      audio.playMusic("night", { delayMs });
    } else if (phase === "nominations" || phase === "vote" || phase === "execution") {
      audio.playMusic("dusk", { delayMs });
    }
  },
  { immediate: true },
);

// A friendly blip when a phone takes a seat.
watch(
  () => state.lobby?.seats.length ?? 0,
  (n, old) => {
    if (n > (old ?? 0)) audio.sfx("player-join");
  },
);

// ── Room binding ────────────────────────────────────────────────────────────
// The room code must survive a hard refresh of the stage tab, or the host
// loses the running game and accidentally spins up a brand-new empty lobby.
// Two layers: the URL carries the code (so router.replace after creating a
// room means F5 lands back on /stage/CODE), and localStorage is a fallback
// for a bookmarked/reopened bare /stage tab that lost its history entirely.

const router = useRouter();
const STAGE_ROOM_KEY = "grimoire-stage-room";

function createRoom() {
  getSocket().emit("createRoom", {}, (resp: { code: string }) => {
    resetGameState(); // any previous room's state is gone with it
    state.code = resp.code;
    created.value = true;
    localStorage.setItem(STAGE_ROOM_KEY, resp.code);
    router.replace(`/stage/${resp.code}`);
  });
}

function attach() {
  const code = state.code || props.code || localStorage.getItem(STAGE_ROOM_KEY);
  if (!code) return createRoom();
  getSocket().emit("attachStage", { code }, (resp: { ok: boolean }) => {
    if (!resp.ok) {
      // That room is gone (server restarted, or it was never real) — start fresh.
      createRoom();
    } else {
      state.code = code;
      localStorage.setItem(STAGE_ROOM_KEY, code);
      router.replace(`/stage/${code}`);
      created.value = true;
    }
  });
}

/**
 * Opens the puppeteer/settings panel in its own tab. Must be called directly
 * from a click handler — browsers only allow window.open() as a new tab when
 * it's a direct result of a user gesture; called any other way (e.g. on load,
 * or after an await), most browsers either block it silently or — worse —
 * repurpose the CURRENT tab for it, which would hijack the shared TV screen
 * mid-game. So there is deliberately no "auto-open" attempt here.
 */
function openAdminPanel() {
  const code = state.code || props.code;
  if (!code) return;
  window.open(`${location.origin}${location.pathname}#/dev/${code}`, "_blank");
}

// If the very first connect/attach never resolves (server unreachable,
// firewalled, etc.) the lobby would otherwise sit blank forever with no clue
// why. Surface it after a generous grace period.
const connectStall = ref("");

onMounted(() => {
  getSocket();
  if (props.code) state.code = props.code;
  attach();
  onReconnect(attach);
  onCues(handleCues);
  audio.load();
  void audio.tryRestoreLocalFolder();
  loadHostInfo();
  refreshVoices();
  // Voice lists often fill in asynchronously.
  window.speechSynthesis?.addEventListener?.("voiceschanged", refreshVoices);

  setTimeout(() => {
    if (!created.value) {
      connectStall.value = state.connected
        ? "The game server isn't responding. Try reloading this page."
        : "Can't reach the game server. Make sure it's still running in the terminal window.";
    }
  }, 8000);
});

function enableAudio() {
  audio.enable();
}

function toggleMute() {
  muted.value = audio.toggleMute();
}

function toggleVoice() {
  voiceOn.value = audio.toggleSpeech();
}

/**
 * Time-of-day look for the whole scene: background image and drifting clouds
 * are tinted per phase (warm dawn, clear day, ember dusk, deep-blue night).
 */
const skyPhase = computed(() => skyPhaseOf(state.pub));

const joinUrl = computed(() => {
  const origin = lanOrigin.value || location.origin;
  return `${origin}${location.pathname}#/play/${state.code || props.code || ""}`;
});

watch(
  joinUrl,
  async (url) => {
    if (!state.code && !props.code) return;
    qrDataUrl.value = await QRCode.toDataURL(url, {
      margin: 1,
      width: 240,
      color: { dark: "#100b17", light: "#e6d3a3" },
    });
  },
  { immediate: true },
);

// ── Seats around the circle ─────────────────────────────────────────────────

interface StageSeat {
  seat: number;
  name: string;
  alive: boolean;
  usedDeadVote?: boolean;
  characterId?: string;
}

const seats = computed<StageSeat[]>(
  () =>
    state.pub?.seats ??
    state.lobby?.seats.map((s) => ({ seat: s.seat, name: s.name, alive: true })) ??
    [],
);

function avatarOf(seat: number): string | null {
  return state.lobby?.seats[seat]?.avatar ?? null;
}

function seatStyle(i: number) {
  const n = Math.max(seats.value.length, 5);
  const angle = (i / n) * 2 * Math.PI - Math.PI / 2;
  return {
    left: `${50 + 42 * Math.cos(angle)}%`,
    top: `${50 + 42 * Math.sin(angle)}%`,
  };
}

const vote = computed(() => state.pub?.vote ?? null);
const block = computed(() => state.pub?.onTheBlock ?? null);

function start() {
  audio.enable(); // the click is our autoplay-unlock gesture
  getSocket().emit("startGame", (resp: { ok: boolean; error?: string }) => {
    if (!resp.ok && resp.error) state.lastError = resp.error;
  });
}

const inLobby = computed(() => !state.pub);
const phaseInfo = computed(() => phaseInfoOf(state.pub));
const ready = computed(() => state.readiness);
</script>

<template>
  <div class="stage" @pointerdown="enableAudio">
    <ConnectionBanner />
    <div class="bg-layer" :class="skyPhase" />
    <div class="clouds c1" :class="skyPhase" />
    <div class="clouds c2" :class="skyPhase" />
    <div class="nightshade" :class="skyPhase" />
    <header class="topbar">
      <h1>Grimoire</h1>
      <div class="topright">
        <div class="phase">
          <Icon :name="phaseInfo.icon" :size="22" />
          {{ phaseInfo.text }}
        </div>
        <TimerClock :size="86" />
        <button class="mute admin" title="open admin & settings in a new tab" @click="openAdminPanel">
          <Icon name="external" :size="18" />
          Admin
        </button>
        <button class="mute" :class="{ off: !voiceOn }" title="storyteller voice" @click="toggleVoice">
          <Icon :name="voiceOn ? 'mic' : 'mic-off'" :size="20" />
        </button>
        <button class="mute" title="voice settings" @click="voicePanelOpen = !voicePanelOpen">
          <Icon name="gear" :size="20" />
        </button>
        <button class="mute" title="all sound" @click="toggleMute">
          <Icon :name="muted ? 'speaker-off' : 'speaker'" :size="20" />
        </button>
      </div>
      <div v-if="voicePanelOpen" class="voicepanel panel">
        <h3>Sound</h3>
        <label class="ratelabel">
          Music volume
          <input
            v-model.number="musicVolume"
            type="range"
            min="0"
            max="1"
            step="0.05"
            @input="applyMusicVolume"
          />
        </label>
        <label class="ratelabel">
          Sound effects volume
          <input
            v-model.number="sfxVolume"
            type="range"
            min="0"
            max="1"
            step="0.05"
            @input="applySfxVolume"
          />
        </label>

        <h3>Local audio folder</h3>
        <template v-if="!audio.localFolderSupported">
          <p class="hint">
            Not available in this browser — reading a folder straight off disk
            needs Chrome or Edge. Sound effects/music can still be added
            through the Admin panel's Audio library instead.
          </p>
        </template>
        <template v-else>
          <p class="hint">
            Point this straight at a folder on this computer — nothing is
            uploaded, the files never leave this machine. Only affects this
            browser tab (the one playing music), not players' phones.
          </p>
          <div v-if="audio.localFolderNeedsReconnect" class="localfolder-row">
            <span><Icon name="folder" :size="15" /> {{ audio.localFolderName }} (needs reconnecting)</span>
            <button :disabled="localFolderBusy" @click="reconnectLocalFolder">Reconnect</button>
          </div>
          <div v-else-if="audio.localFolderActive" class="localfolder-row">
            <span><Icon name="folder" :size="15" /> Using {{ audio.localFolderName }}</span>
            <button :disabled="localFolderBusy" @click="disconnectLocalFolder">Disconnect</button>
          </div>
          <button v-else :disabled="localFolderBusy" @click="pickLocalFolder">
            <Icon name="folder" :size="15" />
            {{ localFolderBusy ? "Reading folder…" : "Choose a folder" }}
          </button>
          <p v-if="localFolderError" class="lanwarning">{{ localFolderError }}</p>
        </template>

        <h3>Storyteller voice</h3>
        <select v-model="selectedVoice" @change="applyVoice">
          <option value="">Browser default</option>
          <option v-for="v in voices" :key="v.voiceURI" :value="v.voiceURI">
            {{ v.name }} ({{ v.lang }})
          </option>
        </select>
        <label class="ratelabel">
          Pace
          <input
            v-model.number="speechRate"
            type="range"
            min="0.6"
            max="1.3"
            step="0.02"
            @change="applyRate"
          />
        </label>
        <label class="ratelabel">
          Voice volume
          <input
            v-model.number="speechVolume"
            type="range"
            min="0"
            max="1"
            step="0.05"
            @input="applyVolume"
          />
        </label>
        <button @click="testVoice">Hear a sample</button>

        <h3>Pacing</h3>
        <p class="hint pacinghint">
          Changes apply live — a running day or dusk countdown re-times itself
          from when the phase began, without resetting to full length.
        </p>
        <div v-for="f in PACING_FIELDS" :key="f.key" class="pacingrow">
          <label>
            {{ f.label }}
            <span class="pacinghintinline">{{ f.hint }}</span>
          </label>
          <div class="pacinginput">
            <input
              v-model.number="pacingForm[f.key]"
              type="number"
              :min="f.min"
              :max="f.max"
              :step="f.step ?? 1"
              @focus="pacingFocused = f.key"
              @blur="pacingFocused = null"
              @change="applyPacing(f.key)"
            />
            <span class="unit">sec</span>
          </div>
        </div>
      </div>
    </header>

    <main class="square">
      <div
        v-for="s in seats"
        :key="s.seat"
        class="token"
        :class="{
          dead: !s.alive,
          nominee: vote?.nominee === s.seat,
          nominator: vote?.nominator === s.seat,
          block: block?.seat === s.seat,
        }"
        :style="seatStyle(s.seat)"
      >
        <div class="token-art">
          <img
            v-if="state.pub?.winner && s.characterId"
            :src="`/icons/${s.characterId}.png`"
            :alt="s.characterId"
            class="charicon"
          />
          <template v-else-if="avatarOf(s.seat)">
            <img
              v-if="avatarOf(s.seat)!.startsWith('data:')"
              :src="avatarOf(s.seat)!"
              class="selfie"
              alt=""
            />
            <span v-else class="emoji">{{ avatarOf(s.seat) }}</span>
          </template>
          <img v-if="!s.alive" src="/shroud.png" class="shroud" alt="dead" />
        </div>
        <div class="badges">
          <img
            v-if="!s.alive && s.usedDeadVote === false"
            src="/vote.png"
            class="ghostvote"
            title="ghost vote available"
            alt="ghost vote"
          />
          <span v-if="block?.seat === s.seat" class="blockmark">
            <Icon name="scales" :size="13" /> {{ block.votes }}
          </span>
        </div>
        <div class="token-name">{{ s.name }}</div>
      </div>

      <div class="centerpiece panel" :class="{ faded: activeBanner }">
        <template v-if="inLobby">
          <h2 class="code">{{ state.code || props.code }}</h2>
          <img v-if="qrDataUrl" :src="qrDataUrl" class="qr" alt="join QR" />
          <p class="join-url">{{ joinUrl }}</p>
          <p v-if="lanUnavailable" class="lanwarning">
            No Wi-Fi address found on this computer — phones won't be able to
            reach this game. Make sure this computer is on the same Wi-Fi as
            the players (not a wired-only or VPN-only connection).
          </p>
          <details v-if="otherCandidates.length > 0" class="altaddrs">
            <summary>Phone can't connect? Try another address</summary>
            <p class="hint">
              This computer has more than one network address — if the QR
              code doesn't work, try opening one of these on the phone
              instead:
            </p>
            <p v-for="c in otherCandidates" :key="c.url" class="altaddr">
              {{ c.url }}<span v-if="!c.likely"> — probably not it ({{ c.iface }})</span>
            </p>
          </details>
          <p>{{ state.lobby?.seats.length ?? 0 }} seated</p>
          <button class="primary" @click="start">Begin the tale</button>
        </template>
        <template v-else>
          <p v-if="vote" class="votebox">
            <Icon name="scales" :size="18" /> {{ seatName(vote.nominee) }} stands accused —
            {{ vote.awaiting.length }} hand{{ vote.awaiting.length === 1 ? "" : "s" }} yet to show
          </p>
          <p v-else-if="block" class="votebox">
            {{ seatName(block.seat) }} is on the block with {{ block.votes }} votes
          </p>
          <p v-else-if="state.pub?.phase === 'night'" class="votebox dim">
            The town sleeps
          </p>
          <p v-if="ready && ready.required.length > 0" class="readycount">
            <Icon name="check" :size="15" />
            {{ ready.ready.length }} of {{ ready.required.length }} ready for dusk
          </p>
        </template>
      </div>

      <!-- Full-screen event banner -->
      <transition name="banner">
        <div v-if="activeBanner" class="banner" :class="activeBanner.klass">
          <div class="banner-inner">
            <div class="banner-title">{{ activeBanner.title }}</div>
            <div v-if="activeBanner.sub" class="banner-sub">{{ activeBanner.sub }}</div>
          </div>
        </div>
      </transition>
    </main>

    <footer v-if="connectStall && !created" class="errorbar">{{ connectStall }}</footer>
    <footer v-if="state.lastError" class="errorbar" @click="state.lastError = ''">
      {{ state.lastError }}
    </footer>
  </div>
</template>

<style scoped>
.stage {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
/* ── Sky: tinted background + drifting townsquare clouds ── */
.bg-layer {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background: var(--ink) url("/background.jpg") center / cover;
  transition: filter 3s ease;
}
.bg-layer.dawn {
  filter: sepia(0.3) hue-rotate(-12deg) saturate(1.3) brightness(1.04);
}
.bg-layer.dusk {
  filter: sepia(0.45) hue-rotate(-25deg) saturate(1.5) brightness(0.8);
}
.bg-layer.night {
  filter: saturate(0.6) brightness(0.5) hue-rotate(15deg);
}
.clouds {
  position: fixed;
  left: 0;
  right: 0;
  top: -4vh;
  height: 50vh;
  z-index: 0;
  pointer-events: none;
  /* natural texture size, so a 2313px shift loops seamlessly */
  background: url("/clouds.png") repeat-x top / auto;
  opacity: 0.4;
  transition: filter 3s ease, opacity 3s ease;
  animation: clouds-drift 200s linear infinite;
  /* dissolve toward the horizon — no hard texture edge */
  mask-image: linear-gradient(to bottom, black 45%, transparent 95%);
  -webkit-mask-image: linear-gradient(to bottom, black 45%, transparent 95%);
}
.clouds.c2 {
  top: 6vh;
  opacity: 0.22;
  animation-duration: 340s;
  animation-direction: reverse;
}
.clouds.dawn {
  filter: sepia(0.5) hue-rotate(-15deg) brightness(1.1);
}
.clouds.dusk {
  filter: sepia(0.6) hue-rotate(-30deg) brightness(0.75);
  opacity: 0.5;
}
.clouds.night {
  filter: brightness(0.45) saturate(0.5) hue-rotate(160deg);
  opacity: 0.45;
}
@keyframes clouds-drift {
  from {
    background-position-x: 0;
  }
  to {
    background-position-x: 2313px;
  }
}
.nightshade {
  position: fixed;
  inset: 0;
  pointer-events: none;
  background: transparent;
  transition: background 2.5s ease;
  z-index: 1;
}
.nightshade.night {
  background: rgba(8, 10, 40, 0.45);
}
.nightshade.dusk {
  background: rgba(45, 16, 8, 0.3);
}
.topbar {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 0.8rem 1.4rem;
  z-index: 5;
  position: relative;
}
.voicepanel {
  position: absolute;
  right: 1.2rem;
  top: 4.4rem;
  z-index: 30;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  width: 23rem;
  max-height: calc(100vh - 6rem);
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}
.voicepanel h3 {
  margin-top: 0.5rem;
  font-size: 1rem;
}
.voicepanel h3:first-child {
  margin-top: 0;
}
.pacinghint {
  font-size: 0.75rem;
  opacity: 0.7;
  margin: -0.2rem 0 0.2rem;
}
.pacingrow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  font-size: 0.85rem;
  padding: 0.15rem 0;
}
.pacingrow label {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}
.pacinghintinline {
  font-size: 0.7rem;
  opacity: 0.6;
}
.pacinginput {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  flex-shrink: 0;
}
.pacinginput input {
  width: 4.5rem;
  padding: 0.3em 0.4em;
}
.pacinginput .unit {
  font-size: 0.75rem;
  opacity: 0.6;
}
.voicepanel select {
  font: inherit;
  background: rgba(0, 0, 0, 0.55);
  color: var(--parchment);
  border: 1px solid var(--gold);
  border-radius: 8px;
  padding: 0.45em;
  max-width: 19rem;
}
.ratelabel {
  display: flex;
  gap: 0.6rem;
  align-items: center;
  font-size: 0.85rem;
}
.ratelabel input {
  flex: 1;
}
.localfolder-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  font-size: 0.85rem;
}
.localfolder-row span {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.voicepanel .hint {
  font-size: 0.78rem;
  opacity: 0.7;
  margin: 0;
}
.topright {
  display: flex;
  align-items: flex-start;
  gap: 1rem;
}
.phase {
  font-size: 1.4rem;
  font-family: "PiratesBay", fantasy;
  color: var(--gold);
  margin-top: 0.4rem;
  display: flex;
  align-items: center;
  gap: 0.45rem;
}
.readycount {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  justify-content: center;
  font-size: 0.9rem;
  opacity: 0.85;
}
.mute {
  font-size: 1.1rem;
  padding: 0.4em 0.6em;
}
.mute.off {
  opacity: 0.45;
}
.admin {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.95rem;
}
.lanwarning {
  font-size: 0.78rem;
  color: #ff9c9c;
  max-width: 22rem;
  line-height: 1.4;
}
.altaddrs {
  font-size: 0.78rem;
  max-width: 22rem;
  opacity: 0.85;
}
.altaddrs summary {
  cursor: pointer;
  color: var(--gold);
}
.altaddrs .hint {
  opacity: 0.75;
  margin: 0.4rem 0;
}
.altaddr {
  font-family: monospace;
  word-break: break-all;
}
.square {
  position: relative;
  flex: 1;
  margin: 0 auto;
  width: min(92vw, 80vh);
}
.token {
  position: absolute;
  transform: translate(-50%, -50%);
  text-align: center;
  width: 96px;
  transition: filter 0.5s ease;
  z-index: 2;
}
.token-art {
  position: relative;
  width: 76px;
  height: 76px;
  margin: 0 auto;
  border-radius: 50%;
  background: url("/token.png") center / cover;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.token.nominee .token-art {
  outline: 3px solid var(--blood);
  outline-offset: 2px;
}
.token.nominator .token-art {
  outline: 3px solid var(--gold);
  outline-offset: 2px;
}
.token.block .token-art {
  outline: 3px dashed var(--blood);
  outline-offset: 3px;
}
.charicon {
  width: 85%;
  height: 85%;
  object-fit: contain;
}
.selfie {
  /* Inset like the role/emoji icons, so the token's own circular border shows
     around the edge instead of the photo covering it edge-to-edge. 85% left
     too much border showing; split the difference back toward full-bleed. */
  width: 92.5%;
  height: 92.5%;
  object-fit: cover;
  border-radius: 50%;
}
.emoji {
  font-size: 2.2rem;
  line-height: 1;
}
.shroud {
  position: absolute;
  top: -4px;
  left: 50%;
  transform: translateX(-50%);
  width: 55%;
  filter: drop-shadow(0 2px 5px #000);
}
.token.dead {
  filter: grayscale(0.85) brightness(0.65);
}
.badges {
  min-height: 1.1rem;
  display: flex;
  justify-content: center;
  gap: 0.3rem;
  align-items: center;
  margin-top: 0.2rem;
}
.ghostvote {
  width: 16px;
}
.blockmark {
  font-size: 0.75rem;
  color: #ff9c9c;
  text-shadow: 0 1px 3px #000;
}
.token-name {
  font-size: 0.85rem;
  text-shadow: 0 1px 3px #000;
}
.centerpiece {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  min-width: 17rem;
  max-width: 24rem;
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  align-items: center;
  z-index: 2;
  transition: opacity 0.35s ease;
}
.centerpiece.faded {
  opacity: 0;
}
.code {
  font-size: 2.6rem;
  letter-spacing: 0.35em;
  padding-left: 0.35em;
}
.qr {
  width: 170px;
  border-radius: 10px;
}
.join-url {
  font-size: 0.78rem;
  opacity: 0.75;
  word-break: break-all;
}
.votebox {
  color: var(--gold);
  font-size: 1.15rem;
}
.votebox.dim {
  opacity: 0.6;
}
.errorbar {
  background: var(--blood);
  color: #fff;
  text-align: center;
  padding: 0.4rem;
  cursor: pointer;
  z-index: 6;
}

/* ── Full-screen banners ── */
.banner {
  position: fixed;
  inset: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  /* Near-opaque so banner text never fights the content underneath. */
  background: radial-gradient(ellipse at center, rgba(16, 11, 23, 0.88) 0%, rgba(16, 11, 23, 0.985) 100%);
}
.banner-inner {
  text-align: center;
  padding: 2rem 3rem;
  animation: banner-pop 0.45s cubic-bezier(0.2, 1.4, 0.4, 1);
}
.banner-title {
  font-family: "PiratesBay", "Papyrus", fantasy;
  font-size: clamp(2.2rem, 7vw, 5rem);
  color: var(--gold);
  text-shadow: 0 4px 24px rgba(0, 0, 0, 0.9), 0 0 60px rgba(200, 164, 77, 0.35);
  line-height: 1.1;
}
.banner-sub {
  margin-top: 0.8rem;
  font-size: clamp(1rem, 2.6vw, 1.6rem);
  color: var(--parchment);
  opacity: 0.9;
  text-shadow: 0 2px 8px #000;
}
.banner.night .banner-title {
  color: #9db4ff;
  text-shadow: 0 4px 24px #000, 0 0 60px rgba(120, 150, 255, 0.4);
}
.banner.dawn .banner-title {
  color: #ffd98a;
}
.banner.death .banner-title,
.banner.execution .banner-title {
  color: #ff6b6b;
  text-shadow: 0 4px 24px #000, 0 0 60px rgba(206, 1, 0, 0.45);
}
.banner.win-good .banner-title {
  color: #7fa9ff;
  font-size: clamp(3rem, 10vw, 7rem);
}
.banner.win-evil .banner-title {
  color: #ff4a4a;
  font-size: clamp(3rem, 10vw, 7rem);
}
@keyframes banner-pop {
  0% {
    transform: scale(0.7);
    opacity: 0;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}
.banner-enter-active,
.banner-leave-active {
  transition: opacity 0.4s ease;
}
.banner-enter-from,
.banner-leave-to {
  opacity: 0;
}
</style>
