/*
 * M2_GIT_DIFF
 * Copyright (c) 2026 OA Hsiao
 * SPDX-License-Identifier: MIT
 *
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  pickFolder: (opts) => ipcRenderer.invoke('dialog:pickFolder', opts),
  listDir: (path) => ipcRenderer.invoke('dialog:listDir', { path }),
  rememberDir: (path) => ipcRenderer.invoke('dialog:rememberDir', { path }),
  recordRepoOpen: (repoPath) => ipcRenderer.invoke('picker:recordOpen', { repoPath }),
  pickerTopParents: (n) => ipcRenderer.invoke('picker:topParents', { n }),
  pickerRecentRepos: (n) => ipcRenderer.invoke('picker:recentRepos', { n }),
  loadRepo: (opts) => ipcRenderer.invoke('repo:load', opts),
  loadMore: (opts) => ipcRenderer.invoke('repo:loadMore', opts),
  getPatchIds: (opts) => ipcRenderer.invoke('repo:patchIds', opts),
  getDiffTexts: (opts) => ipcRenderer.invoke('repo:diffTexts', opts),
  getCommitDiff: (opts) => ipcRenderer.invoke('repo:commitDiff', opts),
  gitOp: (opts) => ipcRenderer.invoke('repo:gitOp', opts),
  listBranches: (opts) => ipcRenderer.invoke('repo:listBranches', opts),
  switchBranch: (opts) => ipcRenderer.invoke('repo:switchBranch', opts),
  updateAllBranches: (opts) => ipcRenderer.invoke('repo:updateAllBranches', opts),
  addWorktree: (opts) => ipcRenderer.invoke('repo:addWorktree', opts),
  createMirror: (opts) => ipcRenderer.invoke('repo:createMirror', opts),
  updateWorktreeSubmodules: (opts) => ipcRenderer.invoke('repo:updateWorktreeSubmodules', opts),
  mergeWorktreeMain: (opts) => ipcRenderer.invoke('repo:mergeWorktreeMain', opts),
  exportCommitPatch: (opts) => ipcRenderer.invoke('commit:exportPatch', opts),
  pickPatch: () => ipcRenderer.invoke('patch:pick'),
  inspectPatch: (opts) => ipcRenderer.invoke('patch:inspect', opts),
  applyPatch: (opts) => ipcRenderer.invoke('patch:apply', opts),
  buildSubmoduleMirrorCache: (opts) => ipcRenderer.invoke('repo:buildSubmoduleMirrorCache', opts),
  onGitProgress: (cb) => {
    const listener = (_e, payload) => { try { cb(payload); } catch { /* ignore */ } };
    ipcRenderer.on('repo:gitProgress', listener);
    return () => ipcRenderer.removeListener('repo:gitProgress', listener);
  },
  listWorktrees: (opts) => ipcRenderer.invoke('repo:listWorktrees', opts),
  removeWorktree: (opts) => ipcRenderer.invoke('repo:removeWorktree', opts),
  pruneWorktrees: (opts) => ipcRenderer.invoke('repo:pruneWorktrees', opts),
  exportExcel: (opts) => ipcRenderer.invoke('excel:export', opts),
  exportMarkdown: (opts) => ipcRenderer.invoke('markdown:export', opts),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  openPath: (path) => ipcRenderer.invoke('shell:openPath', path),
  openTaskManager: () => ipcRenderer.invoke('shell:openTaskManager'),
  getInitialRepos: () => ipcRenderer.invoke('app:getInitialRepos'),
  setStartupBg: (color) => ipcRenderer.invoke('app:setStartupBg', color),
  openInVSCodeChat: (opts) => ipcRenderer.invoke('vscode:chat', opts)
});
