import { useEffect, useRef } from "react";
import "./WiiCursor.css";

/**
 * A Wii-Remote-style pointer hand that follows the mouse and
 * tilts based on horizontal velocity (the classic wobble).
 * Renders nothing on touch devices.
 */
export function WiiCursor() {
  const ref = useRef<HTMLDivElement>(null);
  const last = useRef({ x: 0, t: 0, rot: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    function onMove(e: MouseEvent) {
      const now = performance.now();
      const dt = Math.max(1, now - last.current.t);
      const vx = (e.clientX - last.current.x) / dt; // px/ms
      // target tilt: -18°..18° from horizontal speed
      const target = Math.max(-18, Math.min(18, vx * 26));
      // ease toward target for a springy feel
      last.current.rot += (target - last.current.rot) * 0.35;
      last.current.x = e.clientX;
      last.current.t = now;
      el!.style.transform = `translate(${e.clientX}px, ${e.clientY}px) rotate(${last.current.rot}deg)`;
      el!.style.opacity = "1";
    }
    function onLeave() {
      if (el) el.style.opacity = "0";
    }

    window.addEventListener("mousemove", onMove);
    document.addEventListener("mouseleave", onLeave);
    return () => {
      window.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseleave", onLeave);
    };
  }, []);

  return (
    <div ref={ref} className="wii-cursor" aria-hidden>
      {/* Wii-Remote pointer: index finger up, three curled fingers, a rounded
          palm and a wrist band. Drawn as overlapping parts painted twice —
          once black+stroked for the outline, once filled — so the seams
          between parts read as the classic thick creases. */}
      <svg width="44" height="66" viewBox="0 0 128 192">
        <defs>
          <linearGradient
            id="wiiHandFill"
            x1="0"
            y1="11"
            x2="0"
            y2="181"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0.5" stopColor="#ffffff" />
            <stop offset="1" stopColor="#bcdcf7" />
          </linearGradient>
          <filter id="wiiHandShadow" x="-30%" y="-25%" width="170%" height="160%">
            <feDropShadow dx="0" dy="4" stdDeviation="4" floodColor="rgba(0,40,80,0.35)" />
          </filter>
          <g id="wiiHandParts">
            {/* index */}
            <rect x="29.5" y="17" width="22.6" height="100" rx="11.3" />
            {/* curled middle / ring / pinky */}
            <rect x="57.4" y="68" width="14.6" height="49" rx="7.3" />
            <rect x="77.6" y="74" width="16.1" height="44" rx="8" />
            <rect x="99.7" y="80" width="16.3" height="40" rx="8.1" />
            {/* palm */}
            <path
              d="M30 90 H110 C114 90 116 94 116 100
                 V134 C116 148 111 157 102 157
                 H42 C30 157 14 150 13 137
                 V114 C13 102 20 94 30 90 Z"
            />
            {/* wrist */}
            <rect x="40.6" y="150" width="60.6" height="25" rx="9.5" />
          </g>
        </defs>

        <g filter="url(#wiiHandShadow)">
          <use href="#wiiHandParts" fill="#000" stroke="#000" strokeWidth="12" strokeLinejoin="round" />
          <use href="#wiiHandParts" fill="url(#wiiHandFill)" />
          {/* the index finger's inner edge continues across the palm */}
          <path d="M26.5 88 V108" fill="none" stroke="#000" strokeWidth="6" strokeLinecap="round" />
        </g>
      </svg>
    </div>
  );
}
