import { useCallback, useEffect, useRef, useState } from "react";
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

   It runs ENDLESSLY, fed by a pump that keeps a few verified
   pictures ahead of wherever you are:

     fetch a round → verify each image loads → append to `photos`

   Verifying BEFORE a photo joins the queue is what keeps the
   position honest. Sources hand back plenty of records whose
   image 404s or gets refused (the Art Institute's IIIF server
   rate-limits browsers, for one), and if those reached the
   queue every failure would skip a slot — so the counter would
   jump by 2 or 3 and the queue length would drift. Here every
   entry in `photos` is known-good, so ← / → always move by
   exactly one. Verification also warms the browser cache, so
   the picture is already decoded when its turn comes.
   ============================================================ */

const SLIDE_MS = 7000;
/** How long the controls linger after the pointer stops moving. */
const IDLE_MS = 2600;
/** Ken Burns variants — cycled so consecutive slides don't drift alike. */
const KB_VARIANTS = 4;
/** Keep at least this many verified pictures queued ahead of the viewer. */
const LOOKAHEAD = 5;
/** Give a single image this long to prove itself before moving on. */
const VERIFY_MS = 8000;
/** Images verified at once — enough to stay ahead, few enough not to get throttled. */
const VERIFY_CONCURRENCY = 4;
/**
 * If a source fails this many times without a single success, treat it as down
 * for the rest of the run and stop spending time on it. Whole sources really do
 * go dark — the Art Institute's IIIF server starts refusing browser requests
 * once it has seen a burst of them.
 */
const SOURCE_STRIKES = 5;
/** Consecutive rounds yielding nothing new before we accept the well is dry. */
const EMPTY_ROUND_LIMIT = 3;

/**
 * Resolve true only if the bitmap genuinely decodes.
 *
 * This reports the image's real fate and nothing else. It deliberately knows
 * nothing about cancellation: folding "we gave up on this run" into "the image
 * is broken" would let a torn-down pump (React StrictMode remounts every effect
 * in dev) record perfectly good photos as failures and blacklist their source.
 */
function verifyImage(src: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    const settle = (ok: boolean) => {
      window.clearTimeout(timer);
      img.onload = img.onerror = null;
      resolve(ok);
    };
    const timer = window.setTimeout(() => settle(false), VERIFY_MS);
    img.onload = () => settle(img.naturalWidth > 0);
    img.onerror = () => settle(false);
    img.src = src;
  });
}

interface Props {
  /** Which sources to pull from — chosen on the channel's home screen. */
  sources: SourceId[];
  onExit: () => void;
}

export function PhotoScreensaver({ sources, onExit }: Props) {
  /** Verified and displayable. Append-only, so indices never shift. */
  const [photos, setPhotos] = useState<WebPhoto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [prevIndex, setPrevIndex] = useState<number | null>(null);
  const [playing, setPlaying] = useState(true);
  const [uiVisible, setUiVisible] = useState(true);
  /** True once the sources stop yielding anything new — the queue then loops. */
  const [exhausted, setExhausted] = useState(false);
  /**
   * Id of the slide whose bitmap is on screen. The caption is gated on this so
   * the credit can never describe a photo the viewer isn't looking at yet.
   */
  const [readyId, setReadyId] = useState<string | null>(null);

  const idleTimer = useRef<number | undefined>(undefined);
  const imgRef = useRef<HTMLImageElement | null>(null);

  /* Pump bookkeeping. Refs, because the pump loop needs values that are
     current *within* one async run, not whatever a render closed over. */
  const verifiedRef = useRef<WebPhoto[]>([]);
  const pendingRef = useRef<WebPhoto[]>([]);
  const seenRef = useRef<Set<string>>(new Set());
  const roundRef = useRef(0);
  const doneRef = useRef(false);
  const emptyRoundsRef = useRef(0);
  /** Consecutive verification failures per source, and the ones written off. */
  const strikesRef = useRef<Map<SourceId, number>>(new Map());
  const deadRef = useRef<Set<SourceId>>(new Set());
  const indexRef = useRef(0);
  indexRef.current = index;
  /** Mirror of `exhausted` for `step`, which reads it from a stable callback. */
  const exhaustedRef = useRef(false);
  exhaustedRef.current = exhausted;

  const sourceKey = sources.join(",");

  /* ---------- Reset everything when the chosen sources change ---------- */
  useEffect(() => {
    verifiedRef.current = [];
    pendingRef.current = [];
    seenRef.current = new Set();
    roundRef.current = 0;
    doneRef.current = false;
    emptyRoundsRef.current = 0;
    strikesRef.current = new Map();
    deadRef.current = new Set();
    setPhotos([]);
    setIndex(0);
    setPrevIndex(null);
    setReadyId(null);
    setError(null);
    setExhausted(false);
  }, [sourceKey]);

  /* ---------- The pump ----------
     Tops the queue up to LOOKAHEAD past the current position, fetching
     another round whenever the pending pile runs dry. */
  const pump = useCallback(
    async (cancelled: () => boolean) => {
      {
        while (!cancelled() && verifiedRef.current.length < indexRef.current + LOOKAHEAD) {
          if (!pendingRef.current.length) {
            if (doneRef.current) break;
            // Don't keep fetching from sources we've already written off.
            const live = (sourceKey.split(",") as SourceId[]).filter((id) => !deadRef.current.has(id));
            if (!live.length) {
              doneRef.current = true;
              break;
            }
            // Claim the round number BEFORE awaiting. React StrictMode mounts
            // effects twice in dev, so a second pump can start while this one
            // is in flight; if both read the same round they both fetch the
            // same batch, and the loser sees every photo as already-seen and
            // wrongly concludes the sources are spent.
            const myRound = roundRef.current;
            roundRef.current += 1;

            let batch: WebPhoto[] = [];
            try {
              batch = await getWebPhotos(live, myRound);
            } catch {
              // Rate limited, offline, or past the end of the archive. Stop
              // asking and let the queue loop over what we already have.
              if (!cancelled()) doneRef.current = true;
              break;
            }
            // Torn down while fetching — leave the shared refs untouched.
            if (cancelled()) return;

            const fresh = batch.filter((p) => !seenRef.current.has(p.id));
            fresh.forEach((p) => seenRef.current.add(p.id));
            if (!fresh.length) {
              // One barren round isn't proof we're finished — a source can
              // legitimately repeat itself. Only give up after a few in a row.
              emptyRoundsRef.current += 1;
              if (emptyRoundsRef.current >= EMPTY_ROUND_LIMIT) {
                doneRef.current = true;
                break;
              }
              continue;
            }
            emptyRoundsRef.current = 0;
            pendingRef.current.push(...fresh);
          }

          // Drop anything from a source that has already proved to be down.
          if (deadRef.current.size) {
            pendingRef.current = pendingRef.current.filter((p) => !deadRef.current.has(p.sourceId));
            if (!pendingRef.current.length) continue;
          }

          // A small batch: enough to stay ahead of a dead source, few enough
          // that we don't look like the burst that gets clients throttled.
          const batch = pendingRef.current.splice(0, VERIFY_CONCURRENCY);
          const results = await Promise.all(
            batch.map((p) => verifyImage(p.src).then((ok) => ({ p, ok })))
          );

          // Torn down mid-batch: put the work back and record nothing. Counting
          // an abandoned run's results would blacklist healthy sources.
          if (cancelled()) {
            pendingRef.current.unshift(...batch);
            return;
          }

          const good: WebPhoto[] = [];
          for (const { p, ok } of results) {
            const tally = strikesRef.current.get(p.sourceId) ?? 0;
            if (ok) {
              good.push(p);
              strikesRef.current.set(p.sourceId, 0);
            } else if (tally + 1 >= SOURCE_STRIKES) {
              deadRef.current.add(p.sourceId);
            } else {
              strikesRef.current.set(p.sourceId, tally + 1);
            }
          }

          if (good.length) {
            verifiedRef.current = [...verifiedRef.current, ...good];
            setPhotos(verifiedRef.current);
          }
        }
      }
      if (!cancelled()) setExhausted(doneRef.current && !pendingRef.current.length);
    },
    [sourceKey]
  );

  /* ---------- Pump driver ----------
     ONE long-lived loop per source selection. It must not be torn down when
     the queue grows: cancelling mid-flight would discard the verification in
     progress, and the re-entry guard would make the restart a no-op — the
     slideshow would stall after its first batch. So the loop owns its own
     idling instead of being re-triggered by effect dependencies. */
  useEffect(() => {
    let cancelled = false;
    const isCancelled = () => cancelled;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    (async () => {
      while (!isCancelled()) {
        // `doneRef` only means "stop asking for new rounds" — there may still
        // be a pending pile to verify, so it must not halt the pump on its own.
        const wantsMore =
          verifiedRef.current.length < indexRef.current + LOOKAHEAD &&
          (pendingRef.current.length > 0 || !doneRef.current);
        if (wantsMore) await pump(isCancelled);
        else await sleep(300);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pump]);

  /* Nothing survived verification and there's no more to try. */
  useEffect(() => {
    if (exhausted && !photos.length && !error) {
      setError("Every picture the sources offered failed to load.");
    }
  }, [exhausted, photos.length, error]);

  const exit = useCallback(() => {
    Sound.back();
    onExit();
  }, [onExit]);

  /** Every entry is verified, so this is a plain ±1 walk. */
  const step = useCallback((dir: 1 | -1) => {
    setIndex((cur) => {
      const n = verifiedRef.current.length;
      if (n < 2) return cur;
      let next = cur + dir;
      if (next >= n) {
        // At the tip of the queue. Hold here unless there is genuinely nothing
        // more coming — wrapping round to #1 while pictures are still being
        // verified is precisely the "position jumps around" problem.
        if (!exhaustedRef.current) return cur;
        next = 0;
      } else if (next < 0) {
        next = n - 1;
      }
      if (next === cur) return cur;
      setPrevIndex(cur);
      return next;
    });
  }, []);

  /* ---------- Auto-advance ----------
     Keyed on readyId so each slide gets its full SLIDE_MS *on screen*;
     a slow image eats loading time, not display time. */
  useEffect(() => {
    if (!playing || photos.length < 2 || !readyId) return;
    const t = window.setTimeout(() => step(1), SLIDE_MS);
    return () => window.clearTimeout(t);
  }, [playing, photos.length, step, readyId]);

  /* ---------- Catch images that were already cached ----------
     Verification warms the cache, so the bitmap is usually complete before
     React can attach onLoad — without this the slide would never show. */
  useEffect(() => {
    const node = imgRef.current;
    const id = photos[index]?.id;
    if (id && node?.complete && node.naturalWidth > 0) setReadyId(id);
  }, [index, photos]);

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

  const current = photos[index];
  const previous = prevIndex !== null && prevIndex !== index ? photos[prevIndex] : null;
  const shown = Boolean(current) && readyId === current.id;

  /**
   * The slide whose pixels are actually on screen. While a slow image is still
   * painting that's still the *previous* one, so the caption keeps crediting
   * what the viewer can see instead of blanking out and popping back.
   */
  const displayed = shown ? current : previous;

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
            /* Only the current layer may set readyId — letting the outgoing
               layer fire it would drag the caption backwards. */
            onLoad={isCurrent ? () => setReadyId(photo.id) : undefined}
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
            {/* Position only — there is no "remaining" in an endless slideshow. */}
            <span className="saver__count">
              #{index + 1}
              {!exhausted && <span className="saver__count-more">＋</span>}
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
