/*
 * M2_GIT_DIFF
 * Copyright (c) 2026 OA Hsiao
 * SPDX-License-Identifier: MIT
 *
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */
import React, { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import Toolbar from './components/Toolbar.jsx';
import RepoColumn from './components/RepoColumn.jsx';
import RepoGitBar from './components/RepoGitBar.jsx';
import ConnectionLines from './components/ConnectionLines.jsx';
import SearchPanel from './components/SearchPanel.jsx';
import NotePopup from './components/NotePopup.jsx';
import VtagPopup from './components/VtagPopup.jsx';
import RowMenu from './components/RowMenu.jsx';
import CommitDetail from './components/CommitDetail.jsx';
import DiffComparePopup from './components/DiffComparePopup.jsx';
import VsIcon from './components/VsIcon.jsx';
import GitTerminalPopup from './components/GitTerminalPopup.jsx';
import BranchSwitchPopup from './components/BranchSwitchPopup.jsx';
import ExportPrompt from './components/ExportPrompt.jsx';
import HelpPopup from './components/HelpPopup.jsx';
import SettingsPopup from './components/SettingsPopup.jsx';
import FolderPicker from './components/FolderPicker.jsx';
import logoUrl from './assets/logo.svg';
import { computeDiff, applyFuzzy, matchesQuery, alignLayout, patchSimilarity } from './lib/diff.js';
import { ROW_HEIGHT, GUTTER_WIDTH, PAGE_BATCH } from './lib/constants.js';
import { getCommitLimit, getAutoFillRange } from './lib/settings.js';
import { useT } from './lib/i18n.js';

const emptyRepo = { path: '', name: '', branch: '', head: '', commits: [], hasMore: false };

export default function App() {
  const t = useT();
  const [left, setLeft] = useState(emptyRepo);
  const [right, setRight] = useState(emptyRepo);
  const [query, setQuery] = useState('');
  // `rawQuery` mirrors the search box character-by-character so typing stays
  // responsive, while `query` (which drives the heavy match/highlight/align
  // memos over thousands of rows) is updated on a short debounce so each
  // keystroke doesn't rescan every commit.
  const [rawQuery, setRawQuery] = useState('');
  const [filterOnly, setFilterOnly] = useState(false);
  const [loading, setLoading] = useState({ L: false, R: false });
  const [error, setError] = useState('');
  const [selectedMatch, setSelectedMatch] = useState(null);

  // Per-side "loading older commits" indicator for the lazy pagination /
  // cross-repo backfill. Kept separate from `loading` so paging in more history
  // doesn't grey out the whole git bar. `loadingMoreRef` guards against
  // overlapping requests; `backfillBudget` caps how many commits the AUTOMATIC
  // backfill may add per loaded head (keyed by `path@head`).
  const [backfilling, setBackfilling] = useState({ L: false, R: false });
  const loadingMoreRef = useRef({ L: false, R: false });
  const backfillBudget = useRef(new Map());
  // Flips true once the user clicks "Load more". From then on the automatic
  // on-open balancer steps aside so the manual two-phase control is the single
  // source of truth for how deep each side is paged.
  const pagedRef = useRef(false);
  // Drives the full-stage progress overlay during a manual "Load more". Null when
  // idle, 'align' while pulling the shallower side down to realign, or 'more'
  // while deepening both sides. The align pull can be large (it loads down to the
  // other side's date), so a visible in-progress screen reassures it's working.
  const [paging, setPaging] = useState(null);

  // Side ('L'/'R') whose repo is being chosen in the in-app FolderPicker, or null.
  const [pickerSide, setPickerSide] = useState(null);

  // Floating window showing the git terminal transcript after a Fetch/Pull.
  // { side, op, repoName, ok, command, output, exitCode } | null
  const [gitTerminal, setGitTerminal] = useState(null);

  // Switch-branch modal: { side, repoName, data:{current,local,remote} } | null.
  // `branchBusy` guards the popup while a checkout is in flight.
  const [branchPopup, setBranchPopup] = useState(null);
  const [branchBusy, setBranchBusy] = useState(false);

  // Content-based cherry-pick matching: sha -> git patch-id. Filled lazily for
  // commits that stay `unique` after SHA + title matching.
  const [patchIds, setPatchIds] = useState({});
  const requestedShas = useRef(new Set());

  // Fuzzy (approximate content) matching: opt-in pass that pairs still-unmatched
  // commits by how much their CHANGED LINES overlap. `fuzzyThreshold` is a 0-100
  // percent (default 80%); computeDiff receives it as a 0-1 ratio. `diffTexts`
  // caches each commit's changed-line list (sha -> string[]), fetched lazily
  // from the main process only while fuzzy matching is enabled.
  const [fuzzyEnabled, setFuzzyEnabled] = useState(false);
  const [fuzzyThreshold, setFuzzyThreshold] = useState(80);
  const [diffTexts, setDiffTexts] = useState({});
  const requestedDiffShas = useRef(new Set());

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

  // Per-commit virtual tag: { [`${side}:${sha}`]: text }. A user-defined version
  // label shown inline like a git tag but painted in the manual-link color.
  // Persisted alongside notes/colors (same repo-pair key). `vtagPopup` drives
  // the floating single-line editor: { side, sha, x, y } | null.
  const [vtags, setVtags] = useState({});
  const [vtagPopup, setVtagPopup] = useState(null);
  const vtagsHydratedRef = useRef(null);
  const vtagsSkipSaveRef = useRef(false);

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

  // Side-by-side compare window for the currently selected match (a linked
  // pair). `compare` holds the two commits + an open position; null when closed.
  const [compare, setCompare] = useState(null);

  // Pick-to-compare basket: up to two commits the user Shift+Clicked to compare
  // directly, regardless of whether they are linked. Each entry is { side, sha }.
  // When two are picked a floating Compare button opens the same side-by-side
  // window for that ad-hoc pair (commits may even be from the same side / repo).
  const [comparePick, setComparePick] = useState([]);

  // Virtualization scroll state
  const scrollRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(800);
  const scrollRafRef = useRef(0);

  // Search box ref (Ctrl+F focus) and F3 cycling through matched rows.
  const searchRef = useRef(null);
  const [activeHit, setActiveHit] = useState(null); // row key currently focused
  const hitIdxRef = useRef(-1);
  const noteIdxRef = useRef(-1); // cursor for the note navigator

  // Floating search panel: open/closed + which commit fields to search.
  const [searchOpen, setSearchOpen] = useState(false);
  // Help / keyboard-shortcuts modal.
  const [helpOpen, setHelpOpen] = useState(false);
  // Settings modal (language picker, etc.).
  const [settingsOpen, setSettingsOpen] = useState(false);
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
    // Coalesce high-frequency scroll events into one state update per frame so
    // we don't rerun the virtualized render (and SVG redraw) on every pixel.
    const el = e.currentTarget;
    if (scrollRafRef.current) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = 0;
      // Read the latest position at frame time, not the (possibly stale)
      // value from the event that scheduled this frame.
      setScrollTop(el.scrollTop);
      setViewportHeight(el.clientHeight);
    });
  }, []);

  // Cancel any pending scroll frame on unmount.
  useEffect(() => () => {
    if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
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

  // Debounce the typed query into the value the heavy memos depend on. Clearing
  // (empty string) is applied immediately so closing search / deleting the last
  // character feels instant.
  useEffect(() => {
    if (rawQuery === query) return undefined;
    if (rawQuery === '') {
      setQuery('');
      return undefined;
    }
    const id = setTimeout(() => setQuery(rawQuery), 120);
    return () => clearTimeout(id);
  }, [rawQuery, query]);

  const pick = useCallback((side) => {
    setError('');
    setPickerSide(side);
  }, []);

  // Confirm handler from the in-app FolderPicker modal.
  const onPickFolder = useCallback(
    async (folder) => {
      const side = pickerSide;
      setPickerSide(null);
      if (!folder || !side) return;
      setLoading((s) => ({ ...s, [side]: true }));
      try {
        const repo = await window.api.loadRepo({ repoPath: folder, limit: getCommitLimit() });
        if (side === 'L') setLeft(repo);
        else setRight(repo);
        pagedRef.current = false; // fresh pair -> let the on-open balancer act
      } catch (e) {
        setError(String(e?.message || e));
      } finally {
        setLoading((s) => ({ ...s, [side]: false }));
      }
    },
    [pickerSide]
  );

  // Load a repo straight from a known path (used by CLI auto-open).
  const loadPath = useCallback(async (side, repoPath) => {
    if (!repoPath) return;
    setLoading((s) => ({ ...s, [side]: true }));
    try {
      const repo = await window.api.loadRepo({ repoPath, limit: getCommitLimit() });
      if (side === 'L') setLeft(repo);
      else setRight(repo);
      pagedRef.current = false; // fresh pair -> let the on-open balancer act
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
      const fresh = await window.api.loadRepo({ repoPath: repo.path, limit: getCommitLimit() });
      if (side === 'L') setLeft(fresh);
      else setRight(fresh);
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setLoading((s) => ({ ...s, [side]: false }));
    }
  }, [left, right]);

  // Page in the next batch of older commits for one side and APPEND them to the
  // already-loaded window. Deduped by sha so an overlapping skip can never
  // double-insert. Appending creates a new repo object, which lets the existing
  // diff + patch-id + fuzzy effects re-run and enrich only the newcomers (they
  // dedupe via requestedShas / requestedDiffShas). Returns how many NEW commits
  // were added so the auto-backfill loop can spend its budget accurately.
  const loadMore = useCallback(async (side, count = getAutoFillRange() || PAGE_BATCH, auto = false, since = null) => {
    const repo = side === 'L' ? left : right;
    if (!repo.path || !repo.hasMore) return 0;
    if (loadingMoreRef.current[side]) return 0;
    loadingMoreRef.current[side] = true;
    setBackfilling((s) => ({ ...s, [side]: true }));
    try {
      const res = await window.api.loadMore({
        repoPath: repo.path,
        branch: repo.branch,
        skip: repo.commits.length,
        batch: count,
        since: since || undefined
      });
      const incoming = Array.isArray(res?.commits) ? res.commits : [];
      const have = new Set(repo.commits.map((c) => c.sha));
      const fresh = incoming.filter((c) => !have.has(c.sha));
      const next = {
        ...repo,
        commits: fresh.length ? [...repo.commits, ...fresh] : repo.commits,
        hasMore: !!res?.hasMore
      };
      if (side === 'L') setLeft(next);
      else setRight(next);
      return fresh.length;
    } catch (e) {
      setError(String(e?.message || e));
      return 0;
    } finally {
      loadingMoreRef.current[side] = false;
      setBackfilling((s) => ({ ...s, [side]: false }));
    }
  }, [left, right]);

  // Manual "Load more" button (both git bars call this). Two-phase by design,
  // matching how a person reads the two columns:
  //   1) MISALIGNED -> ALIGN. When the sides stop at different dates, the first
  //      click pages the time-shallower side (its oldest loaded commit is newer)
  //      straight down to the OTHER side's oldest date in one request, so the
  //      matched commits snap back onto the same rows instead of one column
  //      dangling far below the other.
  //   2) ALIGNED -> LOAD MORE. Once both windows reach the same depth, each
  //      further click simply deepens BOTH sides by one batch, so they keep pace
  //      and reveal older history together, regardless of alignment.
  const manualLoadMore = useCallback(async () => {
    pagedRef.current = true; // hand control to the manual button for this pair
    const L = left.commits;
    const R = right.commits;
    const ts = (d) => Date.parse(d) || 0;
    try {
      if (L.length && R.length) {
        const lOld = ts(L[L.length - 1].commitDate);
        const rOld = ts(R[R.length - 1].commitDate);
        // Phase 1: pull the shallower side down to the deeper side's oldest date.
        // If it added nothing (already at that floor), fall through to phase 2.
        if (lOld > rOld && left.hasMore) {
          setPaging('align');
          const n = await loadMore('L', 0, false, R[R.length - 1].commitDate);
          if (n > 0) return;
        } else if (rOld > lOld && right.hasMore) {
          setPaging('align');
          const n = await loadMore('R', 0, false, L[L.length - 1].commitDate);
          if (n > 0) return;
        }
      }

      // Phase 2: aligned (or only one side still has history) -> deepen by a batch.
      setPaging('more');
      await Promise.all([
        left.hasMore ? loadMore('L', PAGE_BATCH, false) : Promise.resolve(0),
        right.hasMore ? loadMore('R', PAGE_BATCH, false) : Promise.resolve(0)
      ]);
    } finally {
      setPaging(null);
    }
  }, [left, right, loadMore]);
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
        const fresh = await window.api.loadRepo({ repoPath: repo.path, limit: getCommitLimit() });
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
      setError(t('app.gitOpFail', { op, msg }));
    } finally {
      setLoading((s) => ({ ...s, [side]: false }));
    }
  }, [left, right, t]);

  // Open the switch-branch modal for one side: load the branch list first so
  // the popup renders the tree immediately.
  const openSwitchBranch = useCallback(async (side) => {
    const repo = side === 'L' ? left : right;
    if (!repo.path) return;
    setError('');
    try {
      const data = await window.api.listBranches({ repoPath: repo.path });
      setBranchPopup({ side, repoName: repo.name || repo.path, data });
    } catch (e) {
      setError(t('app.branchListFail', { msg: String(e?.message || e) }));
    }
  }, [left, right, t]);

  // Perform the checkout chosen in the modal, then surface the git transcript
  // and reload that side's repo so the graph reflects the new branch.
  const doSwitchBranch = useCallback(async (selected) => {
    if (!branchPopup || !selected) return;
    const { side, repoName } = branchPopup;
    const repo = side === 'L' ? left : right;
    if (!repo.path) return;
    setBranchBusy(true);
    try {
      const res = await window.api.switchBranch({
        repoPath: repo.path,
        branch: selected.ref,
        isRemote: !!selected.isRemote
      });
      setBranchPopup(null);
      setGitTerminal({
        side,
        op: t('branchSwitch.opLabel'),
        repoName,
        ok: res?.ok !== false,
        command: res?.command || `git switch ${selected.ref}`,
        output: res?.output || '',
        exitCode: typeof res?.exitCode === 'number' ? res.exitCode : res?.ok === false ? 1 : 0
      });
      if (res?.ok !== false) {
        const fresh = await window.api.loadRepo({ repoPath: repo.path, limit: getCommitLimit() });
        if (side === 'L') setLeft(fresh);
        else setRight(fresh);
      }
    } catch (e) {
      setBranchPopup(null);
      setGitTerminal({
        side,
        op: t('branchSwitch.opLabel'),
        repoName,
        ok: false,
        command: `git switch ${selected.ref}`,
        output: String(e?.message || e),
        exitCode: 1
      });
    } finally {
      setBranchBusy(false);
    }
  }, [branchPopup, left, right, t]);

  // Exact-match pass (common / cherry / patch-id / manual). Memoized on its own
  // so it is NOT recomputed every time a single fuzzy diff-text arrives.
  const baseDiff = useMemo(
    () => computeDiff(left, right, patchIds, manualLinks),
    [left, right, patchIds, manualLinks]
  );

  // Auto-balance: recover matches lost to per-side truncation by keeping the two
  // commit windows at the SAME depth in history.
  //
  // Each side loads its newest commits and is cut off at the commit limit, so
  // the two windows can stop at different dates. A commit that lives in BOTH
  // repos then shows as "unique" only because the shallower side stopped before
  // reaching it, which also pushes every later row out of alignment. We compare
  // the oldest loaded commit on each side and page the time-shallower one deeper
  // until both windows cover the same range, so those matches resurface and the
  // columns line back up. Bounded per head by the auto-fill range (Settings,
  // default 100, 0 = off). Once the user clicks "Load more" the manual two-phase
  // control takes over for the rest of the session.
  useEffect(() => {
    if (!left.path || !right.path) return;
    if (loading.L || loading.R) return;
    if (backfilling.L || backfilling.R) return;
    // Once the user takes manual control of paging, the on-open balancer stands
    // aside so it never fights the manual two-phase "Load more" button.
    if (pagedRef.current) return;

    const range = getAutoFillRange();
    if (range <= 0) return; // auto-fill disabled in Settings

    const L = left.commits;
    const R = right.commits;
    if (!L.length || !R.length) return;

    // Nothing to recover once every loaded commit already pairs up.
    const hasUnmatched =
      baseDiff.leftRows.some((r) => r.status === 'unique') ||
      baseDiff.rightRows.some((r) => r.status === 'unique');
    if (!hasUnmatched) return;

    // Commits are newest-first, so the LAST row is the oldest one loaded. The
    // side whose oldest commit is NEWER stopped earlier in history; pull it
    // deeper so it catches up to the other side's depth and the matches that
    // sit between the two boundaries can pair up.
    const ts = (d) => Date.parse(d) || 0;
    const lOldest = ts(L[L.length - 1].commitDate);
    const rOldest = ts(R[R.length - 1].commitDate);

    let side = null;
    if (lOldest > rOldest && left.hasMore) side = 'L';
    else if (rOldest > lOldest && right.hasMore) side = 'R';
    if (!side) return;

    // Bound the AUTOMATIC catch-up per head so a lopsided pair can't drag the
    // whole history in. Manual paging bypasses this effect entirely (pagedRef).
    const repo = side === 'L' ? left : right;
    const key = repo.path + '@' + repo.head;
    const spent = backfillBudget.current.get(key) || 0;
    const remaining = range - spent;
    if (remaining <= 0) return;
    const grab = Math.min(PAGE_BATCH, remaining);
    backfillBudget.current.set(key, spent + grab);
    loadMore(side, grab, true);
  }, [baseDiff, left, right, loading, backfilling, loadMore]);

  // Fuzzy pass layered on top of the cached exact result. The fuzzy matching is
  // the heaviest part of the pipeline (line-set overlap over many commits), so
  // we run it off the critical path inside requestIdleCallback instead of
  // synchronously during render. While a result for the current inputs isn't
  // ready yet we fall back to the exact-only `baseDiff` and surface a "比對中…"
  // indicator. `fuzzyResult` caches the computed output keyed by its inputs.
  const [fuzzyResult, setFuzzyResult] = useState(null);

  useEffect(() => {
    if (!fuzzyEnabled) {
      setFuzzyResult(null);
      return undefined;
    }
    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      const out = applyFuzzy(baseDiff, {
        enabled: true,
        threshold: fuzzyThreshold / 100,
        diffTexts
      });
      if (cancelled) return;
      setFuzzyResult({ base: baseDiff, threshold: fuzzyThreshold, diffTexts, diff: out });
    };
    const ric =
      window.requestIdleCallback || ((fn) => window.setTimeout(() => fn(), 1));
    const cic = window.cancelIdleCallback || window.clearTimeout;
    const handle = ric(run, { timeout: 300 });
    return () => {
      cancelled = true;
      cic(handle);
    };
  }, [fuzzyEnabled, baseDiff, fuzzyThreshold, diffTexts]);

  // True only when the cached fuzzy result was computed for exactly the current
  // inputs; otherwise the idle pass is still pending (or stale).
  const fuzzyReady =
    !!fuzzyResult &&
    fuzzyResult.base === baseDiff &&
    fuzzyResult.threshold === fuzzyThreshold &&
    fuzzyResult.diffTexts === diffTexts;

  // Final classified diff. References an already-built object (baseDiff or the
  // cached fuzzy output), so downstream memos keyed on `diff` stay stable.
  const diff = fuzzyEnabled && fuzzyReady ? fuzzyResult.diff : baseDiff;
  const fuzzyPending = fuzzyEnabled && !fuzzyReady;

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
        localStorage.setItem('vtag:' + newKey, JSON.stringify(swapPrefix(vtags)));
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
    setVtagPopup(null);

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
    setVtags((v) => flipPrefix(v));
  }, [left, right, manualLinks, notes, colors, vtags]);

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

  // ---- Per-commit virtual tags: persistence (same repo-pair key) ----
  useEffect(() => {
    if (!linkKey) return;
    let parsed = {};
    try {
      const raw = localStorage.getItem('vtag:' + linkKey);
      if (raw) parsed = JSON.parse(raw);
    } catch {
      parsed = {};
    }
    vtagsSkipSaveRef.current = true;
    vtagsHydratedRef.current = linkKey;
    setVtags(parsed && typeof parsed === 'object' ? parsed : {});
    setVtagPopup(null);
  }, [linkKey]);

  useEffect(() => {
    if (!linkKey || vtagsHydratedRef.current !== linkKey) return;
    if (vtagsSkipSaveRef.current) {
      vtagsSkipSaveRef.current = false;
      return;
    }
    try {
      localStorage.setItem('vtag:' + linkKey, JSON.stringify(vtags));
    } catch {
      /* storage unavailable -> virtual tags live for this session only */
    }
  }, [vtags, linkKey]);

  const vtagIdOf = (side, sha) => `${side}:${sha}`;

  // Open the floating single-line virtual-tag editor at the click position.
  const openVtag = useCallback((side, sha, x, y) => {
    setVtagPopup({ side, sha, x, y });
  }, []);

  // Save (or clear when empty) the virtual tag for one commit.
  const saveVtag = useCallback((side, sha, text) => {
    const id = `${side}:${sha}`;
    setVtags((prev) => {
      const next = { ...prev };
      const trimmed = (text || '').trim();
      if (trimmed) next[id] = trimmed;
      else delete next[id];
      return next;
    });
  }, []);

  // Delete the virtual tag for one commit and close the popup.
  const deleteVtag = useCallback((side, sha) => {
    const id = `${side}:${sha}`;
    setVtags((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setVtagPopup(null);
  }, []);

  // Per-side maps of SHA -> virtual tag text (for the inline tag badge).
  const vtagMap = useMemo(() => {
    const L = {};
    const R = {};
    Object.keys(vtags).forEach((id) => {
      const sep = id.indexOf(':');
      const side = id.slice(0, sep);
      const sha = id.slice(sep + 1);
      (side === 'L' ? L : R)[sha] = vtags[id];
    });
    return { L, R };
  }, [vtags]);

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
        if (cancelled) return;
        // Mark as requested only after a non-cancelled completion, so a fetch
        // interrupted by a repo switch can retry when that repo returns instead
        // of leaving a permanent gap. On a hit/miss for the live repo we record
        // it so the same sha is never refetched.
        [...lNeed, ...rNeed].forEach((s) => requestedShas.current.add(s));
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

  // Fuzzy pass data: while Fuzzy Match is enabled, fetch the changed-line
  // content of every still-`unique` commit so computeDiff can score how much two
  // commits' edits overlap. Best-effort and cached per sha via
  // `requestedDiffShas`, so toggling fuzzy on/off never refetches.
  useEffect(() => {
    if (!fuzzyEnabled || !left.path || !right.path) return;

    const pending = (rows, side) =>
      rows
        .filter(
          (r) =>
            r.status === 'unique' &&
            !requestedDiffShas.current.has(side + ':' + r.sha)
        )
        .map((r) => r.sha);

    const lNeed = pending(diff.leftRows, 'L');
    const rNeed = pending(diff.rightRows, 'R');
    if (lNeed.length === 0 && rNeed.length === 0) return;

    let cancelled = false;
    (async () => {
      try {
        const [lMap, rMap] = await Promise.all([
          lNeed.length
            ? window.api.getDiffTexts({ repoPath: left.path, shas: lNeed })
            : {},
          rNeed.length
            ? window.api.getDiffTexts({ repoPath: right.path, shas: rNeed })
            : {}
        ]);
        if (cancelled) return;
        // Record only after a non-cancelled completion so an interrupted fetch
        // (repo switched away and back) can retry rather than silently skip.
        lNeed.forEach((s) => requestedDiffShas.current.add('L:' + s));
        rNeed.forEach((s) => requestedDiffShas.current.add('R:' + s));
        const merged = { ...lMap, ...rMap };
        if (Object.keys(merged).length) {
          setDiffTexts((prev) => ({ ...prev, ...merged }));
        }
      } catch {
        /* best-effort: fuzzy matching simply finds nothing */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fuzzyEnabled, diff, left.path, right.path]);

  const filterActive = filterOnly && !!query;

  // Build per-side display rows. Matched pairs (common + cherry-pick) are
  // aligned on the same display row so their connecting line is horizontal
  // ("左右對齊"). When the "filter to matches only" toggle is active,
  // non-matching rows are removed before the alignment pass.
  //
  // The structural alignment (the LIS-based `alignLayout`) is split from the
  // per-row search highlighting. When the "filter to matches" toggle is OFF the
  // layout does not depend on the query at all — only the `isHit` flags do — so
  // we gate the query out of this memo's deps via `layoutQuery`. Typing in the
  // search box then reuses the cached alignment instead of recomputing it.
  const layoutQuery = filterActive ? query : '';
  const layout = useMemo(() => {
    const prep = (rows) =>
      rows
        .map((c) => ({ commit: c, isHit: false }))
        .filter((r) => !(filterActive && !matchesQuery(r.commit, layoutQuery, scopes)));

    // Single-repo mode: stack the chosen repo's commits sequentially, no
    // alignment gaps, no cross-links.
    if (single) {
      const rows = prep(single === 'L' ? diff.leftRows : diff.rightRows).map((r, i) => ({
        commit: r.commit,
        displayIndex: i,
        isHit: false
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
  }, [diff, single, filterActive, layoutQuery, scopes]);

  // Cheap overlay: stamp the per-row `isHit` flag for the current query without
  // rebuilding the (potentially large) alignment above.
  const view = useMemo(() => {
    if (!query) return layout;
    const annotate = (side) =>
      side.rows.length
        ? {
            ...side,
            rows: side.rows.map((r) => ({
              ...r,
              isHit: matchesQuery(r.commit, query, scopes)
            }))
          }
        : side;
    return { ...layout, L: annotate(layout.L), R: annotate(layout.R) };
  }, [layout, query, scopes]);

  // The two commits behind the currently selected match (a linked pair), plus
  // the display row to anchor the floating "Compare" pill on. Null when no
  // match is selected or it doesn't resolve to a visible left+right pair (e.g.
  // an off-screen / filtered row). Drives the side-by-side compare entry point.
  const comparePair = useMemo(() => {
    if (!selectedMatch || single) return null;
    const l = diff.leftRows.find((r) => r.matchId === selectedMatch);
    const r = diff.rightRows.find((r) => r.matchId === selectedMatch);
    if (!l || !r) return null;
    const link = view.links.find((k) => k.id === selectedMatch);
    if (!link) return null;
    const midRow = (link.leftIndex + link.rightIndex) / 2;
    const y = midRow * ROW_HEIGHT + ROW_HEIGHT / 2;
    // Pre-computed similarity preview for the pill ("預先比較相似度%"). Use the
    // fuzzy link's own score when present, else derive it from any cached
    // changed-line texts; null when nothing is available yet (the popup still
    // computes the authoritative score on open).
    let previewSim = null;
    if (link.type === 'fuzzy' && typeof link.score === 'number') {
      previewSim = link.score;
    } else if (link.type === 'common') {
      previewSim = 1; // identical SHA -> identical content
    } else {
      const la = diffTexts[l.sha];
      const ra = diffTexts[r.sha];
      if (la && ra) previewSim = patchSimilarity(new Set(la), new Set(ra));
    }
    return { left: l, right: r, y, previewSim };
  }, [selectedMatch, single, diff, view, diffTexts]);

  // Open the side-by-side compare window for the selected pair.
  const openCompare = useCallback(() => {
    if (!comparePair) return;
    setCompare({
      left: { repoPath: left.path, repoName: left.name, commit: comparePair.left },
      right: { repoPath: right.path, repoName: right.name, commit: comparePair.right }
    });
  }, [comparePair, left.path, left.name, right.path, right.name]);

  // Pick-to-compare basket. Shift+Click toggles a commit in/out; we keep at most
  // two (drop the oldest when a third is picked). `pickedShas` / `pickOrder` let
  // each row light up and show its 1/2 badge in O(1).
  const onPick = useCallback((side, sha) => {
    setComparePick((prev) => {
      const i = prev.findIndex((p) => p.side === side && p.sha === sha);
      if (i !== -1) return prev.filter((_, j) => j !== i); // toggle off
      return [...prev, { side, sha }].slice(-2); // keep the two most recent
    });
  }, []);
  const clearPick = useCallback(() => setComparePick([]), []);
  const pickedShas = useMemo(
    () => new Set(comparePick.map((p) => p.side + ':' + p.sha)),
    [comparePick]
  );
  const pickOrder = useMemo(() => {
    const m = new Map();
    comparePick.forEach((p, i) => m.set(p.side + ':' + p.sha, i + 1));
    return m;
  }, [comparePick]);

  // Resolve each picked { side, sha } to its commit row + that side's repo, so
  // the basket can label them and the compare window can fetch their diffs.
  const pickedCommits = useMemo(
    () =>
      comparePick.map((p) => {
        const rows = p.side === 'L' ? diff.leftRows : diff.rightRows;
        const commit = rows.find((r) => r.sha === p.sha) || null;
        const repo = p.side === 'L' ? left : right;
        return { side: p.side, commit, repoPath: repo.path, repoName: repo.name };
      }),
    [comparePick, diff, left, right]
  );

  // Open the side-by-side window for the two manually picked commits. The first
  // pick becomes the left column, the second the right.
  const openManualCompare = useCallback(() => {
    if (pickedCommits.length !== 2) return;
    const [a, b] = pickedCommits;
    if (!a.commit || !b.commit) return;
    setCompare({
      left: { repoPath: a.repoPath, repoName: a.repoName, commit: a.commit },
      right: { repoPath: b.repoPath, repoName: b.repoName, commit: b.commit }
    });
  }, [pickedCommits]);
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
      note: notes[noteIdOf(side, commit.sha)] || null,
      vtag: vtags[vtagIdOf(side, commit.sha)] || null,
      tags: Array.isArray(commit.tags) ? commit.tags : []
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
          leftSha: lc?.sha || '',
          leftSubject: lc?.subject || '',
          rightShort: rc?.short || '',
          rightSha: rc?.sha || '',
          rightSubject: rc?.subject || ''
        };
      });

    return { rows, manualLinks };
  }, [view, colors, notes, vtags, diff]);

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
          leftRemoteUrl: left.remoteUrl || '',
          rightRemoteUrl: right.remoteUrl || '',
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

  // Empty / loading placeholder state for the diff stage. Only shown when there
  // are no rows to display, so a reload of an already-populated view doesn't
  // flash an overlay over existing content.
  const noRepos = !left.path && !right.path;
  const loadingEmpty = (loading.L || loading.R) && view.totalRows === 0;
  const stageEmpty =
    !noRepos && !loading.L && !loading.R && view.totalRows === 0;

  // Keyboard row navigation: a flat, display-ordered list of every visible
  // commit row (both sides, left before right on shared rows). ArrowUp/Down
  // walk this list, reusing `activeHit` as the cursor so the highlight, the
  // search navigator, and the note navigator all share one focused row.
  const navRows = useMemo(() => {
    const collect = (rows, side) =>
      rows
        .filter((r) => r.commit && r.displayIndex != null)
        .map((r) => ({
          side,
          sha: r.commit.sha,
          displayIndex: r.displayIndex,
          key: r.commit.sha + ':' + r.commit.index
        }));
    return [...collect(view.L.rows, 'L'), ...collect(view.R.rows, 'R')].sort(
      (a, b) => a.displayIndex - b.displayIndex || (a.side < b.side ? -1 : 1)
    );
  }, [view]);

  // Move the focused row up (dir -1) or down (dir +1) WITHIN the current side
  // and scroll it into view. Up/down stays in the same column; switching
  // columns is done with Left/Right (moveCursorSide).
  const moveCursor = useCallback(
    (dir) => {
      if (navRows.length === 0) return;
      const cur = navRows.find((r) => r.key === activeHit);
      // No cursor yet: land on the first/last row overall.
      if (!cur) {
        const row = dir > 0 ? navRows[0] : navRows[navRows.length - 1];
        setActiveHit(row.key);
        const el = scrollRef.current;
        if (el) {
          const target =
            row.displayIndex * ROW_HEIGHT - el.clientHeight / 2 + ROW_HEIGHT / 2;
          el.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
        }
        return;
      }
      const sideRows = navRows.filter((r) => r.side === cur.side);
      const idx = sideRows.findIndex((r) => r.key === cur.key);
      // Clamp at the ends: at the top, Up stays at top; at the bottom, Down
      // stays at the bottom. No wrap-around.
      const next = Math.max(0, Math.min(idx + dir, sideRows.length - 1));
      if (next === idx) return;
      const row = sideRows[next];
      setActiveHit(row.key);
      const el = scrollRef.current;
      if (el) {
        const target =
          row.displayIndex * ROW_HEIGHT - el.clientHeight / 2 + ROW_HEIGHT / 2;
        el.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
      }
    },
    [navRows, activeHit]
  );

  // True only when the cursor sits on the LAST row of its column, i.e. there is
  // nowhere further down to go. Used to reveal the floating "back to top" button.
  const atListBottom = useMemo(() => {
    if (!activeHit || navRows.length === 0) return false;
    const cur = navRows.find((r) => r.key === activeHit);
    if (!cur) return false;
    const sideRows = navRows.filter((r) => r.side === cur.side);
    return sideRows.length > 0 && sideRows[sideRows.length - 1].key === cur.key;
  }, [navRows, activeHit]);

  // Jump straight back to the very top of the current column and scroll there.
  const jumpToTop = useCallback(() => {
    if (navRows.length === 0) return;
    const cur = navRows.find((r) => r.key === activeHit);
    const side = cur ? cur.side : navRows[0].side;
    const sideRows = navRows.filter((r) => r.side === side);
    const first = sideRows[0] || navRows[0];
    setActiveHit(first.key);
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: 0, behavior: 'smooth' });
  }, [navRows, activeHit]);

  // Move the focused row to the OTHER side (ArrowLeft -> 'L', ArrowRight ->
  // 'R'), staying on the row whose displayIndex is closest to the current one.
  // Makes side-to-side navigation as intuitive as walking up/down.
  const moveCursorSide = useCallback(
    (targetSide) => {
      const sideRows = navRows.filter((r) => r.side === targetSide);
      if (sideRows.length === 0) return;
      const cur = navRows.find((r) => r.key === activeHit);
      // No current cursor (or already on the target side with none focused):
      // jump to the first row of that side.
      const anchor = cur ? cur.displayIndex : 0;
      let best = sideRows[0];
      let bestDist = Math.abs(best.displayIndex - anchor);
      for (const r of sideRows) {
        const d = Math.abs(r.displayIndex - anchor);
        if (d < bestDist) {
          best = r;
          bestDist = d;
        }
      }
      if (cur && cur.side === targetSide && best.key === cur.key) return;
      setActiveHit(best.key);
      const el = scrollRef.current;
      if (el) {
        const target =
          best.displayIndex * ROW_HEIGHT - el.clientHeight / 2 + ROW_HEIGHT / 2;
        el.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
      }
    },
    [navRows, activeHit]
  );

  // Enter opens the commit-detail popup for the currently focused row.
  const openCursorDetail = useCallback(() => {
    const row = navRows.find((r) => r.key === activeHit);
    if (!row) return;
    const rect = scrollRef.current?.getBoundingClientRect();
    const x = (rect ? rect.left : 80) + (row.side === 'L' ? 90 : 420);
    const y = (rect ? rect.top : 80) + 110;
    openDetail(row.side, row.sha, x, y);
  }, [navRows, activeHit, openDetail]);

  // Select a match and move keyboard focus to the diff body so Esc / blank
  // clicks can clear it. Passing null clears the selection. When a row click
  // supplies `rowKey`, sync the keyboard cursor (activeHit) to that row so
  // Arrow Up/Down continue from the clicked item instead of an old position.
  const handleSelect = useCallback((id, rowKey) => {
    setSelectedMatch(id);
    if (rowKey) setActiveHit(rowKey);
    if (rowKey || id != null) scrollRef.current?.focus();
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
    setRawQuery('');
    setQuery('');
    scrollRef.current?.focus();
  }, []);

  // Esc clears the current selection / pending manual link. Delete removes the
  // selected manual link. Ctrl+F opens search, Alt+F opens a repo, F3 cycles.
  useEffect(() => {
    const onKey = (e) => {
      // While the folder picker modal is open it owns all keyboard input
      // (arrows, Enter, typing-to-filter, Esc) — don't let the global handler
      // also move the commit cursor or reopen search underneath it.
      if (pickerSide) return;
      // The side-by-side compare window is a self-contained surface with its
      // own hotkeys (Ctrl+F, F3, Enter, Esc). While it's open — or whenever a
      // key originates from inside it — the app's global shortcuts stay out of
      // the way so the two never interfere.
      if (compare || e.target?.closest?.('.diff-compare')) return;
      // Don't hijack typing in the search box (or any input / editable field).
      const tag = e.target?.tagName;
      const typing =
        tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable;
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
      // ArrowUp/ArrowDown -> walk the focused commit row up/down; ArrowLeft/
      // ArrowRight -> jump to the nearest row on the other side; Enter opens
      // the detail popup for it. Skipped while typing in a field.
      if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          moveCursor(1);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          moveCursor(-1);
          return;
        }
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          moveCursorSide('L');
          return;
        }
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          moveCursorSide('R');
          return;
        }
        if (e.key === 'Enter' && activeHit) {
          e.preventDefault();
          openCursorDetail();
          return;
        }
      }
      if (e.key === 'Escape') {
        if (searchOpen) {
          closeSearch();
        }
        setHelpOpen(false);
        setSelectedMatch(null);
        setPendingNode(null);
        setComparePick([]);
        setNotePopup(null);
        setRowMenu(null);
        setDetails([]);
        setActiveHit(null);
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
  }, [
    selectedMatch,
    cycleHit,
    openSearch,
    searchOpen,
    closeSearch,
    pick,
    left.path,
    loading.L,
    loading.R,
    moveCursor,
    moveCursorSide,
    openCursorDetail,
    activeHit,
    pickerSide,
    compare
  ]);

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
        fuzzyEnabled={fuzzyEnabled}
        fuzzyThreshold={fuzzyThreshold}
        onToggleFuzzy={() => setFuzzyEnabled((v) => !v)}
        onSetFuzzyThreshold={setFuzzyThreshold}
        onExport={openExportPrompt}
        canExport={canExport}
        onOpenHelp={() => setHelpOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      {searchOpen && (
        <SearchPanel
          query={rawQuery}
          onQuery={setRawQuery}
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
            hasVtag={!!vtags[vtagIdOf(rowMenu.side, rowMenu.sha)]}
            color={colors[noteIdOf(rowMenu.side, rowMenu.sha)] || null}
            customColor={customSwatch}
            onAddNote={openNote}
            onAddVtag={openVtag}
            onSetColor={setColor}
            onPickCustom={pickCustomColor}
            onClearColor={clearColor}
            onClose={() => setRowMenu(null)}
          />
        );
      })()}

      {vtagPopup && (() => {
        const arr = vtagPopup.side === 'L' ? left.commits : right.commits;
        const c = arr.find((x) => x.sha === vtagPopup.sha);
        return (
          <VtagPopup
            key={vtagPopup.side + ':' + vtagPopup.sha}
            side={vtagPopup.side}
            sha={vtagPopup.sha}
            short={c?.short || vtagPopup.sha.slice(0, 7)}
            subject={c?.subject || ''}
            x={vtagPopup.x}
            y={vtagPopup.y}
            value={vtags[vtagIdOf(vtagPopup.side, vtagPopup.sha)] || ''}
            onSave={saveVtag}
            onDelete={deleteVtag}
            onClose={() => setVtagPopup(null)}
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
            remoteUrl={d.side === 'L' ? left.remoteUrl : right.remoteUrl}
            x={d.x}
            y={d.y}
            searchTerm={query}
            onClose={() => closeDetail(d.side, d.sha)}
            onOpenRelated={(side, sha) => openDetail(side, sha, d.x + 40, d.y + 40)}
          />
        );
      })}

      {error && <div className="error-bar" role="alert" aria-live="assertive">⚠ {error}</div>}

      {comparePick.length > 0 && (
        <div className="compare-basket" role="region" aria-label={t('compare.basketAria')}>
          <span className="cb-title">{t('compare.basketTitle')}</span>
          <div className="cb-items">
            {pickedCommits.map((p, i) => (
              <span key={i} className={'cb-chip ' + p.side}>
                <span className="cb-chip-n">{i + 1}</span>
                <span className="cb-chip-side">{p.side}</span>
                <span className="cb-chip-sha">{p.commit ? p.commit.short : '—'}</span>
                {p.commit && (
                  <span className="cb-chip-subject" title={p.commit.subject}>
                    {p.commit.subject}
                  </span>
                )}
                <button
                  type="button"
                  className="cb-chip-x"
                  title={t('compare.pickRemove')}
                  aria-label={t('compare.pickRemove')}
                  onClick={() => onPick(comparePick[i].side, comparePick[i].sha)}
                >
                  ✕
                </button>
              </span>
            ))}
            {comparePick.length < 2 && <span className="cb-hint">{t('compare.pickHint')}</span>}
          </div>
          <button
            type="button"
            className="cb-go"
            disabled={comparePick.length !== 2}
            onClick={openManualCompare}
            title={t('compare.goTitle')}
          >
            <VsIcon className="cb-go-ico" />
            <span>{t('compare.go')}</span>
          </button>
          <button
            type="button"
            className="cb-clear"
            title={t('compare.clear')}
            aria-label={t('compare.clear')}
            onClick={clearPick}
          >
            ✕
          </button>
        </div>
      )}

      {compare && (
        <DiffComparePopup
          left={compare.left}
          right={compare.right}
          x={120}
          y={70}
          initialFind={query}
          onClose={() => setCompare(null)}
        />
      )}

      {gitTerminal && (
        <GitTerminalPopup
          info={gitTerminal}
          onClose={() => setGitTerminal(null)}
        />
      )}

      {branchPopup && (
        <BranchSwitchPopup
          side={branchPopup.side}
          repoName={branchPopup.repoName}
          data={branchPopup.data}
          busy={branchBusy}
          onSwitch={doSwitchBranch}
          onClose={() => !branchBusy && setBranchPopup(null)}
        />
      )}

      {exportPrompt && (
        <ExportPrompt
          total={exportPrompt.total}
          onExport={runExport}
          onCancel={() => setExportPrompt(null)}
        />
      )}

      {helpOpen && <HelpPopup onClose={() => setHelpOpen(false)} />}

      {settingsOpen && <SettingsPopup onClose={() => setSettingsOpen(false)} />}

      {pickerSide && (
        <FolderPicker onPick={onPickFolder} onClose={() => setPickerSide(null)} />
      )}

      <div className="git-bars">
        {single !== 'R' && (
          <RepoGitBar side="L" repo={left} loading={loading.L} backfilling={backfilling.L} onGitOp={runGitOp} onReload={reload} onLoadMore={manualLoadMore} onSwitchBranch={openSwitchBranch} />
        )}
        {!single && <div className="git-bars-gutter" style={{ width: GUTTER_WIDTH }} />}
        {single !== 'L' && (
          <RepoGitBar side="R" repo={right} loading={loading.R} backfilling={backfilling.R} onGitOp={runGitOp} onReload={reload} onLoadMore={manualLoadMore} onSwitchBranch={openSwitchBranch} />
        )}
      </div>

      <div className="stage-wrap">
      {paging && (
        <div className="paging-overlay" role="status" aria-live="polite">
          <div className="paging-card">
            <div className="stage-spinner" />
            <div className="paging-title">
              {paging === 'align' ? t('app.aligningTitle') : t('app.pagingMoreTitle')}
            </div>
            <div className="paging-sub">
              {paging === 'align' ? t('app.aligningSub') : t('app.pagingMoreSub')}
            </div>
          </div>
        </div>
      )}
      <div
        className={'diff-body' + (pendingNode ? ' linking' : '')}
        ref={scrollRef}
        onScroll={onScroll}
        onClick={onBodyClick}
        tabIndex={-1}
      >
        {fuzzyPending && !loadingEmpty && !noRepos && (
          <div className="fuzzy-pending" role="status" aria-live="polite">
            <span className="fuzzy-pending-dot" />
            {t('app.fuzzyPending')}
          </div>
        )}
        {(noRepos || loadingEmpty || stageEmpty) && (
          <div className="stage-empty">
            {loadingEmpty ? (
              <>
                <div className="stage-spinner" />
                <div className="stage-empty-title" role="status" aria-live="polite">{t('app.loadingTitle')}</div>
                <div className="stage-empty-sub">
                  {t('app.loadingSub', {
                    sides: loading.L && loading.R ? t('app.loadingSubBoth') : loading.L ? t('app.loadingSubLeft') : t('app.loadingSubRight'),
                    limit: getCommitLimit().toLocaleString()
                  })}
                </div>
              </>
            ) : noRepos ? (
              <>
                <img className="stage-empty-logo" src={logoUrl} alt="M2_GIT_DIFF" draggable="false" />
                <div className="stage-empty-title">{t('app.noRepoTitle')}</div>
                <div className="stage-empty-sub">
                  {t('app.noRepoSub')}
                </div>
                <div className="stage-empty-shortcut">
                  <kbd>Alt</kbd>
                  <span className="sek-plus">+</span>
                  <kbd>F</kbd>
                  <span className="sek-label">{t('app.openRepoHint')}</span>
                </div>
                <a
                  className="stage-empty-badge"
                  href="https://github.com/oahsiao"
                  onClick={(e) => { e.preventDefault(); window.api?.openExternal?.('https://github.com/oahsiao'); }}
                  title={t('app.githubTitle')}
                >
                  <span className="seb-spark">✦</span>
                  <span className="seb-text">Powered by <b>OA Hsiao</b></span>
                  <span className="seb-gh">↗</span>
                </a>
              </>
            ) : (
              <>
                <div className="stage-empty-icon">∅</div>
                <div className="stage-empty-title">
                  {filterActive ? t('app.noMatchTitle') : t('app.noCommitTitle')}
                </div>
                <div className="stage-empty-sub">
                  {filterActive
                    ? t('app.noMatchSub')
                    : t('app.noCommitSub')}
                </div>
              </>
            )}
          </div>
        )}
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
            vtagMap={vtagMap.L}
            onRowMenu={openRowMenu}
            plain={!!single}
            onDetail={openDetail}
            onPick={onPick}
            pickedShas={pickedShas}
            pickOrder={pickOrder}
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
              scrollTop={scrollTop}
              viewportHeight={viewportHeight}
            />
            {comparePair && (
              <button
                type="button"
                className="compare-pill"
                style={{ top: comparePair.y }}
                onClick={(e) => { e.stopPropagation(); openCompare(); }}
                title={t('compare.pillTitle')}
                aria-label={t('compare.pillAria')}
              >
                <span className="compare-pill-ico"><VsIcon /></span>
                {comparePair.previewSim != null && (
                  <span className="compare-pill-sim">
                    {Math.round(comparePair.previewSim * 100)}%
                  </span>
                )}
              </button>
            )}
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
            vtagMap={vtagMap.R}
            onRowMenu={openRowMenu}
            plain={!!single}
            onDetail={openDetail}
            onPick={onPick}
            pickedShas={pickedShas}
            pickOrder={pickOrder}
          />
          )}
        </div>
      </div>
      {atListBottom && (
        <button
          type="button"
          className="scroll-top-fab"
          onClick={jumpToTop}
          title={t('app.backToTop')}
          aria-label={t('app.backToTop')}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 19V6M6 12l6-6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
      </div>

      <div className="legend">
        <span className="chip common">{t('app.legendCommon')}</span>
        <span className="chip cherry">{t('app.legendCherry')}</span>
        <span className="chip unique">{t('app.legendUnique')}</span>
        <span className="chip manual">{t('app.legendManual')}</span>
        <span className="chip fuzzy">{t('app.legendFuzzy')}</span>
        <span className="spacer" />
        <span className="hint">
          {pendingNode
            ? t('app.hintLinking')
            : t('app.hintDefault')}
        </span>
        <a
          className="legend-credit"
          href="https://github.com/oahsiao"
          onClick={(e) => { e.preventDefault(); window.api?.openExternal?.('https://github.com/oahsiao'); }}
          title={t('app.githubTitle')}
        >
          Powered by <b>OA Hsiao</b>
          <span className="lc-gh">↗</span>
        </a>
      </div>
    </div>
  );
}
