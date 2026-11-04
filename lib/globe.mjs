// Globe state, pure (docs/FOUNDATION.md §2.7). Same rules as the old system map's nodeStates:
// a country is lit when its level is completed; it and its region pulse while the act's boss
// is open (the current incident). Bosses carry no country; a boss pulses its act's region.
import { ACT_REGIONS, LEVEL_COUNTRY } from '../hub/globe-map.mjs';
import { isCompleted, levelState } from './unlock.mjs';

/**
 * → { countries: { [iso3]: {lit, pulse} }, regions: { [actId]: {region, done, total, pulse} } }
 * (null-prototype objects) for the §2.4 registry and the §2.5 progress view. `done` and
 * `total` count the act's levels and its boss; progress ids the registry lacks are ignored.
 * Acts without a region and levels without a country are left out (test/globe-data.test.mjs
 * keeps the live registry fully mapped). `map` is injectable for tests.
 */
export function globeState(registry, progress, map = { ACT_REGIONS, LEVEL_COUNTRY }) {
  const countries = Object.create(null);
  const regions = Object.create(null);
  for (const act of registry.acts) {
    if (!Object.hasOwn(map.ACT_REGIONS, act.id)) continue;
    const ids = act.bossId == null ? act.levelIds : [...act.levelIds, act.bossId];
    const pulse = act.bossId != null && levelState(act.bossId, progress, registry) === 'open';
    regions[act.id] = {
      region: map.ACT_REGIONS[act.id].region,
      done: ids.filter((id) => isCompleted(progress, id)).length,
      total: ids.length,
      pulse,
    };
    for (const id of act.levelIds) {
      if (!Object.hasOwn(map.LEVEL_COUNTRY, id)) continue;
      countries[map.LEVEL_COUNTRY[id]] = { lit: isCompleted(progress, id), pulse };
    }
  }
  return { countries, regions };
}
