/*
 * M2_GIT_DIFF
 * Copyright (c) 2026 OA Hsiao
 * SPDX-License-Identifier: MIT
 *
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */
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
  vtagMap,
  onRowMenu,
  plain,
  onDetail,
  onPick,
  pickedShas,
  pickOrder
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
          const pickKey = side + ':' + c.sha;
          const pickIdx = pickOrder ? pickOrder.get(pickKey) : undefined;
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
              vtag={vtagMap ? vtagMap[c.sha] : undefined}
              onRowMenu={onRowMenu}
              onDetail={onDetail}
              onPick={onPick}
              picked={!!pickedShas && pickedShas.has(pickKey)}
              pickIndex={pickIdx}
            />
          );
        })
      )}
    </div>
  );
}
