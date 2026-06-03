import React, { useRef, useState, useCallback, useEffect } from 'react';

// Scope checkboxes shown inside the panel. `key` matches the fields tested in
// matchesQuery(); `label` is what the user sees.
const SCOPES = [
  { key: 'subject', label: 'Title' },
  { key: 'body', label: 'Body' },
  { key: 'sha', label: 'SHA' },
  { key: 'author', label: 'Author' },
  { key: 'date', label: 'Date' }
];

// A floating, draggable search window. Opened with Ctrl+F. Lets the user pick
// which fields to search (multi-select) and cycle matches with the arrows / F3.
export default function SearchPanel({
  query,
  onQuery,
  scopes,
  onToggleScope,
  matchCount,
  filterOnly,
  onToggleFilter,
  onPrev,
  onNext,
  onClose,
  inputRef,
  onInputKeyDown
}) {
  // Position is local so dragging never re-renders the rest of the app.
  const [pos, setPos] = useState({ x: window.innerWidth - 380, y: 70 });
  const dragRef = useRef(null);

  const onDragStart = useCallback((e) => {
    // Ignore drags that start on a control inside the header.
    if (e.target.closest('button, input, label')) return;
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    dragRef.current = { startX, startY, baseX: pos.x, baseY: pos.y };

    const onMove = (ev) => {
      const d = dragRef.current;
      if (!d) return;
      const nx = d.baseX + (ev.clientX - d.startX);
      const ny = d.baseY + (ev.clientY - d.startY);
      // Keep the panel within the viewport.
      const maxX = window.innerWidth - 60;
      const maxY = window.innerHeight - 40;
      setPos({
        x: Math.min(Math.max(-260, nx), maxX),
        y: Math.min(Math.max(0, ny), maxY)
      });
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [pos.x, pos.y]);

  // Keep the panel on-screen if the window is resized smaller.
  useEffect(() => {
    const onResize = () =>
      setPos((p) => ({
        x: Math.min(p.x, window.innerWidth - 60),
        y: Math.min(p.y, window.innerHeight - 40)
      }));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return (
    <div
      className="search-panel"
      style={{ left: pos.x, top: pos.y }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="sp-header" onPointerDown={onDragStart}>
        <span className="sp-title">🔍 Search</span>
        <span className="sp-spacer" />
        <button className="sp-close" onClick={onClose} title="Close (Esc)" aria-label="Close">
          ✕
        </button>
      </div>

      <div className="sp-body">
        <div className="sp-row">
          <input
            ref={inputRef}
            className="search"
            type="text"
            placeholder="Search…"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={onInputKeyDown}
          />
        </div>

        <div className="sp-scopes">
          {SCOPES.map((s) => (
            <label key={s.key} className="sp-scope" title={`Search in ${s.label}`}>
              <input
                type="checkbox"
                checked={!!scopes[s.key]}
                onChange={() => onToggleScope(s.key)}
              />
              <span>{s.label}</span>
            </label>
          ))}
        </div>

        <div className="sp-row sp-actions">
          <span className="match-count">{query ? `${matchCount} hits` : '\u00a0'}</span>
          <span className="sp-spacer" />
          <button className="btn ghost" onClick={onPrev} disabled={!query} title="Previous (Shift+F3)">
            ↑
          </button>
          <button className="btn ghost" onClick={onNext} disabled={!query} title="Next (F3)">
            ↓
          </button>
          <button
            className={'btn toggle' + (filterOnly ? ' on' : '')}
            onClick={onToggleFilter}
            disabled={!query}
            title="Show only matching commits"
          >
            {filterOnly ? '☑' : '☐'} Filter
          </button>
        </div>
      </div>
    </div>
  );
}
