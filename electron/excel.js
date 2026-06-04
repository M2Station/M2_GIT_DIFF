/*
 * M2_GIT_DIFF
 * Copyright (c) 2026 OA Hsiao
 * SPDX-License-Identifier: MIT
 *
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */
'use strict';

const ExcelJS = require('exceljs');

// Named force-color keys -> solid hex (matches the swatches in RowMenu.jsx and
// the `.commit-row.force-*` CSS). Custom colors arrive as `#rrggbb` already.
const COLOR_HEX = {
  green: '2ea043',
  red: 'ff2d3c',
  blue: '3b82f6',
  yellow: 'e0a44a'
};

// Manual-link accent (matches --manual-bd in styles.css).
const MANUAL_HEX = 'a371ff';

// Normalize a color (named key or `#rrggbb`) to a 6-char uppercase hex, or null.
function toHex6(color) {
  if (!color) return null;
  if (COLOR_HEX[color]) return COLOR_HEX[color].toUpperCase();
  const m = /^#?([0-9a-fA-F]{6})$/.exec(color);
  return m ? m[1].toUpperCase() : null;
}

// Pick black/white text for contrast against a solid fill.
function textOn(hex6) {
  const r = parseInt(hex6.slice(0, 2), 16);
  const g = parseInt(hex6.slice(2, 4), 16);
  const b = parseInt(hex6.slice(4, 6), 16);
  // Relative luminance (sRGB approximation).
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? 'FF101010' : 'FFFFFFFF';
}

function applyFill(cell, hex6) {
  if (!hex6) return;
  cell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF' + hex6 }
  };
  cell.font = { ...(cell.font || {}), color: { argb: textOn(hex6) } };
}

// Attach a note as a hover comment ("tip") on a cell.
function applyNote(cell, text) {
  if (!text) return;
  cell.note = {
    texts: [{ text: String(text) }],
    margins: { insetmode: 'auto' },
    protection: { locked: 'True', lockText: 'False' }
  };
}

const LINK_SYMBOL = {
  common: '=',
  cherry: '≈',
  patch: '≈',
  manual: '🔗'
};

// Turn a git remote URL into the host's web base URL (no trailing slash).
// Handles https and scp-style SSH (git@host:org/repo.git). Returns '' when the
// remote can't be mapped to a web URL.
function remoteWebBase(remoteUrl) {
  if (!remoteUrl) return '';
  let url = String(remoteUrl).trim();
  const scp = url.match(/^[\w.-]+@([^:]+):(.+)$/);
  if (scp) {
    url = `https://${scp[1]}/${scp[2]}`;
  } else if (url.startsWith('ssh://')) {
    url = 'https://' + url.slice('ssh://'.length).replace(/^[^@]+@/, '');
  }
  url = url.replace(/\.git$/, '').replace(/\/$/, '');
  return /^https?:\/\//.test(url) ? url : '';
}

// Build the web URL that shows a single commit for the detected host.
function commitWebUrl(remoteUrl, sha) {
  const base = remoteWebBase(remoteUrl);
  if (!base || !sha) return '';
  if (/bitbucket\.org/.test(base)) return `${base}/commits/${sha}`;
  // GitHub, GitLab, Gitea, Azure DevOps and most others use /commit/<sha>.
  return `${base}/commit/${sha}`;
}

// Turn a cell into a clickable hyperlink while preserving any existing fill /
// font color. Keeps the displayed text (short SHA) but points at the commit URL.
function applyHyperlink(cell, url) {
  if (!url) return;
  const text = cell.value == null ? '' : String(cell.value);
  cell.value = { text, hyperlink: url, tooltip: url };
  const prevColor = cell.font && cell.font.color;
  cell.font = { ...(cell.font || {}), underline: true, color: prevColor || { argb: 'FF1155CC' } };
}

/**
 * Build a styled .xlsx buffer from the aligned diff export payload.
 * @param {object} data
 *   data.leftName / data.rightName  - column headers
 *   data.rows[]  - { left, right, link }
 *       left/right = { short, sha, subject, author, date, color, note } | null
 *       link = 'common' | 'cherry' | 'patch' | 'manual' | null
 *   data.manualLinks[] - { leftShort, leftSubject, rightShort, rightSubject }
 * @returns {Promise<Buffer>}
 */
async function buildWorkbook(data) {
  const { leftName = 'LEFT', rightName = 'RIGHT', rows = [], manualLinks = [] } = data || {};
  const leftRemoteUrl = (data && data.leftRemoteUrl) || '';
  const rightRemoteUrl = (data && data.rightRemoteUrl) || '';

  const wb = new ExcelJS.Workbook();
  wb.creator = 'M2_GIT_DIFF';
  wb.created = new Date();

  const ws = wb.addWorksheet('Diff', {
    views: [{ state: 'frozen', ySplit: 1 }]
  });

  ws.columns = [
    { header: `${leftName} · SHA`, key: 'lsha', width: 12 },
    { header: `${leftName} · Subject`, key: 'lsub', width: 52 },
    { header: 'Author', key: 'lauth', width: 18 },
    { header: 'Date', key: 'ldate', width: 12 },
    { header: '↔', key: 'link', width: 6 },
    { header: `${rightName} · SHA`, key: 'rsha', width: 12 },
    { header: `${rightName} · Subject`, key: 'rsub', width: 52 },
    { header: 'Author', key: 'rauth', width: 18 },
    { header: 'Date', key: 'rdate', width: 12 }
  ];

  // Header styling.
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.alignment = { vertical: 'middle' };
  for (let c = 1; c <= 9; c++) {
    head.getCell(c).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1C6E85' }
    };
  }
  head.height = 20;

  const shortDate = (iso) => (iso ? String(iso).slice(0, 10) : '');

  rows.forEach((r) => {
    const L = r.left;
    const R = r.right;
    const row = ws.addRow({
      lsha: L ? L.short : '',
      lsub: L ? L.subject : '',
      lauth: L ? L.author : '',
      ldate: L ? shortDate(L.date) : '',
      link: r.link ? LINK_SYMBOL[r.link] || '↔' : '',
      rsha: R ? R.short : '',
      rsub: R ? R.subject : '',
      rauth: R ? R.author : '',
      rdate: R ? shortDate(R.date) : ''
    });

    // Forced background color -> fill the SHA + Subject cells of that side.
    if (L) {
      const hex = toHex6(L.color);
      applyFill(row.getCell('lsha'), hex);
      applyFill(row.getCell('lsub'), hex);
      applyNote(row.getCell('lsub'), L.note);
      applyHyperlink(row.getCell('lsha'), commitWebUrl(leftRemoteUrl, L.sha));
    }
    if (R) {
      const hex = toHex6(R.color);
      applyFill(row.getCell('rsha'), hex);
      applyFill(row.getCell('rsub'), hex);
      applyNote(row.getCell('rsub'), R.note);
      applyHyperlink(row.getCell('rsha'), commitWebUrl(rightRemoteUrl, R.sha));
    }

    // Manual links get a distinct purple connector so they stand out.
    const linkCell = row.getCell('link');
    linkCell.alignment = { horizontal: 'center' };
    if (r.link === 'manual') applyFill(linkCell, MANUAL_HEX);
  });

  // Second sheet: every manual link spelled out, so they survive even when the
  // two endpoints land on different aligned rows.
  if (manualLinks.length) {
    const ml = wb.addWorksheet('Manual Links');
    ml.columns = [
      { header: 'Left SHA', key: 'lsha', width: 12 },
      { header: 'Left Subject', key: 'lsub', width: 52 },
      { header: 'Right SHA', key: 'rsha', width: 12 },
      { header: 'Right Subject', key: 'rsub', width: 52 }
    ];
    const mh = ml.getRow(1);
    mh.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    for (let c = 1; c <= 4; c++) {
      mh.getCell(c).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF' + MANUAL_HEX }
      };
    }
    manualLinks.forEach((m) => {
      const mrow = ml.addRow({
        lsha: m.leftShort || '',
        lsub: m.leftSubject || '',
        rsha: m.rightShort || '',
        rsub: m.rightSubject || ''
      });
      applyHyperlink(mrow.getCell('lsha'), commitWebUrl(leftRemoteUrl, m.leftSha));
      applyHyperlink(mrow.getCell('rsha'), commitWebUrl(rightRemoteUrl, m.rightSha));
    });
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

module.exports = { buildWorkbook };
