/*
 * M2_GIT_DIFF
 * Copyright (c) 2026 OA Hsiao
 * SPDX-License-Identifier: MIT
 *
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useT } from '../lib/i18n.js';

// Color swatches offered by the context menu. Keys match the CSS classes
// `.commit-row.force-<key>` that paint the forced background. Labels are
// translated via `rowMenu.colors.<key>`.
const COLORS = [
  { key: 'green', dot: '#2ea043' },
  { key: 'red', dot: '#ff2d3c' },
  { key: 'blue', dot: '#3b82f6' },
  { key: 'yellow', dot: '#e0a44a' }
];

// Right-click context menu for a commit row: add/edit a note or force-override
// the row background color. Closes on outside click, Escape, or after a choice.
export default function RowMenu({ side, sha, short, x, y, hasNote, color, customColor, onAddNote, onSetColor, onPickCustom, onClearColor, onClose }) {
  const t = useT();
  const ref = useRef(null);
  const [pos, setPos] = useState(() => ({
    x: Math.min(x, window.innerWidth - 190),
    y: Math.min(y, window.innerHeight - 240)
  }));

  // Re-clamp if the target changes.
  useEffect(() => {
    setPos({
      x: Math.min(x, window.innerWidth - 190),
      y: Math.min(y, window.innerHeight - 240)
    });
  }, [x, y]);

  // Close when clicking anywhere outside the menu.
  useEffect(() => {
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="row-menu"
      style={{ left: pos.x, top: pos.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="rm-head">
        <span className="rm-ref">{short}</span>
      </div>

      <button
        type="button"
        className="rm-item"
        onClick={() => {
          onAddNote(side, sha, pos.x, pos.y);
          onClose();
        }}
      >
        📝 {hasNote ? t('rowMenu.editNote') : t('rowMenu.addNote')}
      </button>

      <div className="rm-sep" />
      <div className="rm-label">{t('rowMenu.forceColor')}</div>
      <div className="rm-swatches">
        {COLORS.map((c) => {
          const label = t('rowMenu.colors.' + c.key);
          return (
            <button
              key={c.key}
              type="button"
              className={'rm-swatch' + (color === c.key ? ' on' : '')}
              style={{ background: c.dot }}
              title={label}
              aria-label={label}
              onClick={() => {
                onSetColor(side, sha, c.key);
                onClose();
              }}
            />
          );
        })}
        {customColor && (
          <button
            key="custom"
            type="button"
            className={'rm-swatch' + (color === customColor ? ' on' : '')}
            style={{ background: customColor }}
            title={t('rowMenu.customColor', { color: customColor })}
            aria-label={t('rowMenu.customColor', { color: customColor })}
            onClick={() => {
              onSetColor(side, sha, customColor);
              onClose();
            }}
          />
        )}
        <label
          className="rm-swatch rm-swatch-pick"
          title={t('rowMenu.customColorPick')}
          aria-label={t('rowMenu.customColorAria')}
        >
          ＋
          <input
            type="color"
            value={customColor || '#888888'}
            onChange={(e) => {
              onPickCustom(side, sha, e.target.value);
              onClose();
            }}
          />
        </label>
      </div>

      <button
        type="button"
        className="rm-item"
        disabled={!color}
        onClick={() => {
          onClearColor(side, sha);
          onClose();
        }}
      >
        {t('rowMenu.clearColor')}
      </button>
    </div>
  );
}
