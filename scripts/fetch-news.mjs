#!/usr/bin/env node
/* ============================================================
   Builds public/news/feed.json — the News Channel's entire data
   source.

   This is the ONLY place the GNews key is ever used. It runs in
   GitHub Actions on a schedule (see .github/workflows/news.yml)
   with the key in repo secrets, so it is never compiled into the
   client bundle and visitors never spend from the allowance. A
   thousand people can open the channel for the same 12 requests
   one person used to cost.

   Run locally to populate the file for `npm run dev`:

     GNEWS_KEY=xxxxx npm run fetch:news

   Fetch shape (sources / pages / country) lives here because it
   is a backend concern. The tab labels in src/channels/NewsFeed.ts
   are presentational and share only the category `id` strings —
   keep the two id lists in step.
   ============================================================ */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "public/news/feed.json");

/* Local convenience only. In Actions the key arrives as a real env var and
   there is no .env file, so a miss here is expected, not an error. */
try {
  process.loadEnvFile(resolve(ROOT, ".env"));
} catch {
  /* no .env — fall through to the ambient environment */
}

// Trim whitespace and stray quotes — `KEY="abc"` and a trailing space are the
// two ways a pasted key silently turns into a 401.
const KEY = process.env.GNEWS_KEY?.trim().replace(/^["']|["']$/g, "");
if (!KEY) {
  console.error(
    "GNEWS_KEY is not set.\n" +
      "  In Actions: add it under Settings → Secrets and variables → Actions.\n" +
      "  Locally:    GNEWS_KEY=xxxxx npm run fetch:news"
  );
  process.exit(1);
}

const HOME_COUNTRY = "us";

/** Requests per run = sum of sources.length × pages. Currently 12. */
const CATEGORIES = [
  { id: "national", sources: ["nation"], pages: 2, country: HOME_COUNTRY },
  { id: "international", sources: ["world"], pages: 2 },
  { id: "sports", sources: ["sports"] },
  { id: "entertainment", sources: ["entertainment"], pages: 2 },
  { id: "business", sources: ["business"] },
  { id: "scihealth", sources: ["science", "health"], limit: 10 },
  { id: "technology", sources: ["technology"], pages: 2 },
];

/* GNews enforces a short-window burst limit separate from the daily cap, so
   requests are spaced out. The old client-side feed found ~25s apart was
   always safe and back-to-back was not; in Actions we are not waiting on a
   user, so we can afford to be generous. */
const BURST_GAP = 2500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function gnewsError(res) {
  try {
    const j = await res.json();
    const msg = Array.isArray(j?.errors) ? j.errors.join(" ") : j?.errors;
    if (msg) return `GNews: ${msg}`;
  } catch {
    /* non-JSON body — fall through to the status code */
  }
  if (res.status === 401 || res.status === 403) return "GNews rejected the API key.";
  if (res.status === 429) return "GNews daily request limit reached.";
  return `GNews error ${res.status}`;
}

async function fetchPage(source, country, page) {
  // The free tier caps results at 10 however high `max` goes.
  const url =
    `https://gnews.io/api/v4/top-headlines?category=${source}&lang=en&max=10` +
    (page > 1 ? `&page=${page}` : "") +
    (country ? `&country=${country}` : "") +
    `&apikey=${KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(await gnewsError(res));
  const j = await res.json();
  return (j.articles ?? []).map((a, i) => ({
    id: a.url ?? String(i),
    title: a.title,
    url: a.url,
    source: a.source?.name ?? "",
    image: a.image,
    publishedAt: a.publishedAt,
    description: a.description,
  }));
}

async function fetchCategory(cat) {
  const pages = cat.pages ?? 1;

  // Keep each source's stories in their own list: pages concatenate in order
  // within a source, but sources interleave below.
  const bySource = [];
  for (const source of cat.sources) {
    const acc = [];
    for (let page = 1; page <= pages; page++) {
      if (bySource.length || acc.length) await sleep(BURST_GAP);
      acc.push(...(await fetchPage(source, cat.country, page)));
    }
    bySource.push(acc);
  }

  // Round-robin across sources so trimming a merged tab keeps both halves
  // represented rather than returning ten of the first category.
  const merged = [];
  for (let i = 0; bySource.some((list) => i < list.length); i++) {
    for (const list of bySource) if (i < list.length) merged.push(list[i]);
  }

  // Merged categories and repeated pages can both surface the same story.
  const seen = new Set();
  let clean = merged.filter((s) => s.title && s.url && !seen.has(s.url) && seen.add(s.url));
  if (cat.limit) clean = clean.slice(0, cat.limit);
  if (!clean.length) throw new Error("No stories returned.");
  return clean;
}

/* Previous run's output. A category that fails today keeps yesterday's
   headlines rather than going blank — one transient 429 should not empty a
   tab for the next four hours. */
async function readPrevious() {
  try {
    return JSON.parse(await readFile(OUT, "utf8"));
  } catch {
    return null;
  }
}

const previous = await readPrevious();
const categories = {};
let fresh = 0;
const failures = [];

for (const cat of CATEGORIES) {
  try {
    const stories = await fetchCategory(cat);
    categories[cat.id] = { stories, fetchedAt: Date.now() };
    fresh++;
    console.log(`✓ ${cat.id}: ${stories.length} stories`);
  } catch (err) {
    const kept = previous?.categories?.[cat.id];
    failures.push(`${cat.id}: ${err.message}`);
    if (kept) {
      categories[cat.id] = kept;
      console.warn(`✗ ${cat.id}: ${err.message} — keeping ${kept.stories.length} cached`);
    } else {
      console.warn(`✗ ${cat.id}: ${err.message} — no cached fallback`);
    }
  }
  await sleep(BURST_GAP);
}

if (!fresh) {
  // Everything failed — usually a bad key or an exhausted quota. Fail loudly
  // so the workflow run goes red instead of silently recommitting stale data.
  console.error(`All ${CATEGORIES.length} categories failed:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}

const feed = {
  fetchedAt: Date.now(),
  categories,
};

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(feed, null, 2) + "\n");

const total = Object.values(categories).reduce((n, c) => n + c.stories.length, 0);
console.log(
  `\nWrote ${OUT}\n${total} stories across ${Object.keys(categories).length} categories` +
    ` (${fresh} refreshed, ${failures.length} kept from cache)`
);
