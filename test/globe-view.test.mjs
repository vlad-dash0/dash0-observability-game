// The globe view (lib/globe-view.mjs) and the renderer's fallbacks (lib/globe-render.mjs).
// Spec: issue #150, docs/FOUNDATION.md §2.7. The WebGL drawing itself is checked in a
// browser; these pin what it is told to draw.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOTS } from '../hub/globe-data.mjs';
import { actOfCountry } from '../hub/globe-map.mjs';
import { liveRegistry } from '../app.mjs';
import { globeState } from '../lib/globe.mjs';
import {
  COLOR_ROLES, DOT, MAX_TILT, createLoop, currentActId, dotStates, facingRotation, globeLabel, globeLines,
  globeTarget, parseColor, readColors, regionCentre, spherePoint,
} from '../lib/globe-view.mjs';
import { mountGlobe } from '../lib/globe-render.mjs';
import { emptyProgress } from '../lib/progress.mjs';
import { buildRegistry } from '../lib/registry.mjs';

const LIVE = liveRegistry();
function progressOf(ids) {
  const p = emptyProgress();
  for (const id of ids) p.levels[id] = { stars: 3, at: null };
  return p;
}
const ACT_0 = ['monitoring-vs-observability', 'the-signals', 'why-opentelemetry'];
const statesFor = (done) => dotStates(globeState(LIVE, progressOf(done)), DOTS);
/** Sorted unique country codes of the dots in `state`. */
const countriesIn = (states, state) =>
  [...new Set(DOTS.filter((_, k) => states[k] === state).map((d) => d[2]))].sort();

// ---- which dots light and pulse ------------------------------------------------------

test('fresh progress: every dot is unlit', () => {
  const s = statesFor([]);
  assert.equal(s.length, DOTS.length);
  assert.equal(s.every((v) => v === DOT.UNLIT), true);
});

test("completing a level lights exactly its country's dots", () => {
  const s = statesFor(['the-signals']);
  assert.deepEqual(countriesIn(s, DOT.LIT), ['DEU']);
  assert.equal(s.filter((v) => v === DOT.LIT).length, DOTS.filter((d) => d[2] === 'DEU').length);
  assert.deepEqual(countriesIn(s, DOT.PULSE), []);
  assert.deepEqual(countriesIn(statesFor(['the-signals', 'resources']), DOT.LIT), ['DEU', 'NOR']);
});

test("while an act's boss is open its whole region pulses, countries without a level too", () => {
  const s = statesFor(ACT_0);
  const pulsing = DOTS.filter((_, k) => s[k] === DOT.PULSE);
  assert.ok(pulsing.length > 0);
  assert.equal(pulsing.every((d) => actOfCountry(d[2], d[3]) === 'act-0'), true, 'only Western Europe pulses');
  assert.equal(
    DOTS.filter((d) => actOfCountry(d[2], d[3]) === 'act-0').every((d) => s[DOTS.indexOf(d)] === DOT.PULSE),
    true,
    'every Western Europe dot pulses',
  );
  assert.ok(countriesIn(s, DOT.PULSE).includes('ITA'), 'Italy has no level and still pulses');
  assert.deepEqual(countriesIn(s, DOT.LIT), [], 'the lit countries show the pulse instead');
});

test('once the boss is done the pulse stops and the completed countries stay lit', () => {
  const s = statesFor([...ACT_0, 'the-pager']);
  assert.deepEqual(countriesIn(s, DOT.PULSE), []);
  assert.deepEqual(countriesIn(s, DOT.LIT), ['DEU', 'ESP', 'FRA']);
});

// ---- where the globe turns -----------------------------------------------------------

const L = (id, no) => ({ id, no, name: id, icon: '*', rewardTitle: `t-${id}`, mechanics: ['query'], run() {} });
const REG = buildRegistry(
  [
    { id: 'g0', no: 0, name: 'Zeroth', levels: [L('a', '0.1'), L('b', '0.2')], boss: L('boss0', null) },
    { id: 'g1', no: 1, name: 'First', levels: [L('c', '1.1')], boss: null },
    { id: 'g2', no: 2, name: '', levels: [L('d', '2.1')], boss: null },
  ],
  { deck: [], nodeIds: [] },
);

test('the current act is the lowest unlocked act that is not complete; all done, the last', () => {
  assert.equal(currentActId(REG, progressOf([])), 'g0');
  assert.equal(currentActId(REG, progressOf(['a', 'b'])), 'g0', 'its boss is still open');
  assert.equal(currentActId(REG, progressOf(['a', 'b', 'boss0'])), 'g1');
  assert.equal(currentActId(REG, progressOf(['d'])), 'g0', 'an entered later act does not jump the queue');
  assert.equal(currentActId(REG, progressOf(['a', 'b', 'boss0', 'd'])), 'g1', 'g2 is entered, g1 is lower');
  assert.equal(currentActId(REG, progressOf(['a', 'b', 'boss0', 'c'])), 'g2');
  assert.equal(currentActId(REG, progressOf(['a', 'b', 'boss0', 'c', 'd'])), 'g2', 'all complete: the last act');
  assert.equal(currentActId(buildRegistry([], { deck: [], nodeIds: [] }), progressOf([])), null);
});

/** Apply a three.js Euler XYZ rotation {x, y} (z 0) to a point: Rx(Ry(p)). */
function rotate([px, py, pz], { x, y }) {
  const x1 = px * Math.cos(y) + pz * Math.sin(y);
  const z1 = -px * Math.sin(y) + pz * Math.cos(y);
  return [x1, py * Math.cos(x) - z1 * Math.sin(x), py * Math.sin(x) + z1 * Math.cos(x)];
}
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

test('facingRotation turns a point to face the camera on +z', () => {
  for (const [lat, lon] of [[0, 0], [48.9, 2.35], [-33.9, 151.2], [40.7, -74], [-60, -170]]) {
    const [x, y, z] = rotate(spherePoint(lat, lon), facingRotation(lat, lon));
    assert.ok(near(x, 0) && near(y, 0) && near(z, 1), `${lat},${lon} -> ${x},${y},${z}`);
  }
  assert.equal(facingRotation(80, 0).x, MAX_TILT, 'the tilt is capped');
  assert.equal(facingRotation(-80, 0).x, -MAX_TILT);
});

test('a region centre sits inside its region; an act without dots has none', () => {
  const [lat0, lon0] = regionCentre(DOTS, 'act-0');
  assert.ok(lat0 > 35 && lat0 < 55 && lon0 > -10 && lon0 < 20, `Western Europe ${lat0},${lon0}`);
  const [lat3, lon3] = regionCentre(DOTS, 'act-3');
  assert.ok(lat3 < 0 && lon3 > -80 && lon3 < -40, `South America ${lat3},${lon3}`);
  assert.equal(regionCentre(DOTS, 'act-99'), null);
});

test("on load the globe faces the current act's region", () => {
  const facing = (target, [lat, lon]) => rotate(spherePoint(lat, lon), target)[2];
  const fresh = globeTarget(LIVE, progressOf([]), DOTS);
  assert.equal(fresh.actId, 'act-0');
  assert.ok(facing(fresh, [48.9, 2.35]) > 0.9, 'Paris faces the camera');
  assert.ok(facing(fresh, [-33.9, 151.2]) < 0, 'Sydney is on the far side');
  const act1 = [...ACT_0, 'the-pager'];
  const next = globeTarget(LIVE, progressOf(act1), DOTS);
  assert.equal(next.actId, 'act-1');
  assert.ok(facing(next, [60, 15]) > 0.9, 'Scandinavia faces the camera');
  assert.equal(globeTarget(REG, progressOf([]), DOTS), null, 'acts without a region: no target');
});

// ---- text ---------------------------------------------------------------------------

const MAP = {
  ACT_REGIONS: { g0: { region: 'Zero' }, g1: { region: 'One' }, g2: { region: 'Two' } },
  LEVEL_COUNTRY: { a: 'AAA', b: 'BBB', c: 'CCC', d: 'DDD' },
};

test('the text fallback lists each act with its region, done of total and an open incident', () => {
  assert.deepEqual(globeLines(REG, globeState(REG, progressOf(['a', 'b']), MAP)), [
    'Act 0, Zeroth (Zero): 2 of 3 done, incident open',
    'Act 1, First (One): 0 of 1 done',
    'Act 2 (Two): 0 of 1 done',
  ]);
  const partial = { ACT_REGIONS: { g1: { region: 'One' } }, LEVEL_COUNTRY: {} };
  assert.deepEqual(globeLines(REG, globeState(REG, progressOf([]), partial)), ['Act 1, First (One): 0 of 1 done']);
});

test('the accessible name counts levels done, names lit regions and the open incident', () => {
  assert.equal(globeLabel(globeState(REG, progressOf([]), MAP)), 'World map: 0 of 5 levels done.');
  assert.equal(
    globeLabel(globeState(REG, progressOf(['a', 'b']), MAP)),
    'World map: 2 of 5 levels done. Lit: Zero 2 of 3. Incident open in Zero.',
  );
  assert.equal(
    globeLabel(globeState(REG, progressOf(['a', 'b', 'boss0', 'd']), MAP)),
    'World map: 4 of 5 levels done. Lit: Zero 3 of 3, Two 1 of 1.',
  );
});

// ---- colours ------------------------------------------------------------------------

test('parseColor reads the forms getComputedStyle returns, and refuses anything else', () => {
  assert.deepEqual(parseColor('rgb(255, 51, 0)'), [1, 0.2, 0]);
  assert.deepEqual(parseColor('rgba(255, 51, 0, 0.5)'), [1, 0.2, 0]);
  assert.deepEqual(parseColor('rgb(255 51 0 / 50%)'), [1, 0.2, 0]);
  assert.deepEqual(parseColor('color(srgb 1 0.5 0.25)'), [1, 0.5, 0.25]);
  for (const bad of ['', null, 'red', 'light-dark(red, blue)', 'rgb(300, 0, 0)', 'color(display-p3 1 0 0)', 'rgb(1, 2)']) {
    assert.equal(parseColor(bad), null, String(bad));
  }
});

test('readColors reads every role, or gives up when one is unreadable', () => {
  const seen = [];
  const colors = readColors((role) => {
    seen.push(role);
    return 'rgb(0, 0, 255)';
  });
  assert.deepEqual(seen, [...COLOR_ROLES]);
  assert.deepEqual(Object.keys(colors), [...COLOR_ROLES]);
  assert.deepEqual(colors.lit, [0, 0, 1]);
  assert.equal(readColors((role) => (role === 'pulse' ? '' : 'rgb(0, 0, 0)')), null);
});

// ---- the loop: reduced motion, hidden tab, off screen, dispose -----------------------

function fakeLoopEnv() {
  const frames = new Map();
  let next = 1;
  const listeners = new Map();
  const win = {
    requestAnimationFrame: (fn) => {
      frames.set(next, fn);
      return next++;
    },
    cancelAnimationFrame: (id) => frames.delete(id),
  };
  const doc = {
    hidden: false,
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type, fn) => listeners.get(type) === fn && listeners.delete(type),
  };
  const run = (ms) => {
    const pending = [...frames.entries()];
    frames.clear();
    for (const [, fn] of pending) fn(ms);
  };
  return { win, doc, frames, listeners, run };
}

test('with motion the loop draws every frame, animated, with a capped time step', () => {
  const env = fakeLoopEnv();
  const draws = [];
  const loop = createLoop({ win: env.win, doc: env.doc, reduced: false, draw: (f) => draws.push(f) });
  loop.redraw();
  env.run(1000);
  env.run(1016);
  env.run(9000);
  assert.deepEqual(draws.map((d) => d.animate), [true, true, true]);
  assert.equal(draws[0].dt, 0);
  assert.ok(near(draws[1].dt, 0.016, 1e-6));
  assert.equal(draws[2].dt, 0.05, 'a long gap is capped');
  assert.equal(loop.scheduled, true, 'it keeps going');
});

test('under reduced motion each redraw draws one static frame and the loop never runs on', () => {
  const env = fakeLoopEnv();
  const draws = [];
  const loop = createLoop({ win: env.win, doc: env.doc, reduced: true, draw: (f) => draws.push(f) });
  loop.redraw();
  env.run(1000);
  assert.equal(loop.scheduled, false);
  env.run(2000);
  assert.deepEqual(draws.map((d) => d.animate), [false]);
  loop.redraw();
  env.run(3000);
  assert.equal(draws.length, 2);
});

test('a hidden tab or an off-screen globe stops the loop; showing it resumes', () => {
  const env = fakeLoopEnv();
  let draws = 0;
  const loop = createLoop({ win: env.win, doc: env.doc, reduced: false, draw: () => draws++ });
  loop.redraw();
  env.run(0);
  env.doc.hidden = true;
  env.listeners.get('visibilitychange')();
  assert.equal(env.frames.size, 0, 'the pending frame is cancelled');
  loop.redraw();
  assert.equal(env.frames.size, 0, 'nothing is scheduled while hidden');
  env.doc.hidden = false;
  env.listeners.get('visibilitychange')();
  assert.equal(loop.scheduled, true);
  loop.setOffscreen(true);
  assert.equal(env.frames.size, 0);
  loop.setOffscreen(false);
  env.run(100);
  assert.equal(draws, 2);
});

test('dispose stops the loop for good and drops its listener', () => {
  const env = fakeLoopEnv();
  let draws = 0;
  const loop = createLoop({ win: env.win, doc: env.doc, reduced: false, draw: () => draws++ });
  loop.redraw();
  loop.dispose();
  assert.equal(env.frames.size, 0);
  assert.equal(env.listeners.has('visibilitychange'), false);
  loop.redraw();
  loop.setOffscreen(false);
  env.run(0);
  assert.equal(draws, 0);
});

// ---- the renderer's fallbacks -------------------------------------------------------

function fakeDom(color = 'rgb(10, 20, 30)') {
  const host = { children: [], appendChild: (el) => host.children.push(el) };
  const document = {
    createElement: (tag) => {
      const el = {
        tag,
        className: '',
        setAttribute() {},
        addEventListener() {},
        remove: () => (host.children = host.children.filter((c) => c !== el)),
      };
      return el;
    },
  };
  const window = { devicePixelRatio: 3, getComputedStyle: () => ({ color }) };
  return { host, document, window };
}
const VIEW = { dots: DOTS.slice(0, 3), states: new Uint8Array(3), target: null, reduced: true };

test('mountGlobe gives null and leaves the host empty when three.js does not load', async () => {
  const { host, document, window } = fakeDom();
  const out = await mountGlobe(host, { ...VIEW, window, document, importThree: () => Promise.reject(new Error('404')) });
  assert.equal(out, null);
  assert.equal(host.children.length, 0);
});

test('mountGlobe gives null and leaves the host empty without WebGL', async () => {
  const { host, document, window } = fakeDom();
  let made = 0;
  const THREE = { WebGLRenderer: class { constructor() { made++; throw new Error('Error creating WebGL context.'); } } };
  const out = await mountGlobe(host, { ...VIEW, window, document, importThree: async () => THREE });
  assert.equal(out, null);
  assert.equal(made, 1);
  assert.equal(host.children.length, 0, 'no canvas and no colour probe left behind');
});

test('mountGlobe gives null before touching WebGL when the token colours cannot be read', async () => {
  const { host, document, window } = fakeDom('');
  let made = 0;
  const THREE = { WebGLRenderer: class { constructor() { made++; } } };
  assert.equal(await mountGlobe(host, { ...VIEW, window, document, importThree: async () => THREE }), null);
  assert.equal(made, 0);
  assert.equal(host.children.length, 0);
});
