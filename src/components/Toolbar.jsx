/*
 * M2_GIT_DIFF
 * Copyright (c) 2026 OA Hsiao
 * SPDX-License-Identifier: MIT
 *
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */
import React from 'react';
import logoUrl from '../assets/logo.svg';
import { useT } from '../lib/i18n.js';

function StatBadge({ stats, t }) {
  if (!stats) return null;
  return (
    <span className="stat-badges">
      <span className="b common" title={t('toolbar.statCommon')}>{stats.common}</span>
      <span className="b cherry" title={t('toolbar.statCherry')}>{stats.cherry}</span>
      <span className="b unique" title={t('toolbar.statUnique')}>{stats.unique}</span>
    </span>
  );
}

function RepoSlot({ side, repo, loading, onPick, onReload, stats, t }) {
  return (
    <div className="repo-slot">
      <div className="slot-label">{side === 'L' ? t('common.left') : t('common.right')}</div>
      <button className="btn" onClick={() => onPick(side)} disabled={loading}>
        {loading ? t('toolbar.loading') : repo.path ? t('toolbar.change') : t('toolbar.openRepo')}
      </button>
      {repo.path && (
        <button className="btn ghost" onClick={() => onReload(side)} disabled={loading} title={t('toolbar.reload')}>
          ↻
        </button>
      )}
      <div className="repo-meta">
        {repo.path ? (
          <>
            <div className="repo-path" title={repo.path}>{repo.path}</div>
            <div className="repo-branch" title={t('common.currentBranch')}>
              <span className="branch">⎇ {repo.branch}</span>
            </div>
            <div className="repo-stats">
              <span className="count">{t('toolbar.commits', { count: repo.commits.length })}</span>
              <StatBadge stats={stats} t={t} />
            </div>
          </>
        ) : (
          <span className="repo-name muted">{t('toolbar.noRepoSelected')}</span>
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
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  single,
  onSetSingle,
  onSwapSides,
  fuzzyEnabled,
  fuzzyThreshold,
  onToggleFuzzy,
  onSetFuzzyThreshold,
  onExport,
  canExport,
  onOpenHelp,
  onOpenSettings,
  onOpenLog,
  logBadge
}) {
  const t = useT();
  return (
    <div className="toolbar">
      <div className="toolbar-row repos-row">
        <div className="title-block">
          <img className="app-logo" src={logoUrl} alt="M2_GIT_DIFF logo" />
          <span className="app-title">M2_GIT_DIFF</span>
        </div>

        <RepoSlot side="L" repo={left} loading={loading.L} onPick={onPick} onReload={onReload} stats={leftStats} t={t} />
        <div className="fuzzy-block" role="group" aria-label="Fuzzy match">
          <button
            className={'btn fuzzy-toggle' + (fuzzyEnabled ? ' on' : '')}
            onClick={onToggleFuzzy}
            title={t('toolbar.fuzzyTitle')}
            aria-pressed={fuzzyEnabled}
          >
            {t('toolbar.fuzzyMatch')}
          </button>
          <span className="fuzzy-pct" title={t('toolbar.fuzzyThresholdTitle')}>
            <input
              className="fuzzy-input"
              type="number"
              min={0}
              max={100}
              step={5}
              value={fuzzyThreshold}
              disabled={!fuzzyEnabled}
              onChange={(e) => {
                const n = Math.max(0, Math.min(100, Number(e.target.value) || 0));
                onSetFuzzyThreshold(n);
              }}
              aria-label={t('toolbar.fuzzyThresholdAria')}
            />
            <span className="fuzzy-unit">%</span>
          </span>
        </div>
        <button
          className="btn swap-sides"
          onClick={onSwapSides}
          disabled={!left.path && !right.path}
          title={t('toolbar.swapTitle')}
          aria-label={t('toolbar.swapAria')}
        >
          {t('toolbar.swap')}
        </button>
        <RepoSlot side="R" repo={right} loading={loading.R} onPick={onPick} onReload={onReload} stats={rightStats} t={t} />
      </div>

      <div className="toolbar-row actions-row">
        <div className="mode-block" role="group" aria-label="View mode">
          <span className="mode-label">{t('toolbar.view')}</span>
          <button
            className={'btn mode' + (single === null ? ' on' : '')}
            onClick={() => onSetSingle(null)}
            title={t('toolbar.compareTitle')}
          >
            {t('toolbar.compare')}
          </button>
          <button
            className={'btn mode' + (single === 'L' ? ' on' : '')}
            onClick={() => onSetSingle('L')}
            disabled={!left.path}
            title={t('toolbar.leftOnlyTitle')}
          >
            {t('toolbar.leftOnly')}
          </button>
          <button
            className={'btn mode' + (single === 'R' ? ' on' : '')}
            onClick={() => onSetSingle('R')}
            disabled={!right.path}
            title={t('toolbar.rightOnlyTitle')}
          >
            {t('toolbar.rightOnly')}
          </button>
        </div>

        <div className="search-block">
          <button
            className="btn history-undo"
            onClick={onUndo}
            disabled={!canUndo}
            title={t('toolbar.undoTitle')}
            aria-label={t('toolbar.undo')}
          >
            {t('toolbar.undo')}
          </button>
          <button
            className="btn history-redo"
            onClick={onRedo}
            disabled={!canRedo}
            title={t('toolbar.redoTitle')}
            aria-label={t('toolbar.redo')}
          >
            {t('toolbar.redo')}
          </button>
          <button className="btn" onClick={onOpenSearch} title={t('toolbar.searchTitle')}>
            {t('toolbar.search')}
          </button>
          <button
            className="btn clear-manual"
            onClick={onClearManualLinks}
            disabled={!manualCount}
            title={t('toolbar.clearManualTitle')}
          >
            {t('toolbar.clearManual')}{manualCount ? ` (${manualCount})` : ''}
          </button>
          <button
            className="btn clear-notes"
            onClick={onClearNotes}
            disabled={!noteCount}
            title={t('toolbar.clearNotesTitle')}
          >
            {t('toolbar.clearNotes')}{noteCount ? ` (${noteCount})` : ''}
          </button>
          <button
            className="btn clear-colors"
            onClick={onClearColors}
            disabled={!colorCount}
            title={t('toolbar.clearColorsTitle')}
          >
            {t('toolbar.clearColors')}{colorCount ? ` (${colorCount})` : ''}
          </button>
        </div>

        <div className="export-block">
          <button
            className="btn export-xlsx"
            onClick={onExport}
            disabled={!canExport}
            title={t('toolbar.exportTitle')}
          >
            {t('toolbar.export')}
          </button>
          <button
            className={'btn log-btn' + (logBadge > 0 ? ' has-issues' : '')}
            onClick={onOpenLog}
            title={t('toolbar.logTitle')}
            aria-label={t('toolbar.log')}
          >
            {t('toolbar.log')}
            {logBadge > 0 ? <span className="log-badge">{logBadge > 99 ? '99+' : logBadge}</span> : null}
          </button>
          <button
            className="btn help-btn"
            onClick={onOpenHelp}
            title={t('toolbar.helpTitle')}
            aria-label={t('toolbar.help')}
          >
            {t('toolbar.help')}
          </button>
          <button
            className="btn settings-btn"
            onClick={onOpenSettings}
            title={t('toolbar.settingsTitle')}
            aria-label={t('toolbar.settingsTitle')}
          >
            {t('toolbar.settings')}
          </button>
        </div>
      </div>
    </div>
  );
}
