// The ignite effect: what is freshly lit (lib/globe-ignite.mjs, pure), the camera target, the
// effect's timeline, the announcement, and the renderer playing it (lib/globe-render.mjs) with a
// recording fake three.js and a fake clock. Spec: issue #161, docs/FOUNDATION.md §2.7.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOTS } from '../hub/globe-data.mjs';
import { ACT_REGIONS, COUNTRY_NAMES, LEVEL_COUNTRY } from '../hub/globe-map.mjs';
import { liveRegistry } from '../app.mjs';
import { facingRotation, spherePoint } from '../lib/globe-view.mjs';
import { IGNITE_SECONDS, freshlyLit, igniteFrame, igniteView, litText } from '../lib/globe-ignite.mjs';
import { mountGlobe } from '../lib/globe-render.mjs';
import { emptyProgress } from '../lib/progress.mjs';
import { buildRegistry } from '../lib/registry.mjs';

const L = (id, no) => ({ id, no, name: `Level ${id}`, icon: '*', rewardTitle: `t-${id}`, mechanics: ['query'], run() {} });
const REG = buildRegistry(
  [
    { id: 'g0', no: 0, name: 'Zeroth', levels: [L('a', '0.1'), L('b', '0.2')], boss: L('boss0', null) },
    { id: 'g1', no: 1, name: 'First', levels: [L('c', '1.1')], boss: null },
  ],
  { deck: [], nodeIds: [] },
);
const MAP = {
  ACT_REGIONS: { g0: { region: 'Zero' }, g1: { region: 'One' } },
  LEVEL_COUNTRY: { a: 'AAA', b: 'BBB', c: 'CCC' },
  COUNTRY_NAMES: { AAA: 'Aland', BBB: 'Bland' },
};
const progressOf = (ids) => {
  const p = emptyProgress();
  for (const id of ids) p.levels[id] = { stars: 3, at: null };
  return p;
};
const fresh = (before, after) => freshlyLit(progressOf(before), progressOf(after), REG, MAP);

// ---- what is fresh ----------------------------------------------------------------------

test('the first completion lights its country; the region only when the act is complete', () => {
  assert.deepEqual(fresh([], ['a']), { countryIds: ['AAA'], regionIds: [] });
  assert.deepEqual(fresh(['a'], ['a', 'b']), { countryIds: ['BBB'], regionIds: [] }, 'the boss is still open');
});

test('replaying a completed level lights nothing', () => {
  assert.deepEqual(fresh(['a'], ['a']), { countryIds: [], regionIds: [] });
  assert.deepEqual(freshlyLit(progressOf(['a']), progressOf(['a']), REG, MAP), { countryIds: [], regionIds: [] });
});

test('a boss completion marks its act region and no country; a country-less act completion still marks the region', () => {
  assert.deepEqual(fresh(['a', 'b'], ['a', 'b', 'boss0']), { countryIds: [], regionIds: ['g0'] });
  assert.deepEqual(fresh(['a', 'b', 'boss0'], ['a', 'b', 'boss0', 'c']), { countryIds: ['CCC'], regionIds: ['g1'] });
  const bare = { ACT_REGIONS: MAP.ACT_REGIONS, LEVEL_COUNTRY: {} };
  assert.deepEqual(freshlyLit(progressOf(['a', 'b', 'boss0']), progressOf(['a', 'b', 'boss0', 'c']), REG, bare), {
    countryIds: [],
    regionIds: ['g1'],
  });
});

test('ids the map lacks and ids already in the previous progress are ignored', () => {
  const bare = { ACT_REGIONS: {}, LEVEL_COUNTRY: {} };
  assert.deepEqual(freshlyLit(progressOf([]), progressOf(['a']), REG, bare), { countryIds: [], regionIds: [] });
  assert.deepEqual(fresh(['a'], ['a', 'a2-unknown']), { countryIds: [], regionIds: [] });
});

test('the live map names every country a level lights', () => {
  for (const iso of Object.values(LEVEL_COUNTRY)) assert.equal(typeof COUNTRY_NAMES[iso], 'string', iso);
  assert.equal(COUNTRY_NAMES.DEU, 'Germany');
});

// ---- the announcement ------------------------------------------------------------------

test('the announcement names the country and the level; a region win names the region', () => {
  assert.equal(litText(fresh([], ['a']), REG.levels.a, MAP), 'Aland is now lit: Level a.');
  assert.equal(
    litText(fresh(['a', 'b'], ['a', 'b', 'boss0']), REG.levels.boss0, MAP),
    'Zero is now lit: Level boss0.',
  );
  assert.equal(
    litText(fresh(['a', 'b', 'boss0'], ['a', 'b', 'boss0', 'c']), REG.levels.c, MAP),
    'CCC is now lit: Level c. One is complete.',
    'a country without a name shows its code; an act completion adds the region',
  );
  assert.equal(litText(fresh(['a'], ['a']), REG.levels.a, MAP), '', 'a replay announces nothing');
  const live = liveRegistry();
  assert.equal(
    litText({ countryIds: ['DEU'], regionIds: [] }, live.levels['the-signals'], { ACT_REGIONS, LEVEL_COUNTRY, COUNTRY_NAMES }),
    `Germany is now lit: ${live.levels['the-signals'].name}.`,
  );
});

// ---- the view of an ignite: dots, ring, camera target ------------------------------------

const D = [
  [10, 0, 'XXX', ''],
  [12, 2, 'XXX', ''],
  [0, 20, 'YYY', ''],
  [5, 10, 'AAA', ''],
  [-30, 120, 'ZZZ', ''],
];
const ACT_OF = (iso) => ({ XXX: 'a0', YYY: 'a0', AAA: 'a0', ZZZ: 'a1' })[iso] ?? null;

function rotate([px, py, pz], { x, y }) {
  const x1 = px * Math.cos(y) + pz * Math.sin(y);
  const z1 = -px * Math.sin(y) + pz * Math.cos(y);
  return [x1, py * Math.cos(x) - z1 * Math.sin(x), py * Math.sin(x) + z1 * Math.cos(x)];
}

test("the camera target faces the fresh country's dot centroid", () => {
  const view = igniteView({ countryIds: ['XXX'], regionIds: [] }, D, ACT_OF);
  assert.deepEqual([...view.flare], [1, 1, 0, 0, 0]);
  assert.equal(view.region, false);
  assert.equal(view.country, true);
  const centre = spherePoint(11, 1); // the mean of (10, 0) and (12, 2) to within a degree
  const [, , z] = rotate(centre, view.target);
  assert.ok(z > 0.9999, `the centroid faces the camera (${z})`);
  assert.deepEqual(view.target.key, 'country:XXX');
  assert.ok(Math.hypot(...view.ring) > 0.999 && Math.hypot(...view.ring) < 1.001, 'the ring centre is a unit vector');
  const [rx, ry, rz] = view.ring;
  assert.ok(Math.hypot(rx - centre[0], ry - centre[1], rz - centre[2]) < 0.01, 'the ring starts at the centroid');
});

test('a region win turns to the region centre and gives each region dot a wave distance from 0 to 1', () => {
  const view = igniteView({ countryIds: [], regionIds: ['a0'] }, D, ACT_OF);
  assert.deepEqual([...view.flare], [0, 0, 0, 0, 0], 'no country, no flare');
  assert.equal(view.ring, null, 'no ring without a country');
  assert.equal(view.region, true);
  assert.equal(view.waveD[4], -1, 'a dot outside the region has no wave');
  const inside = [0, 1, 2, 3].map((k) => view.waveD[k]);
  assert.ok(inside.every((d) => d >= 0 && d <= 1), `distances ${inside}`);
  assert.equal(Math.max(...inside), 1, 'the farthest dot is at 1');
  assert.equal(view.target.key, 'region:a0');
  const want = facingRotation(...[5, 8]);
  assert.ok(Math.abs(view.target.y - want.y) < 0.3, 'it faces roughly the middle of the region');
});

test('a country and its region together: flare, ring and wave', () => {
  const view = igniteView({ countryIds: ['XXX'], regionIds: ['a0'] }, D, ACT_OF);
  assert.equal(view.country && view.region, true);
  assert.equal(view.target.key, 'country:XXX', 'the camera prefers the country');
  assert.equal(view.waveD[0] >= 0 && view.waveD[4] === -1, true);
});

test('nothing fresh gives no view', () => {
  assert.equal(igniteView({ countryIds: [], regionIds: [] }, D, ACT_OF), null);
  assert.equal(igniteView({ countryIds: ['NOPE'], regionIds: [] }, D, ACT_OF), null, 'a country without dots');
});

// ---- the timeline -----------------------------------------------------------------------

test('the effect lasts about a second and a half; the flare settles to nothing', () => {
  assert.equal(IGNITE_SECONDS, 1.5);
  const both = { country: true, region: true };
  const start = igniteFrame(0, both);
  assert.equal(start.done, false);
  assert.equal(start.flare, 0);
  assert.equal(start.ringR, 0);
  const frames = [];
  for (let t = 0; t <= 1.5; t += 0.05) frames.push(igniteFrame(t, both));
  const peak = Math.max(...frames.map((f) => f.flare));
  assert.ok(peak > 0.95 && peak <= 1, `peak ${peak}`);
  const after = frames.slice(frames.findIndex((f) => f.flare === peak));
  assert.ok(after.every((f, i) => i === 0 || f.flare <= after[i - 1].flare), 'it only fades after the peak');
  assert.ok(frames.every((f, i) => i === 0 || f.ringR >= frames[i - 1].ringR), 'the ring only grows');
  assert.ok(frames.every((f, i) => i === 0 || f.ringA <= frames[i - 1].ringA + 1e-9), 'the ring only fades');
  assert.ok(Math.max(...frames.map((f) => f.waveA)) > 0.2, 'the wave is visible');
  for (const t of [1.5, 2, 10]) {
    const end = igniteFrame(t, both);
    assert.deepEqual([end.done, end.flare, end.ringA, end.waveA], [true, 0, 0, 0], `at ${t} s`);
  }
  assert.equal(igniteFrame(0.7, { country: false, region: false }).flare, 0);
  assert.equal(igniteFrame(0.7, { country: false, region: true }).flare, 0);
  assert.equal(igniteFrame(0.7, { country: false, region: true }).ringA, 0);
  assert.equal(igniteFrame(0.7, { country: true, region: false }).waveA, 0);
});

// ---- the renderer plays it (recording fake three.js, fake clock) ---------------------------

function recordingThree() {
  const rec = { geometries: [], materials: [], renderer: null, renders: 0, groups: [], attributes: {} };
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
      rec.geometries.push(this);
    }
    setAttribute(name, attr) {
      rec.attributes[name] = attr;
    }
  }
  class ShaderMaterial extends Disposable {
    constructor(opts = {}) {
      super();
      this.uniforms = opts.uniforms ?? {};
      rec.materials.push(this);
    }
  }
  class Vec3 {
    constructor(x = 0, y = 0, z = 0) {
      this.v = [x, y, z];
    }
    set(x, y, z) {
      this.v = [x, y, z];
      return this;
    }
  }
  class Node3 {
    constructor() {
      this.rotation = { last: null, set: (x, y, z) => (this.rotation.last = [x, y, z]) };
      this.position = { set() {} };
    }
    add() {}
    updateProjectionMatrix() {}
  }
  class WebGLRenderer {
    constructor() {
      rec.renderer = this;
      this.calls = { disposed: 0, contextLoss: 0 };
    }
    setPixelRatio() {}
    getPixelRatio() {
      return 1;
    }
    setClearColor() {}
    setSize() {}
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
    SphereGeometry: class SphereGeometry extends BufferGeometry {},
    ShaderMaterial,
    BufferAttribute: class {
      constructor(array) {
        this.array = array;
      }
    },
    Vector3: Vec3,
    Color: class {
      setRGB() {
        return this;
      }
    },
    Scene: class Scene extends Node3 {},
    PerspectiveCamera: class PerspectiveCamera extends Node3 {},
    Group: class Group extends Node3 {
      constructor() {
        super();
        rec.groups.push(this);
      }
    },
    Mesh: class Mesh extends Node3 {},
    Points: class Points extends Node3 {},
    AdditiveBlending: 2,
    BackSide: 1,
    FrontSide: 0,
    SRGBColorSpace: 'srgb',
  };
  return { THREE, rec };
}

function recordingDom() {
  const host = { clientWidth: 400, clientHeight: 400, children: [], addEventListener() {}, removeEventListener() {} };
  host.appendChild = (el) => host.children.push(el);
  const document = { hidden: false, addEventListener() {}, removeEventListener() {} };
  document.createElement = (tag) => {
    const el = { tag, className: '', setAttribute() {}, addEventListener() {}, removeEventListener() {} };
    el.remove = () => (host.children = host.children.filter((c) => c !== el));
    return el;
  };
  const frames = { pending: new Map(), next: 1, cancelled: 0, ms: 0 };
  const window = {
    devicePixelRatio: 1,
    getComputedStyle: () => ({ color: 'rgb(10, 20, 30)' }),
    requestAnimationFrame: (fn) => {
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
  /** The fake clock: run every pending frame once, `step` ms later than the last. */
  const tick = (step = 16) => {
    frames.ms += step;
    const run = [...frames.pending.entries()];
    frames.pending.clear();
    for (const [, fn] of run) fn(frames.ms);
  };
  return { host, document, window, frames, tick };
}

const BASE = { dots: D, states: new Uint8Array(D.length), target: null };
const VIEW_XXX = () => igniteView({ countryIds: ['XXX'], regionIds: [] }, D, ACT_OF);
const VIEW_BOTH = () => igniteView({ countryIds: ['XXX'], regionIds: ['a0'] }, D, ACT_OF);
const uniforms = (rec) => Object.assign({}, ...rec.materials.map((m) => m.uniforms));
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

async function mounted({ reduced = false } = {}) {
  const { THREE, rec } = recordingThree();
  const dom = recordingDom();
  const handle = await mountGlobe(dom.host, { ...BASE, reduced, window: dom.window, document: dom.document, importThree: async () => THREE });
  dom.tick(); // the first frame
  return { handle, rec, dom };
}

test('ignite: the globe turns to the country first, then the dots flare, the ring ripples and all settle to nothing', async () => {
  const { handle, rec, dom } = await mounted();
  // ZZZ is far from the default view, so the turn takes a while.
  const view = igniteView({ countryIds: ['ZZZ'], regionIds: ['a1'] }, D, ACT_OF);
  handle.ignite(view, new Uint8Array([0, 0, 0, 0, 1]));
  const seen = { flare: 0, ringA: 0, waveA: 0, turnedAtFlare: null };
  let frames = 0;
  while (frames++ < 600) {
    dom.tick();
    const u = uniforms(rec);
    if (u.uFlare.value > 0 && seen.turnedAtFlare === null) {
      seen.turnedAtFlare = Math.abs(wrap(rec.groups[0].rotation.last[1] - view.target.y));
    }
    seen.flare = Math.max(seen.flare, u.uFlare.value);
    seen.ringA = Math.max(seen.ringA, u.uRingA.value);
    seen.waveA = Math.max(seen.waveA, u.uWaveA.value);
  }
  assert.ok(seen.flare > 0.9 && seen.ringA > 0.2 && seen.waveA > 0.2, JSON.stringify(seen));
  assert.ok(seen.turnedAtFlare !== null && seen.turnedAtFlare < 0.5, `the flare starts once the globe has turned (${seen.turnedAtFlare})`);
  const u = uniforms(rec);
  assert.equal(u.uFlare.value, 0, 'the flare settles to the plain lit colour');
  assert.equal(u.uRingA.value, 0);
  assert.equal(u.uWaveA.value, 0);
  assert.equal(rec.attributes.aFlare.array[4], 1, 'the country dots are marked');
  assert.equal(rec.attributes.aFlare.array[0], 0);
  handle.dispose();
});

test('ignite plays about 1.5 s of frames, once', async () => {
  const { handle, rec, dom } = await mounted();
  handle.ignite(VIEW_XXX(), new Uint8Array([1, 1, 0, 0, 0]));
  let active = 0;
  let after = 0;
  let started = false;
  for (let i = 0; i < 500; i++) {
    dom.tick(16);
    const on = uniforms(rec).uFlare.value > 0 || uniforms(rec).uRingA.value > 0;
    if (on) {
      started = true;
      active++;
    } else if (started) after++;
  }
  assert.ok(active * 0.016 > 1.0 && active * 0.016 < 1.8, `${active} frames of effect`);
  assert.ok(after > 100, 'it does not start again');
  handle.dispose();
});

test('disposing mid-effect cancels the frame and frees the ring too, once', async () => {
  const { handle, rec, dom } = await mounted();
  handle.ignite(VIEW_XXX(), new Uint8Array([1, 1, 0, 0, 0]));
  for (let i = 0; i < 60; i++) dom.tick();
  assert.ok(uniforms(rec).uRingA.value > 0 || uniforms(rec).uFlare.value > 0, 'mid-effect');
  const made = { geometries: rec.geometries.length, materials: rec.materials.length };
  assert.ok(made.geometries >= 4 && made.materials >= 5, 'the ring has its own geometry and material');
  handle.dispose();
  handle.dispose();
  assert.equal(dom.frames.pending.size, 0, 'no frame left scheduled');
  assert.equal(rec.geometries.every((g) => g.disposed === 1), true, 'every geometry freed once');
  assert.equal(rec.materials.every((m) => m.disposed === 1), true, 'every material freed once');
  assert.equal(rec.renderer.calls.disposed, 1);
  assert.equal(rec.renderer.calls.contextLoss, 1);
  const renders = rec.renders;
  handle.ignite(VIEW_XXX(), new Uint8Array(D.length));
  dom.tick();
  assert.equal(rec.renders, renders, 'a disposed globe ignores an ignite');
});

test('ignite twice makes the ring resources once', async () => {
  const { handle, rec, dom } = await mounted();
  handle.ignite(VIEW_XXX(), new Uint8Array([1, 1, 0, 0, 0]));
  const n = rec.materials.length;
  for (let i = 0; i < 200; i++) dom.tick();
  handle.ignite(VIEW_XXX(), new Uint8Array([1, 1, 0, 0, 0]));
  assert.equal(rec.materials.length, n);
  handle.dispose();
});

test('reduced motion: no flare, no ring, no turning animation; the globe faces the country directly', async () => {
  const { handle, rec, dom } = await mounted({ reduced: true });
  const view = VIEW_BOTH();
  const before = { materials: rec.materials.length, geometries: rec.geometries.length };
  handle.ignite(view, new Uint8Array([1, 1, 0, 0, 0]));
  dom.tick();
  assert.deepEqual(rec.groups[0].rotation.last, [view.target.x, view.target.y, 0], 'facing the country at once');
  for (let i = 0; i < 5; i++) dom.tick();
  const u = uniforms(rec);
  assert.equal(u.uFlare.value, 0);
  assert.equal(u.uWaveA.value, 0);
  assert.equal(u.uRingA?.value ?? 0, 0);
  assert.equal(rec.materials.length, before.materials, 'no ring made');
  assert.equal(rec.geometries.length, before.geometries);
  assert.equal(dom.frames.pending.size, 0, 'reduced motion never loops');
  handle.dispose();
});
