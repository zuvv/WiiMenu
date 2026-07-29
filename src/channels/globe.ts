/* ============================================================
   The sphere behind the News Globe: projection maths, the world
   texture, and the per-pixel renderer. No React in here.

   Approach: the globe is drawn as a raster, not as vector paths.
   Every frame walks the pixels inside the disc, inverse-projects
   each one back to a latitude/longitude, and samples a flat
   equirectangular world map built once at startup.

   That sounds like the expensive way round, and the obvious
   alternative — projecting coastline paths and stroking them —
   is what most 2D globes do. It isn't worth it here: half the
   world is behind the horizon at any moment, so every ring has
   to be clipped against the limb and re-closed along it, which
   is fiddly, and it gives you no way to shade the sphere. The
   raster gets correct occlusion for free and lets each pixel be
   lit, which is what makes it read as a ball rather than a
   circle.

   The cost is managed by the split in `retable()` below.
   ============================================================ */

/**
 * The drawn world, from public/geo/world.json.
 *
 * Each entry is one ring or line as `[lon, lat, dLon, dLat, …]`: an
 * absolute first point followed by steps, all integers to be divided by
 * `scale`. Longitudes are pre-unrolled past ±180 where a shape crosses
 * the date line. See scripts/build-geo.mjs.
 */
export interface WorldData {
  scale: number;
  land: number[][];
  lakes: number[][];
  borders: number[][];
}

/* Texture size, and the whole of what "low resolution" came down to.
 *
 * At the centre of the disc the globe shows about 512 pixels per radian
 * of longitude — call it 9 per degree. A 2048-wide map has 5.7, so it was
 * being magnified rather than sampled and every coastline came out
 * chunky. 3072 has 8.5, which is parity at the very centre and
 * oversampled everywhere else, since the projection compresses longitude
 * as you move out towards the limb.
 *
 * Going on to 4096 measured no visible difference and cost a great deal:
 * 32MB of texels instead of 18, and — because the sampler reads the map
 * in a scattered pattern and lives or dies by the cache — 7.2ms a frame
 * instead of 2.4. Resolution past the point where the screen can show it
 * is paid for entirely in cache misses. */
const TW = 3072;
const TH = 1536;

const TWO_PI = Math.PI * 2;
const RAD = Math.PI / 180;

/** acos(latitude term) -> texture row, and longitude -> texture column. */
const ROW_K = TH / Math.PI;
const COL_K = TW / TWO_PI;

/* Palette. The News Channel's accent is green, so this is a stylised
   Earth in the channel's own colours rather than a satellite photo —
   which also means no 5MB texture to ship. */
const OCEAN_TOP = "#1a5f92";
const OCEAN_BOT = "#0d3f66";
const LAND = "#7cc16a";
const LAND_EDGE = "#2f6b3b";
const BORDER = "rgba(38,88,48,0.72)";
const GRATICULE = "rgba(255,255,255,0.08)";
/** Ice, faded in over the last 20° at each pole — across sea as well as
    land, which is what actually reads as a polar cap. */
const ICE = "255,255,255";
const ICE_FROM = 68;
const ICE_ALPHA = 0.5;

/* Light direction in view space (x right, y up, z toward the viewer),
   normalised. Up and to the left, like every other glossy surface in
   this menu. */
const LX = -0.42;
const LY = 0.44;
const LZ = 0.79;

/* ------------------------------------------------------------
   Texture
   ------------------------------------------------------------ */

const SX = TW / 360;
const SY = TH / 180;

/**
 * Turn a layer into one reusable path.
 *
 * The delta decode is folded into the trace rather than run as a separate
 * pass — these are ~80,000 points, and materialising them as coordinate
 * arrays first is a lot of garbage for no gain. Building a Path2D rather
 * than tracing into the context means the coastline can be filled and
 * then stroked without walking the whole world twice.
 *
 * Date-line wrapping is not handled here: build-geo.mjs already emitted
 * the shifted copies as ordinary runs, so every run is drawn once.
 */
function buildPath(rings: number[][], scale: number, close: boolean): Path2D {
  const path = new Path2D();
  for (const ring of rings) {
    const n = ring.length / 2;
    let x = ring[0];
    let y = ring[1];
    path.moveTo((x / scale + 180) * SX, (90 - y / scale) * SY);
    for (let i = 1; i < n; i++) {
      x += ring[i * 2];
      y += ring[i * 2 + 1];
      path.lineTo((x / scale + 180) * SX, (90 - y / scale) * SY);
    }
    if (close) path.closePath();
  }
  return path;
}

/**
 * Paint the world flat, once, at startup.
 *
 * Everything the globe ever shows is baked in here — coastlines, borders,
 * lakes, ice, graticule — so the per-frame job is a texture lookup and
 * nothing else.
 *
 * Drawn rather than shipped as a finished image, which is the other
 * obvious way to do this. Canvas2D gives antialiasing and stroking for
 * free, the vectors are ~160KB over the wire against roughly a megabyte
 * for a PNG this size, and the map comes out sharp at whatever texture
 * size we ask for rather than at whatever the image happened to be. The
 * whole thing takes ~130ms, once, behind the channel's loading line.
 */
export function buildEarthTexture(world: WorldData): Uint32Array {
  const cv = document.createElement("canvas");
  cv.width = TW;
  cv.height = TH;
  const ctx = cv.getContext("2d", { willReadFrequently: true })!;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  const { scale } = world;
  const land = buildPath(world.land, scale, true);
  const lakes = buildPath(world.lakes, scale, true);
  const borders = buildPath(world.borders, scale, false);

  // Sea
  const ocean = ctx.createLinearGradient(0, 0, 0, TH);
  ocean.addColorStop(0, OCEAN_BOT);
  ocean.addColorStop(0.5, OCEAN_TOP);
  ocean.addColorStop(1, OCEAN_BOT);
  ctx.fillStyle = ocean;
  ctx.fillRect(0, 0, TW, TH);

  /* Land, as one path filled even-odd. Keeping every ring in a single
     path is what makes the holes work — an island's lagoon is a ring
     wound inside its coastline, and filling ring by ring would paint it
     over. Land polygons never overlap each other, so nothing else
     cancels out. */
  ctx.fillStyle = LAND;
  ctx.fill(land, "evenodd");

  // Lakes, cut back to sea colour on top of the land they sit in.
  ctx.fillStyle = OCEAN_TOP;
  ctx.fill(lakes, "evenodd");
  ctx.strokeStyle = LAND_EDGE;
  ctx.lineWidth = 1.2;
  ctx.stroke(lakes);

  // Borders under the coastline, so a coast wins where the two run together.
  ctx.strokeStyle = BORDER;
  ctx.lineWidth = 1.4;
  ctx.stroke(borders);

  ctx.strokeStyle = LAND_EDGE;
  ctx.lineWidth = 1.8;
  ctx.stroke(land);

  /* Ice. Drawn flat across the map rather than clipped to land, because
     what makes a pole look like a pole is the sea freezing too. */
  for (const pole of [-1, 1]) {
    const edge = ((90 - ICE_FROM) / 180) * TH;
    const g = ctx.createLinearGradient(0, pole > 0 ? 0 : TH, 0, pole > 0 ? edge : TH - edge);
    g.addColorStop(0, `rgba(${ICE},${ICE_ALPHA})`);
    g.addColorStop(1, `rgba(${ICE},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, pole > 0 ? 0 : TH - edge, TW, edge);
  }

  // Graticule last, so it reads over land, sea and ice alike.
  ctx.strokeStyle = GRATICULE;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let d = -180; d <= 180; d += 30) {
    const x = (d + 180) * SX;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, TH);
  }
  for (let d = -60; d <= 60; d += 30) {
    const y = (90 - d) * SY;
    ctx.moveTo(0, y);
    ctx.lineTo(TW, y);
  }
  ctx.stroke();

  return new Uint32Array(ctx.getImageData(0, 0, TW, TH).data.buffer);
}

/* ------------------------------------------------------------
   Projection

   Earth-space axes: X through (0°N, 90°E), Y through the north
   pole, Z through (0°N, 0°E). View space shares them once the
   globe is rotated to put `yaw`/`pitch` at the centre of the disc,
   with +Z pointing at the viewer — so a point is on the near face
   exactly when its view-space z is positive.
   ------------------------------------------------------------ */

export interface Projected {
  /** Offsets from the centre of the disc, in units of the radius. */
  x: number;
  y: number;
  /** Positive on the near face, negative behind the globe. */
  z: number;
}

/** Where a coordinate lands on screen, given the current rotation. */
export function project(latDeg: number, lonDeg: number, yaw: number, pitch: number): Projected {
  const la = latDeg * RAD;
  const lo = lonDeg * RAD;
  const cl = Math.cos(la);
  const ex = cl * Math.sin(lo);
  const ey = Math.sin(la);
  const ez = cl * Math.cos(lo);

  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const x1 = ex * cy - ez * sy;
  const z1 = ex * sy + ez * cy;

  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  return {
    x: x1,
    y: ey * cp - z1 * sp,
    z: ey * sp + z1 * cp,
  };
}

/* ------------------------------------------------------------
   Renderer
   ------------------------------------------------------------ */

export class GlobeRenderer {
  private texel: Uint32Array;
  private ctx: CanvasRenderingContext2D;
  private image: ImageData | null = null;
  private out: Uint32Array | null = null;

  /* Per-pixel tables, in scan order over the lit pixels only: the part
     of the disc that falls inside the window. The disc is convex, so a
     row is one unbroken run and `from`/`to` per row is enough to walk
     them — which also means the output index can be stepped rather than
     looked up. */
  private from = new Int32Array(0);
  private to = new Int32Array(0);
  /** Texture row offset (row × TW). */
  private row = new Int32Array(0);
  /** Texture column at yaw 0, as a float in [0, TW). */
  private col = new Float32Array(0);
  /** Lighting in bits 20–28 (8.8 fixed point), limb coverage in 8–15,
      limb haze in the low byte. */
  private light = new Uint32Array(0);

  private w = 0;
  private h = 0;
  private radius = 0;
  private tabledPitch = Number.NaN;
  /** Tight bounds of the disc within the window, for the putImageData. */
  private bx = 0;
  private by = 0;
  private bw = 0;
  private bh = 0;

  constructor(canvas: HTMLCanvasElement, texel: Uint32Array) {
    this.texel = texel;
    this.ctx = canvas.getContext("2d")!;
  }

  /**
   * Point the renderer at a `w`×`h` window of device pixels showing a
   * sphere of `radius` device pixels centred on the window.
   *
   * The window is the *visible* part of the globe, not the whole disc:
   * zoomed in, the disc overflows the window and everything past its
   * edges is simply never computed. That is the whole zoom strategy —
   * the work scales with what's on screen, not with the square of the
   * zoom, so a deep zoom costs the same per frame as the resting view.
   */
  layout(w: number, h: number, radius: number) {
    if ((w === this.w && h === this.h && radius === this.radius) || w <= 0 || h <= 0) return;
    if (w !== this.w || h !== this.h) {
      this.w = w;
      this.h = h;
      this.image = this.ctx.createImageData(w, h);
      this.out = new Uint32Array(this.image.data.buffer);
      /* Grown, never shrunk, so wheeling the zoom back and forth reuses
         the same arrays. Sizing to the bound means `retable` — which
         runs on every change of tilt — can fill these in place instead
         of growing arrays and converting them, which is the difference
         between a smooth vertical drag and a stuttering one. */
      if (this.from.length < h) {
        this.from = new Int32Array(h);
        this.to = new Int32Array(h);
      }
      const cap = w * h;
      if (this.row.length < cap) {
        this.row = new Int32Array(cap);
        this.col = new Float32Array(cap);
        this.light = new Uint32Array(cap);
      }
    } else if (radius < this.radius && this.out) {
      // The disc shrank in place: pixels it used to cover would keep
      // their last colour unless wiped.
      this.out.fill(0);
    }
    this.radius = radius;
    this.tabledPitch = Number.NaN;
    this.ctx.clearRect(0, 0, w, h);
  }

  /**
   * Rebuild the per-pixel tables.
   *
   * This is the whole performance story. Inverse-projecting a pixel needs
   * an asin and an atan2, and at ~200k pixels a frame that is the entire
   * budget. But spin the algebra out and the yaw falls away:
   *
   *   lat = asin(y·cos p + z·sin p)
   *   lon = atan2(x, z·cos p − y·sin p) + yaw
   *
   * Neither transcendental depends on yaw at all — yaw only *adds* to the
   * longitude, which downstream is a horizontal offset into the texture.
   * So the tables are cached against pitch alone, and a horizontal drag
   * (by far the common gesture) costs an add and a compare per pixel.
   */
  private retable(pitch: number) {
    if (pitch === this.tabledPitch) return;
    this.tabledPitch = pitch;

    const { from, to, row, col, light } = this;
    const w = this.w;
    const h = this.h;
    const r = this.radius;
    const cx = w / 2;
    const cy = h / 2;
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);

    let bx0 = w;
    let bx1 = 0;
    let by0 = h;
    let by1 = 0;
    let i = 0;
    for (let py = 0; py < h; py++) {
      // Sample pixel centres; the half-pixel keeps the disc from sitting
      // a touch high and left of the canvas.
      const y = (cy - py - 0.5) / r;
      // Solve the circle for this row instead of testing every pixel,
      // then clip the run to the window.
      const d = 1 - y * y;
      const half = d > 0 ? Math.sqrt(d) * r : 0;
      const lo = Math.max(0, Math.ceil(cx - half - 0.5));
      const hi = Math.min(w, Math.floor(cx + half - 0.5) + 1);
      from[py] = lo;
      to[py] = lo < hi ? hi : lo;
      if (lo < hi) {
        if (py < by0) by0 = py;
        by1 = py + 1;
        if (lo < bx0) bx0 = lo;
        if (hi > bx1) bx1 = hi;
      }

      for (let px = lo; px < hi; px++, i++) {
        const x = (px + 0.5 - cx) / r;
        const q = x * x + y * y;
        const z = Math.sqrt(Math.max(0, 1 - q));

        /* Latitude only ever becomes a texture row, and
           (π/2 − asin w) is acos w — so the conversion out of radians
           and into a row index collapses to one call and one multiply.
           Pre-multiplied by the stride, because the inner loop adds the
           column straight onto it. */
        const rowF = Math.acos(y * cp + z * sp) * ROW_K;
        row[i] = (rowF >= TH ? TH - 1 : rowF | 0) * TW;

        // Folded to [0, TW) now so the per-frame wrap is one compare.
        let u = Math.atan2(x, z * cp - y * sp) * COL_K + TW * 0.5;
        if (u >= TW) u -= TW;
        else if (u < 0) u += TW;
        col[i] = u;

        // Lambert term, floored so the night side is dusk rather than
        // black — this is a channel banner, not an astronomy app.
        const diffuse = Math.max(0, x * LX + y * LY + z * LZ);
        const shade = Math.min(511, ((0.34 + 0.82 * diffuse) * 256) | 0);
        /* Atmosphere: a rim that tightens into the last few percent of
           the radius, brightest where the light is. q^12 by repeated
           squaring — Math.pow with an integer exponent is a surprisingly
           large share of this loop, and this runs on every tilt. */
        const q4 = q * q * q * q;
        const limb = q4 * q4 * q4;
        const haze = ((limb * (0.35 + 0.65 * diffuse) * 190) | 0) & 0xff;
        /* Coverage at the limb: (1 − q)/2 approximates the distance to
           the edge in radii there, so ×r is pixels. Ramping alpha over
           the last pixel anti-aliases the silhouette, which used to be
           the border-radius clip's job back when the canvas edge and the
           disc edge were the same circle. */
        const cov = (1 - q) * r * 0.5;
        const alpha = cov >= 1 ? 255 : cov > 0 ? (cov * 255) | 0 : 0;
        // Packed into one word: the inner loop is memory-bound, and one
        // fetch beats three.
        light[i] = (shade << 20) | (alpha << 8) | haze;
      }
    }
    this.bx = bx0;
    this.by = by0;
    this.bw = Math.max(0, bx1 - bx0);
    this.bh = Math.max(0, by1 - by0);
  }

  /** Draw the globe at this rotation. Radians. */
  render(yaw: number, pitch: number) {
    if (!this.image || !this.out || !this.radius) return;
    this.retable(pitch);
    if (!this.bw || !this.bh) return;

    const { from, to, row, col, light, texel, out } = this;
    const w = this.w;
    const h = this.h;

    // Yaw as a texture-column offset, folded into [0, TW) so the sum
    // with `col` can only overflow by one turn.
    let du = ((yaw / TWO_PI) * TW) % TW;
    if (du < 0) du += TW;

    let i = 0;
    for (let py = 0; py < h; py++) {
      const end = to[py];
      let o = py * w + from[py];
      for (let px = from[py]; px < end; px++, i++, o++) {
        let u = (col[i] + du) | 0;
        if (u >= TW) u -= TW;

        const src = texel[row[i] + u];
        const lit = light[i];
        const s = lit >>> 20;
        const a = (lit >>> 8) & 0xff;
        const hz = lit & 0xff;

        // Little-endian byte order (0xAABBGGRR). Every browser this runs
        // in is little-endian; the alternative is a per-pixel shuffle.
        let r = (((src & 0xff) * s) >> 8) + hz;
        let g = ((((src >> 8) & 0xff) * s) >> 8) + hz;
        let b = ((((src >> 16) & 0xff) * s) >> 8) + hz;
        if (r > 255) r = 255;
        if (g > 255) g = 255;
        if (b > 255) b = 255;

        out[o] = (a << 24) | (b << 16) | (g << 8) | r;
      }
    }

    // Only the rectangle the disc actually occupies goes to the canvas —
    // at low zoom that's a fraction of the window.
    this.ctx.putImageData(this.image, 0, 0, this.bx, this.by, this.bw, this.bh);
  }
}
