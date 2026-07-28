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
    NewsGlobe.tsx      The spinnable globe view (pins, drill-down panel)
    globe.ts           Its projection maths and pixel renderer — no React
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

## The News Globe

The channel opens on a globe you can grab and spin, with every story pinned
where it happened. Stories from the same place stack onto one pin — click it and
you get the list, then a preview, then the article.

GNews sends no coordinates, so the location is inferred from the words in the
headline. `scripts/geocode.mjs` scans the title and description against
`scripts/gazetteer.json` (177 countries with their demonyms, US states, ~640
world cities) and scores the candidates: a city beats a region, a region beats a
country, and a hit in the headline beats one in the blurb. It runs inside the
same cron job as the fetch, so each story arrives with a `place` already on it
and the browser never sees the place list.

Matching is deliberately conservative — a pin on the wrong continent is worse
than a missing pin. It's case-sensitive (`Mobile` the city vs `mobile` the
phone), and names that read as a person more often than a place are excluded.
About half of stories get pinned; the rest just aren't on the globe.

Pins are DOM elements laid over the canvas and positioned by the animation
loop. Each one is a **zero-sized anchor** with its dot and label hanging off it
absolutely — if the label were part of the layout box, centring the pin on its
coordinate would push the dot west by half the label's width, and the error
would look like bad geography rather than bad CSS.

The sphere is drawn in a plain 2D canvas. A flat world map — coastlines,
country borders, the big lakes, polar ice, graticule — is painted once at
startup from `public/geo/world.json`, and then each frame walks the pixels of
the disc and inverse-projects them back onto that map. That gets correct
occlusion at the horizon for free and lets every pixel be lit, which is what
makes it read as a ball rather than a circle. A horizontal drag costs almost
nothing, because yaw drops out of the expensive part of the projection and
becomes a sideways offset into the texture.

The map is drawn rather than shipped as a finished image: Canvas2D gives
antialiasing and stroking for free, the vectors are ~160KB over the wire
against roughly a megabyte for a PNG the same size, and it comes out sharp at
whatever texture size we ask for. The data is Natural Earth **50m** — 110m has
no borders at all and renders Britain as a blob. Painting takes ~130ms, once,
behind the channel's loading line.

The texture is 3072×1536, which is the whole of what "the globe looks low
resolution" turned out to mean: the globe shows about 9 pixels per degree of
longitude at the centre of the disc, so a 2048-wide map at 5.7 was being
magnified rather than sampled. Going on to 4096 measured no visible difference
and tripled the per-frame cost — the sampler reads the map in a scattered
pattern and lives or dies by the cache, so resolution past what the screen can
show gets paid for entirely in cache misses.

Both data files are generated and committed. Regenerate them from Natural Earth
(public domain) after changing the place tables:

```bash
npm run build:geo      # rebuilds gazetteer.json + world.json
npm run geocode:feed   # re-tags the feed already on disk; add --dry --list
```

`geocode:feed` touches no network, so it's the way to try out gazetteer changes
without spending any of the GNews allowance.

## Notes

- Sound effects and the News Channel music are **original Wii audio**, played
  through the Web Audio API for low-latency overlapping playback. Only the ten
  files the app actually references are committed. They belong to Nintendo and
  are here for a personal, non-commercial recreation — if you fork this, that
  is your call to make. Audio starts after your first click, per browser
  autoplay rules.
- The Forecast channel uses Open-Meteo, a free API that needs no key.
