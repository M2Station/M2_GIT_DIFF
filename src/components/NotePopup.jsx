import React, { useState, useRef, useEffect, useCallback } from 'react';

// Floating note editor/viewer for a single commit. Opened by right-clicking a
// commit row (to add) or clicking its note icon (to view/edit). Draggable by
// its header; Save / Delete / Close actions in the footer.
export default function NotePopup({ side, sha, short, subject, x, y, value, onSave, onDelete, onClose }) {
  const [text, setText] = useState(value || '');
  const [pos, setPos] = useState(() => ({
    x: Math.min(x, window.innerWidth - 320),
    y: Math.min(y, window.innerHeight - 220)
  }));
  const dragRef = useRef(null);
  const areaRef = useRef(null);

  // Refresh contents when the popup is retargeted to another commit.
  useEffect(() => {
    setText(value || '');
  }, [value, side, sha]);

  // Focus the textarea on open.
  useEffect(() => {
    requestAnimationFrame(() => areaRef.current?.focus());
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
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      save();
    }
  };

  return (
    <div
      className="note-popup"
      style={{ left: pos.x, top: pos.y }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="np-header" onPointerDown={onDragStart}>
        <span className="np-title">📝 Note</span>
        <span className="np-ref" title={subject}>
          {short}
        </span>
        <span className="np-spacer" />
        <button className="np-close" onClick={onClose} title="Close (Esc)" aria-label="Close">
          ✕
        </button>
      </div>

      <div className="np-body">
        <textarea
          ref={areaRef}
          className="np-area"
          placeholder="輸入註記…  (Ctrl+Enter 儲存)"
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
          title="刪除此註記"
        >
          🗑 Delete
        </button>
        <span className="np-spacer" />
        <button className="btn ghost" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" onClick={save}>
          Save
        </button>
      </div>
    </div>
  );
}
