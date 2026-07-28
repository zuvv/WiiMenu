/* ============================================================
   Turns a headline into a point on the globe.

   GNews returns no coordinates — the only location signal a story
   carries is the words in its title and description. So this is a
   gazetteer scan: find every place name in the text, score the
   candidates, keep the best one. Stories with no confident match
   get no `place` and simply don't appear on the globe.

   Two rules keep the false-positive rate down, which matters more
   than coverage here — a pin on the wrong continent is worse than
   a missing pin:

     · Matching is case-sensitive. "Mobile" is a city, "mobile" is
       a phone; "Turkey" is a country, "turkey" is dinner.
     · Names that read as a person more often than a place are
       excluded at build time (see CITY_UNSAFE / COUNTRY_NAME_UNSAFE
       in build-geo.mjs) and only reachable through an alias.

   Consumed by fetch-news.mjs (the cron) and annotate-feed.mjs
   (re-tagging without spending API quota).
   ============================================================ */

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

const { places } = JSON.parse(await readFile(resolve(HERE, "gazetteer.json"), "utf8"));

/* ---------- index ----------

   One regex over every name and alias. Terms are sorted longest
   first so the alternation prefers "New York State" over "New York",
   and "North Korea" over "Korea".

   The usual \b won't do: half these terms end in a period ("U.S.",
   "Wis.") or contain one, and \b after a period matches inside the
   next word. Letter lookaround is what actually means "not part of a
   longer word" here. */

const term = new Map(); // matched string -> { place, alias }

for (const p of places) {
  if (!p.nameUnsafe) term.set(p.name, { place: p, alias: false });
  for (const a of p.aliases ?? []) if (!term.has(a)) term.set(a, { place: p, alias: true });
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const terms = [...term.keys()].sort((a, b) => b.length - a.length);
const RE = new RegExp(`(?<![A-Za-z])(?:${terms.map(escape).join("|")})(?![A-Za-z])`, "g");

/* ---------- scoring ----------

   A city beats the region it sits in, which beats the country. A hit
   in the title beats a hit in the description, because a headline
   names the place the story is *about* while the blurb often just
   names where somebody is from. */

const KIND_SCORE = { city: 30, region: 24, country: 14 };
const TITLE_BONUS = 40;

function scan(text, isTitle, out) {
  if (!text) return;
  RE.lastIndex = 0;
  let m;
  while ((m = RE.exec(text)) !== null) {
    const hit = term.get(m[0]);
    if (!hit) continue;
    const p = hit.place;

    let score = KIND_SCORE[p.kind] ?? 10;
    if (isTitle) score += TITLE_BONUS;
    if (p.capital) score += 4;
    // A big city is the likelier reading of an ambiguous name, and the
    // likelier subject when a story names two.
    if (p.pop) score += Math.min(10, (p.pop / 1_000_000) * 2);
    // The place's own name is stronger evidence than a demonym:
    // "Ukraine" is about Ukraine, "Ukrainian" might be about a person.
    if (!hit.alias) score += 3;
    // Longer names are more specific and less likely to be a coincidence.
    score += Math.min(6, m[0].length / 4);
    // All else equal, prefer whatever the sentence leads with.
    score -= Math.min(5, m.index / 40);

    const prev = out.get(p.id);
    if (!prev || score > prev.score) out.set(p.id, { place: p, score, matched: m[0] });
    // A place named twice is more likely the real subject.
    else prev.score += 2;
  }
}

/**
 * Best place for one story, or null.
 *
 * The returned object is what gets embedded in feed.json and read by
 * the globe, so it carries coordinates rather than a lookup key — the
 * client never sees the gazetteer.
 */
export function locate(story) {
  const found = new Map();
  scan(story.title, true, found);
  scan(story.description, false, found);
  if (!found.size) return null;

  let best = null;
  for (const c of found.values()) if (!best || c.score > best.score) best = c;

  const p = best.place;
  return {
    id: p.id,
    name: p.name,
    kind: p.kind,
    // A city's country is worth carrying for the panel's "Lyon, France".
    country: p.kind === "country" ? "" : p.country || "",
    lat: p.lat,
    lon: p.lon,
  };
}

/** Tag a list of stories in place. Returns how many landed on the map. */
export function locateAll(stories) {
  let hits = 0;
  for (const s of stories) {
    const place = locate(s);
    if (place) {
      s.place = place;
      hits++;
    } else {
      delete s.place;
    }
  }
  return hits;
}
