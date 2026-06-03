'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  loadRepo: (opts) => ipcRenderer.invoke('repo:load', opts),
  getPatchIds: (opts) => ipcRenderer.invoke('repo:patchIds', opts),
  gitOp: (opts) => ipcRenderer.invoke('repo:gitOp', opts),
  exportExcel: (opts) => ipcRenderer.invoke('excel:export', opts),
  getInitialRepos: () => ipcRenderer.invoke('app:getInitialRepos'),
  openInVSCodeChat: (opts) => ipcRenderer.invoke('vscode:chat', opts)
});
