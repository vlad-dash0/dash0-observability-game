// Reward copy: a long closing text keeps the story and the Dash0 how-to in separate short
// paragraphs (a blank line between them), so the reward card never shows one long block (#321).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACTS } from '../levels/index.mjs';

const LONG = 300; // characters of a closing text that must be split
const MOST_IN_A_PARAGRAPH = 420;

async function finishes() {
  const out = [];
  for (const act of ACTS) {
    for (const level of [...act.levels, ...(act.boss ? [act.boss] : [])]) {
      const mod = await import(`../levels/${level.id}.mjs`);
      const text = mod.default.play?.finish;
      if (typeof text === 'string') out.push({ id: level.id, text });
    }
  }
  return out;
}

test('a closing text that mixes the story with Dash0 how-to is two paragraphs, none of them a wall', async () => {
  const bad = {};
  for (const { id, text } of await finishes()) {
    const paras = text.split(/\n\s*\n/);
    if (text.length > LONG && /Dash0/.test(text) && paras.length < 2) bad[id] = 'one block that names Dash0';
    if (paras.some((p) => p.length > MOST_IN_A_PARAGRAPH)) bad[id] = `a paragraph over ${MOST_IN_A_PARAGRAPH} characters`;
    if (paras.length > 1) assert.equal(/^In Dash0|^Dash0|^When the move is to Dash0/.test(paras[paras.length - 1]), true, `${id}: the how-to is the last paragraph`);
  }
  assert.deepEqual(bad, {});
});

test('a reward text is plain text: the card sets it with x-text, so an HTML entity would show literally', async () => {
  const { CONTENT } = await import('../levels/the-pager.mjs');
  const texts = [...(await finishes()), { id: 'the-pager', text: CONTENT.reward }];
  const bad = texts.filter(({ text }) => /&(amp|lt|gt|quot|apos|#\d+);/.test(text)).map((t) => t.id);
  assert.deepEqual(bad, []);
  assert.equal(texts.length > 40, true, 'every play level with a closing text was checked; run levels are checked in levels-play.test.mjs');
});
