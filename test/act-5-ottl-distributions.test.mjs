// Act 5 levels 5.5 OTTL and transforms and 5.6 Distributions beyond the generated play-through
// (test/play.test.mjs, test/answers.test.mjs, test/levels-play.test.mjs): level fields and lights;
// card fronts and backs; the shortcuts through the real runConfigure; and the facts the copy
// states (docs/OUTLINE.md §4 Act 5), each checked from the level's own data against an independent
// copy of the source (a small OTTL model for the spot step, the distribution manifests for the sort).
// Asserts strings, numbers and booleans only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DECK } from '../cards/deck.mjs';
import { EDGES, NODES } from '../hub/map-data.mjs';
import { liveRegistry } from '../app.mjs';
import { emptyProgress, starTotals } from '../lib/progress.mjs';
import { nodeStates } from '../lib/map.mjs';
import { levelState } from '../lib/unlock.mjs';
import { checkConfig } from '../lib/configure/check.mjs';
import { COLLECTOR_SCHEMA } from '../lib/configure/collector.mjs';
import { newConfigureState, runConfigure } from '../lib/widgets/configure-it.mjs';

const LIVE = liveRegistry();
const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const plain = (html) => html.replace(/<[^>]+>/g, '');
const progressOf = (ids) => {
  const p = emptyProgress();
  for (const id of ids) p.levels[id] = { stars: 3, at: null };
  return p;
};
const stepOf = (levelId, key, widgetId) =>
  LIVE.levels[levelId].play.steps.find((s) => s[key] && s[key].id === widgetId)[key];
const choiceOf = (levelId, widgetId) => stepOf(levelId, 'choice', widgetId).choices;
const rightOf = (levelId, widgetId) => choiceOf(levelId, widgetId).find((c) => c.right);
const keysOf = (levelId, widgetId) => choiceOf(levelId, widgetId).map((c) => c.key).sort();

const OTTL = 'ottl-and-transforms';
const DIST = 'distributions';

// ---- levels, lights, totals ---------------------------------------------------------

test('5.5 and 5.6: level fields, derived mechanics, cards, lights and no par time', () => {
  const want = {
    [OTTL]: { no: '5.5', name: 'OTTL and transforms', mechanics: ['spot', 'configure'], cards: ['redact-in-the-pipeline'], lights: [] },
    [DIST]: { no: '5.6', name: 'Distributions', mechanics: ['sort'], cards: ['not-every-component'], lights: [] },
  };
  for (const [id, w] of Object.entries(want)) {
    const level = LIVE.levels[id];
    assert.deepEqual(
      { no: level.no, name: level.name, mechanics: [...level.mechanics], cards: [...level.cards], lights: [...level.lights] },
      w,
      id,
    );
    assert.equal(level.actId, 'act-5', id);
    assert.equal(level.scored, true, id);
    assert.equal(level.scoring.parMs, null, id);
    assert.equal(level.run.length, 1, id);
  }
});

test('5.5 and 5.6 light nothing (the map has no Collector node) and add 2 levels: 30 scored, max 90', () => {
  const s = nodeStates(LIVE, progressOf([OTTL, DIST]), NODES, EDGES);
  assert.equal(NODES.filter((n) => s.nodes[n.id].lit).length, 0);
  assert.equal(s.edges.filter((e) => e.lit).length, 0);
  assert.deepEqual(starTotals(emptyProgress(), LIVE), { earned: 0, max: 90 });
  assert.deepEqual(starTotals(progressOf([OTTL, DIST]), LIVE), { earned: 6, max: 90 });
  assert.equal(levelState(OTTL, progressOf(['pipelines']), LIVE), 'open', 'an entered act opens its levels');
  assert.equal(levelState(DIST, emptyProgress(), LIVE), 'locked');
});

// ---- cards --------------------------------------------------------------------------

const CARDS = {
  'redact-in-the-pipeline': {
    front:
      'Redact PII in the Collector before export. A spam filter drops whole points after they reach Dash0 and cannot edit one attribute.',
    back:
      'OTTL statements in the transform processor change telemetry inside the pipeline. A rename is a set followed by a delete_key, ' +
      'a redaction is a delete_key, a masking set or a replace_pattern, and dropping whole telemetry is the job of the filter processor. ' +
      'Sensitive values have to go before the exporter sends them, so the processor must be listed in every pipeline that carries them: ' +
      'defined but not listed does nothing. A statement that deletes from the wrong map, a misspelled key or a where clause that matches ' +
      'only some spans still leaks. Dash0 spam filters are the backend-side drop: they drop whole spans, logs or data points that match, ' +
      'at ingestion. A drop cannot be recovered, a filter cannot edit one attribute, and filtered telemetry still carries the ingest charge.',
    specUrl: 'https://opentelemetry.io/docs/collector/transforming-telemetry/',
    dash0Angle:
      'A Dash0 spam filter drops matching spans, logs and data points at ingestion. It is the backend-side drop, not a way to redact ' +
      'one attribute, and filtered telemetry still carries the ingest charge.',
  },
  'not-every-component': {
    front:
      'A component works only in a distribution that ships it: check its Distributions row or the manifest, or build your own with OCB.',
    back:
      'The project ships pre-built Collector distributions (core, contrib, k8s, otlp and an eBPF profiling one), and each ships a ' +
      'different set of components, listed in its manifest.yaml and in the Distributions row of each component README. batch, ' +
      'memory_limiter and the otlp exporter are in core, contrib and k8s. k8sattributes, redaction and tail_sampling are in contrib ' +
      'and k8s but not core, and vendor exporters such as awss3 and awsxray are in contrib only. A config that names a component the ' +
      'binary does not contain stops the Collector with an unknown type error. When no distribution has what you need, including a ' +
      'component your team wrote, build your own with ocb, the OpenTelemetry Collector Builder, from a manifest that lists the components ' +
      'you want. The core list has grown over time, so read the current manifest rather than a copy.',
    specUrl: 'https://opentelemetry.io/docs/collector/distributions/',
    dash0Angle: null,
  },
};

test('5.5 and 5.6 cards: front, back, spec URL and Dash0 angle are pinned; fronts fit a card (<=140)', () => {
  for (const [id, want] of Object.entries(CARDS)) {
    assert.deepEqual(DECK.find((c) => c.id === id), { id, ...want });
    assert.equal(want.front.length <= 140, true, `${id} front is ${want.front.length} characters`);
  }
});

// ---- 5.5 step 1: rename -------------------------------------------------------------

test('ottl: a rename is a set then a delete_key, in that order (the OTTL function list has no rename)', () => {
  const right = rightOf(OTTL, 'ottl-rename');
  assert.equal(right.key, 'set-then-delete');
  const text = plain(right.label + right.why);
  for (const w of ['set', 'delete_key', 'order', 'no rename function']) assert.equal(text.includes(w), true, w);
  assert.deepEqual(keysOf(OTTL, 'ottl-rename'), ['delete-then-set', 'set-only', 'set-then-delete']);
  const wrongWhy = (k) => plain(choiceOf(OTTL, 'ottl-rename').find((c) => c.key === k).why);
  assert.equal(/both|old key|still/.test(wrongWhy('set-only')), true, 'one set leaves the old attribute behind');
  assert.equal(/nothing left to copy|lost/.test(wrongWhy('delete-then-set')), true, 'delete first loses the value');
});

// ---- 5.5 step 2: spot the statements that leak --------------------------------------

const SPOT = () => stepOf(OTTL, 'spot', 'ottl-spot');
const EMAIL = 'ada@example.com';
// Two spans the statements run on: an ordinary one and one on the admin route.
const spans = () => [
  { attrs: { 'user.email': EMAIL, 'http.route': '/cart', 'http.request.method': 'GET' }, resource: { 'user.email': EMAIL } },
  { attrs: { 'user.email': EMAIL, 'http.route': '/admin', 'http.request.method': 'GET' }, resource: {} },
];
const STR = '"((?:[^"\\\\]|\\\\.)*)"';
const KEY = String.raw`span\.attributes\["([^"]+)"\]`;
/** A small model of the OTTL statement shapes the level uses (docs: pkg/ottl ottlfuncs README), applied to one span. */
function apply(statement, span) {
  const where = /^(.*) where span\.attributes\["([^"]+)"\] == "([^"]+)"$/.exec(statement);
  const body = where ? where[1] : statement;
  if (where && span.attrs[where[2]] !== where[3]) return;
  let m;
  if ((m = new RegExp(`^delete_key\\(span\\.attributes, ${STR}\\)$`).exec(body))) delete span.attrs[m[1]];
  else if ((m = new RegExp(`^delete_key\\(resource\\.attributes, ${STR}\\)$`).exec(body))) delete span.resource[m[1]];
  else if ((m = new RegExp(`^set\\(${KEY}, ${STR}\\)$`).exec(body))) span.attrs[m[1]] = m[2];
  else if ((m = new RegExp(`^set\\(${KEY}, ${KEY}\\)$`).exec(body))) span.attrs[m[1]] = span.attrs[m[2]];
  else if ((m = /^keep_keys\(span\.attributes, \[(.*)\]\)$/.exec(body))) {
    const keep = m[1].split(', ').map((k) => k.replace(/^"|"$/g, ''));
    for (const k of Object.keys(span.attrs)) if (!keep.includes(k)) delete span.attrs[k];
  } else if ((m = new RegExp(`^delete_matching_keys\\(span\\.attributes, ${STR}\\)$`).exec(body))) {
    const re = new RegExp(m[1].replace(/^\(\?i\)/, ''), m[1].startsWith('(?i)') ? 'i' : '');
    for (const k of Object.keys(span.attrs)) if (re.test(k)) delete span.attrs[k];
  } else assert.fail(`statement shape not modelled: ${statement}`);
}
/** The email still sits on the exported span (span attributes: the resource copy is another map). */
const leaks = (statement) =>
  spans().some((span) => { apply(statement, span); return Object.values(span.attrs).includes(EMAIL); });

test('ottl spot: the faults are exactly the statements that leave the email on a span (run on an ordinary and an admin span)', () => {
  const spot = SPOT();
  assert.equal(spot.target, 'config');
  assert.equal(spot.lines.length, 8);
  const leaking = spot.lines.filter((l) => leaks(l.text)).map((l) => l.id);
  assert.deepEqual(leaking, spot.faults);
  assert.deepEqual(spot.faults, ['resource-map', 'copy-only', 'admin-only', 'typo-key']);
  assert.deepEqual(
    Object.keys(spot.whyNot).sort(),
    spot.lines.map((l) => l.id).filter((id) => !spot.faults.includes(id)).sort(),
    'every statement that is fine says why',
  );
});

test('ottl spot: the model itself tells a delete from a leak (the one-line statements behave as written)', () => {
  assert.equal(leaks('delete_key(span.attributes, "user.email")'), false);
  assert.equal(leaks('delete_key(resource.attributes, "user.email")'), true);
  assert.equal(leaks('delete_key(span.attributes, "user.email") where span.attributes["http.route"] == "/admin"'), true);
  assert.equal(leaks('set(span.attributes["user.email"], "REDACTED")'), false);
});

test('ottl spot: the explanation names the four ways to leak and says order and where-conditions matter', () => {
  const text = plain(SPOT().explain);
  for (const w of ['resource.attributes', 'delete_key', 'where', 'misspelled', 'copy', 'span.attributes']) assert.equal(text.includes(w), true, w);
});

// ---- 5.5 step 3: wire the transform into both pipelines -----------------------------

const config = () => stepOf(OTTL, 'configure', 'ottl-config');
const REF = () => config().reference;
const run = (text, state = newConfigureState()) => runConfigure(config(), state, text);
const verdictOf = (r) => ({ outcome: r.outcome, reason: r.reason, unmet: r.unmet });
const without = (text, ...parts) => parts.reduce((t, p) => { assert.equal(t.includes(p), true, p); return t.replace(p, ''); }, text);

const PII_DEF = /  transform\/pii:\n(?:    .*\n|      .*\n)+?(?=  batch:)/;
const LISTED = '      processors: [memory_limiter, transform/pii, batch]\n';
const PLAIN = '      processors: [memory_limiter, batch]\n';
const pipeline = (name, procs) => `    ${name}:\n      receivers: [otlp]\n${procs}      exporters: [otlp/dash0]\n`;

test('ottl config: the given cannot start (logs names transform/redact, which is not defined) and traces has no redaction', () => {
  const given = checkConfig(config().given, COLLECTOR_SCHEMA);
  assert.equal(given.ok, false);
  assert.deepEqual(given.errors.map((e) => `${e.kind} ${e.path}`), ['unknown-ref service.pipelines.logs.processors[1]']);
  assert.deepEqual(given.doc.service.pipelines.traces.processors, ['memory_limiter', 'batch']);
  assert.deepEqual(given.doc.service.pipelines.logs.processors, ['memory_limiter', 'transform/redact', 'batch']);
  assert.deepEqual(Object.keys(given.doc.processors), ['memory_limiter', 'transform/pii', 'batch']);
});

test('ottl config: the reference starts, flows traces and logs, lists transform/pii in both, and `uses` names exactly that', () => {
  const ref = checkConfig(REF(), COLLECTOR_SCHEMA);
  assert.equal(ref.ok, true);
  assert.deepEqual(ref.verdict.pipelines.map((p) => `${p.name}=${p.flowing}`), ['traces=true', 'logs=true']);
  assert.deepEqual(ref.verdict.inactive, []);
  for (const name of ['traces', 'logs']) {
    assert.deepEqual(ref.doc.service.pipelines[name].processors, ['memory_limiter', 'transform/pii', 'batch'], name);
    assert.deepEqual(ref.doc.service.pipelines[name].exporters, ['otlp/dash0'], name);
  }
  assert.deepEqual(ref.doc.processors['transform/pii'].trace_statements, ['delete_key(span.attributes, "user.email")']);
  assert.deepEqual(ref.doc.processors['transform/pii'].log_statements, ['delete_key(log.attributes, "user.email")']);
  assert.deepEqual(config().uses, { traces: ['transform/pii'], logs: ['transform/pii'] });
  assert.deepEqual(verdictOf(run(REF())), { outcome: 'right', reason: undefined, unmet: undefined });
});

test('ottl config shortcut: fixing only the name in logs leaves traces unredacted, so `uses` refuses it', () => {
  const logsOnly = config().given.replace('transform/redact', 'transform/pii');
  assert.equal(checkConfig(logsOnly, COLLECTOR_SCHEMA).ok, true, 'the Collector would start');
  const wrong = run(logsOnly);
  assert.deepEqual(verdictOf(wrong), { outcome: 'wrong', reason: 'uses', unmet: ['traces'] });
  assert.equal(run(logsOnly, wrong.state).outcome, 'repeat');
  assert.equal(run(REF(), wrong.state).outcome, 'right');
});

test('ottl config shortcut: defining transform/redact so the given starts leaves both pipelines without transform/pii', () => {
  const defined = config().given.replace('  batch:\n', '  transform/redact:\n    trace_statements:\n      - delete_key(span.attributes, "user.email")\n  batch:\n');
  assert.equal(checkConfig(defined, COLLECTOR_SCHEMA).ok, true);
  assert.deepEqual(verdictOf(run(defined)), { outcome: 'wrong', reason: 'uses', unmet: ['traces', 'logs'] });
});

test('ottl config shortcut: deleting the processor everywhere starts the Collector and redacts nothing', () => {
  const deleted = REF().replace(PII_DEF, '').split(LISTED).join(PLAIN);
  assert.equal(deleted.includes('transform'), false);
  assert.equal(checkConfig(deleted, COLLECTOR_SCHEMA).ok, true);
  assert.deepEqual(verdictOf(run(deleted)), { outcome: 'wrong', reason: 'uses', unmet: ['traces', 'logs'] });
});

test('ottl config shortcut: wiring it into one pipeline names the other one', () => {
  const tracesOnly = REF().replace(pipeline('logs', LISTED), pipeline('logs', PLAIN));
  assert.notEqual(tracesOnly, REF());
  assert.deepEqual(verdictOf(run(tracesOnly)), { outcome: 'wrong', reason: 'uses', unmet: ['logs'] });
  const logsOnly = REF().replace(pipeline('traces', LISTED), pipeline('traces', PLAIN));
  assert.notEqual(logsOnly, REF());
  assert.deepEqual(verdictOf(run(logsOnly)), { outcome: 'wrong', reason: 'uses', unmet: ['traces'] });
});

test('ottl config shortcut: a new pipeline with the redaction beside the unredacted originals does not count', () => {
  const sidecar = REF().replace(pipeline('traces', LISTED), pipeline('traces', PLAIN) + pipeline('traces/redacted', LISTED));
  assert.equal(checkConfig(sidecar, COLLECTOR_SCHEMA).ok, true, 'a valid config that still exports unredacted traces');
  assert.deepEqual(verdictOf(run(sidecar)), { outcome: 'wrong', reason: 'uses', unmet: ['traces'] });
});

test('ottl config shortcut: listing the processor as an exporter is refused by the checker', () => {
  const asExporter = REF().replace(LISTED, PLAIN).replace('exporters: [otlp/dash0]\n    logs', 'exporters: [otlp/dash0, transform/pii]\n    logs');
  const r = run(asExporter);
  assert.deepEqual(verdictOf(r), { outcome: 'wrong', reason: 'invalid', unmet: undefined });
  assert.equal(r.result.errors.some((e) => e.kind === 'unknown-ref'), true);
});

test('ottl config: the statements and where the processor sits in the list are not graded; the wiring is, and the copy says so', () => {
  const noStatements = REF().replace(PII_DEF, '  transform/pii:\n');
  assert.notEqual(noStatements, REF());
  assert.equal(run(noStatements).outcome, 'right', 'COLLECTOR_SCHEMA does not model component settings');
  const lastInList = REF().split(LISTED).join('      processors: [memory_limiter, batch, transform/pii]\n');
  assert.equal(run(lastInList).outcome, 'right', 'order is level 5.2');
  const text = plain(config().explain);
  for (const w of ['listed', 'before', 'exporter', 'statements', 'not graded', 'spot']) assert.equal(text.includes(w), true, w);
});

// ---- 5.5 step 4: backend-side drop --------------------------------------------------

test('ottl backend: redact in the pipeline; a spam filter drops whole points at ingestion, cannot edit one attribute, is final and still charged', () => {
  const right = rightOf(OTTL, 'ottl-backend');
  assert.equal(right.key, 'pipeline');
  const text = plain(right.label + right.why);
  for (const w of ['pipeline', 'spam filter', 'whole', 'one attribute', 'ingest', 'cannot be recovered', 'charge']) assert.equal(text.includes(w), true, w);
  assert.deepEqual(keysOf(OTTL, 'ottl-backend'), ['pipeline', 'spam-drop-all', 'spam-strip']);
  const strip = plain(choiceOf(OTTL, 'ottl-backend').find((c) => c.key === 'spam-strip').why);
  assert.equal(/does not strip|cannot/.test(strip), true);
  const free = plain(choiceOf(OTTL, 'ottl-backend').find((c) => c.key === 'spam-drop-all').why);
  assert.equal(/charge|already/.test(free), true);
});

test('ottl: the spam-filter wording agrees with level 3.5 (whole points, ingestion, irreversible, ingest still charged)', () => {
  const card = CARDS['redact-in-the-pipeline'].back;
  const cardinality = read('levels/cardinality.mjs');
  for (const w of ['whole', 'cannot be recovered', 'ingest charge']) {
    assert.equal(card.includes(w), true, `5.5 card says "${w}"`);
    assert.equal(cardinality.includes(w), true, `3.5 says "${w}"`);
  }
});

// ---- 5.6 ----------------------------------------------------------------------------

test('distributions: a config that names a component the binary does not contain stops the Collector (unknown type)', () => {
  const right = rightOf(DIST, 'dist-unknown');
  assert.equal(right.key, 'refuses-to-start');
  const text = plain(right.label + right.why);
  for (const w of ['core', 'k8sattributes', 'unknown type', 'not compiled', 'contrib']) assert.equal(text.includes(w), true, w);
  assert.deepEqual(keysOf(DIST, 'dist-unknown'), ['ignored', 'loads-on-demand', 'refuses-to-start']);
});

// The relevant component lists of each pre-built distribution, copied from its manifest.yaml
// (opentelemetry-collector-releases, distributions/<name>/manifest.yaml, v0.164.0) and cross-checked
// against the component pages' Distributions rows. Only components the three distributions agree on are used.
const MANIFEST = {
  core: ['batchprocessor', 'memorylimiterprocessor', 'otlpexporter'],
  k8s: ['batchprocessor', 'memorylimiterprocessor', 'otlpexporter', 'k8sattributesprocessor', 'redactionprocessor', 'tailsamplingprocessor'],
  contrib: [
    'batchprocessor', 'memorylimiterprocessor', 'otlpexporter', 'k8sattributesprocessor', 'redactionprocessor',
    'tailsamplingprocessor', 'awss3exporter', 'awsxrayexporter',
  ],
};
const COMPONENT = {
  batch: 'batchprocessor',
  'memory-limiter': 'memorylimiterprocessor',
  'otlp-exporter': 'otlpexporter',
  k8sattributes: 'k8sattributesprocessor',
  redaction: 'redactionprocessor',
  'tail-sampling': 'tailsamplingprocessor',
  'awss3-exporter': 'awss3exporter',
  'awsxray-exporter': 'awsxrayexporter',
};
const bucketFor = (id) => {
  const c = COMPONENT[id];
  if (c === undefined) return 'none';
  const d = ['core', 'k8s', 'contrib'].filter((name) => MANIFEST[name].includes(c));
  const key = d.join('+');
  return { 'core+k8s+contrib': 'all-three', 'k8s+contrib': 'contrib-k8s', contrib: 'contrib-only' }[key];
};
const SORT = () => stepOf(DIST, 'sort', 'dist-sort');

test('distributions sort: every item sits in the bucket its distribution manifests put it in; the one custom component is in none', () => {
  const sort = SORT();
  assert.deepEqual(sort.buckets.map((b) => b.id), ['all-three', 'contrib-k8s', 'contrib-only', 'none']);
  assert.equal(sort.items.length, 9);
  for (const item of sort.items) assert.equal(item.bucket, bucketFor(item.id), item.id);
  assert.deepEqual(sort.items.map((i) => i.bucket).sort(), ['all-three', 'all-three', 'all-three', 'contrib-k8s', 'contrib-k8s', 'contrib-k8s', 'contrib-only', 'contrib-only', 'none']);
});

test('distributions sort: k8sattributes is in contrib and k8s, not core; batch, memory_limiter and otlp are in core; the item copy says so', () => {
  const by = (id) => SORT().items.find((i) => i.id === id);
  const k8s = plain(by('k8sattributes').why);
  for (const w of ['contrib', 'k8s', 'not core']) assert.equal(k8s.includes(w), true, w);
  for (const id of ['batch', 'memory-limiter', 'otlp-exporter']) assert.equal(/core/.test(plain(by(id).why)), true, id);
  assert.equal(/Kubernetes|OTLP/.test(plain(by('awss3-exporter').whyNot['contrib-k8s'])), true, 'the k8s distribution only has OTLP exporters (plus nop, debug, file)');
  assert.equal(/ocb|OCB|build/.test(plain(by('acme-scrubber').why)), true, 'a component nobody ships is built with OCB');
});

test('distributions sort: every wrong bucket a player can pick says why not', () => {
  for (const item of SORT().items) {
    const wrong = SORT().buckets.map((b) => b.id).filter((b) => b !== item.bucket);
    assert.deepEqual(Object.keys(item.whyNot ?? {}).sort(), wrong.sort(), item.id);
  }
});

test('distributions: a component nobody ships is built in with OCB, from a manifest listing the components', () => {
  const right = rightOf(DIST, 'dist-build');
  assert.equal(right.key, 'ocb');
  const text = plain(right.label + right.why);
  for (const w of ['OpenTelemetry Collector Builder', 'manifest', 'custom', 'smaller']) assert.equal(text.includes(w), true, w);
  assert.deepEqual(keysOf(DIST, 'dist-build'), ['contrib-config', 'ocb', 'otlp-distro']);
});

// ---- facts and sources --------------------------------------------------------------

test('the 5.5 and 5.6 level files cite the pages their facts come from, and never say "the spec says"', () => {
  const urls = (f) =>
    read(`levels/${f}.mjs`).split('\n').filter((l) => /^\/\/ (Spec|Docs|Dash0 docs)[^:]*: /.test(l)).flatMap((l) => l.match(/https:\/\/[^\s,]+/g) ?? []);
  const ottl = urls(OTTL);
  for (const u of [
    'https://opentelemetry.io/docs/collector/transforming-telemetry/',
    'https://opentelemetry.io/docs/collector/components/processor/',
    'https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/processor/transformprocessor/README.md',
    'https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/processor/attributesprocessor/README.md',
    'https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/processor/redactionprocessor/README.md',
    'https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/pkg/ottl/ottlfuncs/README.md',
    'https://www.dash0.com/docs/dash0/cost-control/spam-filters',
  ]) assert.equal(ottl.includes(u), true, u);
  const dist = urls(DIST);
  for (const u of [
    'https://opentelemetry.io/docs/collector/distributions/',
    'https://opentelemetry.io/docs/collector/extend/ocb/',
    'https://opentelemetry.io/docs/collector/components/processor/',
    'https://github.com/open-telemetry/opentelemetry-collector-releases/blob/main/distributions/otelcol/manifest.yaml',
    'https://github.com/open-telemetry/opentelemetry-collector-releases/blob/main/distributions/otelcol-contrib/manifest.yaml',
    'https://github.com/open-telemetry/opentelemetry-collector-releases/blob/main/distributions/otelcol-k8s/manifest.yaml',
  ]) assert.equal(dist.includes(u), true, u);
  for (const f of [OTTL, DIST]) {
    const src = read(`levels/${f}.mjs`);
    assert.equal(/\bthe spec says\b/i.test(src), false, f);
    assert.equal(/^\/\/ Spec: https:\/\/opentelemetry\.io\//m.test(src), true, `${f} has a Spec line on opentelemetry.io`);
    assert.equal(src.includes('—'), false, `${f} has no em dash`);
  }
});
