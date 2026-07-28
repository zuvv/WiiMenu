#!/usr/bin/env node
/* ============================================================
   Re-runs the geocoder over the feed.json already on disk and
   writes it back:

     npm run geocode:feed

   The cron already geocodes every story it fetches, so this is
   for the other case — changing the gazetteer or the scoring and
   wanting to see the effect on today's headlines. It touches no
   network and spends none of the GNews allowance.

   Pass --dry to print what would change without writing, and
   --list to see every story's verdict.
   ============================================================ */

import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { locate } from "./geocode.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FEED = resolve(ROOT, "public/news/feed.json");

const dry = process.argv.includes("--dry");
const list = process.argv.includes("--list");

const feed = JSON.parse(await readFile(FEED, "utf8"));

let total = 0;
let located = 0;
const tally = new Map();

for (const [id, cat] of Object.entries(feed.categories ?? {})) {
  let hits = 0;
  for (const story of cat.stories ?? []) {
    total++;
    const place = locate(story);
    if (place) {
      story.place = place;
      hits++;
      located++;
      tally.set(place.name, (tally.get(place.name) ?? 0) + 1);
    } else {
      delete story.place;
    }
    if (list) console.log(`  ${place ? place.name.padEnd(22) : "—".padEnd(22)} ${story.title}`);
  }
  console.log(`${id.padEnd(15)} ${hits}/${cat.stories?.length ?? 0} located`);
}

const top = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
console.log(
  `\n${located}/${total} stories placed (${Math.round((located / total) * 100)}%), ` +
    `${tally.size} distinct locations\n` +
    `busiest: ${top.map(([n, c]) => `${n}×${c}`).join(", ")}`
);

if (dry) {
  console.log("\n--dry: feed.json not written");
} else {
  await writeFile(FEED, JSON.stringify(feed, null, 2) + "\n");
  console.log(`\nWrote ${FEED}`);
}
