// lib/swirl.mjs (pure) and lib/swirl-render.mjs (three.js, with a fake): the dot swirl that
// plays once when a Build it trace is assembled (#146, folds in #151). Reduced motion and no
// WebGL both show the settled frame as a static SVG ring and never load three.js. Asserts
// strings, numbers and booleans only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDom, q, qa } from './helpers/dom.mjs';
import { SWIRL_DOTS, SWIRL_MS, staticSwirlSvg, swirlLayout, swirlMode } from '../lib/swirl.mjs';
import { playSwirl } from '../lib/swirl-render.mjs';

test('swirlMode: it plays only with motion allowed and WebGL present', () => {
  assert.equal(swirlMode({ reduced: false, webgl: true }), 'play');
  assert.equal(swirlMode({ reduced: true, webgl: true }), 'static');
  assert.equal(swirlMode({ reduced: false, webgl: false }), 'static');
  assert.equal(swirlMode({ reduced: true, webgl: false }), 'static');
});

test('swirlLayout: the dots spin in and settle on a flat disc of radius 1', () => {
  const end = swirlLayout(1, 64);
  const start = swirlLayout(0, 64);
  assert.equal(end.length, 64 * 3);
  const radius = (p, i) => Math.hypot(p[i * 3], p[i * 3 + 1]);
  assert.equal(Math.max(...Array.from({ length: 64 }, (_, i) => radius(end, i))) <= 1 + 1e-9, true);
  assert.equal(Array.from({ length: 64 }, (_, i) => end[i * 3 + 2]).every((z) => Math.abs(z) < 1e-9), true, 'flat when settled');
  assert.equal(Math.max(...Array.from({ length: 64 }, (_, i) => radius(start, i))) > 1.2, true, 'spread out at the start');
});

test('staticSwirlSvg: an aria-hidden, unfocusable ring of dots drawn with attributes only', () => {
  makeDom();
  document.body.innerHTML = staticSwirlSvg();
  assert.equal(q('svg').getAttribute('aria-hidden'), 'true');
  assert.equal(q('svg').getAttribute('focusable'), 'false');
  assert.equal(qa('svg circle').length, SWIRL_DOTS);
  assert.equal(/\sstyle=|\son\w+=/.test(document.body.innerHTML), false);
  assert.equal(qa('svg text, svg title').length, 0, 'no text');
});

/** A fake three.js that records the renderer's life; `failRenderer` makes WebGL unavailable. */
function fakeThree({ failRenderer = false } = {}) {
  const rec = { imported: 0, renderers: 0, renders: 0, loop: null, disposed: 0, contextLoss: 0, geometries: 0, freed: 0 };
  class Disposable {
    dispose() {
      rec.freed++;
    }
  }
  class Node3 {
    constructor() {
      this.rotation = { x: 0, set() {} };
      this.position = { set() {} };
    }
    add() {}
  }
  const THREE = {
    WebGLRenderer: class {
      constructor({ canvas }) {
        if (failRenderer) throw new Error('Error creating WebGL context.');
        rec.renderers++;
        this.domElement = canvas;
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
      setAnimationLoop(fn) {
        rec.loop = fn;
      }
      dispose() {
        rec.disposed++;
      }
      forceContextLoss() {
        rec.contextLoss++;
      }
    },
    BufferGeometry: class extends Disposable {
      constructor() {
        super();
        rec.geometries++;
        this.attributes = {};
      }
      setAttribute(name, attr) {
        this.attributes[name] = attr;
      }
    },
    BufferAttribute: class {
      constructor(array) {
        this.array = array;
      }
    },
    ShaderMaterial: class extends Disposable {},
    Points: class extends Node3 {},
    Scene: class extends Node3 {},
    PerspectiveCamera: class extends Node3 {},
    AdditiveBlending: 2,
  };
  const importThree = async () => {
    rec.imported++;
    return THREE;
  };
  return { rec, importThree };
}

function host({ webgl = true } = {}) {
  const { window } = makeDom();
  // Set it either way: linkedom's window writes unknown properties through to globalThis,
  // so a stub from an earlier test would otherwise still be there.
  window.WebGL2RenderingContext = webgl ? function WebGL2RenderingContext() {} : undefined;
  document.body.innerHTML = '<div id="swirl" data-swirl aria-hidden="true"></div>';
  return { el: q('#swirl'), window };
}

test('reduced motion: the static frame, and three.js is never loaded', async () => {
  const { el } = host();
  const { rec, importThree } = fakeThree();
  assert.equal(await playSwirl(el, { reduced: true, importThree }), 'static');
  assert.equal(rec.imported, 0);
  assert.equal(qa('#swirl svg circle').length, SWIRL_DOTS);
  assert.equal(qa('#swirl canvas').length, 0);
});

test('no WebGL in the window: the static frame, and three.js is never loaded', async () => {
  const { el } = host({ webgl: false });
  const { rec, importThree } = fakeThree();
  assert.equal(await playSwirl(el, { reduced: false, importThree }), 'static');
  assert.equal(rec.imported, 0);
  assert.equal(qa('#swirl svg circle').length, SWIRL_DOTS);
});

test('a WebGL context that cannot be made, or three.js that fails to load: the static frame, nothing left over', async () => {
  const { el } = host();
  const { rec, importThree } = fakeThree({ failRenderer: true });
  assert.equal(await playSwirl(el, { reduced: false, importThree }), 'static');
  assert.equal(rec.imported, 1);
  assert.equal(qa('#swirl canvas').length, 0);
  assert.equal(qa('#swirl svg circle').length, SWIRL_DOTS);
  const other = host();
  assert.equal(await playSwirl(other.el, { reduced: false, importThree: () => Promise.reject(new Error('404')) }), 'static');
  assert.equal(qa('#swirl svg circle').length, SWIRL_DOTS);
});

test('with motion and WebGL it plays once, then settles to the static frame and releases its context', async () => {
  const { el } = host();
  const { rec, importThree } = fakeThree();
  let t = 1000;
  const run = playSwirl(el, { reduced: false, importThree, now: () => t });
  await new Promise((r) => setImmediate(r));
  assert.equal(rec.renderers, 1);
  assert.equal(qa('#swirl canvas').length, 1);
  assert.equal(typeof rec.loop, 'function');
  rec.loop();
  t += SWIRL_MS / 2;
  rec.loop();
  assert.equal(rec.renders, 2);
  assert.equal(rec.disposed, 0, 'still playing');
  t += SWIRL_MS;
  rec.loop();
  assert.equal(await run, 'played');
  assert.equal(rec.renders, 3);
  assert.equal(rec.loop, null, 'the loop is stopped');
  assert.deepEqual([rec.disposed, rec.contextLoss], [1, 1]);
  assert.equal(rec.freed >= 2, true, 'geometry and material freed');
  assert.equal(qa('#swirl canvas').length, 0, 'canvas removed');
  assert.equal(qa('#swirl svg circle').length, SWIRL_DOTS, 'the settled frame stays');
});

test('an aborted signal (the overlay closed) stops it and releases the context', async () => {
  const { el } = host();
  const { rec, importThree } = fakeThree();
  const ac = new AbortController();
  const run = playSwirl(el, { reduced: false, importThree, signal: ac.signal, now: () => 0 });
  await new Promise((r) => setImmediate(r));
  rec.loop();
  ac.abort();
  assert.equal(await run, 'stopped');
  assert.deepEqual([rec.disposed, rec.contextLoss], [1, 1]);
  assert.equal(rec.loop, null);
  assert.equal(qa('#swirl canvas').length, 0);
});

test('an abort that lands while three.js loads: stopped, no renderer, no loop, nothing in the host', async () => {
  const { el } = host();
  const { rec, importThree } = fakeThree();
  const ac = new AbortController();
  const slow = async () => {
    const three = await importThree();
    ac.abort(); // the player left as the module arrived
    return three;
  };
  assert.equal(await playSwirl(el, { reduced: false, importThree: slow, signal: ac.signal, now: () => 0 }), 'stopped');
  assert.equal(rec.renderers, 0, 'no renderer was made');
  assert.equal(rec.loop, null);
  assert.equal(qa('#swirl canvas').length, 0);
  assert.equal(qa('#swirl svg').length, 0, 'nothing is drawn for a card that is gone');
});

test('an abort that lands as the renderer is made: stopped, the context released, no loop, no canvas', async () => {
  const { el } = host();
  const { rec, importThree } = fakeThree();
  const ac = new AbortController();
  const made = async () => {
    const three = await importThree();
    const Renderer = three.WebGLRenderer;
    return {
      ...three,
      WebGLRenderer: class extends Renderer {
        constructor(opts) {
          super(opts);
          ac.abort();
        }
      },
    };
  };
  assert.equal(await playSwirl(el, { reduced: false, importThree: made, signal: ac.signal, now: () => 0 }), 'stopped');
  assert.equal(rec.renderers, 1);
  assert.deepEqual([rec.disposed, rec.contextLoss], [1, 1], 'the context is released');
  assert.equal(rec.loop, null);
  assert.equal(qa('#swirl canvas').length, 0);
});
