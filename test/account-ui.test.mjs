// The account markup in index.html (#273 P6b): the sign-in anchor, the hub controls, the nudge and
// the sign-in notice, bound to the Alpine state app.mjs provides. Static: the markup is read, never rendered.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';
import { linkButton } from '../lib/ui/index.mjs';
import { createGame } from '../app.mjs';
import { buildRegistry } from '../lib/registry.mjs';
import { fakeStorage } from './helpers/fake-storage.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const doc = parseHTML(readFileSync(join(ROOT, 'index.html'), 'utf8')).document;
const byId = (id) => doc.getElementById(id);
const signIns = [...doc.querySelectorAll('a[href="/api/auth-start"]')];

test('the sign-in anchor is a kit button link to /api/auth-start, in the hub and in the nudge, and nowhere else', () => {
  assert.equal(signIns.length, 2);
  const [hub, nudge] = signIns;
  assert.ok(hub.closest('#hub') && hub.closest('.save-entry'));
  assert.ok(nudge.closest('.reward-card') && nudge.closest('[x-show="signinNudgeOpen"]'));
  for (const a of signIns) {
    assert.ok(a.classList.contains('ui-btn'));
    assert.equal(a.hasAttribute('target'), false, 'a top-level navigation');
  }
  assert.match(hub.textContent, /Sign in with Google \(@dash0\.com\)/);
  assert.equal(hub.getAttribute('x-show'), 'accountEnabled && !signedIn');
});

test('linkButton builds the kit anchor the static markup mirrors', () => {
  assert.equal(linkButton({ id: 'si', label: 'Sign in', href: '/api/auth-start' }),
    '<a class="ui-btn ui-btn--ghost" id="si" href="/api/auth-start">Sign in</a>');
  assert.throws(() => linkButton({ label: 'x', href: 'https://evil.example/' }), /linkButton/);
  assert.throws(() => linkButton({ label: 'x', href: '//evil.example' }), /linkButton/);
  assert.throws(() => linkButton({ label: 'x', href: '/a b' }), /linkButton/);
  assert.throws(() => linkButton({ label: 'x', href: '/a', variant: 'icon' }), /linkButton/);
});

test('the account controls are hidden unless accountEnabled, and the signed-in ones unless signedIn', () => {
  assert.equal(byId('board-open').getAttribute('x-show'), 'accountEnabled');
  assert.equal(byId('account-open').getAttribute('x-show'), 'signedIn');
  assert.equal(byId('board-open').getAttribute('@click'), 'openBoard()');
  assert.equal(byId('account-open').getAttribute('@click'), 'openAccount()');
  const entry = byId('account-entry');
  assert.equal(entry.getAttribute('x-show'), 'accountEnabled');
  assert.equal(entry.querySelector('[x-text="signedInText()"]') !== null, true);
  assert.equal(entry.closest('#hub') !== null, true);
});

test('the nudge shows its text and three buttons that call the right methods', () => {
  const n = doc.querySelector('[x-show="signinNudgeOpen"]');
  assert.equal(n.querySelector('[x-text="signinNudgeText"]') !== null, true);
  const calls = [...n.querySelectorAll('button')].map((b) => [b.textContent.trim(), b.getAttribute('@click')]);
  assert.deepEqual(calls, [["Not now", 'dismissSigninNudge()'], ["Don't ask again", 'hideSigninNudge()']]);
  assert.equal(n.querySelector('a').textContent.trim(), 'Sign in');
});

test('the sign-in notice is a status region on the hub with a Dismiss button, shown only with text', () => {
  const n = byId('signin-notice');
  assert.equal(n.getAttribute('role'), 'status');
  assert.ok(n.closest('#hub'));
  assert.equal(n.getAttribute('x-show'), "signinNoticeText() !== ''");
  assert.equal(n.querySelector('[x-text="signinNoticeText()"]') !== null, true);
  assert.equal(n.querySelector('button').getAttribute('@click'), 'dismissSigninNotice()');
});

test('every name the account markup binds exists on the game, with the right kind', () => {
  const dom = parseHTML('<!doctype html><body></body>');
  const game = createGame({
    registry: buildRegistry([], { deck: [], nodeIds: [] }), deck: [], storage: () => fakeStorage({}), document: dom.document, now: () => 1,
    rand: () => 0, reduceMotion: () => true, reportError: () => {}, setTimeout: () => 0, clearTimeout: () => {},
    globeMap: { ACT_REGIONS: {}, LEVEL_COUNTRY: {}, COUNTRY_NAMES: {}, actOf: () => null }, dots: [],
  });
  const roots = ['account-entry', 'signin-notice', 'board-open', 'account-open', 'board-modal', 'account-modal'].map(byId);
  roots.push(doc.querySelector('[x-show="signinNudgeOpen"]'));
  const seen = new Set();
  for (const r of roots) for (const el of [r, ...r.querySelectorAll('*')]) {
    for (const a of ['x-show', 'x-text', '@click']) {
      const v = el.getAttribute(a);
      if (v === null) continue;
      for (const m of v.matchAll(/[A-Za-z]+(?:\()?/g)) {
        const name = m[0].replace('(', '');
        const kind = m[0].endsWith('(') ? 'function' : 'any';
        seen.add(name);
        assert.ok(name in game, `${a}="${v}": game.${name} is missing`);
        if (kind === 'function') assert.equal(typeof game[name], 'function', name);
      }
    }
  }
  for (const k of ['accountEnabled', 'signedIn', 'signedInText', 'signinNoticeText', 'dismissSigninNotice', 'signinNudgeOpen', 'signinNudgeText', 'hideSigninNudge', 'accountSummary', 'openBoard', 'openAccount']) assert.ok(seen.has(k), `the markup binds ${k}`);
});

test('accountSummary: nothing signed out, "no stars yet" for null stars (never 0), stars and rank otherwise', () => {
  const game = createGame({
    registry: buildRegistry([], { deck: [], nodeIds: [] }), deck: [], storage: () => fakeStorage({}), document: parseHTML('<!doctype html><body></body>').document,
    now: () => 1, rand: () => 0, reduceMotion: () => true, reportError: () => {}, setTimeout: () => 0, clearTimeout: () => {},
    globeMap: { ACT_REGIONS: {}, LEVEL_COUNTRY: {}, COUNTRY_NAMES: {}, actOf: () => null }, dots: [],
  });
  assert.equal(game.accountSummary(), '');
  game.account = { state: 'signedIn', nick: 'grace', listed: true };
  assert.equal(game.accountSummary(), 'no stars yet');
  game.accountStars = 4; game.accountRank = 3;
  assert.equal(game.accountSummary(), '4 stars, #3');
});
