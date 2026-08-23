// data/pickup.json must stay honest: every entry has an id, a sport the
// app knows, a venue, a schedule, a door the app knows, a real https link
// that states the schedule, and a last_checked date. Run: node scripts/check-pickup.mjs
import { readFileSync } from 'node:fs';
import { PICKUP_SPORTS, DOORS } from '../js/core.js';

const data = JSON.parse(readFileSync(new URL('../data/pickup.json', import.meta.url), 'utf8'));
const sports = new Set(PICKUP_SPORTS.map((s) => s.id));
const doors = new Set(DOORS.map((d) => d.id));
const ids = new Set();
const problems = [];
for (const e of data.entries) {
  const where = e.id || e.name || '(unnamed)';
  if (!e.id || ids.has(e.id)) problems.push(`${where}: missing or duplicate id`);
  ids.add(e.id);
  if (!sports.has(e.sport)) problems.push(`${where}: unknown sport ${e.sport}`);
  if (!doors.has(e.door)) problems.push(`${where}: unknown door ${e.door}`);
  for (const f of ['name', 'venue', 'schedule']) if (!e[f] || e[f].length < 2) problems.push(`${where}: missing ${f}`);
  if (!/^https:\/\/\S+$/.test(e.link || '')) problems.push(`${where}: needs an https source link`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.last_checked || '')) problems.push(`${where}: last_checked must be YYYY-MM-DD`);
  if (e.source !== 'curated') problems.push(`${where}: source must be "curated" in this file`);
}
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
console.log(`pickup.json ok — ${data.entries.length} entries`);
