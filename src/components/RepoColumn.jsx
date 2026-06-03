import React from 'react';
import CommitRow from './CommitRow.jsx';
import { ROW_HEIGHT, OVERSCAN } from '../lib/constants.js';

// Virtualized column: only renders the rows currently inside the viewport
// (plus an overscan margin). Each visible row carries its `displayIndex`, so
// it is absolutely positioned at displayIndex * ROW_HEIGHT — keeping the two
// columns and the SVG connection lines perfectly aligned.
export default function RepoColumn({
  side,
  rows, // [{ commit, displayIndex, isHit }]
  totalRows,
  query,
  filterActive,
  scrollTop,
  viewportHeight,
  selectedMatch,
  onSelect
}) {
  const bodyHeight = totalRows * ROW_HEIGHT;

  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const end = Math.min(
    totalRows,
    Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN
  );

  const visible = rows.filter((r) => r.displayIndex >= start && r.displayIndex < end);

  return (
    <div className="repo-column" data-side={side} style={{ height: bodyHeight }}>
      {rows.length === 0 ? (
        <div className="empty-col">{filterActive ? 'No matches' : 'No commits loaded'}</div>
      ) : (
        visible.map((r) => {
          const c = r.commit;
          const dimmed = !filterActive && query ? !r.isHit : false;
          const selected =
            selectedMatch != null && c.matchId != null && c.matchId === selectedMatch;
          return (
            <CommitRow
              key={c.sha + ':' + c.index}
              commit={c}
              side={side}
              query={query}
              dimmed={dimmed}
              isHit={!!query && r.isHit}
              selected={selected}
              height={ROW_HEIGHT}
              top={r.displayIndex * ROW_HEIGHT}
              onSelect={onSelect}
            />
          );
        })
      )}
    </div>
  );
}
