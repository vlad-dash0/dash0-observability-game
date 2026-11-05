# Design system: the UI kit

One closed set of components, one token vocabulary and one authority per fact, so every level
inherits the same look (#158). **The one rule:** build markup with the `lib/ui/*.mjs` helpers;
only they emit `ui-` classes, only `styles/kit.css` styles them, and colours come only from
`styles/tokens.css`. `test/design-system.test.mjs` and `test/ui.test.mjs` enforce it.

Status: P1b moved the step frame (`lib/play.mjs`), `ctx.speech`, Choice, the help ladder, Build it
and the `index.html` buttons onto the kit; P2 to P6 move the other widgets and the hand-written
levels (until then `base.css` keeps their wrappers narrow); P7 deletes the retired CSS.

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
| `styles/base.css`, `styles/hub.css` | Reset, legacy components (retiring), hub chrome. |
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
| `panel({id, variant, headHtml, sections})` | panel | Card with sections; `inset`, `alert`, `drop` (dashed means drop zone only). |
| `chip({text, tone, dot, swatch, dashed})` | chip | Mono pill; `data-tone` neutral, success, error, hint, attention. |
| `button({id, label, variant, disabled, finish, type, icon})`, `nextButton(id)`, `finishButton(id)` | button | Pill; `primary` (red, D2), `ghost`, `hint`, `icon`; Finish has `data-finish`. |
| `option({attr, value, labelHtml, metaHtml, kind, pressed, state, disabled, hinted, name})`, `options({id, labelledBy, layout, itemsHtml})` | option | Selectable card and its group (list, grid, wrap). |
| `feedback({id, bar})`, `setFeedback(el, tone, bodyHtml)`, `clearFeedback(el)` | feedback | The one feedback region; tones neutral, success, error (D7). |
| `meter({id, label, value, max, cells, unit, previewCells, over})` | meter | Cells (20 by default) plus a text line that is the accessible value. |
| `field({id, label, kind, rows, value, readonly, noteHtml})`, `radio({...})`, `checkbox({...})` | field | Labelled text or code input; radio and checkbox rows (`id, name, value, labelHtml, checked, disabled`). |
| `table({caption, head, rows, numeric})` | table | Data table in a scroll wrap; same look inside `prose`. |
| `stats([{label, value}])`, `dots({total, on, label, decorative, tone})` | stats | Label/value row; dots, spoken by `label` or `decorative` (aria-hidden beside a text line). |
| `helpChips(id, rows)`, `stars(n, done)`, `sideColumn({id, titleHtml, counts, hints, ruleHtml})` | side | Helps row, five stars, the success, score and hints column. |

The allowed values are exported, so callers and tests never repeat them: `BUTTON_VARIANTS`,
`PANEL_VARIANTS`, `TONES` (chip), `OPTION_KINDS`, `OPTION_STATES`, `OPTIONS_LAYOUTS`,
`FEEDBACK_TONES`, `DOTS_TONES`.

States are attributes, never extra classes: `aria-pressed` (selected), `data-state` (`correct`,
`wrong`, `locked`, `opened`), `data-hinted`, `data-tone`, `disabled`, `hidden`. Hover, focus and
disabled each have one rule in `kit.css`; besides it, a disabled toggle option fades (its only cue),
while an answered choice card stays legible.

## Layout

`.ui-step` caps a step at `--layout-narrow` (760px, centred); `.ui-step--wide` at `--layout-wide`
(1320px). The step type decides which (`STEP_TYPES[*].wide` in `lib/play.mjs`; hand-written
levels pass it); the level overlay is as wide as the widest step. Every step is the `level` container; a `.ui-split` inside it shows its side column
(300px, sticky) from `@container level (min-width: 960px)` and stacks below. The 960 is a literal:
custom properties do not work in container conditions. Questions are centred in narrow steps and
left-aligned in wide ones (D4).

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
| T7 | design-system | Retired classes: only files in `LEGACY` emit them; a stale entry fails. |
| T8, T9 | levels-play, static | Every class a level renders (each step, the page after each click) and `index.html` writes has a CSS rule. |
| T12 | play, design-system | The step frame is the kit's, wide by `STEP_TYPES[*].wide`; one `level` container. |
| T10 | ui | Exact markup, escaping, TypeErrors, CSP-safe output, every class defined in `kit.css`. |
| T11 | ui | `setFeedback` / `clearFeedback`. |
| T13 | design-system | Contrast of the kit tokens in both themes; faded waterfall rows keep 4.5:1 text. |
| T14 | design-system | Tone colours colour only markers. |

`LEGACY`, `UNDEFINED_ALLOW` (T8) and `CONTAINER_ALLOW` (T12) only shrink: each migration deletes
its own entries; the last phase asserts them empty and deletes the retired CSS from `base.css`.

**Retired classes** (`RETIRED` in the test): the old buttons (`btn`, `ghost`, `small`, `build-btn`,
`help-btn`, `back-btn`), options (`choice`, `choices`, `spot-line`, `sort-item`, `sort-bucket-btn`,
`build-opt`, `build-log`, `tradeoff-option`), feedback (`feedback`, `good`, `info`, `show`,
`build-status`), the lesson frame (`speech`, `bubble`, `q`, `lesson-intro`, `lesson-stage`), fields,
muted notes, the `build` layout and the `help-*` column.

Review only: visual quality against the prototypes, spacing, closed-set membership, and
screenshots at 375 and 1280px in both themes on every UI PR.

## Prototypes

In `docs/prototypes/` (index: `docs/prototypes/README.md`): `lesson.html` (variant C, the glow
card), `incident-board.html` (buttons, chips, meter, tiles, hypotheses, feedback, side column) and
`on-call-trace-play.html` (Build it). The architect's full plan is the "design-system-plan.md"
comment on #158.
