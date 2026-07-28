import { useCallback, useEffect, useRef, useState } from "react";
import type { ChannelAppProps, ChannelIconProps } from "../wii/types";
import { Sound } from "../wii/sound";
import { NewsMusic } from "./NewsMusic";
import { NewsSlideshow } from "./NewsSlideshow";
import { NewsGlobe } from "./NewsGlobe";
import {
  CATEGORIES,
  DEFAULT_CATEGORY,
  domainOf,
  getAllNews,
  getNews,
  relativeTime,
  type Story,
} from "./NewsFeed";
import "./NewsChannel.css";

/* ============================================================
   News Channel — real world headlines, prebuilt by a scheduled
   GitHub Actions job rather than fetched live. See NewsFeed.ts;
   the whole feed arrives in one request and is shared with the
   menu tile's ticker.

   There is no Refresh button by design: the headlines are only
   as new as the last cron run, so a refresh would re-read the
   same file. The masthead's "Updated …" stamp says when that was.

   Two views share the masthead:
     · Globe     every located story, pinned where it happened
     · Headlines the card grid, one section at a time

   Signature accent: GREEN.
   ============================================================ */

type LoadState = "loading" | "ready" | "error";
type View = "globe" | "grid";

/* ---------- helpers ---------- */

/** Clock time of the last successful fetch — "Updated 3:52 PM". */
function updatedLabel(at: number): string {
  if (!at) return "";
  const d = new Date(at);
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  // Past midnight the bare clock time is ambiguous, so name the day too.
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? `Updated ${time}`
    : `Updated ${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${time}`;
}

/* ---------- Icon ---------- */

export function NewsIcon({ active }: ChannelIconProps) {
  // Live tile: the real "News Channel" banner up top, with a ticker of
  // current headlines scrolling underneath. Headlines come from the shared
  // cache, so showing this on the menu costs no extra API requests.
  const [headlines, setHeadlines] = useState<string[]>([]);

  useEffect(() => {
    let live = true;
    getNews()
      .then((r) => live && setHeadlines(r.stories.map((x) => x.title).slice(0, 12)))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const items = headlines.length ? headlines : ["Today's top stories"];
  // Duplicate the run so the marquee wraps seamlessly.
  const run = [...items, ...items];

  return (
    <div
      className="news-tile"
      style={{ transform: active ? "scale(1.06)" : "scale(1)" }}
    >
      <img
        className="news-tile__banner"
        src={`${import.meta.env.BASE_URL}textures/channels/news_banner.png`}
        alt="News Channel"
        draggable={false}
      />
      <div className="news-tile__ticker">
        <div className="news-tile__track">
          {run.map((h, i) => (
            <span className="news-tile__item" key={i}>
              {h}
              <span className="news-tile__dot">◆</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------- Card ---------- */

function StoryCard({ story, rank }: { story: Story; rank: number }) {
  // Dead or hotlink-blocked publisher images otherwise leave a broken frame on
  // the card; drop the thumbnail and let the headline take the space.
  const [imageOk, setImageOk] = useState(true);
  const open = () => {
    Sound.select();
    window.open(story.url, "_blank", "noopener");
  };
  return (
    <button className="news-card" onClick={open} onMouseEnter={() => Sound.hover()}>
      {story.image && imageOk && (
        <img
          className="news-card-img"
          src={story.image}
          alt=""
          loading="lazy"
          draggable={false}
          onError={() => setImageOk(false)}
        />
      )}
      <div className="news-card-top">
        <span className="news-rank">{rank}</span>
        <span className="news-source">{story.source || domainOf(story.url)}</span>
      </div>
      <h3 className="news-card-title">{story.title}</h3>
      <div className="news-card-meta">
        <span className="news-meta-spacer" />
        <span className="news-meta-chip">{relativeTime(story.publishedAt)}</span>
      </div>
    </button>
  );
}

function SkeletonCard() {
  return (
    <div className="news-card is-skeleton">
      <div className="news-card-top">
        <span className="news-sk" style={{ width: 26, height: 26, borderRadius: 8 }} />
        <span className="news-sk news-sk-line" style={{ width: "45%" }} />
      </div>
      <span className="news-sk news-sk-title" style={{ width: "95%" }} />
      <span className="news-sk news-sk-title" style={{ width: "80%" }} />
      <div className="news-card-meta" style={{ borderTop: "none" }}>
        <span className="news-sk news-sk-line" style={{ width: "30%" }} />
        <span className="news-sk news-sk-line" style={{ width: "24%" }} />
      </div>
    </div>
  );
}

/* ---------- App ---------- */

export function NewsApp(_props: ChannelAppProps) {
  const [stories, setStories] = useState<Story[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [fetchedAt, setFetchedAt] = useState(0);
  const [slideshow, setSlideshow] = useState(false);
  const [category, setCategory] = useState(DEFAULT_CATEGORY);
  /* The globe leads. It's the view that says "News Channel" at a glance,
     and it needs no section chosen — it plots the whole paper at once. */
  const [view, setView] = useState<View>("globe");
  // Every section's stories, for the slideshow. Read from the same in-memory
  // feed as the tabs, so this is a merge rather than a second request.
  const [allStories, setAllStories] = useState<Story[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async (cat: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState("loading");
    setErrorMsg("");
    try {
      const result = await getNews(cat, controller.signal);
      if (controller.signal.aborted) return;
      setStories(result.stories);
      setFetchedAt(result.fetchedAt);
      setState("ready");
    } catch (err) {
      if (controller.signal.aborted) return;
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong.");
      setState("error");
    }
  }, []);

  // Switching tabs re-reads the already-loaded feed, so this is a cheap
  // in-memory lookup after the first call rather than a network round trip.
  useEffect(() => {
    load(category);
    return () => abortRef.current?.abort();
  }, [load, category]);

  // A failure here only costs the slideshow its extra sections — the tab the
  // viewer is looking at has its own error handling, so stay quiet.
  useEffect(() => {
    let live = true;
    getAllNews()
      .then((r) => live && setAllStories(r.stories))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  /* The globe and the slideshow both work on the whole paper rather than
     the open tab. Until every section has arrived they fall back to the
     current one, so neither is dead on the first frame. */
  const wholePaper = allStories.length > 0 ? allStories : stories;

  const tickerText =
    stories.length > 0
      ? stories.slice(0, 12).map((s) => s.title)
      : ["Fetching the latest headlines from around the web…"];

  return (
    <div className="news-app">
      <NewsMusic slideshow={slideshow} />
      {/* Scrolling ticker */}
      <div className="news-ticker">
        <span className="news-ticker-tag">Breaking</span>
        <div className="news-ticker-track">
          <div className="news-ticker-move">
            {tickerText.map((t, i) => (
              <span key={i} className="news-ticker-item">
                {t}
                <span className="news-ticker-dot">◆</span>
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Masthead */}
      <header className="news-masthead">
        <div className="news-mast-mark">
          <svg width="26" height="22" viewBox="0 0 100 80" aria-hidden="true">
            <rect x="12" y="12" width="66" height="56" rx="4" fill="#ffffff" />
            <rect x="18" y="18" width="54" height="11" rx="2" fill="#2c8b39" />
            <rect x="18" y="34" width="24" height="26" rx="2" fill="#bfe6c4" />
            <rect x="46" y="34" width="26" height="4" rx="2" fill="#8fbf96" />
            <rect x="46" y="42" width="26" height="4" rx="2" fill="#8fbf96" />
            <rect x="46" y="50" width="26" height="4" rx="2" fill="#8fbf96" />
          </svg>
        </div>
        <div className="news-mast-titles">
          <h1 className="news-mast-title">News Channel</h1>
          <p className="news-mast-sub">Today's top stories from around the web</p>
        </div>
        <div className="news-mast-date">
          {today}
          {fetchedAt > 0 && <span className="news-mast-updated">{updatedLabel(fetchedAt)}</span>}
        </div>
        {/* View switch */}
        <div className="news-views" role="group" aria-label="View">
          {(
            [
              ["globe", "🌍", "Globe"],
              ["grid", "▤", "Headlines"],
            ] as const
          ).map(([id, glyph, label]) => (
            <button
              key={id}
              className={`news-view-btn${view === id ? " is-on" : ""}`}
              onClick={() => {
                if (view === id) return;
                Sound.page();
                setView(id);
              }}
              onMouseEnter={() => Sound.hover()}
              aria-pressed={view === id}
            >
              <span aria-hidden="true">{glyph}</span> {label}
            </button>
          ))}
        </div>

        <button
          className="news-slideshow-btn"
          onClick={() => {
            Sound.enter();
            setSlideshow(true);
          }}
          onMouseEnter={() => Sound.hover()}
          disabled={wholePaper.length === 0}
          title={
            wholePaper.length
              ? `Play all ${wholePaper.length} stories from every section`
              : undefined
          }
        >
          <span aria-hidden="true">▶</span> Slideshow
        </button>
      </header>

      {/* Category tabs. The globe has no sections — it plots the lot. */}
      {view === "grid" && (
        <nav className="news-tabs" aria-label="News categories">
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              className={`news-tab${c.id === category ? " is-on" : ""}`}
              onClick={() => {
                if (c.id === category) return;
                Sound.page();
                setCategory(c.id);
              }}
              onMouseEnter={() => Sound.hover()}
              aria-current={c.id === category ? "page" : undefined}
            >
              {c.label}
            </button>
          ))}
        </nav>
      )}

      {/* Body */}
      {view === "globe" ? (
        <NewsGlobe stories={wholePaper} />
      ) : state === "error" ? (
        <div className="news-error">
          <h2>Couldn't reach the newsroom</h2>
          <p>{errorMsg || "The headlines feed is unavailable right now."}</p>
          {/* Re-reads the prebuilt feed — a retry after a failed load, not a
              refresh of the headlines themselves. Costs nothing upstream. */}
          <button
            className="news-refresh"
            onClick={() => {
              Sound.select();
              load(category);
            }}
            onMouseEnter={() => Sound.hover()}
          >
            <span className="news-refresh-ico" aria-hidden="true">
              ↻
            </span>
            Try again
          </button>
        </div>
      ) : (
        <div className="news-scroll">
          <div className="news-grid">
            {state === "loading" && stories.length === 0
              ? Array.from({ length: 10 }).map((_, i) => <SkeletonCard key={i} />)
              : stories.map((s, i) => <StoryCard key={s.id} story={s} rank={i + 1} />)}
          </div>
        </div>
      )}

      {slideshow && wholePaper.length > 0 && (
        <NewsSlideshow stories={wholePaper} onClose={() => setSlideshow(false)} />
      )}
    </div>
  );
}
