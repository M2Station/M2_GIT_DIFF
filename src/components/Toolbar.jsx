import React from 'react';
import logoUrl from '../assets/logo.svg';

function StatBadge({ stats }) {
  if (!stats) return null;
  return (
    <span className="stat-badges">
      <span className="b common" title="Common (same SHA)">{stats.common}</span>
      <span className="b cherry" title="Cherry-pick (same title)">{stats.cherry}</span>
      <span className="b unique" title="Unique (one side only)">{stats.unique}</span>
    </span>
  );
}

function RepoSlot({ side, repo, loading, onPick, onReload, stats }) {
  return (
    <div className="repo-slot">
      <div className="slot-label">{side === 'L' ? 'LEFT' : 'RIGHT'}</div>
      <button className="btn" onClick={() => onPick(side)} disabled={loading}>
        {loading ? 'Loading…' : repo.path ? 'Change…' : 'Open repo…'}
      </button>
      {repo.path && (
        <button className="btn ghost" onClick={() => onReload(side)} disabled={loading} title="Reload">
          ↻
        </button>
      )}
      <div className="repo-meta">
        {repo.path ? (
          <>
            <span className="repo-name" title={repo.path}>{repo.name}</span>
            <span className="branch" title="Current branch">⎇ {repo.branch}</span>
            <span className="count">{repo.commits.length} commits</span>
            <StatBadge stats={stats} />
          </>
        ) : (
          <span className="repo-name muted">No repository selected</span>
        )}
      </div>
    </div>
  );
}

export default function Toolbar({
  left,
  right,
  loading,
  onPick,
  onReload,
  leftStats,
  rightStats,
  onOpenSearch,
  manualCount,
  onClearManualLinks,
  noteCount,
  onClearNotes,
  colorCount,
  onClearColors,
  single,
  onSetSingle,
  onSwapSides,
  onExport,
  canExport
}) {
  return (
    <div className="toolbar">
      <div className="title-block">
        <img className="app-logo" src={logoUrl} alt="M2_GIT_DIFF logo" />
        <span className="app-title">M2_GIT_DIFF</span>
      </div>

      <RepoSlot side="L" repo={left} loading={loading.L} onPick={onPick} onReload={onReload} stats={leftStats} />
      <button
        className="btn swap-sides"
        onClick={onSwapSides}
        disabled={!left.path && !right.path}
        title="交換左右兩側 (L ⇄ R)"
        aria-label="Swap left and right"
      >
        ⇆ Swap
      </button>
      <RepoSlot side="R" repo={right} loading={loading.R} onPick={onPick} onReload={onReload} stats={rightStats} />

      <div className="mode-block" role="group" aria-label="View mode">
        <span className="mode-label">View</span>
        <button
          className={'btn mode' + (single === null ? ' on' : '')}
          onClick={() => onSetSingle(null)}
          title="雙邊比對模式"
        >
          ⇄ Compare
        </button>
        <button
          className={'btn mode' + (single === 'L' ? ' on' : '')}
          onClick={() => onSetSingle('L')}
          disabled={!left.path}
          title="只顯示左側 Repo（放大）"
        >
          ◧ Left only
        </button>
        <button
          className={'btn mode' + (single === 'R' ? ' on' : '')}
          onClick={() => onSetSingle('R')}
          disabled={!right.path}
          title="只顯示右側 Repo（放大）"
        >
          ◨ Right only
        </button>
      </div>

      <div className="search-block">
        <button className="btn" onClick={onOpenSearch} title="Search (Ctrl+F)">
          🔍 Search
        </button>
        <button
          className="btn clear-manual"
          onClick={onClearManualLinks}
          disabled={!manualCount}
          title="刪除所有手動連結並清除暫存"
        >
          ◗ Clear manual links{manualCount ? ` (${manualCount})` : ''}
        </button>
        <button
          className="btn clear-notes"
          onClick={onClearNotes}
          disabled={!noteCount}
          title="刪除所有註記並清除暫存"
        >
          📝 Clear notes{noteCount ? ` (${noteCount})` : ''}
        </button>
        <button
          className="btn clear-colors"
          onClick={onClearColors}
          disabled={!colorCount}
          title="清除所有強制背景顏色"
        >
          🎨 Clear colors{colorCount ? ` (${colorCount})` : ''}
        </button>
      </div>

      <div className="export-block">
        <button
          className="btn export-xlsx"
          onClick={onExport}
          disabled={!canExport}
          title="匯出對齊後的差異到 Excel（含 NOTE 提示、強制顏色、手動連結）"
        >
          ⬇ Export Excel
        </button>
      </div>
    </div>
  );
}
