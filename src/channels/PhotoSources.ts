/* ============================================================
   Photo sources for the Photo Channel screensaver.

   Every source here is FREE and needs NO API key, and every one
   sends CORS headers so it works straight from the browser:

     • Wikimedia Commons "Picture of the Day" — curated daily
       photo with title, author and license.
     • NASA APOD — Astronomy Picture of the Day, public domain,
       with a title and explanation. DEMO_KEY works unsigned;
       drop VITE_NASA_KEY in .env to lift the rate limit.
     • Art Institute of Chicago — public-domain artworks with
       artist and date, served over IIIF.

   Sources are a registry, the same way channels.ts is: add an
   entry to PHOTO_SOURCES and it shows up in the picker with no
   other wiring. Each source caches SEPARATELY in localStorage so
   toggling one on doesn't re-fetch the others (APOD's DEMO_KEY
   is only ~30 requests/hour per IP).
   ============================================================ */

export type SourceId = "wikimedia" | "nasa" | "artic";

export interface WebPhoto {
  id: string;
  src: string;
  title: string;
  /** Photographer / artist, already stripped of markup. */
  credit?: string;
  /** Short description, date or caption line. */
  detail?: string;
  /** Human-readable source name shown as a badge. */
  source: string;
  sourceId: SourceId;
  /** Page to credit back to. */
  link?: string;
}

export interface PhotoSourceDef {
  id: SourceId;
  label: string;
  blurb: string;
  /** Accent colour for the picker card. */
  tint: string;
  fetch: (signal?: AbortSignal) => Promise<WebPhoto[]>;
}

const NASA_KEY = (import.meta.env.VITE_NASA_KEY as string | undefined) || "DEMO_KEY";

const CACHE_PREFIX = "wii-photo-src-";
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours
const SELECTION_KEY = "wii-photo-sources";

/** Wikimedia Commons POTD pages to pull (one photo per day, going back from today). */
const POTD_DAYS = 16;

interface Cache {
  at: number;
  photos: WebPhoto[];
}

function readCache(id: SourceId): WebPhoto[] | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + id);
    if (!raw) return null;
    const c: Cache = JSON.parse(raw);
    if (Date.now() - c.at > CACHE_TTL) return null;
    return Array.isArray(c.photos) && c.photos.length ? c.photos : null;
  } catch {
    return null;
  }
}

function writeCache(id: SourceId, photos: WebPhoto[]) {
  try {
    localStorage.setItem(CACHE_PREFIX + id, JSON.stringify({ at: Date.now(), photos }));
  } catch {
    /* quota / private mode — just skip caching */
  }
}

/** First cached image for a source, so the picker card can show a live preview. */
export function peekCached(id: SourceId): WebPhoto | null {
  const cached = readCache(id);
  return cached?.[0] ?? null;
}

/**
 * Wikimedia's extmetadata fields arrive as HTML fragments. Parse them
 * inertly (DOMParser never loads subresources or runs script) and keep
 * only the text.
 */
function stripHtml(html: unknown): string | undefined {
  if (typeof html !== "string" || !html) return undefined;
  const text = new DOMParser().parseFromString(html, "text/html").body.textContent ?? "";
  const clean = text.replace(/\s+/g, " ").trim();
  return clean || undefined;
}

function truncate(s: string | undefined, max: number): string | undefined {
  if (!s) return undefined;
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

/** Fisher–Yates, so sources interleave instead of arriving in blocks. */
function shuffle<T>(items: T[]): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/* ---------------- Wikimedia Commons: Picture of the Day ---------------- */

async function fetchWikimedia(signal?: AbortSignal): Promise<WebPhoto[]> {
  // Template:Potd/YYYY-MM-DD holds that day's featured image. Ask for a
  // batch of days in one round-trip; missing days simply yield nothing.
  const titles: string[] = [];
  const day = new Date();
  for (let i = 0; i < POTD_DAYS; i++) {
    titles.push(`Template:Potd/${day.toISOString().slice(0, 10)}`);
    day.setDate(day.getDate() - 1);
  }

  const params = new URLSearchParams({
    action: "query",
    format: "json",
    origin: "*", // anonymous CORS
    generator: "images",
    gimlimit: "50",
    prop: "imageinfo",
    iiprop: "url|extmetadata",
    iiurlwidth: "1920",
    titles: titles.join("|"),
  });

  const res = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, { signal });
  if (!res.ok) throw new Error(`Wikimedia error ${res.status}`);
  const json = await res.json();

  const pages: Record<string, any> = json?.query?.pages ?? {};
  return Object.values(pages)
    .map((page): WebPhoto | null => {
      const info = page?.imageinfo?.[0];
      const src = info?.thumburl ?? info?.url;
      if (!src) return null;
      const meta = info.extmetadata ?? {};
      const name =
        stripHtml(meta.ObjectName?.value) ??
        String(page.title ?? "").replace(/^File:/, "").replace(/\.[^.]+$/, "");
      const license = stripHtml(meta.LicenseShortName?.value);
      const author = stripHtml(meta.Artist?.value);
      return {
        id: `wm-${page.pageid}`,
        src,
        title: truncate(name, 90) ?? "Picture of the Day",
        credit: truncate([author, license].filter(Boolean).join(" · "), 90),
        detail: truncate(stripHtml(meta.ImageDescription?.value), 180),
        source: "Wikimedia Commons",
        sourceId: "wikimedia",
        link: info.descriptionurl,
      };
    })
    .filter((p): p is WebPhoto => p !== null);
}

/* ---------------- NASA: Astronomy Picture of the Day ---------------- */

async function fetchNasa(signal?: AbortSignal): Promise<WebPhoto[]> {
  const url = `https://api.nasa.gov/planetary/apod?api_key=${NASA_KEY}&count=12&thumbs=true`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`NASA APOD error ${res.status}`);
  const json = await res.json();

  return (Array.isArray(json) ? json : [json])
    // APOD serves videos on some days — those have no usable still.
    .filter((a: any) => a?.media_type === "image" && (a.hdurl || a.url))
    .map((a: any, i: number) => ({
      id: `apod-${a.date ?? i}`,
      src: a.hdurl ?? a.url,
      title: truncate(a.title, 90) ?? "Astronomy Picture of the Day",
      credit: truncate(a.copyright?.replace(/\s+/g, " ").trim(), 90) ?? "NASA · Public domain",
      detail: truncate(a.explanation, 180),
      source: "NASA APOD",
      sourceId: "nasa" as const,
      link: a.date ? `https://apod.nasa.gov/apod/ap${a.date.slice(2).replace(/-/g, "")}.html` : undefined,
    }));
}

/* ---------------- Art Institute of Chicago ---------------- */

async function fetchArtic(signal?: AbortSignal): Promise<WebPhoto[]> {
  // ~130k public-domain works, so jump to a random page for variety.
  const page = 1 + Math.floor(Math.random() * 60);
  const params = new URLSearchParams({
    "query[term][is_public_domain]": "true",
    fields: "id,title,image_id,artist_title,date_display",
    limit: "20",
    page: String(page),
  });

  const res = await fetch(`https://api.artic.edu/api/v1/artworks/search?${params}`, { signal });
  if (!res.ok) throw new Error(`Art Institute error ${res.status}`);
  const json = await res.json();

  const iiif: string = json?.config?.iiif_url ?? "https://www.artic.edu/iiif/2";
  return (json?.data ?? [])
    .filter((a: any) => a?.image_id)
    .map((a: any) => ({
      id: `artic-${a.id}`,
      src: `${iiif}/${a.image_id}/full/1686,/0/default.jpg`,
      title: truncate(a.title, 90) ?? "Untitled",
      credit: truncate(a.artist_title, 90),
      detail: truncate(a.date_display, 180),
      source: "Art Institute of Chicago",
      sourceId: "artic" as const,
      link: `https://www.artic.edu/artworks/${a.id}`,
    }));
}

/* ---------------- Registry ---------------- */

export const PHOTO_SOURCES: PhotoSourceDef[] = [
  {
    id: "wikimedia",
    label: "Picture of the Day",
    blurb: "Wikimedia Commons' curated daily photo — landscapes, wildlife and architecture from around the world.",
    tint: "#3f8fd0",
    fetch: fetchWikimedia,
  },
  {
    id: "nasa",
    label: "Astronomy Picture of the Day",
    blurb: "NASA's daily view of the cosmos — nebulae, eclipses and deep space, with an explanation for each.",
    tint: "#5b57c4",
    fetch: fetchNasa,
  },
  {
    id: "artic",
    label: "Art Institute of Chicago",
    blurb: "Public-domain paintings, prints and photographs from a collection of over 130,000 works.",
    tint: "#c2703a",
    fetch: fetchArtic,
  },
];

export const ALL_SOURCE_IDS: SourceId[] = PHOTO_SOURCES.map((s) => s.id);

/* ---------------- Remembered selection ---------------- */

export function loadSelection(): SourceId[] {
  try {
    const raw = localStorage.getItem(SELECTION_KEY);
    if (!raw) return ALL_SOURCE_IDS;
    const ids = JSON.parse(raw);
    if (!Array.isArray(ids)) return ALL_SOURCE_IDS;
    // Drop anything that isn't a source we still ship.
    const valid = ids.filter((id): id is SourceId => ALL_SOURCE_IDS.includes(id));
    return valid.length ? valid : ALL_SOURCE_IDS;
  } catch {
    return ALL_SOURCE_IDS;
  }
}

export function saveSelection(ids: SourceId[]) {
  try {
    localStorage.setItem(SELECTION_KEY, JSON.stringify(ids));
  } catch {
    /* quota / private mode — selection just won't persist */
  }
}

/**
 * Collect screensaver photos from the chosen sources. Sources are queried in
 * parallel and failures are tolerated — one dead API shouldn't blank the
 * slideshow. Throws only if every chosen source fails.
 */
export async function getWebPhotos(
  ids: SourceId[],
  force = false,
  signal?: AbortSignal
): Promise<WebPhoto[]> {
  const chosen = PHOTO_SOURCES.filter((s) => ids.includes(s.id));
  if (!chosen.length) return [];

  const settled = await Promise.allSettled(
    chosen.map(async (source) => {
      if (!force) {
        const cached = readCache(source.id);
        if (cached) return cached;
      }
      const photos = (await source.fetch(signal)).filter((p) => p.src);
      if (photos.length) writeCache(source.id, photos);
      return photos;
    })
  );

  const photos = shuffle(settled.flatMap((r) => (r.status === "fulfilled" ? r.value : [])));

  if (!photos.length) {
    const failure = settled.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
    throw new Error(failure ? String(failure.reason?.message ?? failure.reason) : "No photos returned");
  }

  return photos;
}
