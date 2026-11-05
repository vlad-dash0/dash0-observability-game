# Design system: the UI kit

One closed set of components, one token vocabulary and one authority per fact, so every level
inherits the same look (#158). **The one rule:** build markup with the `lib/ui/*.mjs` helpers;
only they emit `ui-` classes, only `styles/kit.css` styles them, and colours come only from
`styles/tokens.css`. `test/design-system.test.mjs` and `test/ui.test.mjs` enforce it.

Status: P1a (this foundation) is additive; nothing renders through the kit yet. P1b moves
`lib/play.mjs`, `ctx.speech`, Choice, the help ladder and Build it onto it; P2 to P6 move the other
widgets and the hand-written levels; P7 deletes the retired CSS.

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

| Helper | Module | What |
| --- | --- | --- |
| `step`, `split`, `actions` | layout | Step frame (narrow or wide), board plus side column, actions bar. |
| `lesson` | text | The glow lesson card ("Lesson" eyebrow, glow top left, dot top right). |
| `question`, `stepHead`, `eyebrow` | text | The step's question; "Step N" heading; mono label. |
| `note`, `prose`, `codeBlock` | text | Muted small print; classless authored content; escaped code. |
| `panel` | panel | Card with sections; `inset`, `alert`, `drop` (dashed means drop zone only). |
| `chip` | chip | Mono pill; `data-tone` neutral, success, error, hint, attention; dot, swatch, dashed. |
| `button`, `nextButton`, `finishButton` | button | Pill; `primary` (red, D2), `ghost`, `hint`, `icon`; Finish has `data-finish`. |
| `option`, `options` | option | Selectable card (`choice`, `tile`, `hypothesis`, `toggle`, `line`, `radio`) and its group. |
| `feedback`, `setFeedback`, `clearFeedback` | feedback | The one feedback region; tones neutral, success, error (D7). |
| `meter` | meter | Cells (20 by default) plus a text line that is the accessible value. |
| `field`, `radio`, `checkbox` | field | Labelled text or code input; custom radio and checkbox rows. |
| `table` | table | Data table in a scroll wrap; same look inside `prose`. |
| `stats`, `dots` | stats | Label/value row; progress dots with a spoken label. |
| `helpChips`, `stars`, `sideColumn` | side | Helps row, five stars, the success, score and hints column. |

States are attributes, never extra classes: `aria-pressed` (selected), `data-state` (`correct`,
`wrong`, `locked`, `opened`), `data-hinted`, `data-tone`, `disabled`, `hidden`. Hover, focus and
disabled each have one rule in `kit.css`.

## Layout

`.ui-step` caps a step at `--layout-narrow` (760px, centred); `.ui-step--wide` at `--layout-wide`
(1320px). The step type decides which (`STEP_TYPES[*].wide` in `lib/play.mjs` from P1b; hand-written
levels pass it). Every step is the `level` container; a `.ui-split` inside it shows its side column
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
| T5 | design-system | No `:has(` (legacy list) and no `!important` (reduced motion, `[x-cloak]`); no glows. |
| T6 | design-system | Only `lib/ui` emits `ui-` classes (`index.html` is the static exception). |
| T7 | design-system | Retired classes: only files in `LEGACY` emit them; a stale entry fails. |
| T8, T9, T12 | levels-play, static (P1b) | Rendered and `index.html` classes defined; generic two-column layout. |
| T10 | ui | Exact markup, escaping, TypeErrors, CSP-safe output, every class defined in `kit.css`. |
| T11 | ui | `setFeedback` / `clearFeedback`. |
| T13 | design-system | Contrast of the kit tokens in both themes. |
| T14 | design-system | Tone colours colour only markers. |

`LEGACY`, `HAS_ALLOW` (and P1b's `UNDEFINED_ALLOW`) only shrink: each migration deletes its own
entries; the last phase asserts them empty and deletes the retired CSS from `base.css`.

**Retired classes** (`RETIRED` in the test): the old buttons (`btn`, `ghost`, `small`, `build-btn`,
`help-btn`, `back-btn`), options (`choice`, `choices`, `spot-line`, `sort-item`, `sort-bucket-btn`,
`build-opt`, `build-log`, `tradeoff-option`), feedback (`feedback`, `good`, `info`, `show`,
`build-status`), the lesson frame (`speech`, `bubble`, `q`, `lesson-intro`, `lesson-stage`), fields,
muted notes, the `build` layout and the `help-*` column.

Review only: visual quality against the prototypes, spacing, closed-set membership, and
screenshots at 375 and 1280px in both themes on every UI PR.

## Prototypes

Outside the repo, under `~/dash0-observability-game-worktrees/_handover/`: `trace-proto/lesson.html`
(variant C, the glow card), `trace-proto/incident-board.html` (buttons, chips, meter, tiles,
hypotheses, feedback, side column), `trace-proto/on-call-trace-play.html` (Build it) and
`design-system-plan.md` (the architect's plan, also on #158).
