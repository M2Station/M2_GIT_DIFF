import React from 'react';

function highlight(text, query) {
  if (!query || !text) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark>{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

function shortDate(iso) {
  if (!iso) return '';
  // iso-strict like 2026-06-03T12:34:56+08:00
  return iso.slice(0, 10);
}

export default function CommitRow({ commit, side, query, dimmed, isHit, selected, height, top, onSelect, manualLinked, pending, onNode, activeHit }) {
  const cls = [
    'commit-row',
    commit.status, // common | cherry | unique
    dimmed ? 'dimmed' : '',
    isHit ? 'hit' : '',
    activeHit ? 'active-hit' : '',
    selected ? 'selected' : '',
    commit.matchId ? 'linkable' : '',
    manualLinked ? 'manual' : ''
  ]
    .filter(Boolean)
    .join(' ');

  const handleClick = (e) => {
    e.stopPropagation();
    if (commit.matchId) onSelect(selected ? null : commit.matchId);
  };

  // Only unmatched commits expose a node to draw a manual link from/to.
  const showNode = commit.status === 'unique' && typeof onNode === 'function';
  const handleNode = (e) => {
    e.stopPropagation();
    onNode(side, commit.sha);
  };
  const nodeCls = [
    'node-handle',
    `node-${side}`,
    manualLinked ? 'linked' : '',
    pending ? 'pending' : ''
  ]
    .filter(Boolean)
    .join(' ');
  const nodeTitle = manualLinked
    ? 'Click to disconnect this manual link'
    : pending
    ? 'Pick a node on the other side to link · Esc to cancel'
    : 'Click to start a manual link';

  const title = `${commit.short}  ${commit.subject}\n${commit.author} · ${commit.authorDate}\n${commit.body || ''}`;

  return (
    <div className={cls} style={{ height, top }} onClick={handleClick} title={title} data-side={side}>
      <span className="sha">{highlight(commit.short, query)}</span>
      <span className="date">{shortDate(commit.authorDate)}</span>
      <span className="subject">{highlight(commit.subject, query)}</span>
      <span className="author">{commit.author}</span>
      {showNode && (
        <button type="button" className={nodeCls} onClick={handleNode} title={nodeTitle} aria-label={nodeTitle} />
      )}
    </div>
  );
}
