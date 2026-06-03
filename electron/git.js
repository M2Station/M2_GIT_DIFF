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

async function loadRepo(cwd, opts = {}) {
  const [branch, head, commits] = await Promise.all([
    getCurrentBranch(cwd),
    getHeadSha(cwd),
    getCommits(cwd, opts)
  ]);
  return {
    path: cwd,
    name: path.basename(cwd),
    branch,
    head,
    commits
  };
}

module.exports = {
  isGitRepo,
  getCurrentBranch,
  getCommits,
  getPatchIds,
  loadRepo
};
