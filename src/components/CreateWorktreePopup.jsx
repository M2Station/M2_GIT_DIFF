/*
 * M2_GIT_DIFF
 * Copyright (c) 2026 OA Hsiao
 * SPDX-License-Identifier: MIT
 *
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */
import React, { useState, useCallback, useEffect } from 'react';
import { useT } from '../lib/i18n.js';

// Centred modal that creates a new `git worktree` from a branch or a commit.
// The user browses to a parent directory and names the new folder (the worktree
// lands at "<parent>/<name>"); an optional branch name creates a fresh branch
// there instead of checking the ref out as-is. The git transcript is shown
// inline so the window stays put. Closes on the ✕, the backdrop, Cancel, or
// Escape. `source` = { kind:'branch'|'commit', ref, isRemote, label,
// defaultName, defaultBranch }.
export default function CreateWorktreePopup({ side, repoName, source, busy, result, branchInUse = false, inUseAt = '', pathBudget = null, onPickDir, onSubmit, onClose }) {
  const t = useT();
  const [parentDir, setParentDir] = useState('');
  const [name, setName] = useState(source?.defaultName || '');
  const [newBranch, setNewBranch] = useState(source?.defaultBranch || '');

  const created = !!(result && result.ok !== false);
  // git refuses to check out a branch that's already checked out in another
  // worktree, so when the source branch is in use we require a new branch name.
  const requireNewBranch = branchInUse && !newBranch.trim();

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
    const dir = await onPickDir();
    if (dir) setParentDir(dir);
  }, [onPickDir]);

  const submit = useCallback(() => {
    if (busy || created) return;
    const nm = name.trim();
    if (!parentDir || !nm) return;
    if (branchInUse && !newBranch.trim()) return;
    onSubmit({ parentDir: parentDir.trim(), name: nm, newBranch: newBranch.trim() });
  }, [busy, created, name, parentDir, newBranch, branchInUse, onSubmit]);

  const sideLabel = side === 'L' ? t('common.left') : side === 'R' ? t('common.right') : '';
  const sep = parentDir.includes('\\') ? '\\' : '/';
  const preview = parentDir && name.trim() ? `${parentDir}${sep}${name.trim()}` : '';

  // Guard against a worktree name that would push the deepest submodule git-dir
  // path past Git's GIT_DIR limit (Windows PATH_MAX-40 = 220). `pathBudget` holds
  // the fixed pieces from the main repo (skip-aware); we add the typed name
  // length. Over the safe limit we block creation and say how short to go.
  const trimmedName = name.trim();
  let pathWarn = null;
  if (pathBudget && pathBudget.reserveLen > 0) {
    const base = pathBudget.commonDirLen + pathBudget.worktreesSegLen + pathBudget.reserveLen;
    const projected = base + trimmedName.length;
    const maxName = pathBudget.safeLimit - base;
    if (projected > pathBudget.safeLimit) {
      pathWarn = { projected, maxName, limit: pathBudget.limit, impossible: maxName < 1 };
    }
  }

  // Guard 2: the build-output path under the worktree. Deep build trees (EDK2/
  // NMAKE etc.) overflow Windows MAX_PATH (260) even when the git-dir fits. Uses
  // the working-tree parent + name + a configured build reserve (off when 0).
  let buildWarn = null;
  if (pathBudget && pathBudget.buildReserve > 0 && parentDir) {
    const base = parentDir.length + 1 + pathBudget.buildReserve; // +1 path separator
    const projected = base + trimmedName.length;
    const maxName = pathBudget.buildSafeLimit - base;
    if (projected > pathBudget.buildSafeLimit) {
      buildWarn = { projected, maxName, limit: pathBudget.buildLimit, impossible: maxName < 1 };
    }
  }
  const canCreate = !busy && !created && !!parentDir && !!trimmedName && !requireNewBranch && !pathWarn && !buildWarn;

  const isCommit = source?.kind === 'commit';
  const branchFieldLabel = isCommit
    ? t('worktree.newBranchCommit')
    : source?.isRemote
      ? t('worktree.newBranchRemote')
      : t('worktree.newBranchLocal');

  return (
    <div className="wtp-backdrop" onMouseDown={() => !busy && onClose()}>
      <div className="wtp" onMouseDown={(e) => e.stopPropagation()}>
        <div className="wtp-head">
          <span className="wtp-title">{t('worktree.title')}</span>
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
            <label>{isCommit ? t('worktree.sourceCommit') : t('worktree.sourceBranch')}</label>
            <div className="wtp-source" title={source?.label}>{source?.label}</div>
          </div>

          <div className="wtp-field">
            <label>{t('worktree.parentDir')}</label>
            <div className="wtp-dir-row">
              <input
                type="text"
                className="wtp-input"
                value={parentDir}
                onChange={(e) => setParentDir(e.target.value)}
                placeholder={t('worktree.parentDirPlaceholder')}
                spellCheck={false}
                disabled={busy}
              />
              <button type="button" className="btn" onClick={browse} disabled={busy}>
                {t('worktree.browse')}
              </button>
            </div>
          </div>

          <div className="wtp-field">
            <label>{t('worktree.folderName')}</label>
            <input
              type="text"
              className="wtp-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('worktree.folderNamePlaceholder')}
              spellCheck={false}
              disabled={busy}
              autoFocus
            />
          </div>

          <div className="wtp-field">
            <label>{branchFieldLabel}</label>
            <input
              type="text"
              className="wtp-input"
              value={newBranch}
              onChange={(e) => setNewBranch(e.target.value)}
              placeholder={t('worktree.newBranchPlaceholder')}
              spellCheck={false}
              disabled={busy}
            />
            {branchInUse && (
              <div className="wtp-req">{t('worktree.branchInUse', { path: inUseAt || '' })}</div>
            )}
          </div>

          {preview && (
            <div className="wtp-preview">
              {t('worktree.pathPreview')}: <code>{preview}</code>
            </div>
          )}

          {pathWarn && (
            <div className="wtp-req wtp-pathwarn">
              {pathWarn.impossible
                ? t('worktree.pathTooLongHard', { limit: pathWarn.limit })
                : t('worktree.pathTooLong', {
                    max: pathWarn.maxName,
                    cur: trimmedName.length,
                    projected: pathWarn.projected,
                    limit: pathWarn.limit
                  })}
            </div>
          )}

          {buildWarn && (
            <div className="wtp-req wtp-pathwarn">
              {buildWarn.impossible
                ? t('worktree.buildPathTooLongHard', { limit: buildWarn.limit })
                : t('worktree.buildPathTooLong', {
                    max: buildWarn.maxName,
                    cur: trimmedName.length,
                    projected: buildWarn.projected,
                    limit: buildWarn.limit
                  })}
            </div>
          )}

          {(busy || result) && (
            <div className={'bmp-result' + (!busy && result && result.ok === false ? ' fail' : '')}>
              <div className="bmp-result-sum">
                {busy
                  ? t('worktree.creating')
                  : result?.ok === false
                    ? t('worktree.failed')
                    : t('worktree.created', { path: result?.target || preview })}
              </div>
              {!busy && result?.output && <pre className="bmp-result-out">{result.output}</pre>}
            </div>
          )}
        </div>

        <div className="wtp-foot">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            {created ? t('common.close') : t('common.cancel')}
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={submit}
            disabled={!canCreate}
            title={t('worktree.createTitle')}
          >
            {busy ? t('worktree.creating') : t('worktree.create')}
          </button>
        </div>
      </div>
    </div>
  );
}
