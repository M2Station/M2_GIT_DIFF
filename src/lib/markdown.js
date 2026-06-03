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

// Inline spans: code, bold, italic, links, bare urls. Operates on already
// HTML-escaped text.
function inline(text) {
  let t = text;
  // inline code first so its content is not further formatted
  t = t.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
  // bold then italic
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/\b__([^_]+)__\b/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  t = t.replace(/(^|[^_])_([^_\n]+)_/g, '$1<em>$2</em>');
  // [label](url) -> styled span (non-navigating)
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, url) => {
    const safeUrl = url.replace(/"/g, '&quot;');
    return `<span class="md-link" title="${safeUrl}">${label}</span>`;
  });
  // bare urls
  t = t.replace(/(^|[\s(])((?:https?:\/\/)[^\s)]+)/g, (m, pre, url) => {
    return `${pre}<span class="md-link" title="${url}">${url}</span>`;
  });
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
