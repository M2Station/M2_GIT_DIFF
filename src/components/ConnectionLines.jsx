import React from 'react';
import { ROW_HEIGHT } from '../lib/constants.js';

// Draws connecting lines in the central gutter between matched rows.
// Common matches use a faint gray line; cherry-picks use a yellow curve.
export default function ConnectionLines({ links, height, width, selectedMatch }) {
  const yOf = (index) => index * ROW_HEIGHT + ROW_HEIGHT / 2;

  return (
    <svg className="links-svg" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {links.map((link) => {
        const y1 = yOf(link.leftIndex);
        const y2 = yOf(link.rightIndex);
        const x1 = 0;
        const x2 = width;
        const c = width * 0.5;
        const d = `M ${x1} ${y1} C ${c} ${y1}, ${c} ${y2}, ${x2} ${y2}`;
        const isSel = selectedMatch != null && selectedMatch === link.id;
        const cls = [
          'link',
          link.type, // common | cherry
          isSel ? 'selected' : '',
          selectedMatch != null && !isSel ? 'faded' : ''
        ]
          .filter(Boolean)
          .join(' ');
        return <path key={link.id} className={cls} d={d} fill="none" />;
      })}
    </svg>
  );
}
