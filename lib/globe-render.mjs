// The hub globe in WebGL (three.js 0.180.0, vendored; docs/FOUNDATION.md §2.7). Land dots are
// THREE.Points: unlit dim grey, lit a warm glow with a soft additive halo, and the open
// incident's region a slow coral pulse, over a dark body with a faint rim. It turns slowly and
// can be dragged. Everything it shows comes from lib/globe-view.mjs; colours are the
// --color-globe-* tokens, read at mount. No top-level DOM access and three.js loads on mount,
// so this module imports cleanly under node --test. The canvas is sized by CSS (.globe-canvas)
// and setSize(w, h, false): no style attribute is ever written (CSP style-src 'self').
import { createLoop, DOT, MAX_TILT, readColors, spherePoint } from './globe-view.mjs';

const loadThree = () => import('../vendor/three-0.180.0/three.module.min.js');

const MAX_PIXEL_RATIO = 2;
const SPIN = 0.066; // auto-rotation, radians per second (a turn in about 95 s)
const SEEK = 2.5; // how fast the globe turns to its target on load (1/s, exponential)
const SEEK_FROM = 0.8; // it starts this far (radians) east of the target and turns to it
const DEFAULT_VIEW = { x: 0.42, y: -1.95 }; // no target: Europe and Africa
const BASE_HEIGHT = 560; // the stage height (CSS px) the dot sizes are tuned for
const STATIC_T = 0.6; // the pulse phase a reduced-motion frame shows

const DOT_VS = `
  attribute float aState; attribute float aSeed;
  uniform float uTime; uniform float uPR; uniform float uScale; uniform float uHalo; uniform float uSize;
  uniform vec3 uDim; uniform vec3 uLit; uniform vec3 uPulse;
  varying vec3 vColor; varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vec3 n = normalize((modelViewMatrix * vec4(position, 0.0)).xyz);
    float facing = smoothstep(-0.02, 0.32, n.z);
    float a; vec3 c; float sz = 1.0;
    if (aState < 0.5) { c = uDim; a = uHalo > 0.5 ? 0.0 : 0.75; sz = 0.85; }
    else if (aState < 1.5) { c = uLit; float f = 0.86 + 0.14 * sin(uTime * 1.1 + aSeed * 6.283); a = (uHalo > 0.5 ? 0.075 : 1.0) * f; }
    else { float p = 0.5 + 0.5 * sin(uTime * 1.5 - aSeed * 1.2); c = uPulse; a = uHalo > 0.5 ? 0.11 * p : 0.30 + 0.70 * p; sz = 0.95 + 0.15 * p; }
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
const BODY_FS = `uniform vec3 uColor; void main() { gl_FragColor = vec4(uColor, 1.0); }`;
const BODY_VS = `void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
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
    const shared = {
      uTime: { value: STATIC_T },
      uPR: { value: renderer.getPixelRatio() },
      uScale: { value: 1 },
      uDim: { value: vec(colors.dim) },
      uLit: { value: vec(colors.lit) },
      uPulse: { value: vec(colors.pulse) },
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
    // Turn to `target` when it names a different act than last time (an update keeps the view).
    const aim = (target) => {
      if (target == null || target.actId === aimedAct) return;
      aimedAct = target.actId;
      goal = { x: target.x, y: target.y };
      rot = reduced ? { ...goal } : { x: goal.x, y: goal.y - SEEK_FROM };
      if (reduced) goal = null;
    };
    const setStates = (states) => {
      for (let k = 0; k < count; k++) state[k] = states[k] ?? DOT.UNLIT;
      stateAttr.needsUpdate = true;
    };
    setStates(opts.states);
    aim(opts.target);

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
      dispose() {
        if (disposed) return;
        disposed = true;
        release();
      },
    };
  }
}
