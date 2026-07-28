import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Cursor } from "../wii/cursor";
import { Sound } from "../wii/sound";
import { GlobeRenderer, buildEarthTexture, project, type WorldData } from "./globe";
import { domainOf, relativeTime, type Story } from "./NewsFeed";
import "./NewsGlobe.css";

/* ============================================================
   News Globe — every located story, pinned where it happened.

   Grab it and it spins; let go and it keeps going. Stories that
   share a location stack onto one pin, and opening a stack walks
   you down: list → preview → the article itself.

   The sphere is drawn by globe.ts into a canvas. The pins are
   real DOM elements laid over it, positioned imperatively from
   the animation loop — React renders the list of pins, but 60
   frames a second of transform updates never go through state.
   ============================================================ */

const RAD = Math.PI / 180;

/** Radians of tilt allowed either side of the equator. Stopping just
    short of the pole keeps the spin axis from going degenerate. */
const MAX_PITCH = 82 * RAD;

/** Per-frame decay of a throw. 0.95 coasts for roughly a second. */
const FRICTION = 0.95;
/** Below this, a throw is over and the globe comes to rest. */
const REST = 0.00025;

const FLY_MS = 700;

const ZOOM_MIN = 0.85;
const ZOOM_MAX = 8;

/** Ceiling on the pixel buffer. A frame costs ~2ms even here; what this
    really bounds is the tilt table rebuild (~40ms) and ~68MB of arrays.
    Both scale with the square of this number.

    The buffer a given zoom wants is `stageSize × zoom × dpr`, so with a
    ~554px stage at dpr 2 this covers up to ~1.85× at full detail. Past
    that the renderer keeps drawing the same sphere and CSS magnifies those
    pixels, so the far end of ZOOM_MAX gets you closer without getting you
    sharper — deliberately, because sharpness up there is expensive: 4096
    would want ~270MB of arrays, which is not worth it for a launcher. */
const MAX_BUFFER = 2048;

/** How fast the globe catches up to a new zoom, per frame. */
const ZOOM_EASE = 0.2;

/* ------------------------------------------------------------
   Markers
   ------------------------------------------------------------ */

interface Marker {
  id: string;
  name: string;
  /** "Lyon, France" — what the panel header reads. */
  label: string;
  lat: number;
  lon: number;
  stories: Story[];
}

/** One pin per place, newest story first. */
function toMarkers(stories: Story[]): Marker[] {
  const byPlace = new Map<string, Marker>();
  for (const s of stories) {
    if (!s.place) continue;
    const p = s.place;
    let m = byPlace.get(p.id);
    if (!m) {
      m = {
        id: p.id,
        name: p.name,
        label: p.country && p.country !== p.name ? `${p.name}, ${p.country}` : p.name,
        lat: p.lat,
        lon: p.lon,
        stories: [],
      };
      byPlace.set(p.id, m);
    }
    m.stories.push(s);
  }

  for (const m of byPlace.values()) {
    m.stories.sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
  }
  // Busiest first, so a crowded pin paints over a quiet one.
  return [...byPlace.values()].sort((a, b) => b.stories.length - a.stories.length);
}

/* ------------------------------------------------------------
   Component
   ------------------------------------------------------------ */

export function NewsGlobe({ stories }: { stories: Story[] }) {
  const markers = useMemo(() => toMarkers(stories), [stories]);

  const stageRef = useRef<HTMLDivElement>(null);
  const globeRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pinRefs = useRef(new Map<string, HTMLButtonElement>());

  const [size, setSize] = useState(0);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  const [openId, setOpenId] = useState<string | null>(null);
  const [storyIndex, setStoryIndex] = useState<number | null>(null);

  const open = openId ? (markers.find((m) => m.id === openId) ?? null) : null;
  const story = open && storyIndex !== null ? (open.stories[storyIndex] ?? null) : null;

  /* --- rotation lives outside React ---
     The loop writes these every frame; putting them in state would
     re-render the whole panel sixty times a second for nothing. */
  const rot = useRef({
    yaw: 0,
    pitch: 12 * RAD,
    vYaw: 0,
    vPitch: 0,
    dragging: false,
    dirty: true,
  });
  const fly = useRef<{ t0: number; from: [number, number]; to: [number, number] } | null>(null);

  /* Zoom is eased in the loop rather than by a CSS transition. The pins are
     positioned by the same frame that scales the globe, so if the canvas
     eased and they didn't, every wheel tick would slide the pins off the
     map and back again. */
  const zoom = useRef({ now: 1, target: 1 });

  /* --- open on the busiest place --- */
  const framed = useRef(false);
  useEffect(() => {
    if (framed.current || !markers.length) return;
    framed.current = true;
    rot.current.yaw = markers[0].lon * RAD;
    rot.current.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, markers[0].lat * RAD));
    rot.current.dirty = true;
  }, [markers]);

  /* --- size to the stage --- */
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const box = entry.contentRect;
      // Leave room for the pin labels, which sit outside the disc.
      setSize(Math.max(160, Math.floor(Math.min(box.width, box.height) - 56)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* --- load the coastlines and light the renderer up --- */
  const rendererRef = useRef<GlobeRenderer | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`${import.meta.env.BASE_URL}geo/world.json`)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json() as Promise<WorldData>;
      })
      .then((world) => {
        if (!live || !canvasRef.current) return;
        rendererRef.current = new GlobeRenderer(canvasRef.current, buildEarthTexture(world));
        rot.current.dirty = true;
        setReady(true);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  /* --- the loop --- */
  useEffect(() => {
    if (!ready || !size) return;
    const renderer = rendererRef.current;
    const canvas = canvasRef.current;
    const globeEl = globeRef.current;
    if (!renderer || !canvas || !globeEl) return;

    const dpr = Math.min(devicePixelRatio || 1, 2);

    /* Zooming in scales the canvas up in CSS, which on its own just
       magnifies the pixels we already had. So the buffer grows with the
       zoom to keep the sphere sharp — but only once the gesture settles,
       since each change reallocates the tables and redoes the tilt pass. */
    let buffer = 0;
    const fitBuffer = (z: number) => {
      const want = Math.max(64, Math.min(MAX_BUFFER, Math.round(size * z * dpr)));
      if (want === buffer) return;
      buffer = want;
      canvas.width = want;
      canvas.height = want;
      renderer.resize(want);
      rot.current.dirty = true;
    };
    fitBuffer(zoom.current.now);

    let raf = 0;
    const frame = (now: number) => {
      const r = rot.current;
      const z = zoom.current;

      if (z.now !== z.target) {
        const step = (z.target - z.now) * ZOOM_EASE;
        z.now = Math.abs(step) < 0.001 ? z.target : z.now + step;
        globeEl.style.transform = `scale(${z.now})`;
        if (z.now === z.target) fitBuffer(z.now);
      }

      if (fly.current) {
        const f = fly.current;
        const t = Math.min(1, (now - f.t0) / FLY_MS);
        // Same ease-out the menu's channel zoom uses.
        const e = 1 - Math.pow(1 - t, 3);
        r.yaw = f.from[0] + (f.to[0] - f.from[0]) * e;
        r.pitch = f.from[1] + (f.to[1] - f.from[1]) * e;
        r.dirty = true;
        if (t >= 1) fly.current = null;
      } else if (!r.dragging) {
        if (Math.abs(r.vYaw) > REST || Math.abs(r.vPitch) > REST) {
          r.yaw += r.vYaw;
          r.pitch = clampPitch(r.pitch + r.vPitch);
          r.vYaw *= FRICTION;
          r.vPitch *= FRICTION;
          r.dirty = true;
        } else {
          // The throw is spent. Zero the remainder and leave the globe where
          // the user put it. Nothing is marked dirty, so once it settles the
          // renderer stops re-drawing entirely instead of turning forever.
          r.vYaw = 0;
          r.vPitch = 0;
        }
      }

      if (r.dirty) {
        renderer.render(r.yaw, r.pitch);
        r.dirty = false;
      }
      placePins();
      raf = requestAnimationFrame(frame);
    };

    /* Pins are positioned here rather than in render output: their
       transforms change every frame, and a React pass per frame for
       forty absolutely-positioned buttons is pure waste. */
    const placePins = () => {
      const r = rot.current;
      const radius = (size / 2) * zoom.current.now;
      for (const m of markers) {
        const el = pinRefs.current.get(m.id);
        if (!el) continue;
        const p = project(m.lat, m.lon, r.yaw, r.pitch);
        if (p.z <= 0.04) {
          // Round the back. Left in the DOM so React keeps the node.
          if (el.style.visibility !== "hidden") el.style.visibility = "hidden";
          continue;
        }
        if (el.style.visibility === "hidden") el.style.visibility = "";
        // The pin is a zero-sized anchor, so this lands its dot exactly on
        // the coordinate — see .ng-pin in the stylesheet.
        el.style.transform = `translate(${p.x * radius}px, ${-p.y * radius}px)`;
        // Fade and shrink into the limb so pins sink over the horizon
        // instead of blinking out.
        const edge = Math.min(1, p.z / 0.3);
        el.style.opacity = String(0.25 + 0.75 * edge);
        el.style.setProperty("--depth", String(0.72 + 0.28 * edge));
        el.style.zIndex = String(100 + Math.round(p.z * 100));
      }
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [ready, size, markers]);

  /* --- the hand ---
     Open over the globe, a fist while you're turning it, and back to the
     pointer over a pin or once you leave. `overStage` remembers where the
     mouse is so letting go mid-drag lands on the right one. */
  const overStage = useRef(false);
  const enterStage = () => {
    overStage.current = true;
    if (!rot.current.dragging) Cursor.open();
  };
  const leaveStage = () => {
    overStage.current = false;
    if (!rot.current.dragging) Cursor.point();
  };
  // Whatever the hand was doing, it stops being this channel's business.
  useEffect(() => () => Cursor.point(), []);

  /* --- drag --- */
  const drag = useRef({ id: -1, x: 0, y: 0, moved: 0 });

  const onPointerDown = (e: React.PointerEvent) => {
    // Let a click on a pin be a click on a pin.
    if ((e.target as HTMLElement).closest(".ng-pin")) return;
    Cursor.grab();
    const r = rot.current;
    r.dragging = true;
    r.vYaw = 0;
    r.vPitch = 0;
    fly.current = null;
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0 };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (d.id !== e.pointerId || !rot.current.dragging) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    d.x = e.clientX;
    d.y = e.clientY;
    d.moved += Math.abs(dx) + Math.abs(dy);

    // A pixel at the edge of the disc should follow the pointer, so the
    // gain is one radius across.
    const k = 1 / ((size / 2) * zoom.current.now);
    const r = rot.current;
    const pitch = clampPitch(r.pitch + dy * k);

    r.yaw -= dx * k;
    // The throw is the last frame's motion rather than an average — it
    // matches what the hand was doing at the moment of release.
    r.vYaw = -dx * k;
    // Dragging past the pole shouldn't bank a throw that then has
    // nowhere to go the instant you let go.
    r.vPitch = pitch === r.pitch ? 0 : dy * k;
    r.pitch = pitch;
    r.dirty = true;
  };

  const endDrag = (e: React.PointerEvent) => {
    if (drag.current.id !== e.pointerId) return;
    rot.current.dragging = false;
    drag.current.id = -1;
    if (overStage.current) Cursor.open();
    else Cursor.point();
  };

  const onWheel = (e: React.WheelEvent) => {
    const z = zoom.current;
    z.target = clamp(z.target * (e.deltaY < 0 ? 1.12 : 1 / 1.12), ZOOM_MIN, ZOOM_MAX);
  };

  /** Double-click empty sky to get the whole planet back. */
  const onDoubleClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest(".ng-pin")) return;
    zoom.current.target = 1;
  };

  /** Turn the globe until `lat`/`lon` faces the viewer. */
  const flyTo = useCallback((lat: number, lon: number) => {
    const r = rot.current;
    // Take the short way round: unwrap the target to within half a turn
    // of where we are, or the globe spins the long way to reach Japan.
    let target = lon * RAD;
    while (target - r.yaw > Math.PI) target -= Math.PI * 2;
    while (target - r.yaw < -Math.PI) target += Math.PI * 2;
    r.vYaw = 0;
    r.vPitch = 0;
    fly.current = {
      t0: performance.now(),
      from: [r.yaw, r.pitch],
      to: [target, clampPitch(lat * RAD)],
    };
  }, []);

  const openMarker = (m: Marker) => {
    Sound.select();
    setOpenId(m.id);
    // One story is not a list worth showing — go straight to it.
    setStoryIndex(m.stories.length === 1 ? 0 : null);
    flyTo(m.lat, m.lon);
  };

  const close = useCallback(() => {
    Sound.back();
    setOpenId(null);
    setStoryIndex(null);
  }, []);

  useEffect(() => {
    if (!openId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      // Esc walks back up one level at a time.
      if (storyIndex !== null && open && open.stories.length > 1) {
        Sound.back();
        setStoryIndex(null);
      } else {
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openId, storyIndex, open, close]);

  const located = markers.reduce((n, m) => n + m.stories.length, 0);

  if (failed) {
    return (
      <div className="ng-empty">
        <h2>The globe didn't load</h2>
        <p>Couldn't fetch the world map. The Headlines view still works.</p>
      </div>
    );
  }

  return (
    <div className="ng-root">
      <div
        className="ng-stage"
        ref={stageRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onMouseEnter={enterStage}
        onMouseLeave={leaveStage}
        onWheel={onWheel}
        onDoubleClick={onDoubleClick}
      >
        {/* The loop owns this element's transform. */}
        <div className="ng-globe" ref={globeRef} style={{ width: size, height: size }}>
          <div className="ng-atmosphere" />
          <canvas className="ng-canvas" ref={canvasRef} />
        </div>

        {/* Pins ride in an unscaled layer so labels stay crisp at any
            zoom; the loop multiplies their radius by the scale instead. */}
        <div className="ng-pins">
          {markers.map((m) => (
            <button
              key={m.id}
              className={`ng-pin${m.id === openId ? " is-open" : ""}${
                m.stories.length > 1 ? " is-stack" : ""
              }`}
              ref={(el) => {
                if (el) pinRefs.current.set(m.id, el);
                else pinRefs.current.delete(m.id);
              }}
              style={{ visibility: "hidden" }}
              onClick={() => openMarker(m)}
              onMouseEnter={() => {
                Sound.hover();
                // A pin is a thing you click, so point at it.
                if (!rot.current.dragging) Cursor.point();
              }}
              onMouseLeave={() => {
                if (!rot.current.dragging) Cursor.open();
              }}
              aria-label={`${m.stories.length} ${
                m.stories.length === 1 ? "story" : "stories"
              } from ${m.label}`}
            >
              <span className="ng-pin-mark" aria-hidden="true">
                {m.stories.length > 1 && <span className="ng-pin-count">{m.stories.length}</span>}
              </span>
              <span className="ng-pin-label">{m.name}</span>
            </button>
          ))}
        </div>

        {!ready && <div className="ng-loading">Spinning up the globe…</div>}
        {/* A refresh where nothing could be placed would otherwise be a bare
            planet with no explanation. */}
        {ready && markers.length === 0 && (
          <div className="ng-loading">
            No story in this refresh named a place we could find. Try Headlines.
          </div>
        )}

        {/* Inside the stage, not the root: as a sibling of the panel it
            would run underneath it. */}
        <div className="ng-hud">
          <span className="ng-hud-stat">
            <strong>{located}</strong> {located === 1 ? "story" : "stories"} in{" "}
            <strong>{markers.length}</strong> {markers.length === 1 ? "place" : "places"}
          </span>
          <span className="ng-hud-hint">Drag to spin · scroll to zoom · click a pin</span>
        </div>
      </div>

      {open && (
        <aside className="ng-panel" aria-label={`Stories from ${open.label}`}>
          <header className="ng-panel-head">
            {story && open.stories.length > 1 ? (
              <button
                className="ng-panel-back"
                onClick={() => {
                  Sound.back();
                  setStoryIndex(null);
                }}
                onMouseEnter={() => Sound.hover()}
              >
                ‹ All {open.stories.length}
              </button>
            ) : (
              <span className="ng-panel-kicker">
                {open.stories.length} {open.stories.length === 1 ? "story" : "stories"}
              </span>
            )}
            <h2 className="ng-panel-place">{open.label}</h2>
            <button
              className="ng-panel-close"
              onClick={close}
              onMouseEnter={() => Sound.hover()}
              aria-label="Close"
            >
              ✕
            </button>
          </header>

          {story ? (
            <StoryPreview story={story} />
          ) : (
            <ul className="ng-list">
              {open.stories.map((s, i) => (
                <li key={s.id}>
                  <button
                    className="ng-list-item"
                    onClick={() => {
                      Sound.page();
                      setStoryIndex(i);
                    }}
                    onMouseEnter={() => Sound.hover()}
                  >
                    <span className="ng-list-rank">{i + 1}</span>
                    <span className="ng-list-body">
                      <span className="ng-list-title">{s.title}</span>
                      <span className="ng-list-meta">
                        {s.source || domainOf(s.url)}
                        {s.publishedAt && ` · ${relativeTime(s.publishedAt)}`}
                      </span>
                    </span>
                    <span className="ng-list-chevron" aria-hidden="true">
                      ›
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
      )}
    </div>
  );
}

/* ------------------------------------------------------------
   Preview — the last stop before the article itself
   ------------------------------------------------------------ */

function StoryPreview({ story }: { story: Story }) {
  // Publishers' images go dead or refuse hotlinking; drop the frame
  // rather than leave a broken one in the panel.
  const [imageOk, setImageOk] = useState(true);
  useEffect(() => setImageOk(true), [story.image]);

  return (
    <div className="ng-preview">
      {story.image && imageOk && (
        <img
          className="ng-preview-img"
          src={story.image}
          alt=""
          draggable={false}
          onError={() => setImageOk(false)}
        />
      )}
      <div className="ng-preview-meta">
        <span className="ng-preview-source">{story.source || domainOf(story.url)}</span>
        {story.publishedAt && (
          <span className="ng-preview-time">{relativeTime(story.publishedAt)}</span>
        )}
      </div>
      <h3 className="ng-preview-title">{story.title}</h3>
      {story.description && <p className="ng-preview-desc">{story.description}</p>}
      <button
        className="ng-preview-read"
        onClick={() => {
          Sound.select();
          window.open(story.url, "_blank", "noopener");
        }}
        onMouseEnter={() => Sound.hover()}
      >
        Read the full story ↗
      </button>
    </div>
  );
}

/* ------------------------------------------------------------ */

function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}

function clampPitch(p: number) {
  return clamp(p, -MAX_PITCH, MAX_PITCH);
}
