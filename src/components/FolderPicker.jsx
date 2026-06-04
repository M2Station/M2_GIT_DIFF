/*
 * M2_GIT_DIFF
 * Copyright (c) 2026 OA Hsiao
 * SPDX-License-Identifier: MIT
 *
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */
import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useT } from '../lib/i18n.js';

// A compact, fully keyboard-driven folder picker that replaces the OS native
// directory dialog for "Open repo". It scans each level for git repositories
// (including nested submodule repos), colours them, remembers the last visited
// location, and offers a live name filter plus a "repos only" toggle.
//
// Keyboard:
//   ↑ / ↓            move the highlight
//   Enter            open highlighted repo, or descend into a plain folder
//   → (or Tab)       descend into the highlighted folder (even a repo — submodules)
//   ← / Backspace    go up one level
//   Ctrl+Enter       select the highlighted folder even if it is not a repo
//   Ctrl+G           toggle the "repos only" filter
//   any text         filter the list by name (Backspace edits the filter while typing)
//   Esc              cancel

const DRIVES = ':drives:';

export default function FolderPicker({ onPick, onClose }) {
  const t = useT();
  const [view, setView] = useState(null); // { path, parent, canGoUp, isRepo, isDriveList, entries }
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [index, setIndex] = useState(0);
  const [filter, setFilter] = useState('');
  const [reposOnly, setReposOnly] = useState(false);
  const listRef = useRef(null);
  const rowRefs = useRef([]);

  const load = useCallback(async (path) => {
    setLoading(true);
    setError('');
    try {
      const res = await window.api.listDir(path);
      if (!res || res.ok === false) {
        setError((res && res.error) || 'Cannot read directory');
        return;
      }
      setView(res);
      setIndex(0);
      setFilter('');
      if (!res.isDriveList && res.path && res.path !== DRIVES) {
        window.api.rememberDir(res.path);
      }
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load: backend starts at the remembered location (or home).
  useEffect(() => {
    load(undefined);
  }, [load]);

  // Entries after applying the name filter and the repos-only toggle.
  const entries = useMemo(() => {
    const all = view?.entries || [];
    const q = filter.trim().toLowerCase();
    return all.filter((e) => {
      if (reposOnly && !e.isRepo && !e.isDrive) return false;
      if (q && !e.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [view, filter, reposOnly]);

  // Keep the highlight in range when the filtered list shrinks.
  useEffect(() => {
    if (index >= entries.length) setIndex(entries.length ? entries.length - 1 : 0);
  }, [entries.length, index]);

  // Scroll the highlighted row into view.
  useEffect(() => {
    const el = rowRefs.current[index];
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }, [index, entries]);

  const goUp = useCallback(() => {
    if (view?.parent) load(view.parent);
  }, [view, load]);

  const descend = useCallback(
    (entry) => {
      const target = entry || entries[index];
      if (target) load(target.path);
    },
    [entries, index, load]
  );

  const select = useCallback(
    (p) => {
      if (!p || p === DRIVES) return;
      window.api.rememberDir(p);
      onPick(p);
    },
    [onPick]
  );

  // Enter behaviour: open a repo, otherwise drill into the folder.
  const activate = useCallback(
    (entry) => {
      const target = entry || entries[index];
      if (!target) return;
      if (target.isRepo) select(target.path);
      else descend(target);
    },
    [entries, index, select, descend]
  );

  const onKeyDown = useCallback(
    (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setIndex((i) => Math.min(i + 1, entries.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === 'ArrowLeft' || (e.key === 'Backspace' && !filter)) {
        e.preventDefault();
        goUp();
        return;
      }
      if (e.key === 'ArrowRight' || e.key === 'Tab') {
        e.preventDefault();
        descend();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.ctrlKey) {
          // Force-select the highlighted folder (or the current dir).
          const target = entries[index];
          select(target ? target.path : view?.path);
        } else {
          activate();
        }
        return;
      }
      if (e.key === 'g' && e.ctrlKey) {
        e.preventDefault();
        setReposOnly((v) => !v);
        return;
      }
      // Typing edits the filter; Backspace trims it.
      if (e.key === 'Backspace') {
        e.preventDefault();
        setFilter((f) => f.slice(0, -1));
        return;
      }
      if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
        setFilter((f) => f + e.key);
        setIndex(0);
      }
    },
    [entries, index, filter, view, goUp, descend, activate, select, onClose]
  );

  const current = view?.path && view.path !== DRIVES ? view.path : t('picker.thisPc');

  return (
    <div className="fp-backdrop" onMouseDown={onClose}>
      <div
        className="fp-popup"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        tabIndex={-1}
        ref={(el) => el && el.focus()}
      >
        <div className="fp-head">
          <span className="fp-title">{t('picker.title')}</span>
          <span className="fp-spacer" />
          <button className="fp-x" onClick={onClose} title={t('common.closeEsc')}>✕</button>
        </div>

        <div className="fp-bar">
          <button
            className="fp-up"
            onClick={goUp}
            disabled={!view?.canGoUp}
            title={t('picker.upTitle')}
          >
            ↰
          </button>
          <div className="fp-path" title={current}>{current}</div>
          <label className={`fp-toggle${reposOnly ? ' on' : ''}`} title={t('picker.reposOnlyTitle')}>
            <input
              type="checkbox"
              checked={reposOnly}
              onChange={(e) => setReposOnly(e.target.checked)}
              tabIndex={-1}
            />
            <span>{t('picker.reposOnly')}</span>
          </label>
        </div>

        <div className="fp-filter">
          <span className="fp-filter-icon">🔍</span>
          <span className="fp-filter-text">
            {filter ? filter : <span className="fp-filter-ph">{t('picker.filterHint')}</span>}
          </span>
          {filter && (
            <button className="fp-filter-clear" onClick={() => setFilter('')} tabIndex={-1}>✕</button>
          )}
        </div>

        <div className="fp-list" ref={listRef}>
          {loading ? (
            <div className="fp-empty">{t('picker.loading')}</div>
          ) : error ? (
            <div className="fp-empty fp-error">{error}</div>
          ) : entries.length === 0 ? (
            <div className="fp-empty">{t('picker.noFolders')}</div>
          ) : (
            entries.map((entry, i) => (
              <div
                key={entry.path}
                ref={(el) => (rowRefs.current[i] = el)}
                className={
                  'fp-row' +
                  (i === index ? ' active' : '') +
                  (entry.isRepo ? ' repo' : '') +
                  (entry.isDrive ? ' drive' : '')
                }
                onMouseDown={() => setIndex(i)}
                onDoubleClick={() => activate(entry)}
              >
                <span className="fp-icon">{entry.isDrive ? '💽' : entry.isRepo ? '⎇' : '📁'}</span>
                <span className="fp-name">{entry.name}</span>
                {entry.isRepo && <span className="fp-tag">git</span>}
              </div>
            ))
          )}
        </div>

        <div className="fp-foot">
          <span className="fp-hint">{t('picker.hint')}</span>
          <span className="fp-spacer" />
          <button className="btn ghost" onClick={onClose}>{t('common.cancel')}</button>
          <button
            className="btn"
            onClick={() => {
              const target = entries[index];
              if (target?.isRepo) select(target.path);
              else if (view?.isRepo) select(view.path);
              else if (target) descend(target);
            }}
            disabled={loading}
          >
            {t('picker.open')}
          </button>
        </div>
      </div>
    </div>
  );
}
