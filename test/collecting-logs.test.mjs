// Level 4.3 Collecting logs beyond the generated play-through (test/play.test.mjs,
// test/answers.test.mjs): level fields and lights, the card, the configure step (the checker's
// verdicts on the given and the reference, and every shortcut run through the real runConfigure),
// the settings the reference carries (checked by running its patterns on the sample lines), and the
// facts each Choice step states (docs/OUTLINE.md §4 Act 4, 4.3). Asserts strings, numbers and
// booleans only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DECK } from '../cards/deck.mjs';
import { EDGES, NODES } from '../hub/map-data.mjs';
import { liveRegistry } from '../app.mjs';
import { emptyProgress } from '../lib/progress.mjs';
import { nodeStates } from '../lib/map.mjs';
import { levelState } from '../lib/unlock.mjs';
import { checkConfig } from '../lib/configure/check.mjs';
import { COLLECTOR_SCHEMA } from '../lib/configure/collector.mjs';
import { newConfigureState, runConfigure } from '../lib/widgets/configure-it.mjs';

const LIVE = liveRegistry();
const ID = 'collecting-logs';
const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const plain = (html) => html.replace(/<[^>]+>/g, '');
const steps = () => LIVE.levels[ID].play.steps;
const stepOf = (key, widgetId) => steps().find((s) => s[key] && s[key].id === widgetId);
const choiceOf = (widgetId) => stepOf('choice', widgetId).choice.choices;
const rightOf = (widgetId) => choiceOf(widgetId).find((c) => c.right);
const wrongKeys = (widgetId) => choiceOf(widgetId).filter((c) => !c.right).map((c) => c.key).sort();
const config = () => stepOf('configure', 'col-config').configure;
const docOf = (text) => checkConfig(text, COLLECTOR_SCHEMA).doc;

// ---- fields, lights, card -----------------------------------------------------------

test('collecting-logs: level fields, derived mechanics (configure only; Choice has none), scored, no par time', () => {
  const level = LIVE.levels[ID];
  assert.deepEqual(
    {
      no: level.no, name: level.name, kind: level.kind, actId: level.actId, mechanics: [...level.mechanics],
      cards: [...level.cards], lights: [...level.lights], scored: level.scored, parMs: level.scoring.parMs,
    },
    {
      no: '4.3', name: 'Collecting logs', kind: 'level', actId: 'act-4', mechanics: ['configure'],
      cards: ['filelog-tails-files'], lights: ['shipping'], scored: true, parMs: null,
    },
  );
  assert.deepEqual(
    steps().map((s) => Object.keys(s).find((k) => ['choice', 'configure'].includes(k))),
    ['choice', 'configure', 'choice', 'choice', 'choice'],
  );
});

test('collecting-logs: lights Shipping (shared with 3.4: a node lit by either level), and opens like its act mates', () => {
  const lit = (done) => {
    const p = emptyProgress();
    for (const id of done) p.levels[id] = { stars: 3, at: null };
    const s = nodeStates(LIVE, p, NODES, EDGES);
    return NODES.filter((n) => s.nodes[n.id].lit).map((n) => n.id).sort();
  };
  assert.deepEqual(lit([]), []);
  assert.deepEqual(lit([ID]), ['shipping']);
  assert.deepEqual(lit(['promql-basics']), ['shipping']);
  const entered = emptyProgress();
  entered.levels['structured-logs'] = { stars: 3, at: null };
  assert.equal(levelState(ID, entered, LIVE), 'open', 'levels open in any order once the act is entered');
});

const CARD = {
  id: 'filelog-tails-files',
  front: 'filelog tails files from the end by default and splits on newlines; multiline needs a pattern for where an entry starts.',
  back:
    'The filelog receiver (contrib and Kubernetes distributions, beta for logs) reads the files that match include. start_at ' +
    'defaults to end, so lines already in a file are skipped unless you set beginning. Entries split at newlines unless ' +
    'multiline gives a line_start_pattern or a line_end_pattern, which is how a stack trace stays one record; the split happens ' +
    'as the file is read, before any operator runs. Operators such as json_parser and regex_parser turn each entry into fields, ' +
    'and an embedded severity block sets the severity. Like any component it does nothing until a logs pipeline lists it. For ' +
    'code you own, exporting over OTLP with a log appender needs no files and no parsing, and carries the trace context.',
  specUrl: 'https://opentelemetry.io/docs/specs/otel/logs/',
  dash0Angle:
    'Dash0 Log AI infers a severity and extracts patterns from unstructured logs as they are ingested. It keeps a severity ' +
    'that is already set and leaves structured JSON logs to JSON log processing.',
};

test('collecting-logs card: front, back, spec URL and Dash0 angle are pinned; the front fits a card (<=140)', () => {
  assert.deepEqual(DECK.find((c) => c.id === CARD.id), CARD);
  assert.equal(CARD.front.length <= 140, true, `front is ${CARD.front.length} characters`);
});

// ---- step 1: stdout JSON vs OTLP export ---------------------------------------------

test('route: orders (code the team owns) should export over OTLP through an appender; tailing a file does not add trace context', () => {
  const right = rightOf('col-route');
  assert.equal(right.key, 'otlp-appender');
  const text = plain(right.label + right.why);
  for (const w of ['OTLP', 'appender', 'TraceId', 'SpanId', 'parse', 'tail']) assert.equal(text.includes(w), true, w);
  assert.equal(/cannot change|can.t change|change to the app/.test(right.why), true, 'the cost of the route is named');
  assert.deepEqual(wrongKeys('col-route'), ['otlp-no-logs', 'tail-adds-context']);
  const tail = choiceOf('col-route').find((c) => c.key === 'tail-adds-context');
  assert.equal(/only if the application wrote/.test(tail.why) && /time/.test(tail.why), true, 'a file line has no context of its own');
  const none = choiceOf('col-route').find((c) => c.key === 'otlp-no-logs');
  assert.equal(/carries logs/.test(none.why), true, 'OTLP carries logs too');
});

// ---- step 2: the configure step -----------------------------------------------------

test('config: the given does not start (the logs pipeline names "filelog", which is not defined); the reference starts and flows both pipelines', () => {
  const spec = config();
  const given = checkConfig(spec.given, COLLECTOR_SCHEMA);
  assert.equal(given.ok, false);
  assert.deepEqual(given.errors.map((e) => `${e.kind} ${e.path}`), ['unknown-ref service.pipelines.logs.receivers[0]']);
  assert.deepEqual(Object.keys(given.doc.receivers), ['otlp', 'filelog/shipping'], 'the receiver is defined as filelog/shipping');
  const ref = checkConfig(spec.reference, COLLECTOR_SCHEMA);
  assert.equal(ref.ok, true);
  assert.equal(ref.verdict.flowing, true);
  assert.deepEqual(ref.verdict.pipelines.map((p) => `${p.name}=${p.flowing}`), ['traces=true', 'logs=true']);
  assert.deepEqual(ref.verdict.inactive, [], 'nothing defined is left unused');
  assert.equal(Object.hasOwn(spec, 'target'), false, '`uses` names the logs pipeline, so it is also the target');
});

test('config: `uses` requires the logs pipeline to list filelog/shipping and the Dash0 exporter', () => {
  assert.deepEqual(config().uses, { logs: ['filelog/shipping', 'otlp/dash0'] });
  const logs = docOf(config().reference).service.pipelines.logs;
  assert.deepEqual(logs.receivers, ['filelog/shipping']);
  assert.deepEqual(logs.exporters, ['otlp/dash0']);
  assert.deepEqual(docOf(config().reference).service.pipelines.traces.receivers, ['otlp'], 'traces keeps the OTLP receiver');
});

const cases = () => {
  const ref = config().reference;
  const swap = (from, to) => {
    assert.equal(ref.includes(from), true, `the reference has "${from}"`);
    return ref.replace(from, to);
  };
  return {
    // The logs pipeline reads OTLP instead: the Collector starts, the file is never read.
    'delete the receiver from the logs pipeline': swap('      receivers: [filelog/shipping]', '      receivers: [otlp]'),
    // Remove the logs pipeline altogether.
    'delete the logs pipeline': ref.replace(/ {4}logs:\n(?: {6}.*\n)+/, ''),
    // The filelog receiver moves to the traces pipeline and logs reads OTLP.
    'wrong pipeline: filelog in traces, otlp in logs': swap('      receivers: [otlp]\n      processors: [batch]\n      exporters: [otlp/dash0]\n    logs:\n      receivers: [filelog/shipping]', '      receivers: [otlp, filelog/shipping]\n      processors: [batch]\n      exporters: [otlp/dash0]\n    logs:\n      receivers: [otlp]'),
    // Rename the definition to match the pipeline's spelling: valid, but not the receiver the task names.
    'rename the receiver to filelog': swap('  filelog/shipping:', '  filelog:').replace('receivers: [filelog/shipping]', 'receivers: [filelog]'),
    // A different exporter: the logs never reach Dash0.
    'export logs to debug': swap('  otlp/dash0:\n', '  debug:\n  otlp/dash0:\n').replace(/(logs:\n(?: {6}.*\n)*? {6}exporters: )\[otlp\/dash0\]/, '$1[debug]'),
  };
};

test('config shortcuts: each passes the Collector\'s own checker, and each is still wrong (reason uses or target), once', () => {
  const spec = config();
  const got = {};
  for (const [name, text] of Object.entries(cases())) {
    const r = runConfigure(spec, newConfigureState(), text);
    got[name] = `${r.outcome}/${r.reason}/${(r.unmet ?? []).join()}`;
    assert.equal(checkConfig(text, COLLECTOR_SCHEMA).ok, true, `${name}: the Collector would start`);
    assert.equal(runConfigure(spec, r.state, text).outcome, 'repeat', `${name}: the same text again is free`);
  }
  assert.deepEqual(got, {
    'delete the receiver from the logs pipeline': 'wrong/uses/logs',
    'delete the logs pipeline': 'wrong/target/logs',
    'wrong pipeline: filelog in traces, otlp in logs': 'wrong/uses/logs',
    'rename the receiver to filelog': 'wrong/uses/logs',
    'export logs to debug': 'wrong/uses/logs',
  });
});

test('config shortcut: moving the receiver and leaving the logs pipeline pointing at "filelog" is a config the Collector refuses', () => {
  const text = config().given.replace('      receivers: [otlp]\n', '      receivers: [otlp, filelog/shipping]\n');
  const r = runConfigure(config(), newConfigureState(), text);
  assert.deepEqual({ outcome: r.outcome, reason: r.reason }, { outcome: 'wrong', reason: 'invalid' });
});

test('config: the reference passes; the given is wrong (invalid); a wrong try then the reference is right', () => {
  const spec = config();
  const first = runConfigure(spec, newConfigureState(), spec.given);
  assert.deepEqual({ outcome: first.outcome, reason: first.reason }, { outcome: 'wrong', reason: 'invalid' });
  assert.equal(runConfigure(spec, first.state, spec.reference).outcome, 'right');
});

test('config: the settings are taught but not graded: the reference without multiline and operators still passes (as the copy says)', () => {
  const bare = config().reference.replace(/ {4}start_at: beginning\n {4}multiline:\n(?: {6}.*\n)+ {4}operators:\n(?: {6,}.*\n)+(?=processors:)/, '');
  assert.equal(bare.includes('multiline'), false, 'the settings are gone');
  assert.equal(runConfigure(config(), newConfigureState(), bare).outcome, 'right');
  const text = plain(config().explain);
  for (const w of ['checks the wiring, not the settings', 'include', 'start_at', 'multiline', 'operators', 'contrib']) {
    assert.equal(text.includes(w), true, w);
  }
});

test('config: the receiver is read from the start of the file, split on timestamps and parsed with a regex_parser that sets severity', () => {
  const r = docOf(config().reference).receivers['filelog/shipping'];
  assert.deepEqual(r.include, ['/var/log/shipping/agent.log']);
  assert.equal(r.start_at, 'beginning');
  assert.deepEqual(Object.keys(r.multiline), ['line_start_pattern'], 'exactly one of line_start_pattern and line_end_pattern');
  assert.equal(r.operators.length, 1);
  assert.deepEqual({ type: r.operators[0].type, parseFrom: r.operators[0].severity.parse_from }, { type: 'regex_parser', parseFrom: 'attributes.sev' });
});

// A Go (RE2) pattern in JS: (?P<n>..) is (?<n>..), and a leading (?s) is the s flag.
const asJs = (re) => new RegExp(re.replace(/^\(\?s\)/, '').replace(/\(\?P</g, '(?<'), re.startsWith('(?s)') ? 's' : '');

const SAMPLE = () => steps().find((s) => s.code !== undefined).code.split('\n');
const entries = (startPattern) => {
  const out = [];
  for (const line of SAMPLE()) {
    if (out.length === 0 || startPattern.test(line)) out.push([line]);
    else out[out.length - 1].push(line);
  }
  return out;
};

test('multiline: the reference line_start_pattern keeps the stack trace as one entry of four lines; a frame pattern glues the next record on', () => {
  const start = asJs(docOf(config().reference).receivers['filelog/shipping'].multiline.line_start_pattern);
  assert.deepEqual(entries(start).map((e) => e.length), [4, 1]);
  assert.equal(entries(start)[1][0].includes('INFO'), true);
  const frames = entries(/^\s+at /);
  assert.equal(frames.length, 3, 'a frame pattern cuts the trace into pieces');
  assert.equal(frames[2].some((l) => l.includes('INFO reconnecting')), true, 'and glues the next record onto the last frame');
});

test('regex_parser: the reference regex reads time, level and message from a whole multiline entry; without (?s) it misses it', () => {
  const regex = docOf(config().reference).receivers['filelog/shipping'].operators[0].regex;
  assert.equal(regex.startsWith('(?s)'), true);
  const entry = entries(asJs(docOf(config().reference).receivers['filelog/shipping'].multiline.line_start_pattern))[0].join('\n');
  const m = asJs(regex).exec(entry);
  assert.deepEqual(
    { time: m.groups.time, sev: m.groups.sev, first: m.groups.msg.split('\n')[0], lines: m.groups.msg.split('\n').length },
    { time: '2026-11-01 03:07:41', sev: 'ERROR', first: 'label printer offline: port 9100 refused', lines: 4 },
  );
  assert.equal(asJs(regex.slice(4)).test(entry), false, 'without the s flag the . stops at the first newline');
});

// ---- steps 3 to 5 -------------------------------------------------------------------

test('multiline step: split where an entry starts (the timestamp), before any operator runs; the decoys are corrected', () => {
  const right = rightOf('col-multiline');
  assert.equal(right.key, 'line-start');
  const text = plain(right.label + right.why);
  for (const w of ['multiline', 'line_start_pattern', 'beginning of an entry', 'before any operator', 'line_end_pattern']) {
    assert.equal(text.includes(w), true, w);
  }
  assert.deepEqual(wrongKeys('col-multiline'), ['frame-pattern', 'parser-joins']);
  assert.equal(/already split/.test(choiceOf('col-multiline').find((c) => c.key === 'parser-joins').why), true);
  assert.equal(/every frame/.test(choiceOf('col-multiline').find((c) => c.key === 'frame-pattern').why), true);
});

test('parse step: shipping cannot be changed, so a regex_parser with a severity block in the Collector; the receiver reads no level on its own', () => {
  const right = rightOf('col-parse');
  assert.equal(right.key, 'collector-regex');
  const text = plain(right.label + right.why);
  for (const w of ['regex_parser', 'severity', '(?s)', 'Collector', 'cannot be changed']) assert.equal(text.includes(w), true, w);
  assert.equal(/own the code|an app you own/.test(right.why), true, 'where you own the code the source is the better place');
  assert.deepEqual(wrongKeys('col-parse'), ['agent-config', 'receiver-knows']);
  const knows = choiceOf('col-parse').find((c) => c.key === 'receiver-knows');
  assert.equal(/UNSPECIFIED/.test(knows.why) && /no severity number/.test(knows.why), true);
});

test('dash0 step: Log AI infers severity and extracts patterns for unstructured logs, and is bounded by what the docs say', () => {
  const right = rightOf('col-dash0');
  assert.equal(right.key, 'log-ai');
  const text = plain(right.label + right.why);
  for (const w of ['infers a severity', 'patterns', 'named attributes', 'never overrides', 'JSON', 'resource attributes', 'k8sattributes', 'dash0.log.pattern']) {
    assert.equal(text.includes(w), true, w);
  }
  assert.deepEqual(wrongKeys('col-dash0'), ['needs-parser', 'rewrites-all']);
  assert.equal(/does not wait/.test(choiceOf('col-dash0').find((c) => c.key === 'needs-parser').why), true);
  assert.equal(/respected/.test(choiceOf('col-dash0').find((c) => c.key === 'rewrites-all').why), true);
});

// ---- sources ------------------------------------------------------------------------

const specUrls = (src) =>
  src.split('\n').filter((l) => /^\/\/ Spec: /.test(l)).flatMap((l) => l.match(/https:\/\/[^\s,]+/g) ?? []);

test('the level file cites the pages its facts come from: Spec lines on opentelemetry.io, other hosts on their own labelled lines', () => {
  const src = read(`levels/${ID}.mjs`);
  const spec = specUrls(src);
  for (const u of [
    'https://opentelemetry.io/docs/specs/otel/logs/',
    'https://opentelemetry.io/docs/collector/components/receiver/',
    'https://opentelemetry.io/docs/collector/configuration/#receivers',
    'https://opentelemetry.io/docs/specs/otel/compatibility/logging_trace_context/',
  ]) assert.equal(spec.includes(u), true, u);
  for (const u of spec) assert.equal(new URL(u).host, 'opentelemetry.io', u);
  const other = src.split('\n').filter((l) => /^\/\/ (Collector contrib docs|Dash0 docs|RE2 syntax)/.test(l)).join('\n');
  for (const u of [
    'https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/receiver/filelogreceiver/README.md',
    'https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/pkg/stanza/docs/operators/regex_parser.md',
    'https://www.dash0.com/docs/dash0/telemetry/logging/log-ai-processing',
    'https://www.dash0.com/docs/dash0/telemetry/logging/log-severities',
    'https://github.com/google/re2/wiki/Syntax',
  ]) assert.equal(other.includes(u), true, u);
  assert.equal(/\bthe spec says\b/i.test(src), false);
});
