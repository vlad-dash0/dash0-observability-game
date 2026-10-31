// Build it widget view (docs/M1-DESIGN.md §4.2): an SVG trace waterfall with an <ol> text
// alternative, a panel of the selected span's editable controls, Check and an optional
// hint. mountBuild is the only home of "a failed check costs one mistake unless identical
// to the last failed one" (§2, I1). Span names, services and ids are data text and are
// escaped (I3); the hint is trusted authored HTML. Bars carry SVG attributes only, never
// style (CSP). DOM-free at import time.

import { canFocus } from './focus.mjs';
import { KINDS, STATUSES, waterfall } from './trace.mjs';
import {
  applyState,
  checkBuild,
  newBuildState,
  setKind,
  setParent,
  setStatus,
  toggleLink,
  validateBuildSpec,
} from './build-it.mjs';

const ROW = 6; // viewBox units per row
const BAR = 4;
const num = (n) => String(Math.round(n * 100) / 100);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const labelOf = (s, e) => `${e(s.name)} (${e(s.service)})`;

/** The text of one row: `name · service · KIND · status · start–end ms · Parent: …`. */
function rowText(s, row, byId, e) {
  let parent = 'none';
  if (row.orphan) parent = `${e(s.parentId)} (not found)`;
  else if (s.parentId !== null) parent = `${labelOf(byId.get(s.parentId), e)}${row.crossTrace ? ', in another trace' : ''}`;
  return `${e(s.name)} · ${e(s.service)} · ${e(s.kind)} · ${e(s.status)} · ${num(s.startMs)}–${num(s.endMs)} ms · Parent: ${parent}`;
}

/** One group of toggle buttons in the panel. */
function group(title, attr, options, locked) {
  const off = locked ? ' disabled' : '';
  const buttons = options
    .map(([value, text, on]) => `<button class="build-opt" ${attr}="${value}" aria-pressed="${on}"${off}>${text}</button>`)
    .join('');
  return `<div class="build-group" role="group" aria-label="${title}"><p class="build-group-title">${title}</p>${buttons}</div>`;
}

/** The panel for `selected`: only the controls `spec.edit` allows. */
function panelHtml(spec, spans, selected, locked, e) {
  const s = spans.find((x) => x.spanId === selected);
  if (!s) return '<p class="build-pick">Pick a span to edit it.</p>';
  const edit = (name) => spec.edit.includes(name);
  const parts = [`<p class="build-editing">Editing ${labelOf(s, e)}, trace <code>${e(s.traceId)}</code></p>`];
  if (edit('parent')) {
    const opts = [['none', 'No parent (root span)', s.parentId === null]];
    for (const p of spans) opts.push([e(p.spanId), labelOf(p, e), s.parentId === p.spanId]);
    parts.push(group('Parent', 'data-parent', opts, locked));
  }
  if (edit('kind')) parts.push(group('Kind', 'data-kind', KINDS.map((k) => [k, k, s.kind === k]), locked));
  if (edit('status')) parts.push(group('Status', 'data-status', STATUSES.map((k) => [k, k, s.status === k]), locked));
  if (edit('links')) {
    const opts = spans.filter((p) => p.spanId !== s.spanId).map((p) => [e(p.spanId), labelOf(p, e), s.links.includes(p.spanId)]);
    parts.push(group('Links', 'data-link', opts, locked));
  }
  return parts.join('');
}

/** The waterfall (SVG, decorative), its <ol> text alternative and the panel. */
function boardHtml(spec, state, selected, locked, e) {
  const spans = applyState(spec, state);
  const byId = new Map(spans.map((s) => [s.spanId, s]));
  const { rows } = waterfall(spans);
  const bars = rows
    .map((r, i) => {
      const cls = `wf-bar kind-${r.kind.toLowerCase()}${r.status === 'ERROR' ? ' error' : ''}${r.spanId === selected ? ' selected' : ''}`;
      return `<rect class="${cls}" x="${num(r.x)}" y="${i * ROW}" width="${num(r.width)}" height="${BAR}"></rect>`;
    })
    .join('');
  const list = rows
    .map((r) => {
      const s = byId.get(r.spanId);
      return (
        `<li data-depth="${Math.min(r.depth, 5)}"><button class="build-span" data-span="${e(r.spanId)}" ` +
        `aria-pressed="${r.spanId === selected}">${rowText(s, r, byId, e)}</button></li>`
      );
    })
    .join('');
  return (
    `<svg class="waterfall" viewBox="0 0 100 ${rows.length * ROW}" preserveAspectRatio="none" aria-hidden="true" focusable="false">${bars}</svg>` +
    `<ol class="build-rows">${list}</ol>` +
    `<div class="build-panel" data-build-panel>${panelHtml(spec, spans, selected, locked, e)}</div>`
  );
}

/**
 * Markup for Build it `spec` in `state` with span `selected` (or null) pressed: the
 * board (`[data-build-board]`: SVG waterfall, `<ol>` of `[data-span]` buttons, the panel),
 * then `#<id>-check`, `#<id>-hint` and its `#<id>-hint-text` when the spec has a hint,
 * and the `#<id>-feedback` status region.
 */
export function renderBuild(spec, state, { selected = null, escapeHtml: e } = {}) {
  const id = e(spec.id);
  const hint = spec.hint === undefined
    ? ''
    : `<button class="btn ghost small" id="${id}-hint">Show a hint</button>` +
      `<div class="feedback info" id="${id}-hint-text" tabindex="-1"></div>`;
  return (
    `<div class="build" data-build="${id}">` +
    `<div class="build-board" data-build-board>${boardHtml(spec, state, selected, false, e)}</div>` +
    `<button class="btn" id="${id}-check">Check</button>${hint}` +
    `<div class="feedback" id="${id}-feedback" role="status" aria-live="polite" tabindex="-1"></div>` +
    `</div>`
  );
}

/**
 * Wire Build it `spec` (rendered by renderBuild into ctx.ovBody) from a fresh state and
 * focus its first span. Choosing a span opens its panel and focuses the first control;
 * every edit is free, says what changed, and keeps focus on that control. A parent that
 * would make a loop (itself or a span below it) is refused for free: "... would make a
 * loop." Check: passing says "Right. Every span checks out.", locks the controls, calls
 * onComplete() once and focuses its return if it passes canFocus, else the feedback.
 * Failing lists the problems and focuses the feedback; it costs ctx.mistake() unless the
 * graded state is identical to the last failed one ("Same as last time: N problems.").
 * The hint, if any, calls ctx.hint() once and shows its text. Throws TypeError (naming
 * the spec id) for an invalid spec, a missing onComplete, or a spec that is not rendered.
 */
export function mountBuild(ctx, spec, { onComplete } = {}) {
  const problems = validateBuildSpec(spec);
  const fail = (msg) => {
    throw new TypeError(`build "${String(spec?.id)}": ${msg}`);
  };
  if (problems.length) fail(`invalid spec: ${problems.join('; ')}`);
  if (typeof onComplete !== 'function') fail('onComplete must be a function');
  // Ids are kebab-case or hex (validated above), so they are safe inside selectors.
  const box = ctx.ovBody.querySelector(`[data-build="${spec.id}"]`);
  const board = box?.querySelector('[data-build-board]');
  const check = box?.querySelector(`[id="${spec.id}-check"]`);
  const fb = box?.querySelector(`[id="${spec.id}-feedback"]`);
  if (!board || !check || !fb) fail('not rendered (use renderBuild with the same spec)');
  const hintBtn = box.querySelector(`[id="${spec.id}-hint"]`);
  const hintText = box.querySelector(`[id="${spec.id}-hint-text"]`);

  const e = ctx.escapeHtml;
  const focusOn = (el) => (canFocus(el) ? el : fb).focus();
  const say = (cls, html) => {
    fb.className = `feedback ${cls} show`;
    fb.innerHTML = html;
  };
  const state = newBuildState(spec);
  const spanOf = (id) => applyState(spec, state).find((s) => s.spanId === id);
  const label = (id) => labelOf(spanOf(id), e);
  let selected = null;
  let lastFailed = null;
  let done = false;

  /** Redraw, then focus the control matching `selector` (falling back to the feedback). */
  function after(html, selector) {
    say('info', html);
    draw();
    focusOn(selector ? board.querySelector(selector) : null);
  }

  function editParent(value) {
    const parentId = value === 'none' ? null : value;
    const outcome = setParent(spec, state, selected, parentId);
    const me = label(selected);
    let text;
    if (outcome === 'self') text = `${me} can't be its own parent: that would make a loop.`;
    else if (outcome === 'cycle') text = `${label(parentId)} is already below ${me}, so that would make a loop.`;
    else text = parentId === null ? `${me} is now a root span.` : `${me} now has parent ${label(parentId)}.`;
    after(text, `[data-parent="${value}"]`);
  }

  function editKind(kind) {
    setKind(spec, state, selected, kind);
    after(`${label(selected)} is now ${e(kind)}.`, `[data-kind="${kind}"]`);
  }

  function editStatus(status) {
    setStatus(spec, state, selected, status);
    after(`${label(selected)} now has status ${e(status)}.`, `[data-status="${status}"]`);
  }

  function editLink(target) {
    const outcome = toggleLink(spec, state, selected, target);
    const text = outcome === 'linked'
      ? `${label(selected)} now links to ${label(target)}.`
      : `${label(selected)} no longer links to ${label(target)}.`;
    after(text, `[data-link="${target}"]`);
  }

  /** The graded fields only, so an edit undone compares equal. */
  const graded = () => JSON.stringify(applyState(spec, state).map((s) => spec.edit.map((f) => (f === 'parent' ? s.parentId : s[f]))));

  check.onclick = () => {
    if (check.disabled || done) return;
    const result = checkBuild(spec, state);
    if (result.ok) {
      done = true;
      check.disabled = true;
      if (hintBtn) hintBtn.disabled = true;
      say('good', 'Right. Every span checks out.');
      draw();
      focusOn(onComplete());
      return;
    }
    const key = graded();
    const same = key === lastFailed;
    if (!same) ctx.mistake();
    lastFailed = key;
    const n = plural(result.issues.length, 'problem', 'problems');
    const list = result.issues.map((i) => `<li>${e(i.message)}</li>`).join('');
    say('info', `<p>${same ? 'Same as last time' : 'Not yet'}: ${n}.</p><ul class="build-issues">${list}</ul>`);
    fb.focus();
  };

  if (hintBtn && hintText) {
    hintBtn.onclick = () => {
      if (hintBtn.disabled) return;
      ctx.hint();
      hintBtn.disabled = true;
      hintText.classList.add('show');
      hintText.innerHTML = spec.hint;
      hintText.focus();
    };
  }

  function draw() {
    board.innerHTML = boardHtml(spec, state, selected, done, e);
    for (const b of board.querySelectorAll('[data-span]')) {
      b.onclick = () => {
        selected = b.dataset.span;
        draw();
        focusOn(board.querySelector('[data-build-panel] button:not([disabled])'));
      };
    }
    const wire = (attr, key, fn) => {
      for (const b of board.querySelectorAll(`[${attr}]`)) {
        b.onclick = () => {
          if (!b.disabled && !done) fn(b.dataset[key]);
        };
      }
    };
    wire('data-parent', 'parent', editParent);
    wire('data-kind', 'kind', editKind);
    wire('data-status', 'status', editStatus);
    wire('data-link', 'link', editLink);
  }

  draw();
  focusOn(board.querySelector('[data-span]'));
}
