// The hub's responsive layout (#313 P4): map and levels side by side from 1024px, a sticky
// map only where it fits, two cards per row from a 640px container, a stage that never overflows.
// Static: the stylesheet is parsed, never laid out; the pixel checks are a browser job.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { read, rules, decls, styleFiles } from './helpers/css.mjs';

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

test('L3: the levels are a container and go two per row from a 600px container width', () => {
  const c = prop(at('.levels'), 'container');
  assert.equal(c, 'levels / inline-size');
  const two = at('.level-list', '@container levels (min-width: 600px)');
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

test('L5: a 551px column (a 1024px window) stays one card per row; 688px (768) and 700px (1280) go two-up', () => {
  const m = /@container levels \(min-width: (\d+)px\)/.exec(R.find((r) => r.selector === '.level-list' && r.at[0]?.startsWith('@container'))?.at[0] ?? '');
  assert.ok(m && Number(m[1]) > 551 && Number(m[1]) <= 688, m?.[1]);
  const tighter = R.filter((r) => r.selector === '.level-card' && r.at.length && decls(r.body).some(([k]) => /^(padding|min-|max-|width|inline-size|block-size|height)/.test(k)));
  assert.equal(tighter.length, 0, 'no tighter card inside a query: a two-up card is at least 294px (the 420px query only stacks the status under the name)');
});

test('L6: html and body never clip or scroll on the x axis, or the sticky map has no scroll parent to stick in', () => {
  const css = styleFiles().flatMap((f) => rules(read(`styles/${f}`)));
  for (const r of css) {
    if (!r.selector.split(',').some((s) => /^(html|body)$/.test(s.trim()))) continue;
    for (const [k, v] of decls(r.body)) {
      if (k === 'overflow' || k === 'overflow-x') assert.ok(v === 'clip' || v === 'visible', `${r.selector} { ${k}: ${v} }`);
    }
  }
});

test('L7: the map panel and the cards line up with the header inset, and long words wrap in a card', () => {
  assert.equal(prop(at('.hub-body', WIDE), 'padding-inline'), '20px');
  assert.equal(prop(at('.hub-header'), 'padding'), '18px 20px 12px');
  for (const sel of ['.level-name', '.level-sub']) assert.equal(prop(at(sel), 'overflow-wrap'), 'break-word');
});

test('L8 (#321): card titles balance, cards share one row height, the act heading keeps its chevron on the first line, the header wraps', () => {
  assert.equal(prop(at('.level-name'), 'text-wrap'), 'balance');
  assert.equal(prop(at('.level-list', '@container levels (min-width: 600px)'), 'grid-auto-rows'), '1fr');
  assert.ok(prop(at('.level-card'), 'min-block-size'), 'a one-line card is as tall as a two-line one');
  assert.equal(prop(at('.act-toggle'), 'align-items'), 'flex-start');
  assert.equal(prop(at('.hub-header'), 'flex-wrap'), 'wrap');
  assert.equal(prop(at('.level-status'), 'white-space'), 'nowrap', 'Next up and Start never break');
});

test('L9 (#321): the About map paragraph is as muted as the act paragraphs; the act tags carry a label', () => {
  assert.equal(prop(at('.about-map p'), 'color'), 'var(--color-text-muted)');
  const html = read('index.html');
  assert.equal((html.match(/<span class="act-badges-label">Tags:<\/span>/g) ?? []).length, 2, 'the hub card list and About');
});
