import React, { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import Toolbar from './components/Toolbar.jsx';
import RepoColumn from './components/RepoColumn.jsx';
import ConnectionLines from './components/ConnectionLines.jsx';
import SearchPanel from './components/SearchPanel.jsx';
import NotePopup from './components/NotePopup.jsx';
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

  // Manual links: user-drawn connections between two unmatched commits, stored
  // as { leftSha, rightSha } and persisted per repo-pair so reopening the same
  // repros resumes them. `pendingNode` holds the first endpoint while linking.
  const [manualLinks, setManualLinks] = useState([]);
  const [pendingNode, setPendingNode] = useState(null); // { side, sha } | null
  const hydratedKeyRef = useRef(null);
  const skipSaveRef = useRef(false);

  // Per-commit notes: { [`${side}:${sha}`]: text }. Persisted alongside manual
  // links (same repo-pair key) in localStorage. `notePopup` drives the floating
  // editor/viewer: { side, sha, x, y } | null.
  const [notes, setNotes] = useState({});
  const [notePopup, setNotePopup] = useState(null);
  const notesHydratedRef = useRef(null);
  const notesSkipSaveRef = useRef(false);

  // Virtualization scroll state
  const scrollRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(800);

  // Search box ref (Ctrl+F focus) and F3 cycling through matched rows.
  const searchRef = useRef(null);
  const [activeHit, setActiveHit] = useState(null); // row key currently focused
  const hitIdxRef = useRef(-1);

  // Floating search panel: open/closed + which commit fields to search.
  const [searchOpen, setSearchOpen] = useState(false);
  const [scopes, setScopes] = useState({
    subject: true,
    body: true,
    sha: true,
    author: true,
    date: true
  });
  const toggleScope = useCallback((key) => {
    setScopes((s) => {
      const next = { ...s, [key]: !s[key] };
      // Never allow zero scopes -> fall back to keeping the one just toggled on.
      if (!Object.values(next).some(Boolean)) return s;
      return next;
    });
  }, []);

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

  const diff = useMemo(
    () => computeDiff(left, right, patchIds, manualLinks),
    [left, right, patchIds, manualLinks]
  );

  // ---- Manual links: persistence (resume the same repro pair) ----
  const linkKey = left.path && right.path ? `${left.path}|${right.path}` : null;

  // Load saved manual links whenever the repo pair changes.
  useEffect(() => {
    if (!linkKey) return;
    let parsed = [];
    try {
      const raw = localStorage.getItem('mlink:' + linkKey);
      if (raw) parsed = JSON.parse(raw);
    } catch {
      parsed = [];
    }
    skipSaveRef.current = true; // don't immediately rewrite what we just read
    hydratedKeyRef.current = linkKey;
    setManualLinks(Array.isArray(parsed) ? parsed : []);
    setPendingNode(null);
  }, [linkKey]);

  // Persist manual links after any user change (skips the post-hydration pass).
  useEffect(() => {
    if (!linkKey || hydratedKeyRef.current !== linkKey) return;
    if (skipSaveRef.current) {
      skipSaveRef.current = false;
      return;
    }
    try {
      localStorage.setItem('mlink:' + linkKey, JSON.stringify(manualLinks));
    } catch {
      /* storage full / unavailable -> links live for this session only */
    }
  }, [manualLinks, linkKey]);

  // Per-side sets of SHAs that already take part in a manual link.
  const manualShas = useMemo(() => {
    const L = new Set();
    const R = new Set();
    manualLinks.forEach((l) => {
      L.add(l.leftSha);
      R.add(l.rightSha);
    });
    return { L, R };
  }, [manualLinks]);

  // Click on a row's link node: start, complete, or break a manual link.
  const onNode = useCallback(
    (side, sha) => {
      // Already part of a manual link -> clicking the node disconnects it.
      const existing = manualLinks.find((l) =>
        side === 'L' ? l.leftSha === sha : l.rightSha === sha
      );
      if (existing) {
        setManualLinks((prev) => prev.filter((l) => l !== existing));
        setPendingNode(null);
        return;
      }
      // No pending source, or clicking another node on the same side -> (re)arm.
      if (!pendingNode || pendingNode.side === side) {
        setPendingNode({ side, sha });
        return;
      }
      // Opposite side -> complete the link (one endpoint each side).
      const leftSha = side === 'L' ? sha : pendingNode.sha;
      const rightSha = side === 'R' ? sha : pendingNode.sha;
      setManualLinks((prev) => [
        ...prev.filter((l) => l.leftSha !== leftSha && l.rightSha !== rightSha),
        { leftSha, rightSha }
      ]);
      setPendingNode(null);
    },
    [manualLinks, pendingNode]
  );

  // Wipe every manual link for the current repo pair and remove its persisted
  // entry from localStorage.
  const clearManualLinks = useCallback(() => {
    setManualLinks([]);
    setPendingNode(null);
    if (linkKey) {
      try {
        localStorage.removeItem('mlink:' + linkKey);
      } catch {
        /* storage unavailable -> nothing persisted to remove */
      }
    }
  }, [linkKey]);

  // ---- Per-commit notes: persistence (same repo-pair key) ----
  // Load saved notes whenever the repo pair changes.
  useEffect(() => {
    if (!linkKey) return;
    let parsed = {};
    try {
      const raw = localStorage.getItem('note:' + linkKey);
      if (raw) parsed = JSON.parse(raw);
    } catch {
      parsed = {};
    }
    notesSkipSaveRef.current = true;
    notesHydratedRef.current = linkKey;
    setNotes(parsed && typeof parsed === 'object' ? parsed : {});
    setNotePopup(null);
  }, [linkKey]);

  // Persist notes after any user change (skips the post-hydration pass).
  useEffect(() => {
    if (!linkKey || notesHydratedRef.current !== linkKey) return;
    if (notesSkipSaveRef.current) {
      notesSkipSaveRef.current = false;
      return;
    }
    try {
      localStorage.setItem('note:' + linkKey, JSON.stringify(notes));
    } catch {
      /* storage unavailable -> notes live for this session only */
    }
  }, [notes, linkKey]);

  const noteIdOf = (side, sha) => `${side}:${sha}`;

  // Open the floating note editor/viewer at the click position.
  const openNote = useCallback((side, sha, x, y) => {
    setNotePopup({ side, sha, x, y });
  }, []);

  // Save (or clear when empty) the note for one commit.
  const saveNote = useCallback((side, sha, text) => {
    const id = `${side}:${sha}`;
    setNotes((prev) => {
      const next = { ...prev };
      const trimmed = (text || '').trim();
      if (trimmed) next[id] = trimmed;
      else delete next[id];
      return next;
    });
  }, []);

  // Delete the note for one commit and close the popup.
  const deleteNote = useCallback((side, sha) => {
    const id = `${side}:${sha}`;
    setNotes((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setNotePopup(null);
  }, []);

  // Wipe every note for the current repo pair and remove its persisted entry.
  const clearNotes = useCallback(() => {
    setNotes({});
    setNotePopup(null);
    if (linkKey) {
      try {
        localStorage.removeItem('note:' + linkKey);
      } catch {
        /* storage unavailable -> nothing persisted to remove */
      }
    }
  }, [linkKey]);

  // Per-side sets of SHAs that carry a note (for the row indicator icon).
  const noteShas = useMemo(() => {
    const L = new Set();
    const R = new Set();
    Object.keys(notes).forEach((id) => {
      const sep = id.indexOf(':');
      const side = id.slice(0, sep);
      const sha = id.slice(sep + 1);
      (side === 'L' ? L : R).add(sha);
    });
    return { L, R };
  }, [notes]);

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
        .map((c) => ({ commit: c, isHit: query ? matchesQuery(c, query, scopes) : false }))
        .filter((r) => !(filterActive && !r.isHit));

    return alignLayout(prep(diff.leftRows), prep(diff.rightRows), diff.links);
  }, [diff, query, filterActive, scopes]);

  const matchCount = useMemo(() => {
    if (!query) return 0;
    let n = 0;
    diff.leftRows.forEach((c) => matchesQuery(c, query, scopes) && n++);
    diff.rightRows.forEach((c) => matchesQuery(c, query, scopes) && n++);
    return n;
  }, [query, diff, scopes]);

  // Flat list of matched rows in display order (top-to-bottom, left before
  // right) so F3 can cycle through them.
  const hits = useMemo(() => {
    if (!query) return [];
    const collect = (rows, side) =>
      rows
        .filter((r) => r.isHit && r.displayIndex != null)
        .map((r) => ({
          side,
          displayIndex: r.displayIndex,
          key: r.commit.sha + ':' + r.commit.index
        }));
    return [...collect(view.L.rows, 'L'), ...collect(view.R.rows, 'R')].sort(
      (a, b) => a.displayIndex - b.displayIndex || (a.side < b.side ? -1 : 1)
    );
  }, [view, query]);

  // Reset the cycle cursor whenever the matched set changes.
  useEffect(() => {
    hitIdxRef.current = -1;
    setActiveHit(null);
  }, [query, scopes]);

  // Scroll the next (or previous) matched row into view and highlight it.
  const cycleHit = useCallback(
    (dir) => {
      if (hits.length === 0) return;
      const next = (hitIdxRef.current + dir + hits.length) % hits.length;
      hitIdxRef.current = next;
      const hit = hits[next];
      setActiveHit(hit.key);
      const el = scrollRef.current;
      if (el) {
        const target = hit.displayIndex * ROW_HEIGHT - el.clientHeight / 2 + ROW_HEIGHT / 2;
        el.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
      }
    },
    [hits]
  );

  const bodyHeight = view.totalRows * ROW_HEIGHT;

  // Select a match and move keyboard focus to the diff body so Esc / blank
  // clicks can clear it. Passing null clears the selection.
  const handleSelect = useCallback((id) => {
    setSelectedMatch(id);
    if (id != null) scrollRef.current?.focus();
  }, []);

  // Click on empty gutter / column background clears the selection. Row and
  // connection-line clicks stop propagation, so they never reach here.
  const onBodyClick = useCallback(() => {
    setSelectedMatch(null);
    setPendingNode(null);
  }, []);

  // Open (or re-focus) the floating search panel and select its text.
  const openSearch = useCallback(() => {
    setSearchOpen(true);
    // Focus after the panel has mounted/rendered.
    requestAnimationFrame(() => {
      searchRef.current?.focus();
      searchRef.current?.select();
    });
  }, []);

  // Esc clears the current selection / pending manual link. Delete removes the
  // selected manual link. Ctrl+F opens search, F3 cycles matches.
  useEffect(() => {
    const onKey = (e) => {
      // Ctrl/Cmd+F -> open the floating search panel.
      if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        openSearch();
        return;
      }
      // F3 -> cycle through highlighted matches (Shift+F3 goes backwards).
      if (e.key === 'F3') {
        e.preventDefault();
        cycleHit(e.shiftKey ? -1 : 1);
        return;
      }
      if (e.key === 'Escape') {
        setSelectedMatch(null);
        setPendingNode(null);
        setNotePopup(null);
      } else if (
        (e.key === 'Delete' || e.key === 'Backspace') &&
        typeof selectedMatch === 'string' &&
        selectedMatch.startsWith('manual:')
      ) {
        const body = selectedMatch.slice('manual:'.length);
        const sep = body.indexOf('|');
        const leftSha = body.slice(0, sep);
        const rightSha = body.slice(sep + 1);
        setManualLinks((prev) =>
          prev.filter((l) => !(l.leftSha === leftSha && l.rightSha === rightSha))
        );
        setSelectedMatch(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedMatch, cycleHit, openSearch]);

  // Close the floating search panel (clears query + highlights).
  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setQuery('');
    scrollRef.current?.focus();
  }, []);

  // Esc inside the search box closes the panel, clearing the query and its
  // highlights and returning focus to the diff body.
  const onSearchKeyDown = useCallback(
    (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeSearch();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        cycleHit(e.shiftKey ? -1 : 1);
      }
    },
    [closeSearch, cycleHit]
  );

  return (
    <div className="app">
      <Toolbar
        left={left}
        right={right}
        loading={loading}
        onPick={pick}
        onReload={reload}
        leftStats={diff.leftStats}
        rightStats={diff.rightStats}
        onOpenSearch={openSearch}
        manualCount={manualLinks.length}
        onClearManualLinks={clearManualLinks}
        noteCount={Object.keys(notes).length}
        onClearNotes={clearNotes}
      />

      {searchOpen && (
        <SearchPanel
          query={query}
          onQuery={setQuery}
          scopes={scopes}
          onToggleScope={toggleScope}
          matchCount={matchCount}
          filterOnly={filterOnly}
          onToggleFilter={() => setFilterOnly((v) => !v)}
          onPrev={() => cycleHit(-1)}
          onNext={() => cycleHit(1)}
          onClose={closeSearch}
          inputRef={searchRef}
          onInputKeyDown={onSearchKeyDown}
        />
      )}

      {notePopup && (() => {
        const arr = notePopup.side === 'L' ? left.commits : right.commits;
        const c = arr.find((x) => x.sha === notePopup.sha);
        return (
          <NotePopup
            key={notePopup.side + ':' + notePopup.sha}
            side={notePopup.side}
            sha={notePopup.sha}
            short={c?.short || notePopup.sha.slice(0, 7)}
            subject={c?.subject || ''}
            x={notePopup.x}
            y={notePopup.y}
            value={notes[noteIdOf(notePopup.side, notePopup.sha)] || ''}
            onSave={saveNote}
            onDelete={deleteNote}
            onClose={() => setNotePopup(null)}
          />
        );
      })()}

      {error && <div className="error-bar">⚠ {error}</div>}

      <div
        className={'diff-body' + (pendingNode ? ' linking' : '')}
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
            manualShas={manualShas.L}
            pendingNode={pendingNode}
            onNode={onNode}
            activeHit={activeHit}
            noteShas={noteShas.L}
            onNoteOpen={openNote}
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
            manualShas={manualShas.R}
            pendingNode={pendingNode}
            onNode={onNode}
            activeHit={activeHit}
            noteShas={noteShas.R}
            onNoteOpen={openNote}
          />
        </div>
      </div>

      <div className="legend">
        <span className="chip common">■ Common (same SHA)</span>
        <span className="chip cherry">■ Cherry-pick (same title)</span>
        <span className="chip unique">■ Unique (one side only)</span>
        <span className="chip manual">■ Manual link</span>
        <span className="spacer" />
        <span className="hint">
          {pendingNode
            ? 'Pick a node on the other side to link · Esc to cancel'
            : 'Click a row node ◗ to link two commits · Del removes a selected manual link'}
        </span>
      </div>
    </div>
  );
}
