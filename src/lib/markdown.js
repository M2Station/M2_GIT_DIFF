/*
 * M2_GIT_DIFF
 * Copyright (c) 2026 OA Hsiao
 * SPDX-License-Identifier: MIT
 *
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */
// Tiny, dependency-free Markdown -> HTML renderer for commit messages.
// Security: the raw text is HTML-escaped FIRST, so no user content can inject
// markup; only our own generated tags are added afterwards. Links are rendered
// as non-navigating styled spans (the URL shows in the tooltip) to avoid the
// Electron window navigating away.

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Underline ONLY the numbers that identify a PR or a work item, so they are
// easy to pick out by eye: the number after `Merged PR` and each `#<id>` in a
// `Related work items:` list. All other numbers are left untouched. Skips
// anything inside HTML tags (URLs / attributes) and inside <code> spans.
function underlineNumbers(html) {
  const parts = html.split(/(<[^>]+>)/);
  let inCode = 0;
  for (let k = 0; k < parts.length; k++) {
    const seg = parts[k];
    if (!seg) continue;
    if (seg[0] === '<') {
      if (/^<code(\s|>)/i.test(seg)) inCode++;
      else if (/^<\/code>/i.test(seg)) inCode = Math.max(0, inCode - 1);
      continue; // never touch tag markup
    }
    if (inCode > 0) continue;
    let s = seg;
    // "Merged PR 390920" / "Merged PR #390920"
    s = s.replace(/\b(Merged\s+PR\s+#?)(\d+)/gi, (_, p, n) => `${p}<span class="md-num">${n}</span>`);
    // "Related work items: #5503049, #5503050, ..." — underline every id after
    // the label to the end of this text run.
    s = s.replace(/(Related\s+work\s+items:\s*)(.*)$/i, (_, label, list) => {
      const wrapped = list.replace(/(#?)(\d+)/g, (m, h, n) => `${h}<span class="md-num">${n}</span>`);
      return `${label}${wrapped}`;
    });
    parts[k] = s;
  }
  return parts.join('');
}

// Inline spans: code, bold, italic, links, bare urls. Operates on already
// HTML-escaped text.
function inline(text) {
  // Protect inline code spans by swapping them for placeholders BEFORE running
  // emphasis / link / url passes, otherwise underscores or asterisks inside a
  // `code_span` (e.g. `GPIO_PIN_NFC_3P3V_EN`) get eaten as <em>/<strong> and the
  // content looks corrupted or truncated. Restored verbatim at the end.
  const codeSpans = [];
  let t = text.replace(/`([^`]+)`/g, (_, c) => {
    codeSpans.push(c);
    return `\u0001${codeSpans.length - 1}\u0001`;
  });
  // bold then italic. Underscore emphasis only fires at word boundaries so
  // snake_case identifiers (e.g. build_version.json, 1064_BAA) keep their
  // underscores instead of being swallowed into <em>/<strong>.
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^\w])__([^_]+)__(?=[^\w]|$)/g, '$1<strong>$2</strong>');
  t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  t = t.replace(/(^|[^\w])_([^_\n]+)_(?=[^\w]|$)/g, '$1<em>$2</em>');
  // [label](url) -> styled span (non-navigating)
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, url) => {
    const safeUrl = url.replace(/"/g, '&quot;');
    return `<span class="md-link" title="${safeUrl}">${label}</span>`;
  });
  // bare urls
  t = t.replace(/(^|[\s(])((?:https?:\/\/)[^\s)]+)/g, (m, pre, url) => {
    return `${pre}<span class="md-link" title="${url}">${url}</span>`;
  });
  // restore protected inline code spans verbatim
  t = t.replace(/\u0001(\d+)\u0001/g, (_, i) => `<code>${codeSpans[Number(i)]}</code>`);
  // underline numbers last so it sees final markup (and skips code / tags)
  t = underlineNumbers(t);
  return t;
}

// Block-level renderer. Supports headings, fenced & indented code, blockquotes,
// unordered / ordered lists, horizontal rules, and paragraphs.
export function renderMarkdown(src = '') {
  const lines = escapeHtml(src).split(/\r?\n/);
  const out = [];
  let i = 0;
  let listType = null; // 'ul' | 'ol' | null

  const closeList = () => {
    if (listType) {
      out.push(`</${listType}>`);
      listType = null;
    }
  };

  while (i < lines.length) {
    const line = lines[i];

    // fenced code block ``` ... ```
    const fence = line.match(/^\s*```(.*)$/);
    if (fence) {
      closeList();
      const buf = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      out.push(`<pre class="md-pre"><code>${buf.join('\n')}</code></pre>`);
      continue;
    }

    // blank line
    if (/^\s*$/.test(line)) {
      closeList();
      i++;
      continue;
    }

    // horizontal rule
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      closeList();
      out.push('<hr class="md-hr" />');
      i++;
      continue;
    }

    // heading
    const h = line.match(/^\s*(#{1,6})\s+(.*)$/);
    if (h) {
      closeList();
      const lvl = h[1].length;
      out.push(`<h${lvl} class="md-h">${inline(h[2].trim())}</h${lvl}>`);
      i++;
      continue;
    }

    // blockquote
    const bq = line.match(/^\s*>\s?(.*)$/);
    if (bq) {
      closeList();
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      out.push(`<blockquote class="md-quote">${inline(buf.join(' '))}</blockquote>`);
      continue;
    }

    // unordered list item
    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    if (ul) {
      if (listType !== 'ul') {
        closeList();
        out.push('<ul class="md-list">');
        listType = 'ul';
      }
      out.push(`<li>${inline(ul[1])}</li>`);
      i++;
      continue;
    }

    // ordered list item
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ol) {
      if (listType !== 'ol') {
        closeList();
        out.push('<ol class="md-list">');
        listType = 'ol';
      }
      out.push(`<li>${inline(ol[1])}</li>`);
      i++;
      continue;
    }

    // paragraph: gather consecutive non-blank, non-special lines
    closeList();
    const buf = [line];
    i++;
    while (
      i < lines.length &&
      !/^\s*$/.test(lines[i]) &&
      !/^\s*(#{1,6})\s+/.test(lines[i]) &&
      !/^\s*[-*+]\s+/.test(lines[i]) &&
      !/^\s*\d+[.)]\s+/.test(lines[i]) &&
      !/^\s*>\s?/.test(lines[i]) &&
      !/^\s*```/.test(lines[i])
    ) {
      buf.push(lines[i]);
      i++;
    }
    out.push(`<p class="md-p">${inline(buf.join('<br />'))}</p>`);
  }

  closeList();
  return out.join('\n');
}
