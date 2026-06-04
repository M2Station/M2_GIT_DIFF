/*
 * M2_GIT_DIFF
 * Copyright (c) 2026 OA Hsiao
 * SPDX-License-Identifier: MIT
 *
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */
import React from 'react';
import { useT } from '../lib/i18n.js';

// Per-repo Git toolbar shown above each commit column. Exposes the common
// remote operations (Fetch / Pull / Push) plus a reload, scoped to one side.
export default function RepoGitBar({ side, repo, loading, onGitOp, onReload }) {
  const t = useT();
  const disabled = !repo.path || loading;
  return (
    <div className="git-bar" data-side={side}>
      <span className="git-bar-label">
        <span className="git-bar-side">{side === 'L' ? t('common.left') : t('common.right')}</span>
        {repo.path ? (
          <>
            <span className="git-bar-name" title={repo.path}>{repo.name}</span>
            <span className="git-bar-branch" title={t('common.currentBranch')}>⎇ {repo.branch}</span>
          </>
        ) : (
          <span className="git-bar-name muted">{t('gitBar.noRepository')}</span>
        )}
      </span>

      <span className="git-bar-actions">
        <button className="btn git-op" onClick={() => onGitOp(side, 'fetch')} disabled={disabled} title={t('gitBar.fetchTitle')}>
          {t('gitBar.fetch')}
        </button>
        <button className="btn git-op" onClick={() => onGitOp(side, 'pull')} disabled={disabled} title={t('gitBar.pullTitle')}>
          {t('gitBar.pull')}
        </button>
        <button className="btn ghost git-op" onClick={() => onReload(side)} disabled={disabled} title={t('gitBar.reloadTitle')}>
          ↻
        </button>
      </span>
    </div>
  );
}
