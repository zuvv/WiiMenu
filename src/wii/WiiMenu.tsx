import { useEffect, useRef, useState } from "react";
import type { Channel as ChannelDef } from "./types";
import { channels } from "./channels";
import { ChannelGrid } from "./ChannelGrid";
import { BottomBar } from "./BottomBar";
import { WiiCursor } from "./WiiCursor";
import { useFitScale } from "./useFitScale";
import { Sound } from "./sound";
import "./theme.css";
import "./WiiMenu.css";

interface OpenState {
  channel: ChannelDef;
  origin: DOMRect;
}

// The menu is authored at a fixed 16:9 "screen" size and scaled to fit.
const DESIGN_W = 1280;
const DESIGN_H = 720;

export function WiiMenu() {
  const [open, setOpen] = useState<OpenState | null>(null);
  const fit = useFitScale(DESIGN_W, DESIGN_H);

  // Enable the custom cursor + play the boot jingle on the first interaction
  // with the MENU itself. If the user's first action is opening a channel or
  // pressing a control, we skip the jingle (it belongs to the menu appearing,
  // not to entering a channel).
  useEffect(() => {
    document.documentElement.classList.add("wii-has-cursor");
    const NAV = ".wii-tile, .wii-page-arrow, .wii-btn-wii, .wii-btn-mail";
    const onFirst = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && target.closest(NAV)) {
        Sound.suppressBoot(); // first action was navigation → no jingle
      } else {
        Sound.boot();
      }
      window.removeEventListener("pointerdown", onFirst, true);
    };
    window.addEventListener("pointerdown", onFirst, true);
    return () => {
      window.removeEventListener("pointerdown", onFirst, true);
      document.documentElement.classList.remove("wii-has-cursor");
    };
  }, []);

  const handleOpen = (channel: ChannelDef, origin: DOMRect) => {
    if (channel.kind === "launch") {
      window.open(channel.url, "_blank", "noopener");
      return;
    }
    setOpen({ channel, origin });
  };

  const handleExit = () => {
    Sound.back();
    setOpen(null);
  };

  return (
    <div className="wii-root">
      <div
        className="wii-stage"
        style={{
          width: DESIGN_W,
          height: DESIGN_H,
          transform: `translate(${fit.x}px, ${fit.y}px) scale(${fit.scale})`,
        }}
      >
        <main className="wii-desktop">
          <ChannelGrid channels={channels} onOpen={handleOpen} />
          <BottomBar />
        </main>
      </div>

      {open && open.channel.kind === "builtin" && (
        <ChannelOverlay origin={open.origin} onExit={handleExit}>
          <open.channel.App onExit={handleExit} />
        </ChannelOverlay>
      )}

      <WiiCursor />
    </div>
  );
}

function ChannelOverlay({
  origin,
  onExit,
  children,
}: {
  origin: DOMRect;
  onExit: () => void;
  children: React.ReactNode;
}) {
  const [shown, setShown] = useState(false);
  // Channels are authored at the same fixed 16:9 screen as the menu and scaled
  // to fit, rather than reflowing. One continuous scale instead of breakpoints:
  // the layout is identical at every window size, so nothing rewraps or
  // collides on the way down.
  const contentRef = useRef<HTMLDivElement>(null);
  const fit = useFitScale(DESIGN_W, DESIGN_H, contentRef);

  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Zoom out of the tile the user clicked.
  const style = shown
    ? undefined
    : ({
        transformOrigin: `${origin.left + origin.width / 2}px ${origin.top + origin.height / 2}px`,
      } as React.CSSProperties);

  return (
    <div className={`wii-overlay${shown ? " is-shown" : ""}`} style={style}>
      <button className="wii-overlay__back" onClick={onExit}>
        ‹ Wii Menu
      </button>
      <div className="wii-overlay__content" ref={contentRef}>
        <div
          className="wii-overlay__stage"
          style={{
            width: DESIGN_W,
            height: DESIGN_H,
            transform: `translate(${fit.x}px, ${fit.y}px) scale(${fit.scale})`,
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
