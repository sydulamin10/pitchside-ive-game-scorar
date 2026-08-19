/**
 * Draws ODCC LIVE PWA icons — cricket ball + wordmark on pitch green (no image library).
 *
 * Usage: node scripts/generate-icons.mjs
 */

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "frontend", "public", "icons");
const BRANDING_DIR = join(ROOT, "frontend", "public", "branding");

const PITCH = [0x12, 0x26, 0x1e];
const BALL = [0xc9, 0x4a, 0x2a];
const BALL_SHADOW = [0x8f, 0x32, 0x1c];
const STITCH = [0xf4, 0xee, 0xe4];
const HIGHLIGHT = [0xe9, 0xa6, 0x3c];
const CHALK = [0xf4, 0xee, 0xe4];
const AMBER = [0xe9, 0xa6, 0x3c];

const TARGETS = [
  { file: "icon-192.png", size: 192, ballRadius: 0.22 },
  { file: "icon-512.png", size: 512, ballRadius: 0.22 },
  { file: "icon-maskable-512.png", size: 512, ballRadius: 0.18 },
  { file: "apple-touch-icon.png", size: 180, ballRadius: 0.2 },
];

/** 5×7 uppercase bitmap glyphs for ODCC / LIVE */
const GLYPHS = {
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  V: ["10001", "10001", "10001", "10001", "01010", "01010", "00100"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
};

function createCanvas(size) {
  return {
    size,
    r: new Float32Array(size * size),
    g: new Float32Array(size * size),
    b: new Float32Array(size * size),
  };
}

function setPixel(canvas, x, y, color, alpha = 1) {
  const { size, r, g, b } = canvas;
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  const i = y * size + x;
  const a = Math.min(1, Math.max(0, alpha));
  r[i] = r[i] * (1 - a) + color[0] * a;
  g[i] = g[i] * (1 - a) + color[1] * a;
  b[i] = b[i] * (1 - a) + color[2] * a;
}

function fillBackground(canvas) {
  const { size, r, g, b } = canvas;
  for (let i = 0; i < size * size; i += 1) {
    r[i] = PITCH[0];
    g[i] = PITCH[1];
    b[i] = PITCH[2];
  }
}

function fillCircle(canvas, cx, cy, radius, color) {
  const { size } = canvas;
  const edge = 1.1;
  const minX = Math.max(0, Math.floor(cx - radius - edge));
  const maxX = Math.min(size - 1, Math.ceil(cx + radius + edge));
  const minY = Math.max(0, Math.floor(cy - radius - edge));
  const maxY = Math.min(size - 1, Math.ceil(cy + radius + edge));
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      const alpha = Math.min(1, Math.max(0, (radius + edge / 2 - d) / edge));
      if (alpha > 0) setPixel(canvas, x, y, color, alpha);
    }
  }
}

function stamp(canvas, x, y, radius, color) {
  const { size } = canvas;
  const edge = 0.75;
  const minX = Math.max(0, Math.floor(x - radius - edge));
  const maxX = Math.min(size - 1, Math.ceil(x + radius + edge));
  const minY = Math.max(0, Math.floor(y - radius - edge));
  const maxY = Math.min(size - 1, Math.ceil(y + radius + edge));
  for (let py = minY; py <= maxY; py += 1) {
    for (let px = minX; px <= maxX; px += 1) {
      const dx = px + 0.5 - x;
      const dy = py + 0.5 - y;
      const d = Math.sqrt(dx * dx + dy * dy);
      const alpha = Math.min(1, Math.max(0, (radius + edge / 2 - d) / edge));
      if (alpha > 0) setPixel(canvas, px, py, color, alpha);
    }
  }
}

function strokePath(canvas, point, width, color, { dashes = 0 } = {}) {
  const steps = Math.ceil(canvas.size * 5);
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    if (dashes > 0 && Math.floor(t * dashes) % 2 === 1) continue;
    const [x, y] = point(t);
    stamp(canvas, x, y, width / 2, color);
  }
}

function drawText(canvas, text, cx, baselineY, pixel, color, tracking = 1) {
  const rows = 7;
  const cols = 5;
  const letterW = cols * pixel;
  const gap = Math.max(1, Math.round(pixel * tracking));
  const totalW = text.length * letterW + (text.length - 1) * gap;
  let x0 = Math.round(cx - totalW / 2);
  for (const ch of text) {
    const glyph = GLYPHS[ch] ?? GLYPHS[" "];
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        if (glyph[row][col] !== "1") continue;
        const px = x0 + col * pixel;
        const py = baselineY - (rows - row) * pixel;
        for (let dy = 0; dy < pixel; dy += 1) {
          for (let dx = 0; dx < pixel; dx += 1) {
            setPixel(canvas, px + dx, py + dy, color, 1);
          }
        }
      }
    }
    x0 += letterW + gap;
  }
}

function drawMark(size, ballRadius) {
  const canvas = createCanvas(size);
  fillBackground(canvas);
  const centre = size / 2;
  const ballCy = size * 0.36;
  const radius = size * ballRadius;
  const stitch = Math.max(1.4, size * 0.018);

  fillCircle(canvas, centre + size * 0.012, ballCy + size * 0.018, radius * 1.02, BALL_SHADOW);
  fillCircle(canvas, centre, ballCy, radius, BALL);
  strokePath(
    canvas,
    (t) => {
      const angle = -2.4 + t * 1.1;
      const r = radius * 0.72;
      return [centre + r * Math.cos(angle), ballCy + r * Math.sin(angle)];
    },
    stitch * 1.3,
    HIGHLIGHT,
  );
  strokePath(
    canvas,
    (t) => {
      const angle = t * Math.PI * 2;
      return [centre + radius * Math.cos(angle), ballCy + radius * Math.sin(angle)];
    },
    stitch * 0.65,
    BALL_SHADOW,
  );
  const bulge = radius * 0.55;
  const reach = 1.05;
  for (const side of [-1, 1]) {
    strokePath(
      canvas,
      (t) => {
        const angle = (t * 2 - 1) * reach;
        return [
          centre + side * bulge * Math.cos(angle),
          ballCy + radius * 0.92 * Math.sin(angle),
        ];
      },
      stitch,
      STITCH,
      { dashes: 11 },
    );
  }

  const odccPixel = Math.max(2, Math.round(size * 0.028));
  const livePixel = Math.max(2, Math.round(size * 0.018));
  drawText(canvas, "ODCC", centre, size * 0.72, odccPixel, CHALK, 1.15);
  drawText(canvas, "LIVE", centre, size * 0.86, livePixel, AMBER, 1.35);

  return canvas;
}

function toRgba(canvas) {
  const { size, r, g, b } = canvas;
  const pixels = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i += 1) {
    pixels[i * 4] = Math.round(r[i]);
    pixels[i * 4 + 1] = Math.round(g[i]);
    pixels[i * 4 + 2] = Math.round(b[i]);
    pixels[i * 4 + 3] = 0xff;
  }
  return pixels;
}

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
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;
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

mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(BRANDING_DIR, { recursive: true });

for (const target of TARGETS) {
  const canvas = drawMark(target.size, target.ballRadius);
  const png = encodePng(toRgba(canvas), target.size);
  writeFileSync(join(OUT_DIR, target.file), png);
  process.stdout.write(`${target.file}  ${target.size}px  ${(png.length / 1024).toFixed(1)} kB\n`);
}

const faviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" role="img" aria-label="ODCC LIVE">
  <rect width="64" height="64" rx="14" fill="#12261E"/>
  <circle cx="33" cy="28" r="16" fill="#8F321C"/>
  <circle cx="32" cy="26" r="15.5" fill="#C94A2A"/>
  <path d="M22 18c4 7 4 15 0 22" fill="none" stroke="#F4EEE4" stroke-width="1.8" stroke-linecap="round" stroke-dasharray="2.4 2.8"/>
  <path d="M42 18c-4 7-4 15 0 22" fill="none" stroke="#F4EEE4" stroke-width="1.8" stroke-linecap="round" stroke-dasharray="2.4 2.8"/>
  <path d="M24 16c4 1.5 8 1.5 12 0" fill="none" stroke="#E9A63C" stroke-width="1.5" stroke-linecap="round" opacity="0.85"/>
  <text x="32" y="54" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="11" font-weight="800" letter-spacing="1.5" fill="#F4EEE4">ODCC</text>
</svg>
`;
writeFileSync(join(OUT_DIR, "seam.svg"), faviconSvg);
process.stdout.write("seam.svg  updated\n");

// Keep a replaceable branding copy of the favicon-sized mark too.
copyFileSync(join(OUT_DIR, "seam.svg"), join(BRANDING_DIR, "odcc-live-favicon.svg"));
process.stdout.write("branding/odcc-live-favicon.svg  copied\n");
