/*
 * M2_GIT_DIFF
 * Copyright (c) 2026 OA Hsiao
 * SPDX-License-Identifier: MIT
 *
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */
import React, { useMemo } from 'react';
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

// First index in `flat` whose row index is >= target. `flat` holds the aligned
// (single-row) links sorted by row index, so a binary search finds the visible
// slice boundaries in O(log n) — mirroring RepoColumn's row virtualization.
function lowerBound(flat, target) {
  let lo = 0;
  let hi = flat.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (flat[mid].leftIndex < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
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

  // Split links into "flat" (both endpoints on the same display row -> a single
  // y) and "slanted" (endpoints on different rows -> a vertical span). Aligned
  // pairs — every identical-SHA and LIS-anchored match — are flat and dominate,
  // so we sort them once by row index and binary-search the visible slice. The
  // few slanted cross-row links are interval-tested directly. Rebuilt only when
  // the links themselves change.
  const { flat, slanted } = useMemo(() => {
    const flatArr = [];
    const slantArr = [];
    for (const link of links) {
      if (link.leftIndex === link.rightIndex) flatArr.push(link);
      else slantArr.push(link);
    }
    flatArr.sort((a, b) => a.leftIndex - b.leftIndex);
    return { flat: flatArr, slanted: slantArr };
  }, [links]);

  // The subset of links actually inside the visible band. Recomputed as the user
  // scrolls, but cheaply (O(log n + k) for the flat majority) and memoized so an
  // unrelated re-render (e.g. selecting a link) reuses the previous slice.
  const visibleLinks = useMemo(() => {
    if (!viewportHeight) return links; // unknown viewport -> draw everything
    // Flat links: row-center y is monotonic in leftIndex, so the [visTop,
    // visBottom] band maps to a contiguous index range. +1 on the upper bound
    // keeps the boundary row inclusive (overscan absorbs any off-by-one).
    const idxLo = (visTop - ROW_HEIGHT / 2) / ROW_HEIGHT;
    const idxHi = (visBottom - ROW_HEIGHT / 2) / ROW_HEIGHT;
    const out = flat.slice(lowerBound(flat, idxLo), lowerBound(flat, idxHi + 1));
    // Slanted links: direct interval-overlap test (there are usually very few).
    for (const link of slanted) {
      const y1 = link.leftIndex * ROW_HEIGHT + ROW_HEIGHT / 2;
      const y2 = link.rightIndex * ROW_HEIGHT + ROW_HEIGHT / 2;
      if (Math.max(y1, y2) >= visTop && Math.min(y1, y2) <= visBottom) out.push(link);
    }
    return out;
  }, [flat, slanted, links, visTop, visBottom, viewportHeight]);

  return (
    <svg className="links-svg" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {visibleLinks.map((link) => {
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
