import React, { useMemo } from 'react';
import CommitRow from './CommitRow.jsx';
import { ROW_HEIGHT, OVERSCAN } from '../lib/constants.js';

// First index in `rows` whose `displayIndex` is >= target. `rows` is always
// ordered by a strictly increasing `displayIndex` (the alignment layout assigns
// them top-to-bottom), so a binary search finds the visible slice boundaries in
// O(log n) instead of scanning every row on each scroll frame.
function lowerBound(rows, target) {
  let lo = 0;
  let hi = rows.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].displayIndex < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

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
  onSelect,
  manualShas,
  pendingNode,
  onNode,
  activeHit,
  noteShas,
  onNoteOpen,
  colorMap,
  onRowMenu,
  plain,
  onDetail
}) {
  const bodyHeight = totalRows * ROW_HEIGHT;

  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const end = Math.min(
    totalRows,
    Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN
  );

  const visible = useMemo(
    () => rows.slice(lowerBound(rows, start), lowerBound(rows, end)),
    [rows, start, end]
  );

  return (
    <div className={'repo-column' + (plain ? ' plain' : '')} data-side={side} style={{ height: bodyHeight }}>
      {rows.length === 0 ? (
        <div className="empty-col">{filterActive ? 'No matches' : 'No commits loaded'}</div>
      ) : (
        visible.map((r) => {
          const c = r.commit;
          const dimmed = !filterActive && query ? !r.isHit : false;
          const selected =
            selectedMatch != null && c.matchId != null && c.matchId === selectedMatch;
          const rowKey = c.sha + ':' + c.index;
          return (
            <CommitRow
              key={rowKey}
              commit={c}
              side={side}
              query={query}
              dimmed={dimmed}
              isHit={!!query && r.isHit}
              selected={selected}
              height={ROW_HEIGHT}
              top={r.displayIndex * ROW_HEIGHT}
              onSelect={onSelect}
              manualLinked={!!manualShas && manualShas.has(c.sha)}
              pending={!!pendingNode && pendingNode.side === side && pendingNode.sha === c.sha}
              onNode={onNode}
              activeHit={activeHit === rowKey}
              hasNote={!!noteShas && noteShas.has(c.sha)}
              onNoteOpen={onNoteOpen}
              color={colorMap ? colorMap[c.sha] : undefined}
              onRowMenu={onRowMenu}
              onDetail={onDetail}
            />
          );
        })
      )}
    </div>
  );
}
