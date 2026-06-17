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
import { parseUnifiedDiff } from '../lib/diff.js';

// Floating single-commit "what changed" window, opened from the </> Code button
// in CommitDetail. Fetches the unified diff this one commit introduced (vs. its
// first parent) and renders it git-show style — file headers + hunks with
// green/red +/- lines — so it reads like one column of the Compare window.
//
// Draggable by its header and resizable from any edge / corner, mirroring the
// CommitDetail and DiffComparePopup windows so they feel like one family.
const MIN_W = 480;
const MAX_W = 100000;
const MIN_H = 240;

// One file's hunks as a single unified-diff column (added / removed / context).
function FileBody({ file }) {
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
              <span className="dc-line-text">{ln.text || '\u00a0'}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export default function CommitCodePopup({ side, commit, repoPath, x, y, onClose }) {
  const t = useT();
  const [size, setSize] = useState(() => ({
    w: Math.min(MAX_W, Math.max(MIN_W, Math.round(window.innerWidth * 0.6))),
    h: Math.min(680, Math.round(window.innerHeight * 0.78))
  }));
  const [pos, setPos] = useState(() => ({
    x: Math.min(Math.max(12, x ?? 90), window.innerWidth - 80),
    y: Math.min(Math.max(12, y ?? 80), window.innerHeight - 80)
  }));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [patch, setPatch] = useState('');
  const dragRef = useRef(null);

  // Escape closes the window. Capture phase + stopImmediatePropagation so it
  // stays fully inside this window: it closes ONLY the Code view, never the
  // parent commit-detail window, a sibling window, or the app's global Esc.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  // Fetch this commit's unified diff on mount / when the commit changes.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    const req = window.api?.getCommitDiff
      ? window.api.getCommitDiff({ repoPath, sha: commit.sha })
      : Promise.resolve('');
    req
      .then((p) => {
        if (!alive) return;
        setPatch(p || '');
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
  }, [repoPath, commit.sha]);

  const files = useMemo(() => parseUnifiedDiff(patch), [patch]);

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

  const sideName = side === 'L' ? t('common.left') : t('common.right');

  return (
    <div
      className="diff-compare code-view"
      style={{ left: pos.x, top: pos.y, width: size.w, height: size.h }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="dc-header" onPointerDown={onDragStart}>
        <span className="dc-title">{t('code.title')}</span>
        {!loading && !error && files.length > 0 && (
          <span className="cc-count" title={t('code.filesTitle')}>
            {t('code.files', { count: files.length })}
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
        <div className={'dc-chip ' + side}>
          <span className="dc-chip-side">{sideName}</span>
          <span className="dc-chip-sha" title={commit.sha}>{commit.short}</span>
          <span className="dc-chip-subject" title={commit.subject}>{commit.subject}</span>
        </div>
      </div>

      <div className="dc-scroll">
        {loading && <div className="dc-status-msg">{t('code.loading')}</div>}
        {!loading && error && <div className="dc-status-msg dc-err">⚠ {error}</div>}
        {!loading && !error && files.length === 0 && (
          <div className="dc-status-msg">{t('code.empty')}</div>
        )}
        {!loading && !error &&
          files.map((f, fi) => (
            <div className="dc-file" key={f.path + ':' + fi}>
              <div className="dc-file-head">
                <span className="dc-file-path" title={f.path}>{f.path}</span>
              </div>
              <div className="dc-file-body">
                <FileBody file={f} />
              </div>
            </div>
          ))}
      </div>

      {/* resize handles: 4 edges + 4 corners */}
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
