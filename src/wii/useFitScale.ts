import { useEffect, useState } from "react";

export interface Fit {
  scale: number;
  x: number;
  y: number;
}

/**
 * The Wii Menu is a fixed-aspect "screen", so rather than reflowing the
 * layout at small sizes we scale the whole stage to fit — the way a TV
 * picture letterboxes. The menu looks identical everywhere, just smaller,
 * and can never clip.
 *
 * Returns a scale plus the top-left offset that centres the scaled stage.
 * The offset is computed rather than left to margin/flex centering: an
 * element larger than its container does not centre reliably (auto margins
 * resolve asymmetrically), which parks the stage off-screen.
 *
 * Apply with `transform-origin: top left` and
 * `transform: translate(Xpx, Ypx) scale(S)`.
 */
export function useFitScale(designW: number, designH: number): Fit {
  const [fit, setFit] = useState<Fit>({ scale: 1, x: 0, y: 0 });

  useEffect(() => {
    const measure = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const scale = Math.min(vw / designW, vh / designH) || 1;
      setFit({
        scale,
        x: (vw - designW * scale) / 2,
        y: (vh - designH * scale) / 2,
      });
    };
    measure();
    window.addEventListener("resize", measure);
    // Catches container resizes that don't fire a window resize (e.g. a
    // preview pane being dragged wider or narrower).
    const ro = new ResizeObserver(measure);
    ro.observe(document.documentElement);
    return () => {
      window.removeEventListener("resize", measure);
      ro.disconnect();
    };
  }, [designW, designH]);

  return fit;
}
