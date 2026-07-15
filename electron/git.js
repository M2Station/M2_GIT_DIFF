/*
 * M2_GIT_DIFF
 * Copyright (c) 2026 OA Hsiao
 * SPDX-License-Identifier: MIT
 *
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */
'use strict';

const { execFile, spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const { findLockingProcesses } = require('./lockinfo');

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
/**
 * Read a window of commits from a repo.
 *
 * Supports paging via `opts.skip` (how many of the newest commits to skip) and
 * `opts.limit` (how many to return). To tell the renderer whether MORE history
 * exists beyond the window — so it can lazily page / backfill instead of hard
 * truncating — we request one extra row (`limit + 1`) and pop it back off,
 * surfacing its existence as `hasMore`.
 *
 * @param {string} cwd repo path
 * @param {{limit?:number, skip?:number, branch?:string}} opts
 * @returns {Promise<{commits:object[], hasMore:boolean}>}
 */
async function getCommits(cwd, opts = {}) {
  if (!isGitRepo(cwd)) {
    throw new Error(`Not a git repository: ${cwd}`);
  }

  const limit = Number.isFinite(opts.limit) ? opts.limit : 2000;
  const skip = Number.isFinite(opts.skip) && opts.skip > 0 ? Math.floor(opts.skip) : 0;
  // Optional date floor: load only commits newer than `since`. Used to ALIGN one
  // side down to the other side's oldest loaded date in a single request.
  const since = typeof opts.since === 'string' && opts.since ? opts.since : null;
  const args = ['log', `--pretty=format:${LOG_FORMAT}`, '--date=iso-strict'];
  // Pull one extra commit so we can detect (and then discard) "there is more".
  if (limit > 0) args.push(`-n${limit + 1}`);
  if (since) args.push(`--since=${since}`);
  if (skip > 0) args.push(`--skip=${skip}`);
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

  // The (limit + 1)-th row exists only to prove more history remains; trim it
  // so callers always get at most `limit` commits.
  let hasMore = false;
  if (limit > 0 && commits.length > limit) {
    hasMore = true;
    commits.length = limit;
  }

  // A `--since` (align) load hides everything older than the date floor, so the
  // `limit + 1` trick can't tell whether more history remains below it. Probe
  // for the next older commit (ignoring the date bound) so the renderer keeps
  // its "Load more" affordance after an alignment pull.
  if (since && !hasMore) {
    try {
      const probeArgs = ['log', `--skip=${skip + commits.length}`, '-n1', '--pretty=%H'];
      if (opts.branch) probeArgs.push(opts.branch);
      hasMore = (await run(probeArgs, cwd)).trim().length > 0;
    } catch {
      /* leave hasMore as-is if the probe fails */
    }
  }
  return { commits, hasMore };
}

/**
 * Page in the NEXT batch of older commits for a repo whose initial window was
 * truncated. Thin wrapper over getCommits that skips the rows the renderer
 * already holds. Returns the same `{ commits, hasMore }` shape.
 *
 * @param {string} cwd repo path
 * @param {{branch?:string, skip?:number, batch?:number, since?:string}} opts
 * @returns {Promise<{commits:object[], hasMore:boolean}>}
 */
function loadMoreCommits(cwd, opts = {}) {
  const skip = Number.isFinite(opts.skip) && opts.skip > 0 ? Math.floor(opts.skip) : 0;
  const batch = Number.isFinite(opts.batch) && opts.batch > 0 ? Math.floor(opts.batch) : 500;
  const since = typeof opts.since === 'string' && opts.since ? opts.since : null;
  // A date-bounded align load may need to pull far more than one page to catch
  // up to the other side's depth, so give it a high ceiling; plain paging keeps
  // the modest batch.
  const limit = since ? 5000 : batch;
  return getCommits(cwd, { branch: opts.branch || undefined, limit, skip, since });
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
  const [branch, head, page, remoteUrl] = await Promise.all([
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
    commits: page.commits,
    // True when the initial window was truncated and older commits remain,
    // so the renderer can page / backfill instead of treating it as the end.
    hasMore: page.hasMore
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
 * Like runCombined, but streams git's output live via `onData` as it arrives —
 * used for long operations (e.g. `clone --mirror`) so the UI can show progress.
 * stdout and stderr are merged in arrival order; git writes its progress meter
 * to stderr (needs `--progress` when not attached to a TTY). The full transcript
 * is still returned at the end, capped so a runaway process cannot exhaust memory.
 * @param {string[]} args git arguments
 * @param {string} cwd working directory
 * @param {(chunk:string)=>void} [onData] called with each output chunk
 * @returns {Promise<{ok:boolean, command:string, output:string, exitCode:number}>}
 */
function runStreaming(args, cwd, onData) {
  const command = 'git ' + args.join(' ');
  const MAX = 1024 * 1024; // keep at most ~1 MiB of transcript in memory
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn('git', args, { cwd, windowsHide: true });
    } catch (err) {
      const msg = (err && err.message) || String(err);
      try { onData && onData(msg); } catch { /* ignore */ }
      resolve({ ok: false, command, output: msg, exitCode: 1 });
      return;
    }
    let output = '';
    const onChunk = (chunk) => {
      const s = chunk.toString();
      output += s;
      if (output.length > MAX) output = output.slice(-MAX);
      try { onData && onData(s); } catch { /* ignore */ }
    };
    child.stdout.on('data', onChunk);
    child.stderr.on('data', onChunk);
    child.on('error', (err) => {
      const msg = (err && err.message) || String(err);
      output += (output ? '\n' : '') + msg;
      try { onData && onData(msg); } catch { /* ignore */ }
      resolve({ ok: false, command, output: output.trim(), exitCode: 1 });
    });
    child.on('close', (code) => {
      resolve({
        ok: code === 0,
        command,
        output: output.trim(),
        exitCode: typeof code === 'number' ? code : code ? 1 : 0
      });
    });
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

/**
 * Update every local branch from its `origin` upstream in one pass. First runs
 * `git fetch --all --prune` to refresh all remote-tracking refs, then fast-
 * forwards each local branch that has an upstream to match it:
 *   - the checked-out branch is advanced with `git merge --ff-only <upstream>`
 *     (HEAD's branch can only move via a merge/checkout, not a ref write);
 *   - every other branch is advanced with `git fetch . <upstream>:<branch>`,
 *     which refuses any non-fast-forward update so diverged branches stay intact.
 * Branches with no upstream (purely local / never pushed) are left untouched.
 * Returns a single combined transcript in the same shape the git-terminal popup
 * consumes, with a trailing summary of how many branches moved vs. were skipped.
 * @param {string} cwd repo path
 * @returns {Promise<{ok:boolean, command:string, output:string, exitCode:number, updated:number, skipped:number, total:number}>}
 */
async function updateAllBranches(cwd) {
  if (!isGitRepo(cwd)) throw new Error(`Not a git repository: ${cwd}`);
  const lines = [];

  // 1. Refresh every remote-tracking ref (origin/*) and prune deleted ones.
  const fetchRes = await runCombined(['fetch', '--all', '--prune'], cwd);
  lines.push('$ ' + fetchRes.command);
  if (fetchRes.output) lines.push(fetchRes.output);
  const fetchOk = fetchRes.ok;

  // 2. The checked-out branch can only be advanced with a merge, so single it out.
  const current = await getCurrentBranch(cwd);

  // 3. Enumerate local branches and their upstream tracking refs. Each line is
  //    "<branch>\t<upstream>" with the upstream empty when none is configured.
  let refOut = '';
  try {
    refOut = await run(
      ['for-each-ref', '--format=%(refname:short)%09%(upstream:short)', 'refs/heads'],
      cwd
    );
  } catch (e) {
    lines.push(String(e?.message || e));
    return {
      ok: false,
      command: 'git fetch --all --prune',
      output: lines.join('\n').trim(),
      exitCode: 1,
      updated: 0,
      skipped: 0,
      total: 0
    };
  }

  const branches = refOut
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [name, upstream] = l.split('\t');
      return { name: (name || '').trim(), upstream: (upstream || '').trim() };
    })
    .filter((b) => b.name);

  let updated = 0;
  let skipped = 0;
  lines.push('');
  for (const b of branches) {
    if (!b.upstream) {
      skipped++;
      lines.push(`- ${b.name}: no upstream, skipped`);
      continue;
    }
    let res;
    if (b.name === current) {
      // Advancing HEAD's branch needs a real (fast-forward-only) merge.
      res = await runCombined(['merge', '--ff-only', b.upstream], cwd);
    } else {
      // `fetch . src:dst` fast-forwards a non-checked-out branch and refuses any
      // non-fast-forward, so a diverged local branch is never rewritten.
      res = await runCombined(['fetch', '.', `${b.upstream}:${b.name}`], cwd);
    }
    if (res.ok) {
      updated++;
      lines.push(`\u2713 ${b.name} \u2190 ${b.upstream}`);
    } else {
      skipped++;
      lines.push(`- ${b.name} \u2190 ${b.upstream}: skipped (diverged / non-fast-forward)`);
    }
    if (res.output) lines.push('  ' + res.output.replace(/\n/g, '\n  '));
  }

  lines.push('');
  lines.push(`Done - ${updated} updated, ${skipped} skipped, ${branches.length} total.`);

  return {
    ok: fetchOk,
    command: 'git fetch --all --prune  +  fast-forward all tracking branches',
    output: lines.join('\n').trim(),
    exitCode: fetchOk ? 0 : 1,
    updated,
    skipped,
    total: branches.length
  };
}

// The fork source a worktree was created from is recorded in the MAIN repo's
// git config (shared by every worktree) rather than a per-worktree file, so the
// UI can offer a "merge source" action without leaving an untracked sidecar in
// the working tree. Each worktree gets its own subsection keyed by its folder
// name, e.g.:
//   [m2gitdiff "wtmain"]
//       source = origin/main
//       path = C:/repos/wtmain
//       createdAt = 2026-07-15T10:54:28.284Z
const WT_CONFIG_SECTION = 'm2gitdiff';

// Absolute path normalised to forward slashes + lower case, for stable matching
// between `git worktree list` paths and the paths stored in config.
function normPath(p) {
  try {
    return path.resolve(String(p || '')).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  } catch {
    return String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  }
}

// Record where a worktree was forked from in the main repo's config. Config is
// shared across worktrees, so writing from any worktree lands in the common
// `.git/config`. Best-effort: the record is a convenience, not critical.
async function writeWorktreeConfig(cwd, name, source, worktreePath) {
  const sub = String(name || '').trim();
  const src = String(source || '').trim();
  if (!sub || !src) return;
  const key = (k) => `${WT_CONFIG_SECTION}.${sub}.${k}`;
  const storedPath = path.resolve(String(worktreePath || '')).replace(/\\/g, '/');
  await runCombined(['config', key('source'), src], cwd);
  if (storedPath) await runCombined(['config', key('path'), storedPath], cwd);
  await runCombined(['config', key('createdAt'), new Date().toISOString()], cwd);
}

// Read every worktree record from the main repo's config into a map keyed by the
// subsection (worktree folder name): { source, path, createdAt }. `git config`
// reads the shared config from any worktree, so `cwd` may be any of them.
async function readWorktreeConfigMap(cwd) {
  const map = new Map();
  let out = '';
  try {
    const r = await runCombined(['config', '--get-regexp', `^${WT_CONFIG_SECTION}\\.`], cwd);
    if (r.ok) out = r.output || '';
  } catch { /* no records yet -> empty map */ }
  for (const line of out.split(/\r?\n/)) {
    const sp = line.indexOf(' ');
    if (sp < 0) continue;
    const rawKey = line.slice(0, sp);
    const value = line.slice(sp + 1);
    const firstDot = rawKey.indexOf('.');
    const lastDot = rawKey.lastIndexOf('.');
    // Need distinct first/last dots so a subsection actually exists (this also
    // skips single-dot keys like `m2gitdiff.mirrorCache`).
    if (firstDot < 0 || lastDot <= firstDot) continue;
    const sub = rawKey.slice(firstDot + 1, lastDot);
    const varName = rawKey.slice(lastDot + 1).toLowerCase();
    if (!sub) continue;
    const rec = map.get(sub) || {};
    if (varName === 'source') rec.source = value;
    else if (varName === 'path') rec.path = value;
    else if (varName === 'createdat') rec.createdAt = value;
    map.set(sub, rec);
  }
  return map;
}

// Best-effort removal of a worktree's config record when it is deleted. Matches
// the recorded `path` first, then falls back to the folder-name subsection.
async function removeWorktreeConfig(cwd, worktreePath) {
  try {
    const map = await readWorktreeConfigMap(cwd);
    const target = normPath(worktreePath);
    const base = path.basename(String(worktreePath || '').replace(/[\\/]+$/, ''));
    let sub = null;
    for (const [k, rec] of map) {
      if (rec.path && normPath(rec.path) === target) { sub = k; break; }
    }
    if (!sub && map.has(base)) sub = base;
    if (sub) await runCombined(['config', '--remove-section', `${WT_CONFIG_SECTION}.${sub}`], cwd);
  } catch { /* stale record is harmless */ }
}

// Read the configured submodule mirror-cache root for a repo (empty when unset).
async function getMirrorCache(cwd) {
  try {
    const c = await runCombined(['config', '--get', `${WT_CONFIG_SECTION}.mirrorCache`], cwd);
    if (c.ok && c.output.trim()) return c.output.trim();
  } catch { /* unset */ }
  return '';
}

// Summarise the repo's mirror-cache setting for the Mirror manager UI: the
// configured root, whether it exists on disk, and how many bare mirrors it
// currently holds (direct child folders with a HEAD file).
async function getMirrorCacheInfo(cwd) {
  const cacheRoot = await getMirrorCache(cwd);
  let exists = false;
  let mirrorCount = 0;
  if (cacheRoot) {
    try {
      if (fs.existsSync(cacheRoot)) {
        exists = true;
        const dirents = fs.readdirSync(cacheRoot, { withFileTypes: true }).filter((d) => d.isDirectory());
        for (const d of dirents) {
          if (fs.existsSync(path.join(cacheRoot, d.name, 'HEAD'))) mirrorCount++;
        }
      }
    } catch { /* unreadable -> report as not existing */ }
  }
  return { cacheRoot, exists, mirrorCount };
}

/**
 * Create a new git worktree checked out from a branch or commit. The target
 * folder is `<parentDir>/<name>` (git creates it; it must not already exist).
 * When `newBranch` is given a fresh branch is created there (`-b`); otherwise
 * `ref` is checked out as-is — a local branch is checked out, while a commit or
 * remote-tracking ref lands on a detached HEAD. Every user-supplied value is
 * validated so the renderer can never inject extra git arguments.
 * @param {string} cwd repo path
 * @param {{parentDir:string, name:string, ref:string, newBranch?:string}} opts
 * @returns {Promise<{ok:boolean, command:string, output:string, exitCode:number, target:string}>}
 */
async function addWorktree(cwd, opts = {}) {
  if (!isGitRepo(cwd)) throw new Error(`Not a git repository: ${cwd}`);
  const parentDir = String(opts.parentDir || '').trim();
  const name = String(opts.name || '').trim();
  const ref = String(opts.ref || '').trim();
  const newBranch = String(opts.newBranch || '').trim();

  if (!parentDir) throw new Error('A target directory is required');
  // The folder name becomes a single path segment, so reject separators,
  // traversal and Windows-reserved characters.
  if (!name || name === '.' || name === '..' || /[\\/:*?"<>|]/.test(name)) {
    throw new Error(`Invalid worktree folder name: ${name || '(empty)'}`);
  }
  // A ref may be a branch (slashes allowed) or a commit sha; block option-like
  // and shell/glob-meaningful characters, matching switchBranch's validation.
  if (!ref || ref.startsWith('-') || /[\s~^:?*\[\\]/.test(ref)) {
    throw new Error(`Invalid ref: ${ref || '(empty)'}`);
  }
  if (newBranch && (newBranch.startsWith('-') || /[\s~^:?*\[\\]/.test(newBranch))) {
    throw new Error(`Invalid new branch name: ${newBranch}`);
  }

  const target = path.join(parentDir, name);
  if (fs.existsSync(target)) throw new Error(`Target already exists: ${target}`);

  const args = ['worktree', 'add'];
  if (newBranch) args.push('-b', newBranch);
  args.push(target, ref);
  const res = await runCombined(args, cwd);
  // Record where this worktree was forked from (in the main repo's config) so
  // the UI can offer a "merge source" action. Best-effort: the record is a
  // convenience, not critical.
  if (res.ok !== false) {
    try {
      await writeWorktreeConfig(cwd, name, ref, target);
    } catch { /* ignore — the record is optional */ }
  }
  return { ...res, target };
}

/**
 * Create a local bare *mirror* clone of this repository at
 * `<parentDir>/<repo-name>.git` (`git clone --mirror`). A mirror is a full bare
 * copy that can act as a fast local reference/cache for future clones or
 * worktrees. The mirror name is derived from the repo folder, so the caller
 * only supplies the parent directory. The target must not already exist, and
 * `parentDir` is validated the same way as addWorktree so the renderer can
 * never inject extra git arguments.
 * @param {string} cwd repo path
 * @param {string} parentDir directory that will hold the mirror
 * @param {(chunk:string)=>void} [onData] optional live-progress callback
 * @returns {Promise<{ok:boolean, command:string, output:string, exitCode:number, target:string}>}
 */
async function createMirror(cwd, parentDir, onData) {
  if (!isGitRepo(cwd)) throw new Error(`Not a git repository: ${cwd}`);
  const dir = String(parentDir || '').trim();
  if (!dir) throw new Error('A target directory is required');

  const src = path.resolve(cwd);
  const base = path.basename(src.replace(/[\\/]+$/, '')) || 'repo';
  const mirrorName = /\.git$/i.test(base) ? base : `${base}.git`;
  const target = path.join(dir, mirrorName);
  if (fs.existsSync(target)) throw new Error(`Target already exists: ${target}`);

  const res = await runStreaming(['clone', '--mirror', '--progress', src, target], cwd, onData);
  return { ...res, target };
}

/**
 * Update a worktree's submodules using the parent (main) repo as a local cache.
 * Walks submodules recursively. For each one, if the main repo already holds
 * that submodule's object store, the clone borrows objects from it via
 * `--reference` (source 'local-cache') and only missing objects come from the
 * network; otherwise it clones from the configured URL (source 'network'). Every
 * submodule's source + URL is streamed to `onData` as a marker line so the UI
 * can show exactly where each submodule came from.
 * @param {string} worktreePath worktree to populate
 * @param {string} mainRepoPath parent repo used as the object cache
 * @param {(chunk:string)=>void} [onData] live progress callback
 * @returns {Promise<{ok:boolean, command:string, output:string, exitCode:number, items:Array}>}
 */
async function updateWorktreeSubmodules(worktreePath, mainRepoPath, onData) {
  if (!isGitRepo(worktreePath)) throw new Error(`Not a git repository: ${worktreePath}`);
  const main = path.resolve(String(mainRepoPath || '').trim());
  if (!main) throw new Error('A parent repo path is required');

  // Optional golden cache of per-submodule mirrors (see buildSubmoduleMirrorCache).
  let cacheRoot = null;
  try {
    const c = await runCombined(['config', '--get', 'm2gitdiff.mirrorCache'], main);
    if (c.ok && c.output.trim()) cacheRoot = c.output.trim();
  } catch { /* ignore */ }

  const items = [];
  let allText = '';
  const emit = (s) => { allText += s; try { if (onData) onData(s); } catch { /* ignore */ } };

  emit(`Updating submodules in ${worktreePath}\n`);
  emit(`Parent repo cache: ${main}\n`);
  if (cacheRoot) emit(`Mirror cache: ${cacheRoot}\n`);
  await gcUpdateSubsRec(worktreePath, main, cacheRoot, '', emit, items, 0);

  const failed = items.filter((i) => i.ok === false).length;
  const fromMirror = items.filter((i) => i.source === 'mirror').length;
  const fromCache = items.filter((i) => i.source === 'local-cache').length;
  const fromNet = items.filter((i) => i.source === 'network').length;
  emit(`\n${'-'.repeat(52)}\n`);
  emit(`Done - ${items.length} submodule(s): ${fromMirror} from mirror, ${fromCache} from repo cache, ${fromNet} from network, ${failed} failed.\n`);
  return {
    ok: failed === 0,
    command: 'git submodule update --init --recursive (cache-aware)',
    output: allText.trim(),
    exitCode: failed === 0 ? 0 : 1,
    items
  };
}

/**
 * Update a worktree from its recorded source ref: fetch the source branch from
 * origin (best-effort), then merge it into the branch checked out there
 * (`git merge --no-edit`). If the worktree already contains everything, git
 * reports "Already up to date" and `alreadyUpToDate` is set; otherwise the new
 * commits are brought in. A detached HEAD has no branch to merge into and is
 * rejected. All output (fetch + merge, incl. conflicts) is streamed to `onData`.
 * @param {string} worktreePath worktree whose checked-out branch receives the merge
 * @param {string} source ref to update from (the recorded fork source)
 * @param {(chunk:string)=>void} [onData] live progress callback
 * @returns {Promise<{ok:boolean, command:string, output:string, exitCode:number, alreadyUpToDate:boolean}>}
 */
async function mergeMainIntoWorktree(worktreePath, source, onData) {
  if (!isGitRepo(worktreePath)) throw new Error(`Not a git repository: ${worktreePath}`);
  const src = String(source || '').trim();
  if (!src || src.startsWith('-') || /[\s~^:?*\[\\]/.test(src)) {
    throw new Error(`Invalid source ref: ${src || '(empty)'}`);
  }
  const cur = await runRaw(['rev-parse', '--abbrev-ref', 'HEAD'], worktreePath);
  const branch = cur.ok ? cur.stdout.trim() : '';
  if (!branch || branch === 'HEAD') {
    throw new Error('This worktree is on a detached HEAD; check out a branch before merging.');
  }
  // 1. Update the source from origin first (best-effort). Merge the freshly
  //    fetched tip when origin was reachable, else the local source ref.
  const remoteBranch = src.replace(/^refs\/(remotes|heads)\//, '').replace(/^origin\//, '');
  let mergeRef = src;
  let fetchOut = '';
  const hasOrigin = (await runRaw(['remote'], worktreePath)).stdout.split(/\s+/).includes('origin');
  if (hasOrigin) {
    const fetch = await runStreaming(['fetch', 'origin', remoteBranch], worktreePath, onData);
    fetchOut = fetch.output || '';
    if (fetch.ok !== false) mergeRef = 'FETCH_HEAD';
  }
  // 2/3. Merge — git no-ops with "Already up to date" when there is nothing new.
  const merge = await runStreaming(['merge', '--no-edit', mergeRef], worktreePath, onData);
  const alreadyUpToDate = merge.ok !== false && /Already up[ -]to[ -]date/i.test(merge.output || '');
  return {
    ok: merge.ok !== false,
    command: `git fetch origin ${remoteBranch} + git merge ${src}`,
    output: [fetchOut, merge.output].filter(Boolean).join('\n'),
    exitCode: merge.exitCode,
    alreadyUpToDate
  };
}

/**
 * Give a worktree a branch: if a local branch `name` already exists switch to
 * it, otherwise create it at the current HEAD (`git switch -c`). Handy for a
 * detached-HEAD worktree that needs a branch before it can be merged. The name
 * is validated so the renderer can never inject extra git arguments.
 * @param {string} worktreePath the worktree to operate in
 * @param {string} name desired local branch name
 * @returns {Promise<{ok:boolean, command:string, output:string, exitCode:number, branch:string, created:boolean}>}
 */
async function setWorktreeBranch(worktreePath, name) {
  if (!isGitRepo(worktreePath)) throw new Error(`Not a git repository: ${worktreePath}`);
  const branch = String(name || '').trim();
  if (!branch || branch.startsWith('-') || /[\s~^:?*\[\\]/.test(branch)) {
    throw new Error(`Invalid branch name: ${branch || '(empty)'}`);
  }
  // Existing local branch -> switch to it; otherwise create it at the current HEAD.
  const has = await runRaw(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], worktreePath);
  const created = !has.ok;
  const res = await runCombined(['switch', ...(created ? ['-c'] : []), branch], worktreePath);
  return { ...res, branch, created };
}

// Run git and return its raw stdout/stderr separately (no merging/trimming),
// so binary-safe-ish text like a full patch is preserved verbatim. Patches from
// `format-patch --binary` are ASCII (binary hunks are base85), so utf8 is fine.
function runRaw(args, cwd) {
  return new Promise((resolve) => {
    execFile(
      'git',
      args,
      { cwd, maxBuffer: 1024 * 1024 * 256, windowsHide: true, encoding: 'utf8' },
      (err, stdout, stderr) => {
        resolve({
          ok: !err,
          stdout: stdout || '',
          stderr: stderr || '',
          code: err && typeof err.code === 'number' ? err.code : err ? 1 : 0
        });
      }
    );
  });
}

/**
 * Produce a single-commit patch (`git format-patch -1 --binary --stdout`) as
 * text: author/date/subject/message + the diff, with `--binary` so binary
 * changes can be applied later. The root commit is handled with `--root`; merge
 * commits have no single diff and are rejected with a clear message.
 * @param {string} cwd repo path
 * @param {string} sha commit to export
 * @returns {Promise<string>} the patch text
 */
async function exportCommitPatch(cwd, sha) {
  if (!isGitRepo(cwd)) throw new Error(`Not a git repository: ${cwd}`);
  const id = String(sha || '').trim();
  if (!id || /[^0-9a-fA-F]/.test(id)) throw new Error(`Invalid commit sha: ${id || '(empty)'}`);
  // rev-list --parents prints "<sha> <parent1> <parent2>..."; >1 parent = merge,
  // exactly the commit alone (no parent) = root.
  const rp = await runRaw(['rev-list', '--parents', '-n', '1', id], cwd);
  if (!rp.ok) throw new Error(rp.stderr.trim() || `Unknown commit: ${id}`);
  const tokens = rp.stdout.trim().split(/\s+/).filter(Boolean);
  if (tokens.length > 2) throw new Error('This is a merge commit; it has no single patch. Pick a non-merge commit.');
  const isRoot = tokens.length === 1;
  const args = ['format-patch', '-1', '--binary', '--stdout'];
  if (isRoot) args.push('--root');
  args.push(id);
  const res = await runRaw(args, cwd);
  if (!res.ok || !res.stdout) throw new Error(res.stderr.trim() || 'git format-patch failed');
  return res.stdout;
}

/**
 * Inspect a patch file against a repo WITHOUT applying it: returns the patch
 * text, a diffstat summary, and how it would apply. States (checked in order):
 *  - `clean`: a plain `git apply --check` succeeds (byte-exact apply).
 *  - `alreadyApplied`: a clean `--reverse --check` — every change is already
 *    present, so the repo content is identical and there is nothing to do.
 *  - `threeway`: a 3-way check succeeds (auto-merge, no conflict).
 *  - none of the above => real conflicts (see `checkOutput`).
 * @param {string} cwd repo path
 * @param {string} patchPath path to the .patch file
 */
async function inspectPatch(cwd, patchPath) {
  if (!isGitRepo(cwd)) throw new Error(`Not a git repository: ${cwd}`);
  const p = String(patchPath || '').trim();
  if (!p || !fs.existsSync(p)) throw new Error(`Patch file not found: ${p || '(empty)'}`);
  const content = fs.readFileSync(p, 'utf8');
  const stat = (await runRaw(['apply', '--stat', p], cwd)).stdout.trim();
  // Forward check: does the patch apply byte-exactly to the current tree?
  const plain = await runRaw(['apply', '--check', p], cwd);
  // If not, is it ALREADY applied? A clean reverse check means every change is
  // already present — the repo content is identical, so there is nothing to do.
  let reverse = { ok: false };
  if (!plain.ok) reverse = await runRaw(['apply', '--reverse', '--check', p], cwd);
  const alreadyApplied = !plain.ok && reverse.ok;
  // Otherwise, can a 3-way merge apply it with no conflicts?
  let three = { ok: false, stdout: '', stderr: '' };
  if (!plain.ok && !alreadyApplied) three = await runRaw(['apply', '--3way', '--check', p], cwd);
  const checkOutput = plain.ok || alreadyApplied
    ? ''
    : (three.stderr || three.stdout || plain.stderr || plain.stdout).trim();
  return {
    content,
    stat,
    clean: plain.ok,
    alreadyApplied,
    threeway: plain.ok || three.ok,
    checkOutput,
    patchPath: p,
  };
}

/**
 * Apply a patch to the repo's WORKING TREE only (`git apply --3way`). No index
 * staging, no commit — the user reviews and commits themselves. `--3way` leaves
 * conflict markers when a hunk can't apply cleanly. Output is streamed.
 * @param {string} cwd repo path
 * @param {string} patchPath path to the .patch file
 * @param {(chunk:string)=>void} [onData] live progress callback
 */
async function applyPatch(cwd, patchPath, onData) {
  if (!isGitRepo(cwd)) throw new Error(`Not a git repository: ${cwd}`);
  const p = String(patchPath || '').trim();
  if (!p || !fs.existsSync(p)) throw new Error(`Patch file not found: ${p || '(empty)'}`);
  return runStreaming(['apply', '--3way', '--verbose', p], cwd, onData);
}

// Resolve the main repo's object store (git dir) for the submodule at the
// superproject-relative path `rel`, or null when the main repo has no local copy.
function gcResolveModuleGitDir(mainRoot, rel) {
  const modDir = path.join(mainRoot, '.git', 'modules', rel);
  if (fs.existsSync(path.join(modDir, 'HEAD'))) return modDir;
  const dotGit = path.join(mainRoot, rel, '.git');
  try {
    if (fs.existsSync(dotGit)) {
      const st = fs.statSync(dotGit);
      if (st.isDirectory()) {
        if (fs.existsSync(path.join(dotGit, 'HEAD'))) return dotGit;
      } else {
        const txt = fs.readFileSync(dotGit, 'utf8').trim();
        const marker = 'gitdir:';
        if (txt.startsWith(marker)) {
          const p = path.resolve(path.join(mainRoot, rel), txt.slice(marker.length).trim());
          if (fs.existsSync(path.join(p, 'HEAD'))) return p;
        }
      }
    }
  } catch { /* ignore */ }
  return null;
}

// Parse a .gitmodules file into [{ name, path, url }] (no repo required).
async function gcParseGitmodules(gmPath) {
  const cwd = path.dirname(gmPath);
  const out = (await runCombined(['config', '-f', gmPath, '--list'], cwd)).output;
  const paths = {};
  const urls = {};
  for (const raw of out.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq);
    const val = line.slice(eq + 1).trim();
    if (key.startsWith('submodule.') && key.endsWith('.path')) {
      paths[key.slice(10, -5)] = val;
    } else if (key.startsWith('submodule.') && key.endsWith('.url')) {
      urls[key.slice(10, -4)] = val;
    }
  }
  return Object.keys(paths)
    .map((name) => ({ name, path: paths[name], url: urls[name] || '' }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

// Recursively init/update one submodule level. Reference-source preference:
// mirror cache -> main repo module store -> network.
async function gcUpdateSubsRec(repoRoot, mainRoot, cacheRoot, relBase, emit, items, depth) {
  const gm = path.join(repoRoot, '.gitmodules');
  if (!fs.existsSync(gm)) return;
  const subs = await gcParseGitmodules(gm);
  const indent = '  '.repeat(depth);
  for (const s of subs) {
    const full = relBase ? `${relBase}/${s.path}` : s.path;
    let ref = null;
    let source = 'network';
    if (cacheRoot && s.url) {
      const mp = mirrorPathForUrl(cacheRoot, s.url);
      if (fs.existsSync(path.join(mp, 'HEAD'))) { ref = mp; source = 'mirror'; }
    }
    if (!ref) {
      const md = gcResolveModuleGitDir(mainRoot, full);
      if (md) { ref = md; source = 'local-cache'; }
    }
    emit(`\n${indent}[${source}] ${full}\n`);
    emit(`${indent}   url: ${s.url || '(unknown)'}\n`);
    if (ref) {
      emit(`${indent}   from: ${ref}\n`);
    } else if (cacheRoot && s.url) {
      emit(`${indent}   no mirror at: ${mirrorPathForUrl(cacheRoot, s.url)}\n`);
    } else if (!cacheRoot) {
      emit(`${indent}   (no mirror cache configured for this repo)\n`);
    }

    const args = ['submodule', 'update', '--init', '--progress'];
    if (ref) args.push('--reference', ref);
    args.push('--', s.path);
    const res = await runStreaming(args, repoRoot, emit);
    const ok = res.exitCode === 0;
    if (!ok) emit(`${indent}   FAILED (exit ${res.exitCode})\n`);
    items.push({ path: full, url: s.url || '', source, ok });

    const childRoot = path.join(repoRoot, s.path);
    if (fs.existsSync(path.join(childRoot, '.gitmodules'))) {
      await gcUpdateSubsRec(childRoot, mainRoot, cacheRoot, full, emit, items, depth + 1);
    }
  }
}

// Turn a submodule URL into a stable mirror folder name: strip scheme, embedded
// credentials and a trailing .git, then collapse anything unusual to '_'.
function sanitizeMirrorName(url) {
  let u = String(url || '').trim();
  const scheme = u.indexOf('://');
  if (scheme >= 0) u = u.slice(scheme + 3);
  const at = u.indexOf('@');
  const slash = u.indexOf('/');
  if (at >= 0 && (slash < 0 || at < slash)) u = u.slice(at + 1);
  if (u.toLowerCase().endsWith('.git')) u = u.slice(0, -4);
  let out = '';
  for (const ch of u) out += /[A-Za-z0-9._-]/.test(ch) ? ch : '_';
  return out + '.git';
}

function mirrorPathForUrl(cacheRoot, url) {
  return path.join(cacheRoot, sanitizeMirrorName(url));
}

/**
 * Build a golden cache of per-submodule bare mirrors under `cacheRoot`. Recurses
 * into nested submodules. Each mirror is seeded from the main repo's local module
 * store when available (fast, no network), otherwise cloned from the network; an
 * existing mirror is refreshed from its remote. The cache root is saved to the
 * main repo config (m2gitdiff.mirrorCache) so a later updateWorktreeSubmodules
 * prefers these mirrors. Mirrors are full copies, so this can use notable disk.
 * @param {string} mainRepoPath parent repo whose submodules to mirror
 * @param {string} cacheRoot destination folder for the mirrors
 * @param {(chunk:string)=>void} [onData] live progress callback
 * @returns {Promise<{ok:boolean, command:string, output:string, exitCode:number, items:Array, cacheRoot:string}>}
 */
async function buildSubmoduleMirrorCache(mainRepoPath, cacheRoot, onData) {
  const main = path.resolve(String(mainRepoPath || '').trim());
  if (!isGitRepo(main)) throw new Error(`Not a git repository: ${main}`);
  const root = path.resolve(String(cacheRoot || '').trim());
  if (!root) throw new Error('A cache folder is required');
  if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });

  const items = [];
  let allText = '';
  const emit = (s) => { allText += s; try { if (onData) onData(s); } catch { /* ignore */ } };
  const seen = new Set();

  emit(`Building submodule mirror cache\nMain repo: ${main}\nCache root: ${root}\n`);
  await gcBuildMirrorsRec(main, main, root, '', emit, items, seen);

  // Remember the cache so submodule updates can prefer it.
  try { await runCombined(['config', 'm2gitdiff.mirrorCache', root], main); } catch { /* ignore */ }

  const failed = items.filter((i) => i.ok === false).length;
  const seeded = items.filter((i) => i.source === 'seed-local').length;
  const net = items.filter((i) => i.source === 'network').length;
  const refreshed = items.filter((i) => i.source === 'refresh').length;
  emit(`\n${'-'.repeat(52)}\n`);
  emit(`Done - ${items.length} mirror(s): ${seeded} seeded from repo, ${net} from network, ${refreshed} refreshed, ${failed} failed.\n`);
  return {
    ok: failed === 0,
    command: 'build submodule mirror cache',
    output: allText.trim(),
    exitCode: failed === 0 ? 0 : 1,
    items,
    cacheRoot: root
  };
}

// Recursively create/refresh one mirror per unique submodule URL.
async function gcBuildMirrorsRec(dir, mainRoot, cacheRoot, relBase, emit, items, seen) {
  const gm = path.join(dir, '.gitmodules');
  if (!fs.existsSync(gm)) return;
  const subs = await gcParseGitmodules(gm);
  for (const s of subs) {
    const full = relBase ? `${relBase}/${s.path}` : s.path;
    if (s.url && !seen.has(s.url)) {
      seen.add(s.url);
      const mp = mirrorPathForUrl(cacheRoot, s.url);
      let source;
      let ok = true;
      if (fs.existsSync(path.join(mp, 'HEAD'))) {
        emit(`\n[refresh] ${full}\n   ${mp}\n`);
        const r = await runStreaming(['remote', 'update', '--prune'], mp, emit);
        ok = r.exitCode === 0;
        source = 'refresh';
      } else {
        const md = gcResolveModuleGitDir(mainRoot, full);
        if (md) {
          emit(`\n[seed-local] ${full}\n   from ${md}\n   -> ${mp}\n`);
          const r = await runStreaming(['clone', '--mirror', md, mp], mainRoot, emit);
          ok = r.exitCode === 0;
          if (ok) { try { await runCombined(['remote', 'set-url', 'origin', s.url], mp); } catch { /* ignore */ } }
          source = 'seed-local';
        } else {
          emit(`\n[network] ${full}\n   ${s.url} -> ${mp}\n`);
          const r = await runStreaming(['clone', '--mirror', '--progress', s.url, mp], mainRoot, emit);
          ok = r.exitCode === 0;
          source = 'network';
        }
      }
      if (!ok) emit(`   FAILED\n`);
      items.push({ path: full, url: s.url, mirror: mp, source, ok });
    }
    const childDir = path.join(dir, s.path);
    if (fs.existsSync(path.join(childDir, '.gitmodules'))) {
      await gcBuildMirrorsRec(childDir, mainRoot, cacheRoot, full, emit, items, seen);
    }
  }
}

/**
 * Refresh every bare mirror already sitting in the repo's configured mirror
 * cache (m2gitdiff.mirrorCache) by running `git remote update --prune` in each.
 * Unlike buildSubmoduleMirrorCache this only pulls the latest into mirrors that
 * already exist — it never walks the main repo's submodules — so it is a fast
 * "bring the cache up to date" action. The cache root is read from the main
 * repo's config; every direct child folder that looks like a bare repo (has a
 * HEAD file) is updated. Progress streams to `onData`.
 * @param {string} mainRepoPath repo whose configured mirror cache to refresh
 * @param {(chunk:string)=>void} [onData] live progress callback
 * @returns {Promise<{ok:boolean, command:string, output:string, exitCode:number, items:Array, cacheRoot:string}>}
 */
async function updateMirrorCache(mainRepoPath, onData) {
  const main = path.resolve(String(mainRepoPath || '').trim());
  if (!isGitRepo(main)) throw new Error(`Not a git repository: ${main}`);
  const root = await getMirrorCache(main);
  if (!root) throw new Error('No mirror cache is configured for this repo.');
  if (!fs.existsSync(root)) throw new Error(`Mirror cache folder not found: ${root}`);

  const items = [];
  let allText = '';
  const emit = (s) => { allText += s; try { if (onData) onData(s); } catch { /* ignore */ } };

  emit(`Updating mirror cache\nCache root: ${root}\n`);
  let dirents = [];
  try {
    dirents = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch (e) {
    throw new Error(`Cannot read mirror cache folder: ${String(e?.message || e)}`);
  }
  for (const d of dirents) {
    const mp = path.join(root, d.name);
    // A bare mirror has a HEAD file at its root; skip anything else.
    if (!fs.existsSync(path.join(mp, 'HEAD'))) continue;
    emit(`\n[update] ${d.name}\n   ${mp}\n`);
    const r = await runStreaming(['remote', 'update', '--prune'], mp, emit);
    const ok = r.exitCode === 0;
    if (!ok) emit(`   FAILED\n`);
    items.push({ mirror: mp, name: d.name, ok });
  }

  const failed = items.filter((i) => i.ok === false).length;
  emit(`\n${'-'.repeat(52)}\n`);
  if (items.length === 0) emit('No bare mirrors found in the cache folder.\n');
  else emit(`Done - ${items.length - failed} of ${items.length} mirror(s) updated, ${failed} failed.\n`);
  return {
    ok: failed === 0,
    command: 'git remote update --prune (every mirror in cache)',
    output: allText.trim(),
    exitCode: failed === 0 ? 0 : 1,
    items,
    cacheRoot: root
  };
}

/**
 * List every worktree attached to the repo via `git worktree list --porcelain`.
 * The main worktree is always listed first. Each entry carries its path, HEAD
 * sha, the checked-out branch (short) or a detached flag, plus isMain /
 * isCurrent markers so the renderer can protect the primary and in-use
 * worktrees from deletion.
 * @param {string} cwd repo path
 * @returns {Promise<Array<{path:string, head:string, branch:string, detached:boolean, bare:boolean, locked:boolean, prunable:boolean, isMain:boolean, isCurrent:boolean}>>}
 */
async function listWorktrees(cwd) {
  if (!isGitRepo(cwd)) throw new Error(`Not a git repository: ${cwd}`);
  const out = await run(['worktree', 'list', '--porcelain'], cwd);
  const norm = (p) => {
    try {
      return path.resolve(p).replace(/\\/g, '/').toLowerCase();
    } catch {
      return String(p || '').replace(/\\/g, '/').toLowerCase();
    }
  };
  const here = norm(cwd);
  const entries = [];
  let cur = null;
  for (const raw of out.split(/\r?\n/)) {
    const line = raw.replace(/\r$/, '');
    if (line.startsWith('worktree ')) {
      if (cur) entries.push(cur);
      cur = {
        path: line.slice(9).trim(),
        head: '',
        branch: '',
        detached: false,
        bare: false,
        locked: false,
        prunable: false,
        isMain: false,
        isCurrent: false
      };
    } else if (!cur) {
      continue;
    } else if (line.startsWith('HEAD ')) {
      cur.head = line.slice(5).trim();
    } else if (line.startsWith('branch ')) {
      cur.branch = line.slice(7).trim().replace(/^refs\/heads\//, '');
    } else if (line === 'bare') {
      cur.bare = true;
    } else if (line === 'detached') {
      cur.detached = true;
    } else if (line.startsWith('locked')) {
      cur.locked = true;
    } else if (line.startsWith('prunable')) {
      cur.prunable = true;
    }
  }
  if (cur) entries.push(cur);

  // Fork sources are recorded in the main repo's shared config (see
  // writeWorktreeConfig). Build a match index by normalised path and by folder
  // name so each worktree can surface its "merge source" action.
  const cfgMap = await readWorktreeConfigMap(cwd);
  const byPath = new Map();
  const byName = new Map();
  for (const [sub, rec] of cfgMap) {
    if (!rec.source) continue;
    if (rec.path) byPath.set(norm(rec.path), rec.source);
    byName.set(sub.toLowerCase(), rec.source);
  }

  // The main worktree's `.git` is the shared common dir; expose it so the UI can
  // offer an "open .git folder" action for the primary repo.
  let gitDir = '';
  try {
    const gc = (await runRaw(['rev-parse', '--git-common-dir'], cwd)).stdout.trim();
    if (gc) gitDir = path.isAbsolute(gc) ? gc : path.resolve(cwd, gc);
  } catch { /* ignore — the button just won't show */ }

  entries.forEach((e, i) => {
    e.isMain = i === 0;
    e.isCurrent = norm(e.path) === here;
    if (e.isMain && gitDir) e.gitDir = gitDir;
    // Attach the recorded fork source (main repo config) when present, matching
    // by path first, then by folder name.
    const src = byPath.get(norm(e.path)) || byName.get(path.basename(e.path).toLowerCase());
    if (src) e.linkSource = src;
  });
  return entries;
}

/**
 * Remove a linked worktree, force by default (`git worktree remove --force`),
 * then make sure the directory is truly gone and prune stale admin entries.
 * Safety: the path must be a real linked worktree of THIS repo and never the
 * main / current one — verified against `git worktree list` before anything on
 * disk is touched. Steps:
 *   1. `git worktree remove --force <path>` (drops the working tree even dirty);
 *   2. if the folder somehow remains, delete it recursively (best-effort);
 *   3. `git worktree prune` to clear the admin entry (also covers a folder the
 *      user deleted by hand).
 * `ok` reflects whether the directory is gone at the end. When it can't be
 * removed because the OS still holds it (Windows EBUSY), `lockedBy` lists the
 * offending processes so the caller can tell the user what to close.
 * @param {string} cwd repo path
 * @param {string} worktreePath path of the worktree to remove
 * @param {boolean} [force=true]
 * @returns {Promise<{ok:boolean, command:string, output:string, exitCode:number, lockedBy:Array<{pid:number, name:string}>}>}
 */
async function removeWorktree(cwd, worktreePath, force = true) {
  if (!isGitRepo(cwd)) throw new Error(`Not a git repository: ${cwd}`);
  const p = String(worktreePath || '').trim();
  if (!p || p.startsWith('-')) throw new Error(`Invalid worktree path: ${p || '(empty)'}`);

  const norm = (x) => {
    try {
      return path.resolve(x).replace(/\\/g, '/').toLowerCase();
    } catch {
      return String(x || '').replace(/\\/g, '/').toLowerCase();
    }
  };
  const targetNorm = norm(p);
  if (targetNorm === norm(cwd)) throw new Error('Refusing to remove the current worktree');

  // Hard guard before any filesystem delete: the path must be a real linked
  // worktree of this repo, and not the main one.
  const wts = await listWorktrees(cwd);
  const entry = wts.find((w) => norm(w.path) === targetNorm);
  if (!entry) throw new Error(`Not a worktree of this repository: ${p}`);
  if (entry.isMain) throw new Error('Refusing to remove the main worktree');

  const lines = [];

  // 1. Force-remove via git (removes the working tree even if dirty / locked).
  const rmArgs = ['worktree', 'remove'];
  if (force) rmArgs.push('--force');
  rmArgs.push(p);
  const rmRes = await runCombined(rmArgs, cwd);
  lines.push('$ ' + rmRes.command);
  if (rmRes.output) lines.push(rmRes.output);

  // 2. Ensure the directory is really gone (git can leave it behind on an edge
  //    case, or the user may have force-removed only the ref). Best-effort.
  const targetResolved = path.resolve(p);
  try {
    if (fs.existsSync(targetResolved)) {
      fs.rmSync(targetResolved, { recursive: true, force: true });
      lines.push(`# removed leftover directory: ${targetResolved}`);
    }
  } catch (e) {
    lines.push(`# could not remove directory: ${String(e?.message || e)}`);
  }

  // 3. Prune stale admin entries (also covers a folder deleted by hand).
  const pruneRes = await runCombined(['worktree', 'prune'], cwd);
  lines.push('$ ' + pruneRes.command);
  if (pruneRes.output) lines.push(pruneRes.output);

  // Best-effort: drop this worktree's fork-source record from the main config.
  await removeWorktreeConfig(cwd, p);

  const gone = !fs.existsSync(targetResolved);

  // 4. If the folder is still here, something on the OS is holding it (the
  //    classic Windows EBUSY / "resource busy or locked"). Name the culprit
  //    process(es) so the user can close them and retry themselves.
  let lockedBy = [];
  if (!gone) {
    try {
      lockedBy = await findLockingProcesses(targetResolved);
    } catch {
      lockedBy = [];
    }
    if (lockedBy.length) {
      lines.push('# directory is still in use by:');
      for (const proc of lockedBy) {
        lines.push(`#   - ${proc.name} (PID ${proc.pid})`);
      }
      lines.push('# close the process(es) above, then remove the worktree again.');
    } else {
      lines.push('# directory is locked, but the holding process could not be identified.');
      lines.push('# check an open editor, a terminal whose CWD is inside it, or antivirus/indexing.');
    }
  }

  return {
    ok: gone,
    command: rmRes.command,
    output: lines.join('\n').trim(),
    exitCode: gone ? 0 : rmRes.exitCode || 1,
    lockedBy
  };
}

/**
 * Prune worktree admin entries whose working directory no longer exists — the
 * fix-up for worktrees the user deleted from disk by hand. `-v` echoes what was
 * pruned. Returns the transcript in the git-terminal shape.
 * @param {string} cwd repo path
 * @returns {Promise<{ok:boolean, command:string, output:string, exitCode:number}>}
 */
async function pruneWorktrees(cwd) {
  if (!isGitRepo(cwd)) throw new Error(`Not a git repository: ${cwd}`);
  return runCombined(['worktree', 'prune', '-v'], cwd);
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
  loadMoreCommits,
  getPatchIds,
  getDiffTexts,
  getCommitDiff,
  loadRepo,
  gitOp,
  listBranches,
  switchBranch,
  updateAllBranches,
  addWorktree,
  createMirror,
  updateWorktreeSubmodules,
  mergeMainIntoWorktree,
  setWorktreeBranch,
  exportCommitPatch,
  inspectPatch,
  applyPatch,
  buildSubmoduleMirrorCache,
  updateMirrorCache,
  getMirrorCache,
  getMirrorCacheInfo,
  listWorktrees,
  removeWorktree,
  pruneWorktrees,
  parseTags
};
