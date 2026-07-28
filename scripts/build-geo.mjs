#!/usr/bin/env node
/* ============================================================
   Regenerates the two static geo files the News Globe stands on:

     scripts/gazetteer.json   place names -> coordinates, used by
                              scripts/geocode.mjs to pin stories
     public/geo/land.json     world coastlines, drawn as the globe

   Both are committed. This script is NOT part of the news cron —
   run it by hand when the place list needs to change:

     npm run build:geo

   Source is Natural Earth (naturalearthdata.com), public domain.
   Downloading at build time rather than vendoring the raw files
   keeps ~2MB of GeoJSON out of the repo; only the ~90KB of
   distilled output lands in git.
   ============================================================ */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson";

/* ------------------------------------------------------------
   Manual tables

   Everything below is the judgement Natural Earth can't supply:
   what a newsroom actually calls a place. GNews gives us no
   coordinates at all, so the only handle on location is the words
   in the headline — "Israeli strikes", "the U.K.", "Kyiv".
   ------------------------------------------------------------ */

/** Extra names for countries, keyed by Natural Earth's NAME. Includes
    demonyms, because headlines say "Ukrainian forces" far more often
    than they say "Ukraine". */
const COUNTRY_ALIASES = {
  "United States of America": [
    "United States", "the U.S.", "U.S.", "US", "USA", "U.S.A.", "America", "American", "Americans",
  ],
  "United Kingdom": ["Britain", "Great Britain", "the U.K.", "U.K.", "UK", "British", "Briton", "Britons"],
  Russia: ["Russian", "Russians", "Kremlin"],
  Ukraine: ["Ukrainian", "Ukrainians"],
  China: ["Chinese", "Beijing's", "PRC"],
  Japan: ["Japanese"],
  Israel: ["Israeli", "Israelis"],
  Iran: ["Iranian", "Iranians", "Tehran's"],
  India: ["Indian", "Indians"],
  Germany: ["German", "Germans"],
  France: ["French", "Frenchman"],
  Italy: ["Italian", "Italians"],
  Spain: ["Spanish", "Spaniard", "Spaniards"],
  Canada: ["Canadian", "Canadians"],
  Mexico: ["Mexican", "Mexicans"],
  Brazil: ["Brazilian", "Brazilians"],
  Argentina: ["Argentine", "Argentinian", "Argentinians"],
  Australia: ["Australian", "Australians", "Aussie"],
  "New Zealand": ["New Zealander", "Kiwi"],
  "South Korea": ["Korea", "Korean", "Koreans", "Seoul's", "Republic of Korea"],
  "North Korea": ["North Korean", "North Koreans", "Pyongyang's", "DPRK"],
  Turkey: ["Turkish", "Turks", "Türkiye"],
  "Saudi Arabia": ["Saudi", "Saudis"],
  Egypt: ["Egyptian", "Egyptians"],
  Nigeria: ["Nigerian", "Nigerians"],
  "South Africa": ["South African", "South Africans"],
  Kenya: ["Kenyan", "Kenyans"],
  Ethiopia: ["Ethiopian", "Ethiopians"],
  Pakistan: ["Pakistani", "Pakistanis"],
  Afghanistan: ["Afghan", "Afghans", "Taliban"],
  Iraq: ["Iraqi", "Iraqis"],
  Syria: ["Syrian", "Syrians"],
  Lebanon: ["Lebanese", "Hezbollah"],
  Yemen: ["Yemeni", "Yemenis", "Houthi", "Houthis"],
  Poland: ["Polish", "Poles"],
  Sweden: ["Swedish", "Swedes"],
  Norway: ["Norwegian", "Norwegians"],
  Denmark: ["Danish", "Danes"],
  Finland: ["Finnish", "Finns"],
  Netherlands: ["Dutch", "the Netherlands", "Holland"],
  Belgium: ["Belgian", "Belgians"],
  Switzerland: ["Swiss"],
  Austria: ["Austrian", "Austrians"],
  Ireland: ["Irish", "Irishman"],
  Portugal: ["Portuguese"],
  Greece: ["Greek", "Greeks"],
  Hungary: ["Hungarian", "Hungarians"],
  Czechia: ["Czech Republic", "Czech", "Czechs"],
  Romania: ["Romanian", "Romanians"],
  Vietnam: ["Vietnamese"],
  Thailand: ["Thai", "Thais"],
  Indonesia: ["Indonesian", "Indonesians"],
  Philippines: ["the Philippines", "Filipino", "Filipinos"],
  Malaysia: ["Malaysian", "Malaysians"],
  Singapore: ["Singaporean"],
  Bangladesh: ["Bangladeshi", "Bangladeshis"],
  "Sri Lanka": ["Sri Lankan"],
  Colombia: ["Colombian", "Colombians"],
  Venezuela: ["Venezuelan", "Venezuelans"],
  Chile: ["Chilean", "Chileans"],
  Peru: ["Peruvian", "Peruvians"],
  Cuba: ["Cuban", "Cubans"],
  Haiti: ["Haitian", "Haitians"],
  "Dominican Rep.": ["Dominican Republic"],
  "United Arab Emirates": ["UAE", "the U.A.E.", "Emirati"],
  Qatar: ["Qatari"],
  Morocco: ["Moroccan", "Moroccans"],
  Algeria: ["Algerian", "Algerians"],
  Libya: ["Libyan", "Libyans"],
  Sudan: ["Sudanese"],
  "S. Sudan": ["South Sudan", "South Sudanese"],
  "Dem. Rep. Congo": ["Democratic Republic of Congo", "DR Congo", "Congolese"],
  "Central African Rep.": ["Central African Republic"],
  "Bosnia and Herz.": ["Bosnia", "Bosnian", "Bosnians"],
  "Czech Rep.": ["Czech Republic"],
  "Côte d'Ivoire": ["Ivory Coast", "Ivorian"],
  Myanmar: ["Burma", "Burmese"],
  Taiwan: ["Taiwanese", "Taipei's"],
  Cambodia: ["Cambodian", "Cambodians"],
  Nepal: ["Nepali", "Nepalese"],
  Kazakhstan: ["Kazakh"],
  Uzbekistan: ["Uzbek"],
  Belarus: ["Belarusian", "Belarusians"],
  Serbia: ["Serbian", "Serbs"],
  Croatia: ["Croatian", "Croats"],
  Bulgaria: ["Bulgarian", "Bulgarians"],
  Slovakia: ["Slovak", "Slovakian"],
  Ghana: ["Ghanaian"],
  Somalia: ["Somali", "Somalis"],
  Zimbabwe: ["Zimbabwean"],
  Uganda: ["Ugandan"],
  Tanzania: ["Tanzanian"],
  Mozambique: ["Mozambican"],
  Cameroon: ["Cameroonian"],
  Senegal: ["Senegalese"],
  Mali: ["Malian"],
  "Papua New Guinea": ["Papuan"],
  Fiji: ["Fijian"],
  Iceland: ["Icelandic", "Icelander"],
};

/** Countries whose Natural Earth name is a poor headline name. */
const COUNTRY_RENAME = {
  "United States of America": "United States",
  "Dem. Rep. Congo": "DR Congo",
  "Bosnia and Herz.": "Bosnia and Herzegovina",
  "Dominican Rep.": "Dominican Republic",
  "Central African Rep.": "Central African Republic",
  "S. Sudan": "South Sudan",
  "Eq. Guinea": "Equatorial Guinea",
  "Solomon Is.": "Solomon Islands",
  "Czech Rep.": "Czechia",
  "N. Cyprus": "Northern Cyprus",
  "W. Sahara": "Western Sahara",
};

/** Country names too collision-prone to match on their own. Kept in the
    gazetteer for display, but their bare name never triggers a pin —
    only the aliases above do. Matching is case-sensitive, which already
    rules out "turkey" the bird and "guinea pig"; what it can't rule out
    is a capitalized human being. Chad and Jordan are people, and Georgia
    resolves to the US state, which the region entry covers. */
const COUNTRY_NAME_UNSAFE = new Set(["Chad", "Jordan", "Georgia"]);

/** Subnational places that carry a dateline of their own. */
const EXTRA_REGIONS = [
  ["Gaza", 31.42, 34.37, "Palestine", ["Gaza Strip", "Gazan", "Gazans"]],
  ["West Bank", 31.95, 35.3, "Palestine", []],
  ["Hong Kong", 22.32, 114.17, "China", []],
  ["Tibet", 31.0, 88.0, "China", ["Tibetan"]],
  ["Xinjiang", 41.0, 85.0, "China", ["Uyghur", "Uighur"]],
  ["Crimea", 45.3, 34.4, "Ukraine", ["Crimean"]],
  ["Donetsk", 48.0, 37.8, "Ukraine", ["Donbas"]],
  ["Kashmir", 34.08, 74.8, "India", ["Kashmiri"]],
  ["Siberia", 62.0, 95.0, "Russia", ["Siberian"]],
  ["Chechnya", 43.4, 45.7, "Russia", ["Chechen"]],
  ["Scotland", 56.5, -4.2, "United Kingdom", ["Scottish", "Scots"]],
  ["Wales", 52.3, -3.7, "United Kingdom", ["Welsh"]],
  ["Northern Ireland", 54.6, -6.7, "United Kingdom", []],
  ["England", 52.4, -1.5, "United Kingdom", ["English"]],
  ["Catalonia", 41.8, 1.6, "Spain", ["Catalan"]],
  ["Bavaria", 48.8, 11.4, "Germany", ["Bavarian"]],
  ["Sicily", 37.6, 14.0, "Italy", ["Sicilian"]],
  ["Ontario", 50.0, -85.0, "Canada", []],
  ["Quebec", 52.0, -71.0, "Canada", ["Québec"]],
  ["British Columbia", 53.7, -125.0, "Canada", []],
  ["Alberta", 55.0, -115.0, "Canada", []],
  ["New South Wales", -32.0, 147.0, "Australia", []],
  ["Queensland", -22.0, 144.0, "Australia", []],
  ["Puerto Rico", 18.22, -66.43, "United States", ["Puerto Rican"]],
  ["Amazon rainforest", -3.5, -62.2, "Brazil", []],
  ["Antarctica", -82.0, 20.0, "", ["Antarctic"]],
  ["Sahel", 15.0, 5.0, "", []],
  ["Darfur", 13.5, 24.0, "Sudan", []],
  ["Kurdistan", 36.5, 44.0, "Iraq", ["Kurdish", "Kurds"]],
  ["Silicon Valley", 37.39, -122.08, "United States", []],
  ["Wall Street", 40.71, -74.01, "United States", []],
];

/** US states. News says "in Wisconsin" constantly and there is no
    Natural Earth 110m layer for admin-1, so these are literal. */
const US_STATES = [
  ["Alabama", 32.8, -86.8, ["Ala."]],
  ["Alaska", 64.0, -152.0, []],
  ["Arizona", 34.3, -111.7, ["Ariz."]],
  ["Arkansas", 34.9, -92.4, ["Ark."]],
  ["California", 37.2, -119.5, ["Calif."]],
  ["Colorado", 39.0, -105.5, ["Colo."]],
  ["Connecticut", 41.6, -72.7, ["Conn."]],
  ["Delaware", 39.0, -75.5, ["Del."]],
  ["Florida", 28.6, -82.4, ["Fla."]],
  ["Georgia", 32.6, -83.4, ["Ga."]],
  ["Hawaii", 20.3, -156.4, []],
  ["Idaho", 44.4, -114.6, []],
  ["Illinois", 40.0, -89.2, ["Ill."]],
  ["Indiana", 39.9, -86.3, ["Ind."]],
  ["Iowa", 42.1, -93.5, []],
  ["Kansas", 38.5, -98.4, ["Kan."]],
  ["Kentucky", 37.5, -85.3, ["Ky."]],
  ["Louisiana", 31.0, -92.0, ["La."]],
  ["Maine", 45.4, -69.2, []],
  ["Maryland", 39.0, -76.8, ["Md."]],
  ["Massachusetts", 42.3, -71.8, ["Mass."]],
  ["Michigan", 44.3, -85.4, ["Mich."]],
  ["Minnesota", 46.3, -94.3, ["Minn."]],
  ["Mississippi", 32.7, -89.7, ["Miss."]],
  ["Missouri", 38.4, -92.5, []],
  ["Montana", 47.0, -109.6, ["Mont."]],
  ["Nebraska", 41.5, -99.8, ["Neb."]],
  ["Nevada", 39.3, -116.6, ["Nev."]],
  ["New Hampshire", 43.7, -71.6, ["N.H."]],
  ["New Jersey", 40.2, -74.7, ["N.J."]],
  ["New Mexico", 34.4, -106.1, ["N.M."]],
  ["New York State", 43.0, -75.5, ["Upstate New York"]],
  ["North Carolina", 35.5, -79.4, ["N.C."]],
  ["North Dakota", 47.4, -100.5, ["N.D."]],
  ["Ohio", 40.3, -82.8, []],
  ["Oklahoma", 35.6, -97.5, ["Okla."]],
  ["Oregon", 43.9, -120.6, ["Ore."]],
  ["Pennsylvania", 40.9, -77.8, ["Pa."]],
  ["Rhode Island", 41.7, -71.6, ["R.I."]],
  ["South Carolina", 33.9, -80.9, ["S.C."]],
  ["South Dakota", 44.4, -100.2, ["S.D."]],
  ["Tennessee", 35.8, -86.4, ["Tenn."]],
  ["Texas", 31.5, -99.3, ["Tex."]],
  ["Utah", 39.3, -111.7, []],
  ["Vermont", 44.1, -72.7, ["Vt."]],
  ["Virginia", 37.5, -78.8, ["Va."]],
  ["Washington State", 47.4, -120.5, ["Washington state"]],
  ["West Virginia", 38.6, -80.6, ["W.Va."]],
  ["Wisconsin", 44.6, -89.7, ["Wis."]],
  ["Wyoming", 43.0, -107.6, ["Wyo."]],
];

/** City name fixes. Natural Earth ships double spaces and abbreviations. */
const CITY_ALIASES = {
  "New York": ["New York City", "NYC", "Manhattan", "Brooklyn"],
  "Washington, D.C.": ["Washington", "D.C.", "Washington DC", "the White House", "Capitol Hill"],
  "St. Paul": ["Saint Paul"],
  "Ft. Worth": ["Fort Worth"],
  "Los Angeles": ["L.A.", "Hollywood"],
  "San Francisco": ["S.F."],
  Kyiv: ["Kiev"],
  Mumbai: ["Bombay"],
  Beijing: ["Peking"],
  Istanbul: ["Constantinople"],
  Rome: ["the Vatican", "Vatican City"],
  Brussels: ["the E.U.", "European Union"],
  Geneva: ["the U.N. in Geneva"],
  Munich: ["München"],
  Cologne: ["Köln"],
  Florence: ["Firenze"],
  Naples: ["Napoli"],
  "Mexico City": ["Ciudad de México"],
  "Sao Paulo": ["São Paulo"],
  "Rio de Janeiro": ["Rio"],
  Seoul: [],
  Doha: [],
};

/** City names that read as a person, a common word, or a team more often
    than as a place. A pin in the wrong hemisphere is worse than no pin.

    Capitals are deliberately absent: an unqualified "Paris" or "Berlin"
    in a wire headline is the capital far more often than the American
    town, so those stay in. */
const CITY_UNSAFE = new Set([
  "Mobile", "Reading", "Nice", "Split", "Male", "Malé", "Bath", "Salem", "Victoria", "Phoenix",
  "Santiago", "Cork", "Manchester", "Birmingham", "Cambridge", "Oxford", "Columbus", "Jackson",
  "Aurora", "Independence", "Richmond", "Springfield", "Kingston", "Hamilton", "Newcastle",
  "York", "Boulder", "Charlotte", "Alexandria", "Odessa", "Florence", "Lima", "Cali", "Fez",
  "Ufa", "Kano", "Hama", "Aba", "Kota", "Jixi", "Hami", "Agra", "Perm", "Omsk",
  // Surnames and given names that outnumber the city in an entertainment
  // feed: Zoe Kazan, every Sofia.
  "Kazan", "Sofia",
]);

/* ------------------------------------------------------------
   Build
   ------------------------------------------------------------ */

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

const slug = (s) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const tidy = (s) => s.replace(/\s+/g, " ").trim();

console.log("Downloading Natural Earth…");
const [countriesGeo, placesGeo, landGeo, bordersGeo, lakesGeo] = await Promise.all([
  getJSON(`${NE}/ne_110m_admin_0_countries.geojson`),
  getJSON(`${NE}/ne_50m_populated_places_simple.geojson`),
  // 50m, not 110m, for anything that gets drawn: at 110m Britain is a blob
  // and there are no borders at all. The gazetteer stays on 110m because
  // all it needs from a country is one label point.
  getJSON(`${NE}/ne_50m_land.geojson`),
  getJSON(`${NE}/ne_50m_admin_0_boundary_lines_land.geojson`),
  getJSON(`${NE}/ne_50m_lakes.geojson`),
]);

/* --- gazetteer --- */

const places = [];
const push = (p) => places.push(p);

// Countries
for (const f of countriesGeo.features) {
  const ne = f.properties.NAME;
  const name = COUNTRY_RENAME[ne] ?? ne;
  const aliases = new Set(COUNTRY_ALIASES[ne] ?? []);
  // NAME_LONG ("Republic of Korea") and the renamed-from name are both
  // things a wire story might use.
  if (f.properties.NAME_LONG && f.properties.NAME_LONG !== name) aliases.add(f.properties.NAME_LONG);
  if (ne !== name) aliases.add(ne);
  aliases.delete(name);

  push({
    id: `country:${slug(name)}`,
    name,
    kind: "country",
    country: name,
    lat: +f.properties.LABEL_Y.toFixed(3),
    lon: +f.properties.LABEL_X.toFixed(3),
    aliases: [...aliases],
    // Ambiguous bare names still get an entry so an alias hit can resolve
    // to a real pin — they just don't match on the name itself.
    nameUnsafe: COUNTRY_NAME_UNSAFE.has(name) || undefined,
  });
}

const byName = new Map(places.map((p) => [p.name, p]));

// Regions: US states first, then the curated extras.
for (const [name, lat, lon, aliases] of US_STATES) {
  push({
    id: `region:us-${slug(name)}`,
    name: name.replace(/ State$/, ""),
    kind: "region",
    country: "United States",
    lat,
    lon,
    aliases,
  });
}
for (const [name, lat, lon, country, aliases] of EXTRA_REGIONS) {
  push({ id: `region:${slug(name)}`, name, kind: "region", country, lat, lon, aliases });
}

// Cities: national capitals, plus anywhere with half a million people.
let cityCount = 0;
for (const f of placesGeo.features) {
  const pr = f.properties;
  if (pr.adm0cap !== 1 && !(pr.pop_max >= 500000)) continue;

  const name = tidy(pr.name);
  if (name.length < 4 && !CITY_ALIASES[name]) continue;
  if (CITY_UNSAFE.has(name)) continue;

  const country = COUNTRY_RENAME[pr.adm0name] ?? pr.adm0name;
  const id = `city:${slug(country)}-${slug(name)}`;
  if (places.some((p) => p.id === id)) continue;

  push({
    id,
    name,
    kind: "city",
    country,
    lat: +pr.latitude.toFixed(3),
    lon: +pr.longitude.toFixed(3),
    aliases: CITY_ALIASES[name] ?? [],
    // Population breaks ties: an unqualified "Springfield" should not
    // outrank "Chicago", and two cities can share a name.
    pop: pr.pop_max || 0,
    capital: pr.adm0cap === 1 || undefined,
  });
  cityCount++;
}

/* A city's country should resolve to a real gazetteer entry so the panel
   can say "Lyon, France" and the fallback pin has somewhere to land. */
for (const p of places) {
  if (p.kind !== "country" && p.country && !byName.has(p.country)) {
    // Not fatal — a handful of dependencies aren't in the 110m country
    // layer. The name still prints; it just isn't clickable as a country.
    p.countryUnlisted = true;
  }
}

places.sort((a, b) => a.id.localeCompare(b.id));

await writeFile(
  resolve(ROOT, "scripts/gazetteer.json"),
  JSON.stringify({ places }, null, 1) + "\n"
);

/* --- the drawn world ---

   Coastlines, country borders and the big lakes, in the compact form the
   globe's texture painter wants. Three things shrink it:

     · Quantized to 1/100° (~1km, and a fifth of a texel at the size the
       texture is painted). The GeoJSON envelope goes with it — the client
       only ever feeds these to a path.
     · Antimeridian jumps are unrolled here rather than in the browser, so
       a ring that crosses the date line reads as one continuous run and
       the client just draws it a turn either side.
     · Delta encoded. Absolute coordinates are five digits each; the step
       between neighbouring vertices is usually one or two, which is both
       shorter on its own and far more compressible.

   60k points of coastline lands around 300KB, ~90KB over the wire. */

const QUANT = 100;

const LON_LIMIT = 180 * QUANT;

/**
 * One ring, unrolled and delta encoded.
 *
 * Returns the encoded run plus the longitude range it ended up spanning,
 * which is what decides whether it needs a wrapped copy.
 */
function encodeRing(coords) {
  const out = [];
  let carry = 0;
  let px = null;
  let py = null;
  let prevLon = null;
  let min = Infinity;
  let max = -Infinity;

  for (const [lonRaw, lat] of coords) {
    // Unroll: a jump of more than half a turn is the date line, not travel.
    if (prevLon !== null) {
      const step = lonRaw + carry - prevLon;
      if (step > 180) carry -= 360;
      else if (step < -180) carry += 360;
    }
    const lon = lonRaw + carry;
    prevLon = lon;

    const x = Math.round(lon * QUANT);
    const y = Math.round(lat * QUANT);
    if (px === null) {
      out.push(x, y);
    } else {
      // Quantizing collapses neighbouring vertices onto each other.
      if (x === px && y === py) continue;
      out.push(x - px, y - py);
    }
    if (x < min) min = x;
    if (x > max) max = x;
    px = x;
    py = y;
  }
  return out.length >= 6 ? { run: out, min, max } : null;
}

/**
 * Add a ring to `rings`, plus a shifted copy for each turn of longitude
 * where it still shows.
 *
 * Unrolling leaves a date-line ring running off one edge of the map — say
 * Chukotka at 170°..190° — and the part past 180° belongs back at -180°.
 * The globe used to handle that by drawing *everything* three times, once
 * per turn, which tripled the cost of painting the texture to rescue the
 * dozen shapes that actually need it. Doing it here instead means the
 * client draws each run exactly once and needs no wrap logic at all.
 */
function emit(rings, enc) {
  if (!enc) return;
  rings.push(enc.run);
  /* A copy a turn to the west/east, but only if it lands back in frame.
     The comparison is deliberately not strict: Antarctica spans exactly
     -180 to 180, so its copies would sit precisely against the far edge
     and contribute nothing but two more traversals of the biggest ring
     in the file. */
  for (const shift of [-360 * QUANT, 360 * QUANT]) {
    if (enc.min + shift >= LON_LIMIT || enc.max + shift <= -LON_LIMIT) continue;
    const copy = enc.run.slice();
    copy[0] += shift; // only the absolute head moves; the deltas don't
    rings.push(copy);
  }
}

/** Every ring of every polygon in a layer, encoded. */
function encodePolygons(geo, keep = () => true) {
  const rings = [];
  for (const f of geo.features) {
    if (!keep(f)) continue;
    const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const poly of polys) {
      for (const ring of poly) emit(rings, encodeRing(ring));
    }
  }
  return rings;
}

/** Same, for line layers (borders), which have no rings to close. */
function encodeLines(geo) {
  const lines = [];
  for (const f of geo.features) {
    const parts =
      f.geometry.type === "LineString" ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const part of parts) emit(lines, encodeRing(part));
  }
  return lines;
}

/* Only lakes big enough to read on a globe. Natural Earth ships 412 of
   them down to Swedish ponds; the top slice by bounding box is the Great
   Lakes, Baikal, Victoria, Ladoga and friends — the ones whose absence
   from a world map you'd actually notice. */
const LAKE_COUNT = 60;
const lakeArea = (f) => {
  let minX = 180;
  let maxX = -180;
  let minY = 90;
  let maxY = -90;
  const walk = (c) => {
    if (typeof c[0] === "number") {
      minX = Math.min(minX, c[0]);
      maxX = Math.max(maxX, c[0]);
      minY = Math.min(minY, c[1]);
      maxY = Math.max(maxY, c[1]);
      return;
    }
    c.forEach(walk);
  };
  walk(f.geometry.coordinates);
  // Degrees of longitude shrink toward the poles; without this Canada's
  // lakes crowd out everything nearer the equator.
  return (maxX - minX) * (maxY - minY) * Math.cos((((minY + maxY) / 2) * Math.PI) / 180);
};

const bigLakes = new Set(
  [...lakesGeo.features].sort((a, b) => lakeArea(b) - lakeArea(a)).slice(0, LAKE_COUNT)
);

const world = {
  scale: QUANT,
  land: encodePolygons(landGeo),
  lakes: encodePolygons(lakesGeo, (f) => bigLakes.has(f)),
  borders: encodeLines(bordersGeo),
};

await mkdir(resolve(ROOT, "public/geo"), { recursive: true });
await writeFile(resolve(ROOT, "public/geo/world.json"), JSON.stringify(world) + "\n");

const count = (rings) => rings.reduce((n, r) => n + r.length / 2, 0);
console.log(
  `gazetteer.json  ${places.length} places ` +
    `(${countriesGeo.features.length} countries, ${US_STATES.length + EXTRA_REGIONS.length} regions, ${cityCount} cities)\n` +
    `world.json      ${count(world.land)} coastline pts, ` +
    `${count(world.borders)} border pts, ${count(world.lakes)} lake pts`
);
