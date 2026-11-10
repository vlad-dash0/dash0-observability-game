# Design system: the UI kit

One closed set of components, one token vocabulary and one authority per fact, so every level
inherits the same look (#158). **The one rule:** build markup with the `lib/ui/*.mjs` helpers;
only they emit `ui-` classes, only `styles/kit.css` styles them, and colours come only from
`styles/tokens.css`. `test/design-system.test.mjs` and `test/ui.test.mjs` enforce it.

Status: P1b moved the step frame (`lib/play.mjs`), `ctx.speech`, Choice, the help ladder, Build it
and the `index.html` buttons onto the kit; P2 (#143) moved the incident board (and added `fold`);
P3a (#156) moved Sort it (kit markup, side column and hint ladder);
P3b (#160) moved Spot it (kit, hint ladder); #159 moved Query it and Configure it (kit split, side column, hint ladder) and E1 level 1.2 (Env config step on the kit, wide with the side column and the ladder; #165 moved the whole level frame, so `naming-your-service` has no LEGACY entry); the other widgets and the hand-written levels move in
later phases (until then `base.css` keeps their wrappers narrow); the last phase deletes the
retired CSS.

Owner decisions (#158, 2026-11-04), cited as D1 to D7 here and in the code: **D1** wrong answers
stay purple (`--color-error`); red `--color-alert` is only for the firing banner. **D2** the primary
button is a red pill, 14px/600, no glow, not full width. **D3** the hub changes only its buttons; the
reward card keeps its glow. **D4** questions are centred in narrow steps, left-aligned in wide ones.
**D5** a new component needs an entry here, reviewer approval and screenshots the owner sees.
**D6** #57 and #59 fold into #160. **D7** a wrong answer uses the error tone; info-only messages are
neutral.

## Files

| File | Holds |
| --- | --- |
| `styles/tokens.css` | Every colour (primitives and semantic `--color-*`) and the scale tokens. |
| `styles/kit.css` | All kit CSS; every selector names a `ui-` class. |
| `styles/widgets.css` | Layouts only a widget has (the trace waterfall `wf-*`), around kit components. Append-only. |
| `styles/base.css`, `styles/hub.css` | Reset and typography, hub chrome. No pre-kit component CSS is left (#158 P7). |
| `lib/ui/*.mjs` | The helpers (`lib/ui/index.mjs` exports them all). |
| `test/helpers/css.mjs` | Stylesheet parser, colour resolution, contrast, class scanners. |

`index.html` loads tokens, base, kit, widgets, hub, in that order.

## Tokens

Two layers. **Primitives** are hex values and live only in `tokens.css`: `--d0-*` (dash0.com brand),
`--globe-*`, `--wf-*`, `--kit-*`. **Semantic** tokens are `--color-*`, each `light-dark(<light>, <dark>)`
over primitives; every other stylesheet uses only these (the hub confetti is the one exception).

Kit colours: `--color-lesson`, `-lesson-eyebrow`, `-lesson-code`, `-lesson-glow`, `-lesson-dot` (the
lesson card), `--color-meter-left`, `--color-alert` (the firing banner only; D1).

Scale: `--space-1` to `--space-6` and `--space-8` (4N px); `--text-xs` 10.5, `-sm` 12.5, `-md` 14,
`-base` 15, `-q` 18, `-lesson` 18, `-title` 24; `--weight-regular` / `-semibold` / `-bold`;
`--radius-xs` 6, `-sm` 10, `--radius` 14, `-lg` 18, `-pill`; `--layout-narrow` 760px, `--layout-wide`
1320px, `--side-width` 300px, `--measure` 72ch; `--opacity-disabled`; `--dur-fast`.

Palette rules:
1. Surfaces are neutral greys; the only tinted ones are the lesson glow and the night success card.
2. Hue is meaning: success mint, error purple (wrong answers, D1), alert red (firing banner),
   hint violet, attention amber (`--color-parent`), note orange. Red otherwise only on the primary
   button and the brand mark.
3. Tone colours go on borders (45 to 55% mixes), icons, markers and dots. Text stays `--color-text`
   or `--color-text-muted` (purple on dark grey is about 3.9:1, too low for small text).
4. State tints stay at or under 8%.
5. No shadows or glows on controls; a pressed ring is an inset box-shadow.
6. One primary button per screen.
7. Every state has a non-colour cue (a glyph, a word, a border style).

## Components

Text params are escaped; `*Html` params are trusted authored HTML (escape player text first); ids
and hooks must match `/^[A-Za-z][\w-]*$/`; any bad input throws a TypeError naming the helper. See
each function's JSDoc for the exact markup.

| Call | Module | What |
| --- | --- | --- |
| `step({wide, bodyHtml})`, `split({mainHtml, sideHtml})`, `actions({wide, buttonsHtml})` | layout | Step frame (narrow or wide), board plus side column (inside a wide step), actions bar. |
| `lesson(bodyHtml)` | text | The glow lesson card ("Lesson" eyebrow, glow top left, dot top right). |
| `question({id, html})`, `stepHead({step, titleHtml, noteHtml})`, `eyebrow(text)` | text | The step's question; "Step N" heading; mono label. |
| `note(bodyHtml)`, `prose(bodyHtml)`, `codeBlock(text)` | text | Muted small print; classless authored content; escaped code. |
| `panel({id, variant, headHtml, sections})` | panel | Card with sections; `inset`, `alert`, `drop` (dashed means drop zone only; Sort it no longer uses it, #261: it categorises with choice options and plain groups, no boxes). |
| `chip({text, tone, dot, swatch, dashed})` | chip | Mono pill; `data-tone` neutral, success, error, hint, attention. |
| `button({id, label, variant, disabled, finish, type, icon, describedBy})`, `nextButton(id)`, `finishButton(id)`, `linkButton({id, label, href, variant})` | button | Pill; `linkButton` is the same pill as an `<a>` for a navigation (the sign-in link; `primary`, `ghost`, `hint`; `href` a local path only); `primary` (red, D2), `ghost`, `hint`, `icon`; `describedBy` (an id) points a disabled button at its reason; Finish has `data-finish`. |
| `option({attr, value, labelHtml, metaHtml, kind, pressed, state, disabled, hinted, drop, name})`, `options({id, labelledBy, layout, itemsHtml})` | option | Selectable card and its group (list, grid, wrap, drops). `drop` (choice kind only) makes a category target: dashed, centred, legible while disabled (muted text, no fade); `drops` lays targets out as an equal-width row that wraps. Sort it's category row uses both. The `radio` kind is a label around a real `<input type="radio" name>`: the dot, the label, then the meta line beneath; a picked card carries `data-picked`. |
| `feedback({id, bar})`, `setFeedback(el, tone, bodyHtml)`, `clearFeedback(el)` | feedback | The one feedback region; tones neutral, success, error (D7). |
| `meter({id, label, value, max, cells, unit, previewCells, over})` | meter | Cells (20 by default) plus a text line that is the accessible value (en-US grouping, so 4800 reads 4,800). |
| `fold({value, titleHtml, metaHtml, bodyHtml, open, fresh})` | fold | Evidence card that folds to one line: a native `<details>` (caret, an h4 title that takes focus by script, optional meta chips) around its body. `open` starts it open, `fresh` marks the newest (`data-fresh`). Approved by the owner for #143 (2026-11-05); its look awaits the owner's D5 sign-off from that PR's screenshots. |
| `field({id, label, kind, rows, value, readonly, autocompleteOff, noteHtml})`, `radio({...})`, `checkbox({...})` | field | Labelled text, code or secret input (secret: a write-only `type=password` that asks browsers and password managers not to autofill or save it (they may ignore that), no value, never readonly; for a token; `autocompleteOff` adds `autocomplete="off"` to a text field); radio and checkbox rows (`id, name, value, labelHtml, checked, disabled`).; `radioGroup({legend, itemsHtml})` wraps radio or checkbox rows in a `<fieldset class="ui-group">` whose `<legend>` is the question (`legend`, text; or `legendHtml`, trusted HTML for a question with `<code>`; exactly one), so the controls are announced with it. |
| `table({caption, head, rows, numeric})` | table | Data table in a scroll wrap; same look inside `prose`, where `prose()` wraps each table in the same table scroller. A caption makes the scroller a labelled region (`role=region`, `aria-label` = the caption), so a keyboard user who tabs to it hears what it holds. `code` in a cell uses `overflow-wrap: break-word`, so a token breaks only when it would overflow; `anywhere` would lower the column's min-content width, squeeze the columns and split short tokens. A long address should carry `<wbr>` hints at its punctuation. |
| `stats([{label, value}])`, `dots({total, on, label, decorative, tone})` | stats | Label/value row; dots, spoken by `label` or `decorative` (aria-hidden beside a text line). |
| `helpChips(id, rows)`, `stars(n, done)`, `sideColumn({id, titleHtml, counts, hints, ruleHtml})` | side | Helps row, five stars, the success, score and hints column. |

The allowed values are exported, so callers and tests never repeat them: `BUTTON_VARIANTS`,
`PANEL_VARIANTS`, `TONES` (chip), `OPTION_KINDS`, `OPTION_STATES`, `OPTIONS_LAYOUTS`,
`FEEDBACK_TONES`, `DOTS_TONES`.

A widget that redraws part of its board in place wraps that part in a `[data-region]` div inside a
panel section (`kit.css` gives it the section's grid); it never adds a class of its own. The
incident board (`lib/widgets/incident-view.mjs`) is the reference: one typed `boardView(s, st, ui)`
feeds every template, and each template is only kit helpers.

States are attributes, never extra classes: `aria-pressed` (selected; `data-picked` on a radio card), `data-state` (`correct`,
`wrong`, `locked`, `opened`), `data-hinted`, `data-tone`, `disabled`, `hidden`. Hover, focus and
disabled each have one rule in `kit.css`; besides it, a disabled toggle option, and a disabled choice option with no `data-state`, fades (its only cue), except a `drop` target, which goes muted and transparent instead, while an answered choice card (it has a `data-state`) stays legible.

## Layout

`.ui-step` caps a step at `--layout-narrow` (760px, centred); `.ui-step--wide` at `--layout-wide`
(1320px). The step type decides which (`STEP_TYPES[*].wide` in `lib/play.mjs`; hand-written levels
pass it); the level overlay is as wide as the widest step. Every step is the `level` container; a
`.ui-split` inside it shows its side column (300px, sticky) from `@container level (min-width:
960px)` and stacks below. The 960 is a literal: custom properties do not work in container
conditions. Kit text inside a clipping container (`overflow: hidden`) must be able to break a long token: lesson `code` and `code` inside a `.ui-panel` (which clips too, and is no table cell) set `overflow-wrap: anywhere`, as feedback, chips and options already do. Questions are centred in narrow steps and left-aligned in wide ones (D4).

## Modal

One dialog shell for How to play (`#howto-modal`), About (`#about-modal`), Save code (`#save-modal`), Leaderboard (`#board-modal`) and Account (`#account-modal`; the last three have a body `app.mjs` draws)
(#282, owner direction 2026-11-08; D5 sign-off from the PR screenshots). Its markup is static in
`index.html` (the one place that writes `ui-` classes by hand, like the buttons), because Alpine opens
it with `x-show`; `test/modal.test.mjs` pins every shell to the same parts:

| Part | Class | Holds |
| --- | --- | --- |
| Backdrop | `ui-modal` | Fixed, dimmed and blurred; `role="dialog"`, `aria-modal="true"`, named by its h2. |
| Card | `ui-modal-card` | Surface with a hairline top accent (red to orange); body scrolls inside it (`max-block-size: 100%`), so it fits 320px. |
| Head | `ui-modal-head`, `ui-modal-heading` | Mono `ui-eyebrow`, the h2 (`tabindex="-1"`, focus lands here), and a `ui-btn--icon` close with a name. The lesson glow sits behind it. |
| Body | `ui-modal-body` | The scrolling content: `ui-modal-topic` sections (a heading and muted text) and `ui-modal-note`; a `ui-panel` placed directly in it loses its box (Save code). |
| Foot | `ui-modal-foot` | Optional buttons, right-aligned; one primary at most (About's Close; How to play's are ghost, the level behind owns the primary). |

Behaviour: focus moves to the title on open and back to the opener on close (`app.mjs` `focusSoon`);
Escape closes the top modal (`onEscape`); the page behind is inert (`#hub` via `hubInert()`, `.overlay`
via `:inert="howToOpen"`, so How to play sits beside the overlay, never inside it); Tab and Shift+Tab wrap
inside (`lib/modal-focus.mjs`, `trapTab`); motion is a short fade and slide that the global
reduced-motion rule shortens. The reward card is not a modal of this kind (D3: it keeps its glow).
How to play opens by itself the first time a widget type appears (as before) and from the level header's
How to play button.

## Focus

A level opens with focus on Back (`#ov-back`, set by `openLevel` in `app.mjs` after `level.run`), or on the How to play modal's title when it opens by itself; a widget's mount focus (first line, input, radio) only takes effect on later steps, and after a Check or Next focus moves to the feedback or the next step.

## Authoring content

- Lesson text, questions and prose are classless HTML inside the helpers.
- Behaviour and tests use ids and `data-*`, never classes; classes are styling only.
- CSP: no `style=`, no `on*=`; wire buttons with `el.onclick` after rendering.

## Adding a component or a token

The set is closed (D5). A new component needs an entry in this file, reviewer approval and
screenshots the owner sees (375 and 1280px, light and dark). Add the helper to `lib/ui/`, its
export to `lib/ui/index.mjs`, its CSS to `kit.css`, and rows to `test/ui.test.mjs` (exact markup,
the contract table and invalid inputs). A new colour is a primitive plus a `light-dark()` semantic
token with a contrast check.

## Guards

| Guard | Where | Checks |
| --- | --- | --- |
| T1 | design-system | No colour literal outside `tokens.css` (CSS, and `fill=`/`color=`/`rgb(` in lib and level markup). |
| T2 | design-system | Primitives only in `tokens.css`; no custom property declared elsewhere. |
| T3 | design-system | Every `var(--x)` is a declared token. |
| T4 | design-system | Only `kit.css` names `ui-` classes; its selectors are kit-scoped, no ids. |
| T5 | design-system | No `:has(` and no `!important` (reduced motion, `[x-cloak]`); no glows. |
| T6 | design-system | Only `lib/ui` emits `ui-` classes (`index.html` is the static exception). |
| T7 | design-system | Retired classes: no file emits them (`LEGACY` is empty) and no stylesheet defines them. |
| T15 | design-system | Every class in `base.css`, `hub.css`, `widgets.css` has an emitter, or a `DYNAMIC_ALLOW` entry tied to the companion class its rule must sit with. |
| T8, T9 | levels-play, static | Every class a level renders (each step, the page after each click) and `index.html` writes has a CSS rule. |
| T12 | play, design-system | The step frame is the kit's, wide by `STEP_TYPES[*].wide`; one `level` container. |
| T10 | ui | Exact markup, escaping, TypeErrors, CSP-safe output, every class defined in `kit.css`. |
| T11 | ui | `setFeedback` / `clearFeedback`. |
| T13 | design-system | Contrast of the kit tokens in both themes; faded waterfall rows keep 4.5:1 text. |
| T14 | design-system | Tone colours colour only markers. |

`LEGACY`, `UNDEFINED_ALLOW` (T8) and `CONTAINER_ALLOW` (T12) are empty and asserted empty: the
legacy UI is gone, and nothing on it can come back.

**Retired classes** (`RETIRED` in the test; no markup emits them and no stylesheet defines them, so
a new use fails T7 and T8): the old buttons (`btn`, `ghost`, `small`, `build-btn`,
`help-btn`, `back-btn`), options (`choice`, `choices`, `spot-line`, `sort-item`, `sort-bucket-btn`,
`build-opt`, `build-log`, `tradeoff-option`, `tradeoff-keeps`), feedback (`feedback`, `good`, `info`,
`build-status`), the lesson frame (`speech`, `bubble`, `q`, `lesson-intro`, `lesson-stage`), fields,
muted notes, the `build` layout and the `help-*` column. (`show` stays in `hub.css` as the open state of
the overlay, reward card and notice.)

Review only: visual quality against the prototypes, spacing, closed-set membership, and
screenshots at 375 and 1280px in both themes on every UI PR.

## Prototypes

In `docs/prototypes/` (index: `docs/prototypes/README.md`): `lesson.html` (variant C, the glow
card), `incident-board.html` (buttons, chips, meter, tiles, hypotheses, feedback, side column) and
`on-call-trace-play.html` (Build it). The architect's full plan is the "design-system-plan.md"
comment on #158.
