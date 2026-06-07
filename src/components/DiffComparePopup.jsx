/*
 * M2_GIT_DIFF
 * Copyright (c) 2026 OA Hsiao
 * SPDX-License-Identifier: MIT
 *
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '../lib/i18n.js';
import { parseUnifiedDiff, changedLineSet, patchSimilarity } from '../lib/diff.js';
import VsIcon from './VsIcon.jsx';

// Floating side-by-side ("並排") commit-compare window. Opened from the Compare
// pill on a selected match. Fetches the full unified diff each commit
// introduced, parses it into files/hunks, and renders them line by line in two
// columns aligned by file path — so you can eyeball how much a cherry-pick (or
// fuzzy match) actually drifted. A pre-computed similarity % (Jaccard of the
// two commits' changed lines) headlines the window, with a per-file breakdown.
//
// Draggable by its header and resizable from any edge / corner, mirroring the
// CommitDetail popup so the two feel like one family of windows.
const MIN_W = 520;
const MAX_W = 100000;
const MIN_H = 260;

// Changed-line Set for ONE parsed file (added/removed lines only), so the
// per-file similarity uses the same normalization as the overall score.
function fileChangedSet(file) {
  const set = new Set();
  if (!file) return set;
  for (const h of file.hunks) {
    for (const ln of h.lines) {
      if (ln.type !== 'add' && ln.type !== 'del') continue;
      const text = ln.text.trim();
      if (text.length < 2) continue;
      set.add((ln.type === 'add' ? '+' : '-') + text);
    }
  }
  return set;
}

// Render one side's hunks for a single file as a column of typed lines. When a
// side has no change for this file (only the other side touched it) an empty
// placeholder keeps the columns aligned. `highlight` wraps the in-popup search
// matches; `side`/`fileIdx` build the stable line id used to mark the active hit.
function FileColumn({ file, emptyLabel, highlight, side, fileIdx }) {
  if (!file || file.hunks.length === 0) {
    return <div className="dc-col dc-col-empty">{emptyLabel}</div>;
  }
  return (
    <div className="dc-col">
      {file.hunks.map((h, hi) => (
        <div className="dc-hunk" key={hi}>
          <div className="dc-hunk-head">{h.header}</div>
          {h.lines.map((ln, li) => (
            <div className={'dc-line ' + ln.type} key={li}>
              <span className="dc-gutter-sign">
                {ln.type === 'add' ? '+' : ln.type === 'del' ? '-' : ' '}
              </span>
              <span className="dc-line-text">
                {highlight(ln.text, side + ':' + fileIdx + ':' + hi + ':' + li)}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export default function DiffComparePopup({ left, right, x, y, initialFind, onClose }) {
  const t = useT();
  const [size, setSize] = useState(() => ({
    w: Math.min(MAX_W, Math.max(MIN_W, Math.round(window.innerWidth * 0.86))),
    h: Math.min(720, Math.round(window.innerHeight * 0.82))
  }));
  const [pos, setPos] = useState(() => ({
    x: Math.min(Math.max(12, x ?? 80), window.innerWidth - 80),
    y: Math.min(Math.max(12, y ?? 70), window.innerHeight - 80)
  }));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [patches, setPatches] = useState({ left: '', right: '' });
  const dragRef = useRef(null);

  // In-popup search. This state is entirely LOCAL to the compare window, so
  // searching here never touches (or is touched by) the app's own Ctrl+F
  // search in App.jsx — the two are fully isolated. We do seed the initial
  // value from the app's current query as a one-way convenience; edits here
  // never flow back to the app.
  const [find, setFind] = useState(initialFind || '');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const findInputRef = useRef(null);
  const activeMarkRef = useRef(null);
  const findRef = useRef('');
  findRef.current = find;

  // Escape closes the window (or first clears the search if it's active), and
  // Ctrl/Cmd+F focuses the popup's own search box. Capture phase so it wins
  // over the app's background handlers and never leaks into the main search.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        e.stopPropagation();
        const el = findInputRef.current;
        if (el) { el.focus(); el.select(); }
        return;
      }
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (findRef.current) {
          setFind('');
          return;
        }
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  // Fetch both commits' patches in parallel on mount / when the pair changes.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    const fetchOne = (repoPath, sha) =>
      window.api?.getCommitDiff
        ? window.api.getCommitDiff({ repoPath, sha })
        : Promise.resolve('');
    Promise.all([
      fetchOne(left.repoPath, left.commit.sha),
      fetchOne(right.repoPath, right.commit.sha)
    ])
      .then(([lp, rp]) => {
        if (!alive) return;
        setPatches({ left: lp || '', right: rp || '' });
        setLoading(false);
      })
      .catch((e) => {
        if (!alive) return;
        setError(e?.message || String(e));
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [left.repoPath, left.commit.sha, right.repoPath, right.commit.sha]);

  // Parse patches, align files by path, and pre-compute similarity scores.
  const model = useMemo(() => {
    const lFiles = parseUnifiedDiff(patches.left);
    const rFiles = parseUnifiedDiff(patches.right);
    const lMap = new Map(lFiles.map((f) => [f.path, f]));
    const rMap = new Map(rFiles.map((f) => [f.path, f]));
    const paths = [];
    const seen = new Set();
    for (const f of lFiles) {
      if (!seen.has(f.path)) { seen.add(f.path); paths.push(f.path); }
    }
    for (const f of rFiles) {
      if (!seen.has(f.path)) { seen.add(f.path); paths.push(f.path); }
    }
    const rows = paths.map((p) => {
      const lf = lMap.get(p) || null;
      const rf = rMap.get(p) || null;
      const sim = patchSimilarity(fileChangedSet(lf), fileChangedSet(rf));
      return { path: p, left: lf, right: rf, sim, onBoth: !!lf && !!rf };
    });
    const overall = patchSimilarity(
      changedLineSet(patches.left),
      changedLineSet(patches.right)
    );
    return { rows, overall };
  }, [patches]);

  // Flat, ordered list of every search hit across both columns + file paths.
  // Each entry is keyed by a stable line id so the active hit can be marked
  // without relying on render order. Scan order matches the render order:
  // per file -> path, then left column, then right column.
  const matches = useMemo(() => {
    const out = [];
    const ndl = caseSensitive ? find : find.toLowerCase();
    if (!ndl) return out;
    const scan = (lineId, s) => {
      if (!s) return;
      const hay = caseSensitive ? s : s.toLowerCase();
      let from = 0;
      let occ = 0;
      while (true) {
        const idx = hay.indexOf(ndl, from);
        if (idx === -1) break;
        out.push({ lineId, occ });
        occ += 1;
        from = idx + ndl.length;
      }
    };
    model.rows.forEach((row, fi) => {
      scan('p:' + fi, row.path);
      if (row.left) {
        row.left.hunks.forEach((h, hi) =>
          h.lines.forEach((ln, li) => scan('left:' + fi + ':' + hi + ':' + li, ln.text))
        );
      }
      if (row.right) {
        row.right.hunks.forEach((h, hi) =>
          h.lines.forEach((ln, li) => scan('right:' + fi + ':' + hi + ':' + li, ln.text))
        );
      }
    });
    return out;
  }, [model, find, caseSensitive]);

  const total = matches.length;
  const activeMatch = total ? matches[Math.min(activeIdx, total - 1)] : null;

  // Wrap any matches in a line's text with <mark>, flagging the single active
  // hit (for scroll-into-view + accent color). Returns the text untouched when
  // there's no query, preserving the existing non-breaking-space placeholder.
  const highlight = (text, lineId) => {
    const raw = text || '';
    const ndl = caseSensitive ? find : find.toLowerCase();
    if (!ndl) return raw || '\u00a0';
    const hay = caseSensitive ? raw : raw.toLowerCase();
    const parts = [];
    let from = 0;
    let last = 0;
    let occ = 0;
    while (true) {
      const idx = hay.indexOf(ndl, from);
      if (idx === -1) break;
      if (idx > last) parts.push(raw.slice(last, idx));
      const isActive =
        activeMatch && activeMatch.lineId === lineId && activeMatch.occ === occ;
      parts.push(
        <mark
          key={occ + '@' + idx}
          ref={isActive ? activeMarkRef : undefined}
          className={'dc-find-hit' + (isActive ? ' active' : '')}
        >
          {raw.slice(idx, idx + ndl.length)}
        </mark>
      );
      last = idx + ndl.length;
      from = last;
      occ += 1;
    }
    if (parts.length === 0) return raw || '\u00a0';
    if (last < raw.length) parts.push(raw.slice(last));
    return parts;
  };

  const gotoNext = () => { if (total) setActiveIdx((i) => (i + 1) % total); };
  const gotoPrev = () => { if (total) setActiveIdx((i) => (i - 1 + total) % total); };

  // Reset to the first hit whenever the query/case changes.
  useEffect(() => { setActiveIdx(0); }, [find, caseSensitive]);

  // Keep the active hit in view as the user cycles through results.
  useEffect(() => {
    if (activeMarkRef.current) {
      activeMarkRef.current.scrollIntoView({ block: 'center', inline: 'nearest' });
    }
  }, [activeIdx, find, caseSensitive, patches]);

  const onFindKeyDown = (e) => {
    // Keep every keystroke inside the popup — F3 / Enter must never reach the
    // app's global handler (which would cycle the main search).
    e.stopPropagation();
    if (e.key === 'Enter' || e.key === 'F3') {
      e.preventDefault();
      if (e.shiftKey) gotoPrev();
      else gotoNext();
    }
  };

  const onDragStart = (e) => {
    if (e.target.closest('button')) return;
    e.preventDefault();
    dragRef.current = { sx: e.clientX, sy: e.clientY, bx: pos.x, by: pos.y };
    const onMove = (ev) => {
      const d = dragRef.current;
      if (!d) return;
      setPos({
        x: Math.min(Math.max(-(size.w - 60), d.bx + (ev.clientX - d.sx)), window.innerWidth - 60),
        y: Math.min(Math.max(0, d.by + (ev.clientY - d.sy)), window.innerHeight - 40)
      });
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const onResizeStart = (dir) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    const start = { mx: e.clientX, my: e.clientY, w: size.w, h: size.h, x: pos.x, y: pos.y };
    const maxH = window.innerHeight - 20;
    const onMove = (ev) => {
      const dx = ev.clientX - start.mx;
      const dy = ev.clientY - start.my;
      let { w, h, x: nx, y: ny } = start;
      if (dir.includes('e')) w = start.w + dx;
      if (dir.includes('s')) h = start.h + dy;
      if (dir.includes('w')) { w = start.w - dx; nx = start.x + dx; }
      if (dir.includes('n')) { h = start.h - dy; ny = start.y + dy; }
      if (w < MIN_W) { if (dir.includes('w')) nx = start.x + (start.w - MIN_W); w = MIN_W; }
      else if (w > MAX_W) { if (dir.includes('w')) nx = start.x + (start.w - MAX_W); w = MAX_W; }
      if (h < MIN_H) { if (dir.includes('n')) ny = start.y + (start.h - MIN_H); h = MIN_H; }
      else if (h > maxH) { if (dir.includes('n')) ny = start.y + (start.h - maxH); h = maxH; }
      setSize({ w, h });
      setPos({ x: nx, y: ny });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const pct = (v) => `${Math.round(v * 100)}%`;
  // Bucket the overall score so the badge can color-code at-a-glance health.
  const simClass =
    model.overall >= 0.85 ? 'high' : model.overall >= 0.5 ? 'mid' : 'low';

  const commitChip = (label, commit, side) => (
    <div className={'dc-chip ' + side}>
      <span className="dc-chip-side">{label}</span>
      <span className="dc-chip-sha" title={commit.sha}>{commit.short}</span>
      <span className="dc-chip-subject" title={commit.subject}>{commit.subject}</span>
    </div>
  );

  return (
    <div
      className="diff-compare"
      style={{ left: pos.x, top: pos.y, width: size.w, height: size.h }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="dc-header" onPointerDown={onDragStart}>
        <span className="dc-title">{t('compare.title')}</span>
        {!loading && !error && (
          <span className={'dc-sim ' + simClass} title={t('compare.simTitle')}>
            {t('compare.similarity')} {pct(model.overall)}
          </span>
        )}
        <span className="dc-spacer" />
        <button
          className="dc-close"
          onClick={onClose}
          onPointerDown={(e) => e.stopPropagation()}
          title={t('common.closeEsc')}
          aria-label={t('common.close')}
        >
          ✕
        </button>
      </div>

      <div className="dc-subhead">
        {commitChip(t('common.left'), left.commit, 'L')}
        <VsIcon className="dc-vs" />
        {commitChip(t('common.right'), right.commit, 'R')}
      </div>

      <div className="dc-find">
        <span className="dc-find-ico" aria-hidden="true">🔍</span>
        <input
          ref={findInputRef}
          className="dc-find-input"
          type="text"
          value={find}
          placeholder={t('compare.findPlaceholder')}
          aria-label={t('compare.findAria')}
          onChange={(e) => setFind(e.target.value)}
          onKeyDown={onFindKeyDown}
        />
        <span className="dc-find-count">
          {find
            ? total
              ? Math.min(activeIdx, total - 1) + 1 + '/' + total
              : t('compare.findNone')
            : ''}
        </span>
        <label className="dc-find-case" title={t('compare.findCase')}>
          <input
            type="checkbox"
            checked={caseSensitive}
            onChange={() => setCaseSensitive((v) => !v)}
          />
          <span>{t('compare.findCaseLabel')}</span>
        </label>
        <button
          className="dc-find-btn"
          onClick={gotoPrev}
          disabled={!total}
          title={t('search.previous')}
          aria-label={t('search.previous')}
        >
          ↑
        </button>
        <button
          className="dc-find-btn"
          onClick={gotoNext}
          disabled={!total}
          title={t('search.next')}
          aria-label={t('search.next')}
        >
          ↓
        </button>
        <button
          className="dc-find-btn"
          onClick={() => { setFind(''); findInputRef.current?.focus(); }}
          disabled={!find}
          title={t('compare.findClear')}
          aria-label={t('compare.findClear')}
        >
          ✕
        </button>
      </div>

      <div className="dc-scroll">
        {loading && <div className="dc-status-msg">{t('compare.loading')}</div>}
        {!loading && error && <div className="dc-status-msg dc-err">⚠ {error}</div>}
        {!loading && !error && model.rows.length === 0 && (
          <div className="dc-status-msg">{t('compare.empty')}</div>
        )}
        {!loading && !error &&
          model.rows.map((row, fi) => (
            <div className="dc-file" key={row.path}>
              <div className="dc-file-head">
                <span className="dc-file-path" title={row.path}>{highlight(row.path, 'p:' + fi)}</span>
                {row.onBoth ? (
                  <span className={'dc-file-sim ' + (row.sim >= 0.85 ? 'high' : row.sim >= 0.5 ? 'mid' : 'low')}>
                    {pct(row.sim)}
                  </span>
                ) : (
                  <span className="dc-file-only">
                    {row.left ? t('compare.onlyLeft') : t('compare.onlyRight')}
                  </span>
                )}
              </div>
              <div className="dc-file-body">
                <FileColumn file={row.left} emptyLabel={t('compare.noChangeSide')} highlight={highlight} side="left" fileIdx={fi} />
                <div className="dc-col-divider" />
                <FileColumn file={row.right} emptyLabel={t('compare.noChangeSide')} highlight={highlight} side="right" fileIdx={fi} />
              </div>
            </div>
          ))}
      </div>

      <div className="cd-rz cd-rz-n" onPointerDown={onResizeStart('n')} />
      <div className="cd-rz cd-rz-s" onPointerDown={onResizeStart('s')} />
      <div className="cd-rz cd-rz-e" onPointerDown={onResizeStart('e')} />
      <div className="cd-rz cd-rz-w" onPointerDown={onResizeStart('w')} />
      <div className="cd-rz cd-rz-ne" onPointerDown={onResizeStart('ne')} />
      <div className="cd-rz cd-rz-nw" onPointerDown={onResizeStart('nw')} />
      <div className="cd-rz cd-rz-se" onPointerDown={onResizeStart('se')} />
      <div className="cd-rz cd-rz-sw" onPointerDown={onResizeStart('sw')} />
    </div>
  );
}
