// Sort it widget view (docs/M1-DESIGN.md §4.1): markup for a SortSpec and SortState, and
// mountSort, the only home of "a wrong placement costs one mistake; repeating it is free"
// (I1). Item and bucket labels, `why` and `whyNot` are trusted authored HTML; ids are
// escaped. Drag and drop is an enhancement over tap-to-place and takes the same path.
// DOM-free at import time.

import { canFocus } from './focus.mjs';
import { isComplete, newSortState, place, remaining, untried, validateSortSpec } from './sort-it.mjs';

const TOKEN = /^[A-Za-z][\w-]*$/;

/** The pool of remaining items and the buckets with their placed items. */
function boardHtml(spec, state, selected, e) {
  const left = remaining(spec, state);
  const open = selected == null ? [] : untried(spec, state, selected);
  const pool = spec.items
    .filter((it) => left.includes(it.id))
    .map((it) => `<button class="sort-item" data-item="${e(it.id)}" aria-pressed="${it.id === selected}" draggable="true">${it.label}</button>`)
    .join('');
  const buckets = spec.buckets
    .map((b) => {
      const list = spec.items
        .filter((it) => it.bucket === b.id && !left.includes(it.id))
        .map((it) => `<li>${it.label}</li>`)
        .join('');
      const off = open.includes(b.id) ? '' : ' disabled';
      return (
        `<div class="sort-bucket" data-drop="${e(b.id)}">` +
        `<button class="sort-bucket-btn" data-bucket="${e(b.id)}"${off}>${b.label}</button>` +
        `<ul class="sort-placed" data-bucket-list="${e(b.id)}">${list}</ul></div>`
      );
    })
    .join('');
  return `<div class="sort-pool">${pool}</div><div class="sort-buckets">${buckets}</div>`;
}

/**
 * Markup for Sort it `spec` in `state`, with item `selected` (or null) pressed: item
 * buttons (`data-item`, `aria-pressed`, draggable), bucket buttons (`data-bucket`,
 * disabled unless untried for the selected item), `[data-bucket-list]` of placed items,
 * then the `#<id>-feedback` status region. With `labelledBy` (a plain token; TypeError
 * otherwise) the widget is a labelled group.
 */
export function renderSort(spec, state, { selected = null, escapeHtml: e, labelledBy } = {}) {
  if (labelledBy !== undefined && !(typeof labelledBy === 'string' && TOKEN.test(labelledBy))) {
    throw new TypeError(`sort "${String(spec?.id)}": labelledBy must be a plain token`);
  }
  const group = labelledBy === undefined ? '' : ` role="group" aria-labelledby="${e(labelledBy)}"`;
  return (
    `<div class="sort" data-sort="${e(spec.id)}"${group}>` +
    `<div class="sort-board" data-sort-board>${boardHtml(spec, state, selected, e)}</div>` +
    `<div class="feedback" id="${e(spec.id)}-feedback" role="status" aria-live="polite" tabindex="-1"></div>` +
    `</div>`
  );
}

/** The first of `allowed` after `from` in `order`, wrapping around; undefined if none. */
function nextAfter(order, from, allowed) {
  const i = order.indexOf(from);
  return [...order.slice(i + 1), ...order.slice(0, i + 1)].find((x) => allowed.includes(x));
}

/**
 * Wire Sort it `spec` (rendered by renderSort into ctx.ovBody) from a fresh state and
 * focus its first item. Tap an item, then a bucket; dropping an item on a bucket does
 * the same. A wrong bucket: ctx.mistake(), "Not quite. <label> is not <bucket>. <whyNot>",
 * the bucket disabled for that item, focus to its next untried bucket. Trying it again is
 * free. A right bucket: "Right. <label> goes in <bucket>. <why>", the item listed in the
 * bucket, focus to the next remaining item; after the last one onComplete() is called
 * once and its return is focused if it passes canFocus, else the feedback. A bucket with
 * no item: "Pick an item first." Throws TypeError (naming the spec id) for an invalid
 * spec, a missing onComplete, or a spec that is not rendered.
 */
export function mountSort(ctx, spec, { onComplete } = {}) {
  const problems = validateSortSpec(spec);
  const fail = (msg) => {
    throw new TypeError(`sort "${String(spec?.id)}": ${msg}`);
  };
  if (problems.length) fail(`invalid spec: ${problems.join('; ')}`);
  if (typeof onComplete !== 'function') fail('onComplete must be a function');
  // Ids are kebab-case (validated above), so they are safe inside attribute selectors.
  const box = ctx.ovBody.querySelector(`[data-sort="${spec.id}"]`);
  const board = box?.querySelector('[data-sort-board]');
  const fb = box?.querySelector(`[id="${spec.id}-feedback"]`);
  if (!board || !fb) fail('not rendered (use renderSort with the same spec)');

  const itemIds = spec.items.map((it) => it.id);
  const bucketIds = spec.buckets.map((b) => b.id);
  const itemOf = (id) => spec.items.find((it) => it.id === id);
  const bucketOf = (id) => spec.buckets.find((b) => b.id === id);
  const itemBtn = (id) => (id === undefined ? null : board.querySelector(`[data-item="${id}"]`));
  const bucketBtn = (id) => (id === undefined ? null : board.querySelector(`[data-bucket="${id}"]`));
  const focusOn = (el) => (canFocus(el) ? el : fb).focus();
  const say = (cls, html) => {
    fb.className = `feedback ${cls} show`;
    fb.innerHTML = html;
  };

  let state = newSortState(spec);
  let selected = null;
  let dragging = null;
  let done = false;

  function select(itemId) {
    selected = itemId;
    draw();
    focusOn(bucketBtn(untried(spec, state, itemId)[0]));
  }

  function put(itemId, bucketId) {
    const item = itemOf(itemId);
    if (!item) {
      say('info', 'Pick an item first.');
      draw();
      focusOn(itemBtn(remaining(spec, state)[0]));
      return;
    }
    const bucket = bucketOf(bucketId);
    const result = place(spec, state, itemId, bucketId);
    state = result.state;
    if (result.outcome === 'right') {
      selected = null;
      say('good', `Right. ${item.label} goes in ${bucket.label}. ${item.why}`);
      draw();
      if (!isComplete(spec, state)) {
        focusOn(itemBtn(nextAfter(itemIds, itemId, remaining(spec, state))));
      } else if (!done) {
        done = true;
        focusOn(onComplete());
      }
      return;
    }
    selected = itemId;
    if (result.outcome === 'wrong') {
      ctx.mistake();
      // Own keys only: a bucket id like "constructor" must not read Object.prototype.
      const not = Object.hasOwn(item.whyNot ?? {}, bucketId) ? item.whyNot[bucketId] : '';
      say('info', `Not quite. ${item.label} is not ${bucket.label}.${not ? ` ${not}` : ''}`);
    } else {
      // 'repeat' (free). 'placed' and 'unknown' cannot come from the rendered controls:
      // placed items leave the pool and every bucket id comes from the spec.
      say('info', `You already tried ${bucket.label} for ${item.label}.`);
    }
    draw();
    focusOn(bucketBtn(nextAfter(bucketIds, bucketId, untried(spec, state, itemId))));
  }

  function draw() {
    board.innerHTML = boardHtml(spec, state, selected, ctx.escapeHtml);
    for (const b of board.querySelectorAll('[data-item]')) {
      const id = b.dataset.item;
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
    for (const b of board.querySelectorAll('[data-bucket]')) {
      b.onclick = () => {
        if (!b.disabled) put(selected, b.dataset.bucket);
      };
    }
    // The drop target is the bucket's zone, not its button: a disabled button gets no events.
    for (const zone of board.querySelectorAll('[data-drop]')) {
      zone.ondragover = (ev) => ev.preventDefault();
      zone.ondrop = (ev) => {
        ev.preventDefault();
        const id = dragging;
        dragging = null;
        put(id, zone.dataset.drop);
      };
    }
  }

  draw();
  focusOn(itemBtn(remaining(spec, state)[0]));
}
