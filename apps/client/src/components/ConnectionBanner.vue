<script setup lang="ts">
// A persistent, unmissable indicator whenever the socket is down — not just
// on the pre-join screen. Without this, a mid-game Wi-Fi blip or phone sleep
// left every screen looking normal but frozen, with zero clue why nothing
// responded. Reconnection itself is automatic (socket.io retries, then the
// view's onReconnect handler resyncs full state) — this is purely the "why
// isn't this working right now" cue while that's in flight.
import { state } from "@/socket";
import Icon from "@/components/Icon.vue";
</script>

<template>
  <div v-if="!state.connected" class="connbanner" role="status">
    <Icon name="offline" :size="15" />
    <span>Reconnecting…</span>
  </div>
</template>

<style scoped>
.connbanner {
  position: fixed;
  top: 0.6rem;
  left: 50%;
  transform: translateX(-50%);
  z-index: 90;
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.35rem 0.8rem;
  border-radius: 999px;
  background: var(--blood);
  color: #fff;
  font-size: 0.8rem;
  box-shadow: 0 3px 12px rgba(0, 0, 0, 0.5);
  animation: connbanner-pulse 1.6s ease-in-out infinite;
}
@keyframes connbanner-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.6;
  }
}
</style>
