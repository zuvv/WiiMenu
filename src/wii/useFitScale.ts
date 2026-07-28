import { useEffect, useState, type RefObject } from "react";

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
export function useFitScale(
  designW: number,
  designH: number,
  /**
   * Fit inside this element rather than the viewport. Channels fit their
   * overlay's content area, which is the window minus the back-button bar.
   */
  container?: RefObject<HTMLElement | null>
): Fit {
  const [fit, setFit] = useState<Fit>({ scale: 1, x: 0, y: 0 });

  useEffect(() => {
    let raf = 0;
    const measure = () => {
      const box = container?.current;
      const vw = box ? box.clientWidth : window.innerWidth;
      const vh = box ? box.clientHeight : window.innerHeight;
      // A container can measure 0 before layout settles. Retry on the next
      // frame rather than bailing: giving up would strand `fit` at its 1:1
      // default, and a 1280×720 stage anchored top-left inside an
      // overflow:hidden box renders clipped, with anything centred — the
      // globe, most visibly — pushed out of view.
      if (!vw || !vh) {
        raf = requestAnimationFrame(measure);
        return;
      }
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
    ro.observe(container?.current ?? document.documentElement);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", measure);
      ro.disconnect();
    };
  }, [designW, designH, container]);

  return fit;
}
