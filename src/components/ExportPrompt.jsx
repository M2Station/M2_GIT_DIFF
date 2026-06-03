import React, { useState, useRef, useEffect, useCallback } from 'react';

// Pre-export dialog: asks how many rows to write to the Excel file so a very
// large diff doesn't produce an unwieldy / failing workbook. Defaults to ALL.
// Closes on Cancel, the backdrop, or Escape; confirms on Export / Enter.
export default function ExportPrompt({ total, onExport, onCancel }) {
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
        <div className="export-prompt-head">⬇ 匯出 Excel</div>

        <div className="export-prompt-body">
          <p className="export-prompt-q">
            目前可匯出 <b>{total.toLocaleString()}</b> 筆資料，要輸出多少筆？
          </p>

          <label className="export-prompt-opt">
            <input
              type="radio"
              name="export-mode"
              checked={mode === 'all'}
              onChange={() => setMode('all')}
            />
            <span>
              全部 (ALL) <span className="muted">— {total.toLocaleString()} 筆</span>
            </span>
          </label>

          <label className="export-prompt-opt">
            <input
              type="radio"
              name="export-mode"
              checked={mode === 'limit'}
              onChange={() => setMode('limit')}
            />
            <span>只輸出前</span>
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
            <span>筆</span>
          </label>

          {big && mode === 'all' && (
            <p className="export-prompt-warn">
              ⚠ 資料量較大，匯出可能需要一些時間或產生較大的檔案。
            </p>
          )}
        </div>

        <div className="export-prompt-foot">
          <button type="button" className="btn" onClick={onCancel}>
            取消
          </button>
          <button type="button" className="btn export-xlsx" onClick={confirm}>
            匯出 {limited ? `${parsed.toLocaleString()} 筆` : '全部'}
          </button>
        </div>
      </div>
    </div>
  );
}
