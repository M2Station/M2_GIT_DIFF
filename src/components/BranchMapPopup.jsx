/*
 * M2_GIT_DIFF
 * Copyright (c) 2026 OA Hsiao
 * SPDX-License-Identifier: MIT
 *
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */
import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useT } from '../lib/i18n.js';

// Build a nested tree from a list of branch names split on "/". A node may be
// both a leaf (a real branch) and a parent (a path prefix of other branches),
// e.g. "feature" and "feature/login" can coexist. `keyPrefix` namespaces the
// node keys per group so identical paths under LOCAL and a remote never collapse
// onto one shared key.
function buildTree(items, keyPrefix = '') {
  const root = { children: new Map() };
  for (const it of items) {
    const parts = it.name.split('/');
    let node = root;
    parts.forEach((part, i) => {
      if (!node.children.has(part)) {
        node.children.set(part, {
          label: part,
          key: keyPrefix + parts.slice(0, i + 1).join('/'),
          children: new Map(),
          leaf: null
        });
      }
      const child = node.children.get(part);
      if (i === parts.length - 1) child.leaf = it;
      node = child;
    });
  }
  return root;
}

// Read-only recursive tree row. Directories toggle open/closed; leaves are
// selectable branch labels (the current branch also gets a badge). Selecting a
// leaf drives the footer Switch / Worktree actions.
function MapNode({ node, depth, expanded, toggle, currentRef, selected, onSelect }) {
  const childList = useMemo(() => Array.from(node.children.values()), [node.children]);
  const hasChildren = childList.length > 0;
  const open = expanded.has(node.key);
  const isCurrent = node.leaf && node.leaf.ref === currentRef;
  const isSelected = node.leaf && selected && selected.ref === node.leaf.ref;

  const onRowClick = useCallback(() => {
    if (hasChildren) toggle(node.key);
    else if (node.leaf) onSelect(node.leaf);
  }, [hasChildren, node.key, node.leaf, toggle, onSelect]);

  const onRowContextMenu = useCallback(
    (e) => {
      if (!hasChildren) return;
      e.preventDefault();
      toggle(node.key);
    },
    [hasChildren, node.key, toggle]
  );

  return (
    <>
      <div
        className={
          'bsp-node' +
          (node.leaf ? ' leaf' : ' group') +
          (isCurrent ? ' current' : '') +
          (isSelected ? ' selected' : '')
        }
        style={{ paddingLeft: 8 + depth * 16 }}
        data-key={node.key}
        onClick={onRowClick}
        onContextMenu={onRowContextMenu}
        role={node.leaf ? 'option' : 'button'}
        aria-selected={isSelected || undefined}
      >
        <span className={'bsp-caret' + (hasChildren ? (open ? ' open' : ' closed') : '')} />
        <span className="bsp-icon">{node.leaf ? '\u2387' : '\uD83D\uDCC1'}</span>
        <span className="bsp-label">{node.label}</span>
        {isCurrent && <span className="bsp-current-badge">current</span>}
      </div>
      {hasChildren && open && (
        <div className="bsp-children">
          {childList.map((c) => (
            <MapNode
              key={c.key}
              node={c}
              depth={depth + 1}
              expanded={expanded}
              toggle={toggle}
              currentRef={currentRef}
              selected={selected}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </>
  );
}

// Floating, draggable/resizable modal that maps every branch (local + each
// remote) as a collapsible tree with a live search filter. The footer "Update"
// button fetches from origin and fast-forwards every tracking branch; the result
// transcript is shown inline so the tree can refresh in place. Closes on the ✕,
// the backdrop, the Close button, or Escape.
export default function BranchMapPopup({ side, repoName, data, worktrees = [], busy, result, onUpdate, onRefresh, onSwitch, onWorktree, onRemoveWorktree, onOpenFolder, onClose }) {
  const t = useT();
  const { current, local = [], remote = [] } = data || {};
  const [expanded, setExpanded] = useState(() => new Set());
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState(null);
  // Path of the worktree awaiting a delete confirmation (null when none).
  const [confirmPath, setConfirmPath] = useState(null);
  // Path of the worktree currently being removed, for the inline progress cue.
  const [removingPath, setRemovingPath] = useState(null);
  const searchRef = useRef(null);

  // Clear the per-row "removing" cue once the operation settles.
  useEffect(() => {
    if (!busy) setRemovingPath(null);
  }, [busy]);

  // Floating-window geometry: position + size, initialised near the top-centre.
  // The header drags the window and the bottom-right grip resizes it; both clamp
  // to the viewport so the window can never be dragged fully off-screen.
  const W0 = 480;
  const H0 = Math.min(Math.round(window.innerHeight * 0.72), 640);
  const [pos, setPos] = useState(() => ({
    x: Math.max(12, Math.round((window.innerWidth - W0) / 2)),
    y: Math.max(24, Math.round(window.innerHeight * 0.1))
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
          y: Math.min(Math.max(0, ny), window.innerHeight - 40)
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
          w: Math.min(Math.max(340, nw), window.innerWidth - pos.x - 12),
          h: Math.min(Math.max(300, nh), window.innerHeight - pos.y - 12)
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

  // Case-insensitive substring filter over the full ref name. When the box is
  // empty everything passes through unchanged.
  const q = filter.trim().toLowerCase();
  const matchedLocal = useMemo(
    () => (q ? local.filter((n) => n.toLowerCase().includes(q)) : local),
    [local, q]
  );
  const matchedRemote = useMemo(
    () => (q ? remote.filter((n) => n.toLowerCase().includes(q)) : remote),
    [remote, q]
  );

  // Close on Escape (capture so it wins over global handlers). Ctrl+F jumps to
  // the in-popup search box and selects its current text.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (!busy) onClose();
      } else if (e.ctrlKey && (e.key === 'F' || e.key === 'f')) {
        e.preventDefault();
        e.stopPropagation();
        if (searchRef.current) {
          searchRef.current.focus();
          searchRef.current.select();
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, busy]);

  // Group remotes by their first path segment (the remote name, e.g. origin).
  const groups = useMemo(() => {
    const out = [];
    if (matchedLocal.length) {
      out.push({
        key: '@local',
        label: t('branchMap.localGroup'),
        tree: buildTree(
          matchedLocal.map((n) => ({ name: n, ref: n, isRemote: false })),
          '@local/'
        )
      });
    }
    const byRemote = new Map();
    for (const full of matchedRemote) {
      const slash = full.indexOf('/');
      if (slash < 0) continue;
      const rem = full.slice(0, slash);
      const sub = full.slice(slash + 1);
      if (!byRemote.has(rem)) byRemote.set(rem, []);
      byRemote.get(rem).push({ name: sub, ref: full, isRemote: true });
    }
    for (const [rem, items] of byRemote) {
      const gkey = '@remote/' + rem;
      out.push({ key: gkey, label: rem, tree: buildTree(items, gkey + '/') });
    }
    return out;
  }, [matchedLocal, matchedRemote, t]);

  // While filtering, expand every node so matches are visible without manual
  // clicking; the collapsed-by-default state returns when the box is cleared.
  const collectKeys = (node, acc) => {
    for (const child of node.children.values()) {
      if (child.children.size) {
        acc.add(child.key);
        collectKeys(child, acc);
      }
    }
    return acc;
  };
  const effectiveExpanded = useMemo(() => {
    if (!q) return expanded;
    const all = new Set();
    for (const g of groups) {
      all.add(g.key);
      collectKeys(g.tree, all);
    }
    return all;
  }, [q, expanded, groups]);

  const toggle = useCallback((key) => {
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const sideLabel = side === 'L' ? t('common.left') : side === 'R' ? t('common.right') : '';
  const total = local.length + remote.length;
  const shown = matchedLocal.length + matchedRemote.length;

  return (
    <div className="bsp-backdrop" onMouseDown={() => !busy && onClose()}>
      <div
        className="bsp"
        style={{ left: pos.x, top: pos.y, width: size.w, height: size.h }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="bsp-head" onPointerDown={onDragStart}>
          <span className="bsp-title">{t('branchMap.title')}</span>
          <span className="bsp-meta">
            {sideLabel}
            {repoName ? ` \u00b7 ${repoName}` : ''}
          </span>
          <button
            type="button"
            className="bsp-x"
            onClick={onClose}
            disabled={busy}
            title={t('common.closeEsc')}
            aria-label={t('common.close')}
          >
            ✕
          </button>
        </div>

        <div className="bsp-subhead">
          <span className="bsp-current">
            {t('branchMap.current', { branch: current || '\u2014' })}
          </span>
          <span className="bsp-count">
            {q
              ? t('branchMap.countFiltered', { shown, count: total })
              : t('branchMap.count', { count: total })}
          </span>
        </div>

        <div className="bmp-wt">
          <div className="bmp-wt-head">
            <span className="bmp-wt-title">{t('branchMap.worktreesHead')}</span>
            <span className="bsp-count">{worktrees.length}</span>
          </div>
          {worktrees.length === 0 ? (
            <div className="bmp-wt-empty">{t('branchMap.worktreesEmpty')}</div>
          ) : (
            worktrees.map((w) => {
              const locked = w.isMain || w.isCurrent;
              const confirming = confirmPath === w.path;
              const removing = removingPath === w.path;
              return (
                <div className={'bmp-wt-row' + (locked ? ' locked' : '') + (w.prunable ? ' missing' : '')} key={w.path}>
                  <span className="bmp-wt-icon">{w.isMain ? '\uD83C\uDFE0' : '\uD83C\uDF3F'}</span>
                  <span className="bmp-wt-info">
                    <span className="bmp-wt-path" title={w.path}>{w.path}</span>
                    <span className="bmp-wt-branch">
                      {w.detached ? t('branchMap.detached') : (w.branch || '\u2014')}
                      {locked ? ` \u00b7 ${t('branchMap.mainWt')}` : ''}
                      {w.prunable ? ` \u00b7 ${t('branchMap.missing')}` : ''}
                    </span>
                  </span>
                  {removing ? (
                    <span className="bmp-wt-removing">
                      <span className="bmp-spin" />
                      {t('branchMap.removing')}
                    </span>
                  ) : confirming ? (
                    <span className="bmp-wt-confirm">
                      <button type="button" className="btn ghost" onClick={() => setConfirmPath(null)} disabled={busy}>
                        {t('common.cancel')}
                      </button>
                      <button
                        type="button"
                        className="btn danger"
                        onClick={() => { setConfirmPath(null); setRemovingPath(w.path); onRemoveWorktree(w.path); }}
                        disabled={busy}
                        title={t('branchMap.removeTitle')}
                      >
                        {t('branchMap.remove')}
                      </button>
                    </span>
                  ) : (
                    <span className="bmp-wt-actions">
                      <button
                        type="button"
                        className="bmp-wt-open"
                        onClick={() => onOpenFolder(w.path)}
                        disabled={busy || w.prunable}
                        title={t('branchMap.openFolderTitle')}
                        aria-label={t('branchMap.openFolderTitle')}
                      >
                        📂
                      </button>
                      <button
                        type="button"
                        className="bmp-wt-del"
                        onClick={() => setConfirmPath(w.path)}
                        disabled={busy || locked}
                        title={locked ? t('branchMap.mainWtTitle') : t('branchMap.removeTitle')}
                        aria-label={t('branchMap.removeTitle')}
                      >
                        🗑
                      </button>
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>

        <div className="bsp-search">
          <span className="bsp-search-icon">🔍</span>
          <input
            type="text"
            className="bsp-search-input"
            value={filter}
            ref={searchRef}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t('branchMap.searchPlaceholder')}
            aria-label={t('branchMap.searchPlaceholder')}
            autoFocus
          />
          {filter && (
            <button
              type="button"
              className="bsp-search-clear"
              onClick={() => setFilter('')}
              title={t('branchMap.clearFilter')}
              aria-label={t('branchMap.clearFilter')}
            >
              ✕
            </button>
          )}
        </div>

        <div className="bsp-tree" role="tree" aria-label={t('branchMap.title')}>
          {total === 0 && <div className="bsp-empty">{t('branchMap.empty')}</div>}
          {total > 0 && shown === 0 && <div className="bsp-empty">{t('branchMap.noMatch')}</div>}
          {groups.map((g) => {
            const open = effectiveExpanded.has(g.key);
            return (
              <div className="bsp-group" key={g.key}>
                <div
                  className="bsp-node group root"
                  style={{ paddingLeft: 8 }}
                  data-key={g.key}
                  onClick={() => toggle(g.key)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    toggle(g.key);
                  }}
                  role="button"
                >
                  <span className={'bsp-caret ' + (open ? 'open' : 'closed')} />
                  <span className="bsp-icon">🗂</span>
                  <span className="bsp-label">{g.label}</span>
                </div>
                {open && (
                  <div className="bsp-children">
                    {Array.from(g.tree.children.values()).map((c) => (
                      <MapNode
                        key={c.key}
                        node={c}
                        depth={1}
                        expanded={effectiveExpanded}
                        toggle={toggle}
                        currentRef={current}
                        selected={selected}
                        onSelect={setSelected}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {(busy || result) && (
          <div className={'bmp-result' + (result && result.ok === false ? ' fail' : '')}>
            <div className="bmp-result-sum">
              {busy && <span className="bmp-spin" />}
              {busy
                ? t('branchMap.working')
                : result?.kind === 'remove'
                  ? result.ok === false
                    ? t('branchMap.removeFailed')
                    : t('branchMap.removeDone')
                  : t('branchMap.updateDone', {
                      updated: result?.updated ?? 0,
                      skipped: result?.skipped ?? 0,
                      total: result?.total ?? 0
                    })}
            </div>
            {!busy && result?.output && (
              <pre className="bmp-result-out">{result.output}</pre>
            )}
          </div>
        )}

        <div className="bsp-foot">
          <span className="bsp-selected">
            {selected ? selected.ref : t('branchMap.pickHint')}
          </span>
          <span className="bsp-foot-actions">
            <button
              type="button"
              className="btn ghost"
              onClick={onRefresh}
              disabled={busy}
              title={t('branchMap.refreshTitle')}
              aria-label={t('branchMap.refresh')}
            >
              ↻
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => selected && onSwitch(selected)}
              disabled={busy || !selected}
              title={t('branchMap.switchTitle')}
            >
              {t('branchMap.switch')}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => selected && onWorktree(selected)}
              disabled={busy || !selected}
              title={t('branchMap.addWorktreeTitle')}
            >
              {t('branchMap.addWorktree')}
            </button>
            <button
              type="button"
              className="btn primary"
              onClick={onUpdate}
              disabled={busy || total === 0}
              title={t('branchMap.updateTitle')}
            >
              {t('branchMap.update')}
            </button>
            <button type="button" className="btn" onClick={onClose} disabled={busy}>
              {t('common.close')}
            </button>
          </span>
        </div>

        <div
          className="bsp-resize"
          onPointerDown={onResizeStart}
          title={t('branchMap.resize')}
          aria-hidden="true"
        />
      </div>
    </div>
  );
}
