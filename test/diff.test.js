/*
 * M2_GIT_DIFF
 * Copyright (c) 2026 OA Hsiao
 * SPDX-License-Identifier: MIT
 *
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeSubject,
  computeDiff,
  applyFuzzy,
  changedLineSet,
  patchSimilarity,
  parseUnifiedDiff,
  alignLayout,
  matchesQuery
} from '../src/lib/diff.js';

// Minimal commit factory — computeDiff only reads sha / short / subject (it
// spreads the rest through untouched).
const c = (sha, subject, extra = {}) => ({ sha, short: sha, subject, ...extra });

describe('normalizeSubject', () => {
  it('trims, lowercases and collapses internal whitespace', () => {
    expect(normalizeSubject('  Fix   the   Bug  ')).toBe('fix the bug');
  });

  it('treats an empty / missing subject as an empty string', () => {
    expect(normalizeSubject()).toBe('');
    expect(normalizeSubject('   ')).toBe('');
  });
});

describe('computeDiff — classification', () => {
  const left = { commits: [c('a1', 'Common one'), c('l2', 'Shared title'), c('l3', 'Left only')] };
  const right = { commits: [c('a1', 'Common one'), c('r2', 'shared TITLE'), c('r3', 'Right only')] };

  it('marks identical SHAs as common on both sides', () => {
    const { leftRows, rightRows, links } = computeDiff(left, right);
    expect(leftRows[0].status).toBe('common');
    expect(rightRows[0].status).toBe('common');
    expect(leftRows[0].matchId).toBe('sha:a1');
    expect(links.filter((l) => l.type === 'common')).toHaveLength(1);
  });

  it('pairs different SHAs with the same normalized subject as cherry-picks', () => {
    const { leftRows, rightRows, links } = computeDiff(left, right);
    expect(leftRows[1].status).toBe('cherry');
    expect(rightRows[1].status).toBe('cherry');
    expect(leftRows[1].matchId).toBe(rightRows[1].matchId);
    expect(links.filter((l) => l.type === 'cherry')).toHaveLength(1);
  });

  it('leaves one-sided commits unique', () => {
    const { leftRows, rightRows } = computeDiff(left, right);
    expect(leftRows[2].status).toBe('unique');
    expect(rightRows[2].status).toBe('unique');
  });

  it('reports per-status stats per side', () => {
    const { leftStats } = computeDiff(left, right);
    expect(leftStats).toEqual({ common: 1, cherry: 1, unique: 1, fuzzy: 0 });
  });
});

describe('computeDiff — patch-id fallback', () => {
  const left = { commits: [c('l3', 'Left title')] };
  const right = { commits: [c('r3', 'Totally different title')] };

  it('links edited-title cherry-picks that share a patch-id', () => {
    const patchIds = { l3: 'PATCH', r3: 'PATCH' };
    const { leftRows, rightRows, links } = computeDiff(left, right, patchIds);
    expect(leftRows[0].status).toBe('cherry');
    expect(rightRows[0].status).toBe('cherry');
    expect(links.filter((l) => l.type === 'patch')).toHaveLength(1);
  });

  it('keeps them unique when patch-ids differ', () => {
    const patchIds = { l3: 'A', r3: 'B' };
    const { leftRows } = computeDiff(left, right, patchIds);
    expect(leftRows[0].status).toBe('unique');
  });
});

describe('computeDiff — manual links', () => {
  const left = { commits: [c('l3', 'Left only')] };
  const right = { commits: [c('r3', 'Right only')] };

  it('honors a user-drawn link between two still-unique commits', () => {
    const manual = [{ leftSha: 'l3', rightSha: 'r3' }];
    const { leftRows, rightRows, links } = computeDiff(left, right, null, manual);
    expect(leftRows[0].manual).toBe(true);
    expect(rightRows[0].manual).toBe(true);
    expect(links.filter((l) => l.type === 'manual')).toHaveLength(1);
  });

  it('ignores a manual link whose endpoint is already auto-matched', () => {
    const l = { commits: [c('same', 'X')] };
    const r = { commits: [c('same', 'X')] };
    const manual = [{ leftSha: 'same', rightSha: 'same' }];
    const { links } = computeDiff(l, r, null, manual);
    expect(links.filter((x) => x.type === 'manual')).toHaveLength(0);
    expect(links.filter((x) => x.type === 'common')).toHaveLength(1);
  });
});

describe('applyFuzzy', () => {
  const base = computeDiff(
    { commits: [c('l1', 'Left feature')] },
    { commits: [c('r1', 'Right feature')] }
  );

  it('links commits whose changed lines clear the Jaccard threshold', () => {
    const fuzzy = {
      enabled: true,
      threshold: 0.5,
      diffTexts: { l1: ['+aaa', '+bbb', '+ccc'], r1: ['+aaa', '+bbb', '+ddd'] }
    };
    const { leftRows, rightRows, links } = applyFuzzy(base, fuzzy);
    // intersection 2 / union 4 = 0.5 >= threshold
    expect(leftRows[0].status).toBe('fuzzy');
    expect(rightRows[0].status).toBe('fuzzy');
    const fl = links.find((l) => l.type === 'fuzzy');
    expect(fl.score).toBeCloseTo(0.5, 5);
  });

  it('does not link below the threshold', () => {
    const fuzzy = {
      enabled: true,
      threshold: 0.6,
      diffTexts: { l1: ['+aaa', '+bbb', '+ccc'], r1: ['+aaa', '+bbb', '+ddd'] }
    };
    const { leftRows } = applyFuzzy(base, fuzzy);
    expect(leftRows[0].status).toBe('unique');
  });

  it('ignores diffs below the minimum line count', () => {
    const fuzzy = {
      enabled: true,
      threshold: 0.1,
      diffTexts: { l1: ['+aaa', '+bbb'], r1: ['+aaa', '+bbb'] }
    };
    const { leftRows } = applyFuzzy(base, fuzzy);
    expect(leftRows[0].status).toBe('unique');
  });

  it('returns the base result untouched when disabled', () => {
    expect(applyFuzzy(base, { enabled: false })).toBe(base);
  });
});

describe('changedLineSet / patchSimilarity', () => {
  const patch = [
    'diff --git a/f.txt b/f.txt',
    '--- a/f.txt',
    '+++ b/f.txt',
    '@@ -1,2 +1,2 @@',
    '-old content line',
    '+new content line',
    ' unchanged context'
  ].join('\n');

  it('collects only the +/- body lines, skipping file headers', () => {
    const set = changedLineSet(patch);
    expect(set.has('-old content line')).toBe(true);
    expect(set.has('+new content line')).toBe(true);
    expect(set.size).toBe(2);
  });

  it('scores identical sets as 1 and disjoint sets as 0', () => {
    const a = changedLineSet(patch);
    expect(patchSimilarity(a, a)).toBe(1);
    const b = changedLineSet(
      ['diff --git a/x b/x', '@@ -1 +1 @@', '+brand new', '-gone away'].join('\n')
    );
    expect(patchSimilarity(a, b)).toBe(0);
  });

  it('returns 0 for empty inputs', () => {
    expect(patchSimilarity(new Set(), new Set(['+x']))).toBe(0);
  });
});

describe('parseUnifiedDiff', () => {
  it('parses files, hunks and typed lines', () => {
    const patch = [
      'diff --git a/src/app.js b/src/app.js',
      'index 111..222 100644',
      '--- a/src/app.js',
      '+++ b/src/app.js',
      '@@ -1,3 +1,3 @@',
      ' context',
      '-removed',
      '+added'
    ].join('\n');
    const files = parseUnifiedDiff(patch);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe('src/app.js');
    expect(files[0].hunks).toHaveLength(1);
    const types = files[0].hunks[0].lines.map((l) => l.type);
    expect(types).toEqual(['ctx', 'del', 'add']);
  });

  it('returns an empty list for empty input', () => {
    expect(parseUnifiedDiff('')).toEqual([]);
  });
});

describe('alignLayout', () => {
  const rows = (n) => Array.from({ length: n }, (_, i) => ({ commit: { index: i }, isHit: false }));

  it('places a matched pair on the same display row', () => {
    const Lrows = rows(2);
    const Rrows = rows(2);
    const links = [{ leftIndex: 1, rightIndex: 1, type: 'common', id: 'x' }];
    const out = alignLayout(Lrows, Rrows, links);
    expect(out.L.rows[1].displayIndex).toBe(out.R.rows[1].displayIndex);
    expect(out.links[0].leftIndex).toBe(out.links[0].rightIndex);
  });

  it('stacks unmatched rows into gaps and grows totalRows', () => {
    // Left has an extra leading commit with no match; the matched pair (L2/R1)
    // must still align on a shared row below the gap.
    const Lrows = rows(2);
    const Rrows = rows(1);
    const links = [{ leftIndex: 1, rightIndex: 0, type: 'common', id: 'x' }];
    const out = alignLayout(Lrows, Rrows, links);
    expect(out.L.rows[1].displayIndex).toBe(out.R.rows[0].displayIndex);
    expect(out.totalRows).toBe(2);
  });

  it('drops links whose endpoints are not both visible', () => {
    const out = alignLayout(rows(1), rows(1), [{ leftIndex: 5, rightIndex: 0, id: 'y' }]);
    expect(out.links).toHaveLength(0);
  });
});

describe('matchesQuery', () => {
  const commit = {
    subject: 'Fix the parser',
    body: 'detailed body text',
    sha: 'abcdef1234',
    short: 'abcdef1',
    author: 'Jane Dev',
    authorDate: '2026-01-02'
  };

  it('matches when the query is empty', () => {
    expect(matchesQuery(commit, '')).toBe(true);
  });

  it('searches every scope by default', () => {
    expect(matchesQuery(commit, 'parser')).toBe(true);
    expect(matchesQuery(commit, 'jane')).toBe(true);
    expect(matchesQuery(commit, 'abcdef')).toBe(true);
    expect(matchesQuery(commit, '2026-01')).toBe(true);
  });

  it('respects disabled scopes', () => {
    const scopes = { subject: false, body: false, sha: true, author: false, date: false };
    expect(matchesQuery(commit, 'parser', scopes)).toBe(false);
    expect(matchesQuery(commit, 'abcdef', scopes)).toBe(true);
  });
});
