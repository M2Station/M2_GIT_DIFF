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
// both a leaf (an actual branch) and a parent (a path prefix of other
// branches), e.g. "feature" and "feature/login" coexisting.
function buildTree(items, keyPrefix = '') {
  // items: [{ name: 'feature/login', ref: 'origin/feature/login', isRemote }]
  // keyPrefix namespaces the node keys per group so that a branch with the same
  // path under both LOCAL and a remote does not collapse onto one shared key
  // (which previously caused both rows to highlight/expand together).
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

function TreeNode({ node, depth, expanded, toggle, selected, onSelect, currentRef, activeKey, setActiveKey }) {
  const childList = useMemo(
    () => Array.from(node.children.values()),
    [node.children]
  );
  const hasChildren = childList.length > 0;
  const open = expanded.has(node.key);
  const isCurrent = node.leaf && node.leaf.ref === currentRef;
  const isSelected = node.leaf && selected && selected.ref === node.leaf.ref;
  const isActive = activeKey === node.key;

  const onRowClick = useCallback(() => {
    setActiveKey(node.key);
    if (hasChildren) toggle(node.key);
    else if (node.leaf) onSelect(node.leaf);
  }, [hasChildren, node, toggle, onSelect, setActiveKey]);

  // Right-click on a directory node toggles open/collapse just like Enter.
  const onRowContextMenu = useCallback(
    (e) => {
      e.preventDefault();
      if (!hasChildren) return;
      setActiveKey(node.key);
      toggle(node.key);
    },
    [hasChildren, node, toggle, setActiveKey]
  );

  return (
    <>
      <div
        className={
          'bsp-node' +
          (isSelected ? ' selected' : '') +
          (isActive ? ' active' : '') +
          (node.leaf ? ' leaf' : ' group')
        }
        style={{ paddingLeft: 8 + depth * 16 }}
        data-key={node.key}
        onClick={onRowClick}
        onContextMenu={onRowContextMenu}
        role={node.leaf ? 'option' : 'button'}
        aria-selected={isSelected || undefined}
      >
        <span className={'bsp-caret' + (hasChildren ? (open ? ' open' : ' closed') : '')} />
        <span className="bsp-icon">{node.leaf ? '⎇' : '📁'}</span>
        <span className="bsp-label">{node.label}</span>
        {isCurrent && <span className="bsp-current-badge">current</span>}
      </div>
      {hasChildren && open && (
        <div className="bsp-children">
          {childList.map((c) => (
            <TreeNode
              key={c.key}
              node={c}
              depth={depth + 1}
              expanded={expanded}
              toggle={toggle}
              selected={selected}
              onSelect={onSelect}
              currentRef={currentRef}
              activeKey={activeKey}
              setActiveKey={setActiveKey}
            />
          ))}
        </div>
      )}
    </>
  );
}

// Floating modal that lists every branch (local + each remote) in a collapsible
// tree, collapsed by default. The user picks one branch and confirms with the
// bottom-right "Switch to branch" button. Closes on the ✕, the backdrop, the
// Cancel button, or Escape.
export default function BranchSwitchPopup({ side, repoName, data, busy, onSwitch, onClose }) {
  const t = useT();
  const { current, local = [], remote = [] } = data || {};
  const [selected, setSelected] = useState(null);
  const [expanded, setExpanded] = useState(() => new Set());
  const [filter, setFilter] = useState('');
  // Key of the row that currently has keyboard focus (arrow-key navigation).
  const [activeKey, setActiveKey] = useState(null);
  const treeRef = useRef(null);
  const searchRef = useRef(null);

  // Floating-window geometry: position + size, initialised centred. The header
  // drags the window and the bottom-right grip resizes it. Both clamp to the
  // viewport so the window can never be dragged fully off-screen.
  const W0 = 480;
  const H0 = Math.min(Math.round(window.innerHeight * 0.7), 620);
  const [pos, setPos] = useState(() => ({
    x: Math.max(12, Math.round((window.innerWidth - W0) / 2)),
    y: Math.max(24, Math.round(window.innerHeight * 0.12))
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
          h: Math.min(Math.max(280, nh), window.innerHeight - pos.y - 12)
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
        label: t('branchSwitch.localGroup'),
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
  const canSwitch =
    !busy && selected && !(selected.ref === current && !selected.isRemote);

  const confirm = useCallback(() => {
    if (canSwitch) onSwitch(selected);
  }, [canSwitch, onSwitch, selected]);

  // Flatten the visible tree (respecting expand state) into an ordered list of
  // rows. This is what the arrow keys traverse, mirroring exactly what the user
  // sees on screen.
  const flatRows = useMemo(() => {
    const rows = [];
    const walk = (node, depth) => {
      const hasChildren = node.children.size > 0;
      const open = effectiveExpanded.has(node.key);
      rows.push({ key: node.key, hasChildren, open, leaf: node.leaf, depth });
      if (hasChildren && open) {
        for (const c of node.children.values()) walk(c, depth + 1);
      }
    };
    for (const g of groups) {
      const open = effectiveExpanded.has(g.key);
      rows.push({ key: g.key, hasChildren: true, open, leaf: null, depth: 0 });
      if (open) for (const c of g.tree.children.values()) walk(c, 1);
    }
    return rows;
  }, [groups, effectiveExpanded]);

  // Keep the active row valid as the list changes; prefer the first branch.
  useEffect(() => {
    if (!flatRows.length) return;
    if (!flatRows.some((r) => r.key === activeKey)) {
      const first = flatRows.find((r) => r.leaf) || flatRows[0];
      setActiveKey(first.key);
    }
  }, [flatRows, activeKey]);

  // Scroll the active row into view whenever it moves.
  useEffect(() => {
    if (!activeKey || !treeRef.current) return;
    const el = treeRef.current.querySelector(
      `[data-key="${(window.CSS && CSS.escape ? CSS.escape(activeKey) : activeKey)}"]`
    );
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [activeKey, flatRows]);

  const focusRow = useCallback((row) => {
    setActiveKey(row.key);
    if (row.leaf) setSelected(row.leaf);
  }, []);

  // Arrow-key navigation: Up/Down move, Right expands or descends, Left
  // collapses or ascends to the parent, Enter selects a branch (or switches if
  // it is already selected) and toggles a group/folder. Registered on window so
  // it works no matter where focus sits (search box, a clicked row, or body).
  const onKeyNav = useCallback(
    (e) => {
      const inSearch = e.target === searchRef.current;
      const isVertical = e.key === 'ArrowDown' || e.key === 'ArrowUp';
      const isHorizontal = e.key === 'ArrowLeft' || e.key === 'ArrowRight';
      const isNav = isVertical || isHorizontal;
      if (!isNav && e.key !== 'Enter') return;
      // While there is text in the search box, leave Left/Right for the text
      // caret; only vertical arrows and Enter drive navigation from there. When
      // the box is empty (the default on open) Left/Right still expand/collapse
      // the active tree row, including the top-level group headers.
      if (inSearch && isHorizontal && q) return;
      // Stop the event before it reaches the main app underneath, otherwise the
      // repo columns/rows react to the same arrow keys.
      e.preventDefault();
      e.stopPropagation();
      if (!flatRows.length) return;
      let idx = flatRows.findIndex((r) => r.key === activeKey);
      if (idx < 0) idx = 0;
      const row = flatRows[idx];

      if (e.key === 'ArrowDown') {
        focusRow(flatRows[Math.min(idx + 1, flatRows.length - 1)]);
      } else if (e.key === 'ArrowUp') {
        focusRow(flatRows[Math.max(idx - 1, 0)]);
      } else if (e.key === 'ArrowRight') {
        if (row.hasChildren && !row.open && !q) toggle(row.key);
        else if (row.hasChildren)
          focusRow(flatRows[Math.min(idx + 1, flatRows.length - 1)]);
      } else if (e.key === 'ArrowLeft') {
        if (row.hasChildren && row.open && !q) {
          toggle(row.key);
        } else {
          for (let j = idx - 1; j >= 0; j--) {
            if (flatRows[j].depth < row.depth) {
              focusRow(flatRows[j]);
              break;
            }
          }
        }
      } else if (e.key === 'Enter') {
        if (row.leaf) {
          if (selected && selected.ref === row.leaf.ref) confirm();
          else setSelected(row.leaf);
        } else if (row.hasChildren && !q) {
          toggle(row.key);
        }
      }
    },
    [flatRows, activeKey, q, toggle, selected, confirm, focusRow]
  );

  // Keep the navigation handler live regardless of which element holds focus.
  // Capture phase + stopPropagation ensures the main app below never sees these
  // keys while the popup is open.
  useEffect(() => {
    window.addEventListener('keydown', onKeyNav, true);
    return () => window.removeEventListener('keydown', onKeyNav, true);
  }, [onKeyNav]);

  return (
    <div className="bsp-backdrop" onMouseDown={() => !busy && onClose()}>
      <div
        className="bsp"
        style={{ left: pos.x, top: pos.y, width: size.w, height: size.h }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="bsp-head" onPointerDown={onDragStart}>
          <span className="bsp-title">{t('branchSwitch.title')}</span>
          <span className="bsp-meta">
            {sideLabel}
            {repoName ? ` · ${repoName}` : ''}
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
            {t('branchSwitch.current', { branch: current || '—' })}
          </span>
          <span className="bsp-count">
            {q
              ? t('branchSwitch.countFiltered', { shown, count: total })
              : t('branchSwitch.count', { count: total })}
          </span>
        </div>

        <div className="bsp-search">
          <span className="bsp-search-icon">🔍</span>
          <input
            type="text"
            className="bsp-search-input"
            value={filter}
            ref={searchRef}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t('branchSwitch.searchPlaceholder')}
            aria-label={t('branchSwitch.searchPlaceholder')}
            autoFocus
          />
          {filter && (
            <button
              type="button"
              className="bsp-search-clear"
              onClick={() => setFilter('')}
              title={t('branchSwitch.clearFilter')}
              aria-label={t('branchSwitch.clearFilter')}
            >
              ✕
            </button>
          )}
        </div>

        <div className="bsp-tree" role="listbox" aria-label={t('branchSwitch.title')} ref={treeRef}>
          {total === 0 && <div className="bsp-empty">{t('branchSwitch.empty')}</div>}
          {total > 0 && shown === 0 && (
            <div className="bsp-empty">{t('branchSwitch.noMatch')}</div>
          )}
          {groups.map((g) => {
            const open = effectiveExpanded.has(g.key);
            return (
              <div className="bsp-group" key={g.key}>
                <div
                  className={'bsp-node group root' + (activeKey === g.key ? ' active' : '')}
                  style={{ paddingLeft: 8 }}
                  data-key={g.key}
                  onClick={() => {
                    setActiveKey(g.key);
                    toggle(g.key);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setActiveKey(g.key);
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
                      <TreeNode
                        key={c.key}
                        node={c}
                        depth={1}
                        expanded={effectiveExpanded}
                        toggle={toggle}
                        selected={selected}
                        onSelect={setSelected}
                        currentRef={current}
                        activeKey={activeKey}
                        setActiveKey={setActiveKey}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="bsp-foot">
          <span className="bsp-selected">
            {selected ? selected.ref : t('branchSwitch.noSelection')}
          </span>
          <span className="bsp-foot-actions">
            <button type="button" className="btn" onClick={onClose} disabled={busy}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="btn primary"
              onClick={confirm}
              disabled={!canSwitch}
            >
              {busy ? t('branchSwitch.switching') : t('branchSwitch.switchTo')}
            </button>
          </span>
        </div>

        <div
          className="bsp-resize"
          onPointerDown={onResizeStart}
          title={t('branchSwitch.resize')}
          aria-hidden="true"
        />
      </div>
    </div>
  );
}
