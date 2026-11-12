// Blind strategies must not pick the right answer of a multiple-choice question much more often
// than chance (the choice twin of test/sort-tells.test.mjs). Each rule ignores what the options
// mean and uses only how they look: the longest, the shortest, the one without a "so ..." or
// "because ..." tail. Questions come from the live registry and from the answer tables the
// hand-written levels export in CONTENT, so a level that passes its options to choiceHtml from a
// module-level array is covered too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACTS } from '../levels/index.mjs';

const plain = (html) => String(html).replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, ' ');
const isQuestion = (v) =>
  Array.isArray(v) && v.length >= 2 && v.every((c) => c && typeof c === 'object' && typeof c.label === 'string') && v.filter((c) => c.right).length === 1;

/** Every choice question as { level, choices }: any array of labelled options with exactly one right one. */
async function allQuestions() {
  const out = [];
  const seen = new Set();
  for (const act of ACTS) {
    for (const level of [...act.levels, ...(act.boss ? [act.boss] : [])]) {
      const mod = await import(`../levels/${level.id}.mjs`);
      const walk = (o) => {
        if (!o || typeof o !== 'object' || seen.has(o)) return;
        seen.add(o);
        for (const [k, v] of Object.entries(o)) {
          if (k === 'choices' && isQuestion(v)) {
            const key = `${level.id}|${v.map((c) => c.label).join('|')}`; // the registry holds frozen copies of CONTENT
            if (!seen.has(key)) out.push({ level: level.id, choices: v });
            seen.add(key);
          }
          else walk(v);
        }
      };
      walk(mod.CONTENT);
      walk(mod.default.play);
    }
  }
  return out;
}

const TAIL = /\bso\b|\b(because|since)\b/i;
const maxOf = (labels) => Math.max(...labels.map((x) => x.length));

// Each strategy marks the options it would pick and picks one of them at random (all, when it marks none).
const STRATEGIES = {
  longest: (labels) => labels.map((l) => l.length === maxOf(labels)),
  shortest: (labels) => labels.map((l) => l.length === Math.min(...labels.map((x) => x.length))),
  noTail: (labels) => labels.map((l) => !TAIL.test(l)),
  longestNoTail: (labels) => {
    const ok = labels.map((l) => !TAIL.test(l));
    const pool = ok.some(Boolean) ? ok : ok.map(() => true);
    const top = Math.max(...labels.map((l, i) => (pool[i] ? l.length : -1)));
    return labels.map((l, i) => pool[i] && l.length === top);
  },
};

/** Expected first-try score of a strategy over the questions. */
const score = (qs, mark) =>
  qs.reduce((sum, q) => {
    const labels = q.choices.map((c) => plain(c.label));
    let m = mark(labels);
    if (!m.some(Boolean)) m = m.map(() => true);
    const right = q.choices.findIndex((c) => c.right);
    return sum + (m[right] ? 1 / m.filter(Boolean).length : 0);
  }, 0);

const CAP_OVER_CHANCE = 3; // points above chance a blind rule may reach

test('no blind option-shape rule beats chance by more than a few points', async () => {
  const qs = await allQuestions();
  assert.ok(qs.length >= 77, `found ${qs.length} questions`);
  const chance = qs.reduce((s, q) => s + 1 / q.choices.length, 0);
  const over = Object.entries(STRATEGIES)
    .map(([name, mark]) => [name, score(qs, mark)])
    .filter(([, got]) => got > chance + CAP_OVER_CHANCE)
    .map(([name, got]) => `${name}: ${got.toFixed(1)} of ${qs.length} first try (chance ${chance.toFixed(1)}, cap ${(chance + CAP_OVER_CHANCE).toFixed(1)})`);
  if (process.env.TELLS) for (const [name, mark] of Object.entries(STRATEGIES)) console.log(`TELLS ${name} ${score(qs, mark).toFixed(1)} of ${qs.length} (chance ${chance.toFixed(1)})`);
  assert.deepEqual(over, []);
});

test('the scorer has teeth: a question whose right option is the longest and has no tail is caught', () => {
  const qs = [{ choices: [{ label: 'a' }, { label: 'b' }, { label: 'a much longer right option', right: true }] }];
  assert.equal(score(qs, STRATEGIES.longest), 1);
  assert.equal(score(qs, STRATEGIES.longestNoTail), 1);
});
