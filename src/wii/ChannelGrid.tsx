import { useMemo, useState } from "react";
import type { Channel as ChannelDef } from "./types";
import { Channel } from "./Channel";
import { Sound } from "./sound";
import "./ChannelGrid.css";

const PER_PAGE = 12; // 4 columns × 3 rows

interface Props {
  channels: ChannelDef[];
  onOpen: (c: ChannelDef, rect: DOMRect) => void;
}

export function ChannelGrid({ channels, onOpen }: Props) {
  const [page, setPage] = useState(0);

  const pageCount = Math.max(1, Math.ceil((maxSlot(channels) + 1) / PER_PAGE));

  const slots = useMemo(() => {
    const start = page * PER_PAGE;
    const bySlot = new Map(channels.map((c) => [c.slot, c]));
    return Array.from({ length: PER_PAGE }, (_, i) => bySlot.get(start + i) ?? null);
  }, [channels, page]);

  const go = (dir: -1 | 1) => {
    Sound.page();
    setPage((p) => (p + dir + pageCount) % pageCount);
  };

  // With a single page there is nothing to page to — drop the arrows so the
  // grid gets their width back (matters most in a narrow pane).
  const single = pageCount < 2;

  return (
    <div className="wii-grid-wrap">
      <button
        className={`wii-page-arrow wii-page-arrow--left${single ? " is-hidden" : ""}`}
        onClick={() => go(-1)}
        disabled={single}
        aria-label="Previous page"
      >
        <Chevron dir="left" />
      </button>

      <div className="wii-grid">
        {slots.map((c, i) => (
          <Channel key={c?.id ?? `empty-${page}-${i}`} channel={c} onOpen={onOpen} />
        ))}
      </div>

      <button
        className={`wii-page-arrow wii-page-arrow--right${single ? " is-hidden" : ""}`}
        onClick={() => go(1)}
        disabled={single}
        aria-label="Next page"
      >
        <Chevron dir="right" />
      </button>
    </div>
  );
}

function maxSlot(channels: ChannelDef[]) {
  return channels.reduce((m, c) => Math.max(m, c.slot), 0);
}

function Chevron({ dir }: { dir: "left" | "right" }) {
  // Real Wii page-arrow texture (from the 4K pack).
  return (
    <img
      src={`${import.meta.env.BASE_URL}textures/arrow_${dir}.png`}
      alt=""
      className="wii-arrow-img"
      draggable={false}
    />
  );
}
