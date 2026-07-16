/*
 * M2_GIT_DIFF
 * Copyright (c) 2026 OA Hsiao
 * SPDX-License-Identifier: MIT
 *
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */
import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useT } from '../lib/i18n.js';
import { getDefaultSubmoduleSkip, setDefaultSubmoduleSkip } from '../lib/settings.js';

// Draggable, resizable picker for the repo's submodule-skip list. It shows every
// submodule (recursively, with nesting depth) plus a checkbox; ticking one marks
// it to be skipped on worktree submodule updates (m2gitdiff.submoduleSkip). A
// filter box narrows the list and Select-all / Clear act on the visible rows.
// The window is a non-modal floating panel: drag it by the header, resize from
// the bottom-right corner. Confirm writes the checked paths back to git config.
// `submodules` = [{ path, name, url, depth, skipped, custom }].
export default function SubmoduleSkipPopup({ repoName, submodules, loading, saving, onSave, onClose }) {
  const t = useT();
  const [selected, setSelected] = useState(() => new Set());
  const [filter, setFilter] = useState('');
  const [defaultList, setDefaultList] = useState([]);
  const [pos, setPos] = useState(null); // {x,y}; null until first-render centring
  const dragRef = useRef(null);
  const winRef = useRef(null);

  const list = submodules || [];

  // Load the app-wide default skip list (stored in the app, not the repo).
  useEffect(() => {
    setDefaultList(getDefaultSubmoduleSkip());
  }, []);

  // Seed the checkbox state from the loaded skip state whenever the list arrives.
  useEffect(() => {
    setSelected(new Set(list.filter((s) => s.skipped).map((s) => s.path)));
  }, [submodules]); // eslint-disable-line react-hooks/exhaustive-deps

  // Centre the window on first mount (measure, then place).
  useEffect(() => {
    if (pos || !winRef.current) return;
    const r = winRef.current.getBoundingClientRect();
    setPos({
      x: Math.max(8, Math.round((window.innerWidth - r.width) / 2)),
      y: Math.max(8, Math.round((window.innerHeight - r.height) / 3))
    });
  }, [pos]);

  // Escape closes (capture so it wins over global handlers).
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (!saving) onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, saving]);

  // Drag the window by its header.
  const onDragStart = useCallback(
    (e) => {
      if (e.button !== 0) return;
      dragRef.current = { mx: e.clientX, my: e.clientY, x: pos?.x || 0, y: pos?.y || 0 };
      const move = (ev) => {
        const d = dragRef.current;
        if (!d) return;
        const w = winRef.current?.offsetWidth || 400;
        const nx = d.x + (ev.clientX - d.mx);
        const ny = d.y + (ev.clientY - d.my);
        setPos({
          x: Math.min(Math.max(-(w - 90), nx), window.innerWidth - 90),
          y: Math.min(Math.max(0, ny), window.innerHeight - 32)
        });
      };
      const up = () => {
        dragRef.current = null;
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    },
    [pos]
  );

  const f = filter.trim().toLowerCase();
  const shown = useMemo(
    () => (f ? list.filter((s) => s.path.toLowerCase().includes(f) || (s.url || '').toLowerCase().includes(f)) : list),
    [list, f]
  );

  const toggle = useCallback((p) => {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(p)) n.delete(p);
      else n.add(p);
      return n;
    });
  }, []);
  const selectAll = useCallback(() => {
    setSelected((prev) => {
      const n = new Set(prev);
      for (const s of shown) n.add(s.path);
      return n;
    });
  }, [shown]);
  const clearAll = useCallback(() => {
    setSelected((prev) => {
      const n = new Set(prev);
      for (const s of shown) n.delete(s.path);
      return n;
    });
  }, [shown]);

  // Save the current selection as the app-wide default (by submodule name).
  const setDefault = useCallback(() => {
    const names = Array.from(new Set(list.filter((s) => selected.has(s.path)).map((s) => s.name)));
    setDefaultList(setDefaultSubmoduleSkip(names));
  }, [list, selected]);

  // Tick every submodule whose name is in the saved default list (non-destructive).
  const applyDefault = useCallback(() => {
    if (!defaultList.length) return;
    const want = new Set(defaultList.map((s) => s.toLowerCase()));
    setSelected((prev) => {
      const n = new Set(prev);
      for (const s of list) {
        if (want.has((s.name || '').toLowerCase())) n.add(s.path);
      }
      return n;
    });
  }, [defaultList, list]);

  const confirm = useCallback(() => {
    if (!saving && !loading) onSave(Array.from(selected));
  }, [saving, loading, selected, onSave]);

  const style = pos ? { left: `${pos.x}px`, top: `${pos.y}px` } : { left: '-9999px', top: '-9999px' };

  return (
    <div className="ssp-layer">
      <div className="ssp" ref={winRef} style={style}>
        <div className="ssp-head" onMouseDown={onDragStart}>
          <span className="wtp-title">{t('submoduleSkip.title')}</span>
          <span className="wtp-meta">{repoName || ''}</span>
          <button
            type="button"
            className="wtp-x"
            onClick={onClose}
            disabled={saving}
            title={t('common.closeEsc')}
            aria-label={t('common.close')}
          >
            ✕
          </button>
        </div>

        <div className="ssp-tools">
          <input
            type="text"
            className="wtp-input"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t('submoduleSkip.filter')}
            spellCheck={false}
            disabled={loading}
          />
        </div>

        <div className="ssp-actions">
          <button type="button" className="btn" onClick={selectAll} disabled={loading || !shown.length}>
            {t('submoduleSkip.selectAll')}
          </button>
          <button type="button" className="btn" onClick={clearAll} disabled={loading || !shown.length}>
            {t('submoduleSkip.clear')}
          </button>
          <span className="ssp-sep" />
          <button
            type="button"
            className="btn"
            onClick={setDefault}
            disabled={loading}
            title={t('submoduleSkip.setDefaultTitle')}
          >
            {t('submoduleSkip.setDefault')}
          </button>
          <button
            type="button"
            className="btn"
            onClick={applyDefault}
            disabled={loading || !defaultList.length}
            title={t('submoduleSkip.applyDefaultTitle')}
          >
            {t('submoduleSkip.applyDefault')}
          </button>
        </div>

        <div className="ssp-body">
          {loading ? (
            <div className="ssp-empty">{t('submoduleSkip.loading')}</div>
          ) : !list.length ? (
            <div className="ssp-empty">{t('submoduleSkip.none')}</div>
          ) : !shown.length ? (
            <div className="ssp-empty">{t('submoduleSkip.noMatch')}</div>
          ) : (
            shown.map((s) => (
              <label key={s.path} className={'ssp-row' + (selected.has(s.path) ? ' on' : '')} title={s.url || s.path}>
                <input type="checkbox" checked={selected.has(s.path)} onChange={() => toggle(s.path)} />
                <span className="ssp-info" style={{ paddingLeft: `${s.depth * 14}px` }}>
                  <span className="ssp-name">
                    {s.name}
                    {s.custom && <span className="ssp-tag">{t('submoduleSkip.pattern')}</span>}
                  </span>
                  <span className="ssp-path">{s.path}</span>
                </span>
              </label>
            ))
          )}
        </div>

        <div className="ssp-foot">
          <span className="ssp-count">
            {t('submoduleSkip.count', { n: selected.size, total: list.length })}
            {defaultList.length > 0 && (
              <span className="ssp-def"> · {t('submoduleSkip.defaultCount', { n: defaultList.length })}</span>
            )}
          </span>
          <span className="ssp-foot-right">
            <button type="button" className="btn" onClick={onClose} disabled={saving}>
              {t('common.cancel')}
            </button>
            <button type="button" className="btn primary" onClick={confirm} disabled={saving || loading}>
              {saving ? t('submoduleSkip.saving') : t('submoduleSkip.save')}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
