/*
 * M2_GIT_DIFF
 * Copyright (c) 2026 OA Hsiao
 * SPDX-License-Identifier: MIT
 *
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */
'use strict';

// Lightweight self-updater built directly on the GitHub Releases API — no
// electron-updater / latest.yml dependency. The flow the main process exposes
// over IPC is: check -> download the NSIS installer for this arch -> run it (the
// app quits so the installer can replace the exe) -> the leftover download is
// swept on the next launch (a running installer keeps the file locked on
// Windows, so cleanup can't happen mid-install). Downloads live in a dedicated
// `updates/` folder under userData so the sweep is a simple, safe directory
// wipe. Every network fetch pins HTTPS + the expected github.com release path,
// and the installer is verified against the asset's sha256 digest when GitHub
// provides one.

const { app, net } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

// Owner/repo the releases are published under. Read from package.json's
// `repository.url` so it tracks the real remote, with a hard fallback.
function repoSlug() {
  try {
    const url = (require('../package.json').repository || {}).url || '';
    const m = url.match(/github\.com[/:]([^/]+)\/([^/.]+)/i);
    if (m) return { owner: m[1], repo: m[2] };
  } catch {
    /* fall through to the default */
  }
  return { owner: 'M2Station', repo: 'M2_GIT_DIFF' };
}

// Dedicated download folder under userData; wiped wholesale by cleanupUpdates().
function getUpdatesDir() {
  return path.join(app.getPath('userData'), 'updates');
}

// Parse "v1.2.3" / "1.2.3-beta" into [major, minor, patch]; pre-release/build
// suffixes are dropped (a tagged pre-release is treated as its base version).
function parseVer(v) {
  const parts = String(v || '')
    .trim()
    .replace(/^v/i, '')
    .split('-')[0]
    .split('.');
  return [Number(parts[0]) || 0, Number(parts[1]) || 0, Number(parts[2]) || 0];
}

// True when `latest` is a strictly higher version than `current`.
function isNewer(latest, current) {
  const a = parseVer(latest);
  const b = parseVer(current);
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return false;
}

// GET a URL and parse the JSON body via Electron's net (respects the system
// proxy and follows redirects). Rejects on a non-2xx status or invalid JSON.
function httpJson(url) {
  return new Promise((resolve, reject) => {
    const req = net.request({ url, method: 'GET', redirect: 'follow' });
    req.setHeader('User-Agent', 'M2_GIT_DIFF-Updater');
    req.setHeader('Accept', 'application/vnd.github+json');
    req.setHeader('X-GitHub-Api-Version', '2022-11-28');
    req.on('response', (res) => {
      const status = res.statusCode || 0;
      let data = '';
      res.on('data', (chunk) => {
        data += chunk.toString('utf8');
      });
      res.on('end', () => {
        if (status < 200 || status >= 300) {
          reject(new Error(`GitHub API returned HTTP ${status}`));
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error('Invalid JSON from GitHub'));
        }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

// Stream a URL to `destPath`, reporting progress and hashing the bytes. Uses
// pipe() for correct backpressure while a parallel data listener tracks the
// running total + sha256. Resolves { received, sha256 } once the file is flushed.
function httpDownload(url, destPath, expectedSize, onProgress) {
  return new Promise((resolve, reject) => {
    const req = net.request({ url, method: 'GET', redirect: 'follow' });
    req.setHeader('User-Agent', 'M2_GIT_DIFF-Updater');
    req.setHeader('Accept', 'application/octet-stream');
    req.on('response', (res) => {
      const status = res.statusCode || 0;
      if (status < 200 || status >= 300) {
        res.on('data', () => {});
        res.on('end', () => reject(new Error(`Download failed: HTTP ${status}`)));
        return;
      }
      const total = Number(res.headers['content-length']) || expectedSize || 0;
      let received = 0;
      const hash = crypto.createHash('sha256');
      const out = fs.createWriteStream(destPath);
      res.on('data', (chunk) => {
        received += chunk.length;
        hash.update(chunk);
        if (typeof onProgress === 'function') onProgress(received, total);
      });
      res.pipe(out);
      out.on('finish', () => resolve({ received, sha256: hash.digest('hex') }));
      out.on('error', (e) => reject(e));
      res.on('error', (e) => reject(e));
    });
    req.on('error', reject);
    req.end();
  });
}

// Pick the NSIS installer asset that matches this machine's architecture, from
// a release's `assets` array. Falls back to any .exe when no arch-specific
// build is found. Returns { name, url, size, digest } or null.
function pickAsset(assets) {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const exes = (assets || []).filter((a) => a && /\.exe$/i.test(a.name || ''));
  const match =
    exes.find((a) => new RegExp(`\\b${arch}\\b`, 'i').test(a.name)) || exes[0];
  if (!match) return null;
  return {
    name: match.name,
    url: match.browser_download_url,
    size: Number(match.size) || 0,
    // Newer GitHub API returns a "sha256:..." digest for verification.
    digest: typeof match.digest === 'string' ? match.digest : ''
  };
}

// Only ever download from an HTTPS github.com URL under this repo's release
// path. The subsequent redirect to GitHub's asset CDN is handled by net and
// stays on HTTPS.
function isTrustedAssetUrl(url, owner, repo) {
  try {
    const u = new URL(url);
    return (
      u.protocol === 'https:' &&
      u.hostname === 'github.com' &&
      u.pathname.startsWith(`/${owner}/${repo}/releases/download/`)
    );
  } catch {
    return false;
  }
}

// Query the latest published release and decide whether it is newer than the
// running build. Returns a plain object safe to hand to the renderer:
//   { hasUpdate, updateWithoutAsset, currentVersion, latestVersion, notes,
//     htmlUrl, publishedAt, asset }
// `hasUpdate` is true only when a newer release AND a matching installer asset
// exist; `updateWithoutAsset` flags a newer release whose installer isn't up yet
// (the renderer then offers the release page as a manual fallback).
async function checkForUpdate() {
  const currentVersion = app.getVersion();
  const { owner, repo } = repoSlug();
  const rel = await httpJson(
    `https://api.github.com/repos/${owner}/${repo}/releases/latest`
  );
  const latestVersion = String(rel.tag_name || '').replace(/^v/i, '');
  const newer = !!latestVersion && isNewer(latestVersion, currentVersion);
  const asset = newer ? pickAsset(rel.assets) : null;
  return {
    hasUpdate: !!(newer && asset),
    updateWithoutAsset: newer && !asset,
    currentVersion,
    latestVersion,
    notes: typeof rel.body === 'string' ? rel.body : '',
    htmlUrl: typeof rel.html_url === 'string' ? rel.html_url : '',
    publishedAt: rel.published_at || '',
    asset
  };
}

// Download the chosen installer into the updates folder, verifying its size and
// (when available) sha256 digest. Any previous download is swept first so the
// folder never accumulates. Returns { path, name }.
async function downloadUpdate(asset, onProgress) {
  const { owner, repo } = repoSlug();
  if (!asset || !isTrustedAssetUrl(asset.url, owner, repo)) {
    throw new Error('Untrusted or missing download URL');
  }
  if (!/\.exe$/i.test(asset.name || '')) {
    throw new Error('Unexpected installer type');
  }
  const dir = getUpdatesDir();
  cleanupUpdates(); // clear any prior/partial download first
  fs.mkdirSync(dir, { recursive: true });

  const safeName = path.basename(asset.name); // guard against path traversal
  const dest = path.join(dir, safeName);
  const part = dest + '.part';

  const { received, sha256 } = await httpDownload(
    asset.url,
    part,
    asset.size,
    onProgress
  );

  if (asset.size && received !== asset.size) {
    try {
      fs.unlinkSync(part);
    } catch {
      /* best-effort */
    }
    throw new Error('Downloaded size did not match the expected size');
  }
  if (typeof asset.digest === 'string' && asset.digest.toLowerCase().startsWith('sha256:')) {
    const want = asset.digest.slice('sha256:'.length).toLowerCase();
    if (want && want !== sha256.toLowerCase()) {
      try {
        fs.unlinkSync(part);
      } catch {
        /* best-effort */
      }
      throw new Error('Downloaded file failed its integrity check');
    }
  }

  fs.renameSync(part, dest);
  return { path: dest, name: safeName };
}

// Launch a downloaded installer, detached, so it can replace the running exe
// after the app quits. Hardened: only an .exe that actually lives in our
// updates folder is ever spawned, so the renderer can't coerce this into
// running an arbitrary file.
function installUpdate(filePath) {
  const resolved = path.resolve(String(filePath || ''));
  const dir = path.resolve(getUpdatesDir());
  if (path.dirname(resolved) !== dir || !/\.exe$/i.test(resolved)) {
    throw new Error('Refusing to run an unexpected file');
  }
  if (!fs.existsSync(resolved)) throw new Error('Installer not found');
  const { spawn } = require('node:child_process');
  const child = spawn(resolved, [], { detached: true, stdio: 'ignore' });
  child.unref();
}

// Delete any downloaded installers (and partial .part files) from the updates
// folder. Called on startup (a running installer locks its file on Windows, so
// the actual delete lands on the next launch) and again before a fresh
// download. Best-effort per file so one locked file doesn't block the rest.
function cleanupUpdates() {
  const dir = getUpdatesDir();
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return; // folder doesn't exist yet — nothing to clean
  }
  for (const name of entries) {
    if (!/\.(exe|part)$/i.test(name)) continue;
    try {
      fs.unlinkSync(path.join(dir, name));
    } catch {
      /* locked / in use — retry on a later launch */
    }
  }
}

module.exports = {
  checkForUpdate,
  downloadUpdate,
  installUpdate,
  cleanupUpdates,
  getUpdatesDir
};
