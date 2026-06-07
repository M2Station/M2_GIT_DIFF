/*
 * M2_GIT_DIFF
 * Copyright (c) 2026 OA Hsiao
 * SPDX-License-Identifier: MIT
 *
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildMarkdown } = require('../electron/markdownReport.js');

describe('markdown report export', () => {
  it('escapes table text while preserving commit links', () => {
    const md = buildMarkdown({
      leftName: 'Devices_TOT',
      rightName: 'Devices_BAA_PREEV',
      leftRemoteUrl: 'https://MSFTDEVICES@dev.azure.com/MSFTDEVICES/UEFI-Intel/_git/Devices.git',
      rightRemoteUrl: 'git@github.com:oahsiao/example.git',
      rows: [
        {
          left: {
            short: 'abc1234',
            sha: 'abc1234',
            subject: 'Merged PR 123: [NVL] Revert "A | B" and **keep literal**',
            author: 'A_User',
            date: '2026-06-07',
            note: 'line 1\nline 2 | note',
            tags: ['tag|one']
          },
          right: null,
          link: null
        },
        {
          left: {
            short: 'def5678',
            sha: 'def5678',
            linked: true,
            subject: '[skip ci] left'
          },
          right: {
            short: '987abcd',
            sha: '987abcd',
            linked: true,
            subject: 'right **subject**'
          },
          link: 'fuzzy',
          linkScore: 0.82
        },
        {
          left: {
            short: 'aaa1111',
            sha: 'aaa1111',
            subject: 'left patch subject'
          },
          right: null,
          link: null
        },
        {
          left: null,
          right: {
            short: 'bbb2222',
            sha: 'bbb2222',
            subject: 'right patch subject'
          },
          link: null
        }
      ],
      fuzzyLinks: [
        {
          score: 0.82,
          leftShort: 'def5678',
          leftSha: 'def5678',
          leftSubject: '[skip ci] left | fuzzy',
          rightShort: '987abcd',
          rightSha: '987abcd',
          rightSubject: 'right **subject**'
        }
      ],
      contentLinks: [
        {
          type: 'patch',
          leftShort: 'aaa1111',
          leftSha: 'aaa1111',
          leftSubject: 'left patch subject',
          rightShort: 'bbb2222',
          rightSha: 'bbb2222',
          rightSubject: 'right patch subject'
        }
      ],
      manualLinks: [],
      linkCounts: { common: 0, cherry: 0, patch: 1, manual: 0, fuzzy: 1 }
    });

    expect(md).toContain('[abc1234](<https://dev.azure.com/MSFTDEVICES/UEFI-Intel/_git/Devices/commit/abc1234>)');
    expect(md).not.toContain('MSFTDEVICES@dev.azure.com');
    expect(md).toContain('A \\| B');
    expect(md).toContain('\\*\\*keep literal\\*\\*');
    expect(md).toContain('\\[NVL\\]');
    expect(md).toContain('line 1<br>line 2 \\| note');
    expect(md).toContain('tag\\|one');
    expect(md).toContain('\\[skip ci\\] left \\| fuzzy');
    expect(md).toContain('right \\*\\*subject\\*\\*');
    expect(md).toContain('## Cherry / Patch-id Matches');
    expect(md).toContain('| 1 | Patch-id | - | [aaa1111](<https://dev.azure.com/MSFTDEVICES/UEFI-Intel/_git/Devices/commit/aaa1111>) | left patch subject | [bbb2222](<https://github.com/oahsiao/example/commit/bbb2222>) | right patch subject |');
    expect(md).toContain('| Patch-id content | 1 |');
    expect(md).toContain('| Fuzzy | 1 |');
    expect(md).toContain('| Unhandled unique commits | 1 | 0 | 1 |');
    expect(md).toContain('| 1 | Unique | - | [abc1234]');
    expect(md).toContain('| 2 | Fuzzy | 82% | [def5678]');
    expect(md).toContain('| 3 | Linked elsewhere | - | [aaa1111]');
    expect(md).toContain('| 4 | Linked elsewhere | - | - | - | - | [bbb2222]');
    expect(md).not.toContain('| 3 | Devices\\_TOT | [aaa1111]');
    expect(md).not.toContain('| 4 | Devices\\_BAA\\_PREEV | [bbb2222]');
  });

  it('separates commits outside the loaded peer range from unhandled uniques', () => {
    const md = buildMarkdown({
      leftName: 'LeftRepo',
      rightName: 'RightRepo',
      rows: [
        {
          left: {
            short: 'same111',
            sha: 'same111',
            linked: true,
            date: '2025-01-10',
            subject: 'shared'
          },
          right: {
            short: 'same111',
            sha: 'same111',
            linked: true,
            date: '2025-01-10',
            subject: 'shared'
          },
          link: 'common'
        },
        {
          left: {
            short: 'left222',
            sha: 'left222',
            date: '2025-01-09',
            subject: 'loaded left unique'
          },
          right: null,
          link: null
        },
        {
          left: null,
          right: {
            short: 'old3333',
            sha: 'old3333',
            date: '2024-01-01',
            subject: 'older than loaded left range'
          },
          link: null
        }
      ],
      manualLinks: [],
      fuzzyLinks: [],
      contentLinks: [],
      linkCounts: { common: 1, cherry: 0, patch: 0, manual: 0, fuzzy: 0 }
    });

    expect(md).toContain('| Unhandled unique commits | 1 | 0 | 1 |');
    expect(md).toContain('| Outside loaded range | 0 | 1 | 1 |');
    expect(md).toContain('## Outside Loaded Range');
    expect(md).toContain('| 3 | RightRepo | old3333 | 2024-01-01 | - | - | older than loaded left range | Older than loaded LeftRepo range |');
    expect(md).toContain('| 3 | Outside loaded range | - | - | - | - | old3333 | - | older than loaded left range |');
    expect(md).not.toContain('| 3 | RightRepo | old3333 | 2024-01-01 | - | - | older than loaded left range | No |');
  });
});
