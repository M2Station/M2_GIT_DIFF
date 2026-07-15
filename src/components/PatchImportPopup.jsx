/*
 * M2_GIT_DIFF
 * Copyright (c) 2026 OA Hsiao
 * SPDX-License-Identifier: MIT
 *
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '../lib/i18n.js';

// Classify a patch line so the preview can colour it like a diff. Order matters:
// the file markers (+++ / ---) must be checked before the generic +/- lines.
function patchLineClass(line) {
  if (line.startsWith('+++') || line.startsWith('---')) return 'pi-meta';
  if (
    line.startsWith('diff ') ||
    line.startsWith('index ') ||
    line.startsWith('new file') ||
    line.startsWith('deleted file') ||
    line.startsWith('old mode') ||
    line.startsWith('new mode') ||
    line.startsWith('rename ') ||
    line.startsWith('copy ') ||
    line.startsWith('similarity ') ||
    line.startsWith('dissimilarity ') ||
    line.startsWith('GIT binary patch') ||
    line.startsWith('Binary files')
  ) {
    return 'pi-meta';
  }
  if (line.startsWith('@@')) return 'pi-hunk';
  if (line.startsWith('+')) return 'pi-add';
  if (line.startsWith('-')) return 'pi-del';
  if (
    line.startsWith('From ') ||
    line.startsWith('From:') ||
    line.startsWith('Author:') ||
    line.startsWith('Date:') ||
    line.startsWith('Subject:')
  ) {
    return 'pi-hdr';
  }
  return 'pi-ctx';
}

// Modal that previews a .patch file against the chosen repo before applying it.
// It shows the patch content (coloured like a diff), a diffstat summary, and a
// conflict banner from a dry-run check. Apply runs `git apply --3way` — WORKING
// TREE ONLY, never a commit — so the user reviews the result in the diff tool
// and commits themselves. Closes on ✕, the backdrop, or Escape.
export default function PatchImportPopup({ side, repoName, repoPath, patchPath, onClose, onLog }) {
  const t = useT();
  const [loading, setLoading] = useState(true);
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState(null);
  const contentRef = useRef(null);

  const fileName = useMemo(() => String(patchPath || '').split(/[\\/]/).pop(), [patchPath]);
  const sideName = side === 'L' ? t('common.left') : side === 'R' ? t('common.right') : '';

  // Floating-window geometry so the popup can be dragged (by its header) and
  // resized (bottom-right grip) — a patch preview usually needs more room than
  // a fixed modal. Position + size are clamped to the viewport.
  const W0 = 820;
  const H0 = Math.min(Math.round(window.innerHeight * 0.84), 820);
  const [pos, setPos] = useState(() => ({
    x: Math.max(12, Math.round((window.innerWidth - W0) / 2)),
    y: Math.max(20, Math.round(window.innerHeight * 0.08)),
  }));
  const [size, setSize] = useState(() => ({ w: W0, h: H0 }));
  const dragRef = useRef(null);
  const resizeRef = useRef(null);

  const onDragStart = useCallback(
    (e) => {
      if (e.target.closest('button')) return;
      e.preventDefault();
      dragRef.current = { sx: e.clientX, sy: e.clientY, bx: pos.x, by: pos.y };
      const onMove = (ev) => {
        const d = dragRef.current;
        if (!d) return;
        const nx = d.bx + (ev.clientX - d.sx);
        const ny = d.by + (ev.clientY - d.sy);
        setPos({
          x: Math.min(Math.max(-size.w + 80, nx), window.innerWidth - 60),
          y: Math.min(Math.max(0, ny), window.innerHeight - 40),
        });
      };
      const onUp = () => {
        dragRef.current = null;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [pos.x, pos.y, size.w]
  );

  const onResizeStart = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      resizeRef.current = { sx: e.clientX, sy: e.clientY, bw: size.w, bh: size.h };
      const onMove = (ev) => {
        const r = resizeRef.current;
        if (!r) return;
        const nw = r.bw + (ev.clientX - r.sx);
        const nh = r.bh + (ev.clientY - r.sy);
        setSize({
          w: Math.min(Math.max(420, nw), window.innerWidth - pos.x - 12),
          h: Math.min(Math.max(320, nh), window.innerHeight - pos.y - 12),
        });
      };
      const onUp = () => {
        resizeRef.current = null;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [size.w, size.h, pos.x, pos.y]
  );

  // Inspect the patch on mount (content + diffstat + conflict check).
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    (async () => {
      try {
        const res = await window.api.inspectPatch({ repoPath, patchPath });
        if (alive) setInfo(res || null);
      } catch (e) {
        if (alive) setError(String(e?.message || e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [repoPath, patchPath]);

  // Close on Escape (unless a modal action is mid-flight).
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (!applying) onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, applying]);

  const apply = async () => {
    setApplying(true);
    setResult(null);
    try {
      const res = await window.api.applyPatch({ repoPath, patchPath });
      const out = { ok: res?.ok !== false, output: res?.output || '' };
      setResult(out);
      try { if (onLog) onLog({ ...res, repoName, fileName }); } catch { /* ignore */ }
    } catch (e) {
      setResult({ ok: false, output: String(e?.message || e) });
    } finally {
      setApplying(false);
    }
  };

  const lines = useMemo(
    () => (info?.content ? info.content.replace(/\n$/, '').split('\n') : []),
    [info]
  );

  // Conflict banner: already-applied, clean apply, clean 3-way merge, or real
  // conflict. Check already-applied first — it is the most specific state.
  let bannerClass = 'pi-ok';
  let bannerText = '';
  if (info) {
    if (info.alreadyApplied) {
      bannerClass = 'pi-applied';
      bannerText = t('patchImport.alreadyApplied');
    } else if (info.clean) {
      bannerClass = 'pi-ok';
      bannerText = t('patchImport.clean');
    } else if (info.threeway) {
      bannerClass = 'pi-warn';
      bannerText = t('patchImport.threeway');
    } else {
      bannerClass = 'pi-conflict';
      bannerText = t('patchImport.conflict');
    }
  }

  return (
    <div className="pi-backdrop" onMouseDown={() => !applying && onClose()}>
      <div
        className="pi"
        style={{ left: pos.x, top: pos.y, width: size.w, height: size.h }}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={t('patchImport.title')}
      >
        <div className="pi-head" onPointerDown={onDragStart}>
          <span className="pi-title">{t('patchImport.title')}</span>
          <span className="pi-side">{sideName}{repoName ? ` \u00b7 ${repoName}` : ''}</span>
          <button className="pi-x" onClick={onClose} disabled={applying} title={t('common.closeEsc')} aria-label={t('common.close')}>
            ✕
          </button>
        </div>

        <div className="pi-purpose">{t('patchImport.purpose')}</div>

        <div className="pi-sub">
          <span className="pi-file" title={patchPath}>📄 {fileName}</span>
        </div>

        {loading ? (
          <div className="pi-body pi-body--center">
            <div className="pi-loading">{t('patchImport.loading')}</div>
          </div>
        ) : error ? (
          <div className="pi-body">
            <div className="pi-label">{t('patchImport.sectionStatus')}</div>
            <div className="pi-banner pi-conflict">{error}</div>
          </div>
        ) : (
          <div className="pi-body">
            <div className="pi-label">{t('patchImport.sectionStatus')}</div>
            <div className={'pi-banner ' + bannerClass}>{bannerText}</div>

            {!info.clean && info.checkOutput && (
              <>
                <div className="pi-label">{t('patchImport.sectionWhy')}</div>
                <pre className="pi-check">{info.checkOutput}</pre>
              </>
            )}

            {info.stat && (
              <>
                <div className="pi-label">{t('patchImport.sectionFiles')}</div>
                <pre className="pi-stat">{info.stat}</pre>
              </>
            )}

            <div className="pi-label">{t('patchImport.sectionPatch')}</div>
            <div className="pi-content" ref={contentRef}>
              {lines.map((l, i) => (
                <div key={i} className={'pi-line ' + patchLineClass(l)}>{l || '\u00a0'}</div>
              ))}
            </div>

            {result && (
              <>
                <div className="pi-label">{t('patchImport.sectionResult')}</div>
                <div className={'pi-result' + (result.ok ? '' : ' fail')}>
                  <div className="pi-result-msg">{result.ok ? t('patchImport.appliedOk') : t('patchImport.appliedFail')}</div>
                  {result.output && <pre className="pi-result-out">{result.output}</pre>}
                </div>
              </>
            )}
          </div>
        )}

        <div className="pi-foot">
          <span className="pi-note">{t('patchImport.workingTreeNote')}</span>
          <span className="pi-foot-actions">
            <button
              type="button"
              className="btn primary"
              onClick={apply}
              disabled={loading || applying || !!error || !!info?.alreadyApplied}
              title={t('patchImport.applyTitle')}
            >
              {applying ? t('patchImport.applying') : t('patchImport.apply')}
            </button>
            <button type="button" className="btn" onClick={onClose} disabled={applying}>
              {t('common.close')}
            </button>
          </span>
        </div>

        <div
          className="pi-resize"
          onPointerDown={onResizeStart}
          title={t('patchImport.resize')}
          aria-hidden="true"
        />
      </div>
    </div>
  );
}
