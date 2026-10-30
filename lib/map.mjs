// System map state and markup, pure (docs/FOUNDATION.md §2.7). A node is lit when ANY
// level that lights it is completed, an edge when both its ends are lit, and a node
// pulses while a boss that lights it is open (the current incident).
import { escapeHtml } from './lesson-kit.mjs';
import { nodeLitBy } from './registry.mjs';
import { isCompleted, levelState } from './unlock.mjs';

const NODE_R = 2.6;
const LABEL_DY = 5.4; // label baseline below the node centre

/**
 * → { nodes: { [id]: {lit, pulse} } (null-prototype), edges: [{from, to, lit}] } for the
 * §2.4 registry and the §2.5 progress view.
 */
export function nodeStates(registry, progress, nodes, edges) {
  const out = Object.create(null);
  for (const n of nodes) {
    const by = nodeLitBy(registry, n.id);
    out[n.id] = {
      lit: by.some((id) => isCompleted(progress, id)),
      pulse: by.some(
        (id) => registry.levels[id].kind === 'boss' && levelState(id, progress, registry) === 'open',
      ),
    };
  }
  return {
    nodes: out,
    edges: edges.map((e) => ({ from: e.from, to: e.to, lit: !!(out[e.from]?.lit && out[e.to]?.lit) })),
  };
}

const cls = (...names) => names.filter(Boolean).join(' ');

/**
 * Inner SVG markup for `state` (from nodeStates): edges first, then nodes, so nodes draw
 * on top. Positions are attributes only (the CSP has no style-src 'unsafe-inline');
 * state is in classes (`lit`, `pulse`, `kind-<kind>`), styled by styles/hub.css.
 */
export function renderMap(state, nodes, edges) {
  const at = Object.create(null);
  for (const n of nodes) at[n.id] = n;
  const lines = edges.map((e, i) => {
    const a = at[e.from];
    const b = at[e.to];
    const lit = state.edges[i]?.lit;
    return `<line class="${cls('edge', lit && 'lit')}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"></line>`;
  });
  const dots = nodes.map((n) => {
    const s = state.nodes[n.id] ?? {};
    const label = escapeHtml(n.label);
    return (
      `<g class="${cls('node', `kind-${n.kind}`, s.lit && 'lit', s.pulse && 'pulse')}" data-node="${escapeHtml(n.id)}">` +
      `<title>${label}${s.lit ? ' (lit)' : ''}${s.pulse ? ' (incident)' : ''}</title>` +
      `<circle cx="${n.x}" cy="${n.y}" r="${NODE_R}"></circle>` +
      `<text x="${n.x}" y="${n.y + LABEL_DY}" text-anchor="middle">${label}</text></g>`
    );
  });
  return `<g class="edges">${lines.join('')}</g><g class="nodes">${dots.join('')}</g>`;
}
