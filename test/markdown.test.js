/*
 * M2_GIT_DIFF
 * Copyright (c) 2026 OA Hsiao
 * SPDX-License-Identifier: MIT
 *
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */
import { describe, it, expect } from 'vitest';
import { renderMarkdown } from '../src/lib/markdown.js';

describe('renderMarkdown — security (HTML escaping)', () => {
  it('escapes raw HTML so script tags cannot be injected', () => {
    const html = renderMarkdown('<script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes angle brackets and quotes inside text', () => {
    const html = renderMarkdown('a < b && c > d "quoted"');
    expect(html).toContain('&lt;');
    expect(html).toContain('&gt;');
    expect(html).toContain('&amp;');
    expect(html).toContain('&quot;');
  });

  it('renders links as non-navigating spans (no href)', () => {
    const html = renderMarkdown('[click](https://example.com/x)');
    expect(html).toContain('md-link');
    expect(html).toContain('click');
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('href');
  });
});

describe('renderMarkdown — inline formatting', () => {
  it('renders bold and italic', () => {
    expect(renderMarkdown('**bold**')).toContain('<strong>bold</strong>');
    expect(renderMarkdown('*italic*')).toContain('<em>italic</em>');
  });

  it('keeps underscores inside snake_case identifiers', () => {
    const html = renderMarkdown('GPIO_PIN_NFC_3P3V_EN');
    expect(html).toContain('GPIO_PIN_NFC_3P3V_EN');
    expect(html).not.toContain('<em>');
  });

  it('renders inline code verbatim', () => {
    const html = renderMarkdown('use `git show` here');
    expect(html).toContain('<code>git show</code>');
  });

  it('underlines the number after "Merged PR"', () => {
    const html = renderMarkdown('Merged PR 390920');
    expect(html).toContain('<span class="md-num">390920</span>');
  });
});

describe('renderMarkdown — block structure', () => {
  it('renders headings at the right level', () => {
    expect(renderMarkdown('# Title')).toContain('<h1 class="md-h">Title</h1>');
    expect(renderMarkdown('### Sub')).toContain('<h3 class="md-h">Sub</h3>');
  });

  it('renders fenced code blocks without interpreting their content', () => {
    const html = renderMarkdown('```\n**not bold**\n```');
    expect(html).toContain('<pre class="md-pre"><code>');
    expect(html).toContain('**not bold**');
    expect(html).not.toContain('<strong>');
  });

  it('renders unordered list items', () => {
    const html = renderMarkdown('- one\n- two');
    expect(html).toContain('<ul class="md-list">');
    expect(html).toContain('<li>one</li>');
    expect(html).toContain('<li>two</li>');
  });

  it('wraps plain text in a paragraph', () => {
    expect(renderMarkdown('just a line')).toContain('<p class="md-p">just a line</p>');
  });

  it('returns an empty string for empty input', () => {
    expect(renderMarkdown('')).toBe('');
  });
});
