/* ============================================================
   Shared news feed for the News Channel.

   Headlines are prebuilt, not fetched live. A GitHub Actions job
   (.github/workflows/deploy.yml) runs scripts/fetch-news.mjs every
   four hours with the GNews key in repo secrets, and commits the
   result to public/news/feed.json. This module just reads that
   file.

   That means:

     · No API key in the bundle. The key lives in Actions secrets
       and never reaches a browser.
     · Visitor count is free. A thousand people opening the channel
       cost the same 12 upstream requests as nobody opening it, so
       the old client-side rationing — daily budget, burst gate,
       refresh cooldown, localStorage cache — is all gone.
     · Headlines are as fresh as the last cron run, which is what
       the "Updated …" stamp in the masthead reports.

   The tab labels below are presentational. The fetch shape
   (sources, pages, country) lives in scripts/fetch-news.mjs; the
   two share only these `id` strings, so keep them in step.
   ============================================================ */

export interface Story {
  id: string;
  title: string;
  url: string;
  source: string;
  image?: string;
  publishedAt?: string;
  description?: string;
}

/** A tab in the channel. */
export interface NewsCategory {
  id: string;
  label: string;
}

export const CATEGORIES: NewsCategory[] = [
  { id: "national", label: "National" },
  { id: "international", label: "International" },
  { id: "sports", label: "Sports" },
  { id: "entertainment", label: "Arts & Entertainment" },
  { id: "business", label: "Business" },
  { id: "scihealth", label: "Science & Health" },
  { id: "technology", label: "Technology" },
];

export const DEFAULT_CATEGORY = CATEGORIES[0].id;

export interface NewsResult {
  stories: Story[];
  /** When the cron job fetched these stories (epoch ms, 0 = unknown). */
  fetchedAt: number;
}

interface FeedCategory {
  stories: Story[];
  fetchedAt: number;
}

interface Feed {
  fetchedAt: number;
  categories: Record<string, FeedCategory>;
}

const FEED_URL = `${import.meta.env.BASE_URL}news/feed.json`;

/* One request per page load, shared by every consumer: the menu tile's ticker
   and the open channel both ask for headlines, often at the same moment. */
let feedPromise: Promise<Feed> | null = null;

function loadFeed(): Promise<Feed> {
  if (!feedPromise) {
    // `no-cache` revalidates rather than skipping the cache — a 304 is cheap,
    // and it means a visitor with the tab already open picks up the next cron
    // run's headlines instead of holding a stale copy until a hard refresh.
    feedPromise = fetch(FEED_URL, { cache: "no-cache" })
      .then((res) => {
        if (!res.ok) throw new Error(`Couldn't load headlines (${res.status}).`);
        return res.json() as Promise<Feed>;
      })
      .catch((err) => {
        // Clear the memo so a later mount can retry instead of replaying the
        // same rejection for the rest of the session.
        feedPromise = null;
        throw err;
      });
  }
  return feedPromise;
}

/** Reject as soon as this caller's own signal aborts, leaving the shared fetch alone. */
function withSignal<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return p;
  const abortErr = () => new DOMException("Aborted", "AbortError");
  if (signal.aborted) return Promise.reject(abortErr());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortErr());
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

/**
 * Headlines for a category, from the prebuilt feed.
 *
 * Switching tabs costs nothing after the first call — the whole feed arrives
 * in one response and is held for the life of the page.
 */
export async function getNews(
  categoryId: string = DEFAULT_CATEGORY,
  signal?: AbortSignal
): Promise<NewsResult> {
  const feed = await withSignal(loadFeed(), signal);
  const entry = feed.categories?.[categoryId];
  if (!entry?.stories?.length) {
    throw new Error("No headlines in this section yet — the next refresh should fill it in.");
  }
  return { stories: entry.stories, fetchedAt: entry.fetchedAt || feed.fetchedAt || 0 };
}
