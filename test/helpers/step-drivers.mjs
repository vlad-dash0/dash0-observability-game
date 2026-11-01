// One driver per play step type (docs/DECLARATIVE-LEVELS.md §4), all derived from the step's
// spec, so a generated test can play any declarative level without a hand-written driver.
//   solve(spec) -> selector[]   clicks that finish the step cleanly
//   slips(spec) -> [{name, clicks, says, at?}]  each costs exactly one penalty; `says` matches the
//                  text of `at` (default `#<id>-feedback`) afterwards
//   first(spec) -> focus name the step starts on (test/helpers/focus.mjs names)
//   answerKey(spec) -> string   the spec's answer as one line, for test/answers.test.mjs
// Adding a step type to lib/play.mjs means adding its driver here (test/play.test.mjs checks).
import { STEP_TYPES } from '../../lib/play.mjs';
import { waterfall } from '../../lib/widgets/trace.mjs';

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

const build = {
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
    { name: 'check', clicks: [`#${s.id}-check`], says: /^Not yet:/ },
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

const clues = (s) => s.views.filter((v) => v.kind === 'clue').slice(0, s.answerAfterViews).map((v) => v.id);
const openClues = (s) => clues(s).map((id) => `[data-view="${id}"]`);

const incident = {
  solve: (s) => [...openClues(s), `[data-hypothesis="${s.hypotheses.find((h) => h.right).id}"]`],
  slips(s) {
    const herring = s.views.find((v) => v.kind === 'herring');
    const wrong = s.hypotheses.find((h) => !h.right);
    return [
      ...(herring ? [{ name: `view ${herring.id}`, clicks: [`[data-view="${herring.id}"]`], says: /red herring/ }] : []),
      ...(wrong ? [{ name: `guess ${wrong.id}`, clicks: [...openClues(s), `[data-hypothesis="${wrong.id}"]`], says: NOT_QUITE }] : []),
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
    ];
  },
  first: (s) => `line:${s.lines[0].id}`,
  answerKey: (s) => `spot ${s.id}: ${s.lines.map((l) => l.id).filter((id) => s.faults.includes(id)).join(',')}`,
};

export const STEP_DRIVERS = { choice, sort, build, incident, spot };

/** A play level's steps as `{step, key, spec, type, driver}` in order. */
export function stepsOf(level) {
  return level.play.steps.map((step) => {
    const key = Object.keys(STEP_TYPES).find((k) => Object.hasOwn(step, k));
    return { step, key, spec: step[key], type: STEP_TYPES[key], driver: STEP_DRIVERS[key] };
  });
}
