/*
 * M2_GIT_DIFF
 * Copyright (c) 2026 OA Hsiao
 * SPDX-License-Identifier: MIT
 *
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */
'use strict';

const LINK_LABEL = {
  common: 'Common',
  cherry: 'Cherry-pick',
  patch: 'Patch-id',
  manual: 'Manual',
  fuzzy: 'Fuzzy'
};

function remoteWebBase(remoteUrl) {
  if (!remoteUrl) return '';
  let url = String(remoteUrl).trim();
  const scp = url.match(/^[\w.-]+@([^:]+):(.+)$/);
  if (scp) {
    url = `https://${scp[1]}/${scp[2]}`;
  } else if (url.startsWith('ssh://')) {
    url = 'https://' + url.slice('ssh://'.length).replace(/^[^@]+@/, '');
  }
  // ADO remotes can be stored as https://<org>@dev.azure.com/...; remove the
  // credential/userinfo part so exported Markdown links stay clean and portable.
  url = url.replace(/^(https?:\/\/)[^/@]+@/, '$1');
  url = url.replace(/\.git$/, '').replace(/\/$/, '');
  return /^https?:\/\//.test(url) ? url : '';
}

function commitWebUrl(remoteUrl, sha) {
  const base = remoteWebBase(remoteUrl);
  if (!base || !sha) return '';
  if (/bitbucket\.org/.test(base)) return `${base}/commits/${sha}`;
  return `${base}/commit/${sha}`;
}

function rawMd(text) {
  return { __rawMarkdown: String(text || '') };
}

function isRawMd(value) {
  return value && typeof value === 'object' && value.__rawMarkdown != null;
}

function escapeTextSegment(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/`/g, '\\`')
    .replace(/\*/g, '\\*')
    .replace(/_/g, '\\_')
    .replace(/~/g, '\\~')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function cleanText(value) {
  return String(value == null ? '' : value)
    .split(/\r?\n+/)
    .map((part) => escapeTextSegment(part.trim()))
    .filter(Boolean)
    .join('<br>')
    .trim();
}

function truncateText(value, maxLength) {
  const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  if (!text || text.length <= maxLength) return text;
  return text.slice(0, Math.max(0, maxLength - 3)).trimEnd() + '...';
}

function truncateMultilineText(value, maxLength) {
  const text = String(value == null ? '' : value).trim();
  if (!text || text.length <= maxLength) return text;
  return text.slice(0, Math.max(0, maxLength - 3)).trimEnd() + '...';
}

function mdCell(value) {
  if (isRawMd(value)) return value.__rawMarkdown || '-';
  const text = cleanText(value);
  return text || '-';
}

function mdLink(label, url) {
  const text = cleanText(label) || '-';
  if (!url) return text;
  return rawMd(`[${text}](<${String(url).replace(/>/g, '%3E')}>)`);
}

function table(headers, rows) {
  const head = `| ${headers.map(mdCell).join(' | ')} |`;
  const sep = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.length
    ? rows.map((r) => `| ${r.map(mdCell).join(' | ')} |`).join('\n')
    : `| ${headers.map((_, i) => (i === 0 ? '_None_' : '')).join(' | ')} |`;
  return `${head}\n${sep}\n${body}`;
}

function shortDate(iso) {
  return iso ? String(iso).slice(0, 10) : '';
}

function dateTs(value) {
  const ts = Date.parse(value || '');
  return Number.isFinite(ts) ? ts : null;
}

function tagText(cell) {
  if (!cell) return '';
  const git = Array.isArray(cell.tags) ? cell.tags : [];
  return [cell.vtag, ...git].filter(Boolean).join(', ');
}

function sideLabel(side, data) {
  return side === 'L' ? data.leftName || 'LEFT' : data.rightName || 'RIGHT';
}

function commitLink(cell, remoteUrl) {
  if (!cell) return '-';
  return mdLink(cell.short || String(cell.sha || '').slice(0, 7), commitWebUrl(remoteUrl, cell.sha));
}

function noteRows(rows, data) {
  const out = [];
  rows.forEach((row, idx) => {
    if (row.left?.note) {
      out.push([
        idx + 1,
        sideLabel('L', data),
        commitLink(row.left, data.leftRemoteUrl),
        truncateText(row.left.subject || '', 180),
        truncateMultilineText(row.left.note, 240)
      ]);
    }
    if (row.right?.note) {
      out.push([
        idx + 1,
        sideLabel('R', data),
        commitLink(row.right, data.rightRemoteUrl),
        truncateText(row.right.subject || '', 180),
        truncateMultilineText(row.right.note, 240)
      ]);
    }
  });
  return out;
}

function collectLinkedShas(rows, contentLinks, fuzzyLinks, manualLinks) {
  const linked = { left: new Set(), right: new Set() };
  const addPair = (pair) => {
    if (pair?.leftSha) linked.left.add(pair.leftSha);
    if (pair?.rightSha) linked.right.add(pair.rightSha);
  };
  contentLinks.forEach(addPair);
  fuzzyLinks.forEach(addPair);
  manualLinks.forEach(addPair);

  rows.forEach((row) => {
    if (!row?.link) return;
    if (row.left?.sha) linked.left.add(row.left.sha);
    if (row.right?.sha) linked.right.add(row.right.sha);
  });
  return linked;
}

function buildMarkdown(data) {
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  const manualLinks = Array.isArray(data?.manualLinks) ? data.manualLinks : [];
  const fuzzyLinks = Array.isArray(data?.fuzzyLinks) ? data.fuzzyLinks : [];
  const contentLinks = Array.isArray(data?.contentLinks) ? data.contentLinks : [];
  const leftName = data?.leftName || 'LEFT';
  const rightName = data?.rightName || 'RIGHT';
  const leftRemoteUrl = data?.leftRemoteUrl || '';
  const rightRemoteUrl = data?.rightRemoteUrl || '';
  const generatedAt = new Date().toISOString();
  const linkedShas = collectLinkedShas(rows, contentLinks, fuzzyLinks, manualLinks);
  const isLinkedCell = (cell, side) => {
    if (!cell) return false;
    if (cell.linked === true) return true;
    const set = side === 'left' ? linkedShas.left : linkedShas.right;
    return !!cell.sha && set.has(cell.sha);
  };

  const oldestLoaded = { left: null, right: null };
  rows.forEach((row) => {
    const leftTs = dateTs(row.left?.date);
    const rightTs = dateTs(row.right?.date);
    if (leftTs != null && (oldestLoaded.left == null || leftTs < oldestLoaded.left)) {
      oldestLoaded.left = leftTs;
    }
    if (rightTs != null && (oldestLoaded.right == null || rightTs < oldestLoaded.right)) {
      oldestLoaded.right = rightTs;
    }
  });

  const isOutsideLoadedRange = (cell, side) => {
    if (!cell) return false;
    const ts = dateTs(cell.date);
    if (ts == null) return false;
    const peerOldest = side === 'left' ? oldestLoaded.right : oldestLoaded.left;
    return peerOldest != null && ts < peerOldest;
  };

  const isUnhandledCell = (cell, side) =>
    !!cell && !isLinkedCell(cell, side) && !isOutsideLoadedRange(cell, side);

  let leftCommits = 0;
  let rightCommits = 0;
  let leftUnique = 0;
  let rightUnique = 0;
  let leftOutsideRange = 0;
  let rightOutsideRange = 0;
  let noteCount = 0;
  const linkCounts = {
    common: Number(data?.linkCounts?.common) || 0,
    cherry: Number(data?.linkCounts?.cherry) || 0,
    patch: Number(data?.linkCounts?.patch) || 0,
    manual: Number(data?.linkCounts?.manual) || 0,
    fuzzy: Number(data?.linkCounts?.fuzzy) || 0,
    none: 0
  };

  rows.forEach((row) => {
    if (row.left) {
      leftCommits += 1;
      if (row.left.note) noteCount += 1;
    }
    if (row.right) {
      rightCommits += 1;
      if (row.right.note) noteCount += 1;
    }
    const leftOutside = !!row.left && !isLinkedCell(row.left, 'left') && isOutsideLoadedRange(row.left, 'left');
    const rightOutside = !!row.right && !isLinkedCell(row.right, 'right') && isOutsideLoadedRange(row.right, 'right');
    const leftUnhandled = isUnhandledCell(row.left, 'left');
    const rightUnhandled = isUnhandledCell(row.right, 'right');
    if (leftUnhandled || rightUnhandled) linkCounts.none += 1;
    if (leftUnhandled) leftUnique += 1;
    if (rightUnhandled) rightUnique += 1;
    if (leftOutside) leftOutsideRange += 1;
    if (rightOutside) rightOutsideRange += 1;
  });

  const contentRows = contentLinks.map((link, idx) => [
    idx + 1,
    LINK_LABEL[link.type] || link.type || 'Match',
    link.score == null ? '' : Math.round(link.score * 100) + '%',
    mdLink(link.leftShort || String(link.leftSha || '').slice(0, 7), commitWebUrl(leftRemoteUrl, link.leftSha)),
    truncateText(link.leftSubject || '', 180),
    mdLink(link.rightShort || String(link.rightSha || '').slice(0, 7), commitWebUrl(rightRemoteUrl, link.rightSha)),
    truncateText(link.rightSubject || '', 180)
  ]);

  const fuzzyRows = fuzzyLinks
    .slice()
    .sort((a, b) => (a.score ?? 1) - (b.score ?? 1))
    .map((link, idx) => [
      idx + 1,
      link.score == null ? 'n/a' : Math.round(link.score * 100) + '%',
      mdLink(link.leftShort || String(link.leftSha || '').slice(0, 7), commitWebUrl(leftRemoteUrl, link.leftSha)),
      truncateText(link.leftSubject || '', 180),
      mdLink(link.rightShort || String(link.rightSha || '').slice(0, 7), commitWebUrl(rightRemoteUrl, link.rightSha)),
      truncateText(link.rightSubject || '', 180),
      link.score == null || link.score < 0.9 ? 'Review' : 'Lower risk'
    ]);

  const uniqueRows = [];
  const outsideRows = [];
  rows.forEach((row, idx) => {
    if (isUnhandledCell(row.left, 'left')) {
      uniqueRows.push([
        idx + 1,
        leftName,
        commitLink(row.left, leftRemoteUrl),
        shortDate(row.left.date),
        row.left.author || '',
        truncateText(tagText(row.left), 120),
        truncateText(row.left.subject || '', 180),
        row.left.note ? 'Yes' : 'No'
      ]);
    } else if (row.left && !isLinkedCell(row.left, 'left') && isOutsideLoadedRange(row.left, 'left')) {
      outsideRows.push([
        idx + 1,
        leftName,
        commitLink(row.left, leftRemoteUrl),
        shortDate(row.left.date),
        row.left.author || '',
        truncateText(tagText(row.left), 120),
        truncateText(row.left.subject || '', 180),
        `Older than loaded ${rightName} range`
      ]);
    }
    if (isUnhandledCell(row.right, 'right')) {
      uniqueRows.push([
        idx + 1,
        rightName,
        commitLink(row.right, rightRemoteUrl),
        shortDate(row.right.date),
        row.right.author || '',
        truncateText(tagText(row.right), 120),
        truncateText(row.right.subject || '', 180),
        row.right.note ? 'Yes' : 'No'
      ]);
    } else if (row.right && !isLinkedCell(row.right, 'right') && isOutsideLoadedRange(row.right, 'right')) {
      outsideRows.push([
        idx + 1,
        rightName,
        commitLink(row.right, rightRemoteUrl),
        shortDate(row.right.date),
        row.right.author || '',
        truncateText(tagText(row.right), 120),
        truncateText(row.right.subject || '', 180),
        `Older than loaded ${leftName} range`
      ]);
    }
  });

  const manualRows = manualLinks.map((m, idx) => [
    idx + 1,
    mdLink(m.leftShort || String(m.leftSha || '').slice(0, 7), commitWebUrl(leftRemoteUrl, m.leftSha)),
    truncateText(m.leftSubject || '', 180),
    mdLink(m.rightShort || String(m.rightSha || '').slice(0, 7), commitWebUrl(rightRemoteUrl, m.rightSha)),
    truncateText(m.rightSubject || '', 180)
  ]);

  const alignedRowItems = rows
    .map((row, idx) => ({ row, idx }))
    .filter(({ row }) => row.link !== 'common');
  const omittedCommonAlignedRows = rows.length - alignedRowItems.length;

  const alignedRows = alignedRowItems.map(({ row, idx }) => {
    let label = LINK_LABEL[row.link] || '';
    if (!label && (isLinkedCell(row.left, 'left') || isLinkedCell(row.right, 'right'))) label = 'Linked elsewhere';
    if (!label && (isOutsideLoadedRange(row.left, 'left') || isOutsideLoadedRange(row.right, 'right'))) label = 'Outside loaded range';
    if (!label) label = row.left && row.right ? 'Unlinked display row' : 'Unique';
    return [
      idx + 1,
      label,
      row.linkScore == null ? '' : Math.round(row.linkScore * 100) + '%',
      commitLink(row.left, leftRemoteUrl),
      truncateText(tagText(row.left), 120),
      truncateText(row.left?.subject || '', 180),
      commitLink(row.right, rightRemoteUrl),
      truncateText(tagText(row.right), 120),
      truncateText(row.right?.subject || '', 180)
    ];
  });

  const notes = noteRows(rows, {
    leftName,
    rightName,
    leftRemoteUrl,
    rightRemoteUrl
  });

  const parts = [
    '# M2_GIT_DIFF Review Report',
    '',
    table(['Field', 'Value'], [
      ['Generated at', generatedAt],
      ['Left repo', leftName],
      ['Right repo', rightName],
      ['Rows exported', rows.length],
      ['Common aligned rows omitted from final table', omittedCommonAlignedRows],
      ['Manual links', manualLinks.length],
      ['Notes', noteCount]
    ]),
    '',
    '## Summary',
    '',
    table(['Metric', leftName, rightName, 'Total'], [
      ['Commits in exported rows', leftCommits, rightCommits, leftCommits + rightCommits],
      ['Unhandled unique commits', leftUnique, rightUnique, leftUnique + rightUnique],
      ['Outside loaded range', leftOutsideRange, rightOutsideRange, leftOutsideRange + rightOutsideRange],
      ['Notes', notes.filter((r) => r[1] === leftName).length, notes.filter((r) => r[1] === rightName).length, noteCount]
    ]),
    '',
    table(['Link type', 'Rows'], [
      ['Common', linkCounts.common],
      ['Cherry-pick title', linkCounts.cherry],
      ['Patch-id content', linkCounts.patch],
      ['Fuzzy', linkCounts.fuzzy],
      ['Manual', linkCounts.manual],
      ['Unhandled display rows', linkCounts.none]
    ]),
    '',
    '## Cherry / Patch-id Matches',
    '',
    table(['#', 'Type', 'Score', 'Left SHA', 'Left subject', 'Right SHA', 'Right subject'], contentRows),
    '',
    '## Unhandled Unique Commits',
    '',
    table(['Row', 'Side', 'SHA', 'Date', 'Author', 'Tags', 'Subject', 'Has note'], uniqueRows),
    '',
    '## Outside Loaded Range',
    '',
    table(['Row', 'Side', 'SHA', 'Date', 'Author', 'Tags', 'Subject', 'Reason'], outsideRows),
    '',
    '## Fuzzy Matches To Review',
    '',
    table(['Row', 'Similarity', 'Left SHA', 'Left subject', 'Right SHA', 'Right subject', 'Risk'], fuzzyRows),
    '',
    '## Manual Links',
    '',
    table(['#', 'Left SHA', 'Left subject', 'Right SHA', 'Right subject'], manualRows),
    '',
    '## Notes',
    '',
    table(['Row', 'Side', 'SHA', 'Subject', 'Note'], notes),
    '',
    '## Aligned Review Rows',
    '',
    table(['Row', 'Link', 'Score', 'Left SHA', 'Left tags', 'Left subject', 'Right SHA', 'Right tags', 'Right subject'], alignedRows),
    ''
  ];

  return parts.join('\n');
}

module.exports = { buildMarkdown };