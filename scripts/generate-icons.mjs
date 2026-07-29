/**
 * Draws the PWA icons from the brand mark, with no image library.
 *
 * Why write a rasteriser instead of adding `sharp`: these four files change about
 * once a year, and a build-time native dependency that only exists to render a
 * circle is a supply-chain surface we do not need. Everything here is arithmetic
 * plus Node's own zlib, and the output is deterministic — run it twice and the
 * bytes are identical, so a regenerated icon shows up as no diff at all.
 *
 * Usage: node scripts/generate-icons.mjs
 */

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "frontend", "public", "icons");

const PITCH = [0x12, 0x26, 0x1e]; // --color-pitch
const AMBER = [0xe9, 0xa6, 0x3c]; // --color-flip

/** Icons Android may crop to any shape need their art inside the middle 80%. */
const TARGETS = [
  { file: "icon-192.png", size: 192, ballRadius: 0.34 },
  { file: "icon-512.png", size: 512, ballRadius: 0.34 },
  { file: "icon-maskable-512.png", size: 512, ballRadius: 0.28 },
  { file: "apple-touch-icon.png", size: 180, ballRadius: 0.32 },
];

// --------------------------------------------------------------- drawing

/**
 * A coverage buffer, one float per pixel. Strokes are drawn by stamping small
 * antialiased discs along a parametric path, which is slower than a scanline
 * rasteriser and about a tenth of the code.
 */
function createCanvas(size) {
  return { size, coverage: new Float32Array(size * size) };
}

function stamp(canvas, x, y, radius) {
  const { size, coverage } = canvas;
  const edge = 0.7; // antialias width in pixels
  const minX = Math.max(0, Math.floor(x - radius - edge));
  const maxX = Math.min(size - 1, Math.ceil(x + radius + edge));
  const minY = Math.max(0, Math.floor(y - radius - edge));
  const maxY = Math.min(size - 1, Math.ceil(y + radius + edge));

  for (let py = minY; py <= maxY; py += 1) {
    for (let px = minX; px <= maxX; px += 1) {
      const dx = px + 0.5 - x;
      const dy = py + 0.5 - y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const alpha = Math.min(1, Math.max(0, (radius + edge / 2 - distance) / edge));
      const index = py * size + px;
      if (alpha > coverage[index]) coverage[index] = alpha;
    }
  }
}

/** `point(t)` for t in [0, 1]; stamped densely enough to leave no gaps. */
function strokePath(canvas, point, width, { dashes = 0 } = {}) {
  const steps = Math.ceil(canvas.size * 4);
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    // A dash pattern in path space, so both seams break at the same places.
    if (dashes > 0 && Math.floor(t * dashes) % 2 === 1) continue;
    const [x, y] = point(t);
    stamp(canvas, x, y, width / 2);
  }
}

function drawMark(size, ballRadius) {
  const canvas = createCanvas(size);
  const centre = size / 2;
  const radius = size * ballRadius;
  const stroke = Math.max(2, size * 0.052);

  strokePath(canvas, (t) => {
    const angle = t * Math.PI * 2;
    return [centre + radius * Math.cos(angle), centre + radius * Math.sin(angle)];
  }, stroke);

  // The two seams: ellipse arcs that bulge out to the sides and stop just short
  // of the ball's outline, exactly as the SVG mark does.
  const bulge = radius * 0.58;
  const reach = 1.0; // radians either side of the widest point
  for (const side of [-1, 1]) {
    strokePath(
      canvas,
      (t) => {
        const angle = (t * 2 - 1) * reach;
        return [centre + side * bulge * Math.cos(angle), centre + radius * Math.sin(angle)];
      },
      stroke * 0.88,
      { dashes: 11 },
    );
  }

  return canvas;
}

/** Flatten coverage onto the pitch-green ground. Fully opaque: no alpha edges. */
function toRgba(canvas) {
  const { size, coverage } = canvas;
  const pixels = Buffer.alloc(size * size * 4);
  for (let index = 0; index < size * size; index += 1) {
    const alpha = coverage[index];
    for (let channel = 0; channel < 3; channel += 1) {
      pixels[index * 4 + channel] = Math.round(
        PITCH[channel] * (1 - alpha) + AMBER[channel] * alpha,
      );
    }
    pixels[index * 4 + 3] = 0xff;
  }
  return pixels;
}

// ------------------------------------------------------------------ png

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = -1;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(pixels, size) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // truecolour with alpha
  header[10] = 0; // deflate
  header[11] = 0; // adaptive filtering
  header[12] = 0; // no interlace

  // Filter type 0 (none) per scanline: these are tiny images and zlib copes.
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let row = 0; row < size; row += 1) {
    raw[row * (stride + 1)] = 0;
    pixels.copy(raw, row * (stride + 1) + 1, row * stride, (row + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ----------------------------------------------------------------- main

mkdirSync(OUT_DIR, { recursive: true });
for (const target of TARGETS) {
  const canvas = drawMark(target.size, target.ballRadius);
  const png = encodePng(toRgba(canvas), target.size);
  writeFileSync(join(OUT_DIR, target.file), png);
  process.stdout.write(`${target.file}  ${target.size}px  ${(png.length / 1024).toFixed(1)} kB\n`);
}
