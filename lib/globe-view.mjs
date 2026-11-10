// The globe view, pure (docs/FOUNDATION.md §2.7): what each dot shows, where the globe turns
// on load, the hub's text for it, the colours read from styles/tokens.css and the animation
// loop. No three.js and no top-level DOM access: lib/globe-render.mjs draws with these, and
// tests drive them with fakes.
import { actOfCountry } from '../hub/globe-map.mjs';
import { isActComplete } from './unlock.mjs';

/** Per-dot draw state, as stored in the renderer's `aState` attribute. */
export const DOT = Object.freeze({ UNLIT: 0, LIT: 1, PULSE: 2, SOON: 3, RESOLVED: 4 });

// The globe never tilts further than this from the equator (radians), dragged or aimed.
export const MAX_TILT = 1.1;

const RAD = Math.PI / 180;

/** Unit-sphere position of [lat, lon] degrees: +y is north, lon 0 faces +x, lon 90E faces -z. */
export function spherePoint(lat, lon) {
  const la = lat * RAD;
  const lo = lon * RAD;
  return [Math.cos(la) * Math.cos(lo), Math.sin(la), -Math.cos(la) * Math.sin(lo)];
}

/**
 * Uint8Array of DOT values, one per dot of `dots` ([[lat, lon, iso3, subregion], ...], as in
 * hub/globe-data.mjs) for `state` from globeState. A dot pulses while its region's boss is open
 * (the whole region, countries without a level included). Then a coming-soon region's dots are
 * SOON (never lit: it has no levels), a resolved region's (its act complete) are RESOLVED, the
 * whole region again, and any other dot is lit when its country's level is completed.
 */
export function dotStates(state, dots, actOf = actOfCountry) {
  const out = new Uint8Array(dots.length);
  for (let k = 0; k < dots.length; k++) {
    const [, , iso, sub] = dots[k];
    const act = actOf(iso, sub);
    if (act !== null && state.regions[act]?.pulse) out[k] = DOT.PULSE;
    else if (act !== null && state.soon?.[act]) out[k] = DOT.SOON;
    else if (act !== null && state.regions[act]?.resolved) out[k] = DOT.RESOLVED;
    else if (state.countries[iso]?.lit) out[k] = DOT.LIT;
  }
  return out;
}

/**
 * The act the globe turns to: the lowest-numbered act that is unlocked and not complete; when
 * every act is complete, the last one. null for a registry without acts. The first incomplete
 * act is that act: every earlier one is complete, so the unlock chain always opens it.
 */
export function currentActId(registry, progress) {
  const { acts } = registry;
  if (acts.length === 0) return null;
  for (let i = 0; i < acts.length; i++) {
    if (!isActComplete(acts[i], progress)) return acts[i].id;
  }
  return acts[acts.length - 1].id;
}

/** [lat, lon] degrees of the centre of an act's region (mean of its dots), or null if it has none. */
export function regionCentre(dots, actId, actOf = actOfCountry) {
  let x = 0;
  let y = 0;
  let z = 0;
  let n = 0;
  for (const [lat, lon, iso, sub] of dots) {
    if (actOf(iso, sub) !== actId) continue;
    const [px, py, pz] = spherePoint(lat, lon);
    x += px;
    y += py;
    z += pz;
    n++;
  }
  const len = Math.hypot(x, y, z);
  if (n === 0 || len === 0) return null;
  return [Math.asin(y / len) / RAD, Math.atan2(-z, x) / RAD];
}

/**
 * Globe rotation (radians, three.js Euler order XYZ) that puts [lat, lon] in front of a camera
 * on the +z axis. The tilt is capped at MAX_TILT.
 */
export function facingRotation(lat, lon) {
  const x = Math.max(-MAX_TILT, Math.min(MAX_TILT, lat * RAD));
  return { x, y: -Math.PI / 2 - lon * RAD };
}

/** Rotation that faces the current act's region, or null (no acts, or a region without dots). */
export function globeTarget(registry, progress, dots, actOf = actOfCountry) {
  const actId = currentActId(registry, progress);
  const centre = actId === null ? null : regionCentre(dots, actId, actOf);
  return centre === null ? null : { actId, ...facingRotation(centre[0], centre[1]) };
}

/**
 * The text alternative's lines, one per act on the globe: "Act 1, Resources and identity
 * (Northern Europe): 2 of 4 done", plus ", incident open" while its boss is open or ", resolved" once the act is complete. Coming-soon
 * acts are merged in by act number: "Act 7, Alerting and SLOs (East Asia): coming soon".
 */
export function globeLines(registry, state) {
  const lines = registry.acts.filter((a) => state.regions[a.id]).map((a) => {
    const r = state.regions[a.id];
    const name = a.name ? `, ${a.name}` : '';
    return {
      no: a.no,
      text: `Act ${a.no}${name} (${r.region}): ${r.done} of ${r.total} done${r.pulse ? ', incident open' : ''}${r.resolved ? ', resolved' : ''}`,
    };
  });
  for (const s of Object.values(state.soon ?? {})) {
    const name = s.name ? `, ${s.name}` : '';
    lines.push({ no: s.no, text: `Act ${s.no}${name} (${s.region}): coming soon` });
  }
  return lines.sort((a, b) => a.no - b.no).map((l) => l.text);
}

/** The globe's accessible name: levels done overall, the regions resolved, the regions lit (resolved ones left out), any open incident, what is coming soon. */
export function globeLabel(state) {
  const regions = Object.values(state.regions);
  const done = regions.reduce((s, r) => s + r.done, 0);
  const total = regions.reduce((s, r) => s + r.total, 0);
  const resolved = regions.filter((r) => r.resolved).map((r) => r.region);
  const lit = regions.filter((r) => r.done > 0 && !r.resolved).map((r) => `${r.region} ${r.done} of ${r.total}`);
  const open = regions.filter((r) => r.pulse).map((r) => r.region);
  const soon = Object.values(state.soon ?? {})
    .sort((a, b) => a.no - b.no)
    .map((s) => s.region);
  return (
    `World map: ${done} of ${total} levels done` +
    (resolved.length ? `. Resolved: ${resolved.join(', ')}` : '') +
    (lit.length ? `. Lit: ${lit.join(', ')}` : '') +
    (open.length ? `. Incident open in ${open.join(', ')}` : '') +
    (soon.length ? `. Coming soon: ${soon.join(', ')}` : '') +
    '.'
  );
}

// The colour roles the renderer draws with; each is read from a `.globe-probe.<role>` element
// whose CSS colour is the matching --color-globe-* token (styles/hub.css).
export const COLOR_ROLES = Object.freeze(['sky', 'body', 'dim', 'lit', 'pulse', 'rim', 'resolved']);

/**
 * A computed CSS colour as [r, g, b] in 0..1, or null. Takes what browsers return for
 * getComputedStyle().color: rgb()/rgba() with commas or spaces, and color(srgb r g b).
 */
export function parseColor(text) {
  const s = String(text ?? '').trim().toLowerCase();
  let m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*[\d.]+%?\s*)?\)$/.exec(s);
  if (m) return finite([m[1], m[2], m[3]].map((v) => Number(v) / 255));
  m = /^color\(\s*srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*[\d.]+%?\s*)?\)$/.exec(s);
  if (m) return finite([m[1], m[2], m[3]].map(Number));
  return null;
}
const finite = (rgb) => (rgb.every((v) => Number.isFinite(v) && v >= 0 && v <= 1) ? rgb : null);

/** { role: [r, g, b] } for COLOR_ROLES via `probe(role)` (a CSS colour string), or null if any fails. */
export function readColors(probe) {
  const out = {};
  for (const role of COLOR_ROLES) {
    const rgb = parseColor(probe(role));
    if (rgb === null) return null;
    out[role] = rgb;
  }
  return out;
}

/**
 * The render loop, with injected `win` (requestAnimationFrame, cancelAnimationFrame) and `doc`
 * (hidden, visibilitychange). draw({dt, t, animate}) runs once per frame while the page is
 * visible and the globe on screen. Under reduced motion it never loops: each redraw() draws one
 * static frame (animate false). dispose() stops it for good.
 */
export function createLoop({ win, doc, reduced, draw }) {
  let raf = null;
  let last = null;
  let offscreen = false;
  let disposed = false;
  const active = () => !disposed && !doc.hidden && !offscreen;
  const stop = () => {
    if (raf !== null) win.cancelAnimationFrame(raf);
    raf = null;
    last = null;
  };
  const schedule = () => {
    if (raf === null && active()) raf = win.requestAnimationFrame(tick);
  };
  function tick(ms) {
    raf = null;
    if (!active()) return;
    const dt = last === null ? 0 : Math.min((ms - last) / 1000, 0.05);
    last = ms;
    draw({ dt, t: ms / 1000, animate: !reduced });
    if (!reduced) schedule();
  }
  const onVisibility = () => (doc.hidden ? stop() : schedule());
  doc.addEventListener('visibilitychange', onVisibility);
  return {
    redraw: schedule,
    setOffscreen(value) {
      offscreen = !!value;
      if (offscreen) stop();
      else schedule();
    },
    get scheduled() {
      return raf !== null;
    },
    dispose() {
      disposed = true;
      stop();
      doc.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
