import type { ComponentType } from "react";

/**
 * A single channel on the Wii Menu grid.
 *
 * Two flavors:
 *  - kind: "builtin"  -> renders a React mini-app when opened (Photo, Forecast…)
 *  - kind: "launch"   -> opens an external URL (the "run my own web app" case)
 *
 * To add a channel later, append one entry to `channels.ts`.
 */
export interface ChannelBase {
  /** Stable unique id, used for animation keys and routing. */
  id: string;
  /** Label shown on the channel banner. */
  title: string;
  /** Accent color for the channel's banner/glow. */
  accent?: string;
  /** 0-based grid slot (0..11 on page 0, 12..23 on page 1, …). */
  slot: number;
}

export interface BuiltinChannel extends ChannelBase {
  kind: "builtin";
  /** The face shown in the grid tile (small preview / icon). */
  Icon: ComponentType<ChannelIconProps>;
  /** The full-screen experience shown after the open animation. */
  App: ComponentType<ChannelAppProps>;
}

export interface LaunchChannel extends ChannelBase {
  kind: "launch";
  Icon: ComponentType<ChannelIconProps>;
  /** External URL opened when the channel is entered. */
  url: string;
}

export type Channel = BuiltinChannel | LaunchChannel;

export interface ChannelIconProps {
  /** True while the tile is hovered/focused (for subtle motion). */
  active: boolean;
}

export interface ChannelAppProps {
  /** Call to run the "back to menu" zoom-out animation. */
  onExit: () => void;
}
