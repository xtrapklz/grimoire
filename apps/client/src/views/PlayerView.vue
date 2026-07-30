<script setup lang="ts">
// The phone controller: join, secret role card, night prompts, voting.
import { computed, onMounted, ref, watch } from "vue";
import { getSocket, onReconnect, sendAction, sendReady, sessionKey, state } from "@/socket";
import { audio } from "@/audio";
import { phaseInfoOf, skyPhaseOf } from "@/phase";
import AvatarPicker from "@/components/AvatarPicker.vue";
import ConnectionBanner from "@/components/ConnectionBanner.vue";
import GuideSheet from "@/components/GuideSheet.vue";
import Icon from "@/components/Icon.vue";
import RoleToken from "@/components/RoleToken.vue";
import TimerClock from "@/components/TimerClock.vue";
import { character, type Info } from "@grimoire/engine";

const props = defineProps<{ code?: string }>();
const codeInput = ref(props.code ?? "");
const nameInput = ref(localStorage.getItem("grimoire-name") ?? "");
const joined = ref(false);
const joinError = ref("");
const picked = ref<number[]>([]);
const cardRevealed = ref(false);
const nominateTarget = ref<number | null>(null);

// If this browser previously joined this exact room, a refresh (page reload,
// iOS Safari killing a backgrounded tab, phone restart, …) should silently
// reclaim the seat via sessionKey rather than show the join form again — that
// flash could make a mid-game player think they'd been removed and re-enter
// a different name, splitting them into a second, wrong seat.
const savedRoom = localStorage.getItem("grimoire-room");
const autoRejoining = ref(!!(props.code && savedRoom === props.code && nameInput.value));
// True while a join/rejoin is in flight with no answer yet — used to detect
// a request that never gets an ack (server unreachable) instead of failing
// silently, which otherwise looks exactly like a dead "Take a seat" button.
const joining = ref(false);
const JOIN_TIMEOUT_MS = 7000;

onMounted(() => {
  getSocket();
  if (autoRejoining.value) join();
  // Phone slept / Wi-Fi blipped: the sessionKey reclaims our seat mid-game.
  onReconnect(() => {
    if (joined.value) join();
  });
});

function join() {
  joinError.value = "";
  joining.value = true;
  audio.load();
  audio.enable(); // the tap is our autoplay-unlock gesture
  const socket = getSocket();
  const timeout = setTimeout(() => {
    if (!joining.value) return;
    joining.value = false;
    autoRejoining.value = false;
    joinError.value =
      "No response from the game after 7 seconds. Make sure this phone is on the same Wi-Fi as the host computer (not cellular data, and no VPN), then try again.";
  }, JOIN_TIMEOUT_MS);
  socket.emit(
    "joinRoom",
    { code: codeInput.value.toUpperCase(), name: nameInput.value, sessionKey: sessionKey() },
    (resp: { ok: boolean; error?: string; seat?: number }) => {
      clearTimeout(timeout);
      joining.value = false;
      if (resp.ok) {
        joined.value = true;
        if (typeof resp.seat === "number") state.mySeat = resp.seat;
        localStorage.setItem("grimoire-name", nameInput.value);
        localStorage.setItem("grimoire-room", codeInput.value.toUpperCase());
      } else {
        joinError.value = resp.error ?? "Could not join";
        autoRejoining.value = false; // fall through to the join form, error visible
      }
    },
  );
}

const me = computed(() => state.seat);
const pub = computed(() => state.pub);
const alive = computed(() => {
  const seat = me.value?.seat;
  return seat !== undefined ? pub.value?.seats[seat]?.alive ?? true : true;
});

const prompt = computed(() => me.value?.prompt ?? null);
const choosable = computed(() => {
  if (prompt.value?.kind !== "nightAction" || !pub.value) return [];
  const { allowSelf, allowDead } = prompt.value.choose;
  return pub.value.seats.filter((s) => {
    if (!allowSelf && s.seat === me.value!.seat) return false;
    if (!allowDead && !s.alive) return false;
    return true;
  });
});

function togglePick(seat: number) {
  if (prompt.value?.kind !== "nightAction") return;
  const idx = picked.value.indexOf(seat);
  if (idx >= 0) picked.value.splice(idx, 1);
  else if (picked.value.length < prompt.value.choose.count) picked.value.push(seat);
}

async function submitNightChoice() {
  if (prompt.value?.kind !== "nightAction") return;
  const resp = await sendAction({ type: "nightChoice", seats: [...picked.value] });
  if (resp.ok) picked.value = [];
}

async function vote(v: boolean) {
  await sendAction({ type: "vote", vote: v });
}

async function nominate() {
  if (nominateTarget.value === null) return;
  await sendAction({ type: "nominate", nominee: nominateTarget.value });
  nominateTarget.value = null;
}

async function skipArgument() {
  await sendAction({ type: "skipArgument" });
}

const latestInfo = computed<Info | null>(() => {
  const inbox = me.value?.inbox ?? [];
  return inbox.length ? inbox[inbox.length - 1]! : null;
});

// Quiet phone-side cues: a chime when it's your turn, a whisper for new info.
watch(
  () => prompt.value?.kind,
  (kind, old) => {
    if (kind && kind !== old) audio.sfx("your-turn");
  },
);
watch(
  () => me.value?.inbox.length ?? 0,
  (n, old) => {
    if (n > (old ?? 0) && (old ?? 0) > 0) audio.sfx("whisper");
  },
);

const myAvatar = computed(() => {
  // Before the game starts there's no SeatView yet (me.value), so fall back
  // to the seat number the joinRoom ack gave us — otherwise the lobby's own
  // avatar preview can never show what was actually saved.
  const seat = me.value?.seat ?? state.mySeat ?? -1;
  return state.lobby?.seats[seat]?.avatar ?? null;
});

const guideOpen = ref(false);
const recordOpen = ref(false);
const whispersOpen = ref(false);

// In the physical game, private information is shown once and never again —
// you remember it or you don't. A permanent scrollback log breaks that, most
// visibly for the Spy (who'd otherwise get a standing reference to the whole
// grimoire all day, every day). So the whisper card and its full history are
// only reachable while it's actually night; once dawn breaks, they're gone
// until the next night's info arrives. Your own role ("You are the X") is
// exempt — that's shown separately via the always-visible role card, not
// through this system, matching how you'd never forget your own character.
const infoVisible = computed(() => pub.value?.phase === "night");
watch(
  () => pub.value?.phase,
  (phase, old) => {
    if (old === "night" && phase !== "night") whispersOpen.value = false;
  },
);

const skyPhase = computed(() => skyPhaseOf(state.pub));
const phaseInfo = computed(() => phaseInfoOf(state.pub));

/** Reminder-token icons for grimoire statuses (Spy view). */
const STATUS_ICONS: Record<string, string> = {
  poisoned: "flask",
  protected: "shield",
  redHerring: "fish",
  butlerMaster: "hat",
  virginSpent: "check",
  slayerSpent: "arrow",
};

/** The official ability text for the card the player believes they hold. */
const myAbility = computed(() => {
  const id = me.value?.characterId;
  if (!id) return "";
  try {
    return character(id).ability;
  } catch {
    return "";
  }
});

const iAmReady = computed(() => {
  const seat = me.value?.seat;
  return seat !== undefined && (state.readiness?.ready.includes(seat) ?? false);
});
const showReadyButton = computed(
  () =>
    (pub.value?.phase === "day" || pub.value?.phase === "nominations") &&
    alive.value &&
    !prompt.value &&
    state.readiness !== null,
);

function seatName(seat: number): string {
  return pub.value?.seats[seat]?.name ?? `Seat ${seat}`;
}

function describeInfo(info: Info): string {
  switch (info.type) {
    case "youAre":
      return `You are the ${info.characterId.toUpperCase()}`;
    case "minionInfo":
      return `Your Demon is ${seatName(info.demon)}${info.fellowMinions.length ? `; fellow minions: ${info.fellowMinions.map(seatName).join(", ")}` : ""}`;
    case "demonInfo":
      return `Your minions: ${info.minions.map(seatName).join(", ")}. Safe bluffs: ${info.bluffs.join(", ")}`;
    case "washerwoman":
    case "librarian":
    case "investigator":
      return `One of ${seatName(info.candidates[0])} or ${seatName(info.candidates[1])} is the ${info.characterId}`;
    case "librarianNone":
      return "There are no Outsiders in play";
    case "chef":
      return `Pairs of evil neighbours: ${info.count}`;
    case "empath":
      return `Evil living neighbours: ${info.count}`;
    case "fortuneteller":
      return `${seatName(info.targets[0])} & ${seatName(info.targets[1])}: ${info.isDemon ? "YES — one registers as the Demon" : "no"}`;
    case "undertaker":
      return `${seatName(info.executed)} was the ${info.characterId}`;
    case "ravenkeeper":
      return `${seatName(info.target)} is the ${info.characterId}`;
    case "spy":
      return "You see the Grimoire (tap to view)";
    default:
      return JSON.stringify(info);
  }
}
</script>

<template>
  <!-- Always present, regardless of which screen below is showing -->
  <ConnectionBanner />

  <!-- Reclaiming a seat after a refresh/reconnect — never flash the join form -->
  <div v-if="!joined && autoRejoining" class="center-page">
    <h1>Rejoining…</h1>
    <p>Reclaiming your seat</p>
  </div>

  <!-- Join screen -->
  <div v-else-if="!joined" class="center-page">
    <h1>Join the tale</h1>
    <div class="panel" style="display: flex; flex-direction: column; gap: 0.7rem; min-width: 17rem">
      <input v-model="codeInput" placeholder="Room code" maxlength="4" style="text-transform: uppercase" />
      <input v-model="nameInput" placeholder="Your name" maxlength="20" @keyup.enter="join" />
      <button class="primary" :disabled="!codeInput || !nameInput || joining" @click="join">
        {{ joining ? "Taking your seat…" : "Take a seat" }}
      </button>
      <p v-if="joinError" style="color: var(--blood)">{{ joinError }}</p>
    </div>
  </div>

  <!-- Lobby -->
  <div v-else-if="!pub" class="center-page">
    <h1>Seated</h1>
    <p>Waiting for the game to begin…</p>
    <div class="panel" style="min-width: 16rem">
      <h3 style="margin-bottom: 0.5rem">Your look</h3>
      <div v-if="myAvatar" class="myavatar">
        <img v-if="myAvatar.startsWith('data:')" :src="myAvatar" alt="you" />
        <span v-else style="font-size: 2.4rem">{{ myAvatar }}</span>
      </div>
      <AvatarPicker />
    </div>
    <div class="panel">
      <p v-for="s in state.lobby?.seats ?? []" :key="s.seat">
        <span v-if="s.avatar && !s.avatar.startsWith('data:')">{{ s.avatar }}</span>
        {{ s.name }} <Icon v-if="s.isBot" name="bot" :size="14" />
      </p>
    </div>
  </div>

  <!-- In game -->
  <div v-else class="game">
    <div class="bg-layer" :class="skyPhase" />
    <div class="nightshade" :class="skyPhase" />

    <header class="phead">
      <span class="pchip">
        <Icon :name="phaseInfo.icon" :size="17" />
        {{ phaseInfo.text }}
      </span>
      <TimerClock inline />
    </header>

    <!-- Role card -->
    <div v-if="me" class="rolecard panel" :class="{ revealed: cardRevealed }" @click="cardRevealed = !cardRevealed">
      <template v-if="cardRevealed">
        <RoleToken :id="me.characterId" :size="96" />
        <h2>{{ me.characterId }}</h2>
        <p class="align" :class="me.alignment">{{ me.alignment.toUpperCase() }}</p>
        <p v-if="myAbility" class="abilitytext">{{ myAbility }}</p>
        <p class="hint">tap to hide</p>
      </template>
      <template v-else>
        <Icon name="cards" :size="40" />
        <p class="hint">tap to reveal your role</p>
      </template>
    </div>

    <p v-if="!alive" class="deadnote">
      <Icon name="skull" :size="16" /> You are dead. Keep your secrets — you still have
      {{ pub.seats[me?.seat ?? 0]?.usedDeadVote ? "no votes left" : "one final vote" }}.
    </p>

    <!-- Latest info: only reachable at night — you remember it by day -->
    <div
      v-if="latestInfo && latestInfo.type !== 'youAre' && infoVisible"
      class="panel info"
      @click="whispersOpen = true"
    >
      <h3>The Storyteller whispers…</h3>
      <p>{{ describeInfo(latestInfo) }}</p>
      <p class="hint">tap to open your whispers</p>
    </div>
    <div
      v-else-if="latestInfo && latestInfo.type !== 'youAre'"
      class="panel info locked"
    >
      <Icon name="lock" :size="16" />
      <p class="hint">You'll have to remember what you learned last night.</p>
    </div>

    <!-- Night action -->
    <div v-if="prompt?.kind === 'nightAction'" class="panel action">
      <h3>Choose {{ prompt.choose.count === 1 ? "a player" : `${prompt.choose.count} players` }}</h3>
      <div class="seatgrid">
        <button
          v-for="s in choosable"
          :key="s.seat"
          :class="{ picked: picked.includes(s.seat) }"
          @click="togglePick(s.seat)"
        >
          {{ s.name }}
        </button>
      </div>
      <button class="primary" :disabled="picked.length !== prompt.choose.count" @click="submitNightChoice">
        Confirm
      </button>
    </div>

    <!-- Vote -->
    <div v-else-if="prompt?.kind === 'vote'" class="panel action">
      <h3>{{ seatName(prompt.nominator) }} nominated {{ seatName(prompt.nominee) }}</h3>
      <div style="display: flex; gap: 1rem; justify-content: center">
        <button class="primary" @click="vote(true)"><Icon name="hand" :size="18" /> Aye</button>
        <button @click="vote(false)">Keep still</button>
      </div>
    </div>

    <!-- Argument: the current speaker (nominator's case, then nominee's defense) -->
    <div v-else-if="prompt?.kind === 'argument'" class="panel action">
      <h3>{{ prompt.stage === "case" ? "Make your case" : "Defend yourself" }}</h3>
      <p class="hint">
        {{ prompt.stage === "case"
          ? `Why should ${seatName(prompt.nominee)} be executed?`
          : `${seatName(prompt.nominator)} has accused you — speak now`
        }}
      </p>
      <button class="primary" @click="skipArgument">
        <Icon name="check" :size="18" /> Done — cast the vote
      </button>
    </div>

    <!-- Nominations -->
    <div v-else-if="me?.canNominate" class="panel action">
      <h3>Nominations are open</h3>
      <div class="seatgrid">
        <button
          v-for="s in pub.seats.filter((x) => x.alive)"
          :key="s.seat"
          :class="{ picked: nominateTarget === s.seat }"
          @click="nominateTarget = s.seat"
        >
          {{ s.name }}
        </button>
      </div>
      <div style="display: flex; gap: 0.6rem; justify-content: center">
        <button class="primary" :disabled="nominateTarget === null" @click="nominate">Nominate</button>
        <button @click="sendAction({ type: 'passNomination' })">Pass</button>
      </div>
    </div>

    <!-- Slayer button -->
    <div v-if="me?.characterId === 'slayer' && !me.slayerSpent && alive && (pub.phase === 'day' || pub.phase === 'nominations')" class="panel action">
      <h3>Slayer</h3>
      <div class="seatgrid">
        <button
          v-for="s in pub.seats.filter((x) => x.alive && x.seat !== me?.seat)"
          :key="s.seat"
          @click="sendAction({ type: 'slayerShot', target: s.seat })"
        >
          <Icon name="arrow" :size="15" /> {{ s.name }}
        </button>
      </div>
    </div>

    <!-- Ready to move on -->
    <div v-if="showReadyButton" class="panel action">
      <button class="primary readybtn" :disabled="iAmReady" @click="sendReady()">
        <Icon name="check" :size="18" />
        {{
          iAmReady
            ? "Waiting for the others"
            : pub.phase === "nominations"
              ? "No more nominations"
              : "Ready for dusk"
        }}
      </button>
      <p v-if="state.readiness" class="hint">
        {{ state.readiness.ready.length }} of {{ state.readiness.required.length }} ready
      </p>
    </div>

    <!-- Idle -->
    <div v-if="!prompt && !me?.canNominate && !showReadyButton" class="panel idle">
      <p v-if="pub.phase === 'night'">
        <Icon name="moon" :size="16" /> Night {{ pub.night }} — close your eyes
      </p>
      <p v-else-if="pub.winner">
        <Icon name="flag" :size="16" />
        {{ pub.winner.team === "good" ? "GOOD WINS" : "EVIL WINS" }}
      </p>
      <p v-else-if="pub.phase === 'argument' && pub.argument">
        <Icon name="mic" :size="16" />
        {{ pub.argument.stage === "case"
          ? `${seatName(pub.argument.nominator)} makes their case against ${seatName(pub.argument.nominee)}`
          : `${seatName(pub.argument.nominee)} defends themselves`
        }}
      </p>
      <p v-else>
        <Icon name="sun" :size="16" /> Day {{ pub.day }} — talk amongst yourselves
      </p>
    </div>

    <footer v-if="state.lastError" class="errorbar" @click="state.lastError = ''">
      {{ state.lastError }}
    </footer>

    <!-- Reference bar: rules guide + the public town record -->
    <nav class="refbar">
      <button @click="guideOpen = true"><Icon name="book" :size="16" /> Guide</button>
      <button @click="recordOpen = true"><Icon name="list" :size="16" /> Record</button>
    </nav>

    <GuideSheet v-if="guideOpen" @close="guideOpen = false" />

    <!-- All whispers, newest first; the Spy's grimoire renders in full -->
    <div v-if="whispersOpen" class="recordsheet" @click.self="whispersOpen = false">
      <div class="record-inner panel">
        <div class="record-head">
          <h2>Your whispers</h2>
          <button @click="whispersOpen = false">Close</button>
        </div>
        <div v-for="(info, i) in [...(me?.inbox ?? [])].reverse()" :key="i" class="whisper">
          <p>{{ describeInfo(info) }}</p>
          <table v-if="info.type === 'spy'" class="grimtable">
            <tbody>
              <tr v-for="p in info.grimoire.players" :key="p.seat" :class="{ dead: !p.alive }">
                <td><RoleToken :id="p.characterId" :size="34" /></td>
                <td>
                  {{ p.name }}
                  <Icon v-if="!p.alive" name="skull" :size="13" />
                </td>
                <td class="charname">{{ p.characterId }}</td>
                <td>
                  <Icon
                    v-for="(s, j) in p.statuses"
                    :key="j"
                    :name="STATUS_ICONS[s.type] ?? 'clock'"
                    :size="14"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-if="(me?.inbox ?? []).length === 0" class="hint">No whispers yet.</p>
      </div>
    </div>

    <div v-if="recordOpen" class="recordsheet" @click.self="recordOpen = false">
      <div class="record-inner panel">
        <div class="record-head">
          <h2>Town record</h2>
          <button @click="recordOpen = false">Close</button>
        </div>
        <p v-if="state.log.length === 0" class="hint">Nothing has happened yet.</p>
        <ol>
          <li v-for="(entry, i) in state.log" :key="i">{{ entry }}</li>
        </ol>
      </div>
    </div>
  </div>
</template>

<style scoped>
.game {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
  padding: 1rem;
  max-width: 30rem;
  margin: 0 auto;
  position: relative;
}
.bg-layer {
  position: fixed;
  inset: 0;
  z-index: -2;
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
.nightshade {
  position: fixed;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  background: transparent;
  transition: background 2.5s ease;
}
.nightshade.night {
  background: rgba(8, 10, 40, 0.45);
}
.nightshade.dusk {
  background: rgba(45, 16, 8, 0.3);
}
.phead {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.6rem;
}
.pchip {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.35rem 0.9rem;
  border-radius: 999px;
  background: rgba(10, 6, 16, 0.8);
  border: 1px solid rgba(200, 164, 77, 0.4);
  font-family: "PiratesBay", fantasy;
  font-size: 1.05rem;
  color: var(--gold);
}
.readybtn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  margin: 0 auto;
}
.myavatar {
  display: flex;
  justify-content: center;
  margin-bottom: 0.6rem;
}
.myavatar img {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  object-fit: cover;
  border: 2px solid var(--gold);
}
.rolecard {
  text-align: center;
  cursor: pointer;
  user-select: none;
}
.roleicon {
  width: 96px;
  height: 96px;
  object-fit: contain;
}
.align.good {
  color: var(--good);
}
.align.evil {
  color: var(--evil);
}
.hint {
  opacity: 0.55;
  font-size: 0.8rem;
}
.deadnote {
  text-align: center;
  color: #999;
}
.info h3,
.action h3 {
  margin-bottom: 0.5rem;
  text-align: center;
}
.info.locked {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  opacity: 0.65;
  cursor: default;
}
.info.locked .hint {
  opacity: 1;
}
.seatgrid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(7.5rem, 1fr));
  gap: 0.5rem;
  margin-bottom: 0.7rem;
}
.seatgrid button.picked {
  outline: 3px solid var(--gold);
  background: #3a2c14;
}
.action {
  text-align: center;
}
.idle {
  text-align: center;
  opacity: 0.85;
}
.errorbar {
  background: var(--blood);
  color: #fff;
  text-align: center;
  padding: 0.4rem;
  border-radius: 8px;
}
.abilitytext {
  font-size: 0.9rem;
  max-width: 22rem;
  margin: 0.4rem auto 0.2rem;
  opacity: 0.92;
}
.refbar {
  position: sticky;
  bottom: 0.6rem;
  display: flex;
  gap: 0.6rem;
  justify-content: center;
  margin-top: auto;
  padding-top: 0.8rem;
}
.refbar button {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  background: rgba(10, 6, 16, 0.9);
}
.recordsheet {
  position: fixed;
  inset: 0;
  z-index: 60;
  background: rgba(10, 6, 16, 0.88);
  display: flex;
  justify-content: center;
  padding: 1rem;
}
.record-inner {
  width: min(94vw, 30rem);
  max-height: calc(100vh - 2rem);
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}
.record-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.6rem;
}
.record-inner ol {
  padding-left: 1.4rem;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  font-size: 0.9rem;
}
.whisper {
  padding: 0.5rem 0;
  border-bottom: 1px solid rgba(200, 164, 77, 0.15);
}
.grimtable {
  width: 100%;
  border-collapse: collapse;
  margin-top: 0.4rem;
}
.grimtable td {
  padding: 0.25rem 0.4rem;
  font-size: 0.88rem;
}
.grimtable tr.dead {
  opacity: 0.55;
}
.charname {
  color: var(--gold);
}
</style>
