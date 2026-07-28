import { useEffect, useRef, useState } from "react";

/* ============================================================
   News Channel music (the real Wii News Channel tracks in
   /public/music). The "banner" track plays once when the
   channel opens, then the "articles" track loops while you
   browse, and the "slideshow" track takes over for as long as
   the slideshow is running.
   A mute toggle sits in the corner; the choice is remembered.
   ============================================================ */

const MUTE_KEY = "wii-news-music-muted";
const BANNER = "news-banner.mp3"; // 01 — plays on startup
const ARTICLES = "news-articles.mp3"; // 03 — loops while viewing news
const SLIDESHOW = "news-slideshow.mp3"; // 04 — loops during the slideshow

export function NewsMusic({ slideshow = false }: { slideshow?: boolean }) {
  const base = import.meta.env.BASE_URL;
  const [muted, setMuted] = useState<boolean>(() => {
    try {
      return localStorage.getItem(MUTE_KEY) === "1";
    } catch {
      return false;
    }
  });
  // The opening banner is a one-shot; everything after it loops.
  const [intro, setIntro] = useState(true);
  const ref = useRef<HTMLAudioElement>(null);

  // Starting the slideshow retires the intro, so closing it returns to the
  // articles loop rather than replaying the banner.
  useEffect(() => {
    if (slideshow) setIntro(false);
  }, [slideshow]);

  const track = slideshow ? SLIDESHOW : intro ? BANNER : ARTICLES;

  // Play/pause as the track or mute state changes.
  //
  // play() is async: if the channel closes while it is still resolving, the
  // <audio> element is already detached from the DOM and starts playing with
  // nothing left to stop it — music that outlives the channel. So we track
  // whether this effect is still current and pause once it resolves.
  useEffect(() => {
    const a = ref.current;
    if (!a) return;
    let current = true;
    a.volume = 0.4;
    if (muted) {
      a.pause();
    } else {
      a.play()
        .then(() => {
          if (!current) a.pause();
        })
        .catch(() => {/* blocked until a user gesture — fine */});
    }
    return () => {
      current = false;
      a.pause();
    };
  }, [track, muted]);

  useEffect(() => {
    try {
      localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [muted]);

  return (
    <>
      <audio
        ref={ref}
        src={`${base}music/${track}`}
        loop={track !== BANNER}
        onEnded={() => setIntro(false)}
      />
      <button
        className="news-music-toggle"
        onClick={() => setMuted((m) => !m)}
        aria-label={muted ? "Unmute music" : "Mute music"}
        title={muted ? "Unmute music" : "Mute music"}
      >
        {muted ? "🔇" : "🎵"}
      </button>
    </>
  );
}
