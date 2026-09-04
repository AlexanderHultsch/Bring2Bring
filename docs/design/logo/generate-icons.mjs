#!/usr/bin/env node
// Design-time tool: regenerates the raster favicon/PWA icons in public/img/
// and public/favicon.ico from public/img/logo.svg. Not a project dependency —
// requires Playwright + a Chromium binary available locally, never part of
// `npm test` or the running app. See docs/design/logo/README.md.
//
// Usage:
//   PLAYWRIGHT_MODULE=/path/to/node_modules/playwright \
//   CHROMIUM_EXECUTABLE=/path/to/chrome \
//   node docs/design/logo/generate-icons.mjs

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const LOGO_SVG_PATH = path.join(REPO_ROOT, 'public', 'img', 'logo.svg');
const PUBLIC_IMG_DIR = path.join(REPO_ROOT, 'public', 'img');
const FAVICON_PATH = path.join(REPO_ROOT, 'public', 'favicon.ico');

const PLAYWRIGHT_MODULE = process.env.PLAYWRIGHT_MODULE;
const CHROMIUM_EXECUTABLE = process.env.CHROMIUM_EXECUTABLE;

if (!PLAYWRIGHT_MODULE || !CHROMIUM_EXECUTABLE) {
  console.error(
    'Set PLAYWRIGHT_MODULE (path to an installed playwright package) and ' +
      'CHROMIUM_EXECUTABLE (path to a Chromium binary) before running this ' +
      'script. Neither is a project dependency — see docs/design/logo/README.md.'
  );
  process.exit(1);
}

const { chromium } = require(PLAYWRIGHT_MODULE);

const ACCENT = '#2e7d32';
const WHITE = '#ffffff';

// From docs/design/logo/README.md: viewBox 0 0 128 128, ink spans x 28-100
// (72 wide) and y 12-116 (104 tall). Rendering the whole SVG at size S makes
// the ink S * 104/128 tall.
const INK_HEIGHT_OF_VIEWBOX = 104 / 128;

const logoSvg = fs.readFileSync(LOGO_SVG_PATH, 'utf8');

function markupAtSize(size) {
  const svg = logoSvg.replace(/width="128" height="128"/, `width="${size}" height="${size}"`);
  if (svg === logoSvg) {
    throw new Error('logo.svg no longer has width="128" height="128" on its root element');
  }
  return svg;
}

function pageHtml({ canvasSize, markSize, background, color, transparent }) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin: 0; padding: 0; }
  body {
    width: ${canvasSize}px;
    height: ${canvasSize}px;
    ${transparent ? '' : `background: ${background};`}
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .mark { line-height: 0; }
  .mark svg { color: ${color}; }
</style></head>
<body><div class="mark">${markupAtSize(markSize)}</div></body></html>`;
}

async function renderPng(browser, opts) {
  const page = await browser.newPage({
    viewport: { width: opts.canvasSize, height: opts.canvasSize },
    deviceScaleFactor: 1,
  });
  await page.setContent(pageHtml(opts));
  const buffer = await page.screenshot({ omitBackground: !!opts.transparent });
  await page.close();
  return buffer;
}

// --- minimal PNG decoder, just enough to self-verify what we just rendered:
// 8-bit RGBA, non-interlaced (what Chromium's page.screenshot produces). ---
function decodePng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let offset = 8;
  let width, height, bitDepth, colorType, interlace;
  const idatChunks = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data.readUInt8(8);
      colorType = data.readUInt8(9);
      interlace = data.readUInt8(12);
    } else if (type === 'IDAT') {
      idatChunks.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 8 + length + 4;
  }
  if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2) || interlace !== 0) {
    throw new Error(`unsupported PNG encoding (bitDepth=${bitDepth} colorType=${colorType} interlace=${interlace})`);
  }
  const hasAlpha = colorType === 6;
  const raw = zlib.inflateSync(Buffer.concat(idatChunks));
  const bpp = hasAlpha ? 4 : 3;
  const stride = width * bpp;
  const pixels = Buffer.alloc(height * stride);
  let rawOffset = 0;
  for (let y = 0; y < height; y++) {
    const filterType = raw[rawOffset];
    rawOffset += 1;
    const rowStart = y * stride;
    const prevRowStart = (y - 1) * stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[rawOffset + i];
      const a = i >= bpp ? pixels[rowStart + i - bpp] : 0;
      const b = y > 0 ? pixels[prevRowStart + i] : 0;
      const c = y > 0 && i >= bpp ? pixels[prevRowStart + i - bpp] : 0;
      let value;
      switch (filterType) {
        case 0: value = x; break;
        case 1: value = x + a; break;
        case 2: value = x + b; break;
        case 3: value = x + Math.floor((a + b) / 2); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          value = x + pr;
          break;
        }
        default: throw new Error(`unsupported filter type ${filterType}`);
      }
      pixels[rowStart + i] = value & 0xff;
    }
    rawOffset += stride;
  }
  return {
    width,
    height,
    getPixel(px, py) {
      const i = py * stride + px * bpp;
      return { r: pixels[i], g: pixels[i + 1], b: pixels[i + 2], a: hasAlpha ? pixels[i + 3] : 255 };
    },
  };
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

function pixelMatches(pixel, hex, alphaMin = 250) {
  const rgb = hexToRgb(hex);
  return pixel.a >= alphaMin && pixel.r === rgb.r && pixel.g === rgb.g && pixel.b === rgb.b;
}

// The exact geometric centre of the canvas lands on the "2" cutout (the
// letters' shared negative space — see docs/design/logo/README.md), so it
// is background-coloured by design, not a rendering failure. To check the
// mark actually painted, sample viewBox point (36, 64): solidly inside the
// left B's stem (x 28-44, y 12-100), well clear of the arc cut (x 45-89).
function inkSamplePixel(png, canvasSize, markSize) {
  const scale = markSize / 128;
  const originOffset = (canvasSize - markSize) / 2;
  const x = Math.round(originOffset + 36 * scale);
  const y = Math.round(originOffset + 64 * scale);
  return png.getPixel(x, y);
}

function verifyIcon(buffer, expected) {
  const png = decodePng(buffer);
  const report = { width: png.width, height: png.height };
  const corner = png.getPixel(1, 1);
  report.cornerPixel = corner;
  if (expected.background) {
    report.cornerMatchesBackground = pixelMatches(corner, expected.background);
  } else {
    report.cornerTransparent = corner.a === 0;
  }
  const ink = inkSamplePixel(png, expected.canvasSize, expected.markSize);
  report.inkPixel = ink;
  report.inkIsMarkColor = pixelMatches(ink, expected.color);
  return report;
}

// --- ICO writer: ICONDIR + ICONDIRENTRY headers wrapping whole PNG blobs
// (valid since Windows Vista, supported by every current browser). ---
function buildIco(images) {
  const headerSize = 6;
  const entrySize = 16;
  const offsets = [];
  let offset = headerSize + entrySize * images.length;
  for (const img of images) {
    offsets.push(offset);
    offset += img.buffer.length;
  }
  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);

  const entries = images.map((img, i) => {
    const entry = Buffer.alloc(entrySize);
    entry.writeUInt8(img.size === 256 ? 0 : img.size, 0); // width
    entry.writeUInt8(img.size === 256 ? 0 : img.size, 1); // height
    entry.writeUInt8(0, 2); // color count
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(img.buffer.length, 8); // size of PNG data
    entry.writeUInt32LE(offsets[i], 12); // offset from start of file
    return entry;
  });

  return Buffer.concat([header, ...entries, ...images.map((img) => img.buffer)]);
}

function parseIco(buffer) {
  const count = buffer.readUInt16LE(4);
  const entries = [];
  for (let i = 0; i < count; i++) {
    const base = 6 + i * 16;
    const width = buffer.readUInt8(base) || 256;
    const height = buffer.readUInt8(base + 1) || 256;
    const size = buffer.readUInt32LE(base + 8);
    const imgOffset = buffer.readUInt32LE(base + 12);
    const signatureOk = buffer.readUInt32BE(imgOffset) === 0x89504e47;
    entries.push({ width, height, size, offset: imgOffset, signatureOk });
  }
  return { count, entries };
}

async function main() {
  const browser = await chromium.launch({ executablePath: CHROMIUM_EXECUTABLE });

  const standardTargets = [
    { file: 'apple-touch-icon.png', size: 180, inkFraction: 0.76 },
    { file: 'icon-192.png', size: 192, inkFraction: 0.76 },
    { file: 'icon-512.png', size: 512, inkFraction: 0.76 },
    { file: 'icon-maskable-512.png', size: 512, inkFraction: 0.58 },
  ];

  console.log('Generating opaque PWA/touch icons...');
  for (const target of standardTargets) {
    const markSize = (target.inkFraction * target.size) / INK_HEIGHT_OF_VIEWBOX;
    const buffer = await renderPng(browser, {
      canvasSize: target.size,
      markSize,
      background: ACCENT,
      color: WHITE,
      transparent: false,
    });
    const outPath = path.join(PUBLIC_IMG_DIR, target.file);
    fs.writeFileSync(outPath, buffer);
    const report = verifyIcon(buffer, {
      background: ACCENT,
      color: WHITE,
      canvasSize: target.size,
      markSize,
    });
    console.log(
      `  ${target.file}: ${report.width}x${report.height}px, ` +
        `corner matches bg=${report.cornerMatchesBackground}, ink sample is mark color=${report.inkIsMarkColor}`
    );
  }

  console.log('Generating transparent favicon source PNGs...');
  const faviconSizes = [16, 32, 48];
  const faviconInkFraction = 0.94;
  const faviconImages = [];
  for (const size of faviconSizes) {
    const markSize = (faviconInkFraction * size) / INK_HEIGHT_OF_VIEWBOX;
    const buffer = await renderPng(browser, {
      canvasSize: size,
      markSize,
      color: ACCENT,
      transparent: true,
    });
    const report = verifyIcon(buffer, { color: ACCENT, canvasSize: size, markSize });
    console.log(
      `  ${size}x${size}: corner transparent=${report.cornerTransparent}, ink sample is mark color=${report.inkIsMarkColor}`
    );
    faviconImages.push({ size, buffer });
  }

  const ico = buildIco(faviconImages);
  fs.writeFileSync(FAVICON_PATH, ico);
  const parsed = parseIco(ico);
  console.log(
    `Wrote favicon.ico: ${parsed.count} entries -> ` +
      parsed.entries
        .map((e) => `${e.width}x${e.height} @${e.offset} (${e.signatureOk ? 'valid PNG sig' : 'BAD SIGNATURE'})`)
        .join(', ')
  );

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
