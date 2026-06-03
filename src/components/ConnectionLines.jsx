import React from 'react';
import { ROW_HEIGHT, OVERSCAN } from '../lib/constants.js';

// Draws connecting lines in the central gutter between matched rows.
// Routing is orthogonal (right-angle elbows) with lightly rounded corners for
// a cleaner look — no sweeping bezier curves. Each line carries an invisible
// thick "hit" path so it can be clicked directly to highlight the match.
const CORNER = 6; // rounded-corner radius on the elbows

function buildPath(y1, y2, width) {
  const x1 = 0;
  const x2 = width;
  const midX = width / 2;

  // Aligned rows -> a single straight horizontal segment.
  if (y1 === y2) return `M ${x1} ${y1} L ${x2} ${y2}`;

  const dir = y2 > y1 ? 1 : -1;
  const r = Math.min(CORNER, Math.abs(y2 - y1) / 2, midX);

  // horizontal in -> rounded corner -> vertical -> rounded corner -> horizontal out
  return [
    `M ${x1} ${y1}`,
    `L ${midX - r} ${y1}`,
    `Q ${midX} ${y1} ${midX} ${y1 + dir * r}`,
    `L ${midX} ${y2 - dir * r}`,
    `Q ${midX} ${y2} ${midX + r} ${y2}`,
    `L ${x2} ${y2}`
  ].join(' ');
}

function ConnectionLines({ links, height, width, selectedMatch, onSelect, scrollTop = 0, viewportHeight = 0 }) {
  const yOf = (index) => index * ROW_HEIGHT + ROW_HEIGHT / 2;

  const handleClick = (id) => (e) => {
    e.stopPropagation();
    onSelect?.(selectedMatch === id ? null : id);
  };

  // Keyboard activation: Enter / Space toggles the focused link, mirroring the
  // pointer click so the connections are reachable without a mouse.
  const handleKeyDown = (id) => (e) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      e.stopPropagation();
      onSelect?.(selectedMatch === id ? null : id);
    }
  };

  // Virtualization: only draw links whose vertical span overlaps the viewport
  // (plus an overscan margin). When the viewport height is unknown (0) we fall
  // back to rendering everything so nothing silently disappears.
  const margin = OVERSCAN * ROW_HEIGHT;
  const visTop = scrollTop - margin;
  const visBottom = scrollTop + (viewportHeight || height) + margin;

  return (
    <svg className="links-svg" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {links.map((link) => {
        const y1 = yOf(link.leftIndex);
        const y2 = yOf(link.rightIndex);
        // Skip links fully outside the visible band.
        if (viewportHeight && (Math.max(y1, y2) < visTop || Math.min(y1, y2) > visBottom)) {
          return null;
        }
        const d = buildPath(y1, y2, width);
        const isSel = selectedMatch != null && selectedMatch === link.id;
        const cls = [
          'link',
          link.type, // common | cherry | patch
          isSel ? 'selected' : '',
          selectedMatch != null && !isSel ? 'faded' : ''
        ]
          .filter(Boolean)
          .join(' ');
        const scorePct =
          link.type === 'fuzzy' && typeof link.score === 'number'
            ? ` ${Math.round(link.score * 100)}%`
            : '';
        const ariaLabel = `${link.type} 連結${scorePct}，${isSel ? '已選取，' : ''}按 Enter ${isSel ? '取消' : '選取'}`;
        return (
          <g
            key={link.id}
            className="link-group"
            role="button"
            tabIndex={0}
            aria-pressed={isSel}
            aria-label={ariaLabel}
            onClick={handleClick(link.id)}
            onKeyDown={handleKeyDown(link.id)}
          >
            {/* invisible wide hit area so the thin line is easy to click */}
            <path className="link-hit" d={d} fill="none" />
            <path className={cls} d={d} fill="none" />
            {link.type === 'fuzzy' && typeof link.score === 'number' && (
              (() => {
                const cx = width / 2;
                const cy = (y1 + y2) / 2;
                const label = `${Math.round(link.score * 100)}%`;
                const bw = 38;
                const bh = 20;
                return (
                  <g className={`link-score${isSel ? ' selected' : ''}${selectedMatch != null && !isSel ? ' faded' : ''}`}>
                    <rect
                      className="link-score-bg"
                      x={cx - bw / 2}
                      y={cy - bh / 2}
                      width={bw}
                      height={bh}
                      rx={7}
                      ry={7}
                    />
                    <text className="link-score-text" x={cx} y={cy} textAnchor="middle" dominantBaseline="central">
                      {label}
                    </text>
                  </g>
                );
              })()
            )}
          </g>
        );
      })}
    </svg>
  );
}

// Memoize: the SVG only needs to redraw when the links, geometry, selection,
// or scroll position change — not on every unrelated App re-render.
export default React.memo(ConnectionLines);
