/*
 * M2_GIT_DIFF
 * Copyright (c) 2026 OA Hsiao
 * SPDX-License-Identifier: MIT
 *
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useT } from '../lib/i18n.js';

// Floating window that shows the git terminal transcript after a Fetch / Pull,
// for both success and failure. Draggable by its header; closes on the ✕
// button, the OK button, the backdrop, or Escape.
export default function GitTerminalPopup({ info, onClose }) {
  const t = useT();
  const { side, op, repoName, ok, command, output, exitCode } = info || {};
  const W = 560;
  const [pos, setPos] = useState(() => ({
    x: Math.max(12, Math.round((window.innerWidth - W) / 2)),
    y: Math.max(24, Math.round(window.innerHeight * 0.18))
  }));
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

  const sideLabel = side === 'L' ? t('common.left') : side === 'R' ? t('common.right') : '';

  return (
    <div className="git-term-backdrop" onMouseDown={onClose}>
      <div
        className={'git-term' + (ok ? ' ok' : ' fail')}
        style={{ left: pos.x, top: pos.y, width: W }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="git-term-head" onPointerDown={onDragStart}>
          <span className="git-term-status">{ok ? '✔' : '✕'}</span>
          <span className="git-term-title">
            git {op} {ok ? t('gitTerm.success') : t('gitTerm.fail')}
            {!ok && typeof exitCode === 'number' ? ` ${t('gitTerm.exit', { code: exitCode })}` : ''}
          </span>
          <span className="git-term-meta">
            {sideLabel}
            {repoName ? ` · ${repoName}` : ''}
          </span>
          <button
            type="button"
            className="git-term-x"
            onClick={onClose}
            title={t('common.closeEsc')}
            aria-label={t('common.close')}
          >
            ✕
          </button>
        </div>

        <div className="git-term-body">
          <div className="git-term-cmd">$ {command}</div>
          <pre className="git-term-output">{output || t('common.noOutput')}</pre>
        </div>

        <div className="git-term-foot">
          <button type="button" className="btn" onClick={onClose}>
            {t('common.ok')}
          </button>
        </div>
      </div>
    </div>
  );
}
