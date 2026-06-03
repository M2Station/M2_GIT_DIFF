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
  query,
  onQuery,
  onPick,
  onReload,
  leftStats,
  rightStats,
  matchCount,
  filterOnly,
  onToggleFilter,
  searchRef,
  onSearchKeyDown,
  manualCount,
  onClearManualLinks
}) {
  return (
    <div className="toolbar">
      <div className="title-block">
        <img className="app-logo" src={logoUrl} alt="M2_GIT_DIFF logo" />
        <span className="app-title">M2_GIT_DIFF</span>
      </div>

      <RepoSlot side="L" repo={left} loading={loading.L} onPick={onPick} onReload={onReload} stats={leftStats} />
      <RepoSlot side="R" repo={right} loading={loading.R} onPick={onPick} onReload={onReload} stats={rightStats} />

      <div className="search-block">
        <input
          ref={searchRef}
          className="search"
          type="text"
          placeholder="Search title, body, SHA, author, date…  (Ctrl+F)"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={onSearchKeyDown}
        />
        {query && <span className="match-count">{matchCount} hits</span>}
        <button
          className={'btn toggle' + (filterOnly ? ' on' : '')}
          onClick={onToggleFilter}
          disabled={!query}
          title="Show only matching commits"
        >
          {filterOnly ? '☑' : '☐'} Filter
        </button>
        {query && (
          <button className="btn ghost" onClick={() => onQuery('')} title="Clear">✕</button>
        )}
        <button
          className="btn clear-manual"
          onClick={onClearManualLinks}
          disabled={!manualCount}
          title="刪除所有手動連結並清除暫存"
        >
          ◗ Clear manual links{manualCount ? ` (${manualCount})` : ''}
        </button>
      </div>
    </div>
  );
}
