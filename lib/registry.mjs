// Validate and build the level registry and the card deck (docs/FOUNDATION.md
// §2.1-2.4, §3). Validation collects every problem; it never stops at the first.

const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_ID = 64;
const MAX_FRONT = 140;
export const MECHANICS = Object.freeze([
  'sort', 'build', 'configure', 'query', 'spot', 'incident', 'tradeoff',
]);
const MECHANIC_SET = new Set(MECHANICS);
const FORBIDDEN = ['act', 'kind', 'actId']; // set by the registry from the level's position

/** Thrown by buildRegistry; `errors` lists every problem. */
export class RegistryError extends Error {
  constructor(errors) {
    super(`invalid registry:\n- ${errors.join('\n- ')}`);
    this.name = 'RegistryError';
    this.errors = errors;
  }
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isId = (v) => typeof v === 'string' && v.length <= MAX_ID && ID.test(v);
const isText = (v) => typeof v === 'string' && v.length > 0;
const quote = (v) => JSON.stringify(v) ?? String(v);

/** Check DECK (§2.3). Returns { ok, errors }; never throws. */
export function validateDeck(deck) {
  const errors = [];
  if (!Array.isArray(deck)) return { ok: false, errors: ['deck must be an array'] };
  const seen = new Set();
  deck.forEach((c, i) => {
    if (!isObject(c)) return errors.push(`deck card ${i} is not an object`);
    if (!isId(c.id)) return errors.push(`invalid card id ${quote(c.id)}`);
    if (seen.has(c.id)) return errors.push(`duplicate card id "${c.id}"`);
    seen.add(c.id);
    const at = `card "${c.id}"`;
    if (!isText(c.front) || c.front.length > MAX_FRONT) {
      errors.push(`${at}: front must be 1-${MAX_FRONT} characters`);
    }
    if (!isText(c.back)) errors.push(`${at}: back must be non-empty`);
    if (typeof c.specUrl !== 'string' || !c.specUrl.startsWith('https://')) {
      errors.push(`${at}: specUrl must start with https://`);
    }
    if (c.dash0Angle !== null && !isText(c.dash0Angle)) {
      errors.push(`${at}: dash0Angle must be non-empty text or null`);
    }
  });
  return { ok: errors.length === 0, errors };
}

// Check an id list field: an array of unique ids, each in `known`.
function checkRefs(errors, at, list, field, noun, known) {
  if (list === undefined) return;
  if (!Array.isArray(list)) return errors.push(`${at}: ${field} must be an array`);
  const seen = new Set();
  for (const id of list) {
    if (seen.has(id)) errors.push(`${at}: duplicate ${noun} ${quote(id)}`);
    else if (!known.has(id)) errors.push(`${at}: unknown ${noun} ${quote(id)}`);
    seen.add(id);
  }
}

// Check one level's own fields (§2.1). `minor` is the previous level's minor number
// in this act; returns this level's (or `minor` unchanged when unusable).
function checkLevel(errors, lv, { act, boss, minor, cardIds, nodeIds, titles }) {
  const at = `level "${lv.id}"`;
  for (const key of FORBIDDEN) {
    if (Object.hasOwn(lv, key)) errors.push(`${at}: must not declare "${key}"`);
  }
  if (boss) {
    if (lv.no !== null) errors.push(`${at}: no must be null for a boss, got ${quote(lv.no)}`);
  } else {
    const m = typeof lv.no === 'string' ? /^(\d+)\.(\d+)$/.exec(lv.no) : null;
    if (!m || Number(m[1]) !== act.no) {
      errors.push(`${at}: no ${quote(lv.no)} must be "${act.no}.<n>"`);
    } else if (Number(m[2]) <= minor) {
      errors.push(`${at}: no ${quote(lv.no)} must come after "${act.no}.${minor}"`);
    } else {
      minor = Number(m[2]);
    }
  }
  if (!isText(lv.name)) errors.push(`${at}: name must be non-empty`);
  if (lv.sub !== undefined && typeof lv.sub !== 'string') {
    errors.push(`${at}: sub must be a string`);
  }
  if (!isText(lv.icon)) errors.push(`${at}: icon must be non-empty`);
  if (!isText(lv.rewardTitle)) {
    errors.push(`${at}: rewardTitle must be non-empty`);
  } else if (titles.has(lv.rewardTitle)) {
    errors.push(`${at}: duplicate reward title ${quote(lv.rewardTitle)}`);
  } else {
    titles.add(lv.rewardTitle);
  }
  if (!Array.isArray(lv.mechanics) || lv.mechanics.length === 0) {
    errors.push(`${at}: mechanics must be a non-empty array`);
  } else {
    checkRefs(errors, at, lv.mechanics, 'mechanics', 'mechanic', MECHANIC_SET);
  }
  checkRefs(errors, at, lv.cards, 'cards', 'card', cardIds);
  checkRefs(errors, at, lv.lights, 'lights', 'node', nodeIds);
  if (lv.scored !== undefined && typeof lv.scored !== 'boolean') {
    errors.push(`${at}: scored must be a boolean`);
  }
  if (lv.scoring !== undefined) {
    const par = isObject(lv.scoring) ? lv.scoring.parMs : undefined;
    if (par !== null && !(Number.isInteger(par) && par > 0)) {
      errors.push(`${at}: scoring.parMs must be a positive integer or null`);
    }
  }
  if (typeof lv.run !== 'function') errors.push(`${at}: run must be a function`);
  return minor;
}

/** Check ACTS (§2.2, §3) against known card and node ids; { ok, errors }, never throws. */
export function validateRegistry(acts, { cardIds = [], nodeIds = [] } = {}) {
  const errors = [];
  if (!Array.isArray(acts)) return { ok: false, errors: ['ACTS must be an array'] };
  const refs = { cardIds: new Set(cardIds), nodeIds: new Set(nodeIds), titles: new Set() };
  const actIds = new Set();
  const levelIds = new Set();
  let lastNo = -1;

  acts.forEach((act, i) => {
    if (!isObject(act)) return errors.push(`act ${i} is not an object`);
    if (!isId(act.id)) errors.push(`invalid act id ${quote(act.id)}`);
    else if (actIds.has(act.id)) errors.push(`duplicate act id "${act.id}"`);
    actIds.add(act.id);
    const at = `act "${act.id}"`;
    if (!Number.isInteger(act.no) || act.no < 0) {
      errors.push(`${at}: no must be an integer >= 0`);
    } else if (act.no <= lastNo) {
      errors.push(`${at}: no ${act.no} must be greater than ${lastNo}`);
    } else {
      lastNo = act.no;
    }
    for (const key of ['name', 'sub']) {
      if (act[key] !== undefined && typeof act[key] !== 'string') {
        errors.push(`${at}: ${key} must be a string`);
      }
    }
    if (!Array.isArray(act.levels)) return errors.push(`${at}: levels must be an array`);
    if (act.levels.length === 0) errors.push(`${at} has no levels`);
    if (act.boss !== null && !isObject(act.boss)) {
      errors.push(`${at}: boss must be a level or null`);
    }

    const entries = act.levels.map((lv, j) => [lv, false, j]);
    if (isObject(act.boss)) entries.push([act.boss, true, 'boss']);
    let minor = 0;
    for (const [lv, boss, j] of entries) {
      if (!isObject(lv)) {
        errors.push(`${at}: level ${j} is not an object`);
        continue;
      }
      if (!isId(lv.id)) {
        errors.push(`${at}: invalid level id ${quote(lv.id)}`);
        continue;
      }
      if (levelIds.has(lv.id)) {
        // The rest would repeat the first copy's findings (e.g. its reward title).
        errors.push(`duplicate level id "${lv.id}"`);
        continue;
      }
      levelIds.add(lv.id);
      minor = checkLevel(errors, lv, { act, boss, minor, ...refs });
    }
  });
  return { ok: errors.length === 0, errors };
}

function deepFreeze(v) {
  if (v !== null && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Reflect.ownKeys(v)) deepFreeze(v[k]);
  }
  return v;
}

/** Validate DECK and ACTS, then build the deep-frozen Registry (§2.4); throws RegistryError. */
export function buildRegistry(acts, { deck, nodeIds = [] } = {}) {
  const deckCheck = validateDeck(deck);
  // Even from a broken deck, its ids keep level card checks from piling on noise.
  const cardIds = Array.isArray(deck) ? deck.map((c) => c?.id).sort() : [];
  const errors = [...deckCheck.errors, ...validateRegistry(acts, { cardIds, nodeIds }).errors];
  if (errors.length) throw new RegistryError(errors);

  const levels = Object.create(null);
  const order = [];
  const add = (lv, actId, kind) => {
    levels[lv.id] = {
      ...lv,
      sub: lv.sub ?? '',
      cards: [...(lv.cards ?? [])],
      lights: [...(lv.lights ?? [])],
      mechanics: [...lv.mechanics],
      scored: lv.scored ?? true,
      scoring: { parMs: lv.scoring?.parMs ?? null },
      actId,
      kind,
    };
    order.push(lv.id);
    return lv.id;
  };
  const builtActs = acts.map((a) => ({
    id: a.id,
    no: a.no,
    name: a.name ?? '',
    sub: a.sub ?? '',
    levelIds: a.levels.map((lv) => add(lv, a.id, 'level')),
    bossId: a.boss ? add(a.boss, a.id, 'boss') : null,
  }));
  return deepFreeze({ acts: builtActs, levels, order, cardIds });
}

/** Ids of the levels whose `lights` include `nodeId`, in play order. */
export function nodeLitBy(registry, nodeId) {
  return registry.order.filter((id) => registry.levels[id].lights.includes(nodeId));
}
