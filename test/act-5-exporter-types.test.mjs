// Act 5 teaches the Collector's exporter types as `otlp_grpc` and `otlp_http` (the names since
// Collector v0.144.0, #14403 and #14396); `otlp` and `otlphttp` are deprecated aliases that still
// resolve, said once in level 5.1 and once on the otlp-ports-and-paths card, with the one pinned
// version v0.164.0. Receivers stay `otlp`; the `otlp` distribution name is unchanged.
// Asserts strings and booleans only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DECK } from '../cards/deck.mjs';
import { liveRegistry } from '../app.mjs';
import { checkConfig } from '../lib/configure/check.mjs';
import { COLLECTOR_SCHEMA } from '../lib/configure/collector.mjs';

const LIVE = liveRegistry();
const ACT_5 = ['pipelines', 'order-matters', 'otlp-endpoints', 'agent-vs-gateway', 'ottl-and-transforms', 'distributions', 'silence'];
const CARDS = ['otlp-ports-and-paths', 'not-every-component'];
const plain = (html) => html.replace(/<[^>]+>/g, '');
const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const stepWith = (levelId, key) => LIVE.levels[levelId].play.steps.find((s) => s[key] !== undefined)[key];
const card = (id) => DECK.find((c) => c.id === id);

const LEVEL_SENTENCE =
  'In Collector v0.164.0 the OTLP gRPC exporter is <code>otlp_grpc</code> and the OTLP HTTP exporter is <code>otlp_http</code>; ' +
  '<code>otlp</code> and <code>otlphttp</code> are deprecated aliases that still resolve, and every config in this act uses the new names.';
const CARD_SENTENCE =
  'In Collector v0.164.0 otlp and otlphttp are deprecated aliases for these two exporter types and still resolve.';

// The old exporter spellings: an id such as otlp/dash0, or the HTTP type otlphttp (URLs are not copy).
const OLD_NAME = /\botlp\/[\w-]|\botlphttp\b/;
const withoutUrls = (text) => text.replace(/https?:\/\/\S+/g, '');

test('5.1 says once that otlp and otlphttp are deprecated aliases that still resolve, with the pinned version', () => {
  const explain = stepWith('pipelines', 'configure').explain;
  assert.equal(explain.includes(LEVEL_SENTENCE), true);
  assert.equal(plain(explain).includes('otlp_grpc'), true);
  for (const id of ACT_5.filter((l) => l !== 'pipelines')) {
    assert.equal(/<code>otlp<\/code> and [^"]{0,80}deprecated alias/.test(JSON.stringify(LIVE.levels[id])), false, `${id} does not repeat the alias note`);
  }
});

test('the otlp-ports-and-paths card says the alias sentence once, and the distributions card names otlp_grpc', () => {
  const back = card('otlp-ports-and-paths').back;
  assert.equal(back.includes(CARD_SENTENCE), true);
  assert.equal(back.includes('otlp_http exporter'), true);
  assert.equal(back.includes('otlp_grpc'), true);
  assert.equal(card('not-every-component').back.includes('the otlp_grpc exporter are in core'), true);
  assert.equal(/otlp[^.]{0,40}deprecated alias/.test(card('not-every-component').back), false);
});

test('no Act 5 level or the two cards uses otlp/ or otlphttp as an exporter id, except inside the one alias sentence per place', () => {
  const texts = [];
  for (const id of ACT_5) texts.push([`level ${id}`, JSON.stringify(LIVE.levels[id]).split(JSON.stringify(LEVEL_SENTENCE).slice(1, -1)).join('')]);
  for (const id of CARDS) texts.push([`card ${id}`, JSON.stringify(card(id)).split(CARD_SENTENCE).join('')]);
  for (const id of ACT_5) {
    const comments = read(`levels/${id}.mjs`).split('\n').filter((l) => l.startsWith('//')).join('\n');
    texts.push([`comments of ${id}`, comments]);
  }
  for (const [where, text] of texts) {
    const hit = withoutUrls(text).match(OLD_NAME);
    assert.equal(hit, null, `${where} still uses ${hit && hit[0]}`);
  }
});

test('every Act 5 config (given and reference) defines its exporters as otlp_grpc or otlp_http, never the old types', () => {
  let seen = 0;
  for (const id of ACT_5) {
    for (const step of LIVE.levels[id].play.steps) {
      if (step.configure === undefined) continue;
      for (const field of ['given', 'reference']) {
        const exporters = Object.keys(checkConfig(step.configure[field], COLLECTOR_SCHEMA).doc.exporters ?? {});
        for (const key of exporters) {
          seen += 1;
          assert.equal(['otlp', 'otlphttp'].includes(key.split('/')[0]), false, `${id} ${field}: exporter ${key}`);
        }
      }
    }
  }
  assert.equal(seen > 10, true, `looked at ${seen} exporters`);
});

test('receivers stay otlp, and the otlp distribution keeps its name', () => {
  assert.equal(stepWith('pipelines', 'configure').reference.includes('receivers: [otlp]'), true);
  assert.equal(card('not-every-component').back.includes('core, contrib, k8s, otlp and an eBPF profiling one'), true);
});
