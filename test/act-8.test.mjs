// Act 8 "Operating at scale" and level 8.2 "Semantic convention versions" beyond the generated
// play-through (test/play.test.mjs, test/answers.test.mjs, test/levels-play.test.mjs): the act's
// place in the registry, unlock and globe; level fields; the Spot it board of eight span attributes
// and an independent reading of each key; the "what first" Choice; and the sources. Asserts
// strings, numbers and booleans only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { liveRegistry } from '../app.mjs';
import { COMING_SOON } from '../hub/coming-soon.mjs';
import { ACT_REGIONS, COUNTRY_NAMES, LEVEL_COUNTRY } from '../hub/globe-map.mjs';
import { freshlyLit, litText } from '../lib/globe-ignite.mjs';
import { emptyProgress } from '../lib/progress.mjs';
import { isActComplete, isActUnlocked, levelState, lockReason } from '../lib/unlock.mjs';
import { checkSpot, newSpotState, toggleLine, validateSpotSpec } from '../lib/widgets/spot-it.mjs';
import { validateSpotHelps } from '../lib/widgets/spot-it-help.mjs';

const ID = 'semantic-convention-versions';
const LIVE = liveRegistry();
const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const SRC = read(`levels/${ID}.mjs`);
const plain = (html) => html.replace(/<[^>]+>/g, '');

const progressOf = (ids) => {
  const p = emptyProgress();
  for (const id of ids) p.levels[id] = { stars: 3, at: null };
  return p;
};
const idsOf = (actId) => {
  const act = LIVE.acts.find((a) => a.id === actId);
  return [...act.levelIds, ...(act.bossId ? [act.bossId] : [])];
};
const level = LIVE.levels[ID];
const [SPOT_STEP, SWITCH_STEP] = level.play.steps;
const spec = SPOT_STEP.spot;
const choices = SWITCH_STEP.choice.choices;
const layout = (s) => s.lines.map((l) => (s.faults.includes(l.id) ? 'F' : '.')).join('');
const spotRun = (ids) => {
  let state = newSpotState(spec);
  for (const id of ids) state = toggleLine(spec, state, id).state;
  const r = checkSpot(spec, state);
  return { solved: r.state.solved, outcome: r.outcome };
};

// ---- the act ------------------------------------------------------------------------

test('act-8 follows act-7, holds only 8.2, no boss, and is not coming soon; nothing is coming soon', () => {
  const act = LIVE.acts.find((a) => a.id === 'act-8');
  assert.ok(act, 'act-8 is in the registry');
  assert.deepEqual(
    { no: act.no, name: act.name, sub: act.sub, levelIds: [...act.levelIds], bossId: act.bossId },
    { no: 8, name: 'Operating at scale', sub: 'As code', levelIds: [ID], bossId: null },
  );
  const ids = LIVE.acts.map((a) => a.id);
  assert.equal(ids.indexOf('act-8'), ids.indexOf('act-7') + 1, 'act-8 comes right after act-7');
  assert.deepEqual([...COMING_SOON], [], 'no act is coming soon');
  assert.equal(LIVE.order[LIVE.order.indexOf('good-alerts') + 1], ID, '8.2 plays right after 7.1');
});

test('act-8 keeps its teaser verbatim now it is live', () => {
  const act = LIVE.acts.find((a) => a.id === 'act-8');
  assert.equal(act.teaser, 'Dashboards as code, semantic convention upgrades, migrating vendors, browser telemetry and AI-assisted debugging.');
});

test('act-8 opens when acts 0-7 are complete, or once entered', () => {
  const index = LIVE.acts.findIndex((a) => a.id === 'act-8'); // isActUnlocked takes the position, not the number
  const before = LIVE.acts.slice(0, index).flatMap((a) => idsOf(a.id));
  assert.deepEqual(LIVE.acts.slice(0, index).map((a) => a.id), ['act-0', 'act-1', 'act-2', 'act-3', 'act-4', 'act-5', 'act-6', 'act-7']);
  assert.equal(isActUnlocked(index, progressOf(before), LIVE), true);
  assert.equal(levelState(ID, progressOf(before), LIVE), 'open');
  assert.equal(lockReason(ID, progressOf(before), LIVE), null);

  const withoutAlerts = before.filter((id) => id !== 'good-alerts');
  assert.equal(isActUnlocked(index, progressOf(withoutAlerts), LIVE), false, 'act-7 counts');
  assert.equal(levelState(ID, progressOf(withoutAlerts), LIVE), 'locked');
  assert.deepEqual(lockReason(ID, progressOf(withoutAlerts), LIVE), { kind: 'act', actId: 'act-7' });
  assert.deepEqual(lockReason(ID, emptyProgress(), LIVE), { kind: 'act', actId: 'act-0' });

  assert.equal(levelState(ID, progressOf([ID]), LIVE), 'done', 'completed even when earlier acts are not');
  assert.equal(isActUnlocked(index, progressOf([ID]), LIVE), true, 'entered');
  const act = LIVE.acts[index];
  assert.equal(isActComplete(act, emptyProgress()), false);
  assert.equal(isActComplete(act, progressOf([ID])), true, 'its one level completes it (no boss)');
});

test('8.2 fields: scored with no par time, in act-8, lights storefront, awards no card; mechanics as derived', () => {
  assert.deepEqual(
    { no: level.no, name: level.name, sub: level.sub, icon: level.icon, rewardTitle: level.rewardTitle, kind: level.kind, actId: level.actId, parMs: level.scoring.parMs },
    { no: '8.2', name: 'Semantic convention versions', sub: 'Names change', icon: '\u{1F4D6}', rewardTitle: 'Convention keeper', kind: 'level', actId: 'act-8', parMs: null },
  );
  assert.deepEqual([...level.mechanics], ['spot'], 'derived from the steps: choice is not a mechanic');
  assert.deepEqual(level.play.steps.map((s) => ['spot', 'choice'].find((k) => s[k])), ['spot', 'choice']);
  assert.equal(level.play.prefix, 'scv');
  assert.deepEqual([...level.cards], []);
  assert.deepEqual([...level.lights], ['storefront']);
  const titles = Object.values(LIVE.levels).map((l) => l.rewardTitle);
  assert.equal(titles.filter((t) => t === 'Convention keeper').length, 1, 'the reward title is unique');
});

// ---- step 1: Spot it ----------------------------------------------------------------------

test('step 1: a valid span board of eight attributes, hints off, faults at F...F..F', () => {
  assert.equal(SPOT_STEP.qid, 'scv-q-spot');
  assert.equal(spec.id, 'scv-spot');
  assert.equal(spec.target, 'span');
  assert.deepEqual(validateSpotSpec(spec), []);
  assert.deepEqual(validateSpotHelps(spec), []);
  assert.deepEqual(spec.helps, { hints: false });
  assert.equal(Object.hasOwn(spec, 'hint'), false, 'no authored hint (hints off)');
  assert.deepEqual(spec.lines.map((l) => l.id), ['http-method', 'url-path', 'request-method', 'server-port', 'http-status-code', 'route', 'response-status-code', 'net-host-port']);
  assert.deepEqual(spec.faults, ['http-method', 'http-status-code', 'net-host-port']);
  assert.equal(layout(spec), 'F...F..F');
  for (const l of spec.lines) assert.match(l.text, /^[^=\s]+=/, `${l.id} reads as key=value`);
  assert.equal(spotRun(spec.faults).solved, true, 'the three faults solve it');
  assert.equal(spotRun(['http-method', 'net-host-port']).solved, false, 'two of three do not');
  assert.equal(spotRun([...spec.faults, 'route']).solved, false, 'http.route, which did not change, picked too does not');
  assert.equal(plain(SPOT_STEP.question), 'Spot the attributes that stop arriving once the opt-in is set to http.');
  assert.match(plain(SPOT_STEP.intro), /OTEL_SEMCONV_STABILITY_OPT_IN=http\/dup/);
});

test('step 1 oracle: an independent reading of the migration page flags exactly the faults', () => {
  const STABLE = {
    'http.method': 'http.request.method',
    'http.status_code': 'http.response.status_code',
    'net.host.port': 'server.port',
    'http.target': 'url.path',
  };
  const UNCHANGED = ['http.route'];
  const pairs = spec.lines.map((l) => {
    const [key, ...rest] = l.text.split('=');
    return { id: l.id, key, value: rest.join('=') };
  });
  const keys = new Set(pairs.map((p) => p.key));
  assert.equal(keys.size, pairs.length, 'one line per key');
  // Old names stop arriving with the opt-in at http: exactly the faults.
  assert.deepEqual(pairs.filter((p) => Object.hasOwn(STABLE, p.key)).map((p) => p.id), spec.faults);
  // Everything else is a stable name or unchanged, so it keeps arriving.
  for (const p of pairs.filter((q) => !Object.hasOwn(STABLE, q.key))) {
    assert.equal(Object.values(STABLE).includes(p.key) || UNCHANGED.includes(p.key), true, `${p.id}: ${p.key} is a stable or unchanged name`);
  }
  // http/dup sends both names with the same value: every old name's twin is on the board.
  for (const p of pairs.filter((q) => Object.hasOwn(STABLE, q.key))) {
    const twin = pairs.find((q) => q.key === STABLE[p.key]);
    assert.ok(twin, `${p.key} has its stable twin ${STABLE[p.key]} on the board`);
    assert.equal(twin.value, p.value, `${p.key} and ${twin.key} carry the same value`);
  }
});

test('step 1 whyNot on exactly the five attributes that stay; explain names the three old names, http/dup and http.route', () => {
  assert.deepEqual(Object.keys(spec.whyNot).sort(), ['request-method', 'response-status-code', 'route', 'server-port', 'url-path']);
  for (const [id, t] of Object.entries(spec.whyNot)) assert.match(plain(t), /\S[\s\S]*\.$/, `${id} ends a sentence`);
  const e = plain(spec.explain);
  for (const s of ['http.method', 'http.status_code', 'net.host.port', 'http/dup', 'OTEL_SEMCONV_STABILITY_OPT_IN', 'http.route']) assert.equal(e.includes(s), true, s);
  assert.match(plain(spec.whyNot.route), /Unchanged/);
});

// ---- step 2: what first -------------------------------------------------------------------

test('step 2: one right answer, move the queries first; labels give nothing away', () => {
  assert.equal(SWITCH_STEP.qid, 'scv-q-switch');
  assert.equal(SWITCH_STEP.choice.id, 'scv-switch');
  assert.equal(plain(SWITCH_STEP.question), 'What has to happen first?');
  assert.deepEqual(choices.map((c) => c.key), ['switch-now', 'move-queries', 'keep-dup']);
  assert.deepEqual(choices.filter((c) => c.right).map((c) => c.key), ['move-queries']);
  const lens = choices.map((c) => plain(c.label).length);
  const right = choices.find((c) => c.right);
  assert.equal(plain(right.label).length < Math.max(...lens), true, `the right label is not the longest: ${lens}`);
  assert.equal(Math.max(...lens) - Math.min(...lens) <= 10, true, `plain label lengths ${lens}`);
  assert.match(plain(choices.find((c) => c.key === 'switch-now').why), /matches nothing/);
  for (const c of choices) assert.equal(typeof c.why === 'string' && c.why.length > 0, true, `${c.key} has a why`);
});

// ---- sources ------------------------------------------------------------------------------

test('sources: the two opentelemetry.io pages, a Spec line, a cited Dash0 page behind the Dash0 sentence, no overclaim, no em dash', () => {
  for (const url of [
    'https://opentelemetry.io/docs/specs/semconv/non-normative/http-migration/',
    'https://opentelemetry.io/docs/specs/semconv/http/http-spans/',
  ]) assert.equal(SRC.includes(url), true, url);
  assert.match(SRC, /^\/\/ Spec: https:\/\/opentelemetry\.io/m);
  assert.match(SRC, /Facts used/);
  assert.match(SRC, /Invented/);
  const hosts = ['opentelemetry.io', 'prometheus.io', 'www.dash0.com'];
  for (const url of SRC.match(/https:\/\/[^\s,)]+/g)) assert.equal(hosts.includes(new URL(url).host), true, url);
  // G2-b: the Dash0 sentence ships with the Dash0 semantic conventions page cited, and claims only what it says (#16).
  const copy = plain(JSON.stringify(level.play));
  assert.deepEqual([/^\/\/ Dash0 docs: https:\/\/www\.dash0\.com\/docs\/dash0\/opentelemetry\/semconvs\/overview/m.test(SRC), /Dash0/.test(copy)], [true, true], 'a Dash0 page is cited, and it backs a Dash0 sentence in the copy');
  assert.doesNotMatch(copy, /work out of the box|old names keep working|reads both/i, 'not claimed: Dash0 views read the old names, or work with no change');
  assert.equal(SRC.includes('—'), false, 'no em dash');
});

// ---- the globe -----------------------------------------------------------------------------

test('globe: 8.2 lights Thailand, completing Southeast Asia', () => {
  assert.equal(LEVEL_COUNTRY[ID], 'THA');
  assert.equal(COUNTRY_NAMES.THA, 'Thailand');
  assert.equal(ACT_REGIONS['act-8'].region, 'Southeast Asia');
  const map = { ACT_REGIONS, LEVEL_COUNTRY, COUNTRY_NAMES };
  const fresh = freshlyLit(emptyProgress(), progressOf([ID]), LIVE, map);
  assert.deepEqual(fresh, { countryIds: ['THA'], regionIds: ['act-8'] });
  assert.equal(litText(fresh, level, map), 'Thailand is now lit: Semantic convention versions. Southeast Asia is complete.');
});
