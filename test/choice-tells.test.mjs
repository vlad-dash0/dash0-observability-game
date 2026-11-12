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

// Code formatting is read off the raw label, before plain() strips the tags.
const CODE = /<code>|`/;
const TAIL = /\bso\b|\b(because|since)\b/i;
const maxOf = (labels) => Math.max(...labels.map((x) => x.length));

// Each strategy (given the plain labels, then the raw ones) marks the options it would pick and picks one of them at random (all, when it marks none).
const STRATEGIES = {
  longest: (labels) => labels.map((l) => l.length === maxOf(labels)),
  shortest: (labels) => labels.map((l) => l.length === Math.min(...labels.map((x) => x.length))),
  // The middle length: neither the longest nor the shortest option (a two-option question has none, so every option is marked).
  middle: (labels) => {
    const [lo, hi] = [Math.min(...labels.map((x) => x.length)), maxOf(labels)];
    return labels.map((l) => l.length > lo && l.length < hi);
  },
  // The options whose label has code formatting (<code> or backticks); all of them, when none or all are marked.
  code: (_labels, raw) => raw.map((l) => CODE.test(l)),
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
    let m = mark(labels, q.choices.map((c) => c.label));
    if (!m.some(Boolean)) m = m.map(() => true);
    const right = q.choices.findIndex((c) => c.right);
    return sum + (m[right] ? 1 / m.filter(Boolean).length : 0);
  }, 0);

const BAND = 3; // points a blind rule may sit above or below chance: a rule far below is the same tell, read backwards

test('no blind option-shape rule strays from chance by more than a few points, either way', async () => {
  const qs = await allQuestions();
  assert.ok(qs.length >= 77, `found ${qs.length} questions`);
  const chance = qs.reduce((s, q) => s + 1 / q.choices.length, 0);
  const off = Object.entries(STRATEGIES)
    .map(([name, mark]) => [name, score(qs, mark)])
    .filter(([, got]) => Math.abs(got - chance) > BAND)
    .map(([name, got]) => `${name}: ${got.toFixed(1)} of ${qs.length} first try (chance ${chance.toFixed(1)}, band ${(chance - BAND).toFixed(1)} to ${(chance + BAND).toFixed(1)})`);
  if (process.env.TELLS) for (const [name, mark] of Object.entries(STRATEGIES)) console.log(`TELLS ${name} ${score(qs, mark).toFixed(1)} of ${qs.length} (chance ${chance.toFixed(1)})`);
  assert.deepEqual(off, []);
});

test('the right option is not concentrated at one length rank: shortest, middle and longest each hold at most 45% of the three-option questions', async () => {
  const qs = (await allQuestions()).filter((q) => q.choices.length === 3);
  const rank = { shortest: 0, middle: 0, longest: 0 };
  for (const q of qs) {
    const lens = q.choices.map((c) => plain(c.label).length);
    const mine = lens[q.choices.findIndex((c) => c.right)];
    if (mine <= Math.min(...lens)) rank.shortest++;
    else if (mine >= Math.max(...lens)) rank.longest++;
    else rank.middle++;
  }
  if (process.env.TELLS) console.log(`TELLS ranks ${JSON.stringify(rank)} of ${qs.length}`);
  for (const [name, n] of Object.entries(rank)) assert.ok(n <= 0.45 * qs.length, `${name}: ${n} of ${qs.length} three-option questions`);
});

test('the scorer has teeth: a question whose right option is the longest and has no tail is caught', () => {
  const qs = [{ choices: [{ label: 'a' }, { label: 'b' }, { label: 'a much longer right option', right: true }] }];
  assert.equal(score(qs, STRATEGIES.longest), 1);
  assert.equal(score(qs, STRATEGIES.longestNoTail), 1);
});
