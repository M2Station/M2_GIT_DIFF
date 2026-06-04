/*
 * M2_GIT_DIFF
 * Copyright (c) 2026 OA Hsiao
 * SPDX-License-Identifier: MIT
 *
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */
import React, { useRef, useState, useCallback, useEffect } from 'react';
import { useT } from '../lib/i18n.js';

// Scope checkboxes shown inside the panel. `key` matches the fields tested in
// matchesQuery(); the label is translated via `search.scope.<key>`.
const SCOPES = ['subject', 'body', 'sha', 'author', 'date'];

// A floating, draggable search window. Opened with Ctrl+F. Lets the user pick
// which fields to search (multi-select) and cycle matches with the arrows / F3.
export default function SearchPanel({
  query,
  onQuery,
  scopes,
  onToggleScope,
  matchCount,
  filterOnly,
  onToggleFilter,
  onPrev,
  onNext,
  onClose,
  inputRef,
  onInputKeyDown,
  noteCount,
  onPrevNote,
  onNextNote
}) {
  const t = useT();
  // Position is local so dragging never re-renders the rest of the app.
  const [pos, setPos] = useState({ x: window.innerWidth - 380, y: 70 });
  const dragRef = useRef(null);

  const onDragStart = useCallback((e) => {
    // Ignore drags that start on a control inside the header.
    if (e.target.closest('button, input, label')) return;
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    dragRef.current = { startX, startY, baseX: pos.x, baseY: pos.y };

    const onMove = (ev) => {
      const d = dragRef.current;
      if (!d) return;
      const nx = d.baseX + (ev.clientX - d.startX);
      const ny = d.baseY + (ev.clientY - d.startY);
      // Keep the panel within the viewport.
      const maxX = window.innerWidth - 60;
      const maxY = window.innerHeight - 40;
      setPos({
        x: Math.min(Math.max(-260, nx), maxX),
        y: Math.min(Math.max(0, ny), maxY)
      });
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [pos.x, pos.y]);

  // Keep the panel on-screen if the window is resized smaller.
  useEffect(() => {
    const onResize = () =>
      setPos((p) => ({
        x: Math.min(p.x, window.innerWidth - 60),
        y: Math.min(p.y, window.innerHeight - 40)
      }));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return (
    <div
      className="search-panel"
      style={{ left: pos.x, top: pos.y }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="sp-header" onPointerDown={onDragStart}>
        <span className="sp-title">{t('search.title')}</span>
        <span className="sp-spacer" />
        <button className="sp-close" onClick={onClose} title={t('common.closeEsc')} aria-label={t('common.close')}>
          ✕
        </button>
      </div>

      <div className="sp-body">
        <div className="sp-row">
          <input
            ref={inputRef}
            className="search"
            type="text"
            placeholder={t('search.placeholder')}
            aria-label={t('search.inputAria')}
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={onInputKeyDown}
          />
        </div>

        <div className="sp-scopes">
          {SCOPES.map((key) => {
            const label = t('search.scope.' + key);
            return (
              <label key={key} className="sp-scope" title={t('search.searchIn', { label })}>
                <input
                  type="checkbox"
                  checked={!!scopes[key]}
                  onChange={() => onToggleScope(key)}
                />
                <span>{label}</span>
              </label>
            );
          })}
        </div>

        <div className="sp-row sp-actions">
          <span className="match-count">{query ? t('search.hits', { count: matchCount }) : '\u00a0'}</span>
          <span className="sp-spacer" />
          <button className="btn ghost" onClick={onPrev} disabled={!query} title={t('search.previous')}>
            ↑
          </button>
          <button className="btn ghost" onClick={onNext} disabled={!query} title={t('search.next')}>
            ↓
          </button>
          <button
            className={'btn toggle' + (filterOnly ? ' on' : '')}
            onClick={onToggleFilter}
            disabled={!query}
            title={t('search.filterOnly')}
          >
            {filterOnly ? '☑' : '☐'} {t('search.filter')}
          </button>
        </div>

        <div className="sp-sep" />

        <div className="sp-row sp-notes">
          <span className="sp-notes-label">{t('search.notes')}</span>
          <span className="match-count">{noteCount ? t('search.noteCount', { count: noteCount }) : t('search.noNotes')}</span>
          <span className="sp-spacer" />
          <button
            className="btn ghost"
            onClick={onPrevNote}
            disabled={!noteCount}
            title={t('search.prevNote')}
          >
            ↑
          </button>
          <button
            className="btn ghost"
            onClick={onNextNote}
            disabled={!noteCount}
            title={t('search.nextNote')}
          >
            ↓
          </button>
        </div>
      </div>
    </div>
  );
}
