// The hub's responsive layout (#313 P4): map and levels side by side from 1024px, a sticky
// map only where it fits, two cards per row from a 640px container, a stage that never overflows.
// Static: the stylesheet is parsed, never laid out; the pixel checks are a browser job.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { read, rules, decls } from './helpers/css.mjs';

const R = rules(read('styles/hub.css'));
const at = (selector, ...atRules) =>
  R.filter((r) => r.selector === selector && r.at.length === atRules.length && atRules.every((a, i) => r.at[i] === a));
const prop = (rs, name) => rs.flatMap((r) => decls(r.body)).find(([k]) => k === name)?.[1];
const WIDE = '@media (min-width: 1024px)';

test('L1: .app is 720px wide, --layout-wide from 1024px, and .hub-body has columns only there', () => {
  assert.equal(prop(at('.app'), 'max-width'), '720px');
  assert.equal(prop(at('.app', WIDE), 'max-width'), 'var(--layout-wide)');
  assert.equal(prop(at('.hub-body'), 'grid-template-columns'), undefined, 'no columns below 1024px');
  assert.match(prop(at('.hub-body', WIDE), 'grid-template-columns') ?? '', /^minmax\(\d+px, \d+fr\) minmax\(0, \d+fr\)$/);
  assert.equal(R.filter((r) => r.selector === '.hub-body' && decls(r.body).some(([k]) => k === 'grid-template-columns')).length, 1);
});

test('L2: the map column is sticky only where it is wide and tall enough', () => {
  const sticky = R.filter((r) => decls(r.body).some(([k, v]) => k === 'position' && v === 'sticky'));
  assert.ok(sticky.length > 0);
  for (const r of sticky) {
    assert.equal(r.selector, '.map-panel');
    assert.deepEqual(r.at, ['@media (min-width: 1024px) and (min-height: 640px)']);
  }
});

test('L3: the levels are a container and go two per row from a 640px container width', () => {
  const c = prop(at('.levels'), 'container');
  assert.equal(c, 'levels / inline-size');
  const two = at('.level-list', '@container levels (min-width: 640px)');
  assert.equal(prop(two, 'grid-template-columns'), 'repeat(2, minmax(0, 1fr))');
  assert.equal(prop(at('.level-list'), 'grid-template-columns'), undefined, 'one column by default');
});

test('L4: every globe stage width is capped by min(100%, ...), so it never overflows its column', () => {
  const stages = R.filter((r) => r.selector === '.globe-stage');
  assert.ok(stages.length >= 2, 'base and 1024px rules');
  for (const r of stages) {
    const w = decls(r.body).find(([k]) => k === 'width');
    if (w) assert.ok(w[1].startsWith('min(100%,'), w[1]);
  }
  assert.ok(prop(stages, 'width'));
});
