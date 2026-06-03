import React, { useEffect, useRef, useState } from 'react';

// Color swatches offered by the context menu. Keys match the CSS classes
// `.commit-row.force-<key>` that paint the forced background.
const COLORS = [
  { key: 'green', label: '綠色', dot: '#2ea043' },
  { key: 'red', label: '亮紅色', dot: '#ff2d3c' },
  { key: 'blue', label: '藍色', dot: '#3b82f6' },
  { key: 'yellow', label: '黃色', dot: '#e0a44a' }
];

// Right-click context menu for a commit row: add/edit a note or force-override
// the row background color. Closes on outside click, Escape, or after a choice.
export default function RowMenu({ side, sha, short, x, y, hasNote, color, onAddNote, onSetColor, onClearColor, onClose }) {
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
        📝 {hasNote ? '編輯註記' : '新增註記'}
      </button>

      <div className="rm-sep" />
      <div className="rm-label">強制背景顏色</div>
      <div className="rm-swatches">
        {COLORS.map((c) => (
          <button
            key={c.key}
            type="button"
            className={'rm-swatch' + (color === c.key ? ' on' : '')}
            style={{ background: c.dot }}
            title={c.label}
            aria-label={c.label}
            onClick={() => {
              onSetColor(side, sha, c.key);
              onClose();
            }}
          />
        ))}
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
        ✕ 清除顏色
      </button>
    </div>
  );
}
