import { useCallback, useEffect, useState } from "react";
import type { ChannelAppProps, ChannelIconProps } from "../wii/types";
import { TileIcon } from "./_placeholder";
import { PhotoScreensaver } from "./PhotoScreensaver";
import {
  PHOTO_SOURCES,
  loadSelection,
  peekCached,
  saveSelection,
  type SourceId,
  type WebPhoto,
} from "./PhotoSources";
import { Sound } from "../wii/sound";
import "./PhotoChannel.css";

/* ============================================================
   Photo Channel — a screensaver app.

   The home screen is a picker: toggle any mix of the free photo
   sources (see PhotoSources.ts), then start a full-screen
   slideshow. The selection is remembered between visits.

   Cards show a real thumbnail once a source has been fetched
   at least once, so the picker previews what you'd get.
   ============================================================ */

export function PhotoApp(_props: ChannelAppProps) {
  const [selected, setSelected] = useState<SourceId[]>(loadSelection);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    saveSelection(selected);
  }, [selected]);

  /* Cached preview per source. Re-read whenever we come back from a run,
     since that run is what populates the cache in the first place. */
  const [previews, setPreviews] = useState<Partial<Record<SourceId, WebPhoto>>>({});
  useEffect(() => {
    if (running) return;
    const map: Partial<Record<SourceId, WebPhoto>> = {};
    for (const source of PHOTO_SOURCES) {
      const hit = peekCached(source.id);
      if (hit) map[source.id] = hit;
    }
    setPreviews(map);
  }, [running]);

  const toggle = useCallback((id: SourceId) => {
    Sound.select();
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }, []);

  const start = useCallback(() => {
    if (!selected.length) return;
    Sound.enter();
    setRunning(true);
  }, [selected.length]);

  if (running) {
    return <PhotoScreensaver sources={selected} onExit={() => setRunning(false)} />;
  }

  return (
    <div className="photo-app">
      <header className="photo-header">
        <span className="photo-header__mark" aria-hidden>
          <svg width="26" height="26" viewBox="0 0 100 80">
            <rect x="6" y="12" width="88" height="60" rx="7" fill="#fff" stroke="#e0a94e" strokeWidth="3" />
            <circle cx="70" cy="30" r="9" fill="#ffd76a" />
            <path d="M10 66 L38 38 L56 56 L72 44 L90 66 Z" fill="#7cc06a" />
          </svg>
        </span>
        <div>
          <h1 className="photo-title">Photo Channel</h1>
          <p className="photo-subtitle">
            {selected.length
              ? `${selected.length} of ${PHOTO_SOURCES.length} sources on`
              : "Pick at least one source"}
          </p>
        </div>
        <div className="photo-header__spacer" />
        <button
          className="photo-btn"
          disabled={!selected.length}
          onMouseEnter={() => selected.length && Sound.hover()}
          onClick={start}
        >
          <span aria-hidden>✦</span> Start Screensaver
        </button>
      </header>

      <div className="photo-body">
        <p className="photo-lead">
          Choose which collections to show. Everything here is free, needs no account, and is
          credited on screen while it plays.
        </p>

        <div className="photo-sources">
          {PHOTO_SOURCES.map((source) => {
            const on = selected.includes(source.id);
            const preview = previews[source.id];
            return (
              <button
                key={source.id}
                className={`photo-source${on ? " is-on" : ""}`}
                style={{ ["--tint" as string]: source.tint }}
                onMouseEnter={() => Sound.hover()}
                onClick={() => toggle(source.id)}
                aria-pressed={on}
              >
                <span className="photo-source__thumb">
                  {preview ? (
                    <img src={preview.src} alt="" draggable={false} />
                  ) : (
                    <span className="photo-source__thumb-empty" aria-hidden>
                      ✦
                    </span>
                  )}
                </span>
                <span className="photo-source__text">
                  <span className="photo-source__label">{source.label}</span>
                  <span className="photo-source__blurb">{source.blurb}</span>
                </span>
                <span className="photo-source__check" aria-hidden>
                  {on ? "✓" : ""}
                </span>
              </button>
            );
          })}
        </div>

        <p className="photo-hint">
          While it plays: <strong>←</strong> / <strong>→</strong> to skip, <strong>Space</strong> to
          pause, <strong>Esc</strong> or a click to exit.
        </p>
      </div>
    </div>
  );
}

export function PhotoIcon(props: ChannelIconProps) {
  return (
    <TileIcon {...props} bg="linear-gradient(135deg,#ffe9a8,#ffc06b)">
      <img
        src={`${import.meta.env.BASE_URL}textures/channels/photo_sample.png`}
        alt=""
        draggable={false}
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
    </TileIcon>
  );
}
