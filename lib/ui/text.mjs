// Kit text blocks (docs/DESIGN-SYSTEM.md "Components"): the lesson card, the question, a
// step heading, the mono eyebrow, the muted note, prose and a code block. Authored content
// inside them stays classless. Pure string builders; DOM-free.

import { esc, html, idAttr, int, opts, text } from './check.mjs';

/**
 * The glow lesson card around trusted authored HTML: a "Lesson" eyebrow (CSS), lesson text
 * colour, an amber glow top left and a dot top right. ctx.speech returns it (lib/lesson-kit.mjs).
 */
export function lesson(bodyHtml) {
  html('lesson', bodyHtml, 'html');
  return `<section class="ui-lesson">${bodyHtml}</section>`;
}

/** The step's question: 18px/600, centred in a narrow step and left-aligned in a wide one (D4). */
export function question(args) {
  const { id, html: body } = opts('question', args, ['id', 'html']);
  const idA = idAttr('question', id, { optional: true });
  html('question', body, 'html');
  return `<h3 class="ui-question"${idA}>${body}</h3>`;
}

/** A mono uppercase label above a section ("Error budget"). */
export function eyebrow(label) {
  return `<p class="ui-eyebrow">${text('eyebrow', label, 'text')}</p>`;
}

/** A numbered section heading inside a panel: "Step N", the title and an optional muted note. */
export function stepHead(args) {
  const { step, titleHtml, noteHtml } = opts('stepHead', args, ['step', 'titleHtml', 'noteHtml']);
  int('stepHead', step, 'step', 1);
  html('stepHead', titleHtml, 'titleHtml');
  html('stepHead', noteHtml, 'noteHtml', { optional: true });
  const n = noteHtml === undefined ? '' : `<p class="ui-step-note">${noteHtml}</p>`;
  return `<div class="ui-step-head"><p class="ui-eyebrow">Step ${step}</p><h3 class="ui-step-title">${titleHtml}</h3>${n}</div>`;
}

/** Muted small print (13.5px): costs, data notes, "drag or pick" hints. */
export function note(bodyHtml) {
  html('note', bodyHtml, 'html');
  return `<p class="ui-note">${bodyHtml}</p>`;
}

/** role=region and aria-label from a table's caption text, or nothing when it has none. */
export function regionAttrs(tableHtml) {
  const m = /<caption\b[^>]*>([\s\S]*?)<\/caption>/.exec(tableHtml);
  const name = m ? m[1].replace(/<[^>]*>/g, '').replace(/"/g, '&quot;').trim() : '';
  return name === '' ? '' : ` role="region" aria-label="${name}"`;
}

/** Classless authored content (p, ul, ol, table, pre, code, del) styled as one block. Each table
 *  is wrapped in the kit's table scroller so it keeps full width and scrolls sideways when wide;
 *  a table with a caption makes its scroller a labelled region (the caption is its name). */
export function prose(bodyHtml) {
  html('prose', bodyHtml, 'html');
  const wrapped = bodyHtml.replace(/<table\b[\s\S]*?<\/table>/g, (t) => `<div class="ui-table-wrap"${regionAttrs(t)}>${t}</div>`);
  return `<div class="ui-prose">${wrapped}</div>`;
}

/** A code block from plain text (escaped). */
export function codeBlock(code) {
  if (typeof code !== 'string') throw new TypeError(`codeBlock: text must be a string, got ${typeof code}`);
  return `<pre class="ui-code"><code>${esc(code)}</code></pre>`;
}
