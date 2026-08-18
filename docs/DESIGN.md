# Design

Corporate UI for the palletizing planner, derived from
[Szaidel Cosmetic GmbH](https://www.szaidel-cosmetics.de/) (`szaidel-cosmetics.de`).
The app follows the OS appearance (`prefers-color-scheme`). Do not invent a
separate theme toggle, and do not reintroduce a skippable tab strip for the
planning workflow.

## Brand

Szaidel Cosmetics is a German contract manufacturer. Their site uses a deep
navy identity with cool steel, sage, and mist accents. That navy is the
product colour, not a generic SaaS blue.

| Token                 | Light                    | Dark                        | Role                          |
| --------------------- | ------------------------ | --------------------------- | ----------------------------- |
| `--canvas`            | `#f3f3f3`                | `#101820`                   | Page / plan-field background  |
| `--surface`           | `#ffffff`                | `#162033`                   | Panels, header, drawers       |
| `--surface-hover`     | `#e8eef3`                | `#1c2b40`                   | Row / button hover            |
| `--ink`               | `#173159`                | `#e8eef4`                   | Primary text                  |
| `--muted`             | `#5e5e5e`                | `#9aadc0`                   | Secondary text                |
| `--line`              | `#d5dbe3`                | `#2c3d55`                   | 1px borders                   |
| `--brand`             | `#173159`                | `#8bb0c9`                   | Primary actions, current step |
| `--brand-hover`       | `#122744`                | `#b8dde1`                   | Primary hover                 |
| `--brand-on`          | `#ffffff`                | `#101820`                   | Text on `--brand`             |
| `--accent` / `--mist` | `#8bb0c9` / `#b8dde1`    | `#b8dde1` / `#8bb0c9`       | Steel highlight               |
| `--ok`                | `#3d7a4e`                | `#a9d4b2`                   | Pass / sage                   |
| `--danger`            | `#dc143c`                | `#f07178`                   | Fail / crimson from the site  |
| `--focus`             | `#8bb0c9`                | `#8bb0c9`                   | Focus ring                    |
| `--plan-fill`         | `rgba(23, 49, 89, 0.14)` | `rgba(139, 176, 201, 0.18)` | Selected plan packages        |
| `--plan-stroke`       | `#173159`                | `#8bb0c9`                   | Current-plan outlines         |
| `--measure`           | `#8bb0c9`                | `#b8dde1`                   | Observed / imported evidence  |

Site-extracted source colours (do not use raw unless mapped above):

- Navy `#173159` (dominant brand)
- Steel `#8bb0c9`
- Sage `#a9d4b2`
- Mist `#b8dde1`
- Lavender `#dfdaeb` (marketing only, not in the app chrome)
- Crimson `#dc143c`
- Body grey `#5e5e5e`, page grey `#f3f3f3`

Legacy aliases `--deck-black`, `--graphite-surface`, `--steel-rule`,
`--chalk-text`, `--muted-text`, `--measured-blue`, `--selection-amber`,
`--inspection-pass`, `--inspection-fail` still exist and point at the tokens
above. Prefer the new names in new code.

## Type and chrome

- Fonts stay Geist Sans / Geist Mono (already in the app). Do not load Avenir
  from the marketing site.
- Body 13–14px. Mono for dimensions, ranks, and status.
- Radius 0 on native controls. Utility buttons use the `.ui-btn` / `.ui-input`
  classes (square, 1px border). No pills, no gradients, no glass, no glow.
- Shadows at most `0 2px 8px rgba(0,0,0,0.1)`.
- Clickable controls use `cursor: pointer`.
- Appearance is **system only**: light tokens in `:root`, dark tokens in
  `@media (prefers-color-scheme: dark)`.

## Planning workflow

Do not bring back a six-tab strip (Inputs / Reference / Generate / Compare /
Stack / Validate). Steps are sequential.

**New project** (`source.kind === "new"`):

1. Inputs
2. Generate
3. Stack
4. Tools

**Imported `.rob`** (`source.kind === "rob-import"`):

1. Plan
2. Tools

Rules:

- Future steps are not buttons. Back is allowed; Continue advances one step.
- Compact readout `2/4` (or `1/2` on import) sits on the stepper.
- Opening a `.rob` file **creates the project**. It is not a session
  “reference” to recreate. If a `.rob` already exists, skip Generate / Compare
  / Reference.
- The plan field shows the current (or imported) layer only. Do not overlay a
  second reference plan in the default chrome.

## Components

| Class             | Use                               |
| ----------------- | --------------------------------- |
| `.ui-input`       | Text / number / select fields     |
| `.ui-btn`         | Secondary actions                 |
| `.ui-btn-primary` | Navy (light) or steel (dark) fill |

Tokens live in `src/styles/globals.css`. Keep production tools (editor,
robotics, simulation) on the same variables when touching them; do not
reintroduce zinc/amber palettes.
