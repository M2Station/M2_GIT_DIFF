import React from 'react';

// Per-repo Git toolbar shown above each commit column. Exposes the common
// remote operations (Fetch / Pull / Push) plus a reload, scoped to one side.
export default function RepoGitBar({ side, repo, loading, onGitOp, onReload }) {
  const disabled = !repo.path || loading;
  return (
    <div className="git-bar" data-side={side}>
      <span className="git-bar-label">
        <span className="git-bar-side">{side === 'L' ? 'LEFT' : 'RIGHT'}</span>
        {repo.path ? (
          <>
            <span className="git-bar-name" title={repo.path}>{repo.name}</span>
            <span className="git-bar-branch" title="Current branch">⎇ {repo.branch}</span>
          </>
        ) : (
          <span className="git-bar-name muted">No repository</span>
        )}
      </span>

      <span className="git-bar-actions">
        <button className="btn git-op" onClick={() => onGitOp(side, 'fetch')} disabled={disabled} title={'git fetch --all --prune\n只更新遠端追蹤 (origin/*)，不會改變本地 commit。\n畫面通常不會變動；要套用更新請用 Pull。'}>
          ⭳ Fetch
        </button>
        <button className="btn git-op" onClick={() => onGitOp(side, 'pull')} disabled={disabled} title="git pull --ff-only">
          ⬇ Pull
        </button>
        <button className="btn ghost git-op" onClick={() => onReload(side)} disabled={disabled} title="重新載入此 Repo">
          ↻
        </button>
      </span>
    </div>
  );
}
