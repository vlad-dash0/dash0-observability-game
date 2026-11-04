// The success swirl in WebGL (three.js 0.180.0, vendored, the same copy as the globe;
// #146, folds in #151). Plays once, a few seconds, then settles: the canvas and its WebGL
// context are released and the settled frame stays as the static SVG ring from
// lib/swirl.mjs. Reduced motion or no WebGL: the static ring at once, three.js never loads.
// No top-level DOM access and three.js loads on demand, so this module imports cleanly under
// node --test. The canvas is sized by CSS and setSize(w, h, false): no style attribute.
import { parseColor } from './globe-view.mjs';
import { SWIRL_DOTS, SWIRL_MS, SWIRL_TILT, dotAt, staticSwirlSvg, swirlLayout, swirlMode } from './swirl.mjs';

const loadThree = () => import('../vendor/three-0.180.0/three.module.min.js');
const FALLBACK_DOT = [1, 0.76, 0.4];

const VS = `attribute float aR; uniform float uPR; uniform float uFade; varying float vA;
  void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vA = smoothstep(0.05, 0.85, aR) * uFade;
    gl_PointSize = (1.4 + 5.2 * aR * aR) * uPR * (3.4 / -mv.z); gl_Position = projectionMatrix * mv; }`;
const FS = `uniform vec3 uColor; varying float vA;
  void main() { float d = length(gl_PointCoord - 0.5) * 2.0; if (d > 1.0) discard;
    gl_FragColor = vec4(uColor * vA * smoothstep(1.0, 0.35, d), 1.0); }`;

/**
 * Play the swirl in `host` (a `[data-swirl]` element). opts: { reduced, signal (an
 * AbortSignal: stop and release), importThree?, now? (ms clock, for tests) }. Resolves to
 * 'static' (the ring was drawn without WebGL), 'played' (it ran and settled to the ring) or
 * 'stopped' (aborted part way; everything released).
 */
export async function playSwirl(host, { reduced = false, signal, importThree = loadThree, now } = {}) {
  const doc = host.ownerDocument;
  const win = doc?.defaultView;
  const settle = () => {
    host.innerHTML = staticSwirlSvg();
  };
  const webgl = typeof win?.WebGL2RenderingContext === 'function';
  if (swirlMode({ reduced, webgl }) === 'static' || signal?.aborted) {
    settle();
    return 'static';
  }
  let THREE;
  try {
    THREE = await importThree();
  } catch {
    settle();
    return 'static';
  }
  const canvas = doc.createElement('canvas');
  canvas.className = 'help-swirl-canvas';
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  } catch {
    settle();
    return 'static';
  }
  const cleanup = [
    () => canvas.remove(),
    () => {
      renderer.dispose();
      renderer.forceContextLoss();
    },
  ];
  const release = () => {
    while (cleanup.length) {
      try {
        cleanup.pop()();
      } catch {
        // keep releasing the rest
      }
    }
  };
  let color = FALLBACK_DOT;
  try {
    color = parseColor(win.getComputedStyle(host).color) ?? FALLBACK_DOT;
  } catch {
    // the fallback amber
  }
  const clock = now ?? (() => (win.performance ?? globalThis.performance).now());

  let geo;
  let mat;
  let scene;
  let camera;
  const n = SWIRL_DOTS;
  const pos = new Float32Array(n * 3);
  const radius = new Float32Array(n);
  for (let i = 0; i < n; i++) radius[i] = dotAt(i, n)[0];
  const uniforms = { uPR: { value: 1 }, uFade: { value: 0 }, uColor: { value: color } };
  try {
    renderer.setPixelRatio(Math.min(win.devicePixelRatio || 1, 2));
    renderer.setClearColor(0, 0);
    uniforms.uPR.value = renderer.getPixelRatio();
    geo = new THREE.BufferGeometry();
    cleanup.push(() => geo.dispose());
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aR', new THREE.BufferAttribute(radius, 1));
    mat = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    cleanup.push(() => mat.dispose());
    const dots = new THREE.Points(geo, mat);
    dots.rotation.x = SWIRL_TILT;
    scene = new THREE.Scene();
    scene.add(dots);
    camera = new THREE.PerspectiveCamera(35, 1, 0.1, 50);
    camera.position.set(0, 0, 3.4);
    host.innerHTML = '';
    host.appendChild(canvas);
    const w = host.clientWidth || 220;
    renderer.setSize(w, w, false);
  } catch {
    release();
    settle();
    return 'static';
  }

  return new Promise((resolve) => {
    const t0 = clock();
    let over = false;
    const finish = (outcome) => {
      if (over) return;
      over = true;
      renderer.setAnimationLoop(null);
      release();
      if (outcome === 'played') settle();
      resolve(outcome);
    };
    signal?.addEventListener?.('abort', () => finish('stopped'), { once: true });
    renderer.setAnimationLoop(() => {
      const p = Math.min(1, (clock() - t0) / SWIRL_MS);
      swirlLayout(p, n, pos);
      geo.attributes.position.needsUpdate = true;
      uniforms.uFade.value = Math.min(1, 0.15 + p * 1.6);
      renderer.render(scene, camera);
      if (p >= 1) finish('played');
    });
  });
}
