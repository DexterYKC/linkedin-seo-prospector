// Pure Node.js icon generator - no external dependencies
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

// ── PNG encoder ──────────────────────────────────────────────────────────────
function makePNG(w, h, rgba) {
  const T = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    T[i] = c >>> 0;
  }
  const crc = (b, s, e) => {
    let c = 0xFFFFFFFF;
    for (let i = s; i < e; i++) c = T[(c ^ b[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  };
  const chunk = (type, d) => {
    const b = Buffer.alloc(12 + d.length);
    b.writeUInt32BE(d.length, 0); b.write(type, 4, 'ascii'); d.copy(b, 8);
    b.writeUInt32BE(crc(b, 4, 8 + d.length), 8 + d.length);
    return b;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const sl = w * 4, raw = Buffer.alloc(h * (1 + sl));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + sl)] = 0;
    rgba.copy(raw, y * (1 + sl) + 1, y * sl, (y + 1) * sl);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))
  ]);
}

// ── Renderer ─────────────────────────────────────────────────────────────────
const N = 128; // master canvas size

// Float RGBA accumulator (for compositing)
const buf = new Float32Array(N * N * 4);

function clamp(v, lo = 0, hi = 255) { return Math.max(lo, Math.min(hi, v)); }

function blendPixel(x, y, r, g, b, a) {
  const ix = Math.round(x), iy = Math.round(y);
  if (ix < 0 || ix >= N || iy < 0 || iy >= N) return;
  const i = (iy * N + ix) * 4;
  const sa = a, da = buf[i + 3];
  const oa = sa + da * (1 - sa);
  if (oa < 1e-6) return;
  buf[i]     = (r * sa + buf[i]     * da * (1 - sa)) / oa;
  buf[i + 1] = (g * sa + buf[i + 1] * da * (1 - sa)) / oa;
  buf[i + 2] = (b * sa + buf[i + 2] * da * (1 - sa)) / oa;
  buf[i + 3] = oa;
}

// Anti-aliased circle/arc painter
function drawArc(cx, cy, r, thickness, color, startDeg, endDeg, alpha) {
  const steps = Math.ceil(2 * Math.PI * r * 2); // enough steps for smooth arc
  const s0 = startDeg * Math.PI / 180, s1 = endDeg * Math.PI / 180;
  const range = ((s1 - s0) + 2 * Math.PI) % (2 * Math.PI);
  const dt = range / steps;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const angle = s0 + t * range;
    // Gradient along arc: interpolate color
    const [r1, g1, b1] = color(t);
    // Soft edge: draw with sub-pixel blur by painting 3 radii
    for (let dr = -thickness / 2; dr <= thickness / 2; dr += 0.5) {
      const px = cx + (r + dr) * Math.cos(angle);
      const py = cy + (r + dr) * Math.sin(angle);
      const coverage = Math.max(0, 1 - Math.abs(dr) / (thickness / 2)) * alpha;
      blendPixel(px, py, r1 / 255, g1 / 255, b1 / 255, coverage * 0.55);
    }
  }
}

function fillCircle(cx, cy, radius, r, g, b, a) {
  const ir = Math.ceil(radius);
  for (let dy = -ir; dy <= ir; dy++) {
    for (let dx = -ir; dx <= ir; dx++) {
      const d = Math.hypot(dx, dy);
      if (d <= radius) {
        const aa = d > radius - 1 ? 1 - (d - (radius - 1)) : 1;
        blendPixel(cx + dx, cy + dy, r / 255, g / 255, b / 255, a * aa);
      }
    }
  }
}

// Linear interpolation for gradient colors
function gradientColor(stops) {
  // stops: [[t, r, g, b], ...]
  return (t) => {
    for (let i = 0; i < stops.length - 1; i++) {
      const [t0, r0, g0, b0] = stops[i];
      const [t1, r1, g1, b1] = stops[i + 1];
      if (t >= t0 && t <= t1) {
        const f = (t - t0) / (t1 - t0);
        return [r0 + (r1 - r0) * f, g0 + (g1 - g0) * f, b0 + (b1 - b0) * f];
      }
    }
    return stops[stops.length - 1].slice(1);
  };
}

// ── Draw icon at 128×128 ──────────────────────────────────────────────────────

// Background: #1E3A8A (deep blue), fully opaque
for (let i = 0; i < N * N; i++) {
  buf[i * 4]     = 30  / 255;
  buf[i * 4 + 1] = 58  / 255;
  buf[i * 4 + 2] = 138 / 255;
  buf[i * 4 + 3] = 1;
}

// Rounded corners (r=24)
const CR = 24;
for (let y = 0; y < N; y++) {
  for (let x = 0; x < N; x++) {
    const inBL = x < CR && y > N - CR && Math.hypot(x - CR, y - (N - CR)) > CR;
    const inBR = x > N - CR && y > N - CR && Math.hypot(x - (N - CR), y - (N - CR)) > CR;
    const inTL = x < CR && y < CR && Math.hypot(x - CR, y - CR) > CR;
    const inTR = x > N - CR && y < CR && Math.hypot(x - (N - CR), y - CR) > CR;
    if (inTL || inTR || inBL || inBR) {
      buf[(y * N + x) * 4 + 3] = 0;
    }
  }
}

// Centre of rings
const CX = 64, CY = 60;
// White arcs (high contrast on blue background)
const white = () => [255, 255, 255];
// Arc spans: -220° to +60°
drawArc(CX, CY, 40, 5, white, -220, 60, 0.38);
drawArc(CX, CY, 28, 5, white, -220, 60, 0.68);
drawArc(CX, CY, 17, 5, white, -220, 60, 1.0);

// Glow around dot
fillCircle(CX, CY, 12, 16, 185, 129, 0.13);
// Dot: #10B981 → #A7F3D0
fillCircle(CX, CY, 7, 0xA7, 0xF3, 0xD0, 1.0);
fillCircle(CX, CY, 4, 0x10, 0xB9, 0x81, 1.0);
// Inner highlight
fillCircle(CX, CY, 2.2, 0xD1, 0xFA, 0xE5, 0.9);

// Cursor: translate(50,71) rotate(48.2°), path M0,0 L-7,21 L0,17 L7,21 Z
const CURSOR_PTS = [[0, 0], [-7, 21], [0, 17], [7, 21]];
const ANGLE = 48.2 * Math.PI / 180;
const cos = Math.cos(ANGLE), sin = Math.sin(ANGLE);
const TX = 50, TY = 73;
const cpts = CURSOR_PTS.map(([x, y]) => [TX + x * cos - y * sin, TY + x * sin + y * cos]);

// Scanline fill cursor triangle
function fillPoly(pts, r, g, b, a) {
  const minY = Math.floor(Math.min(...pts.map(p => p[1])));
  const maxY = Math.ceil(Math.max(...pts.map(p => p[1])));
  for (let y = minY; y <= maxY; y++) {
    const xs = [];
    for (let i = 0; i < pts.length; i++) {
      const p1 = pts[i], p2 = pts[(i + 1) % pts.length];
      if ((y >= p1[1] && y < p2[1]) || (y >= p2[1] && y < p1[1])) {
        const t = (y - p1[1]) / (p2[1] - p1[1]);
        xs.push(p1[0] + t * (p2[0] - p1[0]));
      }
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      for (let x = Math.round(xs[i]); x <= Math.round(xs[i + 1]); x++) {
        blendPixel(x, y, r / 255, g / 255, b / 255, a);
      }
    }
  }
}
fillPoly(cpts, 0x5B, 0x7B, 0xF8, 0.92);

// ── Convert float buffer → Uint8 → PNG ───────────────────────────────────────
function toUint8(src, size) {
  const pixels = Buffer.alloc(size * size * 4);
  const ratio = N / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Box-average downsampling
      const x0 = Math.floor(x * ratio), y0 = Math.floor(y * ratio);
      const x1 = Math.min(Math.ceil((x + 1) * ratio), N);
      const y1 = Math.min(Math.ceil((y + 1) * ratio), N);
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * N + sx) * 4;
          r += src[i]; g += src[i + 1]; b += src[i + 2]; a += src[i + 3];
          n++;
        }
      }
      const di = (y * size + x) * 4;
      pixels[di]     = Math.round(clamp(r / n * 255));
      pixels[di + 1] = Math.round(clamp(g / n * 255));
      pixels[di + 2] = Math.round(clamp(b / n * 255));
      pixels[di + 3] = Math.round(clamp(a / n * 255));
    }
  }
  return pixels;
}

const outDir = path.dirname(__filename);
for (const size of [16, 32, 48, 128]) {
  const rgba = toUint8(buf, size);
  const pngPath = path.join(outDir, `icon${size}.png`);
  fs.writeFileSync(pngPath, makePNG(size, size, rgba));
  console.log(`✓ icon${size}.png`);
}
console.log('Done.');
