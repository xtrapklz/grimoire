<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";

const router = useRouter();
const joinCode = ref("");
</script>

<template>
  <div class="center-page">
    <h1 style="font-size: 2.6rem">Grimoire</h1>
    <p style="max-width: 26rem">
      A fully automated Blood on the Clocktower. One screen for the table, every
      player on their phone, and the storyteller is the machine.
    </p>
    <div class="panel" style="display: flex; flex-direction: column; gap: 0.8rem; min-width: 18rem">
      <button class="primary" @click="router.push('/stage')">Host on this screen</button>
      <div style="display: flex; gap: 0.5rem">
        <input
          v-model="joinCode"
          placeholder="Room code"
          maxlength="4"
          style="flex: 1; text-transform: uppercase"
          @keyup.enter="router.push(`/play/${joinCode.toUpperCase()}`)"
        />
        <button @click="router.push(`/play/${joinCode.toUpperCase()}`)">Join</button>
      </div>
    </div>
    <p style="opacity: 0.5; font-size: 0.8rem; max-width: 30rem">
      Unofficial fan project. Blood on the Clocktower is a trademark of Steven
      Medway and The Pandemonium Institute.
    </p>
  </div>
</template>
