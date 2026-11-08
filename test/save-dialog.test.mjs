// The Save code dialog on the hub (#18): the entry and dialog in index.html, the screens
// lib/save-view.mjs draws, the wiring lib/save-dialog.mjs does, and what createGame commits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';
import { click, makeDom, q, qa } from './helpers/dom.mjs';
import { fakeStorage } from './helpers/fake-storage.mjs';
import { createGame } from '../app.mjs';
import { buildRegistry } from '../lib/registry.mjs';
import { REFUSALS, decodeProgress, encodeProgress } from '../lib/save-code.mjs';
import { createSaveDialog } from '../lib/save-dialog.mjs';
import { STORAGE_KEY } from '../lib/storage.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const shell = parseHTML(html).document;
const tick = () => new Promise((resolve) => setImmediate(resolve));
const T1 = '2026-01-01T00:00:00.000Z';
const T2 = '2026-02-03T04:05:06.789Z';

const L = (id, no, extra = {}) => ({
  id, no, name: `Level ${id}`, icon: '*', rewardTitle: `Title ${id}`, mechanics: ['query'],
  run(ctx) { ctx.renderStep(`<p>${id}</p>`, '<button data-finish>Finish</button>'); },
  ...extra,
});
const REG = buildRegistry(
  [{ id: 'a0', no: 0, name: 'First act', levels: [L('p', '0.1'), L('q', '0.2'), L('r', '0.3'), L('s', '0.4')], boss: null }],
  { deck: [], nodeIds: [] },
);
const rec = (levels, cards = []) => ({ v: 1, levels, cards });
// Local is better on p, the code is better on q, only the code has r, only local has s.
const LOCAL = rec({ p: { stars: 5, at: T2 }, q: { stars: 1, at: T1 }, s: { stars: 2, at: T1 } });
const CODE = encodeProgress(rec({ p: { stars: 2, at: T1 }, q: { stars: 4, at: T2 }, r: { stars: 3, at: T2 } }), REG);

function setup({ local, debug, throwOn, clipboard } = {}) {
  const dom = makeDom(html);
  const store = fakeStorage({ initial: local ? { [STORAGE_KEY]: JSON.stringify(local) } : {}, throwOn });
  const win = { navigator: { clipboard }, addEventListener() {} };
  const game = createGame({
    registry: REG, deck: [], storage: () => store, document: dom.document, window: win,
    now: () => 0, rand: () => 0, reduceMotion: () => true, setTimeout: () => {}, clearTimeout: () => {},
    reportError: (e) => { throw e; }, debug,
  });
  const focused = [];
  game.focusSoon = (sel) => focused.push(sel);
  return { game, store, focused };
}
const msg = () => q('#save-msg');
// Records which element ids get .focus() (linkedom has no focus of its own).
function trackFocus() {
  const proto = Object.getPrototypeOf(q('#save-body'));
  const had = Object.hasOwn(proto, 'focus');
  const prev = proto.focus;
  const ids = [];
  proto.focus = function focus() { ids.push(this.id); };
  return { ids, restore() { if (had) proto.focus = prev; else delete proto.focus; } };
}
const msgText = () => msg().querySelector('[data-feedback-text]').textContent;
const saved = (store) => store.sets.filter(([k]) => k === STORAGE_KEY);
const stored = (store) => JSON.parse(store.data.get(STORAGE_KEY));

test('index.html: a kit entry on the hub, hidden in debug, and a dialog outside #hub with a focusable title', () => {
  const open = shell.querySelector('#hub #save-open');
  assert.ok(open, '#save-open is inside #hub');
  assert.deepEqual(open.getAttribute('class').split(' '), ['ui-btn', 'ui-btn--ghost']);
  assert.equal(open.getAttribute('type'), 'button');
  assert.equal(open.getAttribute('@click'), 'openSave()');
  assert.equal(open.closest('section').getAttribute('x-show'), '!debug');
  const dlg = shell.querySelector('.save-dialog');
  assert.equal(dlg.getAttribute('role'), 'dialog');
  assert.equal(dlg.getAttribute('aria-modal'), 'true');
  assert.equal(dlg.getAttribute('aria-labelledby'), 'save-title');
  assert.equal(dlg.closest('#hub') === null, true);
  assert.equal(shell.querySelector('#save-title').getAttribute('tabindex'), '-1');
  const body = shell.querySelector('#save-body');
  assert.ok(dlg.contains(body));
  assert.equal(body.children.length, 0, 'the body is drawn by script, not by Alpine');
});

test('openSave: opens on the title, makes the hub inert, and is refused behind another dialog', () => {
  const { game, focused } = setup();
  assert.equal(game.openSave(), true);
  assert.equal(game.saveOpen, true);
  assert.equal(game.hubInert(), true);
  assert.deepEqual(focused, ['#save-title']);
  assert.equal(game.openAbout(), false, 'one dialog at a time');
  assert.equal(game.openLevel('p'), false);
  game.closeSave();
  assert.equal(game.saveOpen, false);
  assert.equal(focused.at(-1), '#save-open');
  game.aboutOpen = true;
  assert.equal(game.openSave(), false);
});

test('Escape closes the dialog and clears its body; a handled Escape does not', () => {
  const { game } = setup({ local: LOCAL });
  game.openSave();
  assert.ok(q('#save-code-out'));
  game.onEscape({ defaultPrevented: true, target: document.body });
  assert.equal(game.saveOpen, true);
  game.onEscape({ target: document.body });
  assert.equal(game.saveOpen, false);
  assert.equal(q('#save-body').innerHTML, '');
});

test('home: your code is shown and decodes to your progress; Close is wired', () => {
  const { game } = setup({ local: LOCAL });
  game.openSave();
  const code = q('#save-code-out').textContent;
  assert.ok(code.includes('\n'), 'a long code is shown in short lines');
  assert.equal(q('#save-code-out').hasAttribute('readonly'), true);
  assert.deepEqual(JSON.parse(JSON.stringify(decodeProgress(code, REG).progress)), LOCAL);
  click('#save-close');
  assert.equal(game.saveOpen, false);
});

test('home with no progress says there is nothing to save and offers no code', () => {
  const { game } = setup();
  game.openSave();
  assert.equal(q('#save-code-out') === null, true);
  assert.equal(q('#save-copy') === null, true);
  assert.ok(q('#save-code-in') && q('#save-check'), 'loading a code still works');
});

test('Copy puts the code on the clipboard and says so; no clipboard selects the code instead', async () => {
  const copied = [];
  const a = setup({ local: LOCAL, clipboard: { writeText: async (t) => copied.push(t) } });
  a.game.openSave();
  click('#save-copy');
  await tick();
  assert.deepEqual(copied, [encodeProgress(LOCAL, REG)], 'the copy is the code on one line');
  assert.equal(msgText(), 'Copied.');
  assert.equal(msg().getAttribute('data-tone'), 'success');
  const b = setup({ local: LOCAL, clipboard: undefined });
  b.game.openSave();
  let selected = 0;
  q('#save-code-out').select = () => selected++;
  click('#save-copy');
  await tick();
  assert.equal(selected, 1);
  assert.match(msgText(), /Ctrl\+C/);
  assert.equal(msg().getAttribute('data-tone'), 'neutral');
  const c = setup({ local: LOCAL, clipboard: { writeText: async () => { throw new Error('denied'); } } });
  c.game.openSave();
  click('#save-copy');
  await tick();
  assert.match(msgText(), /Ctrl\+C/);
});

test('a bad code shows its reason as an error, keeps what was pasted, and changes and saves nothing', () => {
  const { game, store } = setup({ local: LOCAL });
  const before = JSON.stringify(game.progress);
  game.openSave();
  const bad = CODE.slice(0, -3) + 'abc';
  click({ type: '#save-code-in', text: bad });
  click('#save-check');
  assert.equal(msg().getAttribute('data-tone'), 'error');
  assert.equal(msgText(), REFUSALS.checksum);
  assert.equal(q('#save-code-in').textContent, bad);
  assert.equal(q('#save-apply') === null, true);
  click({ type: '#save-code-in', text: '' });
  click('#save-check');
  assert.equal(msgText(), REFUSALS.empty);
  assert.equal(JSON.stringify(game.progress), before);
  assert.equal(saved(store).length, 0);
});

test('a good code shows what changes before anything is saved; Back returns with the code kept', () => {
  const { game, store } = setup({ local: LOCAL });
  game.openSave();
  click({ type: '#save-code-in', text: CODE });
  click('#save-check');
  const cells = qa('#save-body dt, #save-body dd').map((td) => td.textContent);
  assert.deepEqual(cells, ['0.3: Level r', 'New, 3 stars', '0.2: Level q', '1 star to 4 stars']);
  assert.equal(qa('#save-body table').length, 0, 'a label/value list, not a table');
  assert.match(q('#save-body').textContent, /Your better stars stay on 1 level\./);
  assert.ok(q('#save-apply'));
  assert.equal(saved(store).length, 0, 'nothing is written by the preview');
  assert.equal(game.progress.levels.r, undefined);
  click('#save-back');
  assert.equal(q('#save-code-in').textContent, CODE);
  assert.equal(q('#save-apply') === null, true);
});

test('Import merges: better of each side, saved, shown on the hub, and says what it did', () => {
  const { game, store } = setup({ local: LOCAL });
  game.openSave();
  click({ type: '#save-code-in', text: CODE });
  click('#save-check');
  click('#save-apply');
  const want = { p: 5, q: 4, r: 3, s: 2 };
  for (const [id, stars] of Object.entries(want)) assert.equal(game.progress.levels[id].stars, stars, id);
  assert.equal(game.progress.levels.p.at, T1, 'earliest time wins');
  assert.equal(saved(store).length, 1);
  for (const [id, stars] of Object.entries(want)) assert.equal(stored(store).levels[id].stars, stars, `stored ${id}`);
  assert.deepEqual(game.stars, { earned: 14, max: 20 });
  assert.equal(msgText(), 'Imported: 1 level added, 1 level improved.');
  assert.equal(msg().getAttribute('data-tone'), 'success');
  assert.equal(q('#save-apply') === null, true);
  click('#save-close');
  assert.equal(game.saveOpen, false);
});

test('importing into a fresh browser adds every level; a worse code offers no Import', () => {
  const a = setup();
  a.game.openSave();
  click({ type: '#save-code-in', text: encodeProgress(LOCAL, REG) });
  click('#save-check');
  click('#save-apply');
  assert.deepEqual(Object.keys(a.game.progress.levels).sort(), ['p', 'q', 's']);
  const b = setup({ local: LOCAL });
  b.game.openSave();
  click({ type: '#save-code-in', text: encodeProgress(rec({ p: { stars: 1, at: T2 } }), REG) });
  click('#save-check');
  assert.equal(q('#save-apply') === null, true);
  assert.match(q('#save-body').textContent, /Nothing new in this code/);
  assert.ok(q('#save-back'));
  assert.equal(saved(b.store).length, 0);
});

test('a code with ids this build lacks imports the known ones and tells the player', () => {
  const { game } = setup();
  const bytes = Buffer.from(JSON.stringify({ l: [['p', 3, null], ['nope', 5, null]], c: [] })).toString('base64url');
  let h = 0x811c9dc5;
  for (const ch of `oc1.${bytes}`) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193);
  game.openSave();
  click({ type: '#save-code-in', text: `oc1.${bytes}.${(h >>> 0).toString(16).padStart(8, '0')}` });
  click('#save-check');
  assert.match(msgText(), /not in this version/);
  click('#save-apply');
  assert.deepEqual(Object.keys(game.progress.levels), ['p']);
});

test('when the browser will not save, the merge stays for this visit and the dialog says so', () => {
  const { game } = setup({ throwOn: ['setItem'] });
  game.openSave();
  click({ type: '#save-code-in', text: CODE });
  click('#save-check');
  click('#save-apply');
  assert.equal(game.progress.levels.q.stars, 4);
  assert.equal(game.notice, 'unavailable');
  assert.match(msgText(), /not letting the game save/);
  assert.equal(msg().getAttribute('data-tone'), 'neutral');
});

test('debug mode: no entry action, nothing exported, imported or saved', () => {
  const { game, store } = setup({ debug: true });
  assert.equal(game.openSave(), false);
  assert.equal(game.saveOpen, false);
  assert.equal(q('#save-body').innerHTML, '');
  const host = { innerHTML: '' };
  const dlg = createSaveDialog({ registry: REG, host, doc: document, debug: true, getProgress: () => LOCAL, commit: () => { throw new Error('saved'); }, copy: () => true, close() {} });
  assert.equal(dlg.open(), false);
  assert.equal(host.innerHTML, '');
  assert.equal(store.sets.length, 0);
});

test('the dialog markup is kit helpers only: no style attribute, no handler attribute, no Alpine attribute', () => {
  const { game } = setup({ local: LOCAL });
  game.openSave();
  const check = () => {
    const body = q('#save-body').innerHTML;
    assert.doesNotMatch(body, /\sstyle=|\son\w+=|\sx-|\s@|\s:\w/);
  };
  check();
  click({ type: '#save-code-in', text: CODE });
  click('#save-check');
  check();
  click('#save-apply');
  check();
});

test('focus: a refusal lands on the message, a changing preview on Import, a no-change preview on Back', () => {
  const { game } = setup({ local: LOCAL });
  game.openSave();
  const f = trackFocus();
  try {
    click({ type: '#save-code-in', text: 'oc1.x.y' });
    click('#save-check');
    assert.deepEqual(f.ids, ['save-msg']);
    f.ids.length = 0;
    click({ type: '#save-code-in', text: CODE });
    click('#save-check');
    assert.deepEqual(f.ids, ['save-apply']);
    f.ids.length = 0;
    click('#save-back');
    click({ type: '#save-code-in', text: encodeProgress(rec({ p: { stars: 1, at: T2 } }), REG) });
    click('#save-check');
    assert.deepEqual(f.ids, ['save-back']);
  } finally {
    f.restore();
  }
});

test('a newer-version record in storage: the import is kept for this visit, nothing is written, and the dialog says so', () => {
  const { game, store } = setup({ local: { v: 2, levels: {}, cards: [] } });
  assert.equal(game.notice, 'future');
  game.notice = null;
  game.openSave();
  click({ type: '#save-code-in', text: CODE });
  click('#save-check');
  click('#save-apply');
  assert.equal(msgText(), 'Your progress was saved by a newer version of the game, so nothing was saved. Reload the page to get it.');
  assert.equal(game.notice, 'future');
  assert.equal(saved(store).length, 0);
  assert.equal(game.progress.levels.q.stars, 4);
});

test('imported levels and cards are counted with matching singular and plural', () => {
  const { game } = setup();
  game.openSave();
  const code = encodeProgress(rec({ p: { stars: 1, at: T1 }, q: { stars: 1, at: T1 }, r: { stars: 1, at: T1 } }, []), REG);
  click({ type: '#save-code-in', text: code });
  click('#save-check');
  click('#save-apply');
  assert.equal(msgText(), 'Imported: 3 levels added.');
});
