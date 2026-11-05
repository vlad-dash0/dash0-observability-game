// The success swirl (#146, folds in #151), pure: where each dot sits as the swirl plays,
// whether it plays at all, and the settled frame as a static SVG ring. No three.js and no
// DOM access: lib/swirl-render.mjs draws the moving version with these. Dots follow a
// sunflower spiral; while playing they spin in from a wider, tilted cloud and settle flat.

export const SWIRL_DOTS = 640;
export const SWIRL_MS = 2600;
export const SWIRL_TILT = -0.5; // radians about x, as the camera sees the settled disc
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const CAMERA_Z = 3.4;
const FOCAL = 1 / Math.tan((35 / 2) * (Math.PI / 180)); // a 35 degree field of view

/** 'play' only when motion is allowed and WebGL exists; otherwise the static frame. */
export function swirlMode({ reduced, webgl }) {
  return !reduced && webgl ? 'play' : 'static';
}

/** Radius (0..1) and angle of dot `i` of `n` on the settled spiral. */
export const dotAt = (i, n) => [Math.sqrt((i + 0.5) / n), i * GOLDEN];

const ease = (x) => 1 - (1 - x) ** 3;

/**
 * Positions (x, y, z per dot) at progress `p` (0..1): spun out and spread at 0, a flat disc
 * of radius 1 at 1. Writes into `out` when given (the renderer reuses one buffer).
 */
export function swirlLayout(p, n = SWIRL_DOTS, out = new Float32Array(n * 3)) {
  const e = ease(Math.min(1, Math.max(0, p)));
  const spin = (1 - e) * Math.PI * 2;
  const spread = 1 + (1 - e) * 0.55;
  for (let i = 0; i < n; i++) {
    const [r, a0] = dotAt(i, n);
    const a = a0 + spin * (0.6 + 0.4 * r);
    out[i * 3] = Math.cos(a) * r * spread;
    out[i * 3 + 1] = Math.sin(a) * r * spread;
    out[i * 3 + 2] = (1 - e) * (r - 0.5) * 0.6;
  }
  return out;
}

const fixed = (v) => String(Math.round(v * 1000) / 1000);

/**
 * The settled frame as an SVG (viewBox -1..1, the camera's projection of the tilted disc):
 * one circle per dot, size and opacity growing outward as in the shader. Decorative:
 * aria-hidden, unfocusable, no text, attributes only (CSP). Fill comes from CSS.
 */
export function staticSwirlSvg(n = SWIRL_DOTS) {
  const pos = swirlLayout(1, n);
  const cos = Math.cos(SWIRL_TILT);
  const sin = Math.sin(SWIRL_TILT);
  const dots = [];
  for (let i = 0; i < n; i++) {
    const [r] = dotAt(i, n);
    const x = pos[i * 3];
    const y = pos[i * 3 + 1] * cos;
    const z = pos[i * 3 + 1] * sin;
    const d = CAMERA_Z - z;
    const size = (1.4 + 5.2 * r * r) * (CAMERA_Z / d) / 220; // radius in viewBox units for a 220px canvas
    const t = Math.min(1, Math.max(0, (r - 0.05) / 0.8));
    const alpha = t * t * (3 - 2 * t);
    dots.push(`<circle cx="${fixed((FOCAL * x) / d)}" cy="${fixed(-(FOCAL * y) / d)}" r="${fixed(size)}" opacity="${fixed(alpha)}"></circle>`);
  }
  return `<svg class="help-swirl-ring" viewBox="-1 -1 2 2" aria-hidden="true" focusable="false">${dots.join('')}</svg>`;
}
