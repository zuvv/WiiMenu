# WiiMenu

### ▶ [Open the Wii Menu](https://zuvv.github.io/WiiMenu/)

A web recreation of the Nintendo Wii Menu — the glossy channel grid, the curved
bottom bar with the live clock, the Wii-Remote pointer, and sound. Built with
**React + TypeScript + Vite**.

Live at **https://zuvv.github.io/WiiMenu/**, deployed from `main` by GitHub
Actions on every push.

## Run it

```bash
cd WiiMenu
npm install
npm run dev
```

Then open the printed `localhost` URL.

## How it's put together

Everything is data-driven from a **channel registry**, so the menu is easy to extend.

```
src/
  wii/                 The "shell" — the reusable Wii system
    theme.css          Design tokens (colors, gradients, the .wii-gloss surface)
    types.ts           The Channel contract (BuiltinChannel | LaunchChannel)
    channels.ts        THE REGISTRY — what appears on the grid, and where
    WiiMenu.tsx        The desktop: grid + bottom bar + open/close animation
    ChannelGrid.tsx    4×3 grid with page arrows
    Channel.tsx        A single glossy tile (hover wiggle, click-to-open)
    BottomBar.tsx      Wii button, SD slot, live clock/date, mail button
    WiiCursor.tsx      The hand pointer that tilts with your motion
    useClock.ts        Live Wii-format clock
    sound.ts           Synthesized tick / select / boot chime (Web Audio)
  channels/            One file per channel (each self-contained)
    DiscChannel.tsx  MiiChannel.tsx  PhotoChannel.tsx
    ForecastChannel.tsx  NewsChannel.tsx  WiiShopChannel.tsx
```

## Adding your own app to the menu

A channel is either **`builtin`** (renders a React component when opened) or
**`launch`** (opens a URL). To add your own web app, append a `launch` entry to
`src/wii/channels.ts`:

```ts
{
  kind: "launch",
  id: "my-app",
  title: "My App",
  slot: 6,                 // 0-based grid position; 0–11 = page 1, 12+ = page 2
  accent: "#e0559b",
  Icon: MyIcon,            // any component taking { active: boolean }
  url: "https://my-app.example.com",
}
```

That's it — it shows up as a channel and opens your app in a new tab. The
**Wii Shop Channel** is also set up as an in-menu launcher/catalog for your own
apps, so you can grow the collection there too.

## The News Channel's headlines

Headlines are **prebuilt, not fetched live**. A scheduled GitHub Actions job
runs `scripts/fetch-news.mjs` every four hours with a GNews key held in repo
secrets, and commits the result to `public/news/feed.json`. The browser only
ever reads that static file.

This is what makes the channel safe to share:

- **The API key never reaches a browser.** It lives in Actions secrets. (It
  used to be a `VITE_GNEWS_KEY`, which compiled it into the client bundle —
  hence no `VITE_` prefix now.)
- **Visitors are free.** A thousand people opening the channel cost the same
  12 upstream requests as nobody opening it. Six runs a day = 72 of GNews'
  100/day free tier.
- **No Refresh button**, because there is nothing to refresh between cron runs.
  The masthead's "Updated …" stamp reports when the headlines were fetched.

To refresh the feed on your own machine, put a free key from
[gnews.io](https://gnews.io) in `.env` (see `.env.example`) and run:

```bash
npm run fetch:news
```

Setting up a fork: add your key as a repo secret named `GNEWS_KEY` under
**Settings → Secrets and variables → Actions**, then set **Settings → Pages →
Source** to **GitHub Actions**.

## Notes

- Sound effects and the News Channel music are **original Wii audio**, played
  through the Web Audio API for low-latency overlapping playback. Only the ten
  files the app actually references are committed. They belong to Nintendo and
  are here for a personal, non-commercial recreation — if you fork this, that
  is your call to make. Audio starts after your first click, per browser
  autoplay rules.
- The Forecast channel uses Open-Meteo, a free API that needs no key.
