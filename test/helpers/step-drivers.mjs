// One driver per play step type (docs/DECLARATIVE-LEVELS.md §4), all derived from the step's
// spec, so a generated test can play any declarative level without a hand-written driver.
//   solve(spec) -> click[]      clicks that finish the step cleanly; a click is a selector, or
//                  {type: selector, text} to type `text` into a field (test/helpers/dom.mjs click)
//   slips(spec) -> [{name, clicks, says, at?}]  each costs exactly one penalty; `says` matches the
//                  text of `at` (default `#<id>-feedback`) afterwards
//   first(spec) -> focus name the step starts on (test/helpers/focus.mjs names)
//   answerKey(spec) -> string   the spec's answer as one line, for test/answers.test.mjs
// Adding a step type to lib/play.mjs means adding its driver here (test/play.test.mjs checks).
import { STEP_TYPES } from '../../lib/play.mjs';
import { isLogMode } from '../../lib/widgets/build-it.mjs';
import { waterfall } from '../../lib/widgets/trace.mjs';
import { allPlans, evaluatePlan } from '../../lib/widgets/trade-off.mjs';

const own = (o, k) => Object.hasOwn(o, k);
const NOT_QUITE = /^Not quite\./;

const choice = {
  solve: (s) => [`[data-pick="${s.choices.find((c) => c.right).key}"]`],
  slips: (s) =>
    s.choices.filter((c) => !c.right).map((c) => ({ name: `pick ${c.key}`, clicks: [`[data-pick="${c.key}"]`], says: NOT_QUITE })),
  first: (s) => `pick:${s.choices[0].key}`,
  answerKey: (s) => `choice ${s.id}: ${s.choices.find((c) => c.right).key}`,
};

const sort = {
  solve: (s) => s.items.flatMap((it) => [`[data-item="${it.id}"]`, `[data-bucket="${it.bucket}"]`]),
  slips: (s) =>
    s.items.map((it) => ({
      name: `${it.id} in ${s.buckets.find((b) => b.id !== it.bucket).id}`,
      clicks: [`[data-item="${it.id}"]`, `[data-bucket="${s.buckets.find((b) => b.id !== it.bucket).id}"]`],
      says: NOT_QUITE,
    })),
  first: (s) => `item:${s.items[0].id}`,
  answerKey: (s) => `sort ${s.id}: ${s.items.map((it) => `${it.id}=${it.bucket}`).join(' ')}`,
};

const FIELDS = [['parentId', 'parent', 'parent'], ['kind', 'kind', 'kind'], ['status', 'status', 'status']];

// Logs mode: every record is set explicitly (select it, then its span or "No span context"),
// so no step depends on the given state.
const attachClicks = (id, spanId) => [`[data-log="${id}"]`, `[data-attach="${spanId ?? 'none'}"]`];

const buildLogs = {
  solve: (s) => [...s.logs.flatMap((l) => attachClicks(l.id, s.answer[l.id])), `#${s.id}-check`],
  slips(s) {
    // `orphan`: every record right except the first one that has a span, which is left without
    // span context. Later clicks of solve() overwrite every record, so the slip leaves no trace.
    const first = s.logs.find((l) => s.answer[l.id] !== null);
    return [
      { name: 'check', clicks: [`#${s.id}-check`], says: /^Not quite:/ },
      ...(first === undefined
        ? []
        : [{
            name: 'orphan',
            clicks: [...s.logs.flatMap((l) => attachClicks(l.id, l === first ? null : s.answer[l.id])), `#${s.id}-check`],
            says: /^Not quite: 1 problem\./,
          }]),
      ...(s.hint === undefined ? [] : [{ name: 'hint', clicks: [`#${s.id}-hint`], says: /\S/, at: `#${s.id}-hint-text` }]),
    ];
  },
  first: (s) => `log:${s.logs[0].id}`,
  answerKey: (s) => `build ${s.id}: ${s.logs.map((l) => `${l.id}=${s.answer[l.id] ?? 'none'}`).join(' ')}`,
};

const buildSpans = {
  solve(s) {
    const span = (id) => `[data-span="${id}"]`;
    const set = (id, attr, value) => [span(id), `[data-${attr}="${value}"]`];
    const rows = Object.entries(s.answer);
    // Every answered parent goes to root first, so no intermediate edit can make a loop.
    const roots = rows.filter(([, w]) => own(w, 'parentId')).flatMap(([id]) => set(id, 'parent', 'none'));
    const edits = rows.flatMap(([id, w]) => {
      const given = s.spans.find((x) => x.spanId === id);
      const links = own(w, 'links')
        ? [...w.links.filter((l) => !given.links.includes(l)), ...given.links.filter((l) => !w.links.includes(l))]
        : [];
      return [
        ...(own(w, 'parentId') ? set(id, 'parent', w.parentId ?? 'none') : []),
        ...(own(w, 'kind') ? set(id, 'kind', w.kind) : []),
        ...(own(w, 'status') ? set(id, 'status', w.status) : []),
        ...links.flatMap((l) => set(id, 'link', l)),
      ];
    });
    return [...roots, ...edits, `#${s.id}-check`];
  },
  slips: (s) => [
    { name: 'check', clicks: [`#${s.id}-check`], says: /^Not quite:/ },
    ...(s.hint === undefined ? [] : [{ name: 'hint', clicks: [`#${s.id}-hint`], says: /\S/, at: `#${s.id}-hint-text` }]),
  ],
  first: (s) => `span:${waterfall(s.spans).rows[0].spanId}`,
  answerKey: (s) =>
    `build ${s.id}: ${Object.entries(s.answer)
      .flatMap(([id, w]) => [
        ...FIELDS.filter(([k]) => own(w, k)).map(([k, name]) => `${id}.${name}=${w[k] ?? 'none'}`),
        ...(own(w, 'links') ? [`${id}.links=${[...w.links].sort().join('+') || 'none'}`] : []),
      ])
      .join(' ')}`,
};

const build = {
  solve: (s) => (isLogMode(s) ? buildLogs : buildSpans).solve(s),
  slips: (s) => (isLogMode(s) ? buildLogs : buildSpans).slips(s),
  first: (s) => (isLogMode(s) ? buildLogs : buildSpans).first(s),
  answerKey: (s) => (isLogMode(s) ? buildLogs : buildSpans).answerKey(s),
};

const clues = (s) => s.views.filter((v) => v.kind === 'clue').slice(0, s.answerAfterViews).map((v) => v.id);
const openClues = (s) => clues(s).map((id) => `[data-view="${id}"]`);

const incident = {
  solve: (s) => [...openClues(s), `[data-hypothesis="${s.hypotheses.find((h) => h.right).id}"]`],
  slips(s) {
    const herring = s.views.find((v) => v.kind === 'herring');
    const wrong = s.hypotheses.find((h) => !h.right);
    return [
      // Opens speak in the status bar, picks in the feedback (D7, #143).
      ...(herring ? [{ name: `view ${herring.id}`, clicks: [`[data-view="${herring.id}"]`], says: /was misleading/, at: `#${s.id}-status` }] : []),
      ...(wrong ? [{ name: `guess ${wrong.id}`, clicks: [...openClues(s), `[data-hypothesis="${wrong.id}"]`], says: NOT_QUITE }] : []),
      { name: 'hint', clicks: [`#${s.id}-hint`], says: /\S/, at: `#${s.id}-hint-text` },
    ];
  },
  first: (s) => `view:${s.views[0].id}`,
  answerKey: (s) => `incident ${s.id}: ${clues(s).join(',')} > ${s.hypotheses.find((h) => h.right).id}`,
};

const spotCheck = (s) => `#${s.id}-check`;
const spotPick = (ids) => ids.map((id) => `[data-line="${id}"]`);

const spot = {
  solve: (s) => [...spotPick(s.faults), spotCheck(s)],
  slips(s) {
    const other = s.lines.find((l) => !s.faults.includes(l.id)).id;
    // Each slip unselects its pick afterwards, so solve() starts from an empty selection.
    const slip = (name, id) => ({ name, clicks: [...spotPick([id]), spotCheck(s), ...spotPick([id])], says: NOT_QUITE });
    return [
      slip(`pick ${other}`, other),
      // Part of a multi-fault set is still wrong.
      ...(s.faults.length > 1 ? [slip(`only ${s.faults[0]}`, s.faults[0])] : []),
      // A hint changes no pick, so solve() still starts from an empty selection.
      ...(s.helps?.hints ? [{ name: 'hint', clicks: [`#${s.id}-hint`], says: /\S/, at: `#${s.id}-hint-text` }] : []),
    ];
  },
  first: (s) => `line:${s.lines[0].id}`,
  answerKey: (s) => `spot ${s.id}: ${s.lines.map((l) => l.id).filter((id) => s.faults.includes(id)).join(',')}`,
};

const tradeoffPick = (picks) => Object.entries(picks).map(([knob, option]) => `[data-knob="${knob}"] [data-option="${option}"] input`);

const tradeoff = {
  solve: (s) => [...tradeoffPick(s.answer), `#${s.id}-check`],
  slips(s) {
    // validateTradeoffSpec guarantees both exist: a plan that keeps every need but is over the
    // cap, and one within the cap that drops a need. Picks stay set; solve() overwrites them all.
    const evaluated = allPlans(s).map((picks) => ({ picks, ...evaluatePlan(s, picks) }));
    const over = evaluated.find((p) => p.over > 0 && p.lost.length === 0);
    const lost = evaluated.find((p) => p.over === 0 && p.lost.length > 0);
    const slip = (name, p, says) => ({ name, clicks: [...tradeoffPick(p.picks), `#${s.id}-check`], says });
    return [
      slip('over the cap', over, /^Not quite\. Over the cap by/),
      slip('drops a need', lost, /^Not quite\. It is within the cap but drops/),
      // A hint changes no pick, so solve() still overwrites every knob.
      ...(s.helps?.hints ? [{ name: 'hint', clicks: [`#${s.id}-hint`], says: /^Hint 1 of 3/, at: `#${s.id}-hint-text` }] : []),
    ];
  },
  first: () => 'input',
  answerKey: (s) => `tradeoff ${s.id}: ${s.knobs.map((k) => `${k.id}=${s.answer[k.id]}`).join(' ')}`,
};

const query = {
  solve: (s) => [{ type: `#${s.id}-input`, text: s.reference }, `#${s.id}-run`],
  // `(reference) + 1` is valid, has the reference's series and never its values.
  slips: (s) => [
    {
      name: 'right shape, wrong values',
      clicks: [{ type: `#${s.id}-input`, text: `(${s.reference}) + 1` }, `#${s.id}-run`],
      says: /^Not quite\. Right shape, wrong values\./,
    },
  ],
  first: (s) => `#${s.id}-input`,
  answerKey: (s) => `query ${s.id}: ${s.dataset}@${s.at} ${s.reference}`,
};

const configure = {
  solve: (s) => [{ type: `#${s.id}-input`, text: s.reference }, `#${s.id}-check`],
  // The reference plus an unknown top-level key: it parses, so the checker (not the parser) fails it.
  // Named 'check' so the generated suite also proves a repeated Check on the same text is free.
  slips: (s) => [
    {
      name: 'check',
      clicks: [{ type: `#${s.id}-input`, text: `${s.reference}\nzz-unknown: 1\n` }, `#${s.id}-check`],
      says: /^Not quite\. The Collector would not accept this config: 1 problem\./,
    },
  ],
  first: (s) => `#${s.id}-input`,
  answerKey: (s) => `configure ${s.id}: ${s.reference.replace(/\s+/g, ' ').trim()}`,
};

export const STEP_DRIVERS = { choice, sort, build, incident, spot, tradeoff, query, configure };

/** A play level's steps as `{step, key, spec, type, driver}` in order. */
export function stepsOf(level) {
  return level.play.steps.map((step) => {
    const key = Object.keys(STEP_TYPES).find((k) => Object.hasOwn(step, k));
    return { step, key, spec: step[key], type: STEP_TYPES[key], driver: STEP_DRIVERS[key] };
  });
}
