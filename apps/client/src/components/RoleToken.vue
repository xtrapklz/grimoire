<script setup lang="ts">
// A character icon layered on the classic circular token background —
// the one true way role art appears anywhere in the UI.
defineProps<{ id: string; size?: number }>();
</script>

<template>
  <span class="token" :style="{ width: `${size ?? 44}px`, height: `${size ?? 44}px` }">
    <img :src="`/icons/${id}.png`" :alt="id" />
  </span>
</template>

<style scoped>
.token {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border-radius: 50%;
  background: url("/token.png") center / cover;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.6);
}
.token img {
  width: 82%;
  height: 82%;
  object-fit: contain;
}
</style>
