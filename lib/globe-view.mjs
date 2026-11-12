// The globe view, pure (docs/FOUNDATION.md §2.7): what each dot shows, where the globe turns
// on load, the hub's text for it, the colours read from styles/tokens.css and the animation
// loop. No three.js and no top-level DOM access: lib/globe-render.mjs draws with these, and
// tests drive them with fakes.
import { actOfCountry } from '../hub/globe-map.mjs';
import { nextUp } from './unlock.mjs';

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
 * The act the globe turns to: the act `nextUp` names (an open incident in any act first, else
 * the first incomplete act); when every act is complete, the last one. null for a registry
 * without acts. Continue, Next up and this target are one answer (docs/FOUNDATION.md §2.7).
 */
export function currentActId(registry, progress) {
  const { acts } = registry;
  if (acts.length === 0) return null;
  return nextUp(registry, progress)?.actId ?? acts[acts.length - 1].id;
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
 * (Northern Europe): 2 of 4 done", plus ", incident open" while its boss is open or ", saved" once the act is complete. Coming-soon
 * acts are merged in by act number: "Act 7, Alerting and SLOs (East Asia): coming soon".
 */
export function globeLines(registry, state) {
  const lines = registry.acts.filter((a) => state.regions[a.id]).map((a) => {
    const r = state.regions[a.id];
    const name = a.name ? `, ${a.name}` : '';
    return {
      no: a.no,
      text: `Act ${a.no}${name} (${r.region}): ${r.done} of ${r.total} done${r.pulse ? ', incident open' : ''}${r.resolved ? ', saved' : ''}`,
    };
  });
  for (const s of Object.values(state.soon ?? {})) {
    const name = s.name ? `, ${s.name}` : '';
    lines.push({ no: s.no, text: `Act ${s.no}${name} (${s.region}): coming soon` });
  }
  return lines.sort((a, b) => a.no - b.no).map((l) => l.text);
}

/** The globe's accessible name: levels done overall, the regions saved, the regions lit (saved ones left out), any open incident, what is coming soon. */
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
    (resolved.length ? `. Saved: ${resolved.join(', ')}` : '') +
    (lit.length ? `. Lit: ${lit.join(', ')}` : '') +
    (open.length ? `. Incident open in ${open.join(', ')}` : '') +
    (soon.length ? `. Coming soon: ${soon.join(', ')}` : '') +
    '.'
  );
}

/**
 * The one-line story under the globe, from the state alone: { phase, actId, region, done, total,
 * text } or null when no act has a region. The first match wins, walking the acts in order:
 * incident (a region pulses; the lowest act), allSaved (every region resolved), dark (nothing
 * done yet), saved (the current act is untouched and the one before it is resolved; names that
 * one as calm and the current act's region as next, the region the globe turns to), building (the current act, with its levels-and-boss count). Every live text is at most 60 characters.
 */
export function globeCaption(registry, state) {
  const mapped = registry.acts.filter((a) => state.regions[a.id]);
  if (mapped.length === 0) return null;
  const out = (phase, act, text) => {
    const r = act ? state.regions[act.id] : null;
    return { phase, actId: act ? act.id : null, region: r ? r.region : null, done: r ? r.done : 0, total: r ? r.total : 0, text };
  };
  const hot = mapped.find((a) => state.regions[a.id].pulse);
  if (hot) return out('incident', hot, `Alert! ${state.regions[hot.id].region} is down. Tend to it now.`);
  if (mapped.every((a) => state.regions[a.id].resolved)) {
    const regions = mapped.map((a) => state.regions[a.id]);
    const more = Object.keys(state.soon ?? {}).length > 0;
    return {
      phase: 'allSaved', actId: null, region: null,
      done: regions.reduce((s, r) => s + r.done, 0), total: regions.reduce((s, r) => s + r.total, 0),
      text: more ? 'You saved the day. More regions are coming soon.' : 'Every region is calm. You saved the day.',
    };
  }
  const i = mapped.findIndex((a) => !state.regions[a.id].resolved);
  const cur = mapped[i];
  const prev = mapped[i - 1];
  const r = state.regions[cur.id];
  if (r.done === 0 && prev) return out('saved', prev, `${state.regions[prev.id].region} is calm. Next: ${r.region}.`);
  if (r.done === 0) return out('dark', cur, 'The planet is dark. Shine the o11y light on your world.');
  return out('building', cur, `You're building! ${r.region}: ${r.done} of ${r.total} done.`);
}

const LEGEND = [
  ['incident', 'Production down'],
  ['resolved', 'Saved, all calm'],
  ['lit', 'Instrumented'],
  ['dark', 'Still dark'],
  ['soon', 'Coming soon'],
];

/**
 * The map key for what is drawn now: [{ key, text }] in a fixed order, one per kind of dot in
 * `states` (as from dotStates over `dots`). "Still dark" is an unlit dot that belongs to an act.
 */
export function globeLegend(states, dots, actOf = actOfCountry) {
  const seen = new Set();
  for (let k = 0; k < states.length; k++) {
    const s = states[k];
    if (s === DOT.PULSE) seen.add('incident');
    else if (s === DOT.RESOLVED) seen.add('resolved');
    else if (s === DOT.LIT) seen.add('lit');
    else if (s === DOT.SOON) seen.add('soon');
    else if (s === DOT.UNLIT && actOf(dots[k][2], dots[k][3]) !== null) seen.add('dark');
  }
  return LEGEND.filter(([key]) => seen.has(key)).map(([key, text]) => ({ key, text }));
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
