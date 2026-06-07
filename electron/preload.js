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
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  listDir: (path) => ipcRenderer.invoke('dialog:listDir', { path }),
  rememberDir: (path) => ipcRenderer.invoke('dialog:rememberDir', { path }),
  recordRepoOpen: (repoPath) => ipcRenderer.invoke('picker:recordOpen', { repoPath }),
  pickerTopParents: (n) => ipcRenderer.invoke('picker:topParents', { n }),
  pickerRecentRepos: (n) => ipcRenderer.invoke('picker:recentRepos', { n }),
  loadRepo: (opts) => ipcRenderer.invoke('repo:load', opts),
  getPatchIds: (opts) => ipcRenderer.invoke('repo:patchIds', opts),
  getDiffTexts: (opts) => ipcRenderer.invoke('repo:diffTexts', opts),
  getCommitDiff: (opts) => ipcRenderer.invoke('repo:commitDiff', opts),
  gitOp: (opts) => ipcRenderer.invoke('repo:gitOp', opts),
  listBranches: (opts) => ipcRenderer.invoke('repo:listBranches', opts),
  switchBranch: (opts) => ipcRenderer.invoke('repo:switchBranch', opts),
  exportExcel: (opts) => ipcRenderer.invoke('excel:export', opts),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  getInitialRepos: () => ipcRenderer.invoke('app:getInitialRepos'),
  openInVSCodeChat: (opts) => ipcRenderer.invoke('vscode:chat', opts)
});
