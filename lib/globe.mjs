// Globe state, pure (docs/FOUNDATION.md §2.7). Same rules as the old system map's nodeStates:
// a country is lit when its level is completed; it and its region pulse while the act's boss
// is open (the current incident), and a region is resolved once its act is complete. Bosses carry no country; a boss pulses its act's region.
import { ACT_REGIONS, LEVEL_COUNTRY } from '../hub/globe-map.mjs';
import { isActComplete, isCompleted, levelState } from './unlock.mjs';

/**
 * → { countries: { [iso3]: {lit} }, regions: { [actId]: {region, done, total, pulse, resolved} },
 * soon: { [actId]: {region, no, name} } }
 * (null-prototype objects) for the §2.4 registry and the §2.5 progress view. `done` and
 * `total` count the act's levels and its boss; progress ids the registry lacks are ignored.
 * Acts without a region and levels without a country are left out (test/globe-data.test.mjs
 * keeps the live registry fully mapped). `soon` is the coming-soon acts (hub/coming-soon.mjs):
 * those with a region get a `soon` entry and are never in `regions`, so they count for nothing.
 * `map` is injectable for tests.
 */
export function globeState(registry, progress, map = { ACT_REGIONS, LEVEL_COUNTRY }, soon = []) {
  const countries = Object.create(null);
  const regions = Object.create(null);
  const soonOut = Object.create(null);
  for (const act of registry.acts) {
    if (!Object.hasOwn(map.ACT_REGIONS, act.id)) continue;
    const ids = act.bossId == null ? act.levelIds : [...act.levelIds, act.bossId];
    const pulse = act.bossId != null && levelState(act.bossId, progress, registry) === 'open';
    regions[act.id] = {
      region: map.ACT_REGIONS[act.id].region,
      done: ids.filter((id) => isCompleted(progress, id)).length,
      total: ids.length,
      pulse,
      resolved: isActComplete(act, progress),
    };
    for (const id of act.levelIds) {
      if (!Object.hasOwn(map.LEVEL_COUNTRY, id)) continue;
      countries[map.LEVEL_COUNTRY[id]] = { lit: isCompleted(progress, id) };
    }
  }
  for (const s of soon) {
    if (!Object.hasOwn(map.ACT_REGIONS, s.id)) continue;
    soonOut[s.id] = { region: map.ACT_REGIONS[s.id].region, no: s.no, name: s.name };
  }
  return { countries, regions, soon: soonOut };
}
