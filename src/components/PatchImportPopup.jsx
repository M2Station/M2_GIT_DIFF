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

  // Conflict banner: clean apply, clean 3-way merge, or real conflict.
  let bannerClass = 'pi-ok';
  let bannerText = '';
  if (info) {
    if (info.clean) {
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
      <div className="pi" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label={t('patchImport.title')}>
        <div className="pi-head">
          <span className="pi-title">{t('patchImport.title')}</span>
          <span className="pi-side">{sideName}{repoName ? ` \u00b7 ${repoName}` : ''}</span>
          <button className="pi-x" onClick={onClose} disabled={applying} title={t('common.closeEsc')} aria-label={t('common.close')}>
            ✕
          </button>
        </div>

        <div className="pi-sub">
          <span className="pi-file" title={patchPath}>📄 {fileName}</span>
        </div>

        {loading ? (
          <div className="pi-loading">{t('patchImport.loading')}</div>
        ) : error ? (
          <div className="pi-banner pi-conflict">{error}</div>
        ) : (
          <>
            <div className={'pi-banner ' + bannerClass}>{bannerText}</div>
            {!info.clean && info.checkOutput && (
              <pre className="pi-check">{info.checkOutput}</pre>
            )}
            {info.stat && <pre className="pi-stat">{info.stat}</pre>}
            <div className="pi-content" ref={contentRef}>
              {lines.map((l, i) => (
                <div key={i} className={'pi-line ' + patchLineClass(l)}>{l || '\u00a0'}</div>
              ))}
            </div>
          </>
        )}

        {result && (
          <div className={'pi-result' + (result.ok ? '' : ' fail')}>
            <div className="pi-result-msg">{result.ok ? t('patchImport.appliedOk') : t('patchImport.appliedFail')}</div>
            {result.output && <pre className="pi-result-out">{result.output}</pre>}
          </div>
        )}

        <div className="pi-foot">
          <span className="pi-note">{t('patchImport.workingTreeNote')}</span>
          <span className="pi-foot-actions">
            <button
              type="button"
              className="btn primary"
              onClick={apply}
              disabled={loading || applying || !!error}
              title={t('patchImport.applyTitle')}
            >
              {applying ? t('patchImport.applying') : t('patchImport.apply')}
            </button>
            <button type="button" className="btn" onClick={onClose} disabled={applying}>
              {t('common.close')}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
