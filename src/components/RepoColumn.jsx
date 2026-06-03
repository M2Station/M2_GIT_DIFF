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

  const visible = rows.filter((r) => r.displayIndex >= start && r.displayIndex < end);

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
