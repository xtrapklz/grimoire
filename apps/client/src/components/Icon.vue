<script setup lang="ts">
// Flat inline icons (stroke style, currentColor). The UI uses these instead
// of emoji — emoji are reserved for player avatars only.
import { computed } from "vue";

const props = defineProps<{ name: string; size?: number }>();

const PATHS: Record<string, string> = {
  sun: `<circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/><line x1="4.9" y1="4.9" x2="7" y2="7"/><line x1="17" y1="17" x2="19.1" y2="19.1"/><line x1="4.9" y1="19.1" x2="7" y2="17"/><line x1="17" y1="7" x2="19.1" y2="4.9"/>`,
  moon: `<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>`,
  sunrise: `<path d="M17 18a5 5 0 0 0-10 0"/><line x1="12" y1="6" x2="12" y2="10"/><polyline points="9.5 8.5 12 6 14.5 8.5"/><line x1="3" y1="18" x2="5" y2="18"/><line x1="19" y1="18" x2="21" y2="18"/><line x1="2" y1="22" x2="22" y2="22"/>`,
  sunset: `<path d="M17 18a5 5 0 0 0-10 0"/><line x1="12" y1="10" x2="12" y2="6"/><polyline points="9.5 7.5 12 10 14.5 7.5"/><line x1="3" y1="18" x2="5" y2="18"/><line x1="19" y1="18" x2="21" y2="18"/><line x1="2" y1="22" x2="22" y2="22"/>`,
  skull: `<path d="M12 2a8 8 0 0 0-8 8c0 2.9 1.6 5.4 4 6.8V20a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-3.2c2.4-1.4 4-3.9 4-6.8a8 8 0 0 0-8-8z"/><circle cx="9" cy="11" r="1.4" fill="currentColor" stroke="none"/><circle cx="15" cy="11" r="1.4" fill="currentColor" stroke="none"/><line x1="10.5" y1="17" x2="10.5" y2="19"/><line x1="13.5" y1="17" x2="13.5" y2="19"/>`,
  hand: `<path d="M7 11V6.5a1.5 1.5 0 0 1 3 0V10"/><path d="M10 10V4.5a1.5 1.5 0 0 1 3 0V10"/><path d="M13 10V5.5a1.5 1.5 0 0 1 3 0V11"/><path d="M16 11v-1a1.5 1.5 0 0 1 3 0v4a7 7 0 0 1-7 7h-1a7 7 0 0 1-6.3-3.9L3 13.6a1.6 1.6 0 0 1 2.7-1.6L7 13.5"/>`,
  scales: `<line x1="12" y1="3" x2="12" y2="21"/><line x1="4" y1="6" x2="20" y2="6"/><path d="M6 6l-2.5 6a3 3 0 0 0 5 0z"/><path d="M18 6l-2.5 6a3 3 0 0 0 5 0z"/><line x1="9" y1="21" x2="15" y2="21"/>`,
  arrow: `<line x1="3" y1="21" x2="17" y2="7"/><polyline points="11 7 17 7 17 13"/><line x1="19" y1="5" x2="21" y2="3"/>`,
  check: `<polyline points="4 12.5 10 18.5 20 6.5"/>`,
  camera: `<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/>`,
  speaker: `<polygon points="11 5 6 9 3 9 3 15 6 15 11 19 11 5" fill="currentColor" stroke="none"/><path d="M15 9a4 4 0 0 1 0 6"/><path d="M17.5 6.5a8 8 0 0 1 0 11"/>`,
  "speaker-off": `<polygon points="11 5 6 9 3 9 3 15 6 15 11 19 11 5" fill="currentColor" stroke="none"/><line x1="15" y1="9.5" x2="21" y2="14.5"/><line x1="21" y1="9.5" x2="15" y2="14.5"/>`,
  bot: `<rect x="5" y="8" width="14" height="11" rx="2"/><line x1="12" y1="8" x2="12" y2="4"/><circle cx="12" cy="3" r="1"/><circle cx="9" cy="13" r="1.2" fill="currentColor" stroke="none"/><circle cx="15" cy="13" r="1.2" fill="currentColor" stroke="none"/><line x1="9" y1="16.5" x2="15" y2="16.5"/>`,
  flask: `<path d="M10 3v6l-5.2 8.6A2 2 0 0 0 6.5 21h11a2 2 0 0 0 1.7-3.4L14 9V3"/><line x1="8.5" y1="3" x2="15.5" y2="3"/><line x1="7.5" y1="15" x2="16.5" y2="15"/>`,
  shield: `<path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6z"/>`,
  fish: `<path d="M3 12c3-4.5 8-6 12-4 2-1.5 4-2 6-1.5-.5 2-1.5 3.5-3 4.5 0 1 0 2-.3 3-2 .5-4 0-5.7-1.5-3 2.5-6.5 2.5-9-.5z"/><circle cx="7" cy="11.5" r="1" fill="currentColor" stroke="none"/>`,
  hat: `<line x1="3" y1="19" x2="21" y2="19"/><path d="M7 19V7a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v12"/><line x1="6" y1="13" x2="18" y2="13"/>`,
  ff: `<polygon points="4 5 12 12 4 19 4 5" fill="currentColor" stroke="none"/><polygon points="13 5 21 12 13 19 13 5" fill="currentColor" stroke="none"/>`,
  play: `<polygon points="7 4 20 12 7 20 7 4" fill="currentColor" stroke="none"/>`,
  cards: `<rect x="4" y="5" width="10" height="14" rx="1.5"/><path d="M16 6.5l3.5 1-3.2 12-3.4-.9"/><path d="M9 10c1.2-1.5 3 .3 0 2.6-3-2.3-1.2-4.1 0-2.6z" fill="currentColor" stroke="none"/>`,
  flag: `<line x1="5" y1="3" x2="5" y2="21"/><path d="M5 4h13l-2.5 4L18 12H5"/>`,
  clock: `<circle cx="12" cy="12" r="9"/><polyline points="12 6.5 12 12 15.5 14"/>`,
  mic: `<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0"/><line x1="12" y1="18" x2="12" y2="21"/>`,
  "mic-off": `<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0"/><line x1="12" y1="18" x2="12" y2="21"/><line x1="4" y1="4" x2="20" y2="20"/>`,
  refresh: `<path d="M20 11a8 8 0 1 0-2.3 6.3"/><polyline points="20 5 20 11 14 11"/>`,
  gear: `<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.56-1.11 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.08a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.08a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1.03z"/>`,
  book: `<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>`,
  list: `<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="4" cy="6" r="1" fill="currentColor" stroke="none"/><circle cx="4" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="4" cy="18" r="1" fill="currentColor" stroke="none"/>`,
  external: `<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>`,
  lock: `<rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>`,
  retake: `<path d="M3 4v6h6"/><path d="M4.5 15a8 8 0 1 0 1.7-8.7L3 10"/>`,
  offline: `<line x1="2" y1="2" x2="22" y2="22"/><path d="M8.5 16.5a5 5 0 0 1 7 0"/><path d="M5 13a9.5 9.5 0 0 1 3.5-2.3"/><path d="M15.5 10.7A9.5 9.5 0 0 1 19 13"/><path d="M2 8.5a13.5 13.5 0 0 1 4.5-2.9"/><path d="M17.5 5.6A13.5 13.5 0 0 1 22 8.5"/><circle cx="12" cy="19.5" r="1" fill="currentColor" stroke="none"/>`,
  stop: `<rect x="5" y="5" width="14" height="14" rx="2"/>`,
  upload: `<path d="M12 16V4"/><polyline points="6.5 9.5 12 4 17.5 9.5"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>`,
  trash: `<polyline points="4 6.5 20 6.5"/><path d="M9 6.5V4.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M6.5 6.5 7.3 19a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-12.5"/><line x1="10" y1="10.5" x2="10" y2="16.5"/><line x1="14" y1="10.5" x2="14" y2="16.5"/>`,
};

const inner = computed(() => PATHS[props.name] ?? "");
const px = computed(() => props.size ?? 18);
</script>

<template>
  <svg
    class="icon"
    :width="px"
    :height="px"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    v-html="inner"
  />
</template>

<style scoped>
.icon {
  display: inline-block;
  vertical-align: -0.18em;
  flex-shrink: 0;
}
</style>
