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

// Handy git commands shown in the "Git commands" quick-copy panel. Clicking a
// row copies the exact command to the clipboard so it can be pasted into a
// terminal opened at the repo/worktree folder. Descriptions are localised via
// branchMap.cmd.<id>; the commands themselves are literal and never translated.
const GIT_SNIPPETS = [
  { id: 'subUpdate', cmd: 'git submodule update --init --recursive --progress --jobs 8' },
  { id: 'subUpdateForce', cmd: 'git submodule update --init --recursive --force --progress' },
  { id: 'subSync', cmd: 'git submodule sync --recursive' },
  { id: 'subStatus', cmd: 'git submodule status --recursive' },
  { id: 'status', cmd: 'git status' },
  { id: 'fetch', cmd: 'git fetch --all --prune' },
  { id: 'pullRebase', cmd: 'git pull --rebase' },
  { id: 'mergeMain', cmd: 'git merge main' },
  { id: 'log', cmd: 'git log --oneline --graph --decorate -20' },
  { id: 'branchVV', cmd: 'git branch -vv' },
  { id: 'resetHard', cmd: 'git reset --hard HEAD' },
  { id: 'clean', cmd: 'git clean -xfd' }
];

// Floating, draggable/resizable modal that maps every branch (local + each
// remote) as a collapsible tree with a live search filter. The footer "Update"
// button fetches from origin and fast-forwards every tracking branch; the result
// transcript is shown inline so the tree can refresh in place. Closes on the ✕,
// the backdrop, the Close button, or Escape.
export default function WorktreePopup({ side, repoName, data, worktrees = [], mirrorCache = '', busy, result, progress, onUpdate, onRefresh, onSwitch, onWorktree, onRemoveWorktree, onRenameWorktree, onOpenFolder, onOpenGitDir, onOpenMirrorFolder, onUpdateMirror, onOpenTaskManager, onFocusProcess, onEndProcess, onOpenMirror, onUpdateSubmodules, onMergeMain, onSwitchWorktreeBranch, onClose }) {
  const t = useT();
  const { current, local = [], remote = [] } = data || {};
  const [expanded, setExpanded] = useState(() => new Set());
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState(null);
  // Path of the worktree awaiting a delete confirmation (null when none).
  const [confirmPath, setConfirmPath] = useState(null);
  // Path of the worktree currently being removed, for the inline progress cue.
  const [removingPath, setRemovingPath] = useState(null);
  // Inline "name a branch here" editor for a detached-HEAD worktree row.
  const [branchEditPath, setBranchEditPath] = useState(null);
  const [branchName, setBranchName] = useState('');
  const confirmSetBranch = useCallback((wtPath) => {
    const nm = branchName.trim();
    if (!nm) return;
    onSwitchWorktreeBranch(wtPath, nm);
    setBranchEditPath(null);
    setBranchName('');
  }, [branchName, onSwitchWorktreeBranch]);
  const cancelSetBranch = useCallback(() => {
    setBranchEditPath(null);
    setBranchName('');
  }, []);
  // Inline "rename this worktree's folder" editor (git worktree move). Holds the
  // path of the row being renamed and the new leaf name typed into the input.
  const [renamePath, setRenamePath] = useState(null);
  const [renameName, setRenameName] = useState('');
  const startRename = useCallback((wtPath) => {
    const leaf = String(wtPath || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || '';
    setRenamePath(wtPath);
    setRenameName(leaf);
  }, []);
  const confirmRename = useCallback((wtPath) => {
    const nm = renameName.trim();
    if (!nm) return;
    onRenameWorktree(wtPath, nm);
    setRenamePath(null);
    setRenameName('');
  }, [renameName, onRenameWorktree]);
  const cancelRename = useCallback(() => {
    setRenamePath(null);
    setRenameName('');
  }, []);
  // PID of the locking process awaiting an "end task" confirmation (null = none).
  const [endConfirmPid, setEndConfirmPid] = useState(null);
  const searchRef = useRef(null);
  // Keep the live progress pane pinned to the newest output.
  const progressRef = useRef(null);
  useEffect(() => {
    const el = progressRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [progress]);

  // The transcript currently shown (live progress while busy, else the result).
  const logText = busy
    ? normalizeProgress(progress || '')
    : result?.output
      ? normalizeProgress(result.output)
      : '';

  const [copied, setCopied] = useState(false);
  // Collapse the transcript pane without losing it — toggles the <pre> below.
  const [logHidden, setLogHidden] = useState(false);
  const copyLog = useCallback((text) => {
    try {
      navigator.clipboard?.writeText(text || '');
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable */
    }
  }, []);

  // Quick-copy "Git commands" panel: whether it's open, and which snippet was
  // last copied (drives the transient "Copied" cue on that row).
  const [showCmds, setShowCmds] = useState(false);
  const [copiedCmd, setCopiedCmd] = useState('');
  const copyCmd = useCallback((cmd) => {
    try {
      navigator.clipboard?.writeText(cmd || '');
      setCopiedCmd(cmd);
      setTimeout(() => setCopiedCmd(''), 1200);
    } catch {
      /* clipboard unavailable */
    }
  }, []);

  // Independent floating geometry for the Git-commands panel so it can be
  // dragged (by its header) and resized (bottom-right grip) separately from the
  // branch-map window. Positioned relative to the viewport, so it is not clipped
  // by the branch-map window bounds.
  const CW0 = 560;
  const CH0 = Math.min(Math.round(window.innerHeight * 0.6), 520);
  const [cmdsPos, setCmdsPos] = useState(() => ({
    x: Math.max(12, Math.round((window.innerWidth - CW0) / 2)),
    y: Math.max(24, Math.round(window.innerHeight * 0.14))
  }));
  const [cmdsSize, setCmdsSize] = useState(() => ({ w: CW0, h: CH0 }));
  const cmdsDragRef = useRef(null);
  const cmdsResizeRef = useRef(null);

  // Clear the per-row "removing" cue once the operation settles.
  useEffect(() => {
    if (!busy) setRemovingPath(null);
  }, [busy]);

  // Floating-window geometry: position + size, initialised near the top-centre.
  // The header drags the window and the bottom-right grip resizes it; both clamp
  // to the viewport so the window can never be dragged fully off-screen.
  const W0 = 720;
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

  const onCmdsDragStart = useCallback(
    (e) => {
      if (e.target.closest('button')) return;
      e.preventDefault();
      cmdsDragRef.current = { sx: e.clientX, sy: e.clientY, bx: cmdsPos.x, by: cmdsPos.y };
      const onMove = (ev) => {
        const d = cmdsDragRef.current;
        if (!d) return;
        const nx = d.bx + (ev.clientX - d.sx);
        const ny = d.by + (ev.clientY - d.sy);
        setCmdsPos({
          x: Math.min(Math.max(-cmdsSize.w + 80, nx), window.innerWidth - 60),
          y: Math.min(Math.max(0, ny), window.innerHeight - 40)
        });
      };
      const onUp = () => {
        cmdsDragRef.current = null;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [cmdsPos.x, cmdsPos.y, cmdsSize.w]
  );

  const onCmdsResizeStart = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      cmdsResizeRef.current = { sx: e.clientX, sy: e.clientY, bw: cmdsSize.w, bh: cmdsSize.h };
      const onMove = (ev) => {
        const r = cmdsResizeRef.current;
        if (!r) return;
        const nw = r.bw + (ev.clientX - r.sx);
        const nh = r.bh + (ev.clientY - r.sy);
        setCmdsSize({
          w: Math.min(Math.max(320, nw), window.innerWidth - cmdsPos.x - 12),
          h: Math.min(Math.max(240, nh), window.innerHeight - cmdsPos.y - 12)
        });
      };
      const onUp = () => {
        cmdsResizeRef.current = null;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [cmdsSize.w, cmdsSize.h, cmdsPos.x, cmdsPos.y]
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
        if (showCmds) setShowCmds(false);
        else if (!busy) onClose();
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
  }, [onClose, busy, showCmds]);

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
          <span className="bsp-subhead-right">
            <span className="bsp-count">
              {q
                ? t('branchMap.countFiltered', { shown, count: total })
                : t('branchMap.count', { count: total })}
            </span>
            <button
              type="button"
              className={'bsp-cmds-btn' + (showCmds ? ' active' : '')}
              onClick={() => setShowCmds((v) => !v)}
              title={t('branchMap.gitCmdsTitle')}
              aria-expanded={showCmds}
            >
              {t('branchMap.gitCmds')}
            </button>
          </span>
        </div>

        {showCmds && (
          <div className="bsp-cmds-backdrop" onMouseDown={() => setShowCmds(false)}>
            <div
              className="bsp-cmds"
              style={{ left: cmdsPos.x, top: cmdsPos.y, width: cmdsSize.w, height: cmdsSize.h }}
              onMouseDown={(e) => e.stopPropagation()}
              role="dialog"
              aria-label={t('branchMap.gitCmdsTitle')}
            >
              <div className="bsp-cmds-head" onPointerDown={onCmdsDragStart}>
                <span className="bsp-cmds-title">{t('branchMap.gitCmdsTitle')}</span>
                <button
                  type="button"
                  className="bsp-cmds-x"
                  onClick={() => setShowCmds(false)}
                  title={t('common.close')}
                  aria-label={t('common.close')}
                >
                  ✕
                </button>
              </div>
              <div className="bsp-cmds-hint">{t('branchMap.gitCmdsHint')}</div>
              <div className="bsp-cmds-list">
                {GIT_SNIPPETS.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className={'bsp-cmd-row' + (copiedCmd === s.cmd ? ' copied' : '')}
                    onClick={() => copyCmd(s.cmd)}
                    title={t('branchMap.cmdTip.' + s.id)}
                  >
                    <span className="bsp-cmd-desc">{t('branchMap.cmd.' + s.id)}</span>
                    <code className="bsp-cmd-code">{s.cmd}</code>
                    <span className="bsp-cmd-flag">
                      {copiedCmd === s.cmd ? t('branchMap.copied') : '📋'}
                    </span>
                  </button>
                ))}
              </div>
              <div
                className="bsp-cmds-resize"
                onPointerDown={onCmdsResizeStart}
                title={t('branchMap.resize')}
                aria-hidden="true"
              />
            </div>
          </div>
        )}

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
              const renaming = renamePath === w.path;
              return (
                <div className={'bmp-wt-row' + (locked ? ' locked' : '') + (w.prunable ? ' missing' : '')} key={w.path}>
                  <span className="bmp-wt-icon">{w.isMain ? '\uD83C\uDF34' : '\uD83C\uDF3F'}</span>
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
                  ) : renaming ? (
                    <span className="bmp-wt-rename">
                      <input
                        type="text"
                        className="bmp-wt-branch-input"
                        value={renameName}
                        onChange={(e) => setRenameName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { e.preventDefault(); confirmRename(w.path); }
                          else if (e.key === 'Escape') { e.preventDefault(); cancelRename(); }
                        }}
                        placeholder={t('branchMap.renamePlaceholder')}
                        spellCheck={false}
                        autoFocus
                        disabled={busy}
                      />
                      <button
                        type="button"
                        className="bmp-wt-merge"
                        onClick={() => confirmRename(w.path)}
                        disabled={busy || !renameName.trim()}
                        title={t('branchMap.renameConfirmTitle')}
                      >
                        {t('branchMap.renameConfirm')}
                      </button>
                      <button
                        type="button"
                        className="bmp-wt-cancel"
                        onClick={cancelRename}
                        disabled={busy}
                        title={t('common.cancel')}
                        aria-label={t('common.cancel')}
                      >
                        ✕
                      </button>
                    </span>
                  ) : (
                    <span className="bmp-wt-actions">
                      {!w.isMain && w.linkSource && (
                        w.detached ? (
                          branchEditPath === w.path ? (
                            <span className="bmp-wt-setbranch">
                              <input
                                type="text"
                                className="bmp-wt-branch-input"
                                value={branchName}
                                onChange={(e) => setBranchName(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') { e.preventDefault(); confirmSetBranch(w.path); }
                                  else if (e.key === 'Escape') { e.preventDefault(); cancelSetBranch(); }
                                }}
                                placeholder={t('branchMap.setBranchPlaceholder')}
                                spellCheck={false}
                                autoFocus
                                disabled={busy}
                              />
                              <button
                                type="button"
                                className="bmp-wt-merge"
                                onClick={() => confirmSetBranch(w.path)}
                                disabled={busy || !branchName.trim()}
                                title={t('branchMap.setBranchConfirmTitle')}
                              >
                                {t('branchMap.setBranchConfirm')}
                              </button>
                              <button
                                type="button"
                                className="bmp-wt-cancel"
                                onClick={cancelSetBranch}
                                disabled={busy}
                                title={t('common.cancel')}
                                aria-label={t('common.cancel')}
                              >
                                ✕
                              </button>
                            </span>
                          ) : (
                            <button
                              type="button"
                              className="bmp-wt-merge detached"
                              onClick={() => { setBranchEditPath(w.path); setBranchName(''); }}
                              disabled={busy || w.prunable}
                              title={t('branchMap.mergeMainDetachedTitle')}
                            >
                              {t('branchMap.detached')}
                            </button>
                          )
                        ) : (
                          <button
                            type="button"
                            className="bmp-wt-merge"
                            onClick={() => onMergeMain(w.path, w.linkSource)}
                            disabled={busy || w.prunable}
                            title={t('branchMap.mergeMainTitle', { source: w.linkSource })}
                          >
                            {t('branchMap.mergeMainShort', { source: w.linkSource })}
                          </button>
                        )
                      )}
                      {!w.isMain && (
                        <button
                          type="button"
                          className="bmp-wt-sync"
                          onClick={() => onUpdateSubmodules(w.path)}
                          disabled={busy || w.prunable}
                          title={t('branchMap.updateSubmodulesTitle')}
                        >
                          {t('branchMap.updateSubmodulesShort')}
                        </button>
                      )}
                      {w.isMain && mirrorCache && (
                        <button
                          type="button"
                          className="bmp-wt-sync"
                          onClick={() => onUpdateMirror()}
                          disabled={busy}
                          title={t('branchMap.updateMirrorTitle', { path: mirrorCache })}
                        >
                          {t('branchMap.updateMirrorShort')}
                        </button>
                      )}
                      {w.isMain && mirrorCache && (
                        <button
                          type="button"
                          className="bmp-wt-open"
                          onClick={() => onOpenMirrorFolder(mirrorCache)}
                          title={t('branchMap.openMirrorFolderTitle', { path: mirrorCache })}
                          aria-label={t('branchMap.openMirrorFolderTitle', { path: mirrorCache })}
                        >
                          <svg className="bmp-wt-svg" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false">
                            <path fill="currentColor" opacity="0.4" d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2Z" />
                            <path fill="currentColor" d="M3.3 20.2 5.9 12a2 2 0 0 1 1.9-1.4h13.4c.7 0 1.2.68 1 1.35L20.7 19a2.5 2.5 0 0 1-2.4 1.8H4a1 1 0 0 1-.7-.6Z" />
                          </svg>
                        </button>
                      )}
                      {w.isMain && w.gitDir && (
                        <button
                          type="button"
                          className="bmp-wt-open bmp-wt-gitdir"
                          onClick={() => onOpenGitDir(w.gitDir)}
                          title={t('branchMap.openGitDirTitle')}
                          aria-label={t('branchMap.openGitDirTitle')}
                        >
                          .git
                        </button>
                      )}
                      <button
                        type="button"
                        className="bmp-wt-open"
                        onClick={() => onOpenFolder(w.path)}
                        disabled={w.prunable}
                        title={t('branchMap.openFolderTitle')}
                        aria-label={t('branchMap.openFolderTitle')}
                      >
                        📂
                      </button>
                      {!w.isMain && (
                        <button
                          type="button"
                          className="bmp-wt-rename-btn"
                          onClick={() => startRename(w.path)}
                          disabled={busy || locked || w.prunable}
                          title={t('branchMap.renameTitle')}
                          aria-label={t('branchMap.renameTitle')}
                        >
                          ✏️
                        </button>
                      )}
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
          <div className={'bmp-result' + (!busy && result && result.ok === false ? ' fail' : '')}>
            <div className="bmp-result-sum">
              <span className="bmp-result-msg">
                {busy && <span className="bmp-spin" />}
                {busy
                  ? t('branchMap.working')
                  : result?.kind === 'remove'
                    ? result.ok === false
                      ? t('branchMap.removeFailed')
                      : t('branchMap.removeDone')
                    : result?.kind === 'mirror'
                      ? result.ok === false
                        ? t('branchMap.mirrorFailed')
                        : t('branchMap.mirrorDone', { count: result?.items?.length ?? 0, path: result?.cacheRoot || '' })
                      : result?.kind === 'mirrorUpdate'
                        ? result.ok === false
                          ? t('branchMap.mirrorUpdateFailed')
                          : t('branchMap.mirrorUpdateDone', {
                              updated: (result.items || []).filter((i) => i.ok !== false).length,
                              total: (result.items || []).length
                            })
                      : result?.kind === 'submodules'
                        ? result.ok === false
                          ? t('branchMap.submodulesFailed')
                          : t('branchMap.submodulesDone', {
                              mirror: (result.items || []).filter((i) => i.source === 'mirror').length,
                              cache: (result.items || []).filter((i) => i.source === 'local-cache').length,
                              network: (result.items || []).filter((i) => i.source === 'network').length,
                              total: (result.items || []).length
                            })
                        : result?.kind === 'merge'
                          ? result.ok === false
                            ? t('branchMap.mergeMainFailed')
                            : result.alreadyUpToDate
                              ? t('branchMap.mergeMainSame', { source: result.source || '' })
                              : t('branchMap.mergeMainDone', { source: result.source || '' })
                          : result?.kind === 'setbranch'
                            ? result.ok === false
                              ? t('branchMap.setBranchFailed')
                              : t('branchMap.setBranchDone', { branch: result.branch || '' })
                          : result?.kind === 'rename'
                            ? result.ok === false
                              ? t('branchMap.renameFailed')
                              : t('branchMap.renameDone')
                          : t('branchMap.updateDone', {
                              updated: result?.updated ?? 0,
                              skipped: result?.skipped ?? 0,
                              total: result?.total ?? 0
                            })}
              </span>
              {logText && (
                <button
                  type="button"
                  className="bmp-copy"
                  onClick={() => setLogHidden((h) => !h)}
                  title={t('branchMap.toggleConsoleTitle')}
                  aria-pressed={logHidden}
                >
                  {logHidden ? t('branchMap.showConsole') : t('branchMap.hideConsole')}
                </button>
              )}
              {logText && (
                <button
                  type="button"
                  className="bmp-copy"
                  onClick={() => copyLog(logText)}
                  title={t('branchMap.copyTitle')}
                >
                  {copied ? t('branchMap.copied') : t('branchMap.copyAll')}
                </button>
              )}
            </div>
            {logText && !logHidden && (
              <pre className="bmp-result-out bmp-log" ref={progressRef}>{logText}</pre>
            )}
            {!busy && result?.ok === false &&
              (result?.kind === 'remove' ||
                (result?.kind === 'rename' && (result?.locked || (Array.isArray(result.lockedBy) && result.lockedBy.length > 0)))) && (
              <div className="bmp-locked">
                {Array.isArray(result.lockedBy) && result.lockedBy.length ? (
                  <>
                    <div className="bmp-locked-head">{t('branchMap.lockedByHead')}</div>
                    <ul className="bmp-locked-list">
                      {result.lockedBy.map((p) => (
                        <li key={p.pid} className="bmp-locked-row">
                          <button
                            type="button"
                            className="bmp-locked-proc"
                            onClick={() => onFocusProcess?.(p.pid, p.name)}
                            disabled={!onFocusProcess}
                            title={t('branchMap.focusProcessTitle')}
                          >
                            <span className="bmp-locked-name">{p.name}</span>
                            <span className="bmp-locked-pid">PID {p.pid}</span>
                            <span className="bmp-locked-go" aria-hidden="true">↗</span>
                          </button>
                          {onEndProcess && (
                            endConfirmPid === p.pid ? (
                              <span className="bmp-locked-end-confirm">
                                <button type="button" className="btn ghost" onClick={() => setEndConfirmPid(null)}>
                                  {t('common.cancel')}
                                </button>
                                <button
                                  type="button"
                                  className="btn danger"
                                  onClick={() => { setEndConfirmPid(null); onEndProcess(p.pid, p.name); }}
                                  title={t('branchMap.endProcessConfirmTitle')}
                                >
                                  {t('branchMap.endProcessConfirm')}
                                </button>
                              </span>
                            ) : (
                              <button
                                type="button"
                                className="bmp-locked-end"
                                onClick={() => setEndConfirmPid(p.pid)}
                                title={t('branchMap.endProcessTitle')}
                              >
                                {t('branchMap.endProcess')}
                              </button>
                            )
                          )}
                        </li>
                      ))}
                    </ul>
                    <div className="bmp-locked-hint">{t('branchMap.lockedByHint')}</div>
                  </>
                ) : (
                  <div className="bmp-locked-hint">{t('branchMap.lockedUnknown')}</div>
                )}
                {onOpenTaskManager && (
                  <div className="bmp-locked-actions">
                    <button type="button" className="btn" onClick={onOpenTaskManager}>
                      {t('branchMap.openTaskManager')}
                    </button>
                  </div>
                )}
              </div>
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
              className="btn"
              onClick={onOpenMirror}
              disabled={busy}
              title={t('branchMap.createMirrorTitle')}
            >
              {t('branchMap.createMirror')}
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
