// The Configure it help ladder core, pure (#159 C1; same contract as spot-it-help.mjs): the helps a
// configure step declares (`spec.helps`, today only `hints`) and the three hint tiers. Tier 2 reads
// the answer's shape through `pipelineStages`, the one reader of what a pipeline lists, and the
// player's verdict through `runConfigure`; it never names a component id and throws the state
// `runConfigure` returns away, so a hint is never a wrong try. Line text is escaped. DOM-free.

import { validateHelps } from './help-ladder.mjs';
import { SCHEMAS, required, runConfigure } from './configure-it.mjs';
import { checkConfig, pipelineStages } from '../configure/check.mjs';

/** The Configure it helps, in chip order: [key, label]. */
export const CONFIGURE_HELPS = Object.freeze([['hints', 'Hints']]);
const KEYS = CONFIGURE_HELPS.map(([k]) => k);

/** The tier 1 hint when a step has no authored `hint`. Plain text. */
export const CONFIGURE_RULE =
  'Follow each signal from its receiver to its exporter: every name a pipeline lists must be defined, under exactly that id, in its section.';

/** The helps of `spec`, every key true or false. Without `helps`: hints off. */
export function configureHelps(spec) {
  return Object.fromEntries(KEYS.map((k) => [k, spec.helps?.[k] === true]));
}

/** Problems with the helps of a valid ConfigureSpec (and its `hint`). */
export function validateConfigureHelps(spec) {
  const problems = validateHelps(spec.helps, KEYS);
  if (spec.hint !== undefined && !(typeof spec.hint === 'string' && spec.hint.trim() !== '')) {
    problems.push('hint: not non-empty text');
  }
  if (problems.some((p) => p.startsWith('helps:'))) return problems;
  if (spec.hint !== undefined && !configureHelps(spec).hints) problems.push('hint: shown only when helps.hints is on');
  return problems;
}

const defaultEscape = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const counts = (stages) => {
  const [r, p, x] = ['receiver', 'processor', 'exporter'].map((w, i) => plural(stages[i].items.length, w));
  return [r, p, x];
};
const usesOf = (spec) => (spec.uses !== null && typeof spec.uses === 'object' ? spec.uses : {});

/** Where a pipeline's first reason points, by stage key only (never an id), phrased by the reason's kind. */
function stalledAt(reason, schema, name, e) {
  const prefix = `${schema.pipelines.at}.${name}.`;
  const key = schema.pipelines.stages.find(({ key: k }) => reason?.path.startsWith(`${prefix}${k}`))?.key;
  if (key === undefined) return 'Something in it does not fit what a Collector accepts.';
  const k = e(key);
  switch (reason.kind) {
    case 'unknown-ref': return `One name yours lists under ${k} is not defined under that exact id.`;
    case 'too-few': return `Yours lists nothing under ${k}.`;
    case 'missing-key': return `Yours has no ${k} list.`;
    case 'wrong-type': return `What yours has under ${k} is not a list.`;
    default: return `Something under ${k} does not fit what a Collector accepts.`;
  }
}

/** The section of the first error outside the pipelines (`service.extensions`, `exporters`): keys only, never an id. */
function outsideSection(mine, schema) {
  const err = mine.errors.find((x) => !x.path.startsWith(`${schema.pipelines.at}.`) && x.path !== schema.pipelines.at);
  if (err === undefined) return undefined;
  const [top, second] = err.path.replace(/\[\d+\]/g, '').split('.');
  return top === 'service' && second !== undefined ? `service.${second}` : top === '' ? 'the top level' : top;
}

/**
 * Hint tier `tier` (1 to 3) for the config `text` typed in `state`: { html, apply? }; every html is a <p>.
 *   tier 1  the step's authored `hint` or CONFIGURE_RULE
 *   tier 2  one pipeline (the first required one the player's config does not flow, else the first other one
 *           that does not flow, else (an error outside service.pipelines, named by its section, no
 *           pipeline described) the first whose `uses` component is missing, else the first required,
 *           else the reference's first) described by how many receivers, processors and exporters the answer lists there, against the player's
 *           count, and for a stalled pipeline the stage of its first reason; for a missing `uses` component, the stage it belongs under. No component ids
 *   tier 3  `apply` = the reference config (the widget fills it in and runs Check, never a mistake)
 */
export function hintFor(spec, state, text, tier, { e = defaultEscape } = {}) {
  if (tier === 1) return { html: `<p>${spec.hint !== undefined ? spec.hint : CONFIGURE_RULE}</p>` };
  if (tier === 3) return { apply: spec.reference, html: '<p>Filled in for you: a config that passes.</p>' };
  const run = runConfigure(spec, state, text); // run.state is thrown away
  if (run.outcome === 'right' || run.outcome === 'solved') return { html: '<p>Yours already passes: press Check.</p>' };
  const schema = SCHEMAS[spec.schema];
  const ref = checkConfig(spec.reference, schema);
  const mine = run.result?.doc ? run.result : null;
  const req = required(spec);
  const flowing = (name) => mine?.verdict?.pipelines.some((p) => p.name === name && p.flowing);
  const lacks = (name) => {
    if (!mine) return undefined;
    const have = new Set(pipelineStages(mine, schema, name).flatMap(({ items }) => items.map(([, id]) => id)));
    return (usesOf(spec)[name] ?? []).find((id) => !have.has(id));
  };
  const broken = (list) => list.find((q) => !q.flowing)?.name;
  let name = req.find((n) => !flowing(n));
  let missingId;
  let outside; // an error outside service.pipelines, as a section path (no ids)
  if (name === undefined && mine) {
    name = broken(mine.verdict?.pipelines ?? []); // a pipeline the task does not require
    if (name === undefined) {
      outside = outsideSection(mine, schema);
      if (outside !== undefined) name = req[0] ?? ref.verdict?.pipelines[0]?.name;
    }
  }
  if (name === undefined && mine) {
    name = req.find((n) => lacks(n) !== undefined);
    if (name !== undefined) missingId = lacks(name);
  }
  if (name === undefined) name = req[0] ?? broken(mine?.verdict?.pipelines ?? []) ?? ref.verdict?.pipelines[0]?.name;
  if (outside !== undefined) {
    return { html: `<p>Your ${e(name)} pipeline flows; what stops the Collector is under ${e(outside)}.</p>` };
  }
  const theirs = pipelineStages(ref, schema, name);
  const [r, p, x] = counts(theirs);
  const inRef = ref.verdict?.pipelines.some((q) => q.name === name);
  let html = inRef ? `In the answer, the ${e(name)} pipeline lists ${r}, ${p} and ${x}` : `The answer has no ${e(name)} pipeline`;
  const mineQ = mine?.verdict?.pipelines.find((q) => q.name === name);
  if (!mine) html += run.outcome === 'blank' ? '. Yours is empty.' : '. Yours cannot be read yet.';
  else if (!mineQ) html += `. Yours has no ${e(name)} pipeline yet.`;
  else {
    const [mr, mp, mx] = counts(pipelineStages(mine, schema, name));
    html += `; yours lists ${mr}, ${mp} and ${mx}.`;
    if (!mineQ.flowing) html += ` ${stalledAt(mineQ.reasons[0], schema, name, e)}`;
  }
  if (missingId !== undefined) {
    const stage = theirs.find(({ items }) => items.some(([, id]) => id === missingId));
    if (stage) html += ` One component the task needs belongs under ${e(stage.key)}.`;
  }
  return { html: `<p>${html}</p>` };
}
