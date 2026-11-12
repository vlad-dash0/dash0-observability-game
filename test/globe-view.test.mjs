// The globe view (lib/globe-view.mjs) and the renderer's fallbacks (lib/globe-render.mjs).
// Spec: issue #150, docs/FOUNDATION.md §2.7. The WebGL drawing itself is checked in a
// browser; these pin what it is told to draw.
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOTS } from '../hub/globe-data.mjs';
import { ACT_REGIONS, actOfCountry } from '../hub/globe-map.mjs';
import { liveRegistry } from '../app.mjs';
import { globeState } from '../lib/globe.mjs';
import {
  COLOR_ROLES, DOT, MAX_TILT, createLoop, currentActId, dotStates, facingRotation, globeCaption, globeLabel, globeLegend, globeLines,
  globeTarget, parseColor, readColors, regionCentre, spherePoint,
} from '../lib/globe-view.mjs';
import { mountGlobe } from '../lib/globe-render.mjs';
import { BURST, burstDir, burstSpeed, sparksAt, tangentFrame } from '../lib/globe-sparks.mjs';
import * as render from '../lib/globe-render.mjs';
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

test('a resolved region: every dot in it is RESOLVED, Italy included; other regions untouched', () => {
  const s = statesFor([...ACT_0, 'the-pager', 'resources']);
  assert.deepEqual(countriesIn(s, DOT.PULSE), []);
  const inAct0 = DOTS.filter((d) => actOfCountry(d[2], d[3]) === 'act-0');
  assert.ok(inAct0.length > 0);
  assert.equal(inAct0.every((d) => s[DOTS.indexOf(d)] === DOT.RESOLVED), true, 'every Western Europe dot is resolved');
  assert.ok(countriesIn(s, DOT.RESOLVED).includes('ITA'), 'Italy has no level and still resolves');
  assert.equal(inAct0.some((d) => s[DOTS.indexOf(d)] === DOT.LIT), false, 'no lit dot left in the resolved region');
  assert.deepEqual(countriesIn(s, DOT.LIT), ['NOR'], 'the next act shows its own lit country');
});

test('DOT.RESOLVED is a fifth state, 4, and values stay unique', () => {
  assert.equal(DOT.RESOLVED, 4);
  assert.equal(new Set(Object.values(DOT)).size, Object.values(DOT).length);
});

test('dotStates precedence: PULSE > SOON > RESOLVED > LIT > UNLIT', () => {
  const dots = [[0, 0, 'AAA', 'x'], [1, 1, 'BBB', 'y'], [2, 2, 'CCC', 'z'], [3, 3, 'DDD', 'w'], [4, 4, 'EEE', 'v']];
  const actOf = (iso) => ({ AAA: 'p', BBB: 's', CCC: 'r', DDD: 'l' })[iso] ?? null;
  const countries = { AAA: { lit: true }, BBB: { lit: true }, CCC: { lit: true }, DDD: { lit: true } };
  const regions = {
    p: { pulse: true, resolved: true }, // an impossible mix: PULSE still wins
    s: { pulse: false, resolved: true },
    r: { pulse: false, resolved: true },
    l: { pulse: false, resolved: false },
  };
  assert.deepEqual([...dotStates({ countries, regions, soon: { s: { region: 'S' } } }, dots, actOf)], [2, 3, 4, 1, 0]);
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
  assert.deepEqual(globeLines(REG, globeState(REG, progressOf(['a', 'b', 'boss0', 'd']), MAP)), [
    'Act 0, Zeroth (Zero): 3 of 3 done, saved',
    'Act 1, First (One): 0 of 1 done',
    'Act 2 (Two): 1 of 1 done, saved',
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
    'World map: 4 of 5 levels done. Saved: Zero, Two.',
  );
  assert.equal(
    globeLabel(globeState(REG, progressOf(['a', 'c']), MAP)),
    'World map: 2 of 5 levels done. Saved: One. Lit: Zero 1 of 3.',
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

// ---- the renderer's lifecycle, with a recording fake three.js -------------------------

/** A fake THREE that records what is made and released; `throwIn` names a class whose constructor throws. */
function recordingThree(throwIn = null) {
  const rec = { geometries: [], materials: [], points: [], vectors: 0, renderer: null, renders: 0 };
  const maybeThrow = (name) => {
    if (name === throwIn) throw new Error(`${name} failed`);
  };
  class Disposable {
    constructor() {
      this.disposed = 0;
    }
    dispose() {
      this.disposed++;
    }
  }
  class BufferGeometry extends Disposable {
    constructor() {
      super();
      maybeThrow('BufferGeometry');
      rec.geometries.push(this);
    }
    setAttribute(name, attr) {
      (this.attributes ??= {})[name] = attr;
    }
  }
  class SphereGeometry extends BufferGeometry {}
  class ShaderMaterial extends Disposable {
    constructor(opts = {}) {
      super();
      this.opts = opts;
      maybeThrow('ShaderMaterial');
      rec.materials.push(this);
    }
  }
  class Node3 {
    constructor() {
      maybeThrow(this.constructor.name);
      this.rotation = { set() {} };
      this.position = { set() {} };
    }
    add() {}
    updateProjectionMatrix() {}
  }
  class WebGLRenderer {
    constructor() {
      rec.renderer = this;
      this.calls = { pixelRatio: null, size: null, disposed: 0, contextLoss: 0 };
    }
    setPixelRatio(r) {
      this.calls.pixelRatio = r;
    }
    getPixelRatio() {
      return this.calls.pixelRatio;
    }
    setClearColor() {}
    setSize(w, h, style) {
      this.calls.size = [w, h, style];
    }
    render() {
      rec.renders++;
    }
    dispose() {
      this.calls.disposed++;
    }
    forceContextLoss() {
      this.calls.contextLoss++;
    }
  }
  const THREE = {
    WebGLRenderer,
    BufferGeometry,
    SphereGeometry,
    ShaderMaterial,
    BufferAttribute: class {
      constructor(array) {
        this.array = array;
      }
    },
    Vector3: class {
      constructor() {
        rec.vectors++;
      }
    },
    Color: class {
      setRGB() {
        return this;
      }
    },
    Scene: class Scene extends Node3 {},
    PerspectiveCamera: class PerspectiveCamera extends Node3 {},
    Group: class Group extends Node3 {},
    Mesh: class Mesh extends Node3 {},
    Points: class Points extends Node3 {
      constructor(geometry, material) {
        super();
        this.geometry = geometry;
        this.material = material;
        this.visible = true;
        rec.points.push(this);
      }
    },
    AdditiveBlending: 2,
    BackSide: 1,
    SRGBColorSpace: 'srgb',
  };
  return { THREE, rec };
}

/** An event target that counts adds and removes per type. */
function counting(extra = {}) {
  const t = { added: {}, removed: {}, ...extra };
  t.addEventListener = (type) => (t.added[type] = (t.added[type] ?? 0) + 1);
  t.removeEventListener = (type) => (t.removed[type] = (t.removed[type] ?? 0) + 1);
  return t;
}
const balanced = (t) =>
  [...new Set([...Object.keys(t.added), ...Object.keys(t.removed)])].every((k) => t.added[k] === t.removed[k]);

function recordingDom() {
  const host = counting({ clientWidth: 400, clientHeight: 400, children: [] });
  host.appendChild = (el) => host.children.push(el);
  const elements = [];
  const document = counting({ hidden: false });
  document.createElement = (tag) => {
    const el = counting({ tag, className: '', setAttribute() {} });
    el.remove = () => (host.children = host.children.filter((c) => c !== el));
    elements.push(el);
    return el;
  };
  const observers = [];
  const observer = (kind) =>
    class {
      constructor() {
        this.kind = kind;
        this.observed = 0;
        this.disconnected = 0;
        observers.push(this);
      }
      observe() {
        this.observed++;
      }
      disconnect() {
        this.disconnected++;
      }
    };
  const frames = { requested: 0, cancelled: 0, pending: new Map(), next: 1 };
  const window = {
    devicePixelRatio: 3,
    getComputedStyle: () => ({ color: 'rgb(10, 20, 30)' }),
    ResizeObserver: observer('resize'),
    IntersectionObserver: observer('intersection'),
    requestAnimationFrame: (fn) => {
      frames.requested++;
      frames.pending.set(frames.next, fn);
      return frames.next++;
    },
    cancelAnimationFrame: (id) => {
      frames.cancelled++;
      frames.pending.delete(id);
    },
    addEventListener() {},
    removeEventListener() {},
  };
  return { host, document, window, elements, observers, frames };
}
const canvasOf = (dom) => dom.elements.find((e) => e.tag === 'canvas');

test('mountGlobe draws into the host: canvas added, pixel ratio capped at 2, sized without style, a frame drawn', async () => {
  const { THREE, rec } = recordingThree();
  const dom = recordingDom();
  const handle = await mountGlobe(dom.host, { ...VIEW, reduced: false, window: dom.window, document: dom.document, importThree: async () => THREE });
  assert.equal(handle === null, false);
  assert.deepEqual(dom.host.children.map((c) => c.className), ['globe-canvas'], 'the canvas, and no probe left');
  assert.equal(rec.renderer.calls.pixelRatio, 2);
  assert.deepEqual(rec.renderer.calls.size, [400, 400, false]);
  assert.deepEqual(dom.observers.map((o) => [o.kind, o.observed]), [['resize', 1], ['intersection', 1]]);
  assert.equal(dom.frames.pending.size, 1);
  [...dom.frames.pending.values()][0](16);
  assert.equal(rec.renders, 1);
  handle.dispose();
});

test('dispose frees everything once: geometry, materials, renderer and context, observers, listeners, the frame', async () => {
  const { THREE, rec } = recordingThree();
  const dom = recordingDom();
  const handle = await mountGlobe(dom.host, { ...VIEW, reduced: false, window: dom.window, document: dom.document, importThree: async () => THREE });
  const canvas = canvasOf(dom);
  assert.ok(Object.keys(dom.host.added).length > 0 && Object.keys(canvas.added).length > 0);
  handle.dispose();
  handle.dispose();
  handle.update(new Uint8Array(3), null);
  assert.equal(rec.geometries.length, 3);
  assert.deepEqual(rec.geometries.map((g) => g.disposed), [1, 1, 1]);
  assert.equal(rec.materials.length, 4);
  assert.deepEqual(rec.materials.map((m) => m.disposed), [1, 1, 1, 1]);
  assert.equal(rec.renderer.calls.disposed, 1);
  assert.equal(rec.renderer.calls.contextLoss, 1);
  assert.deepEqual(dom.observers.map((o) => o.disconnected), [1, 1]);
  assert.equal(balanced(dom.host), true, `host listeners ${JSON.stringify(dom.host)}`);
  assert.equal(balanced(canvas), true, 'canvas listeners');
  assert.equal(balanced(dom.document), true, 'document listeners');
  assert.equal(dom.frames.cancelled, 1, 'the pending frame is cancelled');
  assert.equal(dom.frames.pending.size, 0);
  assert.equal(dom.host.children.length, 0, 'the canvas is removed');
});

test('each colour role is read at its own settled value even when a class change on a reused element transitions (#169)', async () => {
  // Under prefers-reduced-motion every element has a transition (styles/base.css), so changing
  // a probe's class and reading getComputedStyle at once gives the transition's start value: the
  // colour that element showed before. This fake does the same; only a new element reads true.
  const roleColor = Object.fromEntries(COLOR_ROLES.map((role, i) => [role, `rgb(${10 * (i + 1)}, ${i + 1}, 0)`]));
  const dom = recordingDom();
  const shown = new Map();
  dom.window.getComputedStyle = (el) => {
    const settled = roleColor[el.className.split(' ')[1]] ?? '';
    const color = shown.has(el) ? shown.get(el) : settled;
    shown.set(el, settled);
    return { color };
  };
  const drawn = [];
  const { THREE } = recordingThree();
  THREE.Color = class {
    setRGB(r, g, b) {
      drawn.push([r, g, b]);
      return this;
    }
  };
  THREE.Vector3 = class {
    constructor(...rgb) {
      drawn.push(rgb);
    }
  };
  const handle = await mountGlobe(dom.host, { ...VIEW, window: dom.window, document: dom.document, importThree: async () => THREE });
  const key = (rgb) => JSON.stringify(rgb);
  assert.deepEqual(drawn.map(key).sort(), COLOR_ROLES.map((role) => key(parseColor(roleColor[role]))).sort());
  assert.deepEqual(dom.host.children.map((c) => c.className), ['globe-canvas'], 'no probe left behind');
  handle.dispose();
});

test('a failure part way through setup frees what was made, loses the context and gives null', async () => {
  for (const where of ['BufferGeometry', 'ShaderMaterial', 'Group']) {
    const { THREE, rec } = recordingThree(where);
    const dom = recordingDom();
    const out = await mountGlobe(dom.host, { ...VIEW, window: dom.window, document: dom.document, importThree: async () => THREE });
    assert.equal(out, null, where);
    assert.equal(rec.renderer.calls.disposed, 1, `${where}: renderer disposed`);
    assert.equal(rec.renderer.calls.contextLoss, 1, `${where}: context lost`);
    assert.equal(rec.geometries.every((g) => g.disposed === 1), true, `${where}: geometry freed`);
    assert.equal(rec.materials.every((m) => m.disposed === 1), true, `${where}: materials freed`);
    assert.equal(dom.host.children.length, 0, `${where}: nothing left in the host`);
    assert.equal(balanced(dom.document) && balanced(dom.host), true, `${where}: no listener left`);
  }
});

// ---- coming-soon acts (#177 P7) -------------------------------------------------------

const REG3 = buildRegistry(
  [
    { id: 'g0', no: 0, name: 'Zeroth', levels: [L('a', '0.1')], boss: null },
    { id: 'g9', no: 9, name: 'Ninth', levels: [L('n', '9.1')], boss: null },
  ],
  { deck: [], nodeIds: [] },
);
const MAP3 = {
  ACT_REGIONS: { g0: { region: 'Zero' }, g9: { region: 'Nine' }, s7: { region: 'Seven' } },
  LEVEL_COUNTRY: { a: 'AAA', n: 'NNN' },
};
const S7 = { id: 's7', no: 7, name: 'Later', sub: '', teaser: 't' };

test('DOT.SOON is a fourth state and a soon region\'s dots take it', () => {
  assert.equal(DOT.SOON, 3);
  assert.equal(new Set(Object.values(DOT)).size, Object.values(DOT).length, 'DOT values are unique');
  const dots = [[0, 0, 'AAA', 'x'], [1, 1, 'SSS', 'y'], [2, 2, 'QQQ', 'z']];
  const actOf = (iso) => ({ AAA: 'g0', SSS: 's7' })[iso] ?? null;
  const countries = { AAA: { lit: true, pulse: false } };
  const regions = { g0: { pulse: false } };
  assert.deepEqual([...dotStates({ countries, regions, soon: { s7: { region: 'Seven' } } }, dots, actOf)], [1, 3, 0]);
  assert.deepEqual([...dotStates({ countries, regions }, dots, actOf)], [1, 0, 0], 'no soon key: nothing is soon');
});

test('the text fallback lists soon acts in act order', () => {
  assert.deepEqual(globeLines(REG3, globeState(REG3, progressOf([]), MAP3, [S7])), [
    'Act 0, Zeroth (Zero): 0 of 1 done',
    'Act 7, Later (Seven): coming soon',
    'Act 9, Ninth (Nine): 0 of 1 done',
  ]);
});

test('the accessible name names soon regions and leaves them out of the count', () => {
  assert.equal(
    globeLabel(globeState(REG3, progressOf(['a']), MAP3, [S7])),
    'World map: 1 of 2 levels done. Saved: Zero. Coming soon: Seven.',
  );
  assert.equal(globeLabel(globeState(REG3, progressOf(['a']), MAP3)), 'World map: 1 of 2 levels done. Saved: Zero.');
  // Given out of order, the soon regions are still named by act number.
  const map8 = { ...MAP3, ACT_REGIONS: { ...MAP3.ACT_REGIONS, s8: { region: 'Eight' } } };
  const S8 = { id: 's8', no: 8, name: 'Later still', sub: '', teaser: 't' };
  assert.equal(
    globeLabel(globeState(REG3, progressOf([]), map8, [S8, S7])),
    'World map: 0 of 2 levels done. Coming soon: Seven, Eight.',
  );
});

test('the dot shader draws SOON dim and static, RESOLVED calm and static, and the wave crosses RESOLVED', () => {
  // Structural only: the browser check is the real visual one.
  const soon = /else if \(aState < 3\.5\) \{([^}]*)\}/.exec(render.DOT_VS);
  assert.ok(soon, 'a branch for aState < 3.5');
  assert.ok(soon[1].includes('uDim'), 'SOON is drawn in the dim colour');
  assert.equal(soon[1].includes('uTime'), false, 'SOON is static: no time term');
  const resolved = /else \{([^}]*)\}\s*float wv/.exec(render.DOT_VS);
  assert.ok(resolved, 'RESOLVED is the final else branch');
  assert.ok(resolved[1].includes('uResolved'), 'RESOLVED is drawn in the resolved colour');
  assert.equal(resolved[1].includes('uTime'), false, 'RESOLVED is static: no time term');
  assert.match(render.DOT_VS, /uniform vec3 [^;]*uResolved/, 'uResolved is declared');
  assert.match(render.DOT_VS, /\(aState > 0\.5 && aState < 2\.5\) \|\| aState > 3\.5/, 'the wave skips SOON dots and crosses RESOLVED ones');
});

test('every colour role has a probe rule and a token', () => {
  const hub = readFileSync(new URL('../styles/hub.css', import.meta.url), 'utf8');
  const tokens = readFileSync(new URL('../styles/tokens.css', import.meta.url), 'utf8');
  assert.ok(COLOR_ROLES.includes('resolved'));
  for (const role of COLOR_ROLES) {
    assert.match(hub, new RegExp(`\\.globe-probe\\.${role}\\s*\\{\\s*color:\\s*var\\(--color-globe-${role}\\)`), `probe rule for ${role}`);
    const def = new RegExp(`--color-globe-${role}:([^;]*);`).exec(tokens);
    assert.ok(def, `token for ${role}`);
    assert.doesNotMatch(def[1], /oklab|oklch/, `${role} must stay a colour parseColor reads`);
  }
});

// ---- incident sparks (#309 P3) ---------------------------------------------------------

const PULSING = Uint8Array.from([DOT.PULSE, DOT.LIT, DOT.PULSE]);
const CALM = Uint8Array.from([DOT.LIT, DOT.UNLIT, DOT.RESOLVED]);
async function mountSparks(states, reduced, extra = {}) {
  const { THREE, rec } = recordingThree();
  const dom = recordingDom();
  const handle = await mountGlobe(dom.host, { ...VIEW, states, reduced, seed: 5, ...extra, window: dom.window, document: dom.document, importThree: async () => THREE });
  return { handle, rec, dom };
}
const sparkPoints = (rec) => rec.points.filter((p) => p.material.opts.vertexShader === render.SPARK_VS);
const frameAt = (dom, ms) => {
  const fns = [...dom.frames.pending.values()];
  dom.frames.pending.clear();
  fns.forEach((fn) => fn(ms));
};

test('an open incident with motion adds one spark geometry and material, each freed once', async () => {
  const { handle, rec } = await mountSparks(PULSING, false);
  assert.equal(rec.geometries.length, 4);
  assert.equal(rec.materials.length, 5);
  assert.equal(sparkPoints(rec).length, 1);
  handle.dispose();
  handle.dispose();
  assert.deepEqual(rec.geometries.map((g) => g.disposed), [1, 1, 1, 1]);
  assert.deepEqual(rec.materials.map((m) => m.disposed), [1, 1, 1, 1, 1]);
});

test('under reduced motion an incident makes no sparks', async () => {
  const { handle, rec } = await mountSparks(PULSING, true);
  assert.equal(rec.geometries.length, 3);
  assert.equal(rec.materials.length, 4);
  handle.update(PULSING, null);
  assert.equal(rec.geometries.length, 3);
  handle.dispose();
});

test('sparks are made lazily, hidden while no dot pulses, and never made twice', async () => {
  const { handle, rec } = await mountSparks(CALM, false);
  assert.equal(rec.geometries.length, 3, 'no incident, no sparks yet');
  handle.update(PULSING, null);
  assert.equal(sparkPoints(rec).length, 1);
  assert.equal(sparkPoints(rec)[0].visible, true);
  handle.update(CALM, null);
  assert.equal(sparkPoints(rec)[0].visible, false);
  handle.update(PULSING, null);
  assert.equal(sparkPoints(rec).length, 1);
  assert.equal(sparkPoints(rec)[0].visible, true);
  assert.equal(rec.geometries.length, 4);
  handle.dispose();
  assert.deepEqual(rec.geometries.map((g) => g.disposed), [1, 1, 1, 1]);
});

test('a frame writes at most SLOTS live ages, on the pulsing dots; the rest are -1', async () => {
  const { handle, rec, dom } = await mountSparks(PULSING, false);
  const [{ geometry }] = sparkPoints(rec);
  let seen = 0;
  for (let ms = 1000; ms < 60000; ms += 500) {
    frameAt(dom, ms);
    const ages = [...geometry.attributes.aAge.array];
    const live = ages.filter((a) => a >= 0);
    assert.ok(live.length <= 6 * BURST.COUNT && live.length % BURST.COUNT === 0 && live.every((a) => a < 1));
    assert.deepEqual(ages.filter((a) => a < 0), ages.filter((a) => a < 0).map(() => -1));
    seen += live.length;
  }
  assert.ok(seen > 0, 'sparks appear');
  handle.update(CALM, null);
  frameAt(dom, 61000);
  assert.deepEqual([...geometry.attributes.aAge.array], Array(6 * BURST.COUNT).fill(-1));
  handle.dispose();
});

test('the spark shader hides the far side, uses the pulse colour, and sparks add no colour vectors', async () => {
  assert.match(render.SPARK_VS, /smoothstep\(-0\.02, 0\.32, n\.z\)/);
  assert.match(render.SPARK_VS, /vAlpha = aAge < 0\.0 \? 0\.0/, 'dead slots have no alpha');
  assert.match(render.SPARK_VS, /gl_PointSize = aAge < 0\.0 \? 0\.0/, 'dead slots have no size');
  assert.match(render.SPARK_FS, /uPulse/);
  const calm = await mountSparks(CALM, false);
  const loud = await mountSparks(PULSING, false);
  assert.equal(loud.rec.vectors, calm.rec.vectors, 'only the colour roles make Vector3');
  const [spark] = sparkPoints(loud.rec);
  const dots = loud.rec.materials[1].opts.uniforms;
  for (const u of ['uPulse', 'uPR', 'uScale']) assert.equal(spark.material.opts.uniforms[u], dots[u], `${u} is shared`);
  assert.equal(spark.material.opts.depthTest, false);
  assert.equal(spark.material.opts.depthWrite, false);
  calm.handle.dispose();
  loud.handle.dispose();
});

test('every live particle starts on a pulsing dot, a whole burst on one dot, and flies outward from it', async () => {
  const states = Uint8Array.from([DOT.PULSE, DOT.LIT, DOT.PULSE]);
  const pulsing = [0, 2].map((k) => spherePoint(DOTS[k][0], DOTS[k][1]));
  const { handle, rec, dom } = await mountSparks(states, false);
  const { geometry } = sparkPoints(rec)[0];
  let bursts = 0;
  for (let ms = 1000; ms < 90000; ms += 700) {
    frameAt(dom, ms);
    const { position, aAge, aDir } = geometry.attributes;
    for (let k = 0; k < 6; k++) {
      const first = k * BURST.COUNT;
      if (aAge.array[first] < 0) continue;
      bursts++;
      const at = [...position.array.slice(first * 3, first * 3 + 3)];
      const dirs = new Set();
      assert.ok(pulsing.some((p) => p.every((v, m) => Math.abs(v - at[m]) < 1e-6)), `burst ${k} starts at ${at}`);
      for (let j = 0; j < BURST.COUNT; j++) {
        const i = first + j;
        assert.deepEqual([...position.array.slice(i * 3, i * 3 + 3)], at, 'one dot per burst');
        assert.ok(aAge.array[i] >= 0);
        const raw = [...aDir.array.slice(i * 3, i * 3 + 3)];
        dirs.add(raw.map((v) => (v / Math.hypot(...raw)).toFixed(4)).join());
        const d = [...aDir.array.slice(i * 3, i * 3 + 3)];
        const out = d[0] * at[0] + d[1] * at[1] + d[2] * at[2];
        assert.ok(Math.hypot(...d) <= 1 + 1e-6 && out > 0, 'outward');
      }
      assert.equal(dirs.size, BURST.COUNT, 'every particle has its own direction');
    }
  }
  assert.ok(bursts > 0);
  assert.equal(sparkPoints(rec)[0].material.opts.uniforms.uTravel.value, BURST.TRAVEL);
  assert.match(render.SPARK_VS, /position \+ aDir \* uTravel \* \(1\.0 - f \* f\)/, 'particles travel away along aDir');
  handle.dispose();
});

test('each mount has its own seed: an injected seed or random decides the sparks, else crypto', async () => {
  const play = async (extra, crypto) => {
    const { THREE, rec } = recordingThree();
    const dom = recordingDom();
    if (crypto) dom.window.crypto = crypto;
    const h = await mountGlobe(dom.host, { ...VIEW, states: PULSING, reduced: false, ...extra, window: dom.window, document: dom.document, importThree: async () => THREE });
    const { geometry } = sparkPoints(rec)[0];
    const out = [];
    for (let ms = 1000; ms < 60000; ms += 700) {
      frameAt(dom, ms);
      out.push([...geometry.attributes.aAge.array].map((a) => (a < 0 ? 0 : 1)).join(''));
    }
    h.dispose();
    return JSON.stringify(out);
  };
  const fixed = (v) => ({ getRandomValues: (a) => ((a[0] = v), a) });
  assert.equal(await play({ seed: 11 }), await play({ seed: 11 }));
  assert.notEqual(await play({ seed: 11 }), await play({ seed: 12 }));
  assert.equal(await play({ random: () => 0.25 }), await play({ seed: Math.floor(0.25 * 2 ** 32) }));
  assert.equal(await play({}, fixed(77)), await play({ seed: 77 }));
  assert.notEqual(await play({}, fixed(77)), await play({}, fixed(78)));
});

test('the renderer writes each particle direction as tangentFrame x burstDir x burstSpeed for the mount seed', async () => {
  const states = Uint8Array.from([DOT.PULSE, DOT.LIT, DOT.PULSE]);
  const sources = [0, 2];
  const seen = {};
  for (const seed of [21, 22]) {
    const { handle, rec, dom } = await mountSparks(states, false, { seed });
    const { geometry } = sparkPoints(rec)[0];
    const firsts = [];
    for (let ms = 1000; ms < 60000; ms += 700) {
      frameAt(dom, ms);
      const live = sparksAt(ms / 1000, sources.length, seed);
      const { position, aDir, aAge } = geometry.attributes;
      live.forEach((sp, k) => {
        const n = spherePoint(DOTS[sources[sp.dot]][0], DOTS[sources[sp.dot]][1]);
        const [t1, t2] = tangentFrame(n);
        for (let j = 0; j < BURST.COUNT; j++) {
          const i = k * BURST.COUNT + j;
          const [a, b, c] = burstDir(sp.slot, sp.epoch, seed, j);
          const v = burstSpeed(sp.slot, sp.epoch, seed, j);
          for (let m = 0; m < 3; m++) {
            const want = (a * t1[m] + b * t2[m] + c * n[m]) * v;
            assert.ok(Math.abs(aDir.array[i * 3 + m] - want) < 1e-6, `seed ${seed} burst ${k} particle ${j}`);
          }
          assert.ok(Math.abs(aAge.array[i] - sp.age) < 1e-6);
        }
        firsts.push(...aDir.array.slice(k * BURST.COUNT * 3, k * BURST.COUNT * 3 + 3));
      });
    }
    assert.ok(firsts.length > 0);
    seen[seed] = firsts.map((v) => v.toFixed(4)).join();
    handle.dispose();
  }
  assert.notEqual(seen[21], seen[22], 'another seed, other directions');
});

test('the seed is drawn when sparks are first made, never by a mount without an incident', async () => {
  let calls = 0;
  const random = () => (calls++, 0.5);
  const calm = await mountSparks(CALM, false, { seed: undefined, random });
  calm.handle.update(CALM, null);
  assert.equal(calls, 0);
  calm.handle.update(PULSING, null);
  calm.handle.update(CALM, null);
  calm.handle.update(PULSING, null);
  assert.equal(calls, 1);
  calm.handle.dispose();
  const reduced = await mountSparks(PULSING, true, { seed: undefined, random });
  assert.equal(calls, 1, 'reduced motion never asks');
  reduced.handle.dispose();
});

// ---- the story: caption and legend (#309 P2) ----------------------------------------

const captionOf = (ids) => globeCaption(REG, globeState(REG, progressOf(ids), MAP));

test('the caption follows the story: dark, building, incident, saved, every region saved', () => {
  assert.deepEqual(captionOf([]), {
    phase: 'dark', actId: 'g0', region: 'Zero', done: 0, total: 3,
    text: 'The planet is dark. Shine the o11y light on your world.',
  });
  assert.deepEqual(captionOf(['a']), {
    phase: 'building', actId: 'g0', region: 'Zero', done: 1, total: 3, text: "You're building! Zero: 1 of 3 done.",
  });
  assert.equal(captionOf(['a', 'b']).phase, 'incident');
  assert.equal(captionOf(['a', 'b']).text, 'Alert! Zero is down. Tend to it now.');
  assert.deepEqual(captionOf(['a', 'b', 'boss0']), {
    phase: 'saved', actId: 'g0', region: 'Zero', done: 3, total: 3, text: 'Zero is calm. Next: One.',
  });
  const next = captionOf(['a', 'b', 'boss0', 'c']);
  assert.deepEqual([next.phase, next.actId, next.region, next.text], ['saved', 'g1', 'One', 'One is calm. Next: Two.']);
  const live = globeCaption(LIVE, globeState(LIVE, progressOf([...ACT_0, 'the-pager', 'resources'])));
  assert.deepEqual([live.phase, live.actId, live.text], ['building', 'act-1', "You're building! Northern Europe: 1 of 4 done."], 'building again once the next act is entered');
  const all = captionOf(['a', 'b', 'boss0', 'c', 'd']);
  assert.deepEqual(all, { phase: 'allSaved', actId: null, region: null, done: 5, total: 5, text: 'Every region is calm. You saved the day.' });
  assert.equal(captionOf(['a', 'b', 'c', 'd']).actId, 'g0', 'an open incident outranks the later acts');
  assert.equal(captionOf(['a', 'b', 'c', 'd']).phase, 'incident');
  const soon = globeCaption(REG, globeState(REG, progressOf(['a', 'b', 'boss0', 'c', 'd']), { ...MAP, ACT_REGIONS: { ...MAP.ACT_REGIONS, s7: { region: 'Seven' } } }, [S7]));
  assert.equal(soon.text, 'You saved the day. More regions are coming soon.');
});

test('an untouched current act with no saved act before it reads dark, even when a later act has progress', () => {
  const c = captionOf(['d']);
  assert.deepEqual([c.phase, c.actId, c.region], ['dark', 'g0', 'Zero']);
});

test('two open incidents: the caption names the lower act', () => {
  const state = {
    regions: {
      g0: { region: 'Zero', done: 3, total: 4, pulse: true, resolved: false },
      g1: { region: 'One', done: 1, total: 2, pulse: true, resolved: false },
    },
  };
  const reg = { acts: [{ id: 'g0' }, { id: 'g1' }] };
  assert.equal(globeCaption(reg, state).region, 'Zero');
});

test('no mapped region, no caption', () => {
  assert.equal(globeCaption(REG, { regions: {}, countries: {} }), null);
  assert.equal(globeCaption({ acts: [] }, { regions: {}, countries: {} }), null);
});

test('every live caption fits 60 characters, for every region and phase, with plain punctuation', () => {
  const maxTotal = Math.max(...LIVE.acts.map((a) => a.levelIds.length + (a.bossId == null ? 0 : 1)));
  assert.ok(maxTotal >= 3, 'the live registry has acts');
  const pair = { acts: [{ id: 'p' }, { id: 'q' }] };
  const names = Object.values(ACT_REGIONS).map((x) => x.region);
  for (const [k, region] of names.entries()) {
    const next = names[k + 1] ?? names[0];
    const r = (o) => ({ region, total: maxTotal, done: 0, pulse: false, resolved: false, ...o });
    const states = [
      { regions: { p: r({}) } },
      { regions: { p: r({ done: maxTotal - 1 }) } },
      { regions: { p: r({ done: maxTotal - 1, pulse: true }) } },
      { regions: { p: r({ done: maxTotal, resolved: true }), q: r({ region: next }) } },
      { regions: { p: r({ done: maxTotal, resolved: true }), q: r({ region: 'Next', done: maxTotal, resolved: true }) }, soon: { s: { region: 'S' } } },
    ];
    for (const state of states) {
      const { text } = globeCaption(pair, state);
      assert.ok(text.length <= 60, `${region}: "${text}" is ${text.length} characters`);
      assert.ok(!text.includes('\u2014') && !text.includes('  '), `${region}: "${text}"`);
    }
  }
});

test('the legend lists only what is drawn, in a fixed order, with its words', () => {
  const dots = [[0, 0, 'A', ''], [0, 0, 'B', ''], [0, 0, 'C', ''], [0, 0, 'D', ''], [0, 0, 'E', '']];
  const actOf = () => 'x';
  assert.deepEqual(globeLegend([0, 1, 2, 3, 4], dots, actOf), [
    { key: 'incident', text: 'Production down' },
    { key: 'resolved', text: 'Saved, all calm' },
    { key: 'lit', text: 'Instrumented' },
    { key: 'dark', text: 'Still dark' },
    { key: 'soon', text: 'Coming soon' },
  ]);
  assert.deepEqual(globeLegend([4, 0], [dots[0], dots[1]], (iso) => (iso === 'A' ? 'x' : null)).map((e) => e.key), ['resolved'], 'an unlit dot with no act is not "still dark"');
  assert.deepEqual(globeLegend([], [], actOf), []);
});
