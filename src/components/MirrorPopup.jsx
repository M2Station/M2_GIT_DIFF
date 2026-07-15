/*
 * M2_GIT_DIFF
 * Copyright (c) 2026 OA Hsiao
 * SPDX-License-Identifier: MIT
 *
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useT } from '../lib/i18n.js';

// Collapse git's carriage-return progress meter to its final line per row so a
// streamed transcript stays readable.
function normalizeProgress(raw) {
  if (!raw) return '';
  return raw
    .split('\n')
    .map((line) => {
      const i = line.lastIndexOf('\r');
      return i >= 0 ? line.slice(i + 1) : line;
    })
    .join('\n');
}

// Centred modal that manages the repo's submodule mirror cache. It shows the
// main repo's current mirror setting (the configured cache root, whether it
// exists and how many bare mirrors it holds), lets the user pick/point the cache
// folder and build it, and — when the cache already holds data — refresh every
// mirror in place. The git transcript streams inline. Closes on the ✕, the
// backdrop, Close, or Escape. `info` = { cacheRoot, exists, mirrorCount }.
export default function MirrorPopup({ side, repoName, repoPath, info, busy, progress, result, onPickFolder, onBuild, onUpdate, onOpenFolder, onClose }) {
  const t = useT();
  const cacheRoot = info?.cacheRoot || '';
  const hasData = !!(info?.exists && info?.mirrorCount > 0);
  const [folder, setFolder] = useState(cacheRoot);

  // Keep the field in sync when the configured cache changes (e.g. after a build
  // sets it), unless the user is mid-edit to a different value.
  useEffect(() => {
    setFolder((f) => (f && f !== cacheRoot ? f : cacheRoot));
  }, [cacheRoot]);

  const progressRef = useRef(null);
  useEffect(() => {
    const el = progressRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [progress]);

  // Close on Escape (capture so it wins over the app's global handlers).
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (!busy) onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, busy]);

  const browse = useCallback(async () => {
    const picked = await onPickFolder(folder || cacheRoot || repoPath);
    if (picked) setFolder(picked);
  }, [onPickFolder, folder, cacheRoot, repoPath]);

  const build = useCallback(() => {
    const f = (folder || '').trim();
    if (busy || !f) return;
    onBuild(f);
  }, [busy, folder, onBuild]);

  const sideLabel = side === 'L' ? t('common.left') : side === 'R' ? t('common.right') : '';

  const logText = busy
    ? normalizeProgress(progress || '')
    : result?.output
      ? normalizeProgress(result.output)
      : '';

  const summary = busy
    ? t('mirrorManager.working')
    : result?.kind === 'build'
      ? result.ok === false
        ? t('mirrorManager.buildFailed')
        : t('mirrorManager.buildDone', { count: result?.items?.length ?? 0, path: result?.cacheRoot || '' })
      : result?.kind === 'update'
        ? result.ok === false
          ? t('mirrorManager.updateFailed')
          : t('mirrorManager.updateDone', {
              updated: (result.items || []).filter((i) => i.ok !== false).length,
              total: (result.items || []).length
            })
        : '';

  const canBuild = !busy && !!(folder || '').trim();

  return (
    <div className="wtp-backdrop mirror-backdrop" onMouseDown={() => !busy && onClose()}>
      <div className="wtp mirror-pop" onMouseDown={(e) => e.stopPropagation()}>
        <div className="wtp-head">
          <span className="wtp-title">{t('mirrorManager.title')}</span>
          <span className="wtp-meta">
            {sideLabel}
            {repoName ? ` \u00b7 ${repoName}` : ''}
          </span>
          <button
            type="button"
            className="wtp-x"
            onClick={onClose}
            disabled={busy}
            title={t('common.closeEsc')}
            aria-label={t('common.close')}
          >
            ✕
          </button>
        </div>

        <div className="wtp-body">
          <div className="wtp-field">
            <label>{t('mirrorManager.repo')}</label>
            <div className="wtp-source" title={repoPath}>{repoPath || '\u2014'}</div>
          </div>

          <div className="wtp-field">
            <label>{t('mirrorManager.current')}</label>
            {cacheRoot ? (
              <div className="mirror-status">
                <code className="mirror-path" title={cacheRoot}>{cacheRoot}</code>
                <span className={'mirror-badge' + (hasData ? ' ok' : info?.exists ? ' warn' : ' miss')}>
                  {!info?.exists
                    ? t('mirrorManager.stateMissing')
                    : hasData
                      ? t('mirrorManager.stateMirrors', { count: info.mirrorCount })
                      : t('mirrorManager.stateEmpty')}
                </span>
              </div>
            ) : (
              <div className="mirror-status muted">{t('mirrorManager.notConfigured')}</div>
            )}
          </div>

          <div className="wtp-field">
            <label>{t('mirrorManager.folder')}</label>
            <div className="wtp-dir-row">
              <input
                type="text"
                className="wtp-input"
                value={folder}
                onChange={(e) => setFolder(e.target.value)}
                placeholder={t('mirrorManager.folderPlaceholder')}
                spellCheck={false}
                disabled={busy}
              />
              <button type="button" className="btn" onClick={browse} disabled={busy}>
                {t('worktree.browse')}
              </button>
            </div>
            <div className="wtp-hint">{t('mirrorManager.folderHint')}</div>
          </div>

          {(busy || result) && (
            <div className={'bmp-result' + (result && result.ok === false ? ' fail' : '')}>
              <div className="bmp-result-sum">
                <span className="bmp-result-msg">
                  {busy && <span className="bmp-spin" />}
                  {summary}
                </span>
              </div>
              {logText && (
                <pre className="bmp-result-out bmp-log" ref={progressRef}>{logText}</pre>
              )}
            </div>
          )}
        </div>

        <div className="wtp-foot mirror-foot">
          <span className="mirror-foot-left">
            {info?.exists && (
              <button
                type="button"
                className="btn ghost"
                onClick={() => onOpenFolder(cacheRoot)}
                disabled={busy}
                title={t('mirrorManager.openFolderTitle')}
              >
                {t('mirrorManager.openFolder')}
              </button>
            )}
          </span>
          <span className="mirror-foot-right">
            <button type="button" className="btn" onClick={onClose} disabled={busy}>
              {t('common.close')}
            </button>
            {hasData && (
              <button
                type="button"
                className="btn"
                onClick={onUpdate}
                disabled={busy}
                title={t('mirrorManager.updateTitle')}
              >
                {t('mirrorManager.update')}
              </button>
            )}
            <button
              type="button"
              className="btn primary"
              onClick={build}
              disabled={!canBuild}
              title={t('mirrorManager.buildTitle')}
            >
              {hasData ? t('mirrorManager.rebuild') : t('mirrorManager.build')}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
