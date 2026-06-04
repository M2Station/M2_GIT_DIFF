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
  '%b' // body
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

// Upper bound on how many commit shas are fed to a single `git show`. Large
// repos can have thousands of unique commits; piping them all through one
// invocation risks brushing against the maxBuffer ceiling and spikes memory.
// Chunking keeps each invocation's output bounded and lets partial results
// survive even if one batch fails.
const SHOW_BATCH = 200;

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
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
      body: f[8] ? f[8].trim() : ''
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
  // Process the shas in bounded batches. Each batch pipes its diffs through a
  // single `git patch-id --stable`; output lines are "<patchId> <commitSha>",
  // so the mapping stays correct regardless of order. Batching caps the buffer
  // a single `git show` must hold and keeps partial results when a batch fails.
  for (const batch of chunk(shas, SHOW_BATCH)) {
    try {
      const patch = await run(['show', '--no-color', ...batch], cwd);
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
      // Skip this batch but keep results gathered from other batches.
    }
  }
  return map;
}

/**
 * Fetch the changed-line content of each commit's diff so the renderer can do
 * content-similarity ("fuzzy") matching. Returns a Map<sha, string[]> where the
 * array holds the deduped, normalized added/removed lines (the actual edits,
 * not diff metadata). Best-effort: returns an empty map on failure.
 *
 * Implementation: batched `git show` invocations over the requested shas,
 * using a NUL separator format so each commit's diff block is delimited
 * unambiguously. Batching bounds each invocation's output (memory) and lets
 * results from successful batches survive even if one batch fails.
 */
async function getDiffTexts(cwd, shas) {
  const map = new Map();
  if (!shas || shas.length === 0) return map;
  for (const batch of chunk(shas, SHOW_BATCH)) {
    try {
      // tformat:%x00%H%x00 prints  NUL <sha> NUL  before each commit's diff.
      const out = await run(
        ['show', '--no-color', '--format=tformat:%x00%H%x00', ...batch],
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
      // Skip this batch but keep results gathered from other batches.
    }
  }
  return map;
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
  loadRepo,
  gitOp
};
