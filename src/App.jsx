import React, { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import Toolbar from './components/Toolbar.jsx';
import RepoColumn from './components/RepoColumn.jsx';
import RepoGitBar from './components/RepoGitBar.jsx';
import ConnectionLines from './components/ConnectionLines.jsx';
import SearchPanel from './components/SearchPanel.jsx';
import NotePopup from './components/NotePopup.jsx';
import RowMenu from './components/RowMenu.jsx';
import CommitDetail from './components/CommitDetail.jsx';
import GitTerminalPopup from './components/GitTerminalPopup.jsx';
import ExportPrompt from './components/ExportPrompt.jsx';
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

  // Floating window showing the git terminal transcript after a Fetch/Pull.
  // { side, op, repoName, ok, command, output, exitCode } | null
  const [gitTerminal, setGitTerminal] = useState(null);

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

  // Per-commit forced background color: { [`${side}:${sha}`]: 'green'|'red'|
  // 'blue'|'yellow' }. Persisted alongside notes/links (same repo-pair key).
  // `rowMenu` drives the right-click context menu: { side, sha, x, y } | null.
  const [colors, setColors] = useState({});
  const [rowMenu, setRowMenu] = useState(null);
  const colorsHydratedRef = useRef(null);
  const colorsSkipSaveRef = useRef(false);

  // User-defined custom swatch (a `#rrggbb` hex), shown as the 5th quick color
  // in the right-click menu. Persisted globally (not per repo-pair).
  const [customSwatch, setCustomSwatch] = useState(() => {
    try {
      const v = localStorage.getItem('customSwatch');
      return /^#[0-9a-fA-F]{6}$/.test(v || '') ? v : null;
    } catch {
      return null;
    }
  });

  // Commit detail popups (Ctrl+Click a row). Multiple can be open at once;
  // each entry is { side, sha, x, y }. Ctrl+Clicking an already-open commit is
  // ignored (no duplicate window).
  const [details, setDetails] = useState([]);

  // Virtualization scroll state
  const scrollRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(800);

  // Search box ref (Ctrl+F focus) and F3 cycling through matched rows.
  const searchRef = useRef(null);
  const [activeHit, setActiveHit] = useState(null); // row key currently focused
  const hitIdxRef = useRef(-1);
  const noteIdxRef = useRef(-1); // cursor for the note navigator

  // Floating search panel: open/closed + which commit fields to search.
  const [searchOpen, setSearchOpen] = useState(false);
  // Single-repo mode: null = dual compare; 'L' or 'R' = show only that repo,
  // full width. Toggled from the toolbar.
  const [single, setSingle] = useState(null);
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

  // Run a whitelisted git operation (fetch/pull/push) on one side, then reload
  // that repo so the commit graph reflects the result.
  const runGitOp = useCallback(async (side, op) => {
    const repo = side === 'L' ? left : right;
    if (!repo.path) return;
    setError('');
    setLoading((s) => ({ ...s, [side]: true }));
    try {
      const res = await window.api.gitOp({ repoPath: repo.path, op });
      // Surface the full git terminal transcript in a floating window, whether
      // the operation succeeded or failed.
      setGitTerminal({
        side,
        op,
        repoName: repo.name || repo.path,
        ok: res?.ok !== false,
        command: res?.command || `git ${op}`,
        output: res?.output || '',
        exitCode: typeof res?.exitCode === 'number' ? res.exitCode : res?.ok === false ? 1 : 0
      });
      if (res?.ok !== false) {
        const fresh = await window.api.loadRepo({ repoPath: repo.path, limit: DEFAULT_LIMIT });
        if (side === 'L') setLeft(fresh);
        else setRight(fresh);
      }
    } catch (e) {
      const msg = String(e?.message || e);
      setGitTerminal({
        side,
        op,
        repoName: repo.name || repo.path,
        ok: false,
        command: `git ${op}`,
        output: msg,
        exitCode: 1
      });
      setError(`git ${op} 失敗：${msg}`);
    } finally {
      setLoading((s) => ({ ...s, [side]: false }));
    }
  }, [left, right]);

  const diff = useMemo(
    () => computeDiff(left, right, patchIds, manualLinks),
    [left, right, patchIds, manualLinks]
  );

  // Swap the LEFT and RIGHT sides. Repos plus every side-keyed piece of state
  // (manual links, notes, colors, single-repo mode, open detail windows, the
  // pending link node) are mirrored. Persisted annotations are keyed by the
  // ordered repo-pair path, so we pre-write the swapped data under the new key
  // before flipping the repos; the hydration effect then restores it mirrored.
  const swapSides = useCallback(() => {
    if (!left.path && !right.path) return;

    const newKey = left.path && right.path ? `${right.path}|${left.path}` : null;
    if (newKey) {
      const swappedLinks = manualLinks.map((l) => ({
        leftSha: l.rightSha,
        rightSha: l.leftSha
      }));
      const swapPrefix = (obj) => {
        const out = {};
        for (const [id, v] of Object.entries(obj)) {
          const sep = id.indexOf(':');
          const side = id.slice(0, sep);
          const sha = id.slice(sep + 1);
          out[(side === 'L' ? 'R' : 'L') + ':' + sha] = v;
        }
        return out;
      };
      try {
        localStorage.setItem('mlink:' + newKey, JSON.stringify(swappedLinks));
        localStorage.setItem('note:' + newKey, JSON.stringify(swapPrefix(notes)));
        localStorage.setItem('color:' + newKey, JSON.stringify(swapPrefix(colors)));
      } catch {
        /* storage unavailable -> swap lives for this session only */
      }
    }

    setLeft(right);
    setRight(left);
    setLoading((s) => ({ L: s.R, R: s.L }));
    setSingle((s) => (s === 'L' ? 'R' : s === 'R' ? 'L' : null));
    setDetails((ds) => ds.map((d) => ({ ...d, side: d.side === 'L' ? 'R' : 'L' })));
    setPendingNode((p) => (p ? { ...p, side: p.side === 'L' ? 'R' : 'L' } : null));
    setNotePopup(null);
    setRowMenu(null);

    // Mirror in-memory annotations too. When a persistence key exists the
    // hydration effect re-reads the (pre-swapped) storage to the same result;
    // when only one side is loaded (no key) this is the only swap that runs.
    const flipPrefix = (obj) => {
      const out = {};
      for (const [id, v] of Object.entries(obj)) {
        const sep = id.indexOf(':');
        out[(id.slice(0, sep) === 'L' ? 'R' : 'L') + ':' + id.slice(sep + 1)] = v;
      }
      return out;
    };
    setManualLinks((ls) => ls.map((l) => ({ leftSha: l.rightSha, rightSha: l.leftSha })));
    setNotes((n) => flipPrefix(n));
    setColors((c) => flipPrefix(c));
  }, [left, right, manualLinks, notes, colors]);

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

  // ---- Per-commit forced colors: persistence (same repo-pair key) ----
  useEffect(() => {
    if (!linkKey) return;
    let parsed = {};
    try {
      const raw = localStorage.getItem('color:' + linkKey);
      if (raw) parsed = JSON.parse(raw);
    } catch {
      parsed = {};
    }
    colorsSkipSaveRef.current = true;
    colorsHydratedRef.current = linkKey;
    setColors(parsed && typeof parsed === 'object' ? parsed : {});
    setRowMenu(null);
  }, [linkKey]);

  useEffect(() => {
    if (!linkKey || colorsHydratedRef.current !== linkKey) return;
    if (colorsSkipSaveRef.current) {
      colorsSkipSaveRef.current = false;
      return;
    }
    try {
      localStorage.setItem('color:' + linkKey, JSON.stringify(colors));
    } catch {
      /* storage unavailable -> colors live for this session only */
    }
  }, [colors, linkKey]);

  // Open the right-click context menu (note + color override) at the cursor.
  const openRowMenu = useCallback((side, sha, x, y) => {
    setRowMenu({ side, sha, x, y });
  }, []);

  // Set (or toggle off) the forced background color for one commit.
  const setColor = useCallback((side, sha, color) => {
    const id = `${side}:${sha}`;
    setColors((prev) => {
      const next = { ...prev };
      if (!color || prev[id] === color) delete next[id];
      else next[id] = color;
      return next;
    });
  }, []);

  // Pick a user-defined color: remember it as the 5th quick swatch (persisted)
  // and immediately apply it to the targeted commit.
  const pickCustomColor = useCallback((side, sha, hex) => {
    if (!/^#[0-9a-fA-F]{6}$/.test(hex || '')) return;
    const value = hex.toLowerCase();
    setCustomSwatch(value);
    try {
      localStorage.setItem('customSwatch', value);
    } catch {
      /* ignore quota/availability errors */
    }
    const id = `${side}:${sha}`;
    setColors((prev) => ({ ...prev, [id]: value }));
  }, []);

  // Remove the forced color for one commit.
  const clearColor = useCallback((side, sha) => {
    const id = `${side}:${sha}`;
    setColors((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  // Wipe every forced color for the current repo pair.
  const clearColors = useCallback(() => {
    setColors({});
    setRowMenu(null);
    if (linkKey) {
      try {
        localStorage.removeItem('color:' + linkKey);
      } catch {
        /* storage unavailable -> nothing persisted to remove */
      }
    }
  }, [linkKey]);

  // Per-side maps of SHA -> forced color (for the row background override).
  const colorMap = useMemo(() => {
    const L = {};
    const R = {};
    Object.keys(colors).forEach((id) => {
      const sep = id.indexOf(':');
      const side = id.slice(0, sep);
      const sha = id.slice(sep + 1);
      (side === 'L' ? L : R)[sha] = colors[id];
    });
    return { L, R };
  }, [colors]);

  // Open a commit detail popup (Ctrl+Click). Ignores commits already shown so
  // clicking an open one doesn't spawn a duplicate; cascades new windows a bit.
  const openDetail = useCallback((side, sha, x, y) => {
    setDetails((prev) => {
      if (prev.some((d) => d.side === side && d.sha === sha)) return prev;
      const offset = prev.length * 26;
      return [...prev, { side, sha, x: (x || 80) + offset, y: (y || 80) + offset }];
    });
  }, []);

  const closeDetail = useCallback((side, sha) => {
    setDetails((prev) => prev.filter((d) => !(d.side === side && d.sha === sha)));
  }, []);

  // Resolve a commit and its matched ("related") counterpart on the other side,
  // using the classified rows from computeDiff (which carry the shared matchId).
  const resolveDetail = useCallback(
    (side, sha) => {
      const ownRows = side === 'L' ? diff.leftRows : diff.rightRows;
      const otherRows = side === 'L' ? diff.rightRows : diff.leftRows;
      const commit = ownRows.find((c) => c.sha === sha);
      if (!commit) return null;
      let related = null;
      if (commit.matchId) {
        const other = otherRows.find((c) => c.matchId === commit.matchId);
        if (other) {
          related = {
            side: side === 'L' ? 'R' : 'L',
            commit: other,
            type: commit.status === 'common' ? 'common' : commit.manual ? 'manual' : commit.status
          };
        }
      }
      return { commit, related };
    },
    [diff]
  );

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

    // Single-repo mode: stack the chosen repo's commits sequentially, no
    // alignment gaps, no cross-links.
    if (single) {
      const rows = prep(single === 'L' ? diff.leftRows : diff.rightRows).map((r, i) => ({
        commit: r.commit,
        displayIndex: i,
        isHit: r.isHit
      }));
      const sideData = { rows, count: rows.length };
      const empty = { rows: [], count: 0 };
      return {
        L: single === 'L' ? sideData : empty,
        R: single === 'R' ? sideData : empty,
        links: [],
        totalRows: rows.length
      };
    }

    return alignLayout(prep(diff.leftRows), prep(diff.rightRows), diff.links);
  }, [diff, query, filterActive, scopes, single]);
  // Export the aligned diff (notes + forced colors + manual links) to a styled
  // .xlsx. Matched pairs already share a display row, so commits stay aligned;
  // alignment gaps become empty cells. Notes ride along as cell tooltips.
  const [exporting, setExporting] = useState(false);
  // Pre-export prompt: ask how many rows to write (guards against huge files).
  // { total } while open, null when closed. Default choice is ALL.
  const [exportPrompt, setExportPrompt] = useState(null);
  const canExport = (left.commits.length > 0 || right.commits.length > 0) && !exporting;

  // Build the full ordered row list (aligned, empty cells for gaps) plus the
  // flat manual-link list. Shared by the prompt (to know the row count) and the
  // actual export (which may slice to a user-chosen limit).
  const buildExportRows = useCallback(() => {
    const total = view.totalRows || 0;
    const leftByRow = new Array(total).fill(null);
    const rightByRow = new Array(total).fill(null);

    const cellFor = (commit, side) => ({
      short: commit.short,
      sha: commit.sha,
      subject: commit.subject,
      author: commit.author,
      date: commit.authorDate,
      color: colors[noteIdOf(side, commit.sha)] || null,
      note: notes[noteIdOf(side, commit.sha)] || null
    });

    view.L.rows.forEach((r) => {
      if (r.displayIndex != null) leftByRow[r.displayIndex] = cellFor(r.commit, 'L');
    });
    view.R.rows.forEach((r) => {
      if (r.displayIndex != null) rightByRow[r.displayIndex] = cellFor(r.commit, 'R');
    });

    // Connector type per display row (aligned pairs land on the same row).
    const linkByRow = new Array(total).fill(null);
    view.links.forEach((l) => {
      if (l.leftIndex != null) linkByRow[l.leftIndex] = l.type;
      if (l.rightIndex != null) linkByRow[l.rightIndex] = l.type;
    });

    const rows = [];
    for (let i = 0; i < total; i++) {
      const lc = leftByRow[i];
      const rc = rightByRow[i];
      if (!lc && !rc) continue; // skip fully-empty rows
      rows.push({ left: lc, right: rc, link: linkByRow[i] });
    }

    // Every manual link spelled out (covers non-aligned/slanted pairs too).
    const manualLinks = diff.links
      .filter((l) => l.type === 'manual')
      .map((l) => {
        const lc = diff.leftRows[l.leftIndex];
        const rc = diff.rightRows[l.rightIndex];
        return {
          leftShort: lc?.short || '',
          leftSubject: lc?.subject || '',
          rightShort: rc?.short || '',
          rightSubject: rc?.subject || ''
        };
      });

    return { rows, manualLinks };
  }, [view, colors, notes, diff]);

  // Step 1: clicking Export opens the row-count prompt (default ALL).
  const openExportPrompt = useCallback(() => {
    if (typeof window.api?.exportExcel !== 'function') {
      setError('此版本不支援匯出（請更新 app）。');
      return;
    }
    const { rows } = buildExportRows();
    if (rows.length === 0) {
      setError('沒有可匯出的資料。');
      return;
    }
    setExportPrompt({ total: rows.length });
  }, [buildExportRows]);

  // Step 2: run the export. `limit` is null = ALL, or a positive row count.
  const runExport = useCallback(
    async (limit) => {
      const { rows: allRows, manualLinks } = buildExportRows();
      const rows =
        limit && limit > 0 && limit < allRows.length ? allRows.slice(0, limit) : allRows;

      const defaultName = `${left.name || 'left'}__vs__${right.name || 'right'}`.replace(
        /[\\/:*?"<>|]+/g,
        '-'
      );

      setExportPrompt(null);
      setExporting(true);
      setError('');
      try {
        const res = await window.api.exportExcel({
          leftName: left.name || 'LEFT',
          rightName: right.name || 'RIGHT',
          defaultName,
          rows,
          manualLinks
        });
        if (res?.canceled) return;
        setGitTerminal({
          side: 'L',
          op: 'export',
          repoName: res?.path || '',
          ok: true,
          command: 'Excel 匯出',
          output: `已匯出 ${rows.length} 列（含 ${manualLinks.length} 個手動連結）到：\n${res?.path || ''}`,
          exitCode: 0
        });
      } catch (e) {
        setError('匯出 Excel 失敗：' + String(e?.message || e));
      } finally {
        setExporting(false);
      }
    },
    [buildExportRows, left, right]
  );

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

  // Flat list of rows that have a note, in display order, so the note
  // navigator (separate from search) can jump between them.
  const noteHits = useMemo(() => {
    const collect = (rows, side) =>
      rows
        .filter((r) => r.displayIndex != null && noteShas[side].has(r.commit.sha))
        .map((r) => ({
          side,
          displayIndex: r.displayIndex,
          key: r.commit.sha + ':' + r.commit.index
        }));
    return [...collect(view.L.rows, 'L'), ...collect(view.R.rows, 'R')].sort(
      (a, b) => a.displayIndex - b.displayIndex || (a.side < b.side ? -1 : 1)
    );
  }, [view, noteShas]);

  // Reset the note cursor whenever the set of noted rows changes.
  useEffect(() => {
    noteIdxRef.current = -1;
  }, [noteHits.length]);

  // Scroll the next (or previous) noted row into view and highlight it.
  const cycleNote = useCallback(
    (dir) => {
      if (noteHits.length === 0) return;
      const next = (noteIdxRef.current + dir + noteHits.length) % noteHits.length;
      noteIdxRef.current = next;
      const hit = noteHits[next];
      setActiveHit(hit.key);
      const el = scrollRef.current;
      if (el) {
        const target = hit.displayIndex * ROW_HEIGHT - el.clientHeight / 2 + ROW_HEIGHT / 2;
        el.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
      }
    },
    [noteHits]
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

  // Close the floating search panel (clears query + highlights).
  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setQuery('');
    scrollRef.current?.focus();
  }, []);

  // Esc clears the current selection / pending manual link. Delete removes the
  // selected manual link. Ctrl+F opens search, Alt+F opens a repo, F3 cycles.
  useEffect(() => {
    const onKey = (e) => {
      // Alt+F -> open a repo via the folder picker. Left first; once the left
      // side is set, Alt+F targets the right side (so when neither or only-left
      // is chosen it fills the next empty slot, and when both are already
      // chosen it re-opens the right side).
      if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        if (!loading.L && !loading.R) pick(left.path ? 'R' : 'L');
        return;
      }
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
        if (searchOpen) {
          closeSearch();
        }
        setSelectedMatch(null);
        setPendingNode(null);
        setNotePopup(null);
        setRowMenu(null);
        setDetails([]);
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
  }, [selectedMatch, cycleHit, openSearch, searchOpen, closeSearch, pick, left.path, loading.L, loading.R]);

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
        colorCount={Object.keys(colors).length}
        onClearColors={clearColors}
        single={single}
        onSetSingle={setSingle}
        onSwapSides={swapSides}
        onExport={openExportPrompt}
        canExport={canExport}
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
          noteCount={noteHits.length}
          onPrevNote={() => cycleNote(-1)}
          onNextNote={() => cycleNote(1)}
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

      {rowMenu && (() => {
        const arr = rowMenu.side === 'L' ? left.commits : right.commits;
        const c = arr.find((x) => x.sha === rowMenu.sha);
        return (
          <RowMenu
            key={rowMenu.side + ':' + rowMenu.sha}
            side={rowMenu.side}
            sha={rowMenu.sha}
            short={c?.short || rowMenu.sha.slice(0, 7)}
            x={rowMenu.x}
            y={rowMenu.y}
            hasNote={!!notes[noteIdOf(rowMenu.side, rowMenu.sha)]}
            color={colors[noteIdOf(rowMenu.side, rowMenu.sha)] || null}
            customColor={customSwatch}
            onAddNote={openNote}
            onSetColor={setColor}
            onPickCustom={pickCustomColor}
            onClearColor={clearColor}
            onClose={() => setRowMenu(null)}
          />
        );
      })()}

      {details.map((d) => {
        const data = resolveDetail(d.side, d.sha);
        if (!data) return null;
        return (
          <CommitDetail
            key={d.side + ':' + d.sha}
            side={d.side}
            commit={data.commit}
            related={data.related}
            repoPath={d.side === 'L' ? left.path : right.path}
            x={d.x}
            y={d.y}
            searchTerm={query}
            onClose={() => closeDetail(d.side, d.sha)}
            onOpenRelated={(side, sha) => openDetail(side, sha, d.x + 40, d.y + 40)}
          />
        );
      })}

      {error && <div className="error-bar">⚠ {error}</div>}

      {gitTerminal && (
        <GitTerminalPopup
          info={gitTerminal}
          onClose={() => setGitTerminal(null)}
        />
      )}

      {exportPrompt && (
        <ExportPrompt
          total={exportPrompt.total}
          onExport={runExport}
          onCancel={() => setExportPrompt(null)}
        />
      )}

      <div className="git-bars">
        {single !== 'R' && (
          <RepoGitBar side="L" repo={left} loading={loading.L} onGitOp={runGitOp} onReload={reload} />
        )}
        {!single && <div className="git-bars-gutter" style={{ width: GUTTER_WIDTH }} />}
        {single !== 'L' && (
          <RepoGitBar side="R" repo={right} loading={loading.R} onGitOp={runGitOp} onReload={reload} />
        )}
      </div>

      <div
        className={'diff-body' + (pendingNode ? ' linking' : '')}
        ref={scrollRef}
        onScroll={onScroll}
        onClick={onBodyClick}
        tabIndex={-1}
      >
        <div className="diff-scroll" style={{ minHeight: bodyHeight }}>
          {single !== 'R' && (
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
            colorMap={colorMap.L}
            onRowMenu={openRowMenu}
            plain={!!single}
            onDetail={openDetail}
          />
          )}

          {!single && (
          <div className="gutter" style={{ width: GUTTER_WIDTH, minHeight: bodyHeight }}>
            <ConnectionLines
              links={view.links}
              height={bodyHeight}
              width={GUTTER_WIDTH}
              selectedMatch={selectedMatch}
              onSelect={handleSelect}
            />
          </div>
          )}

          {single !== 'L' && (
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
            colorMap={colorMap.R}
            onRowMenu={openRowMenu}
            plain={!!single}
            onDetail={openDetail}
          />
          )}
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
