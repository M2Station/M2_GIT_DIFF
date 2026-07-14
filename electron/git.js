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
  return { ...res, target };
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
  entries.forEach((e, i) => {
    e.isMain = i === 0;
    e.isCurrent = norm(e.path) === here;
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
 * `ok` reflects whether the directory is gone at the end.
 * @param {string} cwd repo path
 * @param {string} worktreePath path of the worktree to remove
 * @param {boolean} [force=true]
 * @returns {Promise<{ok:boolean, command:string, output:string, exitCode:number}>}
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

  const gone = !fs.existsSync(targetResolved);
  return {
    ok: gone,
    command: rmRes.command,
    output: lines.join('\n').trim(),
    exitCode: gone ? 0 : rmRes.exitCode || 1
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
  listWorktrees,
  removeWorktree,
  pruneWorktrees,
  parseTags
};
