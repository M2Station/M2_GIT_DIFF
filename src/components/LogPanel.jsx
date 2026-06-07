/*
 * M2_GIT_DIFF
 * Copyright (c) 2026 OA Hsiao
 * SPDX-License-Identifier: MIT
 *
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */
import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useT } from '../lib/i18n.js';

// Centralized error / log panel. Lists every event the app funnelled into the
// log store (git failures, cache problems, export errors, …) newest-first, with
// a level filter, expandable detail, copy-all, and clear. Draggable by its
// header; closes on the ✕ button, the backdrop, or Escape. A pure view over the
// `entries` prop — the store itself lives in lib/logStore.js.
const LEVEL_ICON = { error: '⛔', warn: '⚠', info: 'ℹ' };

function fmtTime(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export default function LogPanel({ entries, onClear, onClose }) {
  const t = useT();
  const W = 540;
  const [pos, setPos] = useState(() => ({
    x: Math.max(12, Math.round(window.innerWidth - W - 24)),
    y: Math.max(24, Math.round(window.innerHeight * 0.12))
  }));
  const [filter, setFilter] = useState('all'); // 'all' | 'error' | 'warn'
  const [expanded, setExpanded] = useState(() => new Set());
  const [copied, setCopied] = useState(false);
  const dragRef = useRef(null);

  // Close on Escape (capture so it wins over global handlers).
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const onDragStart = useCallback(
    (e) => {
      if (e.target.closest('button')) return;
      e.preventDefault();
      dragRef.current = { sx: e.clientX, sy: e.clientY, bx: pos.x, by: pos.y };
      const onMove = (ev) => {
        const d = dragRef.current;
        if (!d) return;
        const nx = d.bx + (ev.clientX - d.sx);
        const ny = d.by + (ev.clientY - d.sy);
        setPos({
          x: Math.min(Math.max(-W + 80, nx), window.innerWidth - 60),
          y: Math.min(Math.max(0, ny), window.innerHeight - 40)
        });
      };
      const onUp = () => {
        dragRef.current = null;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [pos.x, pos.y]
  );

  const counts = useMemo(() => {
    let error = 0;
    let warn = 0;
    for (const e of entries) {
      if (e.level === 'error') error++;
      else if (e.level === 'warn') warn++;
    }
    return { error, warn, total: entries.length };
  }, [entries]);

  // Newest-first, after applying the level filter.
  const shown = useMemo(() => {
    const list = filter === 'all' ? entries : entries.filter((e) => e.level === filter);
    return list.slice().reverse();
  }, [entries, filter]);

  const toggle = (id) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const copyAll = useCallback(() => {
    const text = entries
      .map((e) => {
        const head = `[${fmtTime(e.ts)}] ${e.level.toUpperCase()} ${e.category}: ${e.message}`;
        return e.detail ? `${head}\n${e.detail}` : head;
      })
      .join('\n');
    try {
      navigator.clipboard?.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable */
    }
  }, [entries]);

  return (
    <div className="log-backdrop" onMouseDown={onClose}>
      <div
        className="log-panel"
        style={{ left: pos.x, top: pos.y, width: W }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="log-head" onPointerDown={onDragStart}>
          <span className="log-title">{t('log.title')}</span>
          <span className="log-counts">
            {counts.error > 0 && <span className="log-c err">⛔ {counts.error}</span>}
            {counts.warn > 0 && <span className="log-c warn">⚠ {counts.warn}</span>}
            <span className="log-c muted">{t('log.total', { count: counts.total })}</span>
          </span>
          <span className="log-spacer" />
          <button
            type="button"
            className="log-x"
            onClick={onClose}
            title={t('common.closeEsc')}
            aria-label={t('common.close')}
          >
            ✕
          </button>
        </div>

        <div className="log-toolbar">
          <div className="log-filters" role="group" aria-label={t('log.filterAria')}>
            <button
              type="button"
              className={'log-filter' + (filter === 'all' ? ' on' : '')}
              onClick={() => setFilter('all')}
            >
              {t('log.filterAll')}
            </button>
            <button
              type="button"
              className={'log-filter' + (filter === 'error' ? ' on' : '')}
              onClick={() => setFilter('error')}
            >
              {t('log.filterErrors')}
            </button>
            <button
              type="button"
              className={'log-filter' + (filter === 'warn' ? ' on' : '')}
              onClick={() => setFilter('warn')}
            >
              {t('log.filterWarnings')}
            </button>
          </div>
          <span className="log-spacer" />
          <button
            type="button"
            className="btn log-copy"
            onClick={copyAll}
            disabled={!entries.length}
            title={t('log.copyTitle')}
          >
            {copied ? t('log.copied') : t('log.copy')}
          </button>
          <button
            type="button"
            className="btn log-clear"
            onClick={onClear}
            disabled={!entries.length}
            title={t('log.clearTitle')}
          >
            {t('log.clear')}
          </button>
        </div>

        <div className="log-body">
          {shown.length === 0 ? (
            <div className="log-empty">{t('log.empty')}</div>
          ) : (
            shown.map((e) => {
              const isOpen = expanded.has(e.id);
              return (
                <div key={e.id} className={'log-row ' + e.level}>
                  <button
                    type="button"
                    className="log-row-head"
                    onClick={() => e.detail && toggle(e.id)}
                    aria-expanded={e.detail ? isOpen : undefined}
                    data-has-detail={e.detail ? 'true' : 'false'}
                  >
                    <span className="log-ico" aria-hidden="true">{LEVEL_ICON[e.level] || 'ℹ'}</span>
                    <span className="log-time">{fmtTime(e.ts)}</span>
                    <span className={'log-cat ' + e.level}>{e.category}</span>
                    <span className="log-msg" title={e.message}>{e.message}</span>
                    {e.detail ? <span className="log-caret">{isOpen ? '▾' : '▸'}</span> : null}
                  </button>
                  {e.detail && isOpen ? <pre className="log-detail">{e.detail}</pre> : null}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
