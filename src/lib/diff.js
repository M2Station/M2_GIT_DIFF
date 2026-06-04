/*
 * M2_GIT_DIFF
 * Copyright (c) 2026 OA Hsiao
 * SPDX-License-Identifier: MIT
 *
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */
// Core diff logic: classify commits and build connection links between the
// two repros.
//
//   common  -> same SHA on both sides            (gray)
//   cherry  -> same title, different SHA          (yellow, linked)
//   unique  -> exists on only one side            (red)
//
// Cherry-picks are detected in two passes: first by normalized title, then
// (for the leftovers) by `git patch-id` so a cherry-pick whose title was
// edited still pairs up via its actual change content.

export function normalizeSubject(s = '') {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

// --- Fuzzy (approximate content) matching helpers -------------------------
// Fuzzy matching compares the ACTUAL changed lines of two commits (the edits
// inside the files, not the commit message). The diff text is supplied by the
// main process as a deduped array of normalized "+line" / "-line" strings.
//
// We score with a containment ratio rather than a symmetric one:
//
//     score = |A \u2229 B| / min(|A|, |B|)
//
// so a commit whose edits are a SUBSET of another's still scores ~1.0. That is
// exactly the target case: TOT bundles edits for two projects, while a personal
// branch only touches one \u2014 the shared project's lines are fully contained, so
// the pair links even though TOT changed more.
const FUZZY_MIN_LINES = 3; // ignore tiny diffs to avoid spurious matches

// Per-document cache of sha -> changed-line Set. Keyed on the diffTexts
// container itself (object/Map identity), so dragging the fuzzy threshold —
// which reruns applyFuzzy with the SAME diffTexts — reuses every Set instead of
// rebuilding them. A new fetch replaces diffTexts with a fresh object, which
// naturally gets a fresh cache entry (old one is GC'd via the WeakMap).
const lineSetCache = new WeakMap();

function diffLineSet(diffTexts, sha) {
  if (!diffTexts) return null;
  let perDoc = lineSetCache.get(diffTexts);
  if (!perDoc) {
    perDoc = new Map();
    lineSetCache.set(diffTexts, perDoc);
  }
  if (perDoc.has(sha)) return perDoc.get(sha);
  const arr = typeof diffTexts.get === 'function' ? diffTexts.get(sha) : diffTexts[sha];
  const set = !arr || !arr.length ? null : new Set(arr);
  perDoc.set(sha, set);
  return set;
}

function containment(aSet, bSet) {
  const small = aSet.size <= bSet.size ? aSet : bSet;
  const big = small === aSet ? bSet : aSet;
  if (small.size === 0) return 0;
  let inter = 0;
  for (const v of small) if (big.has(v)) inter++;
  return inter / small.size;
}

// Read a patch-id for a sha from either a Map or a plain object (the latter
// is what survives Electron IPC serialization).
function patchIdOf(patchIds, sha) {
  if (!patchIds) return undefined;
  return typeof patchIds.get === 'function' ? patchIds.get(sha) : patchIds[sha];
}

export function computeDiff(left, right, patchIds = null, manualLinks = null, fuzzy = null) {
  const L = left?.commits ?? [];
  const R = right?.commits ?? [];

  const Lshas = new Set(L.map((c) => c.sha));
  const Rshas = new Set(R.map((c) => c.sha));

  const leftRows = L.map((c, i) => ({
    ...c,
    side: 'L',
    index: i,
    status: 'unique',
    matchId: null
  }));
  const rightRows = R.map((c, i) => ({
    ...c,
    side: 'R',
    index: i,
    status: 'unique',
    matchId: null
  }));

  // 1) common commits (identical SHA on both sides) -> gray
  const RindexBySha = new Map(R.map((c, i) => [c.sha, i]));
  const links = [];
  for (const row of leftRows) {
    if (Rshas.has(row.sha)) {
      row.status = 'common';
      row.matchId = 'sha:' + row.sha;
      const ri = RindexBySha.get(row.sha);
      rightRows[ri].status = 'common';
      rightRows[ri].matchId = 'sha:' + row.sha;
      links.push({ type: 'common', leftIndex: row.index, rightIndex: ri, id: 'sha:' + row.sha });
    }
  }

  // 2) cherry-pick detection: same normalized subject, different SHA.
  //    Pool only the commits that are NOT already matched by SHA, grouped by
  //    subject so duplicates pair up in order.
  const groupBySubject = (rows, otherShas) => {
    const m = new Map();
    rows.forEach((row) => {
      if (otherShas.has(row.sha)) return; // already common
      const k = normalizeSubject(row.subject);
      if (!k) return;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(row.index);
    });
    return m;
  };

  const Lsubj = groupBySubject(leftRows, Rshas);
  const Rsubj = groupBySubject(rightRows, Lshas);

  let cherrySeq = 0;
  for (const [k, lIdxs] of Lsubj) {
    const rIdxs = Rsubj.get(k);
    if (!rIdxs) continue;
    const n = Math.min(lIdxs.length, rIdxs.length);
    for (let j = 0; j < n; j++) {
      const li = lIdxs[j];
      const ri = rIdxs[j];
      const id = 'cp:' + cherrySeq++;
      leftRows[li].status = 'cherry';
      leftRows[li].matchId = id;
      rightRows[ri].status = 'cherry';
      rightRows[ri].matchId = id;
      links.push({ type: 'cherry', leftIndex: li, rightIndex: ri, id });
    }
  }

  // 3) content-based cherry-pick fallback: for commits still unmarked as
  //    unique (title differed), match by git patch-id so edited-title
  //    cherry-picks pair up via their actual diff content.
  if (patchIds) {
    const groupByPatch = (rows) => {
      const m = new Map();
      rows.forEach((row) => {
        if (row.status !== 'unique') return; // already matched by SHA/title
        const p = patchIdOf(patchIds, row.sha);
        if (!p) return;
        if (!m.has(p)) m.set(p, []);
        m.get(p).push(row.index);
      });
      return m;
    };

    const Lpatch = groupByPatch(leftRows);
    const Rpatch = groupByPatch(rightRows);

    for (const [p, lIdxs] of Lpatch) {
      const rIdxs = Rpatch.get(p);
      if (!rIdxs) continue;
      const n = Math.min(lIdxs.length, rIdxs.length);
      for (let j = 0; j < n; j++) {
        const li = lIdxs[j];
        const ri = rIdxs[j];
        const id = 'patch:' + cherrySeq++;
        leftRows[li].status = 'cherry';
        leftRows[li].matchId = id;
        rightRows[ri].status = 'cherry';
        rightRows[ri].matchId = id;
        links.push({ type: 'patch', leftIndex: li, rightIndex: ri, id });
      }
    }
  }

  // 4) manual links: user-drawn connections between two still-unique commits.
  //    Identified by SHA so they survive reloads / new commits. Kept as their
  //    own `manual` link type (distinct color) and never auto-removed.
  if (manualLinks && manualLinks.length) {
    const LbySha = new Map(leftRows.map((r) => [r.sha, r]));
    const RbySha = new Map(rightRows.map((r) => [r.sha, r]));
    for (const ml of manualLinks) {
      const lr = LbySha.get(ml.leftSha);
      const rr = RbySha.get(ml.rightSha);
      // Only honor the link if both ends still exist and are unmatched, so an
      // auto-match (SHA/title/patch-id) never collides with a manual one.
      if (!lr || !rr || lr.status !== 'unique' || rr.status !== 'unique') continue;
      const id = 'manual:' + ml.leftSha + '|' + ml.rightSha;
      lr.matchId = id;
      lr.manual = true;
      rr.matchId = id;
      rr.manual = true;
      links.push({ type: 'manual', leftIndex: lr.index, rightIndex: rr.index, id });
    }
  }

  // 5) fuzzy content matching is applied as a SEPARATE pass (applyFuzzy) so the
  //    expensive exact-match result above can be memoized independently and not
  //    recomputed every time a single diff-text arrives. For backward
  //    compatibility computeDiff still honors a `fuzzy` argument by delegating.
  const result = {
    leftRows,
    rightRows,
    links,
    leftStats: computeStats(leftRows),
    rightStats: computeStats(rightRows)
  };
  if (fuzzy && fuzzy.enabled) return applyFuzzy(result, fuzzy);
  return result;
}

// Tally per-status counts for a side. Shared by computeDiff and applyFuzzy.
function computeStats(rows) {
  const s = { common: 0, cherry: 0, unique: 0, fuzzy: 0 };
  rows.forEach((r) => (s[r.status] += 1));
  return s;
}

// Fuzzy (approximate content) matching as a standalone pass over an existing
// computeDiff result. Clones the rows/links so the input (typically a memoized
// exact-match result) is never mutated, then pairs commits STILL marked unique
// by how much their CHANGED LINES overlap (containment ratio). Returns a new
// result object; pass-through (no clone) when fuzzy is disabled.
export function applyFuzzy(base, fuzzy) {
  if (!fuzzy || !fuzzy.enabled) return base;

  const leftRows = base.leftRows.map((r) => ({ ...r }));
  const rightRows = base.rightRows.map((r) => ({ ...r }));
  const links = base.links.slice();

  const thr = typeof fuzzy.threshold === 'number' ? fuzzy.threshold : 0.7;
  const dt = fuzzy.diffTexts || null;
  const buildCand = (rows) =>
    rows
      .filter((r) => r.status === 'unique' && !r.matchId)
      .map((r) => ({ row: r, set: diffLineSet(dt, r.sha) }))
      .filter((c) => c.set && c.set.size >= FUZZY_MIN_LINES);
  const Lcand = buildCand(leftRows);
  const Rcand = buildCand(rightRows);

  // Reverse index: changed-line -> right candidates containing it. Any pair with
  // non-zero overlap (the only pairs that can clear the threshold) shares at
  // least one line, so we only score those instead of the full L x R product.
  const lineIndex = new Map();
  for (const r of Rcand) {
    for (const line of r.set) {
      let bucket = lineIndex.get(line);
      if (!bucket) lineIndex.set(line, (bucket = []));
      bucket.push(r);
    }
  }

  const pairs = [];
  for (const l of Lcand) {
    const seen = new Set();
    for (const line of l.set) {
      const bucket = lineIndex.get(line);
      if (!bucket) continue;
      for (const r of bucket) {
        if (seen.has(r.row.index)) continue;
        seen.add(r.row.index);
        const score = containment(l.set, r.set);
        if (score >= thr) pairs.push({ li: l.row.index, ri: r.row.index, score });
      }
    }
  }
  pairs.sort((a, b) => b.score - a.score);

  const usedL = new Set();
  const usedR = new Set();
  let fuzzySeq = 0;
  for (const p of pairs) {
    if (usedL.has(p.li) || usedR.has(p.ri)) continue;
    usedL.add(p.li);
    usedR.add(p.ri);
    const id = 'fuzzy:' + fuzzySeq++;
    leftRows[p.li].status = 'fuzzy';
    leftRows[p.li].matchId = id;
    rightRows[p.ri].status = 'fuzzy';
    rightRows[p.ri].matchId = id;
    links.push({ type: 'fuzzy', leftIndex: p.li, rightIndex: p.ri, id, score: p.score });
  }

  return {
    leftRows,
    rightRows,
    links,
    leftStats: computeStats(leftRows),
    rightStats: computeStats(rightRows)
  };
}

// ---------------------------------------------------------------------------
// Alignment layout
//
// Places matched pairs (common + cherry-pick) on the SAME display row so the
// connecting line is perfectly horizontal ("左右對齊"). Unmatched commits fill
// the gaps. Because raw matches can cross each other (non-monotonic), only a
// Longest Increasing Subsequence of anchors is aligned; the rest stay linked
// but slanted.
//
//   Lrows / Rrows : arrays in display order, each item { commit, isHit }
//                   where commit.index is the original row index.
//   allLinks      : links from computeDiff() (leftIndex / rightIndex = original)
//
// Returns { L:{rows,count}, R:{rows,count}, links, totalRows } where every row
// carries a `displayIndex` and links are remapped to display coordinates.
// ---------------------------------------------------------------------------

// Longest strictly-increasing subsequence on `pr`, preserving input order
// (pairs must already be sorted by `pl`). Returns the selected pair objects.
function longestIncreasingByPr(pairs) {
  if (pairs.length === 0) return [];
  const prev = new Array(pairs.length).fill(-1);
  const tailIdx = []; // tailIdx[len-1] = index into pairs of smallest tail
  for (let i = 0; i < pairs.length; i++) {
    const x = pairs[i].pr;
    let lo = 0;
    let hi = tailIdx.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pairs[tailIdx[mid]].pr < x) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tailIdx[lo - 1];
    tailIdx[lo] = i;
  }
  let k = tailIdx[tailIdx.length - 1];
  const res = [];
  while (k !== -1) {
    res.push(pairs[k]);
    k = prev[k];
  }
  res.reverse();
  return res;
}

export function alignLayout(Lrows, Rrows, allLinks) {
  const posL = new Map();
  Lrows.forEach((r, i) => posL.set(r.commit.index, i));
  const posR = new Map();
  Rrows.forEach((r, i) => posR.set(r.commit.index, i));

  // Keep only links whose endpoints are both visible, in positional coords.
  const pairs = [];
  for (const link of allLinks) {
    const pl = posL.get(link.leftIndex);
    const pr = posR.get(link.rightIndex);
    if (pl === undefined || pr === undefined) continue;
    pairs.push({ pl, pr, link });
  }
  pairs.sort((a, b) => a.pl - b.pl || a.pr - b.pr);

  // Monotonic anchor set -> these pairs get aligned on the same row.
  const anchors = longestIncreasingByPr(pairs);

  const nL = Lrows.length;
  const nR = Rrows.length;
  const Ldisp = new Array(nL);
  const Rdisp = new Array(nR);

  let row = 0;
  let prevL = 0;
  let prevR = 0;
  const segments = anchors.concat([{ pl: nL, pr: nR, sentinel: true }]);
  for (const a of segments) {
    const gapL = a.pl - prevL;
    const gapR = a.pr - prevR;
    const g = Math.max(gapL, gapR);
    // Stack the unaligned rows of this segment, sharing rows where possible.
    for (let k = 0; k < g; k++) {
      if (k < gapL) Ldisp[prevL + k] = row + k;
      if (k < gapR) Rdisp[prevR + k] = row + k;
    }
    row += g;
    if (!a.sentinel) {
      // The anchor pair lands on one shared row -> horizontal connector.
      Ldisp[a.pl] = row;
      Rdisp[a.pr] = row;
      row += 1;
    }
    prevL = a.pl + 1;
    prevR = a.pr + 1;
  }

  const Lout = Lrows.map((r, i) => ({
    commit: r.commit,
    displayIndex: Ldisp[i],
    isHit: r.isHit
  }));
  const Rout = Rrows.map((r, i) => ({
    commit: r.commit,
    displayIndex: Rdisp[i],
    isHit: r.isHit
  }));

  const links = pairs.map(({ pl, pr, link }) => ({
    ...link,
    leftIndex: Ldisp[pl],
    rightIndex: Rdisp[pr]
  }));

  return {
    L: { rows: Lout, count: nL },
    R: { rows: Rout, count: nR },
    links,
    totalRows: row
  };
}

// Returns true if a commit matches the search query within the enabled scopes.
// `scopes` is an object like { subject, body, sha, author, date }; when omitted
// (null/undefined) every scope is searched (backward-compatible default).
export function matchesQuery(commit, query, scopes = null) {
  if (!query) return true;
  const q = query.toLowerCase();
  const on = (k) => !scopes || scopes[k];
  return (
    (on('subject') && commit.subject.toLowerCase().includes(q)) ||
    (on('body') && commit.body && commit.body.toLowerCase().includes(q)) ||
    (on('sha') &&
      (commit.sha.toLowerCase().includes(q) || commit.short.toLowerCase().includes(q))) ||
    (on('author') && commit.author && commit.author.toLowerCase().includes(q)) ||
    (on('date') && commit.authorDate && commit.authorDate.toLowerCase().includes(q))
  );
}
