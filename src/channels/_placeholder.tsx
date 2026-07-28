import type { ChannelAppProps, ChannelIconProps } from "../wii/types";

/**
 * Shared building blocks for channel placeholders.
 * Agents building a real channel should replace the channel's own
 * Icon/App — these helpers just keep the menu looking complete
 * before that work lands.
 */

export function TileIcon({
  bg,
  children,
  active,
}: ChannelIconProps & { bg: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: bg,
        transition: "transform 0.3s cubic-bezier(0.22,1,0.36,1)",
        transform: active ? "scale(1.06)" : "scale(1)",
      }}
    >
      {children}
    </div>
  );
}

export function PlaceholderApp({
  title,
  tint,
}: ChannelAppProps & { title: string; tint: string }) {
  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        background: `linear-gradient(to bottom, #fff, ${tint})`,
        fontFamily: "var(--wii-font)",
        color: "#4a575e",
      }}
    >
      <h1 style={{ margin: 0, fontSize: 34, fontWeight: 700 }}>{title}</h1>
      <p style={{ margin: 0, opacity: 0.7 }}>Coming soon — this channel is under construction.</p>
    </div>
  );
}
