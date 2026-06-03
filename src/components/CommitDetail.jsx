import React, { useEffect, useRef, useState } from 'react';
import { renderMarkdown } from '../lib/markdown.js';

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

export default function CommitDetail({ side, commit, related, x, y, searchTerm, onClose, onOpenRelated }) {
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
  const scrollRef = useRef(null);
  const dragRef = useRef(null);

  // Seed / sync the highlight term from the global search query, so content
  // matching the active search is highlighted automatically inside the popup.
  useEffect(() => {
    setHl(searchTerm || '');
  }, [searchTerm]);

  // Close on Escape. (Outside-click is intentionally NOT handled so multiple
  // detail windows can stay open and be interacted with independently.)
  const rootRef = useRef(null);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
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

  const sideName = side === 'L' ? 'LEFT' : 'RIGHT';
  const statusLabel = {
    common: 'Common · 相同 SHA',
    cherry: 'Cherry-pick · 相同內容',
    unique: 'Unique · 單側獨有'
  }[commit.status] || commit.status;

  return (
    <div
      ref={rootRef}
      className="commit-detail"
      style={{ left: pos.x, top: pos.y, width: size.w, height: size.h }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="cd-header" onPointerDown={onDragStart}>
        <span className={'cd-side ' + side}>{sideName}</span>
        <span className={'cd-status ' + commit.status}>{statusLabel}</span>
        <span className="cd-spacer" />
        <input
          className="cd-hl-input"
          type="text"
          value={hl}
          placeholder="HL…"
          title="高亮符合的字"
          onChange={(e) => setHl(e.target.value)}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setHl(''); } }}
        />
        <button className="cd-close" onClick={onClose} title="Close (Esc)" aria-label="Close">
          ✕
        </button>
      </div>

      <div className="cd-scroll" ref={scrollRef}>
      {/* prominent metadata block */}
      <div className="cd-meta">
        <div className="cd-meta-row">
          <span className="cd-key">SHA</span>
          <span className="cd-sha" title={commit.sha}>{commit.short}</span>
          <span className="cd-sha-full">{commit.sha}</span>
        </div>
        <div className="cd-meta-row">
          <span className="cd-key">作者</span>
          <span className="cd-author">{commit.author}</span>
          {commit.authorEmail && <span className="cd-email">&lt;{commit.authorEmail}&gt;</span>}
        </div>
        <div className="cd-meta-row">
          <span className="cd-key">日期</span>
          <span className="cd-date">{commit.authorDate}</span>
        </div>
      </div>

      <div className="cd-subject">{commit.subject}</div>

      {/* related item highlight */}
      {related ? (
        <div className={'cd-related ' + (related.commit.status || '')}>
          <div className="cd-related-head">
            🔗 Related item · {related.side === 'L' ? 'LEFT' : 'RIGHT'}
            <span className={'cd-related-type ' + related.type}>{related.type}</span>
          </div>
          <button
            type="button"
            className="cd-related-body"
            onClick={() => onOpenRelated(related.side, related.commit.sha)}
            title="點選查看對應 Commit 詳情"
          >
            <span className="cd-related-sha">{related.commit.short}</span>
            <span className="cd-related-subject">{related.commit.subject}</span>
            <span className="cd-related-meta">
              {related.commit.author} · {related.commit.authorDate}
            </span>
          </button>
        </div>
      ) : (
        <div className="cd-related none">無對應項目（此 Commit 僅存在於 {sideName}）</div>
      )}

      <div className="cd-body-label">Commit message</div>
      <div
        className="cd-body md"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(commit.body || '_（無內文）_') }}
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
  );
}
