// Build it widget view (docs/M1-DESIGN.md §4.2; #146): a Dash0-style waterfall built as DOM
// rows (name and service, then trace id, kind, status and timing), each with a track drawn
// in an SVG without a viewBox, so tick labels and bar labels are real, unstretched text and
// positions are attributes (CSP: never a style attribute). Spans are dragged onto their
// parent (HTML drag and drop, wired with el.on* = ...) or picked and given a parent in the
// panel (the keyboard and touch path); both go through setParent, the one transition. The
// step's helps (lib/widgets/build-it-help.mjs) switch on the arrival queue, the time-window
// guide, trace tints, instant feedback and the hint tiers; the right column (score card,
// hint tools, success card and its swirl) is lib/widgets/help-ladder.mjs.
//
// mountBuild is the only home of the Build it penalties (§2, I1): a wrong drop or edit with
// instant feedback costs one ctx.mistake() (an unchanged repeat is free); without it, a
// failed Check costs one unless the graded state is the last failed one; each hint tier costs
// one ctx.hint(). checkBuild is the one grader: notes and hints derive from its issues.
// Span names, services, ids and record text are data text and are escaped (I3); hints,
// `closing` and `explain` are authored HTML. DOM-free at import time.
//
// Logs mode (`isLogMode`, edit: ['logs']): the same board with read-only spans, plus the log
// stream (`<ol class="build-logs">`, a `[data-log]` button per record), a cursor at the
// selected record's time in every row, a tick on the row of every attached record, and the
// attach panel (`[data-attach]`). A record's trace and span come from `applyLogs` and
// `recordsBySpan`, its x from `timeAxis`: never derived here.

import { canFocus } from './focus.mjs';
import { KINDS, STATUSES, timeAxis, waterfall } from './trace.mjs';
import {
  applyLogs,
  applyState,
  attachLog,
  checkBuild,
  gradedKey,
  isLogMode,
  newBuildState,
  recordsBySpan,
  setKind,
  setParent,
  setStatus,
  toggleLink,
  validateBuildSpec,
} from './build-it.mjs';
import {
  BUILD_HELPS,
  arrivalOrder,
  buildHelps,
  descendants,
  hintFor,
  hintTarget,
  initialPlaced,
  moveMarks,
  noteFor,
  shortTrace,
  validateBuildHelps,
} from './build-it-help.mjs';
import { HINT_TIERS, chipsHtml, mountSide, sideHtml } from './help-ladder.mjs';
import { playSwirl } from '../swirl-render.mjs';

const SVC_COLOURS = 6; // --color-svc-0 .. -5 in styles/tokens.css
const TRACE_TINTS = 2; // --color-trace-0, -1
const SVG_NS = 'http://www.w3.org/2000/svg';
const num = (n) => String(Math.round(n * 100) / 100);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const labelOf = (s, e) => `${e(s.name)} (${e(s.service)})`;
const boldLabel = (s, e) => `<b>${e(s.name)}</b> (${e(s.service)})`;
const NONE = '(none)';
const attrText = (attributes, e, sep) =>
  Object.entries(attributes ?? {}).map(([k, v]) => `${e(k)}=${e(String(v))}`).join(sep);

/** The record's label in the panel and the feedback: `"body" (service, time ms)`. */
const logLabel = (l, e) => `"${e(l.body)}" (${e(l.service)}, ${num(l.timeMs)} ms)`;

/** The text of one record: `time ms · SEVERITY · service · trace_id=… · span_id=… · body · k=v, …`. */
function logText(l, e) {
  const attrs = attrText(l.attributes, e, ', ');
  return (
    `${num(l.timeMs)} ms · ${e(l.severity)} · ${e(l.service)} · trace_id=${l.traceId === null ? NONE : e(l.traceId)} · ` +
    `span_id=${l.spanId === null ? NONE : e(l.spanId)} · ${e(l.body)}${attrs ? ` · ${attrs}` : ''}`
  );
}

/** The one instruction line of a step, by what it edits. Plain text. */
function instruction(spec) {
  if (isLogMode(spec)) return 'Pick a record, then the span it was written in, or No span context.';
  if (spec.edit.includes('parent')) return 'Drag each span onto its parent, or pick a span and then its parent.';
  return `Pick a span, then its ${spec.edit.join(' and ')}.`;
}

/** The success card's heading, by what the step builds. */
function winTitle(spec) {
  if (isLogMode(spec)) return 'Every record checks out';
  return spec.edit.includes('parent') ? 'Trace assembled' : 'Every span checks out';
}

/** One group of toggle buttons in the panel. `options`: [value, text, pressed, disabled?]. */
function group(title, attr, options, locked) {
  const buttons = options
    .map(([value, text, on, off]) => `<button type="button" class="build-opt" ${attr}="${value}" aria-pressed="${on}"${locked || off ? ' disabled' : ''}>${text}</button>`)
    .join('');
  return `<div class="build-group" role="group" aria-label="${title}"><p class="build-group-title">${title}</p>${buttons}</div>`;
}

const traceCode = (t, e) => `<code title="trace id ${e(t)}">${e(shortTrace(t))}</code>`;

/** Span mode: the panel for the selected span (placed or arriving), only the controls `spec.edit` allows; parents are the placed spans in row order. */
function panelHtml(v, order, spans) {
  const { spec, e, locked } = v;
  const s = spans.find((x) => x.spanId === v.selected);
  if (!s) return `<p class="build-pick">${spec.edit.includes('parent') ? 'Pick a span to give it a parent.' : 'Pick a span to edit it.'}</p>`;
  const edit = (name) => spec.edit.includes(name);
  const parts = [`<p class="build-editing">Editing ${labelOf(s, e)}, trace ${traceCode(s.traceId, e)}</p>`];
  if (edit('parent')) {
    const bad = descendants(v.state, s.spanId);
    const opts = [['none', 'No parent (root span)', s.parentId === null]];
    for (const p of order) {
      if (!v.placed.has(p.spanId)) continue;
      opts.push([e(p.spanId), labelOf(p, e), s.parentId === p.spanId, p.spanId === s.spanId || bad.has(p.spanId)]);
    }
    parts.push(group(`Parent of ${labelOf(s, e)}`, 'data-parent', opts, locked));
  }
  if (edit('kind')) parts.push(group('Kind', 'data-kind', KINDS.map((k) => [k, k, s.kind === k]), locked));
  if (edit('status')) parts.push(group('Status', 'data-status', STATUSES.map((k) => [k, k, s.status === k]), locked));
  if (edit('links')) {
    const opts = order.filter((p) => p.spanId !== s.spanId).map((p) => [e(p.spanId), labelOf(p, e), s.links.includes(p.spanId)]);
    parts.push(group('Links', 'data-link', opts, locked));
  }
  return parts.join('');
}

/** Logs mode, a record selected: "No span context" first, then every span in row order. */
function attachPanelHtml(log, order, locked, e) {
  const opts = [['none', 'No span context', log.spanId === null]];
  for (const s of order) opts.push([e(s.spanId), `${labelOf(s, e)} · ${num(s.startMs)}–${num(s.endMs)} ms`, log.spanId === s.spanId]);
  return (
    `<p class="build-editing" data-panel-title="log" tabindex="-1">Span context for ${logLabel(log, e)}</p>` +
    group('Span context', 'data-attach', opts, locked)
  );
}

/** Logs mode, a span selected: its attributes (read-only) and the records carrying its span_id. */
function spanPanelHtml(s, carried, e) {
  const attrs = attrText(s.attributes, e, '</li><li>');
  const list = carried.length
    ? carried
        .map((l) => `<button type="button" class="build-opt" data-show-log="${e(l.id)}">${num(l.timeMs)} ms · ${e(l.severity)} · ${e(l.body)}</button>`)
        .join('')
    : '<p class="build-pick">No record carries this span_id yet.</p>';
  return (
    `<p class="build-editing" data-panel-title="span" tabindex="-1">${labelOf(s, e)}, trace ${traceCode(s.traceId, e)}, span_id <code>${e(s.spanId)}</code></p>` +
    (attrs ? `<ul class="build-attrs"><li>${attrs}</li></ul>` : '<p class="build-pick">No attributes.</p>') +
    `<div class="build-group" role="group" aria-label="Records carrying this span_id"><p class="build-group-title">Records carrying this span_id</p>${list}</div>`
  );
}

/** Logs mode: the selected record's attach controls, else the selected span's records. */
function logsPanelHtml(v, order) {
  const { spec, state, e } = v;
  const log = applyLogs(spec, state).find((l) => l.id === v.selectedLog);
  if (log) return attachPanelHtml(log, order, v.locked, e);
  const s = order.find((x) => x.spanId === v.selected);
  if (s) return spanPanelHtml(s, recordsBySpan(spec, state)[s.spanId], e);
  return '<p class="build-pick">Pick a record to attach it, or a span to see its records.</p>';
}

const GRIP =
  '<svg width="10" height="14" viewBox="0 0 10 14" aria-hidden="true" focusable="false"><circle cx="3" cy="3" r="1.2"></circle><circle cx="7" cy="3" r="1.2"></circle><circle cx="3" cy="7" r="1.2"></circle><circle cx="7" cy="7" r="1.2"></circle><circle cx="3" cy="11" r="1.2"></circle><circle cx="7" cy="11" r="1.2"></circle></svg>';
const ICON_OK =
  '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false"><path d="M2.5 7.5 5.5 10.5 11.5 3.5"></path></svg>';
const ICON_NOTE =
  '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false"><circle cx="7" cy="7" r="5.6"></circle><path d="M7 4v3.6M7 9.8v.1"></path></svg>';
const ICON_ROOT =
  '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false"><path d="M7 12V3M3 6.5 7 2.5l4 4"></path></svg>';

/** The view's fixed facts: axis, services, trace order, the spans and the rows on the board. */
function layout(v) {
  const { spec, state } = v;
  const spans = applyState(spec, state);
  const byId = new Map(spans.map((s) => [s.spanId, s]));
  const times = isLogMode(spec) ? spec.logs.map((l) => l.timeMs) : [];
  const axis = timeAxis(spans, times);
  const services = [...new Set(spec.spans.map((s) => s.service))];
  const traces = waterfall(spans).traces;
  const rows = waterfall(spans.filter((s) => v.placed.has(s.spanId)), { times }).rows;
  return { spans, byId, axis, services, traces, rows };
}

/** Connector lines (track SVG markup) per row index, from each child's parent bar to its own. */
function connectors(rows, byId, axis) {
  const out = rows.map(() => []);
  const at = new Map(rows.map((r, i) => [r.spanId, i]));
  rows.forEach((r, ci) => {
    const s = byId.get(r.spanId);
    if (s.parentId === null || r.crossTrace || r.orphan || !at.has(s.parentId)) return;
    const pi = at.get(s.parentId);
    if (pi >= ci) return;
    const px = num(axis.pct(byId.get(s.parentId).startMs));
    const cx = num(axis.pct(s.startMs));
    out[pi].push(`<line class="wf-conn" x1="${px}%" x2="${px}%" y1="50%" y2="100%" transform="translate(5 11)"></line>`);
    for (let k = pi + 1; k < ci; k++) out[k].push(`<line class="wf-conn" x1="${px}%" x2="${px}%" y1="0" y2="100%" transform="translate(5 0)"></line>`);
    out[ci].push(
      `<line class="wf-conn" x1="${px}%" x2="${px}%" y1="0" y2="50%" transform="translate(5 0)"></line>` +
        `<line class="wf-conn" x1="${px}%" x2="${cx}%" y1="50%" y2="50%" transform="translate(5 0)"></line>`,
    );
  });
  return out;
}

const TICKS = 5;
const tickValues = (axis) => Array.from({ length: TICKS + 1 }, (_, i) => axis.min + (axis.range * i) / TICKS);
const widthPct = (axis, s) => num(axis.range > 0 ? ((s.endMs - s.startMs) / axis.range) * 100 : 0);

/** The track of one row: grid lines, connectors, the labelled bar, record ticks and the cursor. */
function trackHtml(v, s, L, { conns = '', ticks = '', cursor = null }) {
  const { e } = v;
  const x = num(L.axis.pct(s.startMs));
  const grid = tickValues(L.axis)
    .slice(1, -1)
    .map((t) => `<line class="wf-grid" x1="${num(L.axis.pct(t))}%" x2="${num(L.axis.pct(t))}%" y1="0" y2="100%"></line>`)
    .join('');
  const cur = cursor === null ? '' : `<line class="wf-cursor" data-cursor x1="${cursor}%" x2="${cursor}%" y1="0" y2="100%"></line>`;
  return (
    `<svg class="wf-track" width="100%" height="100%" aria-hidden="true" focusable="false">${grid}${conns}` +
    `<rect class="wf-bar" data-bar x="${x}%" y="50%" width="${widthPct(L.axis, s)}%" height="22" rx="4" transform="translate(0 -11)"></rect>` +
    `<text class="wf-bar-label" data-bar-label x="${x}%" y="50%" dx="7" dy="0.35em"><tspan class="wf-dur">${num(s.endMs - s.startMs)}ms</tspan> ${e(s.name)}</text>` +
    `${ticks}${cur}</svg>`
  );
}

/**
 * One row. `kind`: 'placed' (a drop target in parent mode), 'arriving' (the queue's current
 * span: draggable, pickable, not a target) or 'waiting' (inert: no data-span, no tabindex).
 */
function rowHtml(v, L, s, { kind, depth = 0, conns = '', ticks = '', cursor = null, records = null }) {
  const { e } = v;
  const svc = L.services.indexOf(s.service) % SVC_COLOURS;
  const tint = v.helps.tint ? ` data-tint="${L.traces.indexOf(s.traceId) % TRACE_TINTS}"` : '';
  const id = e(s.spanId);
  const verdict = kind === 'placed' && v.helps.instant ? v.verdict[s.spanId] : undefined;
  const mark = verdict === undefined ? '' : `<span class="wf-mark" data-mark-icon="${verdict}" aria-hidden="true">${verdict === 'ok' ? ICON_OK : ICON_NOTE}</span>`;
  let where = 'root';
  if (kind === 'arriving') where = 'arriving, not placed yet';
  else if (s.parentId !== null && v.placed.has(s.parentId) && L.byId.has(s.parentId)) where = `parent ${labelOf(L.byId.get(s.parentId), e)}`;
  const said = `${e(s.name)}, ${e(s.service)}, ${s.kind}, ${s.status}, ${num(s.startMs)} to ${num(s.endMs)} ms, trace ${shortTrace(s.traceId)}`;
  const tail = `${verdict === 'ok' ? ', right' : verdict === 'no' ? ', not right yet' : ''}${records === null ? '' : `, ${plural(records, 'record', 'records')}`}`;
  const drag = v.parentMode && !v.locked && kind !== 'waiting';
  const label =
    `<span class="wf-label" data-indent="${Math.min(depth, 5)}">` +
    `<span class="wf-grip" aria-hidden="true">${drag ? GRIP : ''}</span>` +
    `<span class="wf-txt"><span class="wf-l1">${depth ? '<i class="wf-elbow" aria-hidden="true"></i>' : ''}` +
    `<span class="wf-name">${e(s.name)}</span><span class="wf-svc-wrap"><i class="wf-sw" aria-hidden="true"></i><span class="wf-svc">${e(s.service)}</span></span>` +
    `${mark}${kind === 'waiting' ? '<span class="wf-tag" data-tag="wait">waiting</span>' : ''}<span class="wf-tags" data-tags></span></span>` +
    `<span class="wf-l2"><span class="wf-tid" data-trace${tint} title="trace id ${e(s.traceId)}">trace ${e(shortTrace(s.traceId))}</span>` +
    `<span class="wf-cmp" data-cmp hidden></span><span>${s.kind}</span><span>${s.status}</span><span>${num(s.startMs)}–${num(s.endMs)} ms</span>` +
    `${records ? `<span>${plural(records, 'record', 'records')}</span>` : ''}</span></span></span>`;
  const common = `data-depth="${depth}" data-svc="${svc}" data-error="${s.status === 'ERROR'}"`;
  const track = `<span class="wf-trackcell">${trackHtml(v, s, L, { conns, ticks, cursor })}</span>`;
  if (kind === 'waiting') {
    return `<li class="wf-row" data-waiting="${id}" ${common} aria-label="${e(s.name)}, ${e(s.service)}, waiting, not arrived yet">${label}${track}</li>`;
  }
  const attrs =
    `type="button" class="wf-row" data-span="${id}"${kind === 'arriving' ? ' data-arriving' : ''}` +
    `${kind === 'placed' && v.parentMode ? ` data-drop="${id}"` : ''}${drag ? ' draggable="true"' : ''} ${common}` +
    `${verdict === undefined ? '' : ` data-verdict="${verdict}"`} aria-pressed="${s.spanId === v.selected}" ` +
    `aria-describedby="${e(v.spec.id)}-instr" aria-label="${said}, ${where}${tail}"`;
  const row = `<button ${attrs}>${label}${track}</button>`;
  return kind === 'arriving' ? `<li class="wf-arriving-item">${row}</li>` : row;
}

/** The metadata line above the board. */
function metaHtml(v, L) {
  const n = v.spec.spans.length;
  const end = L.axis.min + L.axis.range;
  const spans = v.helps.queue ? `${v.placed.size} of ${n} placed` : String(n);
  const recs = isLogMode(v.spec) ? `<div><dt>Records</dt><dd>${v.spec.logs.length}</dd></div>` : '';
  return (
    `<div><dt>Spans</dt><dd>${spans}</dd></div><div><dt>Services</dt><dd>${L.services.length}</dd></div>` +
    `<div><dt>Window</dt><dd>${num(L.axis.min)} to ${num(end)} ms</dd></div>${recs}`
  );
}

/** The legend: a swatch per service, then what each highlight means. */
function legendHtml(v, L) {
  const { e, helps } = v;
  const item = (key, text) => `<span class="wf-legend-item"><i class="wf-key" data-key="${key}" aria-hidden="true"></i>${text}</span>`;
  const services = L.services
    .map((s, i) => `<span class="wf-legend-item" data-legend-svc="${i % SVC_COLOURS}"><i class="wf-sw" aria-hidden="true"></i>${e(s)}</span>`)
    .join('');
  const keys = [item('sel', 'Selected')];
  if (v.parentMode) keys.push(item('par', 'Its current parent'));
  if (helps.guide) keys.push(item('band', 'Time window of the span you move'), item('likely', 'Contains it in time'));
  if (helps.tint) keys.push(item('tint', 'One tint per trace id'));
  if (isLogMode(v.spec)) keys.push(item('log', 'A record attached to the span'), item('cursor', "The selected record's time"));
  keys.push(item('err', 'ERROR'));
  return `<p class="wf-legend" data-legend>${services}${keys.join('')}</p>`;
}

/** The redrawn part of the board: the axis, the rows, the queue, the log stream, the panel, the legend. */
function boardHtml(v) {
  const { spec, state, e } = v;
  const L = layout(v);
  const logsMode = isLogMode(spec);
  const logs = logsMode ? applyLogs(spec, state) : [];
  const carried = logsMode ? recordsBySpan(spec, state) : {};
  const sel = logs.find((l) => l.id === v.selectedLog);
  const cursor = sel ? num(L.axis.pct(sel.timeMs)) : null;
  const conns = connectors(L.rows, L.byId, L.axis);
  const ticks = tickValues(L.axis)
    .map((t, i) => {
      const x = num(L.axis.pct(t));
      const end = i === TICKS;
      const text = Math.round(t * 100) === 0 ? '0' : `${num(t)} ms`;
      return (
        `<line class="wf-tick" x1="${x}%" x2="${x}%" y1="0" y2="100%"></line>` +
        `<text class="wf-tick-label" data-tick="${i}" x="${x}%" y="18" dx="${end ? -5 : 5}" text-anchor="${end ? 'end' : 'start'}">${text}</text>`
      );
    })
    .join('');
  const axis = `<div class="wf-axis" aria-hidden="true"><span class="wf-axis-gap"></span><span class="wf-trackcell"><svg class="wf-ticks" width="100%" height="100%" focusable="false">${ticks}</svg></span></div>`;
  const rows = L.rows
    .map((r, i) => {
      const s = L.byId.get(r.spanId);
      const recTicks = logsMode
        ? carried[r.spanId]
            .map((l) => `<rect class="wf-log" data-log-tick="${e(l.id)}" x="${num(L.axis.pct(l.timeMs))}%" y="50%" width="3" height="22" transform="translate(-1.5 -11)"></rect>`)
            .join('')
        : '';
      return rowHtml(v, L, s, { kind: 'placed', depth: r.depth, conns: conns[i].join(''), ticks: recTicks, cursor, records: logsMode ? carried[r.spanId].length : null });
    })
    .join('');
  let queue = '';
  if (v.helps.queue && !logsMode) {
    const order = arrivalOrder(spec);
    const left = order.filter((id) => !v.placed.has(id));
    if (left.length) {
      const [cur, ...rest] = left;
      const dots = order.map((id) => `<i data-dot="${v.placed.has(id) ? 'placed' : id === cur ? 'arriving' : 'waiting'}"></i>`).join('');
      queue =
        `<div class="wf-queue" data-queue><p class="wf-queue-head"><strong>Span ${v.placed.size + 1} of ${order.length} arriving</strong> ` +
        `<span class="wf-qdots" aria-hidden="true">${dots}</span> <span>${rest.length ? `${rest.length} more waiting` : 'last one'}</span></p>` +
        `<ul class="wf-queue-list" aria-label="Arriving spans">${rowHtml(v, L, L.byId.get(cur), { kind: 'arriving' })}` +
        `${rest.map((id) => rowHtml(v, L, L.byId.get(id), { kind: 'waiting' })).join('')}</ul></div>`;
    }
  }
  const stream = logsMode
    ? `<ol class="build-logs" aria-label="Log records">${logs
        .map((l) => `<li><button type="button" class="build-log" data-log="${e(l.id)}" aria-pressed="${l.id === v.selectedLog}">${logText(l, e)}</button></li>`)
        .join('')}</ol>`
    : '';
  const order = L.rows.map((r) => L.byId.get(r.spanId));
  const panel = logsMode ? logsPanelHtml(v, order) : panelHtml(v, order, L.spans);
  return (
    `<div class="wf">${axis}<div class="wf-rows" role="group" aria-label="Spans on the board">${rows}</div>${queue}</div>` +
    `${stream}<div class="build-panel" data-build-panel>${panel}</div>${legendHtml(v, L)}`
  );
}

/** The view state renderBuild and mountBuild draw from. */
function viewOf(spec, state, { selected = null, selectedLog = null, placed, verdict = {}, locked = false, e }) {
  const helps = buildHelps(spec);
  return {
    spec,
    state,
    selected,
    selectedLog,
    helps,
    placed: placed ?? initialPlaced(spec, helps),
    verdict,
    locked,
    e,
    parentMode: !isLogMode(spec) && spec.edit.includes('parent'),
  };
}

/**
 * Markup for Build it `spec` in `state`, span `selected` (or record `selectedLog`) pressed:
 * the helps chips `#<id>-helps`, the metadata `[data-meta]`, the instruction `#<id>-instr`
 * (every span row's aria-describedby; not a live region), in parent mode the root drop zone
 * `[data-drop="root"]`, the move status `#<id>-status`, the board `[data-build-board]` (rows
 * `[data-span]`, the queue's `[data-arriving]` and `[data-waiting]` rows, the log stream, the
 * panel `[data-build-panel]`, the legend), then `#<id>-check` (without instant feedback) and
 * `#<id>-reset`, the `#<id>-feedback` status region, and the right column (sideHtml).
 */
export function renderBuild(spec, state, { selected = null, selectedLog = null, escapeHtml: e } = {}) {
  const id = e(spec.id);
  const v = viewOf(spec, state, { selected, selectedLog, e });
  const chips = chipsHtml(id, BUILD_HELPS.map(([key, label]) => ({ key, label, on: v.helps[key] })));
  const root = v.parentMode ? `<div class="wf-root" data-drop="root" aria-hidden="true">${ICON_ROOT}No parent (root)</div>` : '';
  const check = v.helps.instant ? '' : `<button type="button" class="build-btn primary" id="${id}-check">Check</button>`;
  return (
    `<div class="build" data-build="${id}"><div class="build-layout">` +
    `<div class="build-main">${chips}` +
    `<div class="build-frame"><dl class="wf-meta" data-meta>${metaHtml(v, layout(v))}</dl>` +
    `<p class="build-instr" id="${id}-instr">${instruction(spec)}</p>${root}` +
    `<p class="build-status" id="${id}-status" role="status" aria-live="polite"></p>` +
    `<div class="build-board" data-build-board>${boardHtml(v)}</div></div>` +
    `<div class="build-actions">${check}<button type="button" class="build-btn" id="${id}-reset">Reset</button></div>` +
    `<div class="feedback" id="${id}-feedback" role="status" aria-live="polite" tabindex="-1"></div>` +
    `</div>${sideHtml(id, { hints: v.helps.hints, title: winTitle(spec) })}</div></div>`
  );
}

/**
 * Wire Build it `spec` (rendered by renderBuild into ctx.ovBody) from a fresh state and focus
 * its first control: the arriving span with the queue, else the first span (logs mode: the
 * first record). Moving a span (drag, or pick then the panel) goes through setParent; a
 * refused loop is free ("... would make a loop."). With instant feedback each change is
 * graded at once (a tick, or a specific note and one mistake; an unchanged repeat is free)
 * and the last right one completes the step; without it, Check does (a failed Check costs
 * one unless the graded state is the last failed one). On success: the feedback says
 * "Right. Every span checks out." (logs mode: "... record ..." plus `explain`), the controls
 * lock, onComplete() is called once, the success card shows with `closing`, its heading takes
 * focus and the swirl plays once. Each hint tier costs one ctx.hint(). opts.swirl replaces
 * the renderer (tests). Throws TypeError (naming the spec id) for an invalid spec or helps,
 * a missing onComplete, a ctx without peekStars, or a spec that is not rendered.
 */
export function mountBuild(ctx, spec, { onComplete, swirl = playSwirl } = {}) {
  const fail = (msg) => {
    throw new TypeError(`build "${String(spec?.id)}": ${msg}`);
  };
  let problems = validateBuildSpec(spec);
  if (!problems.length) problems = validateBuildHelps(spec);
  if (problems.length) fail(`invalid spec: ${problems.join('; ')}`);
  if (typeof onComplete !== 'function') fail('onComplete must be a function');
  if (typeof ctx.peekStars !== 'function') fail('ctx.peekStars must be a function');
  // Ids are kebab-case or hex (validated above), so they are safe inside selectors.
  const box = ctx.ovBody.querySelector(`[data-build="${spec.id}"]`);
  const part = (name) => box?.querySelector(`[id="${spec.id}-${name}"]`);
  const board = box?.querySelector('[data-build-board]');
  const meta = box?.querySelector('[data-meta]');
  const statusEl = part('status');
  const fb = part('feedback');
  const check = part('check');
  const resetBtn = part('reset');
  const helps = buildHelps(spec);
  if (!board || !meta || !statusEl || !fb || !resetBtn || (!helps.instant && !check)) fail('not rendered (use renderBuild with the same spec)');
  const rootZone = box.querySelector('[data-drop="root"]');
  const hintBtn = part('hint');

  const e = ctx.escapeHtml;
  const logsMode = isLogMode(spec);
  const parentMode = !logsMode && spec.edit.includes('parent');
  const side = mountSide(ctx, box, spec.id, { swirl });
  const focusOn = (el) => (canFocus(el) ? el : fb).focus();
  const say = (cls, html) => {
    statusEl.className = `build-status${cls ? ` ${cls}` : ''}`;
    statusEl.innerHTML = html;
  };
  const tell = (cls, html) => {
    fb.className = `feedback ${cls} show`;
    fb.innerHTML = html;
  };

  let state = newBuildState(spec);
  let placed = initialPlaced(spec, helps);
  let verdict = {};
  let selected = null;
  let selectedLog = null;
  let picking = false; // a span picked in parent mode shows its targets until it moves
  let moving = null; // the span being dragged
  let done = false;
  let lastFailed = null;
  let wrong = 0;
  let hintsUsed = 0;
  const tiers = {};
  let cands = new Set();

  const spanOf = (id) => applyState(spec, state).find((s) => s.spanId === id);
  const me = (id) => boldLabel(spanOf(id), e);
  const row = (id) => (id === null ? null : board.querySelector(`[data-span="${id}"]`));
  const arrivingId = () => (helps.queue ? arrivalOrder(spec).find((id) => !placed.has(id)) ?? null : null);
  const wrongLabel = (n) => {
    if (!helps.instant) return n === 1 ? 'failed Check' : 'failed Checks';
    if (parentMode) return n === 1 ? 'wrong drop' : 'wrong drops';
    return n === 1 ? 'wrong pick' : 'wrong picks';
  };
  const panelFocus = () =>
    board.querySelector('[data-build-panel] button:not([disabled])') ?? board.querySelector('[data-build-panel] [data-panel-title]');

  function updateSide() {
    side.score({ wrong, wrongLabel: wrongLabel(2), hints: hintsUsed, done });
    if (!hintBtn) return;
    const key = done ? null : hintTarget(spec, state, { helps, placed, selected, selectedLog });
    const t = key === null ? 0 : tiers[key] ?? 0;
    let who = '';
    if (key !== null) who = logsMode ? logLabel(spec.logs.find((l) => l.id === key), e) : boldLabel(spanOf(key), e);
    const pips = Array.from({ length: HINT_TIERS }, (_, i) => `<i data-on="${i < t}"></i>`).join('');
    side.hintUi({
      label: key === null ? 'Hint' : t >= HINT_TIERS ? 'No more hints' : `Hint ${t + 1} of ${HINT_TIERS}`,
      disabled: key === null || t >= HINT_TIERS,
      tierHtml: key === null ? 'Nothing to hint right now.' : `For ${who}: ${t} of ${HINT_TIERS} used<span class="help-pips" aria-hidden="true">${pips}</span>`,
    });
  }

  /** Restyle in place what depends on a moving or picked span, the selection and hint candidates (no re-render: a drag source must stay put). */
  function decorate() {
    const src = !done && parentMode ? moving ?? (picking ? selected : null) : null;
    const marks = src === null ? {} : moveMarks(spec, state, src, { placed, helps });
    const s = src === null ? null : spanOf(src);
    const parentOfSel = parentMode && selected !== null && placed.has(selected) ? state.spans[selected].parentId : null;
    const axis = timeAxis(applyState(spec, state), logsMode ? spec.logs.map((l) => l.timeMs) : []);
    const flag = (el, attr, on, value = 'true') => (on ? el.setAttribute(attr, value) : el.removeAttribute(attr));
    for (const r of box.querySelectorAll('[data-span]')) {
      const id = r.dataset.span;
      const m = marks[id];
      flag(r, 'data-mark', !!m, m?.mark);
      flag(r, 'data-other', !!m?.other);
      flag(r, 'aria-disabled', m?.mark === 'invalid');
      flag(r, 'data-parent-of-selected', id === parentOfSel);
      flag(r, 'data-hint-cand', cands.has(id));
      r.setAttribute('aria-pressed', String(id === selected));
      const tags = [];
      if (id === selected) tags.push('<span class="wf-tag" data-tag="sel">selected</span>');
      if (id === parentOfSel) tags.push('<span class="wf-tag" data-tag="par">its parent</span>');
      if (m?.other) tags.push('<span class="wf-tag" data-tag="oth">other trace</span>');
      r.querySelector('[data-tags]').innerHTML = tags.join('');
      const cmp = r.querySelector('[data-cmp]');
      const target = !!m && m.mark !== 'src' && m.mark !== 'invalid' && helps.guide;
      cmp.hidden = !target;
      cmp.textContent = target ? `moving: ${shortTrace(s.traceId)}` : '';
      const track = r.querySelector('svg.wf-track');
      track.querySelector('[data-band]')?.remove();
      if (s && helps.guide && placed.has(id)) {
        const band = track.ownerDocument.createElementNS(SVG_NS, 'rect');
        band.setAttribute('class', 'wf-band');
        band.setAttribute('data-band', '');
        band.setAttribute('x', `${num(axis.pct(s.startMs))}%`);
        band.setAttribute('width', `${widthPct(axis, s)}%`);
        band.setAttribute('y', '0');
        band.setAttribute('height', '100%');
        track.insertBefore(band, track.firstChild);
      }
    }
    if (rootZone) {
      flag(rootZone, 'data-active', src !== null);
      flag(rootZone, 'data-hint-cand', cands.has('root'));
    }
  }

  function draw() {
    const v = viewOf(spec, state, { selected, selectedLog, placed, verdict, locked: done, e });
    board.innerHTML = boardHtml(v);
    meta.innerHTML = metaHtml(v, layout(v));
    for (const r of board.querySelectorAll('[data-span]')) {
      const id = r.dataset.span;
      r.onclick = () => pickSpan(id);
      if (r.getAttribute('draggable') === 'true') {
        r.ondragstart = (ev) => startDrag(id, ev);
        r.ondragend = () => endDrag();
      }
    }
    for (const w of board.querySelectorAll('[data-waiting]')) {
      w.onclick = () => say('note', "This span hasn't arrived yet; place the current one first.");
    }
    for (const t of board.querySelectorAll('[data-drop]')) wireDrop(t);
    for (const b of board.querySelectorAll('[data-log], [data-show-log]')) {
      b.onclick = () => {
        selectedLog = b.dataset.log ?? b.dataset.showLog;
        selected = null;
        draw();
        focusOn(panelFocus());
      };
    }
    const wire = (attr, key, fn) => {
      for (const b of board.querySelectorAll(`[${attr}]`)) {
        b.onclick = () => {
          if (!b.disabled && !done) fn(b.dataset[key]);
        };
      }
    };
    wire('data-parent', 'parent', (value) => move(selected, value === 'none' ? null : value, { focusSel: `[data-parent="${value}"]` }));
    wire('data-kind', 'kind', (value) => editKind(selected, value));
    wire('data-status', 'status', (value) => editStatus(selected, value));
    wire('data-link', 'link', (value) => editLink(selected, value));
    wire('data-attach', 'attach', (value) => editAttach(selectedLog, value));
    decorate();
    updateSide();
  }

  /** A drop target: accepts only a moving span it may take (a target mark, or root), outlined while a drag is over it. */
  function wireDrop(t) {
    const accepts = () => {
      if (moving === null || done) return false;
      const to = t.dataset.drop;
      const m = to === 'root' ? null : moveMarks(spec, state, moving, { placed, helps })[to];
      return to === 'root' || (!!m && m.mark !== 'src' && m.mark !== 'invalid');
    };
    t.ondragover = (ev) => {
      if (accepts()) ev.preventDefault();
    };
    t.ondragenter = () => {
      if (accepts()) t.setAttribute('data-over', '');
    };
    t.ondragleave = () => t.removeAttribute('data-over');
    t.ondrop = (ev) => {
      ev.preventDefault();
      t.removeAttribute('data-over');
      const id = moving;
      moving = null;
      if (id !== null && !done) move(id, t.dataset.drop === 'root' ? null : t.dataset.drop, {});
    };
  }

  function startDrag(id, ev) {
    if (done) return;
    moving = id;
    selected = id;
    picking = false;
    try {
      ev?.dataTransfer?.setData('text/plain', id);
      if (ev?.dataTransfer) ev.dataTransfer.effectAllowed = 'move';
    } catch {
      // some browsers refuse setData here; the drag still works
    }
    say('', `Drop ${me(id)} on its parent, or on <b>No parent (root)</b>.`);
    decorate();
  }

  function endDrag() {
    if (moving === null) return;
    const id = moving;
    moving = null;
    selected = null;
    say('', `${me(id)} is unchanged.`);
    decorate();
    updateSide();
  }

  function pickSpan(id) {
    selected = id;
    selectedLog = null;
    picking = parentMode && !done;
    if (picking) say('', `Pick the parent of ${me(id)}, or No parent (root span). Esc cancels.`);
    draw();
    focusOn(panelFocus());
  }

  const complete = () => placed.size === spec.spans.length && checkBuild(spec, state).ok;

  /**
   * After a change to span `id` (`text`: what happened, e.g. "X sits under Y"): with instant
   * feedback grade it now (a mistake unless it came from a hint), else just say it (`plain`).
   * Then redraw, complete if it was the last right one, and focus.
   */
  function graded(id, text, { focusSel = null, fromHint = false, plain }) {
    picking = false;
    if (!helps.instant) {
      say('', `${plain}.`);
      draw();
      focusOn(focusSel ? board.querySelector(focusSel) : row(id));
      return;
    }
    const issue = checkBuild(spec, state).issues.find((i) => i.spanId === id);
    verdict[id] = issue ? 'no' : 'ok';
    if (issue && !fromHint) {
      ctx.mistake();
      wrong += 1;
    }
    if (issue) {
      selected = id;
      say('note', `${text}, but not quite. ${noteFor(spec, state, issue, e)} It stays here; move it when you are ready.`);
    } else {
      selected = null;
      cands = new Set();
      say('ok', `${text}. Right.`);
    }
    draw();
    if (complete()) {
      succeed();
      return;
    }
    if (issue) focusOn(focusSel ? board.querySelector(focusSel) : row(id));
    else focusOn(row(arrivingId()) ?? row(id));
  }

  /** Make `parentId` (null: a root) the parent of span `id`, through setParent. */
  function move(id, parentId, { focusSel = null, fromHint = false }) {
    if (done || id === null) return;
    if (placed.has(id) && state.spans[id].parentId === parentId && !fromHint) {
      picking = false;
      say('', parentId === null ? `${me(id)} is already a root.` : `${me(id)} already sits under ${me(parentId)}.`);
      draw();
      focusOn(focusSel ? board.querySelector(focusSel) : row(id));
      return;
    }
    const outcome = setParent(spec, state, id, parentId);
    if (outcome === 'self' || outcome === 'cycle') {
      picking = false;
      if (!focusSel) selected = null;
      say('note', outcome === 'self' ? `${me(id)} can't be its own parent: that would make a loop.` : `${me(parentId)} is already below ${me(id)}, so that would make a loop.`);
      draw();
      focusOn(focusSel ? board.querySelector(focusSel) : row(id));
      return;
    }
    if (outcome !== 'set') return;
    placed.add(id);
    graded(id, parentId === null ? `${me(id)} is a root` : `${me(id)} sits under ${me(parentId)}`, {
      focusSel,
      fromHint,
      plain: parentId === null ? `${me(id)} is a root now` : `${me(id)} now sits under ${me(parentId)}`,
    });
  }

  function editKind(id, kind, { fromHint = false } = {}) {
    if (helps.instant && !fromHint && state.spans[id].kind === kind) {
      say('', `${me(id)} is already ${e(kind)}.`);
      focusOn(board.querySelector(`[data-kind="${kind}"]`));
      return;
    }
    setKind(spec, state, id, kind);
    const text = `${me(id)} is now ${e(kind)}`;
    graded(id, text, { focusSel: `[data-kind="${kind}"]`, fromHint, plain: text });
  }

  function editStatus(id, status, { fromHint = false } = {}) {
    if (helps.instant && !fromHint && state.spans[id].status === status) {
      say('', `${me(id)} already has status ${e(status)}.`);
      focusOn(board.querySelector(`[data-status="${status}"]`));
      return;
    }
    setStatus(spec, state, id, status);
    const text = `${me(id)} now has status ${e(status)}`;
    graded(id, text, { focusSel: `[data-status="${status}"]`, fromHint, plain: text });
  }

  function editLink(id, target) {
    const outcome = toggleLink(spec, state, id, target);
    const text = outcome === 'linked' ? `${me(id)} now links to ${me(target)}` : `${me(id)} no longer links to ${me(target)}`;
    graded(id, text, { focusSel: `[data-link="${target}"]`, plain: text });
  }

  /** Logs mode: attach record `logId` to `value` (a span id, or 'none'), say what it carries now. */
  function editAttach(logId, value, { fromHint = false } = {}) {
    attachLog(spec, state, logId, value === 'none' ? null : value);
    const l = applyLogs(spec, state).find((x) => x.id === logId);
    say(
      '',
      l.spanId === null
        ? `"${e(l.body)}" now has no span context: trace_id=${NONE} and span_id=${NONE}.`
        : `"${e(l.body)}" now carries span_id=${e(l.spanId)} and trace_id=${e(l.traceId)} from ${labelOf(spanOf(l.spanId), e)}.`,
    );
    draw();
    if (!fromHint) focusOn(board.querySelector(`[data-attach="${value}"]`));
  }

  /** Tier 3: set the hinted field through its one setter; never a mistake. */
  function applyHint(key, { field, value }) {
    if (field === 'parent') move(key, value, { fromHint: true });
    else if (field === 'kind') editKind(key, value, { fromHint: true });
    else if (field === 'status') editStatus(key, value, { fromHint: true });
    else if (field === 'logs') editAttach(key, value ?? 'none', { fromHint: true });
    else {
      const has = state.spans[key].links;
      for (const t of [...value.filter((l) => !has.includes(l)), ...has.filter((l) => !value.includes(l))]) toggleLink(spec, state, key, t);
      const text = `${me(key)} now links to every span it is related to`;
      graded(key, text, { fromHint: true, plain: text });
    }
  }

  function succeed() {
    if (done) return;
    done = true;
    selected = null;
    picking = false;
    moving = null;
    cands = new Set();
    if (check) check.disabled = true;
    resetBtn.disabled = true;
    tell('good', logsMode ? `Right. Every record checks out.${spec.explain === undefined ? '' : ` ${spec.explain}`}` : 'Right. Every span checks out.');
    draw();
    const n = ctx.peekStars();
    onComplete();
    side.succeed({
      line: `${n} of 5 stars: ${plural(wrong, wrongLabel(1), wrongLabel(2))}, ${plural(hintsUsed, 'hint', 'hints')}.`,
      closing: spec.closing ?? '',
    });
  }

  if (check) {
    check.onclick = () => {
      if (check.disabled || done) return;
      const result = checkBuild(spec, state);
      if (result.ok) {
        succeed();
        return;
      }
      const key = gradedKey(spec, state);
      const same = key === lastFailed;
      if (!same) {
        ctx.mistake();
        wrong += 1;
      }
      lastFailed = key;
      const items = result.issues.map((i) => `<li data-code="${i.code}">${noteFor(spec, state, i, e)} <span class="build-code" aria-hidden="true">${i.code}</span></li>`);
      tell('info', `<p>${same ? 'Same as last time' : 'Not yet'}: ${plural(result.issues.length, 'problem', 'problems')}.</p><ul class="build-issues">${items.join('')}</ul>`);
      updateSide();
      fb.focus();
    };
  }

  resetBtn.onclick = () => {
    if (done) return;
    state = newBuildState(spec);
    placed = initialPlaced(spec, helps);
    verdict = {};
    selected = null;
    selectedLog = null;
    picking = false;
    moving = null;
    cands = new Set();
    let text = 'Reset: every span is as it arrived.';
    if (helps.queue) text = 'Reset. The first span is placed; the rest arrive one at a time.';
    else if (logsMode) text = 'Reset: every record is as it arrived.';
    say('', text);
    draw();
    focusOn(row(arrivingId()) ?? board.querySelector(logsMode ? '[data-log]' : '[data-span]'));
  };

  if (hintBtn) {
    hintBtn.onclick = () => {
      if (hintBtn.disabled || done) return;
      const key = hintTarget(spec, state, { helps, placed, selected, selectedLog });
      if (key === null) return;
      const t = (tiers[key] ?? 0) + 1;
      if (t > HINT_TIERS) return;
      tiers[key] = t;
      ctx.hint();
      hintsUsed += 1;
      const who = logsMode ? logLabel(spec.logs.find((l) => l.id === key), e) : labelOf(spanOf(key), e);
      const h = hintFor(spec, state, key, t, { placed, e });
      const html = `<span class="help-hint-head">Hint ${t} of ${HINT_TIERS} · ${who}</span>${h.html}`;
      cands = new Set(h.cands);
      if (h.apply) {
        cands = new Set();
        applyHint(key, h.apply);
      }
      if (done) {
        side.showHint(html, { focus: false });
        return;
      }
      decorate();
      updateSide();
      side.showHint(html);
    };
  }

  if (rootZone) {
    wireDrop(rootZone);
    rootZone.onclick = () => {
      if (!done && picking && selected !== null) move(selected, null, {});
    };
  }

  box.onkeydown = (ev) => {
    if (ev.key !== 'Escape' || (selected === null && selectedLog === null) || moving !== null) return;
    ev.preventDefault?.();
    const id = selected;
    selected = null;
    selectedLog = null;
    picking = false;
    cands = new Set();
    say('', 'Cancelled.');
    draw();
    focusOn(row(id) ?? board.querySelector(logsMode ? '[data-log]' : '[data-span]'));
  };

  draw();
  focusOn(row(arrivingId()) ?? board.querySelector(logsMode ? '[data-log]' : '[data-span]'));
}
