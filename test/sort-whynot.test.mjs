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
