// Level 8.1 "Dashboards as code" beyond the generated play-through (test/play.test.mjs, test/answers.test.mjs, test/spot-tells.test.mjs,
// test/spot-ladder.test.mjs): level fields and the globe; the Spot it board of twelve added lines read by an independent oracle (the
// namespaces the operator watches, the grid arithmetic on a 24-column grid, the panels the file defines); surface rules played through the real checkSpot; the
// Choice (a team with no cluster); the sources and what the copy does not claim. Asserts strings, numbers and booleans only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { liveRegistry } from '../app.mjs';
import { DECK } from '../cards/deck.mjs';
import { ACT_REGIONS, COUNTRY_NAMES, LEVEL_COUNTRY } from '../hub/globe-map.mjs';
import { freshlyLit, litText } from '../lib/globe-ignite.mjs';
import { emptyProgress } from '../lib/progress.mjs';
import { checkSpot, newSpotState, toggleLine, validateSpotSpec } from '../lib/widgets/spot-it.mjs';
import { validateSpotHelps } from '../lib/widgets/spot-it-help.mjs';
import { load } from '../vendor/js-yaml-5.5.0.mjs';

const ID = 'dashboards-as-code';
const LIVE = liveRegistry();
const SRC = readFileSync(new URL(`../levels/${ID}.mjs`, import.meta.url), 'utf8');
const plain = (html) => html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&');
const level = LIVE.levels[ID];
const [SPOT_STEP, DEPLOY_STEP] = level.play.steps;
const spec = SPOT_STEP.spot;
const choices = DEPLOY_STEP.choice.choices;
const layout = (s) => s.lines.map((l) => (s.faults.includes(l.id) ? 'F' : '.')).join('');
const spotRun = (ids) => {
  let state = newSpotState(spec);
  for (const id of ids) state = toggleLine(spec, state, id).state;
  return checkSpot(spec, state);
};
const progressOf = (ids) => {
  const p = emptyProgress();
  for (const id of ids) p.levels[id] = { stars: 3, at: null };
  return p;
};

test('8.1 fields: first level of act-8, scored with no par time, a spot then a choice, lights checkout, awards no card', () => {
  assert.deepEqual(
    { no: level.no, name: level.name, sub: level.sub, icon: level.icon, rewardTitle: level.rewardTitle, kind: level.kind, actId: level.actId, parMs: level.scoring.parMs, prefix: level.play.prefix },
    { no: '8.1', name: 'Dashboards as code', sub: 'Review it before it is live', icon: '\u{1F4CA}', rewardTitle: 'Dashboard reviewer', kind: 'level', actId: 'act-8', parMs: null, prefix: 'dac' },
  );
  assert.deepEqual([...level.mechanics], ['spot'], 'derived from the steps: choice is not a mechanic');
  assert.deepEqual([...level.hintless], ['spot']);
  assert.deepEqual(level.play.steps.map((s) => ['spot', 'choice'].find((k) => s[k])), ['spot', 'choice']);
  assert.deepEqual([...level.lights], ['checkout']);
  assert.deepEqual([...level.cards], []);
  assert.equal(Object.values(LIVE.levels).filter((l) => l.rewardTitle === 'Dashboard reviewer').length, 1, 'the reward title is unique');
  assert.equal(LIVE.acts.find((a) => a.id === 'act-8').levelIds[0], ID);
  assert.equal(LIVE.order[LIVE.order.indexOf('everything-is-green') + 1], ID, '8.1 plays right after the act-7 boss');
});

test('card 19 (flush-on-shutdown) is not awarded here: no card on this level, and none in the deck yet', () => {
  assert.deepEqual([...level.cards], []);
  assert.equal(DECK.some((c) => c.id === 'flush-on-shutdown'), false, 'one level awards it, decided on #137 and recorded on #27');
});

test('globe: 8.1 lights Indonesia, and Southeast Asia stays open', () => {
  assert.equal(LEVEL_COUNTRY[ID], 'IDN');
  assert.equal(COUNTRY_NAMES.IDN, 'Indonesia');
  const map = { ACT_REGIONS, LEVEL_COUNTRY, COUNTRY_NAMES };
  const fresh = freshlyLit(emptyProgress(), progressOf([ID]), LIVE, map);
  assert.deepEqual(fresh, { countryIds: ['IDN'], regionIds: [] });
  assert.equal(litText(fresh, level, map), 'Indonesia is now lit: Dashboards as code.');
});

// ---- step 1: Spot it ----------------------------------------------------------------------

const DOCS_KEYS = new Set([
  // Every key of the Dash0 "Manage Dashboards as Code" example that the board uses, transcribed from that page.
  'apiVersion', 'kind', 'metadata', 'name', 'namespace', 'spec', 'display', 'datasources', 'default', 'plugin', 'layouts', 'items',
  'x', 'y', 'width', 'height', 'content', '$ref', 'panels', 'queries', 'query',
]);
const NAMED = new Set(['checkout-overview', 'request_rate', 'error_ratio', 'latency_p99']); // the game's own names under `panels` and in metadata

/** A board line read as YAML: `{path, value}`; a bare flow mapping has an empty path. Queries stay text. */
function readLine(text) {
  const body = text.replace(/^\+ /, '');
  if (body.startsWith('{')) return { path: '', value: load(body) };
  const at = body.indexOf(': ');
  const path = body.slice(0, at);
  const raw = body.slice(at + 2);
  return { path, value: path.endsWith('.query') ? raw : load(raw) };
}
const segments = (path) => path.split('.').filter(Boolean).map((p) => p.replace(/\[\d+\]$/, '')).filter(Boolean);
const keysOf = (v) => (v !== null && typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => [k, ...keysOf(x)]) : []);

test('step 1: a valid config board of twelve added lines, hints off, faults on the metadata line and two layout items among four', () => {
  assert.equal(SPOT_STEP.qid, 'dac-q-spot');
  assert.equal(spec.id, 'dac-spot');
  assert.equal(spec.target, 'config');
  assert.deepEqual(validateSpotSpec(spec), []);
  assert.deepEqual(validateSpotHelps(spec), []);
  assert.deepEqual(spec.helps, { hints: false });
  assert.equal(Object.hasOwn(spec, 'hint'), false, 'no authored hint (hints off)');
  assert.deepEqual(spec.faults, ['metadata', 'item-errors', 'item-latency']);
  assert.equal(layout(spec), '.F..' + '.FF.' + '....');
  assert.equal(spec.lines.length, 12);
  for (const l of spec.lines) assert.match(l.text, /^\+ /, `${l.id} is an added line`);
  assert.equal(spotRun(spec.faults).state.solved, true, 'the three faults solve it');
  assert.equal(spotRun(['metadata', 'item-errors']).state.solved, false, 'two of three do not');
  assert.equal(spotRun([...spec.faults, 'item-rate']).state.solved, false, 'the first item picked too does not');
  assert.equal(plain(SPOT_STEP.question), 'Which lines would you stop in review?');
});

test('step 1: every field on the board is one the Dash0 example shows, and the lines are valid YAML', () => {
  for (const l of spec.lines) {
    const { path, value } = readLine(l.text);
    for (const key of [...segments(path), ...keysOf(value)]) {
      assert.equal(DOCS_KEYS.has(key) || NAMED.has(key), true, `${l.id}: ${key} is a field of the Dash0 example or a name the game gives`);
    }
  }
  const header = readLine(spec.lines.find((l) => l.id === 'header').text).value;
  assert.deepEqual(header, { apiVersion: 'perses.dev/v1alpha1', kind: 'PersesDashboard' }, 'as in the Dash0 example');
  const ds = readLine(spec.lines.find((l) => l.id === 'datasource').text).value;
  assert.deepEqual(ds, { name: 'default', plugin: { kind: 'PrometheusDataSource' } });
  for (const id of ['panel-rate', 'panel-errors']) {
    const v = readLine(spec.lines.find((l) => l.id === id).text).value;
    assert.deepEqual([v.kind, v.spec.plugin.kind], ['Panel', 'TimeSeriesChart']);
  }
});

test('step 1 oracle: an independent reading of the diff flags exactly the faults', () => {
  const WATCHED = ['checkout', 'payments']; // the monitoring resources the intro names
  const found = [];
  const items = [];
  const defined = new Set();
  const refs = [];
  for (const l of spec.lines) {
    const { path, value } = readLine(l.text);
    if (path === 'metadata' && !WATCHED.includes(value.namespace)) found.push(l.id);
    const item = /^spec\.layouts\[0\]\.spec\.items\[(\d)\]$/.exec(path);
    if (item) {
      items.push({ id: l.id, ...value });
      refs.push({ id: l.id, panel: value.content.$ref.replace('#/spec/panels/', '') });
    }
    const panel = /^spec\.panels\.(\w+)$/.exec(path);
    if (panel) defined.add(panel[1]);
  }
  // Reading the fields as cells on a 24-column grid, an item does not fit when x + width is more than 24.
  const GRID = 24;
  const crossing = new Set(items.filter((it) => it.x + it.width > GRID).map((it) => it.id));
  found.push(...crossing);
  found.push(...refs.filter((r) => !defined.has(r.panel)).map((r) => r.id));
  assert.deepEqual([...new Set(found)].sort(), [...spec.faults].sort());
  // The numbers the explanation quotes: the second item starts at 18 and is 12 wide, so it ends at column 30 of 24; the fourth ends at 24.
  const [first, second, third, fourth] = items;
  assert.deepEqual([second.x, second.width, second.x + second.width], [18, 12, 30]);
  assert.deepEqual([first.x + first.width, third.y, fourth.x, fourth.x + fourth.width, fourth.y], [12, 6, 12, 24, 6]);
  assert.equal(items.filter((it) => it.x + it.width > GRID).length, 1, 'one item runs past the grid, so the fault is one line');
  assert.equal(items.length, 4);
  assert.deepEqual([...defined].sort(), ['error_ratio', 'request_rate']);
});

test('step 1: the two non-fault layout items and the two panels are honest decoys, so no keyword or position picks the faults', () => {
  const textOf = (id) => spec.lines.find((l) => l.id === id).text;
  // Surface rules, each played through the real checkSpot: pick the top k = 3 lines by the rule; none may solve the board on the first Check.
  const k = spec.faults.length;
  const rules = {
    'lines with $ref': (l) => (l.text.includes('$ref') ? 1 : 0),
    'lines with x: or width:': (l) => (/\b(x|width):/.test(l.text) ? 1 : 0),
    'lines with a number': (l) => (l.text.match(/\d/g) ?? []).length,
    'the longest lines': (l) => l.text.length,
    'the shortest lines': (l) => -l.text.length,
    'lines with fewest = signs': (l) => -(l.text.match(/=/g) ?? []).length,
    'lines with a path': (l) => (l.text.match(/\./g) ?? []).length,
    'lines about a panel': (l) => (/panel/i.test(l.text) ? 1 : 0),
    'lines with names the game made up': (l) => (/tools|latency_p99|error_ratio|request_rate/.test(l.text) ? 1 : 0),
    'lines with a v1alpha1 or default look': (l) => (/alpha|default/.test(l.text) ? 1 : 0),
    'metadata and the lines with a 6': (l) => (l.id === 'metadata' || /\b6\b/.test(l.text) ? 1 : 0),
  };
  for (const [name, score] of Object.entries(rules)) {
    for (const reverse of [false, true]) {
      const lines = reverse ? [...spec.lines].reverse() : spec.lines;
      const ranked = [...lines].sort((a, b) => score(b) - score(a)).slice(0, k).map((l) => l.id);
      assert.equal(spotRun(ranked).state.solved, false, `${name}${reverse ? ' (reversed ties)' : ''} picked ${ranked}`);
    }
  }
  // The faults are not the only lines with a layout item, a namespace or an x value.
  assert.equal(spec.lines.filter((l) => l.text.includes('$ref')).length, 4);
  assert.equal(spec.lines.filter((l) => l.text.includes('$ref') && !spec.faults.includes(l.id)).length, 2);
  assert.equal(textOf('item-rate').includes('x: 0'), true);
  assert.equal(textOf('item-latency').includes('x: 0'), true, 'a fault also starts at x: 0');
});

test('step 1: no odd-one-out rule over the layout fields picks the faults, and over all 4,095 selections only the reference passes', () => {
  const items = spec.lines.filter((l) => /\.items\[\d\]$/.test(readLine(l.text).path)).map((l) => ({ id: l.id, ...readLine(l.text).value }));
  assert.deepEqual(items.map((it) => it.id), ['item-rate', 'item-errors', 'item-latency', 'item-corner']);
  const refs = items.map((it) => it.content.$ref.replace('#/spec/panels/', ''));
  const defined = items.filter((it, i) => ['request_rate', 'error_ratio'].includes(refs[i]));
  assert.equal(defined.length, 3, 'three of the four items name a defined panel');
  // "Pick the item whose field differs from the rest", one field at a time: the odd ones are never the faulty pair.
  const faultItems = ['item-errors', 'item-latency'];
  const oddOnes = (field) => items.filter((it) => items.filter((o) => o[field] === it[field]).length === 1).map((it) => it.id);
  assert.deepEqual(oddOnes('x'), ['item-errors', 'item-corner'], 'x: the second item and the decoy');
  for (const f of ['y', 'width', 'height']) assert.deepEqual(oddOnes(f), [], `${f} has no odd one out`);
  for (const f of ['x', 'y', 'width', 'height']) {
    const picked = ['metadata', ...oddOnes(f)];
    assert.equal(spotRun(picked).state.solved, false, `the odd one out on ${f} (${picked}) does not solve it`);
    assert.equal(faultItems.every((id) => oddOnes(f).includes(id)), false, `${f} does not single out both faulty items`);
  }
  // Every non-empty selection of the twelve lines through the real checkSpot: exactly the reference solves it.
  const ids = spec.lines.map((l) => l.id);
  const passing = [];
  for (let mask = 1; mask < 2 ** ids.length; mask += 1) {
    const picked = ids.filter((_, i) => mask & (1 << i));
    if (spotRun(picked).state.solved) passing.push(picked.join(','));
  }
  assert.deepEqual(passing, [spec.faults.slice().sort((a, b) => ids.indexOf(a) - ids.indexOf(b)).join(',')], 'only the reference passes');
  assert.equal(2 ** ids.length - 1, 4095);
});

test('step 1 whyNot: only on decoys, each a full sentence that names no fault line, the tempting ones covered', () => {
  assert.deepEqual(Object.keys(spec.whyNot).sort(), ['datasource', 'header', 'item-corner', 'item-rate', 'panel-errors', 'query-errors', 'query-rate']);
  for (const [id, t] of Object.entries(spec.whyNot)) {
    assert.match(plain(t), /\S[\s\S]*\.$/, `${id} ends a sentence`);
    for (const f of spec.faults) assert.equal(plain(t).includes(spec.lines.find((l) => l.id === f).text), false, `${id} does not quote ${f}`);
  }
  assert.match(plain(spec.whyNot.header), /same <code>apiVersion<\/code>|same apiVersion/);
  assert.match(plain(spec.whyNot['item-rate']), /shares, one band of the grid further down/);
  assert.match(plain(spec.whyNot['item-rate']), /columns 0 to 12 of the 24/);
  assert.match(plain(spec.whyNot['item-corner']), /columns 12 to 24/);
  assert.doesNotMatch(plain(JSON.stringify(spec.whyNot)), /third item|two rows/);
  assert.match(plain(spec.whyNot['query-errors']), /rate of 5xx requests divided by the rate of all requests/);
});

test('step 1 explain: the namespace, the width in cells, and the missing panel, each with its numbers; it grades lines, not a parsed file', () => {
  const e = plain(spec.explain);
  for (const s of ['namespace: tools', 'checkout', 'payments', 'Reading the fields as cells', 'x: 18', '12 wide', 'column 30 on a grid of 24', 'x: 12', 'latency_p99', 'request_rate', 'error_ratio', 'grades the lines you select, not a parsed file', 'Perses schema']) {
    assert.equal(e.includes(s), true, s);
  }
  assert.doesNotMatch(e, /next column|0 to 12|drawn over each other/, 'no overlap story left');
  const intro = plain(SPOT_STEP.intro);
  for (const s of ['monitoring resources in checkout and payments, and none in tools', 'dashboards/checkout-overview.yaml', 'a new file', 'every line it adds', 'A Grid is 24 columns wide', 'reading the fields as cells']) assert.equal(intro.includes(s), true, s);
});

// ---- step 2: how a team with no cluster deploys ---------------------------------------------

test('step 2: one right answer, the dash0_dashboard resource; labels balanced, none argues its own wrongness or echoes the intro', () => {
  assert.equal(DEPLOY_STEP.qid, 'dac-q-deploy');
  assert.equal(DEPLOY_STEP.choice.id, 'dac-deploy');
  assert.equal(plain(DEPLOY_STEP.question), 'How should payments\' dashboards reach Dash0?');
  assert.deepEqual(choices.map((c) => c.key), ['terraform', 'operator', 'json', 'export']);
  assert.deepEqual(choices.filter((c) => c.right).map((c) => c.key), ['terraform']);
  const lens = choices.map((c) => plain(c.label).length);
  const right = lens[0];
  assert.equal(right < Math.max(...lens) && right > Math.min(...lens), true, `the right label is neither the longest nor the shortest: ${lens}`);
  assert.equal(Math.max(...lens) - Math.min(...lens) <= 14, true, `plain label lengths ${lens}`);
  for (const c of choices) assert.doesNotMatch(plain(c.label), /wrong|never|unsafe|slow|careful|manual|hand/i, c.key);
  const intro = plain(DEPLOY_STEP.intro);
  assert.match(intro, /Terraform/);
  assert.doesNotMatch(plain(choices[0].label), /Terraform|pipeline|cluster|Kubernetes/, 'the right label does not repeat the intro\'s clue words');
  assert.deepEqual(choices.map((c) => /<code>/.test(c.label)), [true, true, false, false], 'a code name is on the right label and on one wrong label');
  assert.deepEqual(choices.map((c) => /\bDash0\b/.test(plain(c.label))), [false, true, false, false], 'the product name marks no odd one out: only the operator label has it');
});

test('step 2: each wrong option fails for a reason the scenario shows', () => {
  const why = (k) => plain(choices.find((c) => c.key === k).why);
  assert.match(why('terraform'), /dash0_dashboard/);
  assert.match(why('terraform'), /dataset/);
  assert.match(why('terraform'), /dashboard_yaml/);
  assert.match(why('terraform'), /Dash0 CLI can create a dashboard from a file too, but that would be a second way to deploy/);
  assert.match(why('operator'), /needs a Kubernetes cluster to run in\. Payments has none/);
  assert.match(plain(DEPLOY_STEP.intro), /no Kubernetes cluster/);
  assert.match(why('json'), /applies changes when you save, so the dashboard is already live before anyone reads the change/);
  assert.match(why('export'), /nothing is reviewed before it goes live/);
});

// ---- sources and claims ---------------------------------------------------------------------

test('sources: Dash0 docs on the Spec line, Facts used, Invented and reasoning sections, no Perses host, allowed hosts only', () => {
  const spec1 = SRC.split('\n').find((l) => /^\/\/ Spec: /.test(l));
  for (const url of [
    'https://www.dash0.com/docs/dash0/dashboards/manage-dashboards-as-code',
    'https://www.dash0.com/docs/dash0/dashboards/export-dashboards',
  ]) assert.equal(spec1.includes(url), true, url);
  assert.match(SRC, /^\/\/ Dash0 docs: https:\/\/www\.dash0\.com\/docs\/dash0\/dashboards\/manage-dashboards-as-code$/m);
  assert.match(SRC, /Facts used/);
  assert.match(SRC, /Stated as reasoning/);
  assert.match(SRC, /Invented for the game/);
  assert.match(SRC, /perses\.dev\) is not an allowed host, so no field beyond the Dash0 page's example is shown/);
  const hosts = ['www.dash0.com'];
  for (const url of SRC.match(/https:\/\/[^\s,)]+/g)) assert.equal(hosts.includes(new URL(url).host), true, url);
  assert.equal(SRC.includes(String.fromCharCode(0x2014)), false, 'no em dash');
});

test('claims: the Dash0 sentences stay inside the cited pages; no pricing, no automatic-sync or schema-validation claim', () => {
  const copy = plain(JSON.stringify(level.play));
  assert.doesNotMatch(copy, /\$\d|per month|pricing|free tier/i);
  assert.doesNotMatch(copy, /automatic(ally)? (sync|deploy|valid)|validates? (the )?(yaml|schema)|one click/i);
  assert.match(copy, /watches for Perses dashboard resources in namespaces that have a Dash0 monitoring resource/);
  assert.match(copy, /Dash0 dashboards use the Perses format/);
});
