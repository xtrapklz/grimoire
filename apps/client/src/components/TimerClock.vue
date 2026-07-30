<script setup lang="ts">
// Circular phase countdown driven by the server's PhaseTimer.
import { computed, onMounted, onUnmounted, ref } from "vue";
import { state } from "@/socket";
import { audio } from "@/audio";

const props = defineProps<{ size?: number; inline?: boolean }>();
const now = ref(Date.now());
let raf = 0;
let warned = false;

function tick() {
  now.value = Date.now();
  raf = requestAnimationFrame(tick);
}
onMounted(() => tick());
onUnmounted(() => cancelAnimationFrame(raf));

const timer = computed(() => state.timer);
const remaining = computed(() => {
  if (!timer.value) return 0;
  return Math.max(0, (timer.value.endsAt - now.value) / 1000);
});
const fraction = computed(() => {
  if (!timer.value || timer.value.seconds <= 0) return 0;
  return Math.min(1, remaining.value / timer.value.seconds);
});
const label = computed(() => {
  const r = Math.ceil(remaining.value);
  const m = Math.floor(r / 60);
  const s = r % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `${s}`;
});

// One warning chime per timer as it crosses 10s.
setInterval(() => {
  const r = remaining.value;
  if (timer.value && r > 0 && r <= 10 && !warned) {
    warned = true;
    audio.sfx("timer-warning");
  }
  if (!timer.value || r > 10) warned = false;
}, 500);

const size = computed(() => props.size ?? 92);
const radius = computed(() => size.value / 2 - 6);
const circumference = computed(() => 2 * Math.PI * radius.value);
</script>

<template>
  <!-- Inline pill (phones): time and label side by side, normal layout flow. -->
  <div v-if="timer && inline" class="pill" :class="{ urgent: remaining <= 10 }">
    <span class="pill-time">{{ label }}</span>
    <span class="pill-label">{{ timer.label }}</span>
  </div>

  <!-- Ring clock (stage): caption sits below the ring in normal flow. -->
  <div v-else-if="timer" class="column">
    <div class="clock" :style="{ width: `${size}px`, height: `${size}px` }">
      <svg :width="size" :height="size">
        <circle class="track" :cx="size / 2" :cy="size / 2" :r="radius" />
        <circle
          class="progress"
          :class="{ urgent: remaining <= 10 }"
          :cx="size / 2"
          :cy="size / 2"
          :r="radius"
          :stroke-dasharray="circumference"
          :stroke-dashoffset="circumference * (1 - fraction)"
          :transform="`rotate(-90 ${size / 2} ${size / 2})`"
        />
      </svg>
      <div class="face">
        <div class="time" :class="{ urgent: remaining <= 10 }">{{ label }}</div>
      </div>
    </div>
    <div class="caption">{{ timer.label }}</div>
  </div>
</template>

<style scoped>
.clock {
  position: relative;
}
.track {
  fill: rgba(10, 6, 16, 0.75);
  stroke: rgba(200, 164, 77, 0.25);
  stroke-width: 5;
}
.progress {
  fill: none;
  stroke: var(--gold);
  stroke-width: 5;
  stroke-linecap: round;
  transition: stroke-dashoffset 0.25s linear;
}
.progress.urgent {
  stroke: var(--blood);
}
.face {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.time {
  font-family: "PiratesBay", fantasy;
  font-size: 1.5rem;
  color: var(--parchment);
  text-shadow: 0 1px 4px #000;
}
.time.urgent {
  color: #ff6b6b;
}
.column {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
}
.caption {
  white-space: nowrap;
  font-size: 0.72rem;
  opacity: 0.8;
  text-shadow: 0 1px 3px #000;
}
.pill {
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.35rem 0.9rem;
  border-radius: 999px;
  background: rgba(10, 6, 16, 0.8);
  border: 1px solid rgba(200, 164, 77, 0.4);
}
.pill.urgent {
  border-color: var(--blood);
}
.pill-time {
  font-family: "PiratesBay", fantasy;
  font-size: 1.15rem;
  color: var(--parchment);
  min-width: 2.4em;
  text-align: center;
}
.pill.urgent .pill-time {
  color: #ff6b6b;
}
.pill-label {
  font-size: 0.8rem;
  opacity: 0.85;
}
</style>
