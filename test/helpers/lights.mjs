// Which `lights` ids a progress record lights, for the level tests that pin each level's
// `lights` data: an id is lit when ANY level naming it is completed (the rule of the retired
// SVG system map, #150; the data stays, nothing draws it). In NODE_IDS order.
import { NODE_IDS } from '../../hub/map-data.mjs';
import { nodeLitBy } from '../../lib/registry.mjs';
import { isCompleted } from '../../lib/unlock.mjs';

export function litIds(registry, progress, ids = NODE_IDS) {
  return ids.filter((id) => nodeLitBy(registry, id).some((levelId) => isCompleted(progress, levelId)));
}
