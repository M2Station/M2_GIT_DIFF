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

// Pre-export dialog: asks how many rows to write to the Excel file so a very
// large diff doesn't produce an unwieldy / failing workbook. Defaults to ALL.
// Closes on Cancel, the backdrop, or Escape; confirms on Export / Enter.
export default function ExportPrompt({ total, onExport, onCancel }) {
  const t = useT();
  // mode: 'all' = export everything; 'limit' = export the first N rows.
  const [mode, setMode] = useState('all');
  const [count, setCount] = useState(String(Math.min(total, 1000)));
  const inputRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onCancel]);

  const parsed = Math.max(1, Math.min(total, parseInt(count, 10) || 0));
  const limited = mode === 'limit';

  const confirm = useCallback(() => {
    onExport(limited ? parsed : null);
  }, [onExport, limited, parsed]);

  const onKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      confirm();
    }
  };

  const big = total > 5000;

  return (
    <div className="export-prompt-backdrop" onMouseDown={onCancel}>
      <div className="export-prompt" onMouseDown={(e) => e.stopPropagation()}>
        <div className="export-prompt-head">{t('export.head')}</div>

        <div className="export-prompt-body">
          <p className="export-prompt-q">
            {t('export.question', { total: total.toLocaleString() })}
          </p>

          <label className="export-prompt-opt">
            <input
              type="radio"
              name="export-mode"
              checked={mode === 'all'}
              onChange={() => setMode('all')}
            />
            <span>
              {t('export.all')} <span className="muted">{t('export.allSuffix', { total: total.toLocaleString() })}</span>
            </span>
          </label>

          <label className="export-prompt-opt">
            <input
              type="radio"
              name="export-mode"
              checked={mode === 'limit'}
              onChange={() => setMode('limit')}
            />
            <span>{t('export.limitPrefix')}</span>
            <input
              ref={inputRef}
              type="number"
              className="export-prompt-num"
              min={1}
              max={total}
              value={count}
              disabled={mode !== 'limit'}
              onFocus={() => setMode('limit')}
              onChange={(e) => setCount(e.target.value)}
              onKeyDown={onKeyDown}
            />
            <span>{t('export.limitSuffix')}</span>
          </label>

          {big && mode === 'all' && (
            <p className="export-prompt-warn">
              {t('export.warn')}
            </p>
          )}
        </div>

        <div className="export-prompt-foot">
          <button type="button" className="btn" onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn export-xlsx" onClick={confirm}>
            {limited ? t('export.exportN', { count: parsed.toLocaleString() }) : t('export.exportAll')}
          </button>
        </div>
      </div>
    </div>
  );
}
