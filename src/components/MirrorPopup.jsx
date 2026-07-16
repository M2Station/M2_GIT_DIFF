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
export default function MirrorPopup({ side, repoName, repoPath, info, busy, progress, result, onPickFolder, onBuild, onUpdate, onSetCache, onConfigureSkip, onOpenFolder, onClose }) {
  const t = useT();
  const cacheRoot = info?.cacheRoot || '';
  const hasData = !!(info?.exists && info?.mirrorCount > 0);
  const [folder, setFolder] = useState(cacheRoot);
  const [pos, setPos] = useState(null); // {x,y}; null until first-render centring
  const dragRef = useRef(null);
  const winRef = useRef(null);

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

  // Centre the window on first mount (measure, then place).
  useEffect(() => {
    if (pos || !winRef.current) return;
    const r = winRef.current.getBoundingClientRect();
    setPos({
      x: Math.max(8, Math.round((window.innerWidth - r.width) / 2)),
      y: Math.max(8, Math.round((window.innerHeight - r.height) / 3))
    });
  }, [pos]);

  // Drag the window by its header.
  const onDragStart = useCallback(
    (e) => {
      if (e.button !== 0) return;
      dragRef.current = { mx: e.clientX, my: e.clientY, x: pos?.x || 0, y: pos?.y || 0 };
      const move = (ev) => {
        const d = dragRef.current;
        if (!d) return;
        const w = winRef.current?.offsetWidth || 520;
        const nx = d.x + (ev.clientX - d.mx);
        const ny = d.y + (ev.clientY - d.my);
        setPos({
          x: Math.min(Math.max(-(w - 90), nx), window.innerWidth - 90),
          y: Math.min(Math.max(0, ny), window.innerHeight - 32)
        });
      };
      const up = () => {
        dragRef.current = null;
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    },
    [pos]
  );

  const browse = useCallback(async () => {
    const picked = await onPickFolder(folder || cacheRoot || repoPath);
    if (picked) setFolder(picked);
  }, [onPickFolder, folder, cacheRoot, repoPath]);

  const build = useCallback(() => {
    const f = (folder || '').trim();
    if (busy || !f) return;
    onBuild(f);
  }, [busy, folder, onBuild]);

  // Point the repo at the chosen folder as its mirror cache without building or
  // fetching anything — for a folder that already holds bare mirrors.
  const setCache = useCallback(() => {
    const f = (folder || '').trim();
    if (busy || !f) return;
    onSetCache(f);
  }, [busy, folder, onSetCache]);

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
        : result?.kind === 'set'
          ? result.ok === false
            ? t('mirrorManager.setFailed')
            : t('mirrorManager.setDone', { count: result?.mirrorCount ?? 0, path: result?.cacheRoot || '' })
          : '';

  const canBuild = !busy && !!(folder || '').trim();

  const style = pos ? { left: `${pos.x}px`, top: `${pos.y}px` } : { left: '-9999px', top: '-9999px' };

  return (
    <div className="wtp-backdrop mirror-backdrop" onMouseDown={() => !busy && onClose()}>
      <div className="wtp mirror-pop" ref={winRef} style={style} onMouseDown={(e) => e.stopPropagation()}>
        <div className="wtp-head" onMouseDown={onDragStart}>
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

          <div className="wtp-field">
            <label>{t('mirrorManager.submoduleSkipLabel')}</label>
            <div className="wtp-dir-row">
              <button type="button" className="btn" onClick={onConfigureSkip} disabled={busy}>
                {t('mirrorManager.submoduleSkipBtn')}
              </button>
            </div>
            <div className="wtp-hint">{t('mirrorManager.submoduleSkipHint')}</div>
          </div>

          {(busy || result) && (
            <div className={'bmp-result' + (!busy && result && result.ok === false ? ' fail' : '')}>
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
              className="btn"
              onClick={setCache}
              disabled={!canBuild}
              title={t('mirrorManager.setCacheTitle')}
            >
              {t('mirrorManager.setCache')}
            </button>
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
