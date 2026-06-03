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
    }
    if (R) {
      const hex = toHex6(R.color);
      applyFill(row.getCell('rsha'), hex);
      applyFill(row.getCell('rsub'), hex);
      applyNote(row.getCell('rsub'), R.note);
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
      ml.addRow({
        lsha: m.leftShort || '',
        lsub: m.leftSubject || '',
        rsha: m.rightShort || '',
        rsub: m.rightSubject || ''
      });
    });
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

module.exports = { buildWorkbook };
