// Level 9.7 "Two vendors, one weekend" (Act 9, Vanuatu) beyond the generated play-through (test/play.test.mjs,
// test/answers.test.mjs, test/levels-play.test.mjs): the claim Choice, and the Configure step through the real grader
// (runConfigure, checkConfig, the collector schema) with the starting config, the reference and the plausible wrong
// fixes. Asserts strings, numbers and booleans only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { liveRegistry } from '../app.mjs';
import { describeError } from '../lib/configure/check.mjs';
import { newConfigureState, runConfigure } from '../lib/widgets/configure-it.mjs';

const ID = 'two-vendors-one-weekend';
const LIVE = liveRegistry();
const level = LIVE.levels[ID];
const [VERDICT_STEP, CONFIG_STEP] = level.play.steps;
const spec = CONFIG_STEP.configure;
const choices = VERDICT_STEP.choice.choices;
const SRC = readFileSync(new URL(`../levels/${ID}.mjs`, import.meta.url), 'utf8');
const plain = (html) => html.replace(/<[^>]+>/g, '');
const run = (text) => runConfigure(spec, newConfigureState(), text);
const verdict = (text) => {
  const r = run(text);
  return [r.outcome, r.reason ?? null, r.unmet ?? null];
};
const OLD = 'otlp_grpc/oldvendor';
const NEW = 'otlp_grpc/dash0';
const BOTH_LINE = `exporters: [${OLD}, ${NEW}]`;
const OLD_ONLY = `exporters: [${OLD}]`;
const DEFINE_NEW = [`  ${NEW}:`, '    endpoint: ${env:DASH0_ENDPOINT}', '    headers:', '      Authorization: "Bearer ${env:DASH0_AUTH_TOKEN}"', ''].join('\n');
const GIVEN = spec.given;
const REF = spec.reference;
// The given with the exporter defined, so the Collector starts; each probe below then edits the pipelines.
const DEFINED = GIVEN.replace('    endpoint: otlp.oldvendor.example:4317\n', `    endpoint: otlp.oldvendor.example:4317\n${DEFINE_NEW}`);
const withPipelines = (text, traces, metrics, logs) => {
  const lines = text.split('\n');
  let at = '';
  return lines.map((l) => {
    const m = /^ {4}(traces|metrics|logs):$/.exec(l);
    if (m) at = m[1];
    return /^ {6}exporters:/.test(l) ? `      exporters: [${{ traces, metrics, logs }[at].join(', ')}]` : l;
  }).join('\n');
};

test('9.7 fields: act-9, scored with no par time, lights the collector, no card, Choice then Configure it', () => {
  assert.deepEqual(
    { no: level.no, name: level.name, sub: level.sub, rewardTitle: level.rewardTitle, kind: level.kind, actId: level.actId, scored: level.scored, parMs: level.scoring.parMs },
    { no: '9.7', name: 'Two vendors, one weekend', sub: 'Does that answer hold?', rewardTitle: 'Fan-out engineer', kind: 'level', actId: 'act-9', scored: true, parMs: null },
  );
  assert.deepEqual([...level.cards], []);
  assert.deepEqual([...level.lights], ['collector']);
  assert.deepEqual([...level.mechanics], ['configure']);
  assert.deepEqual([...level.widgets], ['choice', 'configure']);
  assert.equal(spec.schema, 'collector');
});

// ---- step 1: the claim ----------------------------------------------------------------------

test('step 1 Choice: three answers, exactly one right ("copy"), labels of similar length, the right one neither first nor longest', () => {
  assert.deepEqual(choices.map((c) => c.key).sort(), ['copy', 'replaces', 'sdk']);
  assert.deepEqual(choices.filter((c) => c.right).map((c) => c.key), ['copy']);
  const lens = choices.map((c) => plain(c.label).length);
  assert.equal(Math.max(...lens) - Math.min(...lens) <= 10, true, `lengths ${lens.join(', ')}`);
  assert.equal(plain(choices.find((c) => c.right).label).length < Math.max(...lens), true, 'the right label is not the longest');
  assert.notEqual(choices[0].right, true, 'the right answer is not first');
  assert.match(plain(VERDICT_STEP.intro), /the old vendor stops getting data/);
  assert.match(plain(VERDICT_STEP.intro), /nothing else leaves them/);
});

test('step 1 whys: the right one quotes the architecture page, each wrong one says why it fails', () => {
  const by = Object.fromEntries(choices.map((c) => [c.key, plain(c.why)]));
  assert.equal(choices.filter((c) => plain(c.label).startsWith('It ')).length, 0, 'no opener shared by two answers, no "It holds" against "It is wrong"');
  assert.match(by.copy, /each exporter gets a copy of each data element/);
  assert.match(by.replaces, /list, not a single slot/);
  assert.match(by.sdk, /apps send OTLP only to the Collector/);
});

// ---- step 2: the config through the real grader -------------------------------------------------

test('the given does not start: the player is told which exporter is listed but not defined', () => {
  const r = run(GIVEN);
  assert.deepEqual([r.outcome, r.reason], ['wrong', 'invalid']);
  const lines = r.result.errors.map(describeError);
  assert.deepEqual(lines, ['service.pipelines.traces.exporters[0]: "otlp_grpc/dash0" is not defined under exporters or connectors']);
  assert.equal(GIVEN.includes('traces:\n      receivers: [otlp]\n      processors: [memory_limiter, batch]\n      exporters: [otlp_grpc/dash0]'), true, 'the teammate\'s change: traces lists Dash0 alone');
  assert.equal(GIVEN.split(OLD_ONLY).length - 1, 2, 'metrics and logs stay on the old vendor');
});

test('the reference lists both exporters in all three pipelines and defines the second from the environment', () => {
  assert.deepEqual(verdict(REF), ['right', null, null]);
  assert.equal(REF.split(BOTH_LINE).length - 1, 3, 'all three pipelines');
  assert.equal(REF.includes(OLD_ONLY), false);
  assert.equal(REF.includes('endpoint: ${env:DASH0_ENDPOINT}'), true);
  assert.equal(REF.includes('Authorization: "Bearer ${env:DASH0_AUTH_TOKEN}"'), true);
  assert.deepEqual({ ...spec.uses }, { traces: [OLD, NEW], metrics: [OLD, NEW], logs: [OLD, NEW] });
});

test('defining Dash0 and nothing else: the config is valid, and every pipeline still lacks a vendor', () => {
  const r = run(DEFINED);
  assert.equal(r.result.ok, true);
  assert.deepEqual([r.outcome, r.reason, r.unmet], ['wrong', 'uses', ['traces', 'metrics', 'logs']]);
});

test('traces only: restoring the old vendor beside Dash0 in traces leaves metrics and logs unmet', () => {
  const r = run(withPipelines(DEFINED, [OLD, NEW], [OLD], [OLD]));
  assert.deepEqual([r.outcome, r.reason, r.unmet], ['wrong', 'uses', ['metrics', 'logs']]);
});

test('a single signal missing is caught on its own: each of traces, metrics and logs is required', () => {
  const all = [OLD, NEW];
  assert.deepEqual(verdict(withPipelines(DEFINED, all, all, all)), ['right', null, null]);
  assert.deepEqual(verdict(withPipelines(DEFINED, [NEW], all, all)), ['wrong', 'uses', ['traces']]);
  assert.deepEqual(verdict(withPipelines(DEFINED, all, [OLD], all)), ['wrong', 'uses', ['metrics']]);
  assert.deepEqual(verdict(withPipelines(DEFINED, all, all, [OLD])), ['wrong', 'uses', ['logs']]);
});

test('replacing the old vendor is wrong: Dash0 in every pipeline, the old vendor in none, still fails on all three', () => {
  const r = run(withPipelines(DEFINED, [NEW], [NEW], [NEW]));
  assert.deepEqual([r.outcome, r.reason, r.unmet], ['wrong', 'uses', ['traces', 'metrics', 'logs']]);
});

test('defining Dash0 but not listing it anywhere does nothing: traces drop it, the grader asks for it', () => {
  const r = run(withPipelines(DEFINED, [OLD], [OLD], [OLD]));
  assert.deepEqual([r.outcome, r.reason, r.unmet], ['wrong', 'uses', ['traces', 'metrics', 'logs']]);
});

test('a new pipeline for Dash0 is valid but wrong here: it starts, and the existing pipelines still lack the exporter', () => {
  const extra = [
    '    traces/dash0:', '      receivers: [otlp]', '      processors: [batch]', `      exporters: [${NEW}]`, '',
  ].join('\n');
  const text = `${withPipelines(DEFINED, [OLD], [OLD], [OLD]).trimEnd()}\n${extra}`;
  const r = run(text);
  assert.equal(r.result.ok, true, 'the config is valid');
  assert.deepEqual([r.outcome, r.reason, r.unmet], ['wrong', 'uses', ['traces', 'metrics', 'logs']]);
  assert.match(plain(spec.explain), /traces\/dash0.*valid in a real Collector/);
});

// Review of 095ae4b, finding 1: `uses` once accepted the id in any stage and any section, so Dash0 defined and listed in
// the wrong place graded right while no exporter list ever named it.
const OLD_LISTS = REF.replace(DEFINE_NEW, '').replace(/exporters: \[otlp_grpc\/oldvendor, otlp_grpc\/dash0\]/g, OLD_ONLY);
const asSection = (section) => OLD_LISTS.replace('service:', `${section}:\n  ${NEW}:\nservice:`);

test('Dash0 defined and listed as a processor, every exporters list left on the old vendor: wrong, and the reference is still right', () => {
  const text = OLD_LISTS.replace('  batch:\n', `  batch:\n  ${NEW}:\n`).replace(/(processors: \[memory_limiter, batch)\]/g, `$1, ${NEW}]`);
  assert.equal(text.split(`batch, ${NEW}]`).length - 1, 3);
  const r = run(text);
  assert.equal(r.result.ok, true, 'a valid config that never sends to Dash0');
  assert.deepEqual([r.outcome, r.reason, r.unmet], ['wrong', 'uses', ['traces', 'metrics', 'logs']]);
  assert.equal(run(REF).outcome, 'right');
});

test('Dash0 defined under connectors and listed as a receiver: wrong', () => {
  const text = asSection('connectors').replace(/receivers: \[otlp\]/g, `receivers: [otlp, ${NEW}]`);
  const r = run(text);
  assert.equal(r.result.ok, true);
  assert.deepEqual([r.outcome, r.reason, r.unmet], ['wrong', 'uses', ['traces', 'metrics', 'logs']]);
});

test('Dash0 defined under connectors and listed as an exporter beside the old vendor: wrong, it must be defined under exporters', () => {
  const text = asSection('connectors').replace(/exporters: \[otlp_grpc\/oldvendor\]/g, `exporters: [${OLD}, ${NEW}]`);
  const r = run(text);
  assert.equal(r.result.ok, true);
  assert.deepEqual([r.outcome, r.reason, r.unmet], ['wrong', 'uses', ['traces', 'metrics', 'logs']]);
});

test('listing a name that is not defined under exactly that id fails to start: the wrong exporter id is invalid', () => {
  const r = run(REF.replace(`${NEW}:`, 'otlp_grpc/dash:'));
  assert.deepEqual([r.outcome, r.reason], ['wrong', 'invalid']);
  assert.equal(r.result.errors.length, 3, 'one per pipeline that still lists otlp_grpc/dash0');
});

test('the header form is not graded (the schema holds no component settings): the question and the explain state it instead', () => {
  const bare = run(REF.replace('Authorization: "Bearer ${env:DASH0_AUTH_TOKEN}"', 'token: ${env:DASH0_AUTH_TOKEN}'));
  assert.equal(bare.outcome, 'right', 'a wrong header key still passes: an accepted gap, said in the file header');
  assert.match(plain(CONFIG_STEP.question), /Authorization.*Bearer.*a space, then the token/);
  assert.match(plain(spec.explain), /the name is Authorization and the value is Bearer, a space and the token/);
  assert.match(plain(spec.explain), /checks the wiring, not the settings/);
});

test('the question asks for the existing pipelines, the explain says why a separate one fails here', () => {
  assert.match(plain(CONFIG_STEP.question), /in the existing pipelines/);
  assert.equal(/will not start|would not start/.test(SRC), false, 'no claim that is on neither cited page');
  assert.match(SRC, /blob\/v0\.164\.0\/exporter\/otlpexporter\/metadata\.yaml/);
  assert.match(SRC, /blob\/v0\.164\.0\/CHANGELOG\.md/);
  assert.match(plain(CONFIG_STEP.intro), /DASH0_ENDPOINT/);
  assert.match(plain(CONFIG_STEP.intro), /DASH0_AUTH_TOKEN/);
});

// ---- sources ------------------------------------------------------------------------------------

test('sources: the quoted sentences are on the spec lines, the hosts are allowed, no real vendor host, no pricing', () => {
  assert.match(SRC, /Spec: https:\/\/opentelemetry\.io\/docs\/collector\/architecture\//);
  assert.match(SRC, /Spec: .*https:\/\/opentelemetry\.io\/docs\/collector\/configuration\//);
  assert.equal(SRC.includes('Each exporter gets a copy of each data element."'), true);
  assert.equal(SRC.includes('"Configuring an exporter does not enable it.'), true);
  assert.equal(SRC.includes('"The use and expansion of environment variables is supported in the Collector configuration"'), true);
  assert.equal(/\b(price|pricing|per month|\$\d)/i.test(plain(JSON.stringify(level.play))), false, 'no pricing');
  const hosts = [...JSON.stringify(level.play).matchAll(/[a-z0-9.-]+\.(?:com|io|net|dev)\b/gi)].map((m) => m[0]);
  assert.deepEqual(hosts, [], 'no real hostname in the copy or the configs');
  assert.equal(SRC.includes(String.fromCharCode(0x2014)), false, 'no em dash');
});
