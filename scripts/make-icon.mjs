/*
 * M2_GIT_DIFF
 * Copyright (c) 2026 OA Hsiao
 * SPDX-License-Identifier: MIT
 *
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */
// Converts public/icon.svg into a multi-size public/icon.ico for the Windows
// Explorer context-menu icon. Uses @napi-rs/canvas to rasterize the SVG and
// packs PNG-compressed frames into the ICO container (supported on Windows 7+).
//
// Run: node scripts/make-icon.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const svgPath = join(root, 'public', 'icon.svg');
const icoPath = join(root, 'public', 'icon.ico');

const sizes = [16, 24, 32, 48, 64, 128, 256];

const svg = readFileSync(svgPath);

const pngs = await Promise.all(
  sizes.map(async (size) => {
    // Rasterize the SVG directly at the target size so each frame is rendered
    // crisply from vectors instead of being downscaled from one bitmap.
    const image = await loadImage(svg, { maxWidth: size, maxHeight: size });
    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, size, size);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, 0, 0, size, size);
    return canvas.encode('png');
  }),
);

// Build the ICO container: ICONDIR header + one ICONDIRENTRY per frame + PNGs.
const count = pngs.length;
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: 1 = icon
header.writeUInt16LE(count, 4);

const entries = Buffer.alloc(count * 16);
let offset = 6 + count * 16;
pngs.forEach((png, i) => {
  const size = sizes[i];
  const e = i * 16;
  entries.writeUInt8(size >= 256 ? 0 : size, e + 0); // width (0 = 256)
  entries.writeUInt8(size >= 256 ? 0 : size, e + 1); // height (0 = 256)
  entries.writeUInt8(0, e + 2); // palette
  entries.writeUInt8(0, e + 3); // reserved
  entries.writeUInt16LE(1, e + 4); // color planes
  entries.writeUInt16LE(32, e + 6); // bits per pixel
  entries.writeUInt32LE(png.length, e + 8); // image data size
  entries.writeUInt32LE(offset, e + 12); // image data offset
  offset += png.length;
});

const ico = Buffer.concat([header, entries, ...pngs]);
writeFileSync(icoPath, ico);
console.log(`[done] wrote ${icoPath} (${count} frames, ${ico.length} bytes)`);
