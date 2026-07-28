import { useClock } from "./useClock";
import { SegClock } from "./SegClock";
import "./BottomBar.css";

// The signature Wii bar silhouette: low at the corners, S-curving up to a
// raised center that holds the clock. Traced by the light-blue piping.
const BAR_TOP = "M0,60 L118,60 C210,60 222,15 312,15 L688,15 C778,15 790,60 882,60 L1000,60";
const BAR_FILL = `${BAR_TOP} L1000,120 L0,120 Z`;

export function BottomBar() {
  const t = useClock();

  return (
    <footer className="wii-bar">
      <svg className="wii-bar__bg" viewBox="0 0 1000 120" preserveAspectRatio="none" aria-hidden>
        <defs>
          <linearGradient id="barFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="55%" stopColor="#f4f8fa" />
            <stop offset="100%" stopColor="#e4edf1" />
          </linearGradient>
        </defs>
        <path d={BAR_FILL} fill="url(#barFill)" />
        {/* soft white inner highlight just under the edge */}
        <path d={BAR_TOP} fill="none" stroke="#ffffff" strokeWidth="5" vectorEffect="non-scaling-stroke" opacity="0.9" />
        {/* the light-blue piping */}
        <path d={BAR_TOP} fill="none" stroke="#78c8ec" strokeWidth="3" vectorEffect="non-scaling-stroke" />
      </svg>

      <div className="wii-bar__content">
        <div className="wii-bar__clock">
          <SegClock />
          <div className="wii-date">{t.date}</div>
        </div>
      </div>
    </footer>
  );
}
