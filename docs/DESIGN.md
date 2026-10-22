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
| `--caution`           | `#94630b`                | `#e2b45a`                   | Needs input / blocked step    |
| `--danger`            | `#dc143c`                | `#f07178`                   | Fail / crimson from the site  |
| `--info`              | `#2f6a8f`                | `#8bb0c9`                   | Engineering / informational   |
| `--viewport`          | `#111a26`                | `#111a26`                   | 3D / canvas stage (always dark) |
| `--viewport-ink`      | `#e8eef4`                | `#e8eef4`                   | Text and lines on the stage   |
| `--viewport-line`     | `#2c3d55`                | `#2c3d55`                   | Grid and rules on the stage   |
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

Every token is also a Tailwind colour (`@theme inline` in `globals.css`):
write `bg-surface`, `text-muted`, `border-line`, `text-caution`, not
`bg-[var(--surface)]` and never a Tailwind palette colour (`zinc-*`,
`amber-*`, `red-*`, …) or a raw hex class.

## Character

The planner is a measuring instrument for a pallet. Measurements are the
content, so they get the typographic emphasis: Geist Mono for every
dimension, count, rank, and status; Geist Sans for prose and labels.
Surfaces stay flat and quiet (1px rules, radius 0) so the plan itself is
the loudest thing on screen.

Signature: the plan field is drawn like a dimensioned technical drawing:
edge scale ticks and dimension lines carry the real pallet measurements
instead of decorative frames. Spend boldness there and nowhere else.

## Type and chrome

- Fonts stay Geist Sans / Geist Mono (already in the app). Do not load Avenir
  from the marketing site.
- Type scale: `text-micro` (11px, labels and captions), `text-xs` (12px,
  controls and tables), `text-body` (13px, chrome and headings), `text-sm`
  (14px, dialogs), `text-base` (16px, touch inputs). No `text-[Npx]`.
- Radius 0 everywhere. Utility buttons use `.ui-btn` / `.ui-btn-primary`
  with modifiers `.ui-btn-sm`, `.ui-btn-touch`, `.ui-btn-ghost`,
  `.ui-btn-danger`; inputs use `.ui-input`; tables use `.ui-table`.
  No pills, no gradients, no glass, no glow.
- Motion: 120 ms colour transitions only; `prefers-reduced-motion` disables
  them globally.
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

**Imported `.rob`** (`source.kind === "rob-import"`):

1. Plan

There is no Tools / Validate step and no “Production tools” catalog.
Editor, Robotics, Simulation, and Report open as named surfaces from the
header. They cover the viewport; do not leave a tools list visible beside
them. Legacy `.rob` stays as a quiet action on Plan / Inputs. There is no
`.mpb` inspector in the product: proprietary MultiPack files are not decoded.

Tools are not steps. Each tool declares its prerequisites through
`productionToolGate` (`src/features/planning-case/planningCaseModel.ts`):
Editor and Robotics need a materialized stack, Simulation needs at least one
calculated robot cycle, and Report opens for any project. A blocked tool
names the missing prerequisite and links back to the step that resolves it;
overlays must not re-implement their own gating.

## Product language

The product is the **Pallet planner** in metadata, the desktop and mobile
chrome, and the exported report. Terms stay distinct:

- **Project** — the persisted planning case (package, pallet, solutions).
- **Plan** — what the user is building; a project contains it.
- **Layout** — one generated layer pattern; a solver candidate.
- **Stack** — the materialized sequence of layers with interlayers.
- **Layer** — one physical tier of the stack.
- **Robot cycle** — one calculated pick-and-place unit derived from the stack.
- **`.rob` file** — the legacy robot plan format; opening one creates a
  project.

Rules:

- There is no step tab strip. Back and Continue move one screen at a time.
- Compact readout `2/3` sits on the current-step panel, not as skippable tabs.
- Opening a project starts at the furthest completed step: empty → Inputs,
  patterns without a stack → Generate, a saved stack → Stack. Imported `.rob`
  stays on Plan.
- Opening a `.rob` file **creates the project**. It is not a session
  “reference” to recreate. If a `.rob` already exists, skip Generate /
  Compare / Reference.
- The plan field shows the current (or imported) layer only. Do not overlay a
  second reference plan in the default chrome.

## Components

One design system covers every surface: planner chrome, dialogs, library,
and the operator tools (Stack, Editor, Robotics, Simulation, Report). All of
them follow the system light/dark scheme through the tokens. The only fixed
dark area is the 3D / canvas stage itself (`--viewport*`), so geometry reads
the same in both schemes. There is no separate zinc/amber operator palette.

Shared primitives live in `src/components/ui/`; use them instead of
hand-writing the markup:

| Primitive                 | Use                                              |
| ------------------------- | ------------------------------------------------ |
| `Panel` / `PanelHeader`   | Bordered section with title, note, actions       |
| `MetricRow`               | Label / mono value row inside a `<dl>`           |
| `Field` / `NumberField`   | Label, control, inline error (raw text kept)     |
| `StatusBadge` / `Notice`  | Status marker and inline message box             |
| `ProgressBlock`           | Long-running progress with optional cancel       |
| `Drawer`                  | Modal surface: `wide`, `narrow`, `dialog`; Escape closes, focus is trapped |

Status meanings are one vocabulary (`statusTone.ts`): pass `--ok` ■,
caution `--caution` ▲ (needs input, blocked step), blocked / failure
`--danger` ×, observed `--measure` ◇, info `--info` ●, unknown `--muted` –.
Map workspace states onto it (`toneForLedgerStatus`, `toneForReadiness`)
instead of picking colours locally. One primary action per surface.

Downloads go through `src/lib/download.ts`.
