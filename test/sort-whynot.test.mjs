// Every Sort it item explains a wrong drop (#343): a reason for each bucket other than its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACTS } from '../levels/index.mjs';

test('every Sort item has a whyNot for every other bucket, in every level', async () => {
  const gaps = [];
  let sorts = 0;
  for (const act of ACTS) {
    for (const level of [...act.levels, ...(act.boss ? [act.boss] : [])]) {
      const mod = await import(`../levels/${level.id}.mjs`);
      const steps = mod.CONTENT?.steps ?? mod.default.play?.steps ?? [];
      for (const s of steps) {
        if (!s.sort) continue;
        sorts += 1;
        for (const item of s.sort.items) {
          for (const b of s.sort.buckets) {
            if (b.id === item.bucket) continue;
            const text = item.whyNot?.[b.id];
            if (typeof text !== 'string' || text.trim() === '') gaps.push(`${level.id} ${item.id} -> ${b.id}`);
          }
        }
      }
    }
  }
  assert.ok(sorts > 10, 'found the Sort steps');
  assert.deepEqual(gaps, [], `missing whyNot:\n${gaps.join('\n')}`);
});

// A reason must not hand over the right bucket: on boards with three or more buckets, no reason may
// contain a distinctive word of the right bucket's label (its name, before any colon). Words that
// the item's own label already shows are fine, since the player reads them anyway. Limited to the
// boards fixed in #343; the distributions and filter-or-sampler boards use words like core and filter
// in both labels and prose and are a separate cleanup.
const plain = (html) => html.replace(/<[^>]+>/g, ' ');
const STOP = new Set('the and for are not with from that this into over only each such'.split(' '));
const stems = (text) =>
  new Set(
    (plain(text).toLowerCase().match(/[a-z]+/g) ?? []).filter((w) => w.length > 2 && !STOP.has(w)).map((w) => w.slice(0, 5)),
  );

const CHECKED = new Set(['monitoring-vs-observability', 'the-signals', 'why-opentelemetry', 'status-and-errors', 'baggage', 'auto-vs-manual', 'instruments', 'structured-logs', 'migrating-vendors']);

test('on boards with three or more buckets, no reason names the right bucket', async () => {
  const leaks = [];
  for (const act of ACTS) {
    for (const level of [...act.levels, ...(act.boss ? [act.boss] : [])]) {
      if (!CHECKED.has(level.id)) continue;
      const mod = await import(`../levels/${level.id}.mjs`);
      const steps = mod.CONTENT?.steps ?? mod.default.play?.steps ?? [];
      for (const s of steps) {
        if (!s.sort || s.sort.buckets.length < 3) continue;
        for (const item of s.sort.items) {
          const right = s.sort.buckets.find((b) => b.id === item.bucket);
          const name = stems(right.label.split(':')[0]);
          const shown = stems(item.label);
          for (const [bucket, text] of Object.entries(item.whyNot ?? {})) {
            const hit = [...stems(text)].filter((w) => name.has(w) && !shown.has(w));
            if (hit.length) leaks.push(`${level.id} ${item.id} -> ${bucket}: ${hit.join(',')}`);
          }
        }
      }
    }
  }
  assert.deepEqual(leaks, [], `reasons that name the right bucket:\n${leaks.join('\n')}`);
});
