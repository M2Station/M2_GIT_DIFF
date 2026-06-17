/*
 * M2_GIT_DIFF
 * Copyright (c) 2026 OA Hsiao
 * SPDX-License-Identifier: MIT
 *
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */
import React, { useEffect, useRef, useState } from 'react';
import { renderMarkdown } from '../lib/markdown.js';
import { useT } from '../lib/i18n.js';
import CommitCodePopup from './CommitCodePopup.jsx';

// Floating commit detail viewer (Ctrl+Click a row). Header surfaces the key
// metadata (SHA / date / author) prominently; the message body is rendered as
// Markdown. When the commit is matched, a highlighted "Related item" block
// shows the paired commit on the other side. Draggable by its header and
// resizable from any edge / corner; the initial width adapts to the content.
const MIN_W = 340;
const MAX_W = 900;
const MIN_H = 220;

// Rough content-aware initial width: widen for long subjects / body lines so
// the message is comfortable to read without immediate resizing.
function initialWidth(commit) {
  const lines = [commit.subject || '', ...String(commit.body || '').split(/\r?\n/)];
  const longest = lines.reduce((m, l) => Math.max(m, l.length), 0);
  // ~7px per character + chrome padding.
  const est = Math.round(longest * 7 + 90);
  return Math.max(MIN_W, Math.min(MAX_W, est));
}

// Turn a git remote URL into the host's web base URL (no trailing slash).
// Handles https and scp-style SSH (git@host:org/repo.git) for the common
// hosts. Returns '' when the remote can't be mapped to a web URL.
function remoteWebBase(remoteUrl) {
  if (!remoteUrl) return '';
  let url = remoteUrl.trim();
  // scp-style SSH: git@github.com:org/repo.git -> https://github.com/org/repo
  const scp = url.match(/^[\w.-]+@([^:]+):(.+)$/);
  if (scp) {
    url = `https://${scp[1]}/${scp[2]}`;
  } else if (url.startsWith('ssh://')) {
    url = 'https://' + url.slice('ssh://'.length).replace(/^[^@]+@/, '');
  }
  // Strip any embedded credential (e.g. ADO's "https://<org>@dev.azure.com/...").
  // Otherwise host detection that anchors on the scheme (codeSearchUrl) breaks
  // while the looser PR/commit matchers still work — causing inconsistent links.
  url = url.replace(/^(https?:\/\/)[^/@]+@/, '$1');
  url = url.replace(/\.git$/, '').replace(/\/$/, '');
  return url;
}

// Build the web URL that shows a single commit for the detected host.
function commitWebUrl(remoteUrl, sha) {
  const base = remoteWebBase(remoteUrl);
  if (!base || !sha) return '';
  // Azure DevOps / VSTS use a query-string commit view.
  if (/dev\.azure\.com|visualstudio\.com/.test(base)) {
    return `${base}/commit/${sha}`;
  }
  if (/bitbucket\.org/.test(base)) {
    return `${base}/commits/${sha}`;
  }
  // GitHub, GitLab, Gitea and most others use /commit/<sha>.
  return `${base}/commit/${sha}`;
}

// Build the web URL for a pull/merge request number on the detected host.
// Returns '' when the remote can't be mapped to a web URL.
function pullRequestUrl(remoteUrl, number) {
  const base = remoteWebBase(remoteUrl);
  if (!base || !number) return '';
  // Azure DevOps / VSTS pull requests live under the repo's /pullrequest/<id>.
  if (/dev\.azure\.com|visualstudio\.com/.test(base)) {
    return `${base}/pullrequest/${number}`;
  }
  // GitLab uses merge requests.
  if (/gitlab\./.test(base)) {
    return `${base}/-/merge_requests/${number}`;
  }
  // Bitbucket.
  if (/bitbucket\.org/.test(base)) {
    return `${base}/pull-requests/${number}`;
  }
  // GitHub, Gitea and most others use /pull/<id>.
  return `${base}/pull/${number}`;
}

// Build a host-aware code-search URL for a reference number (e.g. a bug id like
// "#5555768"). Each host has its own search surface, so the host is detected
// automatically. Returns '' when the remote can't be mapped to a search URL.
function codeSearchUrl(remoteUrl, term) {
  const base = remoteWebBase(remoteUrl);
  if (!base || !term) return '';
  const q = encodeURIComponent(term);
  // Azure DevOps: organisation-level code search.
  let m = base.match(/^(https:\/\/dev\.azure\.com\/[^/]+)/);
  if (m) {
    return `${m[1]}/_search?text=${q}&type=code&lp=custom-Collection&filters=&pageSize=25`;
  }
  // VSTS: https://<org>.visualstudio.com
  m = base.match(/^(https:\/\/[^/]+\.visualstudio\.com)/);
  if (m) {
    return `${m[1]}/_search?text=${q}&type=code&lp=custom-Collection&filters=&pageSize=25`;
  }
  // GitHub: repo-scoped code search.
  m = base.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)/);
  if (m) {
    return `https://github.com/search?q=${encodeURIComponent(`repo:${m[1]} ${term}`)}&type=code`;
  }
  // GitLab: repo-scoped blob search.
  if (/gitlab\./.test(base)) {
    return `${base}/-/search?search=${q}&scope=blobs`;
  }
  // Bitbucket.
  if (/bitbucket\.org/.test(base)) {
    return `${base}/search?q=${q}`;
  }
  return '';
}

// Find every PR reference in a piece of text. Only the ADO merge-commit form
// "Merged PR <number>" is treated as a PR reference (e.g. the merge title
// "Merged PR 390271: ..."). Returns numeric ids as strings, de-duplicated, in
// order.
function findPRNumbers(text) {
  if (!text) return [];
  const out = [];
  const seen = new Set();
  let m;
  const re = /\bMerged\s+PR\s*#?\s*(\d+)\b/gi;
  while ((m = re.exec(text))) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      out.push(m[1]);
    }
  }
  return out;
}

// Find every "#<number>" reference in a piece of text (e.g. a bug id like
// "#5555768"), including the Azure Boards mention form "AB#5579125". These map
// to a code search rather than a PR. Avoids HTML entities such as "&#123;".
// Returns numeric ids as strings, de-duplicated.
function findSearchRefs(text) {
  if (!text) return [];
  const out = [];
  const seen = new Set();
  let m;
  const re = /(?:^|[^&\w/])(?:AB)?#(\d+)\b/gi;
  while ((m = re.exec(text))) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      out.push(m[1]);
    }
  }
  return out;
}

export default function CommitDetail({ side, commit, related, repoPath, remoteUrl, x, y, searchTerm, active, onActivate, onClose, onOpenRelated }) {
  const t = useT();
  const [size, setSize] = useState(() => {
    const w = initialWidth(commit);
    const h = Math.min(560, Math.round(window.innerHeight * 0.7));
    return { w, h };
  });
  const [pos, setPos] = useState(() => ({
    x: Math.min(Math.max(12, x), window.innerWidth - 60),
    y: Math.min(Math.max(12, y), window.innerHeight - 60)
  }));
  const [hl, setHl] = useState(searchTerm || '');
  const [toast, setToast] = useState(null);
  // Toggles the floating </> Code window that shows this commit's own diff.
  const [codeOpen, setCodeOpen] = useState(false);
  // Mirror of codeOpen for synchronous reads inside the window-level Esc handler.
  const codeOpenRef = useRef(false);
  codeOpenRef.current = codeOpen;
  // Mirror of the `active` (focused) flag for synchronous reads in the Esc handler.
  const activeRef = useRef(false);
  activeRef.current = active;
  const scrollRef = useRef(null);
  const dragRef = useRef(null);

  // Seed / sync the highlight term from the global search query, so content
  // matching the active search is highlighted automatically inside the popup.
  useEffect(() => {
    setHl(searchTerm || '');
  }, [searchTerm]);

  // Close on Escape. (Outside-click is intentionally NOT handled so multiple
  // detail windows can stay open and be interacted with independently.) When the
  // </> Code window is open it owns Escape: one Esc closes only the Code window
  // and leaves this detail open; a later Esc (Code now closed) closes this.
  // With several detail windows open, only the focused (active) one closes, so
  // Esc always targets the window the user is working in.
  const rootRef = useRef(null);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (codeOpenRef.current) return; // the Code window handles its own Esc
        if (!activeRef.current) return; // only the focused detail window closes
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
    };
  }, [onClose]);

  // Highlight all text matching the `hl` term inside this popup's scroll area.
  // Runs whenever the term or the rendered content changes. Existing marks are
  // unwrapped first so the highlight always reflects the current term.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;

    const clear = () => {
      const marks = root.querySelectorAll('mark.cd-hl');
      marks.forEach((m) => {
        const parent = m.parentNode;
        if (!parent) return;
        parent.replaceChild(document.createTextNode(m.textContent), m);
        parent.normalize();
      });
    };

    clear();
    const term = hl.trim();
    if (!term) return;

    const lower = term.toLowerCase();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        if (!node.nodeValue || !node.nodeValue.toLowerCase().includes(lower)) {
          return NodeFilter.FILTER_REJECT;
        }
        const p = node.parentNode;
        if (p && (p.nodeName === 'SCRIPT' || p.nodeName === 'STYLE' || p.nodeName === 'MARK')) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    const targets = [];
    let n;
    while ((n = walker.nextNode())) targets.push(n);

    targets.forEach((node) => {
      const text = node.nodeValue;
      const frag = document.createDocumentFragment();
      let i = 0;
      let idx;
      const low = text.toLowerCase();
      while ((idx = low.indexOf(lower, i)) !== -1) {
        if (idx > i) frag.appendChild(document.createTextNode(text.slice(i, idx)));
        const mark = document.createElement('mark');
        mark.className = 'cd-hl';
        mark.textContent = text.slice(idx, idx + term.length);
        frag.appendChild(mark);
        i = idx + term.length;
      }
      if (i < text.length) frag.appendChild(document.createTextNode(text.slice(i)));
      node.parentNode.replaceChild(frag, node);
    });
  }, [hl, commit, related]);

  const onDragStart = (e) => {
    if (e.target.closest('button')) return;
    e.preventDefault();
    dragRef.current = { sx: e.clientX, sy: e.clientY, bx: pos.x, by: pos.y };
    const onMove = (ev) => {
      const d = dragRef.current;
      if (!d) return;
      setPos({
        x: Math.min(Math.max(-(size.w - 60), d.bx + (ev.clientX - d.sx)), window.innerWidth - 60),
        y: Math.min(Math.max(0, d.by + (ev.clientY - d.sy)), window.innerHeight - 40)
      });
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // Resize from an edge or corner. `dir` is a string of e/w/n/s flags.
  const onResizeStart = (dir) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    const start = {
      mx: e.clientX,
      my: e.clientY,
      w: size.w,
      h: size.h,
      x: pos.x,
      y: pos.y
    };
    const maxH = window.innerHeight - 20;
    const onMove = (ev) => {
      const dx = ev.clientX - start.mx;
      const dy = ev.clientY - start.my;
      let { w, h, x: nx, y: ny } = start;
      if (dir.includes('e')) w = start.w + dx;
      if (dir.includes('s')) h = start.h + dy;
      if (dir.includes('w')) {
        w = start.w - dx;
        nx = start.x + dx;
      }
      if (dir.includes('n')) {
        h = start.h - dy;
        ny = start.y + dy;
      }
      // clamp width; keep the anchored edge fixed when shrinking from w/n
      if (w < MIN_W) {
        if (dir.includes('w')) nx = start.x + (start.w - MIN_W);
        w = MIN_W;
      } else if (w > MAX_W) {
        if (dir.includes('w')) nx = start.x + (start.w - MAX_W);
        w = MAX_W;
      }
      if (h < MIN_H) {
        if (dir.includes('n')) ny = start.y + (start.h - MIN_H);
        h = MIN_H;
      } else if (h > maxH) {
        if (dir.includes('n')) ny = start.y + (start.h - maxH);
        h = maxH;
      }
      setSize({ w, h });
      setPos({ x: nx, y: ny });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  if (!commit) return null;

  const sideName = side === 'L' ? t('common.left') : t('common.right');
  const statusLabel = {
    common: t('detail.statusCommon'),
    cherry: t('detail.statusCherry'),
    unique: t('detail.statusUnique')
  }[commit.status] || commit.status;

  // Open the commit in a NEW VS Code chat session. The main process builds an
  // English context document (commit metadata + full `git show` diff), attaches
  // it to a fresh session via `code chat -n --add-file`, and leaves the input
  // empty so the user types their own prompt. We pass the commit fields the
  // context builder needs — no pre-built prompt.
  const openInChat = async () => {
    if (!window.api?.openInVSCodeChat) {
      setToast(t('detail.toastVSCodeOnly'));
      return;
    }
    try {
      await window.api.openInVSCodeChat({
        repoPath,
        mode: 'agent',
        commit: {
          sha: commit.sha,
          short: commit.short,
          subject: commit.subject,
          author: commit.author,
          authorEmail: commit.authorEmail,
          authorDate: commit.authorDate,
          body: commit.body
        }
      });
    } catch (e) {
      if (e && (e.code === 'VSCODE_NOT_FOUND' || /VSCODE_NOT_FOUND/.test(e.message || ''))) {
        setToast(t('detail.toastVSCodeNotFound'));
      } else {
        setToast(t('detail.toastVSCodeFail', { msg: e?.message || e }));
      }
    }
  };

  // Auto-dismiss the toast after a few seconds.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  // Web URL for this commit on the repo's remote host (GitHub / ADO / GitLab /
  // Bitbucket). Empty when the repo has no http(s)-mappable remote.
  const webUrl = commitWebUrl(remoteUrl, commit.sha);

  // Open the commit's web page in the default browser via the main process.
  const openCommitOnWeb = async () => {
    if (!webUrl) return;
    if (window.api?.openExternal) {
      try {
        await window.api.openExternal(webUrl);
        return;
      } catch (e) {
        setToast(t('detail.toastWebFail', { msg: e?.message || e }));
        return;
      }
    }
    window.open(webUrl, '_blank', 'noopener');
  };

  // Collect PR references for this commit. The merge title (subject) is the
  // strongest reference point (e.g. "Merged PR 390569: ..."), so scan it first,
  // then the body. Only keep numbers that map to a web URL on this remote.
  const refText = `${commit.subject || ''}\n${commit.body || ''}`;
  const prLinks = findPRNumbers(refText)
    .map((n) => ({ n, url: pullRequestUrl(remoteUrl, n) }))
    .filter((p) => p.url);

  // Bare "#<n>" references (e.g. bug ids) become host-aware code searches.
  const searchLinks = findSearchRefs(refText)
    .map((n) => ({ n, url: codeSearchUrl(remoteUrl, n) }))
    .filter((p) => p.url);

  // Open any page in the default browser via the main process.
  const openUrlOnWeb = async (url) => {
    if (!url) return;
    if (window.api?.openExternal) {
      try {
        await window.api.openExternal(url);
        return;
      } catch (e) {
        setToast(t('detail.toastWebFail', { msg: e?.message || e }));
        return;
      }
    }
    window.open(url, '_blank', 'noopener');
  };

  return (
    <>
    <div
      ref={rootRef}
      className="commit-detail"
      style={{ left: pos.x, top: pos.y, width: size.w, height: size.h, zIndex: active ? 76 : 75 }}
      onClick={(e) => e.stopPropagation()}
      onPointerDownCapture={onActivate}
    >
      <div className="cd-header" onPointerDown={onDragStart}>
        <span className={'cd-side ' + side}>{sideName}</span>
        <span className={'cd-status ' + commit.status}>{statusLabel}</span>
        <span className="cd-spacer" />
        <input
          className="cd-hl-input"
          type="text"
          value={hl}
          placeholder={t('detail.hlPlaceholder')}
          title={t('detail.hlTitle')}
          onChange={(e) => setHl(e.target.value)}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setHl(''); } }}
        />
        <button
          className="cd-chat"
          onClick={openInChat}
          onPointerDown={(e) => e.stopPropagation()}
          title={t('detail.chatTitle')}
          aria-label={t('detail.chatAria')}
        >
          <svg
            className="cd-chat-ico"
            viewBox="0 0 100 100"
            width="14"
            height="14"
            fill="currentColor"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M70.9 99.3a6.2 6.2 0 0 0 5-.2l21-10.1a6.3 6.3 0 0 0 3.6-5.7V16.7a6.3 6.3 0 0 0-3.6-5.7l-21-10.1a6.3 6.3 0 0 0-7.2 1.2L28.6 35.9 10.3 22a4.2 4.2 0 0 0-5.4.3L.4 26.4a4.2 4.2 0 0 0 0 6.2L16.3 50 .4 67.4a4.2 4.2 0 0 0 0 6.2l4.5 4.1a4.2 4.2 0 0 0 5.4.3l18.3-13.9 40.1 34.4a6.3 6.3 0 0 0 2.2 1zM75.2 27.3 44.8 50l30.4 22.7V27.3z" />
          </svg>
          <span className="cd-chat-label">{t('detail.chat')}</span>
        </button>
        <button className="cd-close" onClick={onClose} title={t('common.closeEsc')} aria-label={t('common.close')}>
          ✕
        </button>
      </div>

      {toast && (
        <div className="cd-toast" role="alert" onPointerDown={(e) => e.stopPropagation()}>
          <span>{toast}</span>
          <button className="cd-toast-x" onClick={() => setToast(null)} aria-label={t('detail.dismiss')}>✕</button>
        </div>
      )}

      <div className="cd-scroll" ref={scrollRef}>
      {/* prominent metadata block */}
      <div className="cd-meta">
        <div className="cd-meta-row">
          <span className="cd-key">SHA</span>
          <span className="cd-sha" title={commit.sha}>{commit.short}</span>
          <span className="cd-sha-full">{commit.sha}</span>
          <button
            type="button"
            className={'cd-sha-link cd-code-link' + (codeOpen ? ' on' : '')}
            onClick={() => setCodeOpen((v) => !v)}
            onPointerDown={(e) => e.stopPropagation()}
            title={t('detail.codeTitle')}
            aria-label={t('detail.codeAria')}
            aria-pressed={codeOpen}
          >
            {t('detail.code')}
          </button>
          {webUrl && (
            <button
              type="button"
              className="cd-sha-link"
              onClick={openCommitOnWeb}
              onPointerDown={(e) => e.stopPropagation()}
              title={t('detail.webTitle', { url: webUrl })}
              aria-label={t('detail.webAria')}
            >
              {t('detail.web')}
            </button>
          )}
          {prLinks.map((p) => (
            <button
              key={p.n}
              type="button"
              className="cd-sha-link cd-pr-link"
              onClick={() => openUrlOnWeb(p.url)}
              onPointerDown={(e) => e.stopPropagation()}
              title={t('detail.prTitle', { n: p.n, url: p.url })}
              aria-label={t('detail.prAria', { n: p.n })}
            >
              {t('detail.pr', { n: p.n })}
            </button>
          ))}
          {searchLinks.map((p) => (
            <button
              key={`s-${p.n}`}
              type="button"
              className="cd-sha-link cd-search-link"
              onClick={() => openUrlOnWeb(p.url)}
              onPointerDown={(e) => e.stopPropagation()}
              title={t('detail.searchTitle', { n: p.n, url: p.url })}
              aria-label={t('detail.searchAria', { n: p.n })}
            >
              {t('detail.search', { n: p.n })}
            </button>
          ))}
        </div>
        <div className="cd-meta-row">
          <span className="cd-key">{t('detail.author')}</span>
          <span className="cd-author">{commit.author}</span>
          {commit.authorEmail && <span className="cd-email">&lt;{commit.authorEmail}&gt;</span>}
        </div>
        <div className="cd-meta-row">
          <span className="cd-key">{t('detail.date')}</span>
          <span className="cd-date">{commit.authorDate}</span>
        </div>
      </div>

      <div className="cd-subject">{commit.subject}</div>

      {/* related item highlight */}
      {related ? (
        <div className={'cd-related ' + (related.commit.status || '')}>
          <div className="cd-related-head">
            {t('detail.relatedItem', { side: related.side === 'L' ? t('common.left') : t('common.right') })}
            <span className={'cd-related-type ' + related.type}>{related.type}</span>
          </div>
          <button
            type="button"
            className="cd-related-body"
            onClick={() => onOpenRelated(related.side, related.commit.sha)}
            title={t('detail.relatedBodyTitle')}
          >
            <span className="cd-related-sha">{related.commit.short}</span>
            <span className="cd-related-subject">{related.commit.subject}</span>
            <span className="cd-related-meta">
              {related.commit.author} · {related.commit.authorDate}
            </span>
          </button>
        </div>
      ) : (
        <div className="cd-related none">{t('detail.noRelated', { side: sideName })}</div>
      )}

      <div className="cd-body-label">{t('detail.commitMessage')}</div>
      <div
        className="cd-body md"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(commit.body || t('detail.emptyBody')) }}
      />
      </div>

      {/* resize handles: 4 edges + 4 corners */}
      <div className="cd-rz cd-rz-n" onPointerDown={onResizeStart('n')} />
      <div className="cd-rz cd-rz-s" onPointerDown={onResizeStart('s')} />
      <div className="cd-rz cd-rz-e" onPointerDown={onResizeStart('e')} />
      <div className="cd-rz cd-rz-w" onPointerDown={onResizeStart('w')} />
      <div className="cd-rz cd-rz-ne" onPointerDown={onResizeStart('ne')} />
      <div className="cd-rz cd-rz-nw" onPointerDown={onResizeStart('nw')} />
      <div className="cd-rz cd-rz-se" onPointerDown={onResizeStart('se')} />
      <div className="cd-rz cd-rz-sw" onPointerDown={onResizeStart('sw')} />
    </div>
    {codeOpen && (
      <CommitCodePopup
        side={side}
        commit={commit}
        repoPath={repoPath}
        x={pos.x + 28}
        y={pos.y + 28}
        onClose={() => setCodeOpen(false)}
      />
    )}
    </>
  );
}
