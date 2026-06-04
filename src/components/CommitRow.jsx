/*
 * M2_GIT_DIFF
 * Copyright (c) 2026 OA Hsiao
 * SPDX-License-Identifier: MIT
 *
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */
import React from 'react';
import { useT } from '../lib/i18n.js';

function highlight(text, query) {
  if (!query || !text) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark>{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

function shortDate(iso) {
  if (!iso) return '';
  // iso-strict like 2026-06-03T12:34:56+08:00
  return iso.slice(0, 10);
}

// Turn a `#rrggbb` hex into a translucent rgba fill for the forced background.
function hexToTint(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function CommitRow({ commit, side, query, dimmed, isHit, selected, height, top, onSelect, manualLinked, pending, onNode, activeHit, hasNote, onNoteOpen, color, onRowMenu, onDetail }) {
  const t = useT();
  // A `#rrggbb` color is a user-defined custom swatch: paint it inline since it
  // has no `.force-*` CSS class. Named keys still use the class.
  const isHex = typeof color === 'string' && color.charAt(0) === '#';
  const cls = [
    'commit-row',
    commit.status, // common | cherry | unique
    dimmed ? 'dimmed' : '',
    isHit ? 'hit' : '',
    activeHit ? 'active-hit' : '',
    selected ? 'selected' : '',
    commit.matchId ? 'linkable' : '',
    manualLinked ? 'manual' : '',
    hasNote ? 'has-note' : '',
    color && !isHex ? 'force-' + color : ''
  ]
    .filter(Boolean)
    .join(' ');

  // Inline background/accent for custom hex colors (tinted fill + solid accent).
  const rowStyle = { height, top };
  if (isHex) {
    rowStyle.background = hexToTint(color, 0.25);
    rowStyle.borderLeftColor = color;
    if (side === 'R') rowStyle.borderRightColor = color;
  }

  const handleClick = (e) => {
    e.stopPropagation();
    // Ctrl/Cmd+Click -> open the floating commit detail popup.
    if ((e.ctrlKey || e.metaKey) && typeof onDetail === 'function') {
      e.preventDefault();
      onDetail(side, commit.sha, e.clientX, e.clientY);
      return;
    }
    // Toggle the match selection (matched rows only) AND move the keyboard
    // cursor to this row so Arrow Up/Down continue from where the user clicked.
    const rowKey = commit.sha + ':' + commit.index;
    const nextId = commit.matchId ? (selected ? null : commit.matchId) : null;
    onSelect(nextId, rowKey);
  };

  // Right-click anywhere on the row opens the context menu (note + color).
  const handleContextMenu = (e) => {
    if (typeof onRowMenu !== 'function') return;
    e.preventDefault();
    e.stopPropagation();
    onRowMenu(side, commit.sha, e.clientX, e.clientY);
  };

  // Click the note icon to view/edit the existing note.
  const handleNoteIcon = (e) => {
    e.stopPropagation();
    onNoteOpen(side, commit.sha, e.clientX, e.clientY);
  };

  // Only unmatched commits expose a node to draw a manual link from/to.
  const showNode = commit.status === 'unique' && typeof onNode === 'function';
  const handleNode = (e) => {
    e.stopPropagation();
    onNode(side, commit.sha);
  };
  const nodeCls = [
    'node-handle',
    `node-${side}`,
    manualLinked ? 'linked' : '',
    pending ? 'pending' : ''
  ]
    .filter(Boolean)
    .join(' ');
  const nodeTitle = manualLinked
    ? t('row.nodeDisconnect')
    : pending
    ? t('row.nodePick')
    : t('row.nodeStart');

  const title = `${commit.short}  ${commit.subject}\n${commit.author} · ${commit.authorDate}\n${commit.body || ''}`;

  return (
    <div
      className={cls}
      style={rowStyle}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      title={title}
      data-side={side}
    >
      <span className="sha">{highlight(commit.short, query)}</span>
      <span className="date">{shortDate(commit.authorDate)}</span>
      <span className="subject">{highlight(commit.subject, query)}</span>
      <span className="author">{commit.author}</span>
      {hasNote && (
        <button
          type="button"
          className="note-icon"
          onClick={handleNoteIcon}
          title={t('row.viewEditNote')}
          aria-label={t('row.viewNote')}
        >
          📝
        </button>
      )}
      {showNode && (
        <button type="button" className={nodeCls} onClick={handleNode} title={nodeTitle} aria-label={nodeTitle} />
      )}
    </div>
  );
}

// Rendered thousands of times in the virtualized columns; memoize so unrelated
// parent state changes (scroll, fuzzy toggle, opening popups) don't re-render
// every row. All callback props are useCallback-stable in App.jsx.
export default React.memo(CommitRow);
