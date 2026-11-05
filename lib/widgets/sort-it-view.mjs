// Sort it widget view (docs/M1-DESIGN.md §4.1): markup for a SortSpec and SortState, and
// mountSort, the only home of "a wrong placement costs one mistake; repeating it is free"
// (I1). Everything is built from the UI kit (lib/ui, #158) off ONE typed contract,
// `sortView(spec, state, ui)`: the templates only render it, and the grading stays in
// lib/widgets/sort-it.mjs (`place` grades, `bucketOf` reads an answer). Item and bucket
// labels, `why` and `whyNot` are trusted authored HTML; ids are escaped. Drag and drop is an
// enhancement over tap-to-place and takes the same path. DOM-free at import time.

import { escapeHtml as escape } from '../lesson-kit.mjs';
import { canFocus } from './focus.mjs';
import { mountSide } from './help-ladder.mjs';
import { SORT_HELPS, hintFor, hintLadder, hintTarget, sortHelps } from './sort-it-help.mjs';
import { bucketOf, isComplete, newSortState, place, remaining, untried, validateSortSpec } from './sort-it.mjs';
import { playSwirl } from '../swirl-render.mjs';
import { MAX_STARS } from '../scoring.mjs';
import { dots, eyebrow, feedback, helpChips, option, options, panel, setFeedback, sideColumn, split, stats } from '../ui/index.mjs';

const TOKEN = /^[A-Za-z][\w-]*$/;

// The one instruction line, the same on every Sort it step. Plain text.
const INSTR = 'Drag each item into the right bucket, or pick an item and then a bucket.';

/** The score card's rule: Sort it has wrong placements and hints. */
export const RULE =
  'Stars count this board only: a wrong placement, a hint. ' +
  '0 penalties give 5 stars, 1 gives 4, 2 gives 3, 3 or 4 give 2, more give 1. Retrying is free.';

/** `list` (entries with an id) in the order of `ids`; entries `ids` omits keep their order, last. */
function inOrder(list, ids) {
  if (!Array.isArray(ids) || ids.length === 0) return list;
  const at = (e) => {
    const i = ids.indexOf(e.id);
    return i === -1 ? ids.length : i;
  };
  return list.map((e, i) => [e, i]).sort((a, b) => at(a[0]) - at(b[0]) || a[1] - b[1]).map(([e]) => e);
}

/**
 * The display order of the pool, shuffled ONCE per mount through `ctx.shuffle` (the seam
 * Choice and the incident board use) so the authored order never groups the answers. Returns
 * the item ids; authored order when ctx has no shuffle.
 */
export function sortOrder(ctx, spec) {
  return (typeof ctx?.shuffle === 'function' ? ctx.shuffle(spec.items) : [...spec.items]).map((it) => it.id);
}

/**
 * The typed view of Sort it `spec` in `state` (the templates render exactly this):
 *   {id, total, left, done, pool, buckets}
 *   pool    [{id, labelHtml, pressed, hinted}]  remaining items in `order` (ids; spec order if absent)
 *   buckets [{id, labelHtml, enabled, hinted, placed: [{id, labelHtml}]}]  in spec order; enabled
 *           only for the `selected` item and a bucket not yet tried for it; placed in spec order
 * `hinted` is a list of item and bucket ids to flag. Invariant: placed plus left equals total.
 */
export function sortView(spec, state, { order = null, selected = null, hinted = [] } = {}) {
  const left = remaining(spec, state);
  const hint = new Set(hinted);
  const open = left.includes(selected) ? untried(spec, state, selected) : [];
  const pool = inOrder(spec.items, order)
    .filter((it) => left.includes(it.id))
    .map((it) => ({ id: it.id, labelHtml: it.label, pressed: it.id === selected, hinted: hint.has(it.id) }));
  const buckets = spec.buckets.map((b) => ({
    id: b.id,
    labelHtml: b.label,
    enabled: open.includes(b.id),
    hinted: hint.has(b.id),
    placed: spec.items
      .filter((it) => !left.includes(it.id) && bucketOf(spec, it.id) === b.id)
      .map((it) => ({ id: it.id, labelHtml: it.label })),
  }));
  return { id: spec.id, total: spec.items.length, left: left.length, done: left.length === 0, pool, buckets };
}

function poolHtml(v) {
  const itemsHtml = v.pool
    .map((p) => option({ attr: 'item', value: p.id, labelHtml: p.labelHtml, kind: 'toggle', pressed: p.pressed, hinted: p.hinted }))
    .join('');
  return (
    `<div role="group" aria-label="Items to sort" aria-describedby="${escape(v.id)}-instr">` +
    options({ layout: 'wrap', itemsHtml }) +
    `</div>`
  );
}

function bucketsHtml(v) {
  const cells = v.buckets
    .map((b) => {
      const list = b.placed.map((it) => `<li>${it.labelHtml}</li>`).join('');
      const head = option({ attr: 'bucket', value: b.id, labelHtml: b.labelHtml, kind: 'choice', disabled: !b.enabled, hinted: b.hinted });
      return (
        `<div data-drop="${escape(b.id)}">` +
        panel({ variant: 'drop', sections: [`${head}<ul class="sort-placed" data-bucket-list="${escape(b.id)}">${list}</ul>`] }) +
        `</div>`
      );
    })
    .join('');
  return `<div class="sort-buckets">${cells}</div>`;
}

const metaHtml = (v) => stats([{ label: 'Sorted', value: `${v.total - v.left} of ${v.total}` }]);

/**
 * Markup for Sort it `spec` in `state` inside a wide step (a kit split: the board, then the
 * side column). Options: `selected` (an item id, pressed), `order` (item ids, the pool's
 * display order; mountSort shuffles its own), `escapeHtml`, and `labelledBy` (a plain token;
 * TypeError otherwise) which makes the widget a labelled group. Regions the mount redraws are
 * `[data-region]` (`meta`, `pool`, `buckets`); `[data-item]` are the toggle options,
 * `[data-bucket]` the bucket buttons inside their `[data-drop]` panels, `[data-bucket-list]`
 * the placed items; `#<id>-instr` is the plain-text instruction, `#<id>-feedback` the kit
 * feedback region.
 */
export function renderSort(spec, state, { selected = null, order = null, escapeHtml: e = escape, labelledBy } = {}) {
  if (labelledBy !== undefined && !(typeof labelledBy === 'string' && TOKEN.test(labelledBy))) {
    throw new TypeError(`sort "${String(spec?.id)}": labelledBy must be a plain token`);
  }
  const group = labelledBy === undefined ? '' : ` role="group" aria-labelledby="${e(labelledBy)}"`;
  const v = sortView(spec, state, { order, selected });
  const chips = helpChips(spec.id, [
    { key: 'instant', label: 'Instant feedback', on: true },
    ...SORT_HELPS.map(([key, label]) => ({ key, label, on: sortHelps(spec)[key] })),
  ]);
  const board = panel({
    sections: [
      `<p class="sort-instr" id="${e(spec.id)}-instr">${INSTR}</p>`,
      `<div data-region="meta">${metaHtml(v)}</div>`,
      `<div data-region="pool">${poolHtml(v)}</div>`,
      `<div data-region="buckets">${bucketsHtml(v)}</div>` +
        feedback({ id: `${spec.id}-feedback` }),
    ],
  });
  const side = sideColumn({ id: spec.id, titleHtml: 'All sorted', counts: [{ key: 'wrong', label: '' }], hints: sortHelps(spec).hints, ruleHtml: RULE });
  return `<div data-sort="${e(spec.id)}"${group}>${split({ mainHtml: `${chips}${board}`, sideHtml: side })}</div>`;
}

/** The first of `allowed` after `from` in `order`, wrapping around; undefined if none. */
function nextAfter(order, from, allowed) {
  const i = order.indexOf(from);
  return [...order.slice(i + 1), ...order.slice(0, i + 1)].find((x) => allowed.includes(x));
}

/**
 * Wire Sort it `spec` (rendered by renderSort into ctx.ovBody) from a fresh state and focus
 * its first item. The pool order is shuffled once through ctx.shuffle. Tap an item, then a
 * bucket; dropping an item on a bucket does the same. A wrong bucket: ctx.mistake() and the
 * score card's tally together, an error "Not quite. <label> is not <bucket>. <whyNot>", the
 * bucket disabled for that item, focus to its next untried bucket. Trying it again is free
 * (neutral). A right bucket: a success "Right. <label> goes in <bucket>. <why>", the item
 * listed in the bucket, focus to the next remaining item; after the last one onComplete() is
 * called once, the success card shows (swirl once, `swirl` replaces it in tests) and its
 * heading takes focus. A bucket with no item: a neutral "Pick an item first." Nothing counts
 * after the last item. With `helps.hints` each Hint click is one ctx.hint() and one hint on the
 * score card: tier 1 the rule (once per board), tier 2 two outlined buckets (only while the item has 3 or more
 * untried buckets; reselecting the item redraws them), tier 3 places the item through `place`
 * (never a mistake; neutral "Placed for you."); it works on the selected item, else the first
 * remaining one.
 * Throws TypeError (naming the spec id) for an invalid spec, a missing
 * onComplete, or a spec that is not rendered.
 */
export function mountSort(ctx, spec, { onComplete, swirl = playSwirl } = {}) {
  const problems = validateSortSpec(spec);
  const fail = (msg) => {
    throw new TypeError(`sort "${String(spec?.id)}": ${msg}`);
  };
  if (problems.length) fail(`invalid spec: ${problems.join('; ')}`);
  if (typeof onComplete !== 'function') fail('onComplete must be a function');
  // Ids are kebab-case (validated above), so they are safe inside attribute selectors.
  const box = ctx.ovBody.querySelector(`[data-sort="${spec.id}"]`);
  const region = (name) => box?.querySelector(`[data-region="${name}"]`);
  const [metaEl, poolEl, bucketsEl] = ['meta', 'pool', 'buckets'].map(region);
  const fb = box?.querySelector(`[id="${spec.id}-feedback"]`);
  if (!metaEl || !poolEl || !bucketsEl || !fb || !box.querySelector(`[id="${spec.id}-win"]`)) {
    fail('not rendered (use renderSort with the same spec)');
  }

  const side = mountSide(ctx, box, spec.id, { swirl });
  const bucketIds = spec.buckets.map((b) => b.id);
  const itemOf = (id) => spec.items.find((it) => it.id === id);
  const bucketLabel = (id) => spec.buckets.find((b) => b.id === id).label;
  const itemBtn = (id) => (id === undefined ? null : poolEl.querySelector(`[data-item="${id}"]`));
  const bucketBtn = (id) => (id === undefined ? null : bucketsEl.querySelector(`[data-bucket="${id}"]`));
  const focusOn = (el) => (canFocus(el) ? el : fb).focus();
  const say = (tone, html) => setFeedback(fb, tone, html);

  let state = newSortState(spec);
  const tally = { wrong: 0 };
  let ui = { selected: null, order: sortOrder(ctx, spec), hinted: [] };
  let dragging = null;
  let done = false;
  let hintsUsed = 0;
  const taken = {}; // item id -> the tiers (2 and 3) given for it; tier 1 is board-wide
  let ruleShown = false; // tier 1 is charged once per board
  const flagged = {}; // item id -> the buckets its tier 2 hint outlined, until it is placed
  const hintBtn = box.querySelector(`[id="${spec.id}-hint"]`);

  // Outlines show only for the selected, still-remaining item, and only for buckets not yet tried.
  const outlined = () => {
    if (ui.selected === null) return [];
    const open = untried(spec, state, ui.selected);
    return (flagged[ui.selected] ?? []).filter((b) => open.includes(b));
  };
  const ladderOf = (key) => hintLadder(spec, state, key, { ruleShown, taken: taken[key] ?? [] });
  const view = () => sortView(spec, state, { ...ui, hinted: outlined() });

  /** The one place a penalty is paid: ctx.mistake() and the tally the score card shows. */
  function penalise() {
    ctx.mistake();
    tally.wrong += 1;
  }

  function drawSide() {
    return side.score({
      wrong: tally.wrong,
      wrongLabel: tally.wrong === 1 ? 'wrong placement' : 'wrong placements',
      hints: hintsUsed,
      done,
    });
  }

  function drawHint() {
    if (!hintBtn) return;
    const key = done ? null : hintTarget(spec, state, { order: ui.order, selected: ui.selected });
    const l = key === null ? null : ladderOf(key);
    const pips = l === null ? '' : dots({ total: l.tiers.length, on: l.done, decorative: true, tone: 'hint' });
    side.hintUi({
      label: l === null ? 'Hint' : l.next === null ? 'No more hints' : `Hint ${l.done + 1} of ${l.tiers.length}`,
      disabled: l === null || l.next === null,
      tierHtml: l === null ? 'Nothing to hint right now.' : `For ${itemOf(key).label}: ${l.done} of ${l.tiers.length} used ${pips}`,
    });
  }

  function select(itemId) {
    ui = { ...ui, selected: itemId };
    draw();
    focusOn(bucketBtn(untried(spec, state, itemId)[0]));
  }

  function put(itemId, bucketId, { hinted = false } = {}) {
    if (done) return;
    const item = itemOf(itemId);
    if (!item) {
      say('neutral', 'Pick an item first.');
      draw();
      focusOn(itemBtn(view().pool[0]?.id));
      return;
    }
    const label = bucketLabel(bucketId);
    const result = place(spec, state, itemId, bucketId);
    state = result.state;
    if (result.outcome === 'right') {
      ui = { ...ui, selected: null };
      delete flagged[itemId];
      // A hint placement is not earned: neutral, and the hint panel already says where and why.
      if (hinted) say('neutral', 'Placed for you.');
      else say('success', `Right. ${item.label} goes in ${label}. ${item.why}`);
      if (!isComplete(spec, state)) {
        draw();
        const shown = view().pool.map((p) => p.id);
        focusOn(itemBtn(nextAfter(ui.order, itemId, shown)));
        return;
      }
      done = true;
      draw();
      onComplete();
      const n = drawSide();
      side.succeed({
        line: `${n} of ${MAX_STARS} stars: ${tally.wrong} wrong placement${tally.wrong === 1 ? '' : 's'}, ${hintsUsed} hint${hintsUsed === 1 ? '' : 's'}.`,
      });
      return;
    }
    if (result.outcome !== 'wrong' && result.outcome !== 'repeat') return;
    ui = { ...ui, selected: itemId };
    if (result.outcome === 'wrong') {
      penalise();
      // Own keys only: a bucket id like "constructor" must not read Object.prototype.
      const not = Object.hasOwn(item.whyNot ?? {}, bucketId) ? item.whyNot[bucketId] : '';
      say('error', `Not quite. ${item.label} is not ${label}.${not ? ` ${not}` : ''}`);
    } else {
      say('neutral', `You already tried ${label} for ${item.label}.`);
    }
    draw();
    focusOn(bucketBtn(nextAfter(bucketIds, bucketId, untried(spec, state, itemId))));
  }

  function draw() {
    const v = view();
    metaEl.innerHTML = metaHtml(v);
    poolEl.innerHTML = poolHtml(v);
    bucketsEl.innerHTML = bucketsHtml(v);
    for (const b of poolEl.querySelectorAll('[data-item]')) {
      const id = b.dataset.item;
      b.setAttribute('draggable', 'true');
      b.onclick = () => {
        if (!b.disabled) select(id);
      };
      b.ondragstart = (ev) => {
        dragging = id;
        ev?.dataTransfer?.setData('text/plain', id);
      };
      b.ondragend = () => {
        dragging = null;
      };
    }
    for (const b of bucketsEl.querySelectorAll('[data-bucket]')) {
      b.onclick = () => {
        if (!b.disabled) put(ui.selected, b.dataset.bucket);
      };
    }
    // The drop target is the bucket's zone, not its button: a disabled button gets no events.
    for (const zone of bucketsEl.querySelectorAll('[data-drop]')) {
      zone.ondragover = (ev) => ev.preventDefault();
      zone.ondrop = (ev) => {
        ev.preventDefault();
        const id = dragging;
        dragging = null;
        put(id, zone.dataset.drop);
      };
    }
    drawSide();
    drawHint();
  }

  if (hintBtn) {
    hintBtn.onclick = () => {
      if (hintBtn.disabled || done) return;
      const key = hintTarget(spec, state, { order: ui.order, selected: ui.selected });
      if (key === null) return;
      const l = ladderOf(key);
      const t = l.next;
      if (t === null) return;
      if (t === 1) ruleShown = true;
      else taken[key] = [...(taken[key] ?? []), t];
      ctx.hint();
      hintsUsed += 1;
      const h = hintFor(spec, state, key, t, { shuffle: (list) => (typeof ctx.shuffle === 'function' ? ctx.shuffle(list) : list) });
      const html = `${eyebrow(`Hint ${l.done + 1} of ${l.tiers.length}`)}${h.html}`;
      if (t === 2) flagged[key] = h.cands;
      ui = { ...ui, selected: key };
      if (h.apply) put(key, h.apply.bucket, { hinted: true });
      else draw();
      if (done) {
        side.showHint(html, { focus: false });
        return;
      }
      side.showHint(html);
    };
  }

  draw();
  focusOn(itemBtn(view().pool[0]?.id));
}
