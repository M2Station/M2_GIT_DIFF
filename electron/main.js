'use strict';

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('node:path');
const git = require('./git');
const db = require('./db');

const isDev = process.env.NODE_ENV === 'development';

const APP_NAME = 'M2_GIT_DIFF';

let mainWindow = null;

// Parse `-L <path>` / `-R <path>` (also --left / --right) from the launch
// argv so repros can be auto-opened. Relative paths resolve against the
// directory the app was launched from. Returns { left, right }.
function parseRepoArgs(argv) {
  const out = { left: null, right: null };
  // In dev the args follow the "." entry (electron . -L x -R y); in a packaged
  // build they follow the exe. Scanning the whole argv works for both.
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    let key = null;
    if (a === '-L' || a === '--left') key = 'left';
    else if (a === '-R' || a === '--right') key = 'right';
    else if (a.startsWith('--left=')) { out.left = a.slice(7); continue; }
    else if (a.startsWith('--right=')) { out.right = a.slice(8); continue; }
    if (key) {
      const val = argv[i + 1];
      if (val && !val.startsWith('-')) {
        out[key] = val;
        i++;
      }
    }
  }
  const resolve = (p) => (p ? path.resolve(process.cwd(), p) : null);
  // Fall back to env vars (REPRO_L / REPRO_R) when not given on argv. This is
  // how start.cmd forwards paths in dev mode, where argv can't reliably pass
  // through the concurrently -> wait-on -> electron chain.
  return {
    left: resolve(out.left ?? process.env.REPRO_L ?? null),
    right: resolve(out.right ?? process.env.REPRO_R ?? null)
  };
}

const initialRepos = parseRepoArgs(process.argv);

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

ipcMain.handle('app:getInitialRepos', () => initialRepos);

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

ipcMain.handle('repo:patchIds', async (_evt, payload) => {
  const { repoPath, shas } = payload || {};
  if (!repoPath || !Array.isArray(shas) || shas.length === 0) return {};
  if (!git.isGitRepo(repoPath)) return {};
  // git.getPatchIds returns a Map; convert to a plain object so it survives
  // IPC serialization.
  const map = await git.getPatchIds(repoPath, shas);
  return Object.fromEntries(map);
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
