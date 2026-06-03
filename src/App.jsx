import React, { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import Toolbar from './components/Toolbar.jsx';
import RepoColumn from './components/RepoColumn.jsx';
import ConnectionLines from './components/ConnectionLines.jsx';
import { computeDiff, matchesQuery, alignLayout } from './lib/diff.js';
import { ROW_HEIGHT, GUTTER_WIDTH, DEFAULT_LIMIT } from './lib/constants.js';

const emptyRepo = { path: '', name: '', branch: '', head: '', commits: [] };

export default function App() {
  const [left, setLeft] = useState(emptyRepo);
  const [right, setRight] = useState(emptyRepo);
  const [query, setQuery] = useState('');
  const [filterOnly, setFilterOnly] = useState(false);
  const [loading, setLoading] = useState({ L: false, R: false });
  const [error, setError] = useState('');
  const [selectedMatch, setSelectedMatch] = useState(null);

  // Content-based cherry-pick matching: sha -> git patch-id. Filled lazily for
  // commits that stay `unique` after SHA + title matching.
  const [patchIds, setPatchIds] = useState({});
  const requestedShas = useRef(new Set());

  // Virtualization scroll state
  const scrollRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(800);

  const onScroll = useCallback((e) => {
    setScrollTop(e.currentTarget.scrollTop);
    setViewportHeight(e.currentTarget.clientHeight);
  }, []);

  // Measure the viewport on mount and whenever the window resizes so the
  // virtualized window renders enough rows before the first scroll.
  useEffect(() => {
    const measure = () => {
      if (scrollRef.current) setViewportHeight(scrollRef.current.clientHeight);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const pick = useCallback(async (side) => {
    setError('');
    const folder = await window.api.pickFolder();
    if (!folder) return;
    setLoading((s) => ({ ...s, [side]: true }));
    try {
      const repo = await window.api.loadRepo({ repoPath: folder, limit: DEFAULT_LIMIT });
      if (side === 'L') setLeft(repo);
      else setRight(repo);
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setLoading((s) => ({ ...s, [side]: false }));
    }
  }, []);

  // Load a repo straight from a known path (used by CLI auto-open).
  const loadPath = useCallback(async (side, repoPath) => {
    if (!repoPath) return;
    setLoading((s) => ({ ...s, [side]: true }));
    try {
      const repo = await window.api.loadRepo({ repoPath, limit: DEFAULT_LIMIT });
      if (side === 'L') setLeft(repo);
      else setRight(repo);
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setLoading((s) => ({ ...s, [side]: false }));
    }
  }, []);

  // On startup, auto-open repos passed via CLI args (-L / -R).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const init = await window.api.getInitialRepos?.();
        if (cancelled || !init) return;
        if (init.left) loadPath('L', init.left);
        if (init.right) loadPath('R', init.right);
      } catch {
        /* no CLI args / not available */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadPath]);

  const reload = useCallback(async (side) => {
    const repo = side === 'L' ? left : right;
    if (!repo.path) return;
    setLoading((s) => ({ ...s, [side]: true }));
    try {
      const fresh = await window.api.loadRepo({ repoPath: repo.path, limit: DEFAULT_LIMIT });
      if (side === 'L') setLeft(fresh);
      else setRight(fresh);
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setLoading((s) => ({ ...s, [side]: false }));
    }
  }, [left, right]);

  const diff = useMemo(() => computeDiff(left, right, patchIds), [left, right, patchIds]);

  // Fallback pass: for commits still `unique` after SHA + title matching, fetch
  // their git patch-id (content fingerprint) and retry matching by content so
  // cherry-picks with edited titles still pair up. Best-effort; runs once per
  // sha thanks to `requestedShas`.
  useEffect(() => {
    if (!left.path || !right.path) return;

    const pending = (rows) =>
      rows
        .filter((r) => r.status === 'unique' && !requestedShas.current.has(r.sha))
        .map((r) => r.sha);

    const lNeed = pending(diff.leftRows);
    const rNeed = pending(diff.rightRows);
    if (lNeed.length === 0 && rNeed.length === 0) return;

    let cancelled = false;
    (async () => {
      try {
        const [lMap, rMap] = await Promise.all([
          lNeed.length
            ? window.api.getPatchIds({ repoPath: left.path, shas: lNeed })
            : {},
          rNeed.length
            ? window.api.getPatchIds({ repoPath: right.path, shas: rNeed })
            : {}
        ]);
        // Mark as requested even on miss so we never refetch the same sha.
        [...lNeed, ...rNeed].forEach((s) => requestedShas.current.add(s));
        if (cancelled) return;
        const merged = { ...lMap, ...rMap };
        if (Object.keys(merged).length) {
          setPatchIds((prev) => ({ ...prev, ...merged }));
        }
      } catch {
        /* best-effort: fall back to title-only matching */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [diff, left.path, right.path]);

  const filterActive = filterOnly && !!query;

  // Build per-side display rows. Matched pairs (common + cherry-pick) are
  // aligned on the same display row so their connecting line is horizontal
  // ("左右對齊"). When the "filter to matches only" toggle is active,
  // non-matching rows are removed before the alignment pass.
  const view = useMemo(() => {
    const prep = (rows) =>
      rows
        .map((c) => ({ commit: c, isHit: query ? matchesQuery(c, query) : false }))
        .filter((r) => !(filterActive && !r.isHit));

    return alignLayout(prep(diff.leftRows), prep(diff.rightRows), diff.links);
  }, [diff, query, filterActive]);

  const matchCount = useMemo(() => {
    if (!query) return 0;
    let n = 0;
    diff.leftRows.forEach((c) => matchesQuery(c, query) && n++);
    diff.rightRows.forEach((c) => matchesQuery(c, query) && n++);
    return n;
  }, [query, diff]);

  const bodyHeight = view.totalRows * ROW_HEIGHT;

  // Select a match and move keyboard focus to the diff body so Esc / blank
  // clicks can clear it. Passing null clears the selection.
  const handleSelect = useCallback((id) => {
    setSelectedMatch(id);
    if (id != null) scrollRef.current?.focus();
  }, []);

  // Click on empty gutter / column background clears the selection. Row and
  // connection-line clicks stop propagation, so they never reach here.
  const onBodyClick = useCallback(() => setSelectedMatch(null), []);

  // Esc clears the current selection.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') setSelectedMatch(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app">
      <Toolbar
        left={left}
        right={right}
        loading={loading}
        query={query}
        onQuery={setQuery}
        onPick={pick}
        onReload={reload}
        leftStats={diff.leftStats}
        rightStats={diff.rightStats}
        matchCount={matchCount}
        filterOnly={filterOnly}
        onToggleFilter={() => setFilterOnly((v) => !v)}
      />

      {error && <div className="error-bar">⚠ {error}</div>}

      <div
        className="diff-body"
        ref={scrollRef}
        onScroll={onScroll}
        onClick={onBodyClick}
        tabIndex={-1}
      >
        <div className="diff-scroll" style={{ minHeight: bodyHeight }}>
          <RepoColumn
            side="L"
            rows={view.L.rows}
            totalRows={view.totalRows}
            query={query}
            filterActive={filterActive}
            scrollTop={scrollTop}
            viewportHeight={viewportHeight}
            selectedMatch={selectedMatch}
            onSelect={handleSelect}
          />

          <div className="gutter" style={{ width: GUTTER_WIDTH, minHeight: bodyHeight }}>
            <ConnectionLines
              links={view.links}
              height={bodyHeight}
              width={GUTTER_WIDTH}
              selectedMatch={selectedMatch}
              onSelect={handleSelect}
            />
          </div>

          <RepoColumn
            side="R"
            rows={view.R.rows}
            totalRows={view.totalRows}
            query={query}
            filterActive={filterActive}
            scrollTop={scrollTop}
            viewportHeight={viewportHeight}
            selectedMatch={selectedMatch}
            onSelect={handleSelect}
          />
        </div>
      </div>

      <div className="legend">
        <span className="chip common">■ Common (same SHA)</span>
        <span className="chip cherry">■ Cherry-pick (same title)</span>
        <span className="chip unique">■ Unique (one side only)</span>
        <span className="spacer" />
        <span className="hint">Click a linked row to highlight its connection</span>
      </div>
    </div>
  );
}
