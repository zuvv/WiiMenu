import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getWebPhotos, PHOTO_SOURCES, type SourceId, type WebPhoto } from "./PhotoSources";
import { Sound } from "../wii/sound";
import "./PhotoScreensaver.css";

/* ============================================================
   Photo Channel screensaver — a full-screen, Windows-Spotlight
   style slideshow of curated photos pulled from free public
   APIs (see PhotoSources.ts).

   Slow Ken Burns drift, crossfade between slides, and a caption
   card crediting the photo. Controls fade away while it plays
   and come back on mouse move. Esc or the ✕ exits.
   ============================================================ */

const SLIDE_MS = 7000;
/** How long the controls linger after the pointer stops moving. */
const IDLE_MS = 2600;
/** Ken Burns variants — cycled so consecutive slides don't drift alike. */
const KB_VARIANTS = 4;

interface Props {
  /** Which sources to pull from — chosen on the channel's home screen. */
  sources: SourceId[];
  onExit: () => void;
}

export function PhotoScreensaver({ sources, onExit }: Props) {
  const [photos, setPhotos] = useState<WebPhoto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [prevIndex, setPrevIndex] = useState<number | null>(null);
  const [playing, setPlaying] = useState(true);
  const [uiVisible, setUiVisible] = useState(true);

  const idleTimer = useRef<number | undefined>(undefined);
  const imgRef = useRef<HTMLImageElement | null>(null);
  /** Slides whose image 404'd or was blocked — skipped on sight. */
  const [broken, setBroken] = useState<Set<string>>(() => new Set());
  /**
   * Id of the slide whose bitmap has actually decoded. The caption and the
   * crossfade are gated on this so the credit can never describe a photo the
   * viewer isn't looking at yet — the previous layer stays up until the new
   * image is genuinely on screen.
   */
  const [readyId, setReadyId] = useState<string | null>(null);

  const live = useMemo(() => photos.filter((p) => !broken.has(p.id)), [photos, broken]);

  /* ---------- Load ----------
     Keyed on the joined ids, not the array itself, so a fresh array literal
     from the parent doesn't re-trigger the fetch. */
  const sourceKey = sources.join(",");
  useEffect(() => {
    const ctrl = new AbortController();
    getWebPhotos(sourceKey.split(",") as SourceId[], false, ctrl.signal)
      .then((list) => {
        setPhotos(list);
        setError(null);
      })
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return;
        setError(e instanceof Error ? e.message : "Could not reach the photo sources");
      });
    return () => ctrl.abort();
  }, [sourceKey]);

  const exit = useCallback(() => {
    Sound.back();
    onExit();
  }, [onExit]);

  const step = useCallback(
    (dir: 1 | -1) => {
      setIndex((cur) => {
        if (live.length === 0) return cur;
        setPrevIndex(cur);
        return (cur + dir + live.length) % live.length;
      });
    },
    [live.length]
  );

  /* ---------- Auto-advance ----------
     Keyed on readyId so each slide gets its full SLIDE_MS *on screen*;
     a slow image eats loading time, not display time. */
  useEffect(() => {
    if (!playing || live.length < 2 || !readyId) return;
    const t = window.setTimeout(() => step(1), SLIDE_MS);
    return () => window.clearTimeout(t);
  }, [playing, live.length, step, readyId]);

  /* ---------- Catch images that were already cached ----------
     A cached bitmap can finish decoding before React attaches onLoad, so that
     event never fires and the slide would sit invisible forever. */
  useEffect(() => {
    const node = imgRef.current;
    const id = live[index]?.id;
    if (id && node?.complete && node.naturalWidth > 0) setReadyId(id);
  }, [index, live]);

  /* ---------- Preload the next image so crossfades never stall ---------- */
  useEffect(() => {
    if (live.length < 2) return;
    const next = live[(index + 1) % live.length];
    if (next) new Image().src = next.src;
  }, [index, live]);

  /* ---------- Keep the index in range as broken slides drop out ---------- */
  useEffect(() => {
    if (live.length && index >= live.length) {
      setIndex(0);
      setPrevIndex(null);
    }
  }, [live.length, index]);

  /* ---------- Keyboard ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") exit();
      else if (e.key === "ArrowRight") step(1);
      else if (e.key === "ArrowLeft") step(-1);
      else if (e.key === " ") {
        e.preventDefault();
        setPlaying((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [exit, step]);

  /* ---------- Show controls on pointer movement, then fade them out ---------- */
  const wake = useCallback(() => {
    setUiVisible(true);
    window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => setUiVisible(false), IDLE_MS);
  }, []);

  useEffect(() => {
    wake();
    return () => window.clearTimeout(idleTimer.current);
  }, [wake]);

  const markBroken = useCallback((id: string) => {
    setBroken((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  const current = live[index];
  const previous = prevIndex !== null && prevIndex !== index ? live[prevIndex] : null;
  const shown = Boolean(current) && readyId === current.id;

  /**
   * The slide whose pixels are actually on screen. While a slow image is still
   * downloading that's still the *previous* one, so the caption keeps crediting
   * what the viewer can see instead of blanking out and popping back.
   */
  const displayedIndex = live.findIndex((p) => p.id === readyId);
  const displayed = displayedIndex >= 0 ? live[displayedIndex] : null;

  return (
    <div
      className={`saver${uiVisible ? " is-awake" : ""}`}
      onMouseMove={wake}
      role="dialog"
      aria-modal="true"
      aria-label="Photo screensaver"
    >
      {/* Click anywhere on the backdrop to exit, like a real screensaver. */}
      <button className="saver__backdrop" onClick={exit} aria-label="Exit screensaver" tabIndex={-1} />

      {/* Only while nothing at all is on screen — mid-slideshow the previous
          layer covers the wait, so no spinner should flash between slides. */}
      {!shown && !previous && !error && (
        <div className="saver__status">
          <span className="saver__spinner" aria-hidden />
          <p>Gathering pictures…</p>
        </div>
      )}

      {error && (
        <div className="saver__status">
          <h2>Couldn't load photos</h2>
          <p className="saver__status-detail">{error}</p>
          <p>
            Check your connection — this slideshow pulls from{" "}
            {PHOTO_SOURCES.filter((s) => sources.includes(s.id))
              .map((s) => s.label)
              .join(", ") || "no sources"}
            .
          </p>
          <button className="saver__btn" onClick={exit}>
            Choose sources
          </button>
        </div>
      )}

      {/* Both layers live in ONE keyed list so that when a slide moves from
          current to previous React reuses its <img> instead of rebuilding it —
          rebuilding would restart the Ken Burns pan mid-crossfade. */}
      {[
        previous && { photo: previous, slot: prevIndex!, isCurrent: false },
        current && { photo: current, slot: index, isCurrent: true },
      ]
        .filter((l): l is { photo: WebPhoto; slot: number; isCurrent: boolean } => Boolean(l))
        .map(({ photo, slot, isCurrent }) => (
          <img
            key={photo.id}
            className={`saver__layer saver__layer--kb${slot % KB_VARIANTS}${
              !isCurrent || shown ? " saver__layer--shown" : ""
            }`}
            src={photo.src}
            alt={isCurrent ? photo.title : ""}
            aria-hidden={!isCurrent}
            draggable={false}
            ref={isCurrent ? imgRef : undefined}
            onLoad={() => setReadyId(photo.id)}
            onError={() => {
              markBroken(photo.id);
              if (isCurrent) step(1);
            }}
          />
        ))}

      {displayed && (
        <>
          <figcaption className="saver__caption" key={displayed.id}>
            <span className="saver__badge">{displayed.source}</span>
            <h2 className="saver__title">{displayed.title}</h2>
            {displayed.credit && <p className="saver__credit">{displayed.credit}</p>}
            {displayed.detail && <p className="saver__detail">{displayed.detail}</p>}
            {displayed.link && (
              <a
                className="saver__link"
                href={displayed.link}
                target="_blank"
                rel="noreferrer noopener"
                onClick={(e) => e.stopPropagation()}
              >
                View source ↗
              </a>
            )}
          </figcaption>

          {/* Restarts its animation on every slide, so it doubles as a timer. */}
          <div className="saver__progress" aria-hidden>
            <span
              key={`${displayed.id}-${playing}`}
              className={`saver__progress-fill${playing ? " is-running" : ""}`}
              style={{ animationDuration: `${SLIDE_MS}ms` }}
            />
          </div>

          <div className="saver__controls">
            <button className="saver__ctrl" onMouseEnter={() => Sound.hover()} onClick={() => step(-1)} aria-label="Previous">
              ‹
            </button>
            <button
              className="saver__ctrl saver__ctrl--play"
              onMouseEnter={() => Sound.hover()}
              onClick={() => {
                Sound.select();
                setPlaying((p) => !p);
              }}
              aria-label={playing ? "Pause" : "Play"}
            >
              {playing ? "❚❚" : "▶"}
            </button>
            <button className="saver__ctrl" onMouseEnter={() => Sound.hover()} onClick={() => step(1)} aria-label="Next">
              ›
            </button>
            <span className="saver__count">
              {displayedIndex + 1} / {live.length}
            </span>
          </div>
        </>
      )}

      <button className="saver__close" onMouseEnter={() => Sound.hover()} onClick={exit} aria-label="Exit screensaver">
        ×
      </button>
      <p className="saver__hint">Esc or click anywhere to exit · ←/→ to skip · Space to pause</p>
    </div>
  );
}
