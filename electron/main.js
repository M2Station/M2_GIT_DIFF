'use strict';

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('node:path');
const git = require('./git');
const db = require('./db');

const isDev = process.env.NODE_ENV === 'development';

const APP_NAME = 'M2_GIT_DIFF';

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0a0e14',
    title: APP_NAME,
    icon: path.join(__dirname, '..', 'public', 'icon.svg'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  app.setName(APP_NAME);
  if (process.platform === 'win32') app.setAppUserModelId('com.tool.gitreprodiff');
  db.init(app.getPath('userData'));
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---- IPC handlers ----

ipcMain.handle('dialog:pickFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select a local git repository'
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('repo:load', async (_evt, payload) => {
  const { repoPath, branch, limit } = payload || {};
  if (!repoPath) throw new Error('repoPath is required');

  if (!git.isGitRepo(repoPath)) {
    throw new Error(`Not a git repository: ${repoPath}`);
  }

  const lim = Number.isFinite(limit) ? limit : 2000;
  const head = await safeHead(repoPath);
  const key = db.cacheKey(repoPath, branch, lim);

  const cached = db.get(key, head);
  if (cached) {
    return { ...cached, cached: true };
  }

  const repo = await git.loadRepo(repoPath, { branch, limit: lim });
  db.set(key, repo.head, repo);
  return { ...repo, cached: false };
});

async function safeHead(repoPath) {
  try {
    const { execFileSync } = require('node:child_process');
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repoPath,
      windowsHide: true
    })
      .toString()
      .trim();
  } catch {
    return '';
  }
}
