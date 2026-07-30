// Regenerates engine data files from the vendor/townsquare clone.
// Run: npm run extract-data
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const vendor = join(root, "vendor/townsquare/src");
const outDir = join(root, "packages/engine/src/data");
mkdirSync(outDir, { recursive: true });

const roles = JSON.parse(readFileSync(join(vendor, "roles.json"), "utf8"));
const game = JSON.parse(readFileSync(join(vendor, "game.json"), "utf8"));

const TRAVELLERS = new Set(["scapegoat", "gunslinger", "beggar", "bureaucrat", "thief"]);
const tb = roles.filter((r) => r.edition === "tb");
const characters = tb.map((r) => ({
  id: r.id,
  name: r.name,
  team: TRAVELLERS.has(r.id) ? "traveller" : r.team,
  ability: r.ability,
  firstNight: r.firstNight,
  otherNight: r.otherNight,
  firstNightReminder: r.firstNightReminder,
  otherNightReminder: r.otherNightReminder,
  reminders: r.reminders,
  setup: r.setup,
  icon: `icons/${r.id}.png`,
}));

// game.json: per-player-count team composition, e.g. {townsfolk, outsider, minion, demon}
writeFileSync(join(outDir, "characters.tb.json"), JSON.stringify(characters, null, 2));
writeFileSync(join(outDir, "player-counts.json"), JSON.stringify(game, null, 2));
console.log(`Wrote ${characters.length} TB characters and player-count table to ${outDir}`);
