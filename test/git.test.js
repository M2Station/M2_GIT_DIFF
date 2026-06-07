/*
 * M2_GIT_DIFF
 * Copyright (c) 2026 OA Hsiao
 * SPDX-License-Identifier: MIT
 *
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// git.js is CommonJS (module.exports); the default import is that exports object.
import gitModule from '../electron/git.js';
const {
  isGitRepo,
  getCurrentBranch,
  getCommits,
  loadMoreCommits,
  getPatchIds,
  parseTags
} = gitModule;

// ---- parseTags is a pure function — unit test it directly ----------------
describe('parseTags', () => {
  it('extracts only tag: entries from a %D ref-decoration string', () => {
    expect(parseTags('HEAD -> main, tag: v0.1.3, origin/main')).toEqual(['v0.1.3']);
  });

  it('returns every tag when a commit carries several', () => {
    expect(parseTags('tag: v1.0, tag: release-1')).toEqual(['v1.0', 'release-1']);
  });

  it('returns an empty array when there are no tags', () => {
    expect(parseTags('HEAD -> main, origin/main')).toEqual([]);
    expect(parseTags('')).toEqual([]);
  });
});

// ---- Integration tests against a real throwaway git repo -----------------
describe('git.js against a real repo', () => {
  let repo;
  let emptyDir;

  // Run a git command inside the temp repo with a fixed, isolated identity so
  // commits don't depend on (or mutate) the machine's global git config.
  const git = (args, date) =>
    execFileSync('git', args, {
      cwd: repo,
      encoding: 'utf8',
      env: date
        ? { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }
        : process.env
    });

  const commit = (n) => {
    writeFileSync(path.join(repo, 'file.txt'), `content revision ${n}\nline ${n}\n`);
    git(['add', '.']);
    git(['commit', '-m', `c${n}`], `2026-01-0${n}T00:00:00`);
  };

  beforeAll(() => {
    repo = mkdtempSync(path.join(tmpdir(), 'm2diff-repo-'));
    emptyDir = mkdtempSync(path.join(tmpdir(), 'm2diff-empty-'));
    git(['init', '-b', 'main']);
    git(['config', 'user.email', 'test@example.com']);
    git(['config', 'user.name', 'Test User']);
    git(['config', 'commit.gpgsign', 'false']);
    commit(1);
    commit(2);
    git(['tag', 'v1.0']); // lightweight tag on c2 (current HEAD)
    commit(3);
    commit(4);
    commit(5);
  });

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
    rmSync(emptyDir, { recursive: true, force: true });
  });

  it('detects a git repo vs a plain directory', () => {
    expect(isGitRepo(repo)).toBe(true);
    expect(isGitRepo(emptyDir)).toBe(false);
  });

  it('reads the current branch name', async () => {
    expect(await getCurrentBranch(repo)).toBe('main');
  });

  it('returns all commits newest-first with no more remaining', async () => {
    const { commits, hasMore } = await getCommits(repo, { limit: 100 });
    expect(commits.map((x) => x.subject)).toEqual(['c5', 'c4', 'c3', 'c2', 'c1']);
    expect(hasMore).toBe(false);
  });

  it('parses sha / short / parents fields', async () => {
    const { commits } = await getCommits(repo, { limit: 100 });
    const newest = commits[0];
    expect(newest.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(newest.short.length).toBeGreaterThanOrEqual(7);
    expect(newest.parents).toHaveLength(1); // non-root commit
    const root = commits[commits.length - 1];
    expect(root.parents).toHaveLength(0); // c1 is the root
  });

  it('surfaces tags via parseTags', async () => {
    const { commits } = await getCommits(repo, { limit: 100 });
    const tagged = commits.find((x) => x.subject === 'c2');
    expect(tagged.tags).toContain('v1.0');
  });

  it('flags hasMore and truncates to the limit', async () => {
    const { commits, hasMore } = await getCommits(repo, { limit: 3 });
    expect(commits.map((x) => x.subject)).toEqual(['c5', 'c4', 'c3']);
    expect(hasMore).toBe(true);
  });

  it('pages older commits with skip', async () => {
    const { commits } = await getCommits(repo, { limit: 2, skip: 1 });
    expect(commits.map((x) => x.subject)).toEqual(['c4', 'c3']);
  });

  it('loadMoreCommits skips the rows already held', async () => {
    const { commits } = await loadMoreCommits(repo, { skip: 2, batch: 2 });
    expect(commits.map((x) => x.subject)).toEqual(['c3', 'c2']);
  });

  it('computes patch-ids for commits', async () => {
    const { commits } = await getCommits(repo, { limit: 100 });
    const shas = commits.map((x) => x.sha);
    const ids = await getPatchIds(repo, shas);
    expect(ids).toBeInstanceOf(Map);
    expect(ids.size).toBeGreaterThan(0);
    for (const v of ids.values()) expect(typeof v).toBe('string');
  });

  it('returns an empty map when no shas are requested', async () => {
    const ids = await getPatchIds(repo, []);
    expect(ids.size).toBe(0);
  });

  it('throws when the directory is not a git repo', async () => {
    await expect(getCommits(emptyDir, { limit: 10 })).rejects.toThrow(/not a git repository/i);
  });
});
