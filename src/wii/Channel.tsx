import { useState } from "react";
import type { Channel as ChannelDef } from "./types";
import { Sound } from "./sound";
import "./Channel.css";

interface Props {
  channel: ChannelDef | null; // null => empty slot
  onOpen: (c: ChannelDef, rect: DOMRect) => void;
}

/**
 * One tile in the 4×3 grid. Empty slots render as flat gray panels.
 * Filled slots show the channel's Icon + a title banner, wiggle on
 * hover, and zoom-open on click.
 */
export function Channel({ channel, onOpen }: Props) {
  const [active, setActive] = useState(false);

  if (!channel) {
    return <div className="wii-tile wii-tile--empty" aria-hidden />;
  }

  const accent = channel.accent ?? "var(--wii-blue)";

  return (
    <button
      className={`wii-tile wii-gloss${active ? " is-active" : ""}`}
      style={{ ["--accent" as any]: accent }}
      onMouseEnter={() => {
        setActive(true);
        Sound.hover();
      }}
      onMouseLeave={() => setActive(false)}
      onClick={(e) => {
        Sound.enter();
        onOpen(channel, e.currentTarget.getBoundingClientRect());
      }}
      aria-label={channel.title}
    >
      <span className="wii-tile__screen">
        <channel.Icon active={active} />
      </span>
      <span className="wii-tile__banner">{channel.title}</span>
    </button>
  );
}
