<script setup lang="ts">
// The puppeteer panel: omniscient grimoire + control of every seat, so one
// person can play-test a full table alone. Attach with /#/dev/CODE.
import { computed, onMounted, ref } from "vue";
import { getSocket, onReconnect, sendDevAction, state } from "@/socket";
import ConnectionBanner from "@/components/ConnectionBanner.vue";
import Icon from "@/components/Icon.vue";
import RoleToken from "@/components/RoleToken.vue";

const props = defineProps<{ code: string }>();
const attached = ref(false);
const picked = ref<number[]>([]);
const fastForward = ref(false);

function toggleFastForward() {
  fastForward.value = !fastForward.value;
  getSocket().emit("devFastForward", { on: fastForward.value });
}

function attach() {
  getSocket().emit("attachDev", { code: props.code }, (resp: { ok: boolean; error?: string }) => {
    attached.value = resp.ok;
    if (!resp.ok) state.lastError = resp.error ?? "Could not attach";
  });
}

onMounted(() => {
  attach();
  onReconnect(attach);
  void refreshAudioManifest();
});

// ── Stop / reset the current game ───────────────────────────────────────────
// Click-then-confirm rather than a native confirm() dialog — clear enough to
// prevent a stray tap from ending a game, without a jarring modal popup.
const resetConfirming = ref(false);
let resetConfirmTimeout: ReturnType<typeof setTimeout> | null = null;

function resetGame() {
  if (!resetConfirming.value) {
    resetConfirming.value = true;
    resetConfirmTimeout = setTimeout(() => (resetConfirming.value = false), 4000);
    return;
  }
  if (resetConfirmTimeout) clearTimeout(resetConfirmTimeout);
  resetConfirming.value = false;
  getSocket().emit("resetGame", (resp: { ok: boolean; error?: string }) => {
    if (!resp.ok) state.lastError = resp.error ?? "Could not reset the game";
  });
}

// ── Audio library: add/remove music & SFX through the browser ──────────────
// Folder lists are derived from the manifest itself (not hardcoded here), so
// this never drifts out of sync with what the server actually recognizes.

interface AudioManifest {
  music: Record<string, string[]>;
  sfx: Record<string, string[]>;
}

const audioManifest = ref<AudioManifest>({ music: {}, sfx: {} });
const audioCategory = ref<"music" | "sfx">("music");
const audioFolder = ref("");
const audioUploading = ref(false);
const audioError = ref("");
const audioFileInput = ref<HTMLInputElement | null>(null);

const audioFolders = computed(() => Object.keys(audioManifest.value[audioCategory.value] ?? {}));
const audioFiles = computed(() => audioManifest.value[audioCategory.value]?.[audioFolder.value] ?? []);

async function refreshAudioManifest() {
  try {
    const resp = await fetch("/api/audio");
    if (resp.ok) audioManifest.value = await resp.json();
  } catch {
    // audio library just won't show — the game itself doesn't depend on it
  }
  if (!audioFolders.value.includes(audioFolder.value)) {
    audioFolder.value = audioFolders.value[0] ?? "";
  }
}

function onAudioCategoryChange() {
  audioFolder.value = audioFolders.value[0] ?? "";
}

async function uploadAudio(ev: Event) {
  const file = (ev.target as HTMLInputElement).files?.[0];
  if (!file || !audioFolder.value) return;
  audioUploading.value = true;
  audioError.value = "";
  try {
    const form = new FormData();
    form.append("category", audioCategory.value);
    form.append("folder", audioFolder.value);
    form.append("file", file);
    const resp = await fetch("/api/audio/upload", { method: "POST", body: form });
    const data = await resp.json();
    if (!resp.ok || !data.ok) audioError.value = data.error ?? "Upload failed";
    else audioManifest.value = data.manifest;
  } catch {
    audioError.value = "Upload failed — check your connection.";
  } finally {
    audioUploading.value = false;
    if (audioFileInput.value) audioFileInput.value.value = "";
  }
}

function fileNameFromUrl(url: string): string {
  return decodeURIComponent(url.split("/").pop() ?? url);
}

async function deleteAudio(url: string) {
  const filename = fileNameFromUrl(url);
  try {
    const resp = await fetch("/api/audio/file", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category: audioCategory.value, folder: audioFolder.value, filename }),
    });
    const data = await resp.json();
    if (resp.ok && data.ok) audioManifest.value = data.manifest;
    else audioError.value = data.error ?? "Could not delete file";
  } catch {
    audioError.value = "Could not delete file — check your connection.";
  }
}

const grim = computed(() => state.grimoire);
const pub = computed(() => state.pub);
const pending = computed(() => (grim.value?.pending ?? null) as
  | { kind: string; seat?: number; nominee?: number; nominator?: number; awaiting?: number[]; prompt?: { characterId: string; choose: { count: number } } }
  | null);

function start() {
  getSocket().emit("startGame", (resp: { ok: boolean; error?: string }) => {
    if (!resp.ok) state.lastError = resp.error ?? "Could not start";
  });
}

function toggleBot(seat: number, bot: boolean) {
  getSocket().emit("devToggleBot", { seat, bot });
}

async function act(seat: number, action: unknown) {
  await sendDevAction(seat, action as never);
  picked.value = [];
}

function togglePick(seat: number) {
  const idx = picked.value.indexOf(seat);
  if (idx >= 0) picked.value.splice(idx, 1);
  else picked.value.push(seat);
}

const STATUS_ICONS: Record<string, string> = {
  poisoned: "flask",
  protected: "shield",
  redHerring: "fish",
  butlerMaster: "hat",
  virginSpent: "check",
  slayerSpent: "arrow",
};

function statusIcons(statuses: Array<{ type: string }>): string[] {
  return statuses.map((s) => STATUS_ICONS[s.type] ?? "clock");
}
</script>

<template>
  <div class="dev">
    <ConnectionBanner />
    <header class="devbar">
      <h1>Puppeteer — {{ props.code }}</h1>
      <div class="controls">
        <button :class="{ primary: fastForward }" @click="toggleFastForward">
          <Icon :name="fastForward ? 'ff' : 'play'" :size="14" />
          {{ fastForward ? "fast" : "paced" }}
        </button>
        <button v-if="!pub" class="primary" @click="start">Start game</button>
        <template v-else>
          <span class="phase">{{ grim?.phase }} · N{{ grim?.night }} D{{ grim?.day }}</span>
          <button v-if="pub.phase === 'day'" @click="getSocket().emit('advancePhase')">→ nominations</button>
          <button v-if="pub.phase === 'nominations'" @click="getSocket().emit('advancePhase')">→ close day</button>
          <button class="danger" :class="{ arming: resetConfirming }" @click="resetGame">
            <Icon name="stop" :size="14" />
            {{ resetConfirming ? "Click again to confirm" : "Stop / reset game" }}
          </button>
        </template>
      </div>
    </header>

    <div v-if="pending" class="pendingbar panel">
      <strong>Waiting:</strong>
      <template v-if="pending.kind === 'nightAction'">
        {{ grim?.view.players[pending.seat!]?.name }} ({{ pending.prompt?.characterId }}) — pick
        {{ pending.prompt?.choose.count }} then confirm:
        <button
          :disabled="picked.length !== pending.prompt?.choose.count"
          @click="act(pending.seat!, { type: 'nightChoice', seats: [...picked] })"
        >
          Confirm {{ picked.map((s) => grim?.view.players[s]?.name).join(", ") || "…" }}
        </button>
      </template>
      <template v-else-if="pending.kind === 'vote'">
        Vote on {{ grim?.view.players[pending.nominee!]?.name }} — awaiting
        {{ pending.awaiting?.length }} ballots
      </template>
      <template v-else>{{ pending.kind }}</template>
    </div>

    <table v-if="grim" class="grimtable">
      <thead>
        <tr>
          <th></th><th>Seat</th><th>Character</th><th>Status</th><th>Bot</th><th>Actions</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="p in grim.view.players" :key="p.seat" :class="{ dead: !p.alive }">
          <td>
            <input
              type="checkbox"
              :checked="picked.includes(p.seat)"
              @change="togglePick(p.seat)"
            />
          </td>
          <td>
            {{ p.seat }} · {{ p.name }}
            <Icon v-if="!p.alive" name="skull" :size="14" />
          </td>
          <td>
            <RoleToken :id="p.characterId" :size="26" class="miniicon" />
            {{ p.characterId }}
          </td>
          <td>
            <Icon v-for="(ic, i) in statusIcons(p.statuses)" :key="i" :name="ic" :size="15" />
          </td>
          <td>
            <input
              type="checkbox"
              :checked="state.lobby?.seats[p.seat]?.isBot ?? false"
              @change="toggleBot(p.seat, ($event.target as HTMLInputElement).checked)"
            />
          </td>
          <td class="actions">
            <template v-if="pending?.kind === 'vote' && pending.awaiting?.includes(p.seat)">
              <button @click="act(p.seat, { type: 'vote', vote: true })"><Icon name="hand" :size="14" /> aye</button>
              <button @click="act(p.seat, { type: 'vote', vote: false })">nay</button>
            </template>
            <template v-if="pending?.kind === 'nominations' && p.alive">
              <button
                :disabled="picked.length !== 1"
                @click="act(p.seat, { type: 'nominate', nominee: picked[0] })"
              >
                nominate ☑
              </button>
              <button @click="act(p.seat, { type: 'passNomination' })">pass</button>
            </template>
          </td>
        </tr>
      </tbody>
    </table>

    <div v-if="!pub && state.lobby" class="panel" style="margin: 1rem">
      Lobby: {{ state.lobby.seats.map((s) => s.name).join(", ") || "empty" }} —
      bots fill remaining seats on start.
    </div>

    <details class="panel audiolib">
      <summary><Icon name="speaker" :size="15" /> Audio library</summary>
      <p class="hint">
        Add or remove music and sound effects here — works whether this server
        is running locally or hosted (e.g. Render). On a host with ephemeral
        storage, files added this way won't survive a redeploy; see
        docs/audio-guide.md for a permanent option.
      </p>
      <div class="audiorow">
        <select v-model="audioCategory" @change="onAudioCategoryChange">
          <option value="music">Music</option>
          <option value="sfx">Sound effect</option>
        </select>
        <select v-model="audioFolder">
          <option v-for="f in audioFolders" :key="f" :value="f">{{ f }}</option>
        </select>
        <button :disabled="!audioFolder || audioUploading" @click="audioFileInput?.click()">
          <Icon name="upload" :size="14" /> {{ audioUploading ? "Uploading…" : "Add file" }}
        </button>
        <input
          ref="audioFileInput"
          type="file"
          accept="audio/*"
          style="display: none"
          @change="uploadAudio"
        />
      </div>
      <p v-if="audioError" class="audioerror">{{ audioError }}</p>
      <ul class="audiofiles">
        <li v-for="f in audioFiles" :key="f">
          <span>{{ fileNameFromUrl(f) }}</span>
          <button class="iconbtn" title="delete" @click="deleteAudio(f)">
            <Icon name="trash" :size="14" />
          </button>
        </li>
        <li v-if="audioFiles.length === 0" class="hint">No files in this folder yet.</li>
      </ul>
    </details>

    <footer v-if="state.lastError" class="errorbar" @click="state.lastError = ''">
      {{ state.lastError }}
    </footer>
  </div>
</template>

<style scoped>
.dev {
  padding: 0.8rem;
  font-size: 0.92rem;
}
.devbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.controls {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}
.phase {
  color: var(--gold);
}
.pendingbar {
  margin: 0.6rem 0;
  padding: 0.6rem 0.9rem;
  display: flex;
  gap: 0.6rem;
  align-items: center;
  flex-wrap: wrap;
}
.grimtable {
  width: 100%;
  border-collapse: collapse;
  background: rgba(10, 6, 16, 0.85);
  border-radius: 10px;
}
.grimtable th,
.grimtable td {
  padding: 0.45rem 0.6rem;
  border-bottom: 1px solid rgba(200, 164, 77, 0.2);
  text-align: left;
}
.grimtable tr.dead {
  opacity: 0.45;
}
.miniicon {
  vertical-align: middle;
  margin-right: 0.3rem;
}
.actions {
  display: flex;
  gap: 0.3rem;
  flex-wrap: wrap;
}
.errorbar {
  background: var(--blood);
  color: #fff;
  text-align: center;
  padding: 0.4rem;
  cursor: pointer;
}
.danger {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  border-color: var(--blood);
  color: #ffb3b3;
}
.danger.arming {
  background: var(--blood);
  color: #fff;
}
.audiolib {
  margin: 1rem;
}
.audiolib summary {
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 0.4rem;
  color: var(--gold);
  font-family: "PiratesBay", fantasy;
}
.hint {
  font-size: 0.78rem;
  opacity: 0.7;
  margin: 0.5rem 0;
}
.audiorow {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  flex-wrap: wrap;
  margin: 0.5rem 0;
}
.audiorow select {
  font: inherit;
  background: rgba(0, 0, 0, 0.55);
  color: var(--parchment);
  border: 1px solid var(--gold);
  border-radius: 8px;
  padding: 0.4em 0.6em;
}
.audiorow button {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
.audioerror {
  color: #ff9c9c;
  font-size: 0.82rem;
  margin: 0.4rem 0;
}
.audiofiles {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  max-height: 12rem;
  overflow-y: auto;
}
.audiofiles li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.3rem 0.5rem;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 6px;
  font-size: 0.85rem;
}
.iconbtn {
  padding: 0.25em 0.5em;
  border-color: transparent;
  background: transparent;
}
.iconbtn:hover {
  border-color: var(--blood);
  color: #ff9c9c;
}
</style>
