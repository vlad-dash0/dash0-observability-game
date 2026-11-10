// Incident sparks on the hub globe (#309): the schedule, pure and without three.js. Each of
// SLOTS slots tries once per PERIOD seconds (offset so the slots are spread out) and fires with
// probability CHANCE; a spark lives LIFE seconds from a hashed birth time inside its period, on a
// hashed pulsing dot. Everything is a function of the time, so a hidden tab leaves no backlog.
import { DOT } from './globe-view.mjs';

export const SPARK = Object.freeze({ SLOTS: 6, PERIOD: 4, LIFE: 1.4, CHANCE: 0.5 });
// Each spark is a burst of COUNT particles from its dot: a direction inside a cone of CONE radians
// around the outward normal, travelling up to TRAVEL (globe radii) times a per-particle speed.
export const BURST = Object.freeze({ COUNT: 7, CONE: 1.0, TRAVEL: 0.22 });

/** Uint32Array of the indices of the PULSE dots in `states`. */
export function sparkSources(states) {
  const out = [];
  for (let k = 0; k < states.length; k++) if (states[k] === DOT.PULSE) out.push(k);
  return Uint32Array.from(out);
}

/** A hash of four integers in [0, 1). */
function hash(a, b, c, k) {
  let h = Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca6b) ^ Math.imul(c | 0, 0xc2b2ae35) ^ Math.imul(k, 0x27d4eb2f);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** The live sparks at time `t` (s) over `n` source dots: [{slot, epoch, dot (0..n-1), age (0..1)}] by slot. */
export function sparksAt(t, n, seed = 0, cfg = SPARK) {
  const out = [];
  if (n <= 0) return out;
  for (let i = 0; i < cfg.SLOTS; i++) {
    const off = (i * cfg.PERIOD) / cfg.SLOTS;
    const e = Math.floor((t - off) / cfg.PERIOD);
    if (hash(i, e, seed, 1) >= cfg.CHANCE) continue;
    const born = e * cfg.PERIOD + off + hash(i, e, seed, 2) * (cfg.PERIOD - cfg.LIFE);
    if (t < born || t >= born + cfg.LIFE) continue;
    out.push({ slot: i, epoch: e, dot: Math.floor(hash(i, e, seed, 3) * n), age: (t - born) / cfg.LIFE });
  }
  return out;
}

/**
 * The direction of particle `j` of the burst (slot, epoch, seed) as a unit vector [a, b, c] in the
 * frame of its dot: a and b along the two tangents, c along the outward normal. Particles are
 * spread round the normal in COUNT sectors, each jittered, at a hashed angle inside the cone.
 */
export function burstDir(slot, epoch, seed, j, cfg = BURST) {
  const key = slot * 64 + j;
  const phi = (2 * Math.PI * (j + 0.6 * hash(key, epoch, seed, 4))) / cfg.COUNT;
  const cone = cfg.CONE * (0.35 + 0.65 * hash(key, epoch, seed, 5));
  return [Math.sin(cone) * Math.cos(phi), Math.sin(cone) * Math.sin(phi), Math.cos(cone)];
}

/** The speed factor (0.7 to 1) of particle `j` of the burst. */
export function burstSpeed(slot, epoch, seed, j) {
  return 0.7 + 0.3 * hash(slot * 64 + j, epoch, seed, 6);
}

/** Two unit tangents [t1, t2] at the unit vector `n`, with t1 x t2 = n. */
export function tangentFrame(n) {
  const ref = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  let t1 = [ref[1] * n[2] - ref[2] * n[1], ref[2] * n[0] - ref[0] * n[2], ref[0] * n[1] - ref[1] * n[0]];
  const len = Math.hypot(...t1);
  t1 = t1.map((v) => v / len);
  const t2 = [n[1] * t1[2] - n[2] * t1[1], n[2] * t1[0] - n[0] * t1[2], n[0] * t1[1] - n[1] * t1[0]];
  return [t1, t2];
}
