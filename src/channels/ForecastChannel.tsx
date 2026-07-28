import { useCallback, useEffect, useRef, useState } from "react";
import type { ChannelAppProps, ChannelIconProps } from "../wii/types";
import { Sound } from "../wii/sound";
import "./ForecastChannel.css";

/* ============================================================
   Forecast Channel
   Real weather via the free, key-less, CORS-friendly Open-Meteo APIs:
     - Geocoding: https://geocoding-api.open-meteo.com/v1/search
     - Forecast:  https://api.open-meteo.com/v1/forecast
   ============================================================ */

// ---------- Types ----------
interface Place {
  name: string;
  lat: number;
  lon: number;
  region?: string;
  country?: string;
}

interface GeoResult {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  admin1?: string;
  country?: string;
  country_code?: string;
}

interface CurrentWeather {
  temp: number; // °C
  code: number;
  wind: number; // km/h
  humidity: number; // %
  isDay: boolean;
}

interface DayForecast {
  date: string;
  code: number;
  max: number; // °C
  min: number; // °C
}

interface Forecast {
  current: CurrentWeather;
  days: DayForecast[];
}

const DEFAULT_PLACE: Place = {
  name: "Milwaukee",
  lat: 43.0389,
  lon: -87.9065,
  region: "Wisconsin",
  country: "United States",
};

// ---------- WMO weather-code interpretation ----------
type IconKind = "clear" | "partly" | "cloudy" | "fog" | "rain" | "snow" | "thunder";

function describe(code: number): { label: string; kind: IconKind } {
  if (code === 0) return { label: "Clear", kind: "clear" };
  if (code === 1) return { label: "Mostly Clear", kind: "partly" };
  if (code === 2) return { label: "Partly Cloudy", kind: "partly" };
  if (code === 3) return { label: "Overcast", kind: "cloudy" };
  if (code === 45 || code === 48) return { label: "Fog", kind: "fog" };
  if (code >= 51 && code <= 57) return { label: "Drizzle", kind: "rain" };
  if (code >= 61 && code <= 67) return { label: "Rain", kind: "rain" };
  if (code >= 71 && code <= 77) return { label: "Snow", kind: "snow" };
  if (code >= 80 && code <= 82) return { label: "Rain Showers", kind: "rain" };
  if (code === 85 || code === 86) return { label: "Snow Showers", kind: "snow" };
  if (code >= 95) return { label: "Thunderstorm", kind: "thunder" };
  return { label: "Cloudy", kind: "cloudy" };
}

// Hero gradient tuned to the current condition (and day/night).
function heroGradient(kind: IconKind, isDay: boolean): string {
  if (!isDay) return "linear-gradient(135deg,#2c3e63,#1b2540)";
  switch (kind) {
    case "clear":
      return "linear-gradient(135deg,#4fc3f7,#1e88d6)";
    case "partly":
      return "linear-gradient(135deg,#6fc9ee,#3a8fce)";
    case "cloudy":
    case "fog":
      return "linear-gradient(135deg,#8fabbd,#5c7d92)";
    case "rain":
      return "linear-gradient(135deg,#5a8bb0,#33627f)";
    case "snow":
      return "linear-gradient(135deg,#9fc4dc,#6d97b4)";
    case "thunder":
      return "linear-gradient(135deg,#5b6a8f,#333c5c)";
  }
}

// ---------- Temperature helpers ----------
type Unit = "C" | "F";

function convert(celsius: number, unit: Unit): number {
  return unit === "C" ? celsius : celsius * 9 / 5 + 32;
}

function fmtTemp(celsius: number, unit: Unit): number {
  return Math.round(convert(celsius, unit));
}

function weekday(dateStr: string, index: number): string {
  if (index === 0) return "Today";
  // Parse as local midnight so the weekday matches the location's calendar day.
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString(undefined, { weekday: "short" });
}

// ============================================================
//  Animated weather icon
// ============================================================
function WeatherIcon({ kind, size = 64, isDay = true }: { kind: IconKind; size?: number; isDay?: boolean }) {
  const s = size;
  const sun = (cx: number, cy: number, r: number, rayColor = "#ffe14d") => (
    <g>
      <g className="wi-sun-rays">
        {Array.from({ length: 8 }).map((_, i) => {
          const a = (i * Math.PI) / 4;
          return (
            <line
              key={i}
              x1={cx + Math.cos(a) * (r + 5)}
              y1={cy + Math.sin(a) * (r + 5)}
              x2={cx + Math.cos(a) * (r + 12)}
              y2={cy + Math.sin(a) * (r + 12)}
              stroke={rayColor}
              strokeWidth={3}
              strokeLinecap="round"
            />
          );
        })}
      </g>
      <circle cx={cx} cy={cy} r={r} fill="url(#wi-sun)" />
    </g>
  );

  const moon = (cx: number, cy: number, r: number) => (
    <path
      d={`M${cx - r} ${cy} a${r} ${r} 0 1 0 ${r * 1.5} ${-r} a${r * 0.85} ${r * 0.85} 0 1 1 ${-r * 1.5} ${r}`}
      fill="#f4f1c8"
    />
  );

  const cloud = (x: number, y: number, scale: number, fill: string, cls = "wi-cloud") => (
    <g className={cls} transform={`translate(${x} ${y}) scale(${scale})`}>
      <path
        d="M4 22 a13 13 0 0 1 25 -4 a10 10 0 0 1 3 20 H8 a11 11 0 0 1 -4 -16 Z"
        fill={fill}
        stroke="rgba(0,0,0,0.05)"
        strokeWidth="0.5"
      />
    </g>
  );

  return (
    <svg width={s} height={s} viewBox="0 0 100 100" className="hero-icon-svg">
      <defs>
        <radialGradient id="wi-sun" cx="40%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#fff6c4" />
          <stop offset="55%" stopColor="#ffe14d" />
          <stop offset="100%" stopColor="#ffbf3c" />
        </radialGradient>
        <linearGradient id="wi-cloud" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#e6eef3" />
        </linearGradient>
        <linearGradient id="wi-cloud-dark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#e3e9ed" />
          <stop offset="100%" stopColor="#b9c6cf" />
        </linearGradient>
      </defs>

      {kind === "clear" && (isDay ? sun(50, 50, 24) : moon(52, 48, 22))}

      {kind === "partly" && (
        <>
          {isDay ? sun(38, 36, 17) : moon(38, 34, 15)}
          {cloud(28, 44, 1.7, "url(#wi-cloud)")}
        </>
      )}

      {kind === "cloudy" && (
        <>
          {cloud(14, 30, 1.4, "url(#wi-cloud-dark)", "wi-cloud slow")}
          {cloud(30, 44, 1.9, "url(#wi-cloud)")}
        </>
      )}

      {kind === "fog" && (
        <>
          {cloud(24, 30, 1.9, "url(#wi-cloud)")}
          {[62, 72, 82].map((y, i) => (
            <line
              key={i}
              className="wi-cloud"
              x1={18}
              y1={y}
              x2={82}
              y2={y}
              stroke="#cdd8de"
              strokeWidth="5"
              strokeLinecap="round"
              style={{ animationDelay: `${i * 0.4}s` }}
            />
          ))}
        </>
      )}

      {kind === "rain" && (
        <>
          {cloud(22, 24, 2, "url(#wi-cloud-dark)")}
          {[30, 46, 62, 78].map((x, i) => (
            <line
              key={i}
              className="wi-drop"
              x1={x}
              y1={62}
              x2={x - 4}
              y2={72}
              stroke="#5db4ec"
              strokeWidth="3.5"
              strokeLinecap="round"
              style={{ animationDelay: `${i * 0.22}s` }}
            />
          ))}
        </>
      )}

      {kind === "snow" && (
        <>
          {cloud(22, 24, 2, "url(#wi-cloud)")}
          {[30, 48, 66, 80].map((x, i) => (
            <text
              key={i}
              className="wi-flake"
              x={x}
              y={70}
              fontSize="14"
              fill="#eaf6ff"
              textAnchor="middle"
              style={{ animationDelay: `${i * 0.5}s` }}
            >
              ❄
            </text>
          ))}
        </>
      )}

      {kind === "thunder" && (
        <>
          {cloud(22, 22, 2, "url(#wi-cloud-dark)")}
          <path className="wi-bolt" d="M52 56 L44 74 L52 74 L46 92 L64 68 L55 68 L62 56 Z" fill="#ffd54a" stroke="#f0a800" strokeWidth="1" />
        </>
      )}
    </svg>
  );
}

// A small decorative rotating globe (the classic Forecast Channel motif).
function Globe() {
  return (
    <svg className="forecast-globe" viewBox="0 0 120 120" aria-hidden="true">
      <circle cx="60" cy="60" r="46" fill="#eaf6ff" />
      <g className="globe-spin" stroke="#ffffff" strokeWidth="2" fill="none">
        <ellipse cx="60" cy="60" rx="46" ry="46" />
        <ellipse cx="60" cy="60" rx="24" ry="46" />
        <ellipse cx="60" cy="60" rx="10" ry="46" />
        <line x1="14" y1="60" x2="106" y2="60" />
        <line x1="20" y1="38" x2="100" y2="38" />
        <line x1="20" y1="82" x2="100" y2="82" />
      </g>
    </svg>
  );
}

// ============================================================
//  API
// ============================================================
async function geocode(query: string): Promise<GeoResult[]> {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=5`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Geocoding failed");
  const data = await res.json();
  return (data.results ?? []) as GeoResult[];
}

// Open-Meteo's geocoder only searches forward (name → coords), so precise
// coordinates are named via BigDataCloud's free, key-less reverse endpoint,
// which is built for browser use. Returns null when it can't name the spot.
async function reverseGeocode(lat: number, lon: number): Promise<Partial<Place> | null> {
  const url =
    `https://api.bigdatacloud.net/data/reverse-geocode-client` +
    `?latitude=${lat}&longitude=${lon}&localityLanguage=en`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error("Reverse geocoding failed");
  const d = await res.json();
  const name: string = d.city || d.locality || d.principalSubdivision || "";
  if (!name) return null;
  const region: string = d.principalSubdivision || "";
  // BigDataCloud returns ISO 3166 official names, which trail a definite
  // article: "United States of America (the)".
  const country: string = (d.countryName || "").replace(/\s*\(the\)$/i, "");
  return {
    name,
    // Skip the region when it just repeats the city (Berlin, Berlin).
    region: region && region !== name ? region : undefined,
    country: country || undefined,
  };
}

async function fetchForecast(lat: number, lon: number): Promise<Forecast> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m,is_day` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min` +
    `&timezone=auto&forecast_days=7`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Forecast request failed");
  const d = await res.json();
  const current: CurrentWeather = {
    temp: d.current.temperature_2m,
    code: d.current.weather_code,
    wind: d.current.wind_speed_10m,
    humidity: d.current.relative_humidity_2m,
    isDay: d.current.is_day === 1,
  };
  const days: DayForecast[] = (d.daily.time as string[]).map((t, i) => ({
    date: t,
    code: d.daily.weather_code[i],
    max: d.daily.temperature_2m_max[i],
    min: d.daily.temperature_2m_min[i],
  }));
  return { current, days };
}

// ============================================================
//  Icon (grid tile face) — refined sun + cloud on a blue gradient
// ============================================================
const PLACE_KEY = "wii-forecast-place";

function savePlace(p: Place) {
  try {
    localStorage.setItem(PLACE_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

// A live weather widget for the grid tile: current condition icon + temp.
// It reuses whatever location the full app last resolved (saved to
// localStorage) so it never triggers its own location prompt on menu load.
export function ForecastIcon({ active }: ChannelIconProps) {
  const [cur, setCur] = useState<CurrentWeather | null>(null);
  const [name, setName] = useState("");

  useEffect(() => {
    let live = true;
    const run = (p: Place) => {
      if (!live) return;
      setName(p.name);
      fetchForecast(p.lat, p.lon)
        .then((f) => live && setCur(f.current))
        .catch(() => {});
    };

    // Show the temperature straight away, then refine "My Location" into a real
    // city name once the reverse lookup lands.
    const runGeolocated = (pos: GeolocationPosition) => {
      const lat = +pos.coords.latitude.toFixed(4);
      const lon = +pos.coords.longitude.toFixed(4);
      run({ name: "My Location", lat, lon });
      reverseGeocode(lat, lon)
        .then((n) => live && n?.name && setName(n.name))
        .catch(() => {});
    };

    let saved: Place | null = null;
    try {
      const s = localStorage.getItem(PLACE_KEY);
      if (s) saved = JSON.parse(s);
    } catch {
      /* ignore */
    }

    if (saved) {
      run(saved);
    } else if (navigator.permissions?.query) {
      // Only use precise location if the user already granted it — no prompt.
      navigator.permissions
        .query({ name: "geolocation" as PermissionName })
        .then((res) => {
          if (res.state === "granted" && navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(runGeolocated, () => run(DEFAULT_PLACE));
          } else {
            run(DEFAULT_PLACE);
          }
        })
        .catch(() => run(DEFAULT_PLACE));
    } else {
      run(DEFAULT_PLACE);
    }
    return () => {
      live = false;
    };
  }, []);

  const kind = cur ? describe(cur.code).kind : "clear";
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        gap: "2%",
        background: "linear-gradient(to bottom,#4fc3f7,#2f7fc4)",
        transition: "transform 0.3s var(--wii-ease)",
        transform: active ? "scale(1.06)" : "scale(1)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "6%" }}>
        <WeatherIcon kind={kind} size={52} isDay={cur?.isDay ?? true} />
        <span
          style={{
            color: "#fff",
            fontWeight: 800,
            fontSize: "clamp(16px,2.6vw,30px)",
            textShadow: "0 1px 2px rgba(0,40,70,0.45)",
          }}
        >
          {cur ? `${fmtTemp(cur.temp, "F")}°` : "…"}
        </span>
      </div>
      {name && (
        <span
          style={{
            maxWidth: "90%",
            color: "rgba(255,255,255,0.95)",
            fontWeight: 700,
            fontSize: "clamp(9px,1.15vw,14px)",
            letterSpacing: "0.02em",
            textShadow: "0 1px 2px rgba(0,40,70,0.45)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {name}
        </span>
      )}
    </div>
  );
}

// ============================================================
//  App (full-screen experience)
// ============================================================
export function ForecastApp({ onExit }: ChannelAppProps) {
  const [unit, setUnit] = useState<Unit>("F");
  const [place, setPlace] = useState<Place | null>(null);
  const [data, setData] = useState<Forecast | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");

  // Search UI
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeoResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const debounce = useRef<number | undefined>(undefined);
  const searchBox = useRef<HTMLDivElement | null>(null);
  // Mirrors `place` so the async reverse lookup can tell whether the user has
  // since picked a different city.
  const placeRef = useRef<Place | null>(null);

  // Load a place's forecast.
  const load = useCallback(async (p: Place) => {
    setStatus("loading");
    setPlace(p);
    placeRef.current = p;
    savePlace(p); // share with the grid widget
    try {
      const f = await fetchForecast(p.lat, p.lon);
      setData(f);
      setStatus("ready");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Something went wrong");
      setStatus("error");
    }
  }, []);

  // On mount: try geolocation, fall back to a default city.
  useEffect(() => {
    let cancelled = false;
    const fallback = () => {
      if (!cancelled) load(DEFAULT_PLACE);
    };
    if (typeof navigator !== "undefined" && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (cancelled) return;
          const lat = +pos.coords.latitude.toFixed(4);
          const lon = +pos.coords.longitude.toFixed(4);
          // Don't hold the forecast hostage to the name lookup — start loading
          // now and fill in the city once it resolves.
          load({ name: "My Location", lat, lon });
          reverseGeocode(lat, lon)
            .then((n) => {
              const cur = placeRef.current;
              if (cancelled || !n?.name || cur?.lat !== lat || cur?.lon !== lon) return;
              const named: Place = { ...cur, ...n, name: n.name };
              setPlace(named);
              placeRef.current = named;
              savePlace(named);
            })
            .catch(() => {});
        },
        fallback,
        { timeout: 8000, maximumAge: 600000 }
      );
    } else {
      fallback();
    }
    return () => {
      cancelled = true;
    };
  }, [load]);

  // Debounced geocoding as the user types.
  useEffect(() => {
    if (debounce.current) window.clearTimeout(debounce.current);
    const q = query.trim();
    if (q.length < 2) {
      setResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    debounce.current = window.setTimeout(async () => {
      try {
        const r = await geocode(q);
        setResults(r);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => {
      if (debounce.current) window.clearTimeout(debounce.current);
    };
  }, [query]);

  // Close the results dropdown on outside click.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (searchBox.current && !searchBox.current.contains(e.target as Node)) {
        setResults(null);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const pickCity = (r: GeoResult) => {
    Sound.select();
    setQuery("");
    setResults(null);
    load({
      name: r.name,
      lat: r.latitude,
      lon: r.longitude,
      region: r.admin1,
      country: r.country,
    });
  };

  const toggleUnit = (u: Unit) => {
    if (u === unit) return;
    Sound.select();
    setUnit(u);
  };

  const subtitle = place
    ? [place.region, place.country].filter(Boolean).join(", ")
    : "";

  const cond = data ? describe(data.current.code) : null;

  return (
    <div className="forecast-root">
      <div className="forecast-scroll">
        {/* Top bar */}
        <div className="forecast-topbar">
          <div className="forecast-place">
            <div style={{ transform: "translateY(-2px)" }}>
              <MiniGlobe />
            </div>
            <div style={{ minWidth: 0 }}>
              <h1>{place ? place.name : "Forecast"}</h1>
              {subtitle && <div className="sub">{subtitle}</div>}
            </div>
          </div>

          <div className="forecast-spacer" />

          {/* Search */}
          <div className="forecast-search" ref={searchBox}>
            <svg className="glass" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5c7480" strokeWidth="2.4" strokeLinecap="round">
              <circle cx="11" cy="11" r="7" />
              <line x1="16.5" y1="16.5" x2="21" y2="21" />
            </svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => query.trim().length >= 2 && results === null && setQuery(query)}
              placeholder="Search for a city…"
              aria-label="Search for a city"
            />
            {(results !== null || searching) && query.trim().length >= 2 && (
              <div className="forecast-results">
                {searching && <div className="muted">Searching…</div>}
                {!searching && results && results.length === 0 && (
                  <div className="muted">No matches found.</div>
                )}
                {!searching &&
                  results &&
                  results.map((r) => (
                    <button key={r.id} onMouseEnter={() => Sound.hover()} onClick={() => pickCity(r)}>
                      {r.name}
                      {r.admin1 ? `, ${r.admin1}` : ""}
                      {r.country ? ` · ${r.country}` : ""}
                    </button>
                  ))}
              </div>
            )}
          </div>

          {/* Unit toggle */}
          <div className="forecast-unit" role="group" aria-label="Temperature units">
            {(["C", "F"] as Unit[]).map((u) => (
              <button
                key={u}
                className={unit === u ? "on" : ""}
                onMouseEnter={() => Sound.hover()}
                onClick={() => toggleUnit(u)}
              >
                °{u}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        {status === "loading" && (
          <div className="forecast-center">
            <div className="forecast-spinner" />
            <p>Reading the skies{place ? ` over ${place.name}` : ""}…</p>
          </div>
        )}

        {status === "error" && (
          <div className="forecast-center">
            <h2>Couldn't load the forecast</h2>
            <p>{errorMsg || "Please check your connection and try again."}</p>
            <button
              className="forecast-retry"
              onMouseEnter={() => Sound.hover()}
              onClick={() => {
                Sound.select();
                load(place ?? DEFAULT_PLACE);
              }}
            >
              Try again
            </button>
          </div>
        )}

        {status === "ready" && data && cond && (
          <>
            {/* Hero */}
            <div
              className="forecast-hero"
              style={{ background: heroGradient(cond.kind, data.current.isDay) }}
            >
              <div className="hero-icon">
                <WeatherIcon kind={cond.kind} size={132} isDay={data.current.isDay} />
              </div>
              <div className="hero-main">
                <div className="forecast-temp">
                  {fmtTemp(data.current.temp, unit)}
                  <span className="deg">°{unit}</span>
                </div>
                <div className="forecast-cond">{cond.label}</div>
                <div className="forecast-metrics">
                  <div className="forecast-metric">
                    <span aria-hidden="true">💧</span>
                    <span className="label">Humidity</span>
                    {Math.round(data.current.humidity)}%
                  </div>
                  <div className="forecast-metric">
                    <span aria-hidden="true">🌬️</span>
                    <span className="label">Wind</span>
                    {Math.round(data.current.wind)} km/h
                  </div>
                </div>
              </div>
              <Globe />
            </div>

            {/* 7-day */}
            <div className="forecast-section-label">7-Day Forecast</div>
            <div className="forecast-days">
              {data.days.map((day, i) => {
                const dc = describe(day.code);
                return (
                  <div
                    key={day.date}
                    className={"forecast-day wii-gloss" + (i === 0 ? " is-today" : "")}
                    style={{ animationDelay: `${i * 0.05}s` }}
                    onMouseEnter={() => Sound.hover()}
                  >
                    <div className="dow">{weekday(day.date, i)}</div>
                    <WeatherIcon kind={dc.kind} size={46} isDay={true} />
                    <div className="range">
                      <span className="hi">{fmtTemp(day.max, unit)}°</span>
                      <span className="lo">{fmtTemp(day.min, unit)}°</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* Exit affordance (in addition to the shell's back button) */}
        <div style={{ flex: "0 0 auto", display: "flex", justifyContent: "center", paddingTop: 4 }}>
          <button
            className="forecast-retry"
            style={{ background: "linear-gradient(to bottom,#f6fafc,#dfeaf0)", color: "#2f4650" }}
            onMouseEnter={() => Sound.hover()}
            onClick={() => {
              Sound.back();
              onExit();
            }}
          >
            ‹ Back to Menu
          </button>
        </div>
      </div>
    </div>
  );
}

// A tiny inline globe used beside the place name in the top bar.
function MiniGlobe() {
  return (
    <svg width="34" height="34" viewBox="0 0 120 120" aria-hidden="true">
      <defs>
        <radialGradient id="fc-mini-globe" cx="38%" cy="34%" r="70%">
          <stop offset="0%" stopColor="#8fd6f7" />
          <stop offset="100%" stopColor="#2f7fc4" />
        </radialGradient>
      </defs>
      <circle cx="60" cy="60" r="52" fill="url(#fc-mini-globe)" />
      <g style={{ transformOrigin: "60px 60px", animation: "fc-spin 20s linear infinite" }} stroke="rgba(255,255,255,0.7)" strokeWidth="3" fill="none">
        <ellipse cx="60" cy="60" rx="52" ry="52" />
        <ellipse cx="60" cy="60" rx="26" ry="52" />
        <line x1="8" y1="60" x2="112" y2="60" />
      </g>
    </svg>
  );
}
