// The hub globe in WebGL (three.js 0.180.0, vendored; docs/FOUNDATION.md §2.7). Land dots are
// THREE.Points: unlit dim grey, lit a warm glow with a soft additive halo, and the open
// incident's region a slow coral pulse, over a dark body with a faint rim. It turns slowly and
// can be dragged. Everything it shows comes from lib/globe-view.mjs; colours are the
// --color-globe-* tokens, read at mount. No top-level DOM access and three.js loads on mount,
// so this module imports cleanly under node --test. handle.ignite() plays the #161 effect
// (a flare on the new country's dots, a ring over the sphere, a wave across a region) from
// what lib/globe-ignite.mjs decided; it is never played under reduced motion. An open incident
// also throws off a few sparks from its pulsing dots (lib/globe-sparks.mjs), never under reduced motion. The canvas is sized by CSS (.globe-canvas)
// and setSize(w, h, false): no style attribute is ever written (CSP style-src 'self').
import { igniteFrame } from './globe-ignite.mjs';
import { BURST, SPARK, burstDir, burstSpeed, sparkSources, sparksAt, tangentFrame } from './globe-sparks.mjs';
import { createLoop, DOT, MAX_TILT, readColors, spherePoint } from './globe-view.mjs';

const loadThree = () => import('../vendor/three-0.180.0/three.module.min.js');

const MAX_PIXEL_RATIO = 2;
const SPIN = 0.066; // auto-rotation, radians per second (a turn in about 95 s)
const SEEK = 2.5; // how fast the globe turns to its target on load (1/s, exponential)
const SEEK_FROM = 0.8; // it starts this far (radians) east of the target and turns to it
const DEFAULT_VIEW = { x: 0.42, y: -1.95 }; // no target: Europe and Africa
const BASE_HEIGHT = 560; // the stage height (CSS px) the dot sizes are tuned for
const STATIC_T = 0.6; // the pulse phase a reduced-motion frame shows
const TURN_CLOSE = 0.35; // the ignite starts once the globe is this close (radians) to facing its target
const TURN_WAIT = 2.5; // ...or after this many seconds, whatever the turn is doing

export const DOT_VS = `
  attribute float aState; attribute float aSeed; attribute float aFlare; attribute float aWaveD;
  uniform float uFlare; uniform float uWave; uniform float uWaveA;
  uniform float uTime; uniform float uPR; uniform float uScale; uniform float uHalo; uniform float uSize;
  uniform vec3 uDim; uniform vec3 uLit; uniform vec3 uPulse; uniform vec3 uResolved;
  varying vec3 vColor; varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vec3 n = normalize((modelViewMatrix * vec4(position, 0.0)).xyz);
    float facing = smoothstep(-0.02, 0.32, n.z);
    float a; vec3 c; float sz = 1.0;
    if (aState < 0.5) { c = uDim; a = uHalo > 0.5 ? 0.0 : 0.75; sz = 0.85; }
    else if (aState < 1.5) { c = uLit; float f = 0.86 + 0.14 * sin(uTime * 1.1 + aSeed * 6.283); a = (uHalo > 0.5 ? 0.075 : 1.0) * f; }
    else if (aState < 2.5) { float p = 0.5 + 0.5 * sin(uTime * 1.5 - aSeed * 1.2); c = uPulse; a = uHalo > 0.5 ? 0.11 * p : 0.30 + 0.70 * p; sz = 0.95 + 0.15 * p; }
    else if (aState < 3.5) { c = uDim; a = uHalo > 0.5 ? 0.0 : 0.3; sz = 0.7; }
    else { c = uResolved; a = (uHalo > 0.5 ? 0.12 : 1.0); sz = 1.05; }
    float wv = aWaveD >= 0.0 && ((aState > 0.5 && aState < 2.5) || aState > 3.5) ? uWaveA * exp(-pow((aWaveD - uWave) / 0.2, 2.0)) : 0.0;
    float fl = clamp(aFlare * uFlare + wv, 0.0, 1.0);
    c = mix(c, mix(c, vec3(1.0), 0.6), fl); a *= 1.0 + 0.9 * fl; sz *= 1.0 + 0.5 * aFlare * uFlare;
    vColor = c; vAlpha = a * facing;
    gl_PointSize = uSize * sz * uPR * uScale * (3.2 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }`;
const DOT_FS = `
  uniform float uHalo; varying vec3 vColor; varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0 || vAlpha < 0.003) discard;
    float m = uHalo > 0.5 ? exp(-d * d * 3.5) : smoothstep(1.0, 0.45, d);
    gl_FragColor = vec4(vColor * vAlpha * m, 1.0);
  }`;
// An open incident throws off sparks (lib/globe-sparks.mjs): each is a burst of BURST.COUNT
// particles from one pulsing dot, one Points object, aAge -1 when dead. aDir is the particle's
// direction times its speed; it travels uTravel globe radii, fast at first. The facing smoothstep
// is the dots' own, taken at the dot: depth test is off, so without it a far-side spark would show
// through the globe.
export const SPARK_VS = `
  attribute float aAge; attribute vec3 aDir;
  uniform float uPR; uniform float uScale; uniform float uTravel;
  varying float vAlpha;
  void main() {
    float f = 1.0 - clamp(aAge, 0.0, 1.0);
    vec4 mv = modelViewMatrix * vec4(position + aDir * uTravel * (1.0 - f * f), 1.0);
    vec3 n = normalize((modelViewMatrix * vec4(position, 0.0)).xyz);
    float facing = smoothstep(-0.02, 0.32, n.z);
    vAlpha = aAge < 0.0 ? 0.0 : smoothstep(0.0, 0.08, aAge) * f * f * facing;
    gl_PointSize = aAge < 0.0 ? 0.0 : 12.0 * (1.0 - 0.7 * aAge) * uPR * uScale * (3.2 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }`;
export const SPARK_FS = `
  uniform vec3 uPulse; varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0 || vAlpha < 0.003) discard;
    gl_FragColor = vec4(uPulse * vAlpha * exp(-d * d * 4.0), 1.0);
  }`;
const BODY_FS = `uniform vec3 uColor; void main() { gl_FragColor = vec4(uColor, 1.0); }`;
const BODY_VS = `void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const RING_VS = `varying vec3 vP; varying float vF; void main() { vP = normalize(position); vec3 n = normalize((modelViewMatrix * vec4(position, 0.0)).xyz); vF = smoothstep(-0.02, 0.32, n.z); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const RING_FS = `uniform vec3 uTint; uniform vec3 uRingC; uniform float uRingR; uniform float uRingA; varying vec3 vP; varying float vF;
  void main() { float ang = acos(clamp(dot(normalize(vP), uRingC), -1.0, 1.0)); float i = exp(-pow((ang - uRingR) / 0.07, 2.0)) * uRingA * 0.55 * vF; gl_FragColor = vec4(uTint * i, 1.0); }`;
const RIM_VS = `varying vec3 vN; void main() { vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const RIM_FS = `uniform vec3 uColor; varying vec3 vN; void main() { float i = pow(clamp(-vN.z * 1.9, 0.0, 1.0), 2.4); gl_FragColor = vec4(uColor * i * 0.32, 1.0); }`;

/**
 * getComputedStyle colour of a hidden `.globe-probe.<role>` element inside `host`, one new
 * element per role. Changing a reused element's class can start a transition (under
 * prefers-reduced-motion every element has one, styles/base.css), and a read straight after
 * gives the previous colour (#169); a new element has no previous style to transition from.
 */
function probeColors(win, doc, host) {
  return readColors((role) => {
    const probe = doc.createElement('span');
    probe.className = `globe-probe ${role}`;
    probe.setAttribute('aria-hidden', 'true');
    host.appendChild(probe);
    try {
      return win.getComputedStyle(probe).color;
    } finally {
      probe.remove();
    }
  });
}

/**
 * Draw the globe into `host`. opts: { window, document, dots, states (Uint8Array of DOT),
 * target ({x, y} rotation or null), reduced (boolean), onFail? (called if the WebGL context is
 * lost), importThree? (for tests) }. Resolves to { update(states, target), dispose() }, or null
 * when three.js, the colours or WebGL are unavailable (the hub then shows its text fallback).
 */
export async function mountGlobe(host, opts) {
  const { window: win, document: doc, dots, reduced, onFail = () => {}, importThree = loadThree } = opts;
  let THREE;
  try {
    THREE = await importThree();
  } catch {
    return null;
  }
  const colors = probeColors(win, doc, host);
  if (colors === null) return null;
  const canvas = doc.createElement('canvas');
  canvas.className = 'globe-canvas';
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'low-power' });
  } catch {
    return null; // no WebGL 2
  }
  // Every resource registers its release here as it is made; dispose() (or a failure part way
  // through setup, which then gives null for the text fallback) runs them newest first, so the
  // WebGL context is always freed.
  const cleanup = [];
  const release = () => {
    while (cleanup.length) {
      try {
        cleanup.pop()();
      } catch {
        // keep releasing the rest
      }
    }
  };
  cleanup.push(() => canvas.remove());
  cleanup.push(() => {
    renderer.dispose();
    renderer.forceContextLoss();
  });
  try {
    return setup();
  } catch {
    release();
    return null;
  }

  function setup() {
    renderer.setPixelRatio(Math.min(win.devicePixelRatio || 1, MAX_PIXEL_RATIO));
    // An opaque canvas cleared to the sky token: additive glow on a transparent canvas would
    // write alpha 1 and show the rim sphere as a black disc.
    renderer.setClearColor(new THREE.Color().setRGB(...colors.sky, THREE.SRGBColorSpace), 1);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
    camera.position.set(0, 0, 4.3);
    const vec = (rgb) => new THREE.Vector3(...rgb);

    const count = dots.length;
    const pos = new Float32Array(count * 3);
    const state = new Float32Array(count);
    const seed = new Float32Array(count);
    for (let k = 0; k < count; k++) {
      pos.set(spherePoint(dots[k][0], dots[k][1]), k * 3);
      seed[k] = (Math.sin(k * 12.9898) * 43758.5453) % 1;
    }
    const geo = new THREE.BufferGeometry();
    cleanup.push(() => geo.dispose());
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const stateAttr = new THREE.BufferAttribute(state, 1);
    geo.setAttribute('aState', stateAttr);
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const flareAttr = new THREE.BufferAttribute(new Float32Array(count), 1);
    geo.setAttribute('aFlare', flareAttr);
    const waveAttr = new THREE.BufferAttribute(new Float32Array(count).fill(-1), 1);
    geo.setAttribute('aWaveD', waveAttr);
    const shared = {
      uTime: { value: STATIC_T },
      uPR: { value: renderer.getPixelRatio() },
      uScale: { value: 1 },
      uDim: { value: vec(colors.dim) },
      uLit: { value: vec(colors.lit) },
      uPulse: { value: vec(colors.pulse) },
      uResolved: { value: vec(colors.resolved) },
      uFlare: { value: 0 },
      uWave: { value: -1 },
      uWaveA: { value: 0 },
    };
    const dotMaterial = (halo, size) =>
      new THREE.ShaderMaterial({
        vertexShader: DOT_VS,
        fragmentShader: DOT_FS,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        uniforms: { ...shared, uHalo: { value: halo }, uSize: { value: size } },
      });
    const bodyGeo = new THREE.SphereGeometry(0.985, 64, 48);
    cleanup.push(() => bodyGeo.dispose());
    const rimGeo = new THREE.SphereGeometry(1.16, 64, 48);
    cleanup.push(() => rimGeo.dispose());
    const materials = [
      new THREE.ShaderMaterial({ vertexShader: BODY_VS, fragmentShader: BODY_FS, uniforms: { uColor: { value: vec(colors.body) } } }),
      dotMaterial(1, 15),
      dotMaterial(0, 3.1),
      new THREE.ShaderMaterial({
        vertexShader: RIM_VS,
        fragmentShader: RIM_FS,
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uColor: { value: vec(colors.rim) } },
      }),
    ];
    cleanup.push(() => materials.forEach((m) => m.dispose()));
    const group = new THREE.Group();
    group.add(new THREE.Mesh(bodyGeo, materials[0])); // hides the far side
    group.add(new THREE.Points(geo, materials[1])); // halos
    group.add(new THREE.Points(geo, materials[2])); // dots
    scene.add(new THREE.Mesh(rimGeo, materials[3]));
    scene.add(group);

    // Rotation: turn to the target, then spin slowly; a drag takes over until released.
    let rot = { ...DEFAULT_VIEW };
    let goal = null;
    let aimedAct = null;
    // Turn to `target`. `fromHere`: from the current view by the short way, not from SEEK_FROM.
    const turnTo = (target, fromHere = false) => {
      goal = { x: target.x, y: target.y };
      if (reduced) {
        rot = { ...goal };
        goal = null;
      } else if (fromHere) {
        rot.y = goal.y + Math.atan2(Math.sin(rot.y - goal.y), Math.cos(rot.y - goal.y));
      } else {
        rot = { x: goal.x, y: goal.y - SEEK_FROM };
      }
    };
    // Turn to the act's target when the act differs from last time (an update keeps the view,
    // also after an ignite turned to a country: that never changes the act aimed at).
    const aim = (target) => {
      if (target == null || target.actId === aimedAct) return;
      aimedAct = target.actId;
      turnTo(target);
    };
    // The incident sparks: made on the first state with a pulsing dot (never under reduced motion),
    // hidden while there is none; a failure to make them leaves the globe without sparks.
    // A seed per mount, so each visit plays its own sparks: opts.seed, else opts.random, else crypto.
    const sparkSeed =
      opts.seed ??
      (opts.random ? Math.floor(opts.random() * 2 ** 32) : (win.crypto?.getRandomValues?.(new Uint32Array(1))[0] ?? (Math.random() * 2 ** 32)));
    let sources = new Uint32Array(0);
    let sparks = null;
    let sparksFailed = false;
    const PARTICLES = SPARK.SLOTS * BURST.COUNT;
    const makeSparks = () => {
      const sparkGeo = new THREE.BufferGeometry();
      cleanup.push(() => sparkGeo.dispose());
      const sparkPos = new Float32Array(PARTICLES * 3);
      for (let k = 0; k < PARTICLES; k++) sparkPos[k * 3 + 2] = 1;
      const dirs = new Float32Array(PARTICLES * 3);
      const ages = new Float32Array(PARTICLES).fill(-1);
      const posAttr = new THREE.BufferAttribute(sparkPos, 3);
      const dirAttr = new THREE.BufferAttribute(dirs, 3);
      const ageAttr = new THREE.BufferAttribute(ages, 1);
      sparkGeo.setAttribute('position', posAttr);
      sparkGeo.setAttribute('aDir', dirAttr);
      sparkGeo.setAttribute('aAge', ageAttr);
      const sparkMat = new THREE.ShaderMaterial({
        vertexShader: SPARK_VS,
        fragmentShader: SPARK_FS,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uPulse: shared.uPulse, uPR: shared.uPR, uScale: shared.uScale, uTravel: { value: BURST.TRAVEL } },
      });
      cleanup.push(() => sparkMat.dispose());
      const points = new THREE.Points(sparkGeo, sparkMat);
      points.frustumCulled = false; // its vertices move every frame
      group.add(points);
      sparks = { points, pos: sparkPos, dirs, ages, posAttr, dirAttr, ageAttr, live: false };
    };
    const syncSparks = () => {
      sources = sparkSources(state);
      if (sparks) sparks.points.visible = sources.length > 0;
      else if (!reduced && !sparksFailed && sources.length > 0) {
        try {
          makeSparks();
        } catch {
          sparksFailed = true;
        }
      }
    };
    const setStates = (states) => {
      for (let k = 0; k < count; k++) state[k] = states[k] ?? DOT.UNLIT;
      stateAttr.needsUpdate = true;
      syncSparks();
    };
    setStates(opts.states);
    aim(opts.target);

    // The ignite effect in flight: { country, region, wait, elapsed, running } or null. It waits
    // for the globe to turn to its target, then runs IGNITE_SECONDS of frame time (dt, so a
    // hidden tab does not use it up). The ring is made on the first ignite and registered to be freed.
    let fx = null;
    let ring = null;
    const makeRing = () => {
      if (ring) return;
      const ringGeo = new THREE.SphereGeometry(0.992, 64, 48);
      cleanup.push(() => ringGeo.dispose());
      const uni = { uTint: { value: vec(colors.lit) }, uRingC: { value: vec([0, 0, 1]) }, uRingR: { value: 0 }, uRingA: { value: 0 } };
      const mat = new THREE.ShaderMaterial({
        vertexShader: RING_VS,
        fragmentShader: RING_FS,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: uni,
      });
      cleanup.push(() => mat.dispose());
      group.add(new THREE.Mesh(ringGeo, mat));
      ring = uni;
    };
    const settle = () => {
      shared.uFlare.value = 0;
      shared.uWaveA.value = 0;
      if (ring) ring.uRingA.value = 0;
    };
    cleanup.push(() => {
      fx = null;
    });

    let dragging = null;
    const draw = ({ dt, t, animate }) => {
      if (animate && !dragging) {
        if (goal) {
          const k = 1 - Math.exp(-SEEK * dt);
          rot.x += (goal.x - rot.x) * k;
          rot.y += (goal.y - rot.y) * k;
          if (Math.abs(goal.y - rot.y) < 0.002) goal = null;
        } else {
          rot.y += SPIN * dt;
        }
      }
      if (fx && animate) {
        if (!fx.running) {
          fx.wait += dt;
          fx.running = !goal || Math.abs(goal.y - rot.y) < TURN_CLOSE || fx.wait > TURN_WAIT;
        } else {
          fx.elapsed += dt;
        }
        const f = fx.running ? igniteFrame(fx.elapsed, fx) : null;
        if (f === null || f.done) settle();
        else {
          shared.uFlare.value = f.flare;
          shared.uWave.value = f.wave;
          shared.uWaveA.value = f.waveA;
          if (ring) {
            ring.uRingR.value = f.ringR;
            ring.uRingA.value = f.ringA;
          }
        }
        if (f?.done) fx = null;
      }
      if (sparks) {
        const live = animate && sources.length > 0 ? sparksAt(t, sources.length, sparkSeed) : [];
        if (live.length > 0 || sparks.live) {
          sparks.ages.fill(-1);
          live.forEach((sp, k) => {
            const at = sources[sp.dot] * 3;
            const n = [pos[at], pos[at + 1], pos[at + 2]];
            const [t1, t2] = tangentFrame(n);
            for (let j = 0; j < BURST.COUNT; j++) {
              const i = k * BURST.COUNT + j;
              const [a, b, c] = burstDir(sp.slot, sp.epoch, sparkSeed, j);
              const v = burstSpeed(sp.slot, sp.epoch, sparkSeed, j);
              for (let m = 0; m < 3; m++) {
                sparks.pos[i * 3 + m] = n[m];
                sparks.dirs[i * 3 + m] = (a * t1[m] + b * t2[m] + c * n[m]) * v;
              }
              sparks.ages[i] = sp.age;
            }
          });
          sparks.posAttr.needsUpdate = true;
          sparks.dirAttr.needsUpdate = true;
          sparks.ageAttr.needsUpdate = true;
          sparks.live = live.length > 0;
        }
      }
      shared.uTime.value = animate ? t : STATIC_T;
      group.rotation.set(rot.x, rot.y, 0);
      renderer.render(scene, camera);
    };
    const loop = createLoop({ win, doc, reduced, draw });
    cleanup.push(() => loop.dispose());

    const resize = () => {
      const w = host.clientWidth;
      const h = host.clientHeight || w;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      shared.uScale.value = Math.max(0.45, Math.min(1.2, h / BASE_HEIGHT));
      loop.redraw();
    };

    const onDown = (e) => {
      dragging = { x: e.clientX, y: e.clientY };
      goal = null;
      host.setPointerCapture?.(e.pointerId);
    };
    const onMove = (e) => {
      if (!dragging) return;
      rot.y += (e.clientX - dragging.x) * 0.006;
      rot.x = Math.max(-MAX_TILT, Math.min(MAX_TILT, rot.x + (e.clientY - dragging.y) * 0.004));
      dragging = { x: e.clientX, y: e.clientY };
      if (reduced) loop.redraw();
    };
    const onUp = () => {
      dragging = null;
    };
    const onLost = (e) => {
      e.preventDefault?.();
      onFail();
    };
    const listeners = [
      [host, 'pointerdown', onDown],
      [host, 'pointermove', onMove],
      [host, 'pointerup', onUp],
      [host, 'pointercancel', onUp],
      [canvas, 'webglcontextlost', onLost],
    ];
    for (const [el, type, fn] of listeners) {
      el.addEventListener(type, fn);
      cleanup.push(() => el.removeEventListener(type, fn));
    }

    if (typeof win.ResizeObserver === 'function') {
      const resizer = new win.ResizeObserver(resize);
      cleanup.push(() => resizer.disconnect());
      resizer.observe(host);
    } else {
      win.addEventListener('resize', resize);
      cleanup.push(() => win.removeEventListener('resize', resize));
    }
    if (typeof win.IntersectionObserver === 'function') {
      const watcher = new win.IntersectionObserver((entries) => loop.setOffscreen(!entries[entries.length - 1].isIntersecting));
      cleanup.push(() => watcher.disconnect());
      watcher.observe(host);
    }

    host.appendChild(canvas);
    resize();
    loop.redraw();

    let disposed = false;
    return {
      update(states, target) {
        if (disposed) return;
        setStates(states);
        aim(target);
        loop.redraw();
      },
      // Turn to the fresh country and play the ignite (view from igniteView, states the new dots).
      // Under reduced motion: face the target at once, no effect.
      ignite(view, states) {
        if (disposed) return;
        setStates(states);
        if (view?.target) turnTo(view.target, true);
        if (!reduced && view) {
          flareAttr.array.set(view.flare);
          flareAttr.needsUpdate = true;
          waveAttr.array.set(view.waveD);
          waveAttr.needsUpdate = true;
          try {
            makeRing();
          } catch {
            // no ring: the flare and wave still play
          }
          if (ring && view.ring) ring.uRingC.value.set(...view.ring);
          fx = { country: view.country, region: view.region, wait: 0, elapsed: 0, running: false };
        }
        loop.redraw();
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        release();
      },
    };
  }
}
