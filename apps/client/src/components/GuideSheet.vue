<script setup lang="ts">
// The rules companion: every character in the edition in play, grouped by
// team, with official ability text. Opened from the phone's bottom bar.
import { TB_CHARACTERS } from "@grimoire/engine";
import RoleToken from "@/components/RoleToken.vue";

defineEmits<{ close: [] }>();

const TEAMS: Array<[string, string]> = [
  ["townsfolk", "Townsfolk"],
  ["outsider", "Outsiders"],
  ["minion", "Minions"],
  ["demon", "Demons"],
];

function byTeam(team: string) {
  return TB_CHARACTERS.filter((c) => c.team === team);
}
</script>

<template>
  <div class="sheet" @click.self="$emit('close')">
    <div class="sheet-inner panel">
      <div class="sheet-head">
        <h2>Trouble Brewing</h2>
        <button @click="$emit('close')">Close</button>
      </div>
      <p class="intro">
        Each night, characters wake in order and use their abilities. Each day,
        the town discusses, then at dusk nominates and votes. The highest vote
        tally of at least half the living players is executed. Good wins if the
        Demon dies; evil wins when only two players remain.
      </p>
      <p class="intro">
        Reading the town square: a shroud over a token means that player is
        dead; the small grey token under a dead player is their unspent ghost
        vote (each dead player may vote one last time); the scales with a
        number mark whoever is on the block and their tally — a later nominee
        must beat it. During a vote, a red ring marks the accused and a gold
        ring their accuser.
      </p>
      <template v-for="[team, label] in TEAMS" :key="team">
        <h3 :class="`team-${team}`">{{ label }}</h3>
        <div v-for="c in byTeam(team)" :key="c.id" class="entry">
          <RoleToken :id="c.id" :size="44" />
          <div>
            <strong>{{ c.name }}</strong>
            <p>{{ c.ability }}</p>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.sheet {
  position: fixed;
  inset: 0;
  z-index: 60;
  background: rgba(10, 6, 16, 0.88);
  display: flex;
  justify-content: center;
  padding: 1rem;
  overflow: hidden;
}
.sheet-inner {
  width: min(94vw, 34rem);
  max-height: calc(100vh - 2rem);
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}
.sheet-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.6rem;
}
.intro {
  font-size: 0.85rem;
  opacity: 0.85;
  margin-bottom: 0.9rem;
}
h3 {
  margin: 0.9rem 0 0.4rem;
}
.team-townsfolk,
.team-outsider {
  color: var(--good);
}
.team-minion,
.team-demon {
  color: var(--evil);
}
.entry {
  display: flex;
  gap: 0.7rem;
  align-items: flex-start;
  padding: 0.4rem 0;
  border-bottom: 1px solid rgba(200, 164, 77, 0.15);
}
.entry p {
  font-size: 0.85rem;
  opacity: 0.9;
}
</style>
