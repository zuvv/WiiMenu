import { useCallback, useEffect, useState } from "react";
import { Sound } from "../wii/sound";
import type { Story } from "./NewsFeed";
import "./NewsSlideshow.css";

/* ============================================================
   News Channel slideshow — the ambient, lean-back view. One
   story at a time, full bleed, advancing on its own while the
   04 "Slideshow (Daytime)" track loops underneath.

   Keyboard: Esc closes, ← / → step, Space pauses.
   ============================================================ */

const SLIDE_MS = 8000;
const TICK_MS = 50; // progress-bar resolution
const DOT_WINDOW = 25; // most dots to draw before the strip starts sliding

export function NewsSlideshow({
  stories,
  startAt = 0,
  onClose,
}: {
  stories: Story[];
  startAt?: number;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(() =>
    stories.length ? Math.min(Math.max(startAt, 0), stories.length - 1) : 0
  );
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const count = stories.length;
  const story = stories[index];

  /* Publishers' image URLs go dead or refuse hotlinking, which left a broken
     image frame sitting in the middle of the slide. Remember which ones failed
     — the slideshow loops, so without this the same slide re-breaks on every
     pass — and fall back to a text-only slide, which the flex row handles by
     giving the copy the full width. */
  const [failedImages, setFailedImages] = useState<ReadonlySet<string>>(() => new Set());
  const markImageFailed = useCallback((url: string) => {
    setFailedImages((prev) => (prev.has(url) ? prev : new Set(prev).add(url)));
  }, []);
  const image = story?.image && !failedImages.has(story.image) ? story.image : undefined;

  /* Indices of the dots to draw: all of them when the run is short, otherwise
     a window that keeps the current dot centred until you reach either end. */
  const dotRange = (() => {
    if (count <= DOT_WINDOW) return Array.from({ length: count }, (_, i) => i);
    const half = Math.floor(DOT_WINDOW / 2);
    const start = Math.min(Math.max(index - half, 0), count - DOT_WINDOW);
    return Array.from({ length: DOT_WINDOW }, (_, i) => start + i);
  })();

  const go = useCallback(
    (delta: number) => {
      if (!count) return;
      Sound.hover();
      setElapsed(0);
      setIndex((i) => (i + delta + count) % count);
    },
    [count]
  );

  const close = useCallback(() => {
    Sound.back();
    onClose();
  }, [onClose]);

  // Advance on a timer. Driving the progress bar off the same interval keeps
  // the bar and the actual slide change from drifting apart.
  useEffect(() => {
    if (paused || count <= 1) return;
    const id = setInterval(() => {
      setElapsed((e) => {
        const next = e + TICK_MS;
        if (next >= SLIDE_MS) {
          setIndex((i) => (i + 1) % count);
          return 0;
        }
        return next;
      });
    }, TICK_MS);
    return () => clearInterval(id);
  }, [paused, count]);

  // Keyboard control. Bound to the window so it works without focus management.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        go(1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        go(-1);
      } else if (e.key === " ") {
        // Space would otherwise scroll the grid behind the overlay.
        e.preventDefault();
        setPaused((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, go]);

  if (!story) return null;

  const progress = Math.min(100, (elapsed / SLIDE_MS) * 100);
  const open = () => {
    Sound.select();
    window.open(story.url, "_blank", "noopener");
  };

  return (
    <div className="news-slideshow" role="dialog" aria-modal="true" aria-label="News slideshow">
      {/* Backdrop: the story image, blown up and blurred, so every slide fills
          the frame regardless of the source image's aspect ratio. */}
      <div className="news-ss-backdrop" key={`bg-${index}`}>
        {image && (
          <img
            src={image}
            alt=""
            aria-hidden="true"
            onError={() => markImageFailed(image)}
          />
        )}
      </div>

      {/* Keyed by index so image and copy re-run their entry animation on every change. */}
      <div className="news-ss-stage" key={`slide-${index}`}>
        {image && (
          <div className="news-ss-figure">
            <img
              src={image}
              alt=""
              draggable={false}
              onError={() => markImageFailed(image)}
            />
          </div>
        )}
        <div className="news-ss-copy">
          <div className="news-ss-kicker">
            <span className="news-ss-source">{story.source}</span>
            <span className="news-ss-count">
              {index + 1} / {count}
            </span>
          </div>
          <h2 className="news-ss-title">{story.title}</h2>
          {story.description && <p className="news-ss-desc">{story.description}</p>}
          <button className="news-ss-read" onClick={open} onMouseEnter={() => Sound.hover()}>
            Read the full story ↗
          </button>
        </div>
      </div>

      {/* Progress + controls */}
      <div className="news-ss-progress">
        <div className="news-ss-progress-fill" style={{ width: `${progress}%` }} />
      </div>

      <div className="news-ss-controls">
        <button onClick={() => go(-1)} onMouseEnter={() => Sound.hover()} aria-label="Previous story">
          ‹
        </button>
        <button
          onClick={() => {
            Sound.hover();
            setPaused((p) => !p);
          }}
          aria-label={paused ? "Resume slideshow" : "Pause slideshow"}
        >
          {paused ? "▶" : "❚❚"}
        </button>
        <button onClick={() => go(1)} onMouseEnter={() => Sound.hover()} aria-label="Next story">
          ›
        </button>
      </div>

      <button className="news-ss-close" onClick={close} onMouseEnter={() => Sound.hover()}>
        ✕ Close
      </button>

      {/* One dot per story overflows the screen once the slideshow covers every
          section (110 stories ≈ 1500px of dots), so past DOT_WINDOW the strip
          becomes a window that slides with you. The "n / count" readout above
          is what actually tells you where you are. */}
      <div className="news-ss-dots" aria-hidden="true">
        {dotRange.map((i) => (
          <span key={stories[i].id} className={`news-ss-dot${i === index ? " is-on" : ""}`} />
        ))}
      </div>
    </div>
  );
}
