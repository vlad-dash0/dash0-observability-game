// Validate and build the level registry and the card deck (docs/FOUNDATION.md
// §2.1-2.4, §3). Validation collects every problem, never stops at the first and
// never throws on plain data; an item whose getter throws is reported as unreadable.

const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const NO = /^(0|[1-9]\d*)\.([1-9]\d*)$/; // "<act>.<n>": n >= 1, no leading zeros
const MAX_ID = 64;
const MAX_FRONT = 140;
export const MECHANICS = Object.freeze([
  'sort', 'build', 'configure', 'query', 'spot', 'incident', 'tradeoff',
]);
const MECHANIC_SET = new Set(MECHANICS);
// Allowed keys (§2.1-2.3); anything else is an error, so a typo cannot pass silently.
const LEVEL_KEYS = [
  'id', 'no', 'name', 'sub', 'icon', 'rewardTitle', 'mechanics', 'cards', 'lights',
  'scored', 'scoring', 'run',
];
const ACT_KEYS = ['id', 'no', 'name', 'sub', 'levels', 'boss'];
const CARD_KEYS = ['id', 'front', 'back', 'specUrl', 'dash0Angle'];
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
/** A kebab-case id of at most 64 characters (FOUNDATION §2.1); shared by the widgets. */
export const isId = (v) => typeof v === 'string' && v.length <= MAX_ID && ID.test(v);
const isText = (v) => typeof v === 'string' && v.length > 0;

/** Any value as message text: JSON when possible, else its [object Type] tag. */
function quote(v) {
  try {
    const s = JSON.stringify(v);
    if (typeof s === 'string') return s;
  } catch {
    // BigInt or circular: fall through to the type tag.
  }
  return Object.prototype.toString.call(v);
}

// Levenshtein distance, for "did you mean" hints.
function distance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      const swap = prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, swap);
    }
    prev = row;
  }
  return prev[b.length];
}

// Report own keys outside `allowed` (and `skip`), hinting the nearest allowed key
// within min(2, half the key's length) edits, so very short keys get no hint.
function checkKeys(errors, obj, allowed, where, skip = []) {
  for (const key of Object.keys(obj)) {
    if (allowed.includes(key) || skip.includes(key)) continue;
    let hint = null;
    let best = Math.min(2, Math.floor(key.length / 2)) + 1;
    for (const k of allowed) {
      const d = distance(key, k);
      if (d < best) [hint, best] = [k, d];
    }
    const tail = hint ? ` (did you mean "${hint}"?)` : '';
    errors.push(`unknown key ${quote(key)} on ${where}${tail}`);
  }
}

// Check one deck card (§2.3); `seen` collects the ids so far.
function checkCard(errors, c, i, seen) {
  if (!isObject(c)) {
    errors.push(`deck card ${i} is not an object`);
    return;
  }
  if (!isId(c.id)) {
    errors.push(`invalid card id ${quote(c.id)}`);
    return;
  }
  if (seen.has(c.id)) {
    errors.push(`duplicate card id "${c.id}"`);
    return;
  }
  seen.add(c.id);
  const at = `card "${c.id}"`;
  checkKeys(errors, c, CARD_KEYS, at);
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
}

/** Check DECK (§2.3). Returns { ok, errors }; never throws on plain data. */
export function validateDeck(deck) {
  if (!Array.isArray(deck)) return { ok: false, errors: ['deck must be an array'] };
  const errors = [];
  const seen = new Set();
  for (let i = 0; i < deck.length; i++) {
    try {
      checkCard(errors, deck[i], i, seen);
    } catch {
      errors.push(`deck card ${i} could not be read`);
    }
  }
  return { ok: errors.length === 0, errors };
}

// Check an id list field: an array of unique ids, each in `known`.
function checkRefs(errors, at, list, field, noun, known) {
  if (list === undefined) return;
  if (!Array.isArray(list)) {
    errors.push(`${at}: ${field} must be an array`);
    return;
  }
  const seen = new Set();
  for (let i = 0; i < list.length; i++) {
    const id = list[i];
    if (seen.has(id)) errors.push(`${at}: duplicate ${noun} ${quote(id)}`);
    else if (!known.has(id)) errors.push(`${at}: unknown ${noun} ${quote(id)}`);
    seen.add(id);
  }
}

// Check a level's `no` (§2.1). `prev` is this act's last level with a valid no
// ({minor, no, id}) or null; returns the new `prev`.
function checkNo(errors, at, lv, { actNo, boss, prev }) {
  if (boss) {
    if (lv.no !== null) errors.push(`${at}: no must be null for a boss, got ${quote(lv.no)}`);
    return prev;
  }
  if (actNo === null) return prev; // the act's own no is already reported
  const m = typeof lv.no === 'string' ? NO.exec(lv.no) : null;
  if (!m || Number(m[1]) !== actNo) {
    errors.push(
      `${at}: no ${quote(lv.no)} must be "${actNo}.<n>" with n >= 1 and no leading zeros`,
    );
    return prev;
  }
  const minor = Number(m[2]);
  if (prev && minor <= prev.minor) {
    errors.push(`${at}: no ${quote(lv.no)} must come after ${quote(prev.no)} (level "${prev.id}")`);
    return prev;
  }
  return { minor, no: lv.no, id: lv.id };
}

// Check one level's own fields (§2.1) other than `no`.
function checkLevel(errors, lv, { cardIds, nodeIds, titles }) {
  const at = `level "${lv.id}"`;
  for (const key of FORBIDDEN) {
    if (Object.hasOwn(lv, key)) errors.push(`${at}: must not declare "${key}"`);
  }
  checkKeys(errors, lv, LEVEL_KEYS, at, FORBIDDEN);
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
}

// Check one act (§2.2) and its levels; `state` carries ids and the last act no.
function checkAct(errors, act, i, state, refs) {
  if (!isObject(act)) {
    errors.push(`act ${i} is not an object`);
    return;
  }
  if (!isId(act.id)) errors.push(`invalid act id ${quote(act.id)}`);
  else if (state.actIds.has(act.id)) errors.push(`duplicate act id "${act.id}"`);
  state.actIds.add(act.id);
  const at = `act ${quote(act.id)}`;
  checkKeys(errors, act, ACT_KEYS, at);
  let actNo = null;
  if (!Number.isSafeInteger(act.no) || act.no < 0) {
    errors.push(`${at}: no must be an integer from 0 to ${Number.MAX_SAFE_INTEGER}`);
  } else {
    actNo = act.no;
    if (act.no <= state.lastNo) {
      errors.push(`${at}: no ${act.no} must be greater than ${state.lastNo}`);
    } else {
      state.lastNo = act.no;
    }
  }
  for (const key of ['name', 'sub']) {
    if (act[key] !== undefined && typeof act[key] !== 'string') {
      errors.push(`${at}: ${key} must be a string`);
    }
  }
  if (!Array.isArray(act.levels)) {
    errors.push(`${at}: levels must be an array`);
    return;
  }
  if (act.levels.length === 0) errors.push(`${at} has no levels`);
  if (act.boss !== null && !isObject(act.boss)) {
    errors.push(`${at}: boss must be a level or null`);
  }

  const entries = Array.from(act.levels, (lv, j) => [lv, false, j]);
  if (isObject(act.boss)) entries.push([act.boss, true, 'boss']);
  let prev = null;
  for (const [lv, boss, j] of entries) {
    try {
      prev = checkEntry(errors, lv, { at, j, boss, actNo, prev, levelIds: state.levelIds, refs });
    } catch {
      errors.push(`${at}: level ${j} could not be read`);
    }
  }
}

// Check one level slot of an act; returns the act's new `prev` (see checkNo).
function checkEntry(errors, lv, { at, j, boss, actNo, prev, levelIds, refs }) {
  if (!isObject(lv)) {
    errors.push(`${at}: level ${j} is not an object`);
    return prev;
  }
  if (!isId(lv.id)) {
    errors.push(`${at}: invalid level id ${quote(lv.id)}`);
    return prev;
  }
  if (levelIds.has(lv.id)) {
    // The rest would repeat the first copy's findings (e.g. its reward title).
    errors.push(`duplicate level id "${lv.id}"`);
    return prev;
  }
  levelIds.add(lv.id);
  const next = checkNo(errors, `level "${lv.id}"`, lv, { actNo, boss, prev });
  checkLevel(errors, lv, refs);
  return next;
}

// An id-list option as a Set of its valid ids; a non-array or a non-id entry is an
// error (so a caller's object can never reach a level and be frozen there).
function idSet(errors, options, key) {
  const v = options[key];
  if (v === undefined) return new Set();
  if (!Array.isArray(v)) {
    errors.push(`${key} must be an array`);
    return new Set();
  }
  const ids = new Set();
  for (let i = 0; i < v.length; i++) {
    if (isId(v[i])) ids.add(v[i]);
    else errors.push(`${key}: invalid id ${quote(v[i])}`);
  }
  return ids;
}

/** Check ACTS (§2.2, §3) against known card and node ids; { ok, errors }. Never throws on
 * plain data. */
export function validateRegistry(acts, options = {}) {
  const errors = [];
  if (!isObject(options)) errors.push('options must be an object');
  const opts = isObject(options) ? options : {};
  const refs = {
    cardIds: idSet(errors, opts, 'cardIds'),
    nodeIds: idSet(errors, opts, 'nodeIds'),
    titles: new Set(),
  };
  if (!Array.isArray(acts)) {
    errors.push('ACTS must be an array');
    return { ok: false, errors };
  }
  const state = { actIds: new Set(), levelIds: new Set(), lastNo: -1 };
  for (let i = 0; i < acts.length; i++) {
    try {
      checkAct(errors, acts[i], i, state, refs);
    } catch {
      errors.push(`act ${i} could not be read`);
    }
  }
  return { ok: errors.length === 0, errors };
}

// Freeze every object and array reachable from `root`. Functions (a level's `run`,
// shared with its source module) are left alone; everything else was copied.
function deepFreeze(root) {
  const seen = new WeakSet();
  const visit = (v) => {
    if (v === null || typeof v !== 'object' || seen.has(v)) return;
    seen.add(v);
    Object.freeze(v);
    for (const k of Reflect.ownKeys(v)) visit(v[k]);
  };
  visit(root);
  return root;
}

/** Validate DECK and ACTS, then build the deep-frozen Registry (§2.4); throws RegistryError. */
export function buildRegistry(acts, options = {}) {
  const opts = isObject(options) ? options : {};
  const { deck, nodeIds } = opts;
  // Even from a broken deck, its valid ids keep level card checks from piling on noise.
  const cardIds = Array.isArray(deck)
    ? Array.from(deck, (c) => (isObject(c) ? c.id : undefined)).filter(isId).sort()
    : [];
  const errors = [
    ...(isObject(options) ? [] : ['options must be an object']),
    ...validateDeck(deck).errors,
    ...validateRegistry(acts, { cardIds, nodeIds }).errors,
  ];
  if (errors.length) throw new RegistryError(errors);

  const levels = Object.create(null);
  const order = [];
  // Only the §2.1 fields, copied, plus defaults and the position-derived actId/kind.
  const add = (lv, actId, kind) => {
    levels[lv.id] = {
      id: lv.id,
      no: lv.no,
      name: lv.name,
      sub: lv.sub ?? '',
      icon: lv.icon,
      rewardTitle: lv.rewardTitle,
      mechanics: [...lv.mechanics],
      cards: [...(lv.cards ?? [])],
      lights: [...(lv.lights ?? [])],
      scored: lv.scored ?? true,
      scoring: { parMs: lv.scoring?.parMs ?? null },
      run: lv.run,
      actId,
      kind,
    };
    order.push(lv.id);
    return lv.id;
  };
  const builtActs = Array.from(acts, (a) => ({
    id: a.id,
    no: a.no,
    name: a.name ?? '',
    sub: a.sub ?? '',
    levelIds: Array.from(a.levels, (lv) => add(lv, a.id, 'level')),
    bossId: a.boss ? add(a.boss, a.id, 'boss') : null,
  }));
  return deepFreeze({ acts: builtActs, levels, order, cardIds });
}

/** Ids of the levels whose `lights` include `nodeId`, in play order. */
export function nodeLitBy(registry, nodeId) {
  return registry.order.filter((id) => registry.levels[id].lights.includes(nodeId));
}
