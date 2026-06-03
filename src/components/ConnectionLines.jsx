import React from 'react';
import { ROW_HEIGHT } from '../lib/constants.js';

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

export default function ConnectionLines({ links, height, width, selectedMatch, onSelect }) {
  const yOf = (index) => index * ROW_HEIGHT + ROW_HEIGHT / 2;

  const handleClick = (id) => (e) => {
    e.stopPropagation();
    onSelect?.(selectedMatch === id ? null : id);
  };

  return (
    <svg className="links-svg" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {links.map((link) => {
        const y1 = yOf(link.leftIndex);
        const y2 = yOf(link.rightIndex);
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
        return (
          <g key={link.id} className="link-group" onClick={handleClick(link.id)}>
            {/* invisible wide hit area so the thin line is easy to click */}
            <path className="link-hit" d={d} fill="none" />
            <path className={cls} d={d} fill="none" />
          </g>
        );
      })}
    </svg>
  );
}
