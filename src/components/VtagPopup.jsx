/*
 * M2_GIT_DIFF
 * Copyright (c) 2026 OA Hsiao
 * SPDX-License-Identifier: MIT
 *
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useT } from '../lib/i18n.js';

// Floating single-line editor for a commit's virtual tag — a user-defined
// version label shown inline like a git tag but painted in the manual-link
// color. Opened from the right-click row menu. Draggable by its header.
export default function VtagPopup({ side, sha, short, subject, x, y, value, onSave, onDelete, onClose }) {
  const t = useT();
  const [text, setText] = useState(value || '');
  const [pos, setPos] = useState(() => ({
    x: Math.min(x, window.innerWidth - 320),
    y: Math.min(y, window.innerHeight - 160)
  }));
  const dragRef = useRef(null);
  const inputRef = useRef(null);

  // Refresh contents when the popup is retargeted to another commit.
  useEffect(() => {
    setText(value || '');
  }, [value, side, sha]);

  // Focus + select the input on open.
  useEffect(() => {
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, []);

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
          x: Math.min(Math.max(-240, nx), window.innerWidth - 60),
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

  const save = () => {
    onSave(side, sha, text);
    onClose();
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      save();
    }
  };

  return (
    <div
      className="note-popup vtag-popup"
      style={{ left: pos.x, top: pos.y }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="np-header" onPointerDown={onDragStart}>
        <span className="np-title">{t('vtag.title')}</span>
        <span className="np-ref" title={subject}>
          {short}
        </span>
        <span className="np-spacer" />
        <button className="np-close" onClick={onClose} title={t('common.closeEsc')} aria-label={t('common.close')}>
          ✕
        </button>
      </div>

      <div className="np-body">
        <input
          ref={inputRef}
          type="text"
          className="vtag-input"
          placeholder={t('vtag.placeholder')}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>

      <div className="np-footer">
        <button
          className="btn danger"
          onClick={() => onDelete(side, sha)}
          disabled={!value}
          title={t('vtag.deleteTitle')}
        >
          {t('common.delete')}
        </button>
        <span className="np-spacer" />
        <button className="btn primary" onClick={save}>
          {t('common.save')}
        </button>
      </div>
    </div>
  );
}
