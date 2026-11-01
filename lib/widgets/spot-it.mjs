// Spot it widget core (docs/M1-DESIGN.md §4.4): validate a SpotSpec, toggle line selection,
// check the selection against the seeded faults. Pure and DOM-free; state is never mutated.
// The view and its penalty live in `spot-it-view.mjs` (`mountSpot`, I1).
//
// SpotSpec = { id, target: 'config'|'span'|'metric', lines: [{id, text}], faults: [lineId],
//              whyNot?: {[lineId]: text}, explain }
// SpotState = { selected: lineId[] (spec order), tried: string[] (wrong selections), solved }

import { isId } from '../registry.mjs';

export const TARGETS = Object.freeze(['config', 'span', 'metric']);
const LINES = { min: 2, max: 12 };
const TEXT_FIT = {
  span: [/^[^=\s]+=/, 'span attribute lines must read key=value'],
  metric: [/^[A-Za-z_:][\w:]*\{.*\}$/, 'metric lines must read name{labels}'],
};

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isText = (v) => typeof v === 'string' && v.trim() !== '';
const show = (v) => (typeof v === 'string' ? `"${v}"` : String(v));

/** Every problem with `spec` (empty when valid). Never throws, never stops at the first. */
export function validateSpotSpec(spec) {
  if (!isObject(spec)) return ['spec: not an object'];
  const problems = [];
  if (!isId(spec.id)) problems.push(`spec id ${show(spec.id)} is not kebab-case`);
  if (!TARGETS.includes(spec.target)) problems.push(`target ${show(spec.target)} is not one of ${TARGETS.join(', ')}`);
  if (!isText(spec.explain)) problems.push('explain is not non-empty text');
  const lines = Array.isArray(spec.lines) ? spec.lines : [];
  if (!Array.isArray(spec.lines) || lines.length < LINES.min || lines.length > LINES.max) {
    problems.push(`lines: ${Array.isArray(spec.lines) ? lines.length : 'not a list'}, expected ${LINES.min}..${LINES.max}`);
  }
  const ids = new Set();
  const fit = TEXT_FIT[spec.target];
  lines.forEach((line, i) => {
    if (!isObject(line)) return void problems.push(`line ${i}: not an object`);
    if (!isId(line.id)) problems.push(`line id ${show(line.id)} is not kebab-case`);
    else if (ids.has(line.id)) problems.push(`duplicate line id ${show(line.id)}`);
    ids.add(line.id);
    if (!isText(line.text)) problems.push(`line ${show(line.id)}: text is not non-empty text`);
    else if (fit && !fit[0].test(line.text)) problems.push(`line ${show(line.id)}: ${fit[1]}`);
  });
  const faults = Array.isArray(spec.faults) ? spec.faults : [];
  if (faults.length < 1) problems.push('faults: needs at least 1');
  const seen = new Set();
  for (const f of faults) {
    if (!ids.has(f)) problems.push(`faults: unknown line ${show(f)}`);
    else if (seen.has(f)) problems.push(`faults: duplicate fault ${show(f)}`);
    seen.add(f);
  }
  if (ids.size > 0 && seen.size === ids.size) problems.push('faults: every line is a fault, so there is nothing to spot');
  if (spec.whyNot !== undefined) {
    if (!isObject(spec.whyNot)) problems.push('whyNot is not an object');
    else {
      for (const [key, text] of Object.entries(spec.whyNot)) {
        if (!ids.has(key)) problems.push(`whyNot: unknown line ${show(key)}`);
        else if (seen.has(key)) problems.push(`whyNot: line ${show(key)} is a fault (never shown)`);
        if (!isText(text)) problems.push(`whyNot ${show(key)} is not non-empty text`);
      }
    }
  }
  return problems;
}

/** A fresh state: nothing selected, nothing tried. */
export function newSpotState(_spec) {
  return { selected: [], tried: [], solved: false };
}

const key = (ids) => ids.join(',');
const inSpecOrder = (spec, ids) => spec.lines.map((l) => l.id).filter((id) => ids.includes(id));

/**
 * Select or unselect line `lineId`: `{state, outcome}`. Outcome: 'selected', 'unselected',
 * 'unknown' (no such line) or 'solved' (locked). Never mutates; unknown/solved return `state`.
 */
export function toggleLine(spec, state, lineId) {
  if (!spec.lines.some((l) => l.id === lineId)) return { state, outcome: 'unknown' };
  if (state.solved) return { state, outcome: 'solved' };
  const on = state.selected.includes(lineId);
  const selected = inSpecOrder(spec, on ? state.selected.filter((x) => x !== lineId) : [...state.selected, lineId]);
  return { state: { ...state, selected }, outcome: on ? 'unselected' : 'selected' };
}

/**
 * Check the selection: `{state, outcome, extra, missing}`. Outcome: 'solved' (already),
 * 'empty' (nothing selected), 'right' (exactly the fault set; state.solved), 'repeat' (this
 * wrong selection was tried before) or 'wrong'. `extra` are selected non-faults and
 * `missing` unselected faults, both in spec order.
 */
export function checkSpot(spec, state) {
  const extra = state.selected.filter((id) => !spec.faults.includes(id));
  const missing = inSpecOrder(spec, spec.faults.filter((id) => !state.selected.includes(id)));
  if (state.solved) return { state, outcome: 'solved', extra, missing };
  if (state.selected.length === 0) return { state, outcome: 'empty', extra, missing };
  if (extra.length === 0 && missing.length === 0) return { state: { ...state, solved: true }, outcome: 'right', extra, missing };
  const k = key(state.selected);
  if (state.tried.includes(k)) return { state, outcome: 'repeat', extra, missing };
  return { state: { ...state, tried: [...state.tried, k] }, outcome: 'wrong', extra, missing };
}
