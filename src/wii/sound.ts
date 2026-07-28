/* ============================================================
   Wii Menu — Sound engine

   Plays the real Wii sound effects (in /public/sounds) via the
   Web Audio API for low-latency, overlapping playback. If a file
   is missing or fails to decode, we fall back to a synthesized
   blip so the UI is never silent.

   ------------------------------------------------------------
   >>> REMAPPING SOUNDS <<<
   Every role below points at one file in /public/sounds. Roles
   confirmed by the user against the real Wii:
     boot   = WII-START.wav          (page load)
     hover  = HomeButton_0004.wav    (pointing at something)
     select = WSD-SELECT.wav         (clicking something)
     enter  = Sample_0000.wav        (going INTO a channel)
     back   = Sample_0001.wav        (coming OUT of a channel)
     board  = BOARD-SELECT.wav       (message board)
     page   = Sample_0006.wav        (grid page turn — still a guess)
   ============================================================ */

type Role = "hover" | "select" | "enter" | "back" | "boot" | "page" | "board";

interface SoundDef {
  file: string;
  gain: number;
}

const SOUND_MAP: Record<Role, SoundDef> = {
  hover: { file: "HomeButton_0004.wav", gain: 0.6 },
  select: { file: "WSD-SELECT.wav", gain: 0.7 },
  enter: { file: "Sample_0000.wav", gain: 0.8 },
  back: { file: "Sample_0001.wav", gain: 0.8 },
  boot: { file: "WII-START.wav", gain: 0.8 },
  page: { file: "Sample_0006.wav", gain: 0.6 },
  board: { file: "BOARD-SELECT.wav", gain: 0.7 },
};

// Synthesized fallbacks (used only if the real file can't load).
const SYNTH_FALLBACK: Record<Role, () => void> = {
  hover: () => blip({ freq: 880, dur: 0.05, type: "triangle", gain: 0.05 }),
  select: () => blip({ freq: 660, dur: 0.06, type: "square", gain: 0.07 }),
  enter: () => {
    blip({ freq: 523, dur: 0.09, type: "square", gain: 0.09 });
    blip({ freq: 784, dur: 0.12, type: "square", gain: 0.08, delay: 0.06 });
  },
  back: () => {
    blip({ freq: 440, dur: 0.1, type: "square", gain: 0.08 });
    blip({ freq: 294, dur: 0.14, type: "square", gain: 0.07, delay: 0.06 });
  },
  boot: () => [392, 523, 659, 784].forEach((f, i) => blip({ freq: f, dur: 0.5, gain: 0.09, delay: i * 0.12 })),
  page: () => blip({ freq: 660, dur: 0.16, type: "sine", gain: 0.06, slideTo: 990 }),
  board: () => blip({ freq: 587, dur: 0.12, type: "square", gain: 0.08 }),
};

const base = import.meta.env.BASE_URL || "/";
const buffers = new Map<Role, AudioBuffer>();
let ctx: AudioContext | null = null;
let enabled = true;
let master = 0.9;
let booted = false; // the boot jingle only ever plays once

function ac(): AudioContext | null {
  if (!enabled) return null;
  if (!ctx) {
    try {
      ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      preloadAll();
    } catch {
      enabled = false;
      return null;
    }
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

async function loadRole(role: Role): Promise<void> {
  const c = ctx;
  if (!c || buffers.has(role)) return;
  try {
    const res = await fetch(`${base}sounds/${SOUND_MAP[role].file}`);
    if (!res.ok) return;
    const buf = await c.decodeAudioData(await res.arrayBuffer());
    buffers.set(role, buf);
  } catch {
    /* leave unmapped → synth fallback will cover this role */
  }
}

function preloadAll() {
  (Object.keys(SOUND_MAP) as Role[]).forEach((r) => void loadRole(r));
}

/** Tiny oscillator blip for the synthesized fallback path. */
function blip({
  freq,
  dur,
  type = "sine",
  gain = 0.1,
  slideTo,
  delay = 0,
}: {
  freq: number;
  dur: number;
  type?: OscillatorType;
  gain?: number;
  slideTo?: number;
  delay?: number;
}) {
  const c = ac();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain * master, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function play(role: Role) {
  const c = ac();
  if (!c) return;
  const buf = buffers.get(role);
  if (!buf) {
    // Not loaded yet (or failed) — cover this hit with the synth, and
    // kick off a load so subsequent hits use the real sample.
    SYNTH_FALLBACK[role]();
    void loadRole(role);
    return;
  }
  const src = c.createBufferSource();
  const g = c.createGain();
  g.gain.value = SOUND_MAP[role].gain * master;
  src.buffer = buf;
  src.connect(g).connect(c.destination);
  src.start();
}

export const Sound = {
  setEnabled(v: boolean) {
    enabled = v;
  },
  get enabled() {
    return enabled;
  },
  setVolume(v: number) {
    master = Math.max(0, Math.min(1, v));
  },
  /** Soft tick as the pointer crosses a channel. */
  hover: () => play("hover"),
  /** Click on something (buttons, controls). */
  select: () => play("select"),
  /** Going INTO a channel / menu item. */
  enter: () => play("enter"),
  /** Coming back OUT to the menu. */
  back: () => play("back"),
  /** The warm chime when the menu first loads (plays at most once). */
  boot: () => {
    if (booted) return;
    booted = true;
    play("boot");
  },
  /** Mark the jingle as "already played" without playing it (e.g. the
   *  user's very first action was to open a channel — no jingle then). */
  suppressBoot: () => {
    booted = true;
  },
  /** Swish when flipping grid pages. */
  page: () => play("page"),
  /** Message-board select. */
  board: () => play("board"),
};
