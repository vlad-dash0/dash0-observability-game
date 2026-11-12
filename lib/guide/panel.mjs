// The Ask the guide panel (#17 P4): one question box on a step, built from the UI kit only
// (panel, field, button, feedback). The reply is the model's text and is shown escaped, never as
// HTML. An answered question costs one hint through ctx.askedGuide(), once, and only while the
// step is current and its signal live; every other outcome is free. One request at a time.
// DOM-free at import; the browser objects arrive through `ctx` and `root`.

import { button, feedback, field, panel, setFeedback, clearFeedback } from '../ui/index.mjs';
import { MAX_QUESTION } from './client.mjs';

const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;

/** The panel's markup: a labelled box with its note, the Ask button and a polite reply region. */
export function guidePanelHtml() {
  const box = field({
    id: 'guide-q',
    label: 'Your question',
    kind: 'text',
    autocompleteOff: true,
    noteHtml: `Up to ${MAX_QUESTION} characters. Each answer you get counts as one hint. Other replies are free.`,
  });
  const ask = button({ id: 'guide-ask', label: 'Ask', variant: 'hint', disabled: true, describedBy: 'guide-q-note' });
  return panel({
    id: 'guide',
    variant: 'inset',
    headHtml: 'Ask the guide',
    sections: [`${box}${ask}${feedback({ id: 'guide-reply' })}`],
  });
}

/** What the panel says for each outcome that is not an answer. Plain text, escaped on the way in. */
export function outcomeText(outcome) {
  switch (outcome.kind) {
    case 'withheld':
      return 'The guide would have given the answer away. Try asking about the idea instead. This one is free.';
    case 'rate-limited': {
      const min = Math.max(1, Math.ceil(outcome.retryAfterS / 60));
      return `The guide is busy right now. Try again in about ${min} ${min === 1 ? 'minute' : 'minutes'}. This one is free.`;
    }
    case 'unavailable':
      return 'The guide is not available on this step right now. This one is free.';
    case 'upstream':
      return 'The guide could not answer just now. Try again in a moment. This one is free.';
    case 'rejected':
      return 'The guide could not take that question. Try a shorter, plainer one. This one is free.';
    default:
      return 'The guide did not answer. Try again in a moment. This one is free.';
  }
}

/** The question as the server will see it: control characters become spaces, then trimmed. */
export const cleanQuestion = (raw) => String(raw).replace(CONTROL, ' ').trim();

/**
 * Wire the panel inside `root` (which holds guidePanelHtml()) for step `stepId` of `levelId`.
 * `signal` is the step's: once it aborts (Next, Back, close) nothing more is drawn or charged.
 * Returns `{disable()}`: the step is solved, so Ask and the box go off and a pending reply is dropped.
 */
export function mountGuidePanel(ctx, root, { levelId, stepId, signal }) {
  const input = root.querySelector('#guide-q');
  const ask = root.querySelector('#guide-ask');
  const reply = root.querySelector('#guide-reply');
  let pending = false;
  let off = false;
  const stale = () => off || signal.aborted;
  const valid = () => {
    const n = cleanQuestion(input.value).length;
    return n >= 1 && n <= MAX_QUESTION;
  };
  const sync = () => {
    ask.disabled = off || pending || !valid();
  };

  async function send() {
    if (pending || off || signal.aborted || !valid()) return;
    pending = true;
    sync();
    setFeedback(reply, 'neutral', 'Asking the guide...', { scroll: true });
    const outcome = await ctx.guide.ask(levelId, stepId, cleanQuestion(input.value), signal);
    pending = false;
    if (stale()) return;
    sync();
    if (outcome.kind === 'ok') {
      ctx.askedGuide();
      setFeedback(reply, 'neutral', `<p>${ctx.escapeHtml(outcome.hint)}</p><p>That counted as one hint.</p>`, { scroll: true });
    } else {
      setFeedback(reply, 'neutral', `<p>${ctx.escapeHtml(outcomeText(outcome))}</p>`, { scroll: true });
    }
  }

  ask.onclick = () => {
    input.focus?.(); // Ask goes disabled while pending; keep the player in the box
    return send();
  };
  input.oninput = sync;
  input.onkeydown = (e) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault?.();
    send();
  };
  signal.addEventListener?.('abort', () => {
    pending = false;
  }, { once: true });
  return {
    disable() {
      off = true;
      input.disabled = true;
      sync();
      if (pending) clearFeedback(reply);
    },
  };
}
