'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  loadRepo: (opts) => ipcRenderer.invoke('repo:load', opts),
  getPatchIds: (opts) => ipcRenderer.invoke('repo:patchIds', opts),
  gitOp: (opts) => ipcRenderer.invoke('repo:gitOp', opts),
  getInitialRepos: () => ipcRenderer.invoke('app:getInitialRepos')
});
