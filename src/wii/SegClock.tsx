import { useEffect } from "react";
import { useClock } from "./useClock";
import "./SegClock.css";

/**
 * The Wii clock rendered from the real seven-segment digit textures
 * (white glyph masters, tinted to the Wii gray via CSS masks). Digits
 * are cropped to a common cell so the time stays monospace.
 */

const TEX = `${import.meta.env.BASE_URL}textures/`;
const DIGIT_AR = 0.628; // width / height of the trimmed digit cell
const COLON_AR = 0.26;
const AMPM_AR = 1.8;

const GLYPHS = [
  ...Array.from({ length: 10 }, (_, i) => `digit_${i}.png`),
  "clock_colon.png",
  "clock_am.png",
  "clock_pm.png",
];

/**
 * Browsers fetch a mask-image only when it is first used, and an element
 * whose mask has not arrived yet paints as nothing. So the first time a
 * given digit appears — a 0 at the top of the hour, say — it can flash
 * blank. Warming every glyph up front keeps the clock whole.
 */
function usePreloadGlyphs() {
  useEffect(() => {
    const imgs = GLYPHS.map((g) => {
      const im = new Image();
      im.src = `${TEX}${g}`;
      return im;
    });
    return () => {
      // Drop the refs; any in-flight request can be abandoned.
      imgs.forEach((im) => {
        im.src = "";
      });
    };
  }, []);
}

function Seg({ file, ar, cls = "" }: { file: string; ar: number; cls?: string }) {
  const url = `url("${TEX}${file}")`;
  return (
    <span
      className={`seg ${cls}`}
      style={{
        width: `calc(${ar} * 1em)`,
        WebkitMaskImage: url,
        maskImage: url,
      }}
    />
  );
}

export function SegClock() {
  const t = useClock();
  usePreloadGlyphs();
  return (
    <div className="seg-clock">
      {[...t.hh].map((c, i) => (
        <Seg key={`h${i}`} file={`digit_${c}.png`} ar={DIGIT_AR} />
      ))}
      <Seg file="clock_colon.png" ar={COLON_AR} cls={t.colonOn ? "" : "is-off"} />
      {[...t.mm].map((c, i) => (
        <Seg key={`m${i}`} file={`digit_${c}.png`} ar={DIGIT_AR} />
      ))}
      <Seg file={t.ampm === "AM" ? "clock_am.png" : "clock_pm.png"} ar={AMPM_AR} cls="ampm" />
    </div>
  );
}
