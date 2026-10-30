// The system map's lit / pulse state and its SVG markup. Spec: docs/FOUNDATION.md §2.7
// and §6 F5 map.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { buildRegistry } from '../lib/registry.mjs';
import { emptyProgress } from '../lib/progress.mjs';
import { nodeStates, renderMap } from '../lib/map.mjs';

const NODES = [
  { id: 'cart', label: 'Cart', kind: 'service', x: 10, y: 10 },
  { id: 'checkout', label: 'Checkout', kind: 'service', x: 30, y: 10 },
  { id: 'payments', label: 'Payments <&>', kind: 'service', x: 50, y: 10 },
  { id: 'postgres', label: 'Postgres', kind: 'datastore', x: 70, y: 40 },
];
const EDGES = [
  { from: 'checkout', to: 'payments' },
  { from: 'cart', to: 'checkout' },
  { from: 'payments', to: 'postgres' },
];
const L = (id, no, extra = {}) => ({
  id, no, name: id, icon: '*', rewardTitle: `t-${id}`, mechanics: ['query'], run() {}, ...extra,
});
const REG = buildRegistry(
  [{
    id: 'a0',
    no: 0,
    levels: [L('a', '0.1', { lights: ['checkout', 'payments'] }), L('b', '0.2', { lights: ['checkout'] })],
    boss: L('boss', null, { lights: ['cart'] }),
  }],
  { deck: [], nodeIds: NODES.map((n) => n.id) },
);

function progress(levels) {
  const p = emptyProgress();
  for (const [id, stars] of Object.entries(levels)) p.levels[id] = { stars, at: null };
  return p;
}
const edge = (s, from, to) => s.edges.find((e) => e.from === from && e.to === to);

test('a node is lit when ANY level lighting it is completed', () => {
  const s = nodeStates(REG, progress({ b: 1 }), NODES, EDGES);
  assert.equal(s.nodes.checkout.lit, true);
  assert.equal(s.nodes.payments.lit, false);
});

test('an edge is lit only when both ends are lit', () => {
  assert.equal(edge(nodeStates(REG, progress({ b: 1 }), NODES, EDGES), 'checkout', 'payments').lit, false);
  assert.equal(edge(nodeStates(REG, progress({ a: 0, b: 1 }), NODES, EDGES), 'checkout', 'payments').lit, true);
});

test('a node no level lights stays dark', () => {
  const s = nodeStates(REG, progress({ a: 3, b: 3, boss: 3 }), NODES, EDGES);
  assert.equal(s.nodes.postgres.lit, false);
  assert.equal(edge(s, 'payments', 'postgres').lit, false);
});

test('an open boss makes its nodes pulse; done, it stops', () => {
  assert.equal(nodeStates(REG, progress({}), NODES, EDGES).nodes.cart.pulse, false, 'locked boss');
  const open = nodeStates(REG, progress({ a: 3, b: 3 }), NODES, EDGES);
  assert.equal(open.nodes.cart.pulse, true);
  assert.equal(open.nodes.cart.lit, false);
  const done = nodeStates(REG, progress({ a: 3, b: 3, boss: 2 }), NODES, EDGES);
  assert.equal(done.nodes.cart.pulse, false);
  assert.equal(done.nodes.cart.lit, true);
});

test('renderMap positions with attributes only, escapes labels and marks state in classes', () => {
  const s = nodeStates(REG, progress({ a: 3, b: 3 }), NODES, EDGES);
  const { document } = parseHTML(`<svg xmlns="http://www.w3.org/2000/svg">${renderMap(s, NODES, EDGES)}</svg>`);
  const all = [...document.querySelectorAll('*')];
  assert.ok(all.every((el) => !el.hasAttribute('style')), 'no style attribute');
  const pay = document.querySelector('[data-node="payments"]');
  assert.match(pay.getAttribute('class'), /\blit\b/);
  assert.equal(pay.querySelector('circle').getAttribute('cx'), '50');
  assert.equal(pay.querySelector('text').textContent, 'Payments <&>');
  assert.match(document.querySelector('[data-node="cart"]').getAttribute('class'), /\bpulse\b/);
  assert.doesNotMatch(document.querySelector('[data-node="postgres"]').getAttribute('class'), /\blit\b/);
  const lines = [...document.querySelectorAll('line')];
  assert.equal(lines.length, EDGES.length);
  assert.equal(lines.filter((l) => /\blit\b/.test(l.getAttribute('class'))).length, 1);
});

test('renderMap escapes labels, ids and kinds, and coerces positions to numbers', () => {
  const nodes = [{
    id: '"><g id="pwn-id"></g>',
    label: '</text><g id="pwn"></g>',
    kind: '"><g id="pwn-kind"></g>',
    x: '5" onload="alert(1)',
    y: 7,
  }];
  const state = { nodes: { [nodes[0].id]: { lit: true, pulse: false } }, edges: [] };
  const markup = renderMap(state, nodes, []);
  const { document } = parseHTML(`<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`);
  for (const id of ['pwn', 'pwn-id', 'pwn-kind']) {
    // A boolean, so a failure never prints a linkedom node (huge and slow to inspect).
    assert.equal(document.getElementById(id) === null, true, `#${id} was injected`);
  }
  assert.ok(markup.includes('&lt;/text&gt;'), 'label is escaped');
  assert.ok(markup.includes('data-node="&quot;&gt;&lt;g'), 'data-node is escaped');
  assert.ok(markup.includes('kind-&quot;&gt;&lt;g'), 'kind is escaped');
  assert.ok(!markup.includes('onload'), 'a position cannot carry markup');
  assert.equal(document.querySelector('circle').getAttribute('cy'), '7');
  assert.equal(document.querySelector('circle').getAttribute('cx'), '0', 'non-numeric x is clamped to 0');
});

test('renderMap clamps non-finite coordinates to 0 instead of emitting NaN or Infinity', () => {
  const nodes = [
    { id: 'a', label: 'A', kind: 'service', x: Infinity, y: NaN },
    { id: 'b', label: 'B', kind: 'service', x: -Infinity, y: 1e400 },
  ];
  const state = { nodes: { a: { lit: false }, b: { lit: false } }, edges: [{ lit: false }] };
  const markup = renderMap(state, nodes, [{ from: 'a', to: 'b' }]);
  assert.doesNotMatch(markup, /NaN|Infinity/);
  assert.match(markup, /<line class="edge" x1="0" y1="0" x2="0" y2="0">/);
  assert.match(markup, /<circle cx="0" cy="0" /);
});

test('two bosses open at once (one act open only by entry) both pulse', () => {
  const reg = buildRegistry(
    [
      { id: 'a0', no: 0, levels: [L('l0', '0.1')], boss: L('boss0', null, { lights: ['cart'] }) },
      { id: 'a1', no: 1, levels: [L('l1a', '1.1'), L('l1b', '1.2')], boss: L('boss1', null, { lights: ['payments'] }) },
    ],
    { deck: [], nodeIds: NODES.map((n) => n.id) },
  );
  const s = nodeStates(reg, progress({ l0: 3, l1a: 3, l1b: 3 }), NODES, EDGES);
  assert.equal(s.nodes.cart.pulse, true);
  assert.equal(s.nodes.payments.pulse, true);
  assert.equal(s.nodes.checkout.pulse, false);
});
