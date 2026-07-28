import { useMemo, useState } from "react";
import type { ChannelAppProps, ChannelIconProps } from "../wii/types";
import { TileIcon } from "./_placeholder";
import { Sound } from "../wii/sound";
import "./WiiShopChannel.css";

/* ============================================================
   Wii Shop Channel — a launcher for your own web apps.

   Each ShopItem shows up as a glossy storefront card. Pressing
   "Launch" (or the card) opens `url` in a new browser tab.

   >>> TO ADD YOUR OWN APP: append one entry to SHOP_ITEMS below. <<<
   That's the only change needed — the storefront, search, and
   layout all pick it up automatically.
   ============================================================ */

interface ShopItem {
  /** Stable unique id (used as the React key). */
  id: string;
  /** Card title. */
  title: string;
  /** One-line description shown under the title. */
  blurb: string;
  /** Opened in a new tab when the card / Launch button is pressed. */
  url: string;
  /** Optional accent color for the card's thumbnail (defaults to Wii blue). */
  accent?: string;
  /** Optional emoji shown in the thumbnail. */
  emoji?: string;
}

const SHOP_ITEMS: ShopItem[] = [
  {
    id: "example",
    title: "Example App",
    blurb: "A blank-slate starter — swap this for your first real web app.",
    url: "https://example.com",
    accent: "#35b4e5",
    emoji: "🧩",
  },
  {
    id: "notepad",
    title: "Quick Notes",
    blurb: "Jot ideas fast with this lightweight browser scratchpad.",
    url: "https://example.com",
    accent: "#6bbf3a",
    emoji: "📝",
  },
  {
    id: "weather",
    title: "Forecast",
    blurb: "Check the skies before you head out for the day.",
    url: "https://example.com",
    accent: "#4fb0e5",
    emoji: "⛅",
  },
  {
    id: "arcade",
    title: "Mini Arcade",
    blurb: "A pocketful of quick browser games for coffee breaks.",
    url: "https://example.com",
    accent: "#e56aa8",
    emoji: "🎮",
  },
  {
    id: "radio",
    title: "Web Radio",
    blurb: "Streaming stations and lo-fi beats to work along to.",
    url: "https://example.com",
    accent: "#f0a63a",
    emoji: "📻",
  },
  {
    id: "gallery",
    title: "Photo Gallery",
    blurb: "Browse a tidy grid of your favorite snapshots.",
    url: "https://example.com",
    accent: "#8a6be0",
    emoji: "🖼️",
  },
];

/** Small shopping-bag "Wii" tile face shown in the menu grid. */
export function WiiShopIcon(props: ChannelIconProps) {
  return (
    <TileIcon {...props} bg="linear-gradient(to bottom,#35b4e5,#1e8fc4)">
      <img
        src={`${import.meta.env.BASE_URL}textures/channels/shop_bags.png`}
        alt=""
        draggable={false}
        style={{ width: "70%", height: "70%", objectFit: "contain" }}
      />
    </TileIcon>
  );
}

/** Full-screen glossy storefront / app launcher. */
export function WiiShopApp(_props: ChannelAppProps) {
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SHOP_ITEMS;
    return SHOP_ITEMS.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        item.blurb.toLowerCase().includes(q)
    );
  }, [query]);

  function launch(item: ShopItem) {
    Sound.select();
    window.open(item.url, "_blank", "noopener");
  }

  return (
    <div className="wiishop">
      {/* --- Storefront chrome: logo, search, points --- */}
      <div className="wiishop-bar">
        <div className="wiishop-logo">
          <svg width="34" height="32" viewBox="0 0 100 90" aria-hidden="true">
            <path d="M22 30 H78 L72 82 H28 Z" fill="#fff" stroke="#0b6a9c" strokeWidth="2" />
            <path d="M36 34 V24 a14 14 0 0 1 28 0 V34" fill="none" stroke="#0b6a9c" strokeWidth="5" />
          </svg>
          <div className="wiishop-wordmark">
            <b>Wii Shop Channel</b>
            <span>App Launcher</span>
          </div>
        </div>

        <label className="wiishop-search">
          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeWidth="2.5" />
            <line x1="15" y1="15" x2="21" y2="21" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search apps…"
            aria-label="Search apps"
          />
        </label>

        <div className="wiishop-points" title="Just for flavor — no real currency here!">
          <b>10,000</b>
          <span>Wii Points</span>
        </div>
      </div>

      {/* --- Shelf of apps --- */}
      <div className="wiishop-body">
        <div className="wiishop-heading">
          <h2>Featured</h2>
          <small>
            {results.length} {results.length === 1 ? "app" : "apps"}
          </small>
        </div>

        {results.length === 0 ? (
          <div className="wiishop-empty">
            <b>No apps found</b>
            Try a different search — or add one to SHOP_ITEMS.
          </div>
        ) : (
          <div className="wiishop-grid">
            {results.map((item) => (
              <div
                key={item.id}
                className="wiishop-card"
                role="button"
                tabIndex={0}
                style={{ ["--accent" as string]: item.accent ?? "var(--wii-blue)" }}
                onMouseEnter={() => Sound.hover()}
                onClick={() => launch(item)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    launch(item);
                  }
                }}
              >
                <div className="wiishop-thumb">
                  <span>{item.emoji ?? "🌐"}</span>
                </div>
                <div className="wiishop-cardbody">
                  <h3>{item.title}</h3>
                  <p>{item.blurb}</p>
                  <button
                    type="button"
                    className="wiishop-launch"
                    onClick={(e) => {
                      e.stopPropagation();
                      launch(item);
                    }}
                  >
                    Launch ›
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
