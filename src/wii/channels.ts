import type { Channel } from "./types";
import { PhotoIcon, PhotoApp } from "../channels/PhotoChannel";
import { ForecastIcon, ForecastApp } from "../channels/ForecastChannel";
import { NewsIcon, NewsApp } from "../channels/NewsChannel";
import { WiiShopIcon, WiiShopApp } from "../channels/WiiShopChannel";

/**
 * The channel registry — the single place that defines what's on the
 * menu and in what order.
 *
 * To add YOUR OWN web app later, append a "launch" entry:
 *   {
 *     kind: "launch",
 *     id: "my-app",
 *     title: "My App",
 *     slot: 4,
 *     accent: "#e0559b",
 *     Icon: MyIcon,       // any component (ChannelIconProps)
 *     url: "https://my-app.example.com",
 *   }
 * `slot` is the 0-based grid position (0..11 = page 1, 12.. = page 2).
 */
export const channels: Channel[] = [
  { kind: "builtin", id: "photo", title: "Photo Channel", slot: 0, accent: "#f3b95a", Icon: PhotoIcon, App: PhotoApp },
  { kind: "builtin", id: "forecast", title: "Forecast Channel", slot: 1, accent: "#2f7fc4", Icon: ForecastIcon, App: ForecastApp },
  { kind: "builtin", id: "news", title: "News Channel", slot: 2, accent: "#2c8b39", Icon: NewsIcon, App: NewsApp },
  { kind: "builtin", id: "shop", title: "Wii Shop Channel", slot: 3, accent: "#35b4e5", Icon: WiiShopIcon, App: WiiShopApp },
];
