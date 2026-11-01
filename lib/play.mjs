// Declarative levels (docs/DECLARATIVE-LEVELS.md §3, §5): the step types, validatePlay and
// runPlay. A level's `play` is plain data; the registry copies and freezes it and builds
// `run` from runPlay. The only home of the Next/Finish markup and gating. Penalties live in
// each widget's mount, never here (PI1). No timers, no module state (PI2). DOM-free at import.
// The registry never imports this file (widgets import isId from it): app.mjs passes the kit.

import { checkKeys, isId } from './registry.mjs';
import { choiceHtml, mountChoice, validateChoiceSpec } from './widgets/choice.mjs';
import { newSortState, validateSortSpec } from './widgets/sort-it.mjs';
import { renderSort, mountSort } from './widgets/sort-it-view.mjs';
import { checkBuild, newBuildState, validateBuildSpec } from './widgets/build-it.mjs';
import { renderBuild, mountBuild } from './widgets/build-it-view.mjs';
import { newIncident, validateScenario } from './widgets/incident.mjs';
import { renderIncident, mountIncident } from './widgets/incident-view.mjs';
import { newSpotState, validateSpotSpec } from './widgets/spot-it.mjs';
import { renderSpot, mountSpot } from './widgets/spot-it-view.mjs';
import { newTradeoffState, validateTradeoffSpec } from './widgets/trade-off.mjs';
import { renderTradeoff, mountTradeoff } from './widgets/trade-off-view.mjs';
import { newQueryState, validateQuerySpec } from './widgets/query-it.mjs';
import { renderQuery, mountQuery } from './widgets/query-it-view.mjs';
import { newConfigureState, validateConfigureSpec } from './widgets/configure-it.mjs';
import { renderConfigure, mountConfigure } from './widgets/configure-it-view.mjs';

const TOKEN = /^[A-Za-z][\w-]*$/;
const MIN_FINISH = 10;
const PLAY_KEYS = ['prefix', 'steps', 'finish'];
const STEP_KEYS = ['intro', 'question', 'show', 'code', 'qid'];
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isToken = (v) => typeof v === 'string' && TOKEN.test(v);
const isText = (v) => typeof v === 'string' && v.trim() !== '';
const has = (o, k) => Object.hasOwn(o, k);

const q = (v) => JSON.stringify(v);
/** Unknown-key problems: `spec` against `keys`, then each object in `groups[name]` (a list, or an object's values) against its keys. */
function unknownKeys(spec, keys, groups = {}) {
  const problems = [];
  if (!isObject(spec)) return problems;
  checkKeys(problems, spec, keys, 'spec');
  for (const [field, [allowed, name]] of Object.entries(groups)) {
    const list = spec[field];
    const entries = Array.isArray(list) ? list.map((x, i) => [i, x]) : isObject(list) ? Object.entries(list) : [];
    for (const [k, x] of entries) if (isObject(x)) checkKeys(problems, x, allowed, name(x, k));
  }
  return problems;
}
const SORT_KEYS = { buckets: [['id', 'label'], (b) => `bucket ${q(b.id)}`], items: [['id', 'label', 'bucket', 'why', 'whyNot'], (x) => `item ${q(x.id)}`] };
const SPAN_KEYS = ['spanId', 'traceId', 'name', 'service', 'kind', 'status', 'startMs', 'endMs', 'parentId', 'links', 'attributes', 'events'];
const BUILD_KEYS = { spans: [SPAN_KEYS, (x, i) => `span ${i}`], answer: [['parentId', 'kind', 'status', 'links'], (x, id) => `answer ${id}`] };
const SPOT_KEYS = { lines: [['id', 'text'], (l) => `line ${q(l.id)}`] };
const TRADEOFF_KEYS = {
  knobs: [['id', 'label', 'options'], (k) => `knob ${q(k.id)}`],
  needs: [['id', 'label'], (n) => `need ${q(n.id)}`],
};
const SCENARIO_KEYS = {
  views: [['id', 'label', 'costMin', 'html', 'kind'], (v) => `view ${q(v.id)}`],
  hypotheses: [['id', 'label', 'right', 'why'], (h) => `hypothesis ${q(h.id)}`],
};

/** Step types named in the design but not built yet: key -> the widget that will add it. None now. */
export const RESERVED = Object.freeze({});

/**
 * The live step types. Each: `key`; `mechanic` (a MECHANICS value, null for choice);
 * `labelled` (a question is required and render gets labelledBy); `idOf(spec)`;
 * `validate(spec) -> string[]` (pure, never throws); `render(ctx, spec, {labelledBy}) -> html`;
 * `mount(ctx, spec, {onDone})`, which calls onDone() once when the step is solved.
 */
export const STEP_TYPES = Object.freeze({
  choice: {
    key: 'choice',
    mechanic: null,
    labelled: true,
    idOf: (spec) => spec.id,
    validate(spec) {
      if (!isObject(spec)) return ['spec: not an object'];
      const problems = [];
      checkKeys(problems, spec, ['id', 'choices'], 'spec');
      if (!isId(spec.id)) problems.push(`spec id ${JSON.stringify(spec.id) ?? String(spec.id)} is not kebab-case`);
      if (Array.isArray(spec.choices) && spec.choices.length < 2) problems.push('needs at least 2 choices');
      return [...problems, ...validateChoiceSpec(spec.choices)];
    },
    render: (ctx, spec, { labelledBy }) => choiceHtml(ctx, spec.choices, { id: spec.id, labelledBy }),
    mount: (ctx, spec, { onDone }) => mountChoice(ctx, spec.choices, { id: spec.id, onRight: onDone }),
  },
  sort: {
    key: 'sort',
    mechanic: 'sort',
    labelled: true,
    idOf: (spec) => spec.id,
    validate: (spec) => [...unknownKeys(spec, ['id', 'buckets', 'items'], SORT_KEYS), ...validateSortSpec(spec)],
    render: (ctx, spec, { labelledBy }) =>
      renderSort(spec, newSortState(spec), { escapeHtml: ctx.escapeHtml, labelledBy }),
    mount: (ctx, spec, { onDone }) => mountSort(ctx, spec, { onComplete: onDone }),
  },
  build: {
    key: 'build',
    mechanic: 'build',
    labelled: false,
    idOf: (spec) => spec.id,
    validate(spec) {
      const problems = [...unknownKeys(spec, ['id', 'spans', 'edit', 'answer', 'hint'], BUILD_KEYS), ...validateBuildSpec(spec)];
      if (problems.length) return problems;
      return checkBuild(spec, newBuildState(spec)).ok
        ? ['the given state already passes Check, so there is nothing to do']
        : [];
    },
    render: (ctx, spec) => renderBuild(spec, newBuildState(spec), { escapeHtml: ctx.escapeHtml }),
    mount: (ctx, spec, { onDone }) => mountBuild(ctx, spec, { onComplete: onDone }),
  },
  incident: {
    key: 'incident',
    mechanic: 'incident',
    labelled: false,
    idOf: (spec) => spec.id,
    validate(spec) {
      const keys = ['id', 'alert', 'budget', 'views', 'hypotheses', 'answerAfterViews'];
      const nested = [];
      if (isObject(spec)) {
        if (isObject(spec.alert)) checkKeys(nested, spec.alert, ['title', 'html'], 'alert');
        if (isObject(spec.budget)) checkKeys(nested, spec.budget, ['startPct', 'burnPctPerMin'], 'budget');
      }
      return [...unknownKeys(spec, keys, SCENARIO_KEYS), ...nested, ...validateScenario(spec)];
    },
    render: (ctx, spec) => renderIncident(spec, newIncident(spec), { escapeHtml: ctx.escapeHtml }),
    mount: (ctx, spec, { onDone }) => mountIncident(ctx, spec, { onComplete: onDone }),
  },
  spot: {
    key: 'spot',
    mechanic: 'spot',
    labelled: true,
    idOf: (spec) => spec.id,
    validate: (spec) => [...unknownKeys(spec, ['id', 'target', 'lines', 'faults', 'whyNot', 'explain'], SPOT_KEYS), ...validateSpotSpec(spec)],
    render: (ctx, spec, { labelledBy }) =>
      renderSpot(spec, newSpotState(spec), { escapeHtml: ctx.escapeHtml, labelledBy }),
    mount: (ctx, spec, { onDone }) => mountSpot(ctx, spec, { onComplete: onDone }),
  },
  tradeoff: {
    key: 'tradeoff',
    mechanic: 'tradeoff',
    labelled: true,
    idOf: (spec) => spec.id,
    validate(spec) {
      const keys = ['id', 'unit', 'cap', 'knobs', 'needs', 'answer', 'whyNot', 'explain'];
      const options = [];
      if (isObject(spec) && Array.isArray(spec.knobs)) {
        for (const k of spec.knobs) {
          const list = isObject(k) && Array.isArray(k.options) ? k.options : [];
          for (const o of list) if (isObject(o)) checkKeys(options, o, ['id', 'label', 'cost', 'keeps'], `option ${q(o.id)} of knob ${q(k.id)}`);
        }
      }
      return [...unknownKeys(spec, keys, TRADEOFF_KEYS), ...options, ...validateTradeoffSpec(spec)];
    },
    render: (ctx, spec, { labelledBy }) =>
      renderTradeoff(spec, newTradeoffState(spec), { escapeHtml: ctx.escapeHtml, labelledBy }),
    mount: (ctx, spec, { onDone }) => mountTradeoff(ctx, spec, { onComplete: onDone }),
  },
  query: {
    key: 'query',
    mechanic: 'query',
    labelled: true,
    idOf: (spec) => spec.id,
    validate: (spec) => [...unknownKeys(spec, ['id', 'dataset', 'at', 'reference', 'given', 'hint', 'explain']), ...validateQuerySpec(spec)],
    render: (ctx, spec, { labelledBy }) =>
      renderQuery(spec, newQueryState(spec), { escapeHtml: ctx.escapeHtml, labelledBy }),
    mount: (ctx, spec, { onDone }) => mountQuery(ctx, spec, { onComplete: onDone }),
  },
  configure: {
    key: 'configure',
    mechanic: 'configure',
    labelled: true,
    idOf: (spec) => spec.id,
    validate: (spec) => [...unknownKeys(spec, ['id', 'schema', 'given', 'reference', 'target', 'hint', 'explain']), ...validateConfigureSpec(spec)],
    render: (ctx, spec, { labelledBy }) =>
      renderConfigure(spec, newConfigureState(), { escapeHtml: ctx.escapeHtml, labelledBy }),
    mount: (ctx, spec, { onDone }) => mountConfigure(ctx, spec, { onComplete: onDone }),
  },
});

const LIVE_KEYS = Object.keys(STEP_TYPES);
const TYPE_KEYS = [...LIVE_KEYS, ...Object.keys(RESERVED)];

/** What is wrong with `v` as plain data, as `{path, what}`; objects, arrays, strings, finite numbers, booleans, null. */
function nonPlain(v, path = '', stack = new Set()) {
  const at = (k) => (/^\d+$/.test(k) && Array.isArray(v) ? `${path}[${k}]` : path ? `${path}.${k}` : k);
  const bad = (what) => [{ path: path || 'play', what }];
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return [];
  if (typeof v === 'number') return Number.isFinite(v) ? [] : bad(`the number ${v}`);
  if (typeof v !== 'object') return bad(v === undefined ? 'undefined' : `a ${typeof v}`);
  if (stack.has(v)) return bad('circular');
  const proto = Object.getPrototypeOf(v);
  if (proto !== (Array.isArray(v) ? Array.prototype : Object.prototype) && proto !== null) {
    return bad(`a ${Object.prototype.toString.call(v).slice(8, -1)}, not plain data`);
  }
  stack.add(v);
  const out = [];
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) if (!(i in v)) out.push({ path: at(String(i)), what: 'a hole in an array' });
  }
  for (const k of Reflect.ownKeys(v)) {
    if (Array.isArray(v) && k === 'length') continue;
    const d = Object.getOwnPropertyDescriptor(v, k);
    if (typeof k === 'symbol') out.push({ path: path || 'play', what: 'a symbol key' });
    else if (d.get || d.set) out.push({ path: at(k), what: 'an accessor' });
    else out.push(...nonPlain(d.value, at(k), stack));
  }
  stack.delete(v);
  return out;
}

/** The problems of step `n` (1-based), pushed to `errors`; marks its ids in `seen`. */
function checkStep(errors, step, n, seen) {
  const at = `step ${n}`;
  if (!isObject(step)) return void errors.push(`${at} must be an object`);
  checkKeys(errors, step, [...STEP_KEYS, ...TYPE_KEYS], at, [], (k, w, tail) => `${w}: unknown key ${k}${tail}`);
  const keys = Object.keys(step).filter((k) => TYPE_KEYS.includes(k));
  if (keys.length === 0) return void errors.push(`${at} has no step type (one of ${LIVE_KEYS.join(', ')})`);
  if (keys.length > 1) return void errors.push(`${at} has two step types (${keys.map((k) => JSON.stringify(k)).join(', ')})`);
  const [key] = keys;
  if (has(RESERVED, key)) {
    return void errors.push(`${at}: step type "${key}" is reserved for ${RESERVED[key]} and not available yet`);
  }
  const type = STEP_TYPES[key];
  const spec = step[key];
  const id = isObject(spec) && typeof spec.id === 'string' ? spec.id : '?';
  const of = `${at} (${key} "${id}")`;
  if (!isText(step.intro)) errors.push(`${at}: intro must be text`);
  if (step.question !== undefined && !isText(step.question)) errors.push(`${at}: question must be text`);
  else if (step.question === undefined && type.labelled) errors.push(`${of}: needs a question`);
  for (const k of ['show', 'code']) {
    if (step[k] !== undefined && typeof step[k] !== 'string') errors.push(`${at}: ${k} must be a string`);
  }
  if (step.qid !== undefined && !isToken(step.qid)) errors.push(`${at}: qid must be a plain token`);
  for (const p of type.validate(spec)) errors.push(`${of}: ${p}`);
  const claim = (kind, name) => {
    const by = seen[kind].get(name);
    if (by === undefined) seen[kind].set(name, n);
    else errors.push(`${at}: ${kind} id "${name}" is already used by step ${by}`);
  };
  if (id !== '?') claim('widget', id);
  if (isText(step.question)) {
    const heading = step.qid ?? (id === '?' ? undefined : `${id}-q`);
    if (isToken(heading)) claim('heading', heading);
  }
  return undefined;
}

/**
 * Every problem with a level's `play`, as `{errors, mechanics}`. `mechanics` are the steps'
 * mechanics in order of first appearance. Pure; never throws, never stops at the first.
 */
export function validatePlay(play) {
  try {
    if (!isObject(play)) return { errors: ['play must be an object'], mechanics: [] };
    const plain = nonPlain(play);
    if (plain.length) {
      const errors = plain.map((p) => `play must be plain data: ${p.path} is ${p.what}; write run(ctx) for custom behaviour`);
      return { errors, mechanics: [] };
    }
    const errors = [];
    checkKeys(errors, play, PLAY_KEYS, 'play');
    if (play.prefix !== undefined && !isToken(play.prefix)) errors.push('play.prefix must be a plain token');
    if (typeof play.finish !== 'string' || play.finish.length <= MIN_FINISH) {
      errors.push(`play.finish must be reward text longer than ${MIN_FINISH} characters`);
    }
    if (!Array.isArray(play.steps) || play.steps.length === 0) {
      errors.push('play.steps must be a non-empty array');
      return { errors, mechanics: [] };
    }
    const seen = { widget: new Map(), heading: new Map() };
    const mechanics = [];
    play.steps.forEach((step, i) => {
      checkStep(errors, step, i + 1, seen);
      const type = isObject(step) ? STEP_TYPES[LIVE_KEYS.find((k) => has(step, k))] : undefined;
      if (type?.mechanic && !mechanics.includes(type.mechanic)) mechanics.push(type.mechanic);
    });
    return { errors, mechanics };
  } catch {
    return { errors: ['play could not be read'], mechanics: [] };
  }
}

/**
 * Play `level` (a built registry level with `play`) on `ctx`: each step is intro, optional
 * lead-in and code, question and the widget, gated behind Next (Finish on the last), which
 * stays disabled until the widget calls onDone. Finish awards `level.cards`. One closure per
 * run: reopening a level starts at step 1.
 */
export function runPlay(level, ctx) {
  const { steps, finish, prefix = level.id } = level.play;
  const e = ctx.escapeHtml;
  const show = (i) => {
    const step = steps[i];
    const type = STEP_TYPES[LIVE_KEYS.find((k) => has(step, k))];
    const spec = step[type.key];
    const last = i === steps.length - 1;
    const qid = step.qid ?? `${type.idOf(spec)}-q`;
    const labelledBy = step.question != null && type.labelled ? qid : undefined;
    const code = step.code == null ? '' : `<pre><code>${e(step.code)}</code></pre>`;
    const question = step.question == null ? '' : `<h3 class="q" id="${e(qid)}">${step.question}</h3>`;
    ctx.renderStep(
      `<div class="lesson-intro">${ctx.speech(step.intro)}</div><div class="lesson-stage">` +
        `${step.show ?? ''}${code}${question}${type.render(ctx, spec, { labelledBy })}</div>`,
      last
        ? `<button class="btn" id="${e(prefix)}-finish" data-finish disabled>Finish</button>`
        : `<button class="btn" id="${e(prefix)}-next" disabled>Next</button>`,
    );
    const btn = ctx.ovActions.querySelector(`#${prefix}-${last ? 'finish' : 'next'}`);
    btn.onclick = last ? () => ctx.finish({ text: finish, cards: level.cards }) : () => show(i + 1);
    type.mount(ctx, spec, {
      onDone: () => {
        btn.disabled = false;
        return btn;
      },
    });
  };
  show(0);
}
