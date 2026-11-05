// The ignite effect, pure (docs/FOUNDATION.md §2.7, #161): what a completion freshly lit, the
// words for it, what the renderer is told to play and the effect's timeline. No three.js and no
// DOM: lib/globe-render.mjs only plays what is decided here.
import { ACT_REGIONS, actOfCountry, COUNTRY_NAMES, LEVEL_COUNTRY } from '../hub/globe-map.mjs';
import { facingRotation, spherePoint } from './globe-view.mjs';
import { endSentence } from './text.mjs';
import { isActComplete, isCompleted } from './unlock.mjs';

/** The whole effect, in seconds. */
export const IGNITE_SECONDS = 1.5;

const RING_MAX = 0.6; // the ring's final angular radius on the sphere (radians)
const FLARE_PEAK = 0.15; // the share of the effect at which the flare peaks

/**
 * What the step from `prev` to `next` progress lit: { countryIds, regionIds } (sorted; regionIds
 * are act ids). A level lights its country the first time it is completed, never on a replay.
 * An act's region is marked when its boss is newly completed or the act becomes complete.
 * Ids the map lacks are left out. `map` is injectable for tests.
 */
export function freshlyLit(prev, next, registry, map = { ACT_REGIONS, LEVEL_COUNTRY }) {
  const countries = new Set();
  const regions = new Set();
  for (const act of registry.acts) {
    if (!Object.hasOwn(map.ACT_REGIONS, act.id)) continue;
    for (const id of act.levelIds) {
      if (isCompleted(prev, id) || !isCompleted(next, id)) continue;
      if (Object.hasOwn(map.LEVEL_COUNTRY, id)) countries.add(map.LEVEL_COUNTRY[id]);
    }
    const bossNew = act.bossId != null && !isCompleted(prev, act.bossId) && isCompleted(next, act.bossId);
    if (bossNew || (!isActComplete(act, prev) && isActComplete(act, next))) regions.add(act.id);
  }
  return { countryIds: [...countries].sort(), regionIds: [...regions].sort() };
}

/**
 * The announcement for `level` finishing with `fresh`: "Germany is now lit: The signals." (a
 * country without a known name shows its code), plus " <Region> is complete." when the act is done.
 * A boss, which has no country, names its region. '' when nothing is fresh.
 */
export function litText(fresh, level, map = { ACT_REGIONS, LEVEL_COUNTRY, COUNTRY_NAMES }) {
  const names = map.COUNTRY_NAMES ?? {};
  const region = (id) => map.ACT_REGIONS[id]?.region ?? id;
  const title = level?.name ?? 'Level complete';
  if (fresh.countryIds.length > 0) {
    const iso = fresh.countryIds[0];
    const done = fresh.regionIds.length > 0 ? ` ${region(fresh.regionIds[0])} is complete.` : '';
    return `${names[iso] ?? iso} is now lit: ${endSentence(title)}${done}`;
  }
  if (fresh.regionIds.length > 0) return `${region(fresh.regionIds[0])} is now lit: ${endSentence(title)}`;
  return '';
}

/** The unit vector and [lat, lon] of the centroid of the dots `pick` selects, or null if none. */
function centroid(dots, pick) {
  let x = 0;
  let y = 0;
  let z = 0;
  let n = 0;
  for (const dot of dots) {
    if (!pick(dot)) continue;
    const [px, py, pz] = spherePoint(dot[0], dot[1]);
    x += px;
    y += py;
    z += pz;
    n++;
  }
  const len = Math.hypot(x, y, z);
  if (n === 0 || len === 0) return null;
  const unit = [x / len, y / len, z / len];
  return { unit, lat: (Math.asin(unit[1]) * 180) / Math.PI, lon: (Math.atan2(-unit[2], unit[0]) * 180) / Math.PI };
}

/**
 * What the renderer plays for `fresh`: { flare (Uint8Array, 1 on the fresh country's dots),
 * waveD (Float32Array, a region dot's distance from its region centre as 0..1, -1 elsewhere),
 * ring (unit vector the ripple starts from, or null), country, region (booleans), target
 * ({key, x, y} rotation facing the country centroid, else the region centre) }, or null when
 * there is nothing to play. `actOf` maps (iso3, subregion) to an act id.
 */
export function igniteView(fresh, dots, actOf = actOfCountry) {
  const flare = new Uint8Array(dots.length);
  const waveD = new Float32Array(dots.length).fill(-1);
  const countries = fresh.countryIds.filter((iso) => dots.some((d) => d[2] === iso));
  const regions = fresh.regionIds.filter((id) => dots.some((d) => actOf(d[2], d[3]) === id));
  if (countries.length === 0 && regions.length === 0) return null;
  const isCountry = new Set(countries);
  dots.forEach((d, k) => {
    if (isCountry.has(d[2])) flare[k] = 1;
  });
  for (const id of regions) {
    const inRegion = (d) => actOf(d[2], d[3]) === id;
    const c = centroid(dots, inRegion);
    if (c === null) continue;
    const dist = (d) => {
      const [px, py, pz] = spherePoint(d[0], d[1]);
      return Math.acos(Math.max(-1, Math.min(1, px * c.unit[0] + py * c.unit[1] + pz * c.unit[2])));
    };
    const far = Math.max(1e-6, ...dots.filter(inRegion).map(dist));
    dots.forEach((d, k) => {
      if (inRegion(d)) waveD[k] = dist(d) / far;
    });
  }
  let target = null;
  let ring = null;
  if (countries.length > 0) {
    const c = centroid(dots, (d) => d[2] === countries[0]);
    ring = c.unit;
    target = { key: `country:${countries[0]}`, ...facingRotation(c.lat, c.lon) };
  } else {
    const c = centroid(dots, (d) => actOf(d[2], d[3]) === regions[0]);
    target = { key: `region:${regions[0]}`, ...facingRotation(c.lat, c.lon) };
  }
  return { flare, waveD, ring, country: countries.length > 0, region: regions.length > 0, target };
}

/**
 * The effect `elapsed` seconds in, for the shader uniforms: { done, flare (0..1 brightness
 * above lit; 0 settles to the plain lit glow), ringR (radians), ringA (0..1), wave (position,
 * -0.25..1.25 along a region's 0..1 distance), waveA (0..1) }. Ring and flare need a country,
 * the wave a region.
 */
export function igniteFrame(elapsed, { country, region }) {
  const p = Math.max(0, Math.min(1, elapsed / IGNITE_SECONDS));
  const done = elapsed >= IGNITE_SECONDS;
  const fade = (1 - p) * (1 - p);
  let flare = 0;
  if (country && !done) flare = p < FLARE_PEAK ? p / FLARE_PEAK : ((1 - p) / (1 - FLARE_PEAK)) ** 2;
  const ease = 1 - (1 - p) ** 3;
  return {
    done,
    flare,
    ringR: ease * RING_MAX,
    ringA: country && !done ? fade : 0,
    wave: -0.25 + 1.5 * p,
    waveA: region && !done ? 0.55 * Math.sin(Math.PI * p) : 0,
  };
}
