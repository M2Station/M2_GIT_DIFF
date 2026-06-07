/*
 * M2_GIT_DIFF
 * Copyright (c) 2026 OA Hsiao
 * SPDX-License-Identifier: MIT
 *
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */
'use strict';

const { execFile } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

// Unit/record separators chosen to be extremely unlikely in commit messages.
const FIELD = '\x1f';
const RECORD = '\x1e';

const LOG_FORMAT = [
  '%H', // full sha
  '%h', // short sha
  '%P', // parent shas (space separated)
  '%an', // author name
  '%ae', // author email
  '%ad', // author date (iso)
  '%cd', // commit date (iso)
  '%s', // subject / title
  '%b', // body
  '%D' // ref names (branches, tags, HEAD) — used to surface tags
].join(FIELD) + RECORD;

function run(args, cwd) {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      { cwd, maxBuffer: 1024 * 1024 * 256, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(stderr?.toString() || err.message));
          return;
        }
        resolve(stdout.toString());
      }
    );
  });
}

function isGitRepo(dir) {
  try {
    return fs.existsSync(path.join(dir, '.git'));
  } catch {
    return false;
  }
}

async function getCurrentBranch(cwd) {
  try {
    const out = await run(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
    return out.trim();
  } catch {
    return '(detached)';
  }
}

async function getHeadSha(cwd) {
  try {
    return (await run(['rev-parse', 'HEAD'], cwd)).trim();
  } catch {
    return '';
  }
}

// Best-effort fetch of the `origin` remote URL (falls back to the first remote
// found). Returns '' when the repo has no remote configured.
async function getRemoteUrl(cwd) {
  try {
    const out = (await run(['remote', 'get-url', 'origin'], cwd)).trim();
    if (out) return out;
  } catch {
    // origin missing — try any remote
  }
  try {
    const remotes = (await run(['remote'], cwd)).split(/\r?\n/).filter(Boolean);
    if (remotes.length) {
      return (await run(['remote', 'get-url', remotes[0]], cwd)).trim();
    }
  } catch {
    /* no remotes */
  }
  return '';
}

/**
 * Extract tag names from a `%D` ref-decoration string. Git renders tags as
 * `tag: <name>` entries in a comma-separated list that also holds branch and
 * HEAD pointers (e.g. `HEAD -> main, tag: v0.1.3, origin/main`). Only the
 * `tag:` entries are returned, with the prefix stripped.
 * @param {string} refs the `%D` field for a commit
 * @returns {string[]} tag names (empty when the commit has no tags)
 */
function parseTags(refs) {
  if (!refs) return [];
  return refs
    .split(',')
    .map((r) => r.trim())
    .filter((r) => r.startsWith('tag: '))
    .map((r) => r.slice(5).trim())
    .filter(Boolean);
}

/**
 * Parse `git log` output into structured commits.
 * @param {string} cwd repo path
 * @param {object} opts { limit, branch }
 */
async function getCommits(cwd, opts = {}) {
  if (!isGitRepo(cwd)) {
    throw new Error(`Not a git repository: ${cwd}`);
  }

  const limit = Number.isFinite(opts.limit) ? opts.limit : 2000;
  const args = ['log', `--pretty=format:${LOG_FORMAT}`, '--date=iso-strict'];
  if (limit > 0) args.push(`-n${limit}`);
  if (opts.branch) args.push(opts.branch);

  const out = await run(args, cwd);

  const commits = [];
  const records = out.split(RECORD);
  for (const rec of records) {
    const trimmed = rec.replace(/^\n+/, '');
    if (!trimmed) continue;
    const f = trimmed.split(FIELD);
    if (f.length < 9) continue;
    commits.push({
      sha: f[0],
      short: f[1],
      parents: f[2] ? f[2].split(' ').filter(Boolean) : [],
      author: f[3],
      authorEmail: f[4],
      authorDate: f[5],
      commitDate: f[6],
      subject: f[7],
      body: f[8] ? f[8].trim() : '',
      tags: parseTags(f[9])
    });
  }
  return commits;
}

/**
 * Compute a git patch-id for each commit so cherry-picks can be matched even
 * when subjects were edited. Returns a Map<sha, patchId>. Best-effort: on any
 * failure returns an empty map (callers fall back to subject matching).
 */
async function getPatchIds(cwd, shas) {
  const map = new Map();
  if (!shas || shas.length === 0) return map;
  try {
    // Pipe the diffs of every requested commit through a single
    // `git patch-id --stable`. Each output line is "<patchId> <commitSha>",
    // so the mapping stays correct regardless of order. This keeps the whole
    // request to two git invocations instead of two per commit.
    const patch = await run(['show', '--no-color', ...shas], cwd);
    const idOut = await new Promise((resolve) => {
      const cp = execFile(
        'git',
        ['patch-id', '--stable'],
        { cwd, maxBuffer: 1024 * 1024 * 256, windowsHide: true },
        (e, stdout) => resolve(e ? '' : stdout.toString())
      );
      cp.stdin.end(patch);
    });
    for (const line of idOut.split('\n')) {
      const [patchId, sha] = line.trim().split(/\s+/);
      if (patchId && sha) map.set(sha, patchId);
    }
  } catch {
    return new Map();
  }
  return map;
}

/**
 * Fetch the changed-line content of each commit's diff so the renderer can do
 * content-similarity ("fuzzy") matching. Returns a Map<sha, string[]> where the
 * array holds the deduped, normalized added/removed lines (the actual edits,
 * not diff metadata). Best-effort: returns an empty map on failure.
 *
 * Implementation: a single `git show` over all requested shas, using a NUL
 * separator format so each commit's diff block is delimited unambiguously,
 * keeping the whole request to one git invocation.
 */
async function getDiffTexts(cwd, shas) {
  const map = new Map();
  if (!shas || shas.length === 0) return map;
  try {
    // tformat:%x00%H%x00 prints  NUL <sha> NUL  before each commit's diff.
    const out = await run(
      ['show', '--no-color', '--format=tformat:%x00%H%x00', ...shas],
      cwd
    );
    // Split on NUL -> ['', sha1, diff1, sha2, diff2, ...].
    const parts = out.split('\0');
    for (let i = 1; i + 1 < parts.length; i += 2) {
      const sha = parts[i].trim();
      const body = parts[i + 1] || '';
      if (!sha) continue;
      const seen = new Set();
      const lines = [];
      for (const raw of body.split('\n')) {
        // Keep only added/removed content lines; skip the +++/--- file headers.
        if (raw.length < 2) continue;
        const c = raw[0];
        if (c !== '+' && c !== '-') continue;
        if (raw.startsWith('+++') || raw.startsWith('---')) continue;
        const text = raw.slice(1).trim();
        if (text.length < 2) continue; // ignore lone braces / trivial lines
        const key = c + text; // keep +/- sign so an add vs delete differ
        if (seen.has(key)) continue;
        seen.add(key);
        lines.push(key);
        if (lines.length >= 4000) break; // cap payload for huge commits
      }
      if (lines.length) map.set(sha, lines);
    }
  } catch {
    return new Map();
  }
  return map;
}

/**
 * Fetch the full, human-readable unified diff a single commit introduced (its
 * change vs. its first parent) so the renderer can show a side-by-side, line-by
 * -line view. Unlike getDiffTexts — which dedups and strips context lines for
 * fuzzy scoring — this preserves file headers, hunk headers, context lines and
 * the +/- markers needed for a readable patch.
 *
 * Returns the raw `git show` patch text (starting at the first `diff --git`).
 * The commit-message header is dropped because the renderer already has that
 * metadata from the loaded commit row. Best-effort: returns '' on failure or
 * for commits with no diff (e.g. an empty/merge commit).
 *
 * @param {string} cwd repo path
 * @param {string} sha full or abbreviated commit sha
 * @returns {Promise<string>} unified diff text
 */
async function getCommitDiff(cwd, sha) {
  const id = String(sha || '').trim();
  // Validate to a bare hex object name so the renderer can never inject git
  // options or extra path arguments.
  if (!/^[0-9a-fA-F]{4,64}$/.test(id)) {
    throw new Error(`Invalid commit sha: ${sha}`);
  }
  if (!isGitRepo(cwd)) throw new Error(`Not a git repository: ${cwd}`);
  try {
    // --first-parent keeps merge commits to the mainline change; -m would
    // explode them into per-parent diffs. --format= drops the commit header so
    // only the patch body remains.
    const out = await run(
      ['show', '--no-color', '--first-parent', '--format=', id],
      cwd
    );
    const start = out.indexOf('diff --git');
    return start === -1 ? '' : out.slice(start);
  } catch {
    return '';
  }
}

async function loadRepo(cwd, opts = {}) {
  const [branch, head, commits, remoteUrl] = await Promise.all([
    getCurrentBranch(cwd),
    getHeadSha(cwd),
    getCommits(cwd, opts),
    getRemoteUrl(cwd)
  ]);
  return {
    path: cwd,
    name: path.basename(cwd),
    branch,
    head,
    remoteUrl,
    commits
  };
}

/**
 * List local and remote-tracking branches for a repo. Remote `HEAD` pointers
 * (e.g. `origin/HEAD`) are dropped. Returns the current branch plus the two
 * sorted name lists so the renderer can render a tree.
 * @param {string} cwd repo path
 * @returns {Promise<{current:string, local:string[], remote:string[]}>}
 */
async function listBranches(cwd) {
  if (!isGitRepo(cwd)) throw new Error(`Not a git repository: ${cwd}`);
  const current = await getCurrentBranch(cwd);
  const [localOut, remoteOut] = await Promise.all([
    run(['for-each-ref', '--sort=refname', '--format=%(refname:short)', 'refs/heads'], cwd),
    run(['for-each-ref', '--sort=refname', '--format=%(refname:short)', 'refs/remotes'], cwd)
  ]);
  const clean = (s) => s.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  const local = clean(localOut);
  const remote = clean(remoteOut).filter((n) => !/\/HEAD$/.test(n));
  return { current, local, remote };
}

// Run a git command capturing both stdout and stderr into a single transcript,
// resolving to the same shape the renderer's git-terminal popup consumes.
function runCombined(args, cwd) {
  const command = 'git ' + args.join(' ');
  return new Promise((resolve) => {
    execFile(
      'git',
      args,
      { cwd, maxBuffer: 1024 * 1024 * 256, windowsHide: true },
      (err, stdout, stderr) => {
        const out = [stdout?.toString() || '', stderr?.toString() || '']
          .filter(Boolean)
          .join('\n')
          .trim();
        resolve({
          ok: !err,
          command,
          output: out || (err ? err.message : ''),
          exitCode: err && typeof err.code === 'number' ? err.code : err ? 1 : 0
        });
      }
    );
  });
}

/**
 * Switch the working tree to another branch. For a remote-tracking ref like
 * `origin/feature`, the remote prefix is stripped and `git switch <name>` lets
 * git's DWIM create/checkout the matching local tracking branch. The branch
 * name is validated to contain no option-like or shell-meaningful characters
 * so the renderer can never inject arbitrary git arguments.
 * @param {string} cwd repo path
 * @param {string} branch branch ref (local short name or `remote/name`)
 * @param {boolean} isRemote whether `branch` is a remote-tracking ref
 */
async function switchBranch(cwd, branch, isRemote = false) {
  if (!isGitRepo(cwd)) throw new Error(`Not a git repository: ${cwd}`);
  const name = String(branch || '').trim();
  if (!name || name.startsWith('-') || /[\s~^:?*\[\\]/.test(name)) {
    throw new Error(`Invalid branch name: ${branch}`);
  }
  // For a remote ref strip the first path segment (the remote name) so DWIM
  // checks out the local tracking branch instead of a detached HEAD.
  const target = isRemote ? name.replace(/^[^/]+\//, '') : name;
  if (!target) throw new Error(`Invalid branch name: ${branch}`);
  return runCombined(['switch', target], cwd);
}

// Whitelisted git operations the per-repo toolbar can trigger. Each maps to a
// fixed argument list so the renderer can never inject arbitrary git commands.
const GIT_OPS = {
  fetch: ['fetch', '--all', '--prune'],
  pull: ['pull', '--ff-only']
};

/**
 * Run a whitelisted git operation in a repo.
 * @param {string} cwd repo path
 * @param {keyof typeof GIT_OPS} op
 * @returns {Promise<{ok:boolean, output:string}>}
 */
async function gitOp(cwd, op) {
  const args = GIT_OPS[op];
  if (!args) throw new Error(`Unsupported git operation: ${op}`);
  if (!isGitRepo(cwd)) throw new Error(`Not a git repository: ${cwd}`);
  // Capture both stdout and stderr (git writes progress/summary to stderr even
  // on success) so the UI can show the full terminal transcript either way.
  const command = 'git ' + args.join(' ');
  return new Promise((resolve) => {
    execFile(
      'git',
      args,
      { cwd, maxBuffer: 1024 * 1024 * 256, windowsHide: true },
      (err, stdout, stderr) => {
        const out = [stdout?.toString() || '', stderr?.toString() || '']
          .filter(Boolean)
          .join('\n')
          .trim();
        resolve({
          ok: !err,
          command,
          output: out || (err ? err.message : ''),
          exitCode: err && typeof err.code === 'number' ? err.code : err ? 1 : 0
        });
      }
    );
  });
}

module.exports = {
  isGitRepo,
  getCurrentBranch,
  getCommits,
  getPatchIds,
  getDiffTexts,
  getCommitDiff,
  loadRepo,
  gitOp,
  listBranches,
  switchBranch
};
