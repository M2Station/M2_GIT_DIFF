/*
 * M2_GIT_DIFF
 * Copyright (c) 2026 OA Hsiao
 * SPDX-License-Identifier: MIT
 *
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */
// Generates a themed, synthetic demo GIF that walks through the main features
// of Git Repro Diff (column compare, connection lines, search highlight,
// right-click force color, Ctrl+Click commit detail popup, note navigator).
//
// It does NOT screen-record the real app: every frame is drawn on a canvas
// using the same color palette as src/styles.css, then encoded to an animated
// GIF with gifenc. Run with:  node scripts/make-demo-gif.mjs
//
// Output: public/demo.gif

import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import gifenc from 'gifenc';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const { GIFEncoder, quantize, applyPalette } = gifenc;

// Register a CJK-capable font so Traditional Chinese captions render as glyphs
// (not tofu boxes). Microsoft JhengHei ships with Windows and covers Latin too.
const CJK_FONT = 'C:/Windows/Fonts/msjh.ttc';
const FONT_FAMILY = existsSync(CJK_FONT) && GlobalFonts.registerFromPath(CJK_FONT, 'Demo')
  ? 'Demo'
  : 'sans-serif';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '..', 'public', 'demo.gif');

// ---- theme (mirrors src/styles.css :root) ----
const C = {
  bg: '#0a0e14',
  bgSoft: '#0f1622',
  panel: '#121a28',
  line: '#1e2a3a',
  text: '#cfe3f2',
  muted: '#6b8199',
  accent: '#36d6ff',
  accentDim: '#1c6e85',
  commonBd: '#5b6b7d',
  cherryBd: '#f0c83c',
  uniqueBd: '#eb4650',
  manualBd: '#a371ff',
  fuzzyBd: '#ff5db1',
  forceGreen: '#2ea043',
  forceRed: '#ff2d3c',
  forceBlue: '#3b82f6',
  forceYellow: '#e0a44a'
};

const W = 900;
const H = 540;
const MONO = `'${FONT_FAMILY}'`;

// ---- mock commit data ----
const LEFT = [
  { sha: 'a1b2c3d', subject: 'feat: add login flow', status: 'common' },
  { sha: 'd4e5f6a', subject: 'fix: null guard on user', status: 'cherry' },
  { sha: '9a8b7c6', subject: 'refactor: diff engine', status: 'unique' },
  { sha: 'c0ffee1', subject: 'perf: virtualize rows', status: 'common' },
  { sha: 'badf00d', subject: 'docs: update readme', status: 'manual' },
  { sha: '1234abc', subject: 'chore: bump deps', status: 'unique' },
  { sha: 'deadbee', subject: 'test: add edge cases', status: 'common' }
];
const RIGHT = [
  { sha: 'a1b2c3d', subject: 'feat: add login flow', status: 'common' },
  { sha: 'f00ba12', subject: 'fix: null guard on user', status: 'cherry' },
  { sha: 'c0ffee1', subject: 'perf: virtualize rows', status: 'common' },
  { sha: '77ee55c', subject: 'style: lint pass', status: 'unique' },
  { sha: 'abcdef0', subject: 'docs: rewrite guide', status: 'manual' },
  { sha: 'deadbee', subject: 'test: add edge cases', status: 'common' }
];

// matched display rows (left index, right index) drawn horizontal; manual is diagonal
const LINKS = [
  { l: 0, r: 0, status: 'common' },
  { l: 1, r: 1, status: 'cherry' },
  { l: 3, r: 2, status: 'common' },
  { l: 4, r: 4, status: 'manual' },
  { l: 6, r: 5, status: 'common' }
];

const bdOf = (s) =>
  s === 'cherry'
    ? C.cherryBd
    : s === 'unique'
      ? C.uniqueBd
      : s === 'manual'
        ? C.manualBd
        : s === 'fuzzy'
          ? C.fuzzyBd
          : C.commonBd;

// ---- layout ----
const TOOLBAR_H = 56;
const BODY_TOP = TOOLBAR_H + 16;
const ROW_H = 42;
const COL_W = 372;
const LEFT_X = 24;
const RIGHT_X = W - COL_W - 24;
const ROW_TX = 56; // first row top within body

function rowY(i) {
  return BODY_TOP + ROW_TX + i * ROW_H;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawBackground(ctx) {
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
}

function drawToolbar(ctx, opts = {}) {
  ctx.fillStyle = C.panel;
  ctx.fillRect(0, 0, W, TOOLBAR_H);
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, TOOLBAR_H + 0.5);
  ctx.lineTo(W, TOOLBAR_H + 0.5);
  ctx.stroke();

  // logo dot + title
  ctx.fillStyle = C.accent;
  roundRect(ctx, 20, 18, 20, 20, 5);
  ctx.fill();
  ctx.fillStyle = C.bg;
  ctx.font = `bold 11px ${MONO}`;
  ctx.fillText('GD', 23, 33);

  ctx.fillStyle = C.text;
  ctx.font = `bold 16px ${MONO}`;
  ctx.fillText('Git Repro Diff', 50, 34);

  // branch badges
  ctx.font = `12px ${MONO}`;
  badge(ctx, 200, 16, 'LEFT  ·  main', C.accent);
  badge(ctx, 330, 16, 'RIGHT ·  feature', C.forceYellow);

  // fuzzy match toggle (grayscale off / bright pink on) + threshold
  drawFuzzyToggle(ctx, 470, 15, !!opts.fuzzyOn);

  // view segmented control (right)
  segmented(ctx, W - 260, 14, ['Compare', 'L only', 'R only'], 0);
}

function drawFuzzyToggle(ctx, x, y, on) {
  ctx.font = `12px ${MONO}`;
  const label = 'Fuzzy';
  const lw = ctx.measureText(label).width + 30;
  // toggle pill
  ctx.fillStyle = on ? C.fuzzyBd : C.bgSoft;
  ctx.strokeStyle = on ? C.fuzzyBd : C.line;
  ctx.lineWidth = 1;
  roundRect(ctx, x, y, lw, 26, 6);
  ctx.fill();
  ctx.stroke();
  // small "approx" glyph (two wavy strokes) drawn instead of unsupported ≈
  const gx = x + 9;
  const gy = y + 13;
  ctx.strokeStyle = on ? '#1a0a13' : C.muted;
  ctx.lineWidth = 1.4;
  for (let r = 0; r < 2; r++) {
    const oy = gy - 2 + r * 5;
    ctx.beginPath();
    ctx.moveTo(gx, oy);
    ctx.quadraticCurveTo(gx + 2.5, oy - 3, gx + 5, oy);
    ctx.quadraticCurveTo(gx + 7.5, oy + 3, gx + 10, oy);
    ctx.stroke();
  }
  ctx.fillStyle = on ? '#1a0a13' : C.muted;
  ctx.fillText(label, x + 22, y + 17);
  // threshold box
  const tx = x + lw + 6;
  ctx.fillStyle = C.bgSoft;
  ctx.strokeStyle = on ? C.fuzzyBd : C.line;
  roundRect(ctx, tx, y, 50, 26, 6);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = on ? C.text : C.muted;
  ctx.fillText('80%', tx + 10, y + 17);
}

function badge(ctx, x, y, text, color) {
  const w = ctx.measureText(text).width + 20;
  ctx.fillStyle = C.bgSoft;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  roundRect(ctx, x, y, w, 24, 6);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fillText(text, x + 10, y + 16);
  return w;
}

function segmented(ctx, x, y, labels, active) {
  ctx.font = `12px ${MONO}`;
  let cx = x;
  labels.forEach((l, i) => {
    const w = ctx.measureText(l).width + 18;
    ctx.fillStyle = i === active ? C.accentDim : C.bgSoft;
    ctx.strokeStyle = i === active ? C.accent : C.line;
    roundRect(ctx, cx, y, w, 26, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = i === active ? C.text : C.muted;
    ctx.fillText(l, cx + 9, y + 17);
    cx += w + 6;
  });
}

function drawColumnHeader(ctx, x, label) {
  ctx.fillStyle = C.muted;
  ctx.font = `11px ${MONO}`;
  ctx.fillText(label, x + 6, BODY_TOP + 32);
}

// opts: { force, dim, active, note }
function drawRow(ctx, x, i, commit, side, opts = {}) {
  const y = rowY(i);
  const bd = bdOf(commit.status);
  let bg = C.panel;
  if (opts.force) {
    const map = {
      green: 'rgba(46,160,67,0.30)',
      red: 'rgba(255,45,60,0.34)',
      blue: 'rgba(59,130,246,0.30)',
      yellow: 'rgba(224,164,74,0.30)'
    };
    bg = map[opts.force];
  }
  ctx.globalAlpha = opts.dim ? 0.32 : 1;

  roundRect(ctx, x, y, COL_W, ROW_H - 8, 7);
  ctx.fillStyle = bg;
  ctx.fill();

  // status left bar
  ctx.fillStyle = opts.force
    ? { green: C.forceGreen, red: C.forceRed, blue: C.forceBlue, yellow: C.forceYellow }[opts.force]
    : bd;
  const barX = side === 'L' ? x : x + COL_W - 4;
  ctx.fillRect(barX, y, 4, ROW_H - 8);

  // active hit outline
  if (opts.active) {
    ctx.strokeStyle = C.accent;
    ctx.lineWidth = 2;
    roundRect(ctx, x + 1, y + 1, COL_W - 2, ROW_H - 10, 7);
    ctx.stroke();
  }

  // sha
  ctx.fillStyle = C.accent;
  ctx.font = `12px ${MONO}`;
  const shaX = side === 'L' ? x + 14 : x + 14;
  ctx.fillText(commit.sha, shaX, y + 21);

  // subject (optionally with highlight runs)
  ctx.font = `13px ${MONO}`;
  const subX = shaX + 78;
  if (opts.hl) {
    drawHighlightedText(ctx, commit.subject, subX, y + 21, opts.hl);
  } else {
    ctx.fillStyle = C.text;
    ctx.fillText(commit.subject, subX, y + 21);
  }

  // note icon
  if (opts.note) {
    const nx = side === 'L' ? x - 6 : x + COL_W + 0;
    drawNoteMark(ctx, nx, y + 6);
  }

  ctx.globalAlpha = 1;
}

// small gold "note" marker (replaces an emoji that the font lacks)
function drawNoteMark(ctx, x, y) {
  ctx.fillStyle = C.forceYellow;
  roundRect(ctx, x, y, 14, 16, 3);
  ctx.fill();
  ctx.strokeStyle = C.bg;
  ctx.lineWidth = 1;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(x + 3, y + 4 + i * 3.5);
    ctx.lineTo(x + 11, y + 4 + i * 3.5);
    ctx.stroke();
  }
}

function drawHighlightedText(ctx, text, x, y, term) {
  const lower = text.toLowerCase();
  const t = term.toLowerCase();
  let i = 0;
  let cx = x;
  while (i < text.length) {
    const idx = lower.indexOf(t, i);
    if (idx === -1) {
      ctx.fillStyle = C.text;
      ctx.fillText(text.slice(i), cx, y);
      break;
    }
    if (idx > i) {
      const pre = text.slice(i, idx);
      ctx.fillStyle = C.text;
      ctx.fillText(pre, cx, y);
      cx += ctx.measureText(pre).width;
    }
    const match = text.slice(idx, idx + term.length);
    const mw = ctx.measureText(match).width;
    ctx.fillStyle = '#ffd54a';
    roundRect(ctx, cx - 1, y - 12, mw + 2, 16, 3);
    ctx.fill();
    ctx.fillStyle = '#1a1300';
    ctx.fillText(match, cx, y);
    cx += mw;
    i = idx + term.length;
  }
}

function drawConnections(ctx, reveal = 1, highlightIdx = -1, dim = 1) {
  LINKS.forEach((lk, k) => {
    if (k / LINKS.length > reveal) return;
    const y1 = rowY(lk.l) + (ROW_H - 8) / 2;
    const y2 = rowY(lk.r) + (ROW_H - 8) / 2;
    const x1 = LEFT_X + COL_W;
    const x2 = RIGHT_X;
    ctx.strokeStyle = bdOf(lk.status);
    ctx.lineWidth = highlightIdx === k ? 3 : 1.6;
    ctx.globalAlpha = (highlightIdx === -1 || highlightIdx === k ? 1 : 0.4) * dim;
    const midX = (x1 + x2) / 2;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(midX, y1);
    ctx.lineTo(midX, y2);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    // node dots
    ctx.fillStyle = bdOf(lk.status);
    ctx.beginPath();
    ctx.arc(x1, y1, 3, 0, Math.PI * 2);
    ctx.arc(x2, y2, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  });
}

function drawFuzzyConnection(ctx, li, ri) {
  const y1 = rowY(li) + (ROW_H - 8) / 2;
  const y2 = rowY(ri) + (ROW_H - 8) / 2;
  const x1 = LEFT_X + COL_W;
  const x2 = RIGHT_X;
  const midX = (x1 + x2) / 2;
  const trace = () => {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(midX, y1);
    ctx.lineTo(midX, y2);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  };
  // soft glow underlay so the thin dashed line survives GIF downscale + quantize
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(255,93,177,0.30)';
  ctx.lineWidth = 9;
  ctx.setLineDash([]);
  trace();
  // bold solid pink core (no dash gaps -> always visible) ...
  ctx.strokeStyle = C.fuzzyBd;
  ctx.lineWidth = 4.5;
  trace();
  // ... plus a contrasting dashed overlay to keep the "fuzzy" look
  ctx.strokeStyle = '#ffd1ea';
  ctx.lineWidth = 1.6;
  ctx.setLineDash([7, 6]);
  trace();
  ctx.setLineDash([]);
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
  ctx.fillStyle = C.fuzzyBd;
  ctx.beginPath();
  ctx.arc(x1, y1, 4, 0, Math.PI * 2);
  ctx.arc(x2, y2, 4, 0, Math.PI * 2);
  ctx.fill();
  // score badge near the mid bend
  ctx.font = `11px ${MONO}`;
  const t = '96%';
  const bw = ctx.measureText(t).width + 12;
  const by = (y1 + y2) / 2 - 9;
  ctx.fillStyle = 'rgba(255,93,177,0.18)';
  ctx.strokeStyle = C.fuzzyBd;
  ctx.lineWidth = 1;
  roundRect(ctx, midX - bw / 2, by, bw, 18, 5);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = C.fuzzyBd;
  ctx.fillText(t, midX - bw / 2 + 6, by + 13);
}

function drawCaption(ctx, title, sub) {
  const h = 58;
  ctx.fillStyle = 'rgba(10,14,20,0.86)';
  ctx.fillRect(0, H - h, W, h);
  ctx.strokeStyle = C.line;
  ctx.beginPath();
  ctx.moveTo(0, H - h + 0.5);
  ctx.lineTo(W, H - h + 0.5);
  ctx.stroke();
  ctx.fillStyle = C.accent;
  ctx.font = `bold 16px ${MONO}`;
  ctx.fillText(title, 24, H - h + 26);
  ctx.fillStyle = C.muted;
  ctx.font = `12px ${MONO}`;
  ctx.fillText(sub, 24, H - h + 46);
}

function drawCursor(ctx, x, y) {
  ctx.fillStyle = C.text;
  ctx.strokeStyle = C.bg;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y + 16);
  ctx.lineTo(x + 4, y + 12);
  ctx.lineTo(x + 7, y + 18);
  ctx.lineTo(x + 9, y + 17);
  ctx.lineTo(x + 6, y + 11);
  ctx.lineTo(x + 11, y + 11);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function drawSearchPanel(ctx, query, hits) {
  const x = W - 320;
  const y = BODY_TOP + 4;
  const w = 296;
  const h = 132;
  ctx.fillStyle = C.panel;
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 1;
  roundRect(ctx, x, y, w, h, 10);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = C.text;
  ctx.font = `bold 13px ${MONO}`;
  ctx.fillText('Search', x + 12, y + 24);

  // input
  ctx.fillStyle = C.bgSoft;
  ctx.strokeStyle = C.accent;
  roundRect(ctx, x + 12, y + 34, w - 24, 26, 6);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = C.text;
  ctx.font = `13px ${MONO}`;
  ctx.fillText(query + '▌', x + 20, y + 51);

  // hits + nav
  ctx.fillStyle = C.muted;
  ctx.font = `12px ${MONO}`;
  ctx.fillText(`${hits} hits`, x + 14, y + 80);
  navBtn(ctx, x + w - 70, y + 68, '↑');
  navBtn(ctx, x + w - 40, y + 68, '↓');

  // separator + notes section
  ctx.strokeStyle = C.line;
  ctx.beginPath();
  ctx.moveTo(x + 12, y + 94);
  ctx.lineTo(x + w - 12, y + 94);
  ctx.stroke();
  ctx.fillStyle = C.forceYellow;
  ctx.font = `bold 12px ${MONO}`;
  ctx.fillText('Notes', x + 14, y + 116);
  ctx.fillStyle = C.muted;
  ctx.font = `12px ${MONO}`;
  ctx.fillText('2 notes', x + 96, y + 116);
  navBtn(ctx, x + w - 70, y + 104, '↑');
  navBtn(ctx, x + w - 40, y + 104, '↓');
}

function navBtn(ctx, x, y, glyph) {
  ctx.fillStyle = C.bgSoft;
  ctx.strokeStyle = C.line;
  roundRect(ctx, x, y, 24, 22, 5);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = C.accent;
  ctx.font = `13px ${MONO}`;
  ctx.fillText(glyph, x + 7, y + 16);
}

function drawContextMenu(ctx, x, y) {
  const w = 190;
  const h = 150;
  ctx.fillStyle = C.panel;
  ctx.strokeStyle = C.line;
  roundRect(ctx, x, y, w, h, 8);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = C.muted;
  ctx.font = `11px ${MONO}`;
  ctx.fillText('c0ffee1', x + 12, y + 20);
  ctx.fillStyle = C.text;
  ctx.font = `12px ${MONO}`;
  ctx.fillText('新增 / 編輯註記', x + 12, y + 42);
  ctx.strokeStyle = C.line;
  ctx.beginPath();
  ctx.moveTo(x + 8, y + 52);
  ctx.lineTo(x + w - 8, y + 52);
  ctx.stroke();
  ctx.fillStyle = C.muted;
  ctx.font = `11px ${MONO}`;
  ctx.fillText('強制背景顏色', x + 12, y + 70);
  const sw = [C.forceGreen, C.forceRed, C.forceBlue, C.forceYellow];
  sw.forEach((col, i) => {
    const sx = x + 12 + i * 42;
    ctx.fillStyle = C.bgSoft;
    ctx.strokeStyle = i === 2 ? C.text : C.line;
    roundRect(ctx, sx, y + 80, 36, 28, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(sx + 18, y + 94, 7, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.fillStyle = C.muted;
  ctx.font = `12px ${MONO}`;
  ctx.fillText('✕ 清除顏色', x + 12, y + 132);
}

function drawWebLinkPill(ctx, x, y) {
  ctx.font = `11px ${MONO}`;
  const label = 'Web';
  const tw = ctx.measureText(label).width;
  const w = tw + 30;
  ctx.fillStyle = 'rgba(54,214,255,0.12)';
  ctx.strokeStyle = C.accent;
  ctx.lineWidth = 1;
  roundRect(ctx, x, y, w, 18, 5);
  ctx.fill();
  ctx.stroke();
  // tiny globe glyph (circle + meridians) so we avoid emoji tofu
  const gx = x + 10;
  const gy = y + 9;
  ctx.strokeStyle = C.accent;
  ctx.beginPath();
  ctx.arc(gx, gy, 5, 0, Math.PI * 2);
  ctx.moveTo(gx - 5, gy);
  ctx.lineTo(gx + 5, gy);
  ctx.moveTo(gx, gy - 5);
  ctx.lineTo(gx, gy + 5);
  ctx.stroke();
  ctx.ellipse(gx, gy, 2.4, 5, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = C.accent;
  ctx.fillText(label, x + 18, y + 13);
}

function drawDetailPopup(ctx, hl) {
  const x = 250;
  const y = 120;
  const w = 420;
  const h = 280;
  // shadow
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  roundRect(ctx, x + 6, y + 8, w, h, 12);
  ctx.fill();

  ctx.fillStyle = '#16202f';
  ctx.strokeStyle = 'rgba(120,160,200,0.25)';
  ctx.lineWidth = 1;
  roundRect(ctx, x, y, w, h, 12);
  ctx.fill();
  ctx.stroke();

  // header
  ctx.fillStyle = 'rgba(54,214,255,0.06)';
  roundRect(ctx, x, y, w, 36, 12);
  ctx.fill();
  ctx.fillStyle = C.accent;
  ctx.font = `bold 12px ${MONO}`;
  ctx.fillText('LEFT', x + 14, y + 23);
  ctx.fillStyle = C.muted;
  ctx.font = `11px ${MONO}`;
  ctx.fillText('Common · 相同 SHA', x + 64, y + 23);
  // HL input
  ctx.fillStyle = C.bg;
  ctx.strokeStyle = C.accent;
  roundRect(ctx, x + w - 130, y + 8, 90, 22, 5);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = C.text;
  ctx.font = `11px ${MONO}`;
  ctx.fillText(hl + '▌', x + w - 124, y + 23);
  ctx.fillStyle = C.muted;
  ctx.fillText('✕', x + w - 22, y + 23);

  // meta block
  let cy = y + 58;
  ctx.fillStyle = 'rgba(54,214,255,0.05)';
  ctx.fillRect(x + 12, y + 44, w - 24, 66);
  const meta = [
    ['SHA', 'c0ffee1', C.accent],
    ['作者', 'Ada Lovelace <ada@dev>', C.text],
    ['日期', '2026-05-30 14:21', C.text]
  ];
  meta.forEach(([k, v, col], idx) => {
    ctx.fillStyle = C.muted;
    ctx.font = `11px ${MONO}`;
    ctx.fillText(k, x + 22, cy);
    ctx.fillStyle = col;
    ctx.font = `12px ${MONO}`;
    ctx.fillText(v, x + 70, cy);
    // clickable Web link next to the SHA row
    if (idx === 0) drawWebLinkPill(ctx, x + w - 86, cy - 13);
    cy += 20;
  });

  // subject
  ctx.fillStyle = C.text;
  ctx.font = `bold 14px ${MONO}`;
  ctx.fillText('perf: virtualize rows', x + 22, y + 134);

  // related block
  ctx.fillStyle = 'rgba(163,113,255,0.10)';
  ctx.strokeStyle = C.manualBd;
  roundRect(ctx, x + 16, y + 146, w - 32, 44, 8);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = C.manualBd;
  ctx.font = `11px ${MONO}`;
  ctx.fillText('Related item · RIGHT', x + 26, y + 164);
  ctx.fillStyle = C.text;
  ctx.font = `12px ${MONO}`;
  ctx.fillText('c0ffee1  perf: virtualize rows', x + 26, y + 182);

  // body (markdown) with highlight
  ctx.font = `12px ${MONO}`;
  const bodyLines = ['Cut render cost by only', 'painting rows in the viewport.'];
  let by = y + 214;
  bodyLines.forEach((ln) => {
    if (hl) drawHighlightedText(ctx, ln, x + 22, by, hl);
    else {
      ctx.fillStyle = C.muted;
      ctx.fillText(ln, x + 22, by);
    }
    by += 20;
  });

  // resize grip
  ctx.strokeStyle = C.muted;
  ctx.lineWidth = 1;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(x + w - 6 - i * 4, y + h - 4);
    ctx.lineTo(x + w - 4, y + h - 6 - i * 4);
    ctx.stroke();
  }
}

// ---- scene composition ----
function baseScene(ctx, opts = {}) {
  drawBackground(ctx);
  drawToolbar(ctx, { fuzzyOn: opts.fuzzyOn });
  drawColumnHeader(ctx, LEFT_X, 'LEFT  ·  main');
  drawColumnHeader(ctx, RIGHT_X, 'RIGHT  ·  feature');
  const leftData = opts.leftData || LEFT;
  const rightData = opts.rightData || RIGHT;
  leftData.forEach((c, i) => drawRow(ctx, LEFT_X, i, c, 'L', opts.left?.[i] || {}));
  rightData.forEach((c, i) => drawRow(ctx, RIGHT_X, i, c, 'R', opts.right?.[i] || {}));
  if (opts.reveal !== undefined) drawConnections(ctx, opts.reveal, opts.linkHi ?? -1, opts.linkDim ?? 1);
}

function buildFrames() {
  const frames = [];
  const push = (draw, delay) => frames.push({ draw, delay });

  // Scene 1: intro + columns + lines drawing in
  for (let s = 0; s <= 5; s++) {
    push((ctx) => {
      baseScene(ctx, { reveal: s / 5 });
      drawCaption(
        ctx,
        '雙欄比對 + 連接線',
        '共同 SHA(灰) · cherry-pick(黃) · 單側獨有(紅) · 手動連結(紫)'
      );
    }, s === 5 ? 900 : 260);
  }

  // Scene 2: select a connection (highlight)
  push((ctx) => {
    baseScene(ctx, { reveal: 1, linkHi: 1 });
    drawCursor(ctx, (LEFT_X + COL_W + RIGHT_X) / 2, rowY(1) + 8);
    drawCaption(ctx, '點選連線', '高亮該配對，其餘連線變淡；可直接點線或點列');
  }, 1100);

  // Scene 2.5: turn on Fuzzy Match -> two unique commits link by content similarity
  const fuzzL = LEFT.map((c, i) => (i === 2 ? { ...c, status: 'fuzzy' } : c));
  const fuzzR = RIGHT.map((c, i) => (i === 3 ? { ...c, status: 'fuzzy' } : c));
  // cursor moving onto the toggle, still off
  push((ctx) => {
    baseScene(ctx, { reveal: 1, fuzzyOn: false });
    drawCursor(ctx, 500, 40);
    drawCaption(ctx, 'Fuzzy Match（內容相似度）', '工具列按鈕預設關閉（灰階）；門檻預設 80%');
  }, 900);
  // toggle on: pink dashed link appears between the two still-unique rows
  push((ctx) => {
    baseScene(ctx, { reveal: 1, fuzzyOn: true, leftData: fuzzL, rightData: fuzzR, linkDim: 0.35 });
    drawFuzzyConnection(ctx, 2, 3);
    drawCursor(ctx, 500, 40);
    drawCaption(
      ctx,
      'Fuzzy Match（內容相似度）',
      'SHA/標題/patch-id 都比不上時，比變更行包含率 ≥ 80% → 粉紅粗虛線配對'
    );
  }, 2200);

  // Scene 3: search highlight
  const q = 'fix';
  for (let i = 1; i <= q.length; i++) {
    const sub = q.slice(0, i);
    push((ctx) => {
      const hlMap = (arr) =>
        arr.map((c) => (c.subject.toLowerCase().includes(sub) ? { hl: sub } : {}));
      baseScene(ctx, { reveal: 1, left: hlMap(LEFT), right: hlMap(RIGHT) });
      drawSearchPanel(ctx, sub, 2);
      drawCaption(ctx, '搜尋並高亮', 'Ctrl+F 搜尋；命中文字即時高亮，F3 循環跳轉');
    }, 360);
  }
  push((ctx) => {
    const hlMap = (arr) =>
      arr.map((c) => (c.subject.toLowerCase().includes('fix') ? { hl: 'fix' } : {}));
    const l = hlMap(LEFT);
    l[1] = { hl: 'fix', active: true };
    baseScene(ctx, { reveal: 1, left: l, right: hlMap(RIGHT) });
    drawSearchPanel(ctx, 'fix', 2);
    drawCaption(ctx, '搜尋並高亮', 'Ctrl+F 搜尋；命中文字即時高亮，F3 循環跳轉');
  }, 1100);

  // Scene 4: right-click context menu -> force blue color
  push((ctx) => {
    baseScene(ctx, { reveal: 1 });
    drawContextMenu(ctx, LEFT_X + 120, rowY(3) + 10);
    drawCursor(ctx, LEFT_X + 120 + 66, rowY(3) + 10 + 94);
    drawCaption(ctx, '右鍵強制背景顏色', '綠 / 亮紅 / 藍 / 黃 — 凸顯重點 commit');
  }, 1200);
  push((ctx) => {
    const l = LEFT.map((c, i) => (i === 3 ? { force: 'blue' } : {}));
    baseScene(ctx, { reveal: 1, left: l });
    drawCaption(ctx, '右鍵強制背景顏色', '綠 / 亮紅 / 藍 / 黃 — 凸顯重點 commit');
  }, 1100);

  // Scene 5: Ctrl+Click -> detail popup (with HL syncing)
  push((ctx) => {
    const l = LEFT.map((c, i) => (i === 3 ? { force: 'blue' } : {}));
    baseScene(ctx, { reveal: 1, left: l });
    drawDetailPopup(ctx, '');
    drawCaption(ctx, 'Ctrl+點選 → 詳情浮窗', 'Markdown 內文 · Related item · 🌐 Web 連結開遠端頁面 · 可拖拉縮放、可多開');
  }, 1100);
  push((ctx) => {
    const l = LEFT.map((c, i) => (i === 3 ? { force: 'blue' } : {}));
    baseScene(ctx, { reveal: 1, left: l });
    drawDetailPopup(ctx, 'row');
    drawCaption(ctx, 'HL 即時高亮', '浮窗右上 HL 欄位高亮符合字，開啟時自動帶入搜尋字');
  }, 1300);

  // Scene 6: notes navigator
  push((ctx) => {
    const l = LEFT.map((c, i) => (i === 1 || i === 4 ? { note: true } : {}));
    const r = RIGHT.map(() => ({}));
    l[4] = { note: true, active: true };
    baseScene(ctx, { reveal: 1, left: l, right: r });
    drawSearchPanel(ctx, '', 0);
    drawCaption(ctx, '註記導航', '搜尋面板的 Notes 區，↑/↓ 在有註記的 commit 間跳躍');
  }, 1500);

  return frames;
}

function run() {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.textBaseline = 'alphabetic';

  const gif = GIFEncoder();
  const frames = buildFrames();
  for (const f of frames) {
    f.draw(ctx);
    const { data } = ctx.getImageData(0, 0, W, H);
    const palette = quantize(data, 256);
    const index = applyPalette(data, palette);
    gif.writeFrame(index, W, H, { palette, delay: f.delay });
  }
  gif.finish();

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, gif.bytes());
  console.log(`Wrote ${OUT} (${frames.length} frames)`);
}

run();
