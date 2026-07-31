# AGENTS.md

## Learned User Preferences

- Writes prompts in German (mixed with English technical terms) and expects answers in German.
- Iterates on UI in small steps with short corrections; apply the smallest targeted change instead of redesigning the component.
- References ChatGPT's UI as the design target (e.g. the conversation/prompt navigation rail for the layer slider); when markup is pasted, match its structure and sizing closely.
- Dislikes wireframe rendering for hidden or above-cutoff layers; prefer hiding them or using subtle opacity.
- Hover magnification should push neighbouring items apart, but spacing must be tuned so the first and last item stay visible when hovering near the ends.
- Layer-rail hit targets should extend beyond the visible tick marks so clicking is easier.
- Clickable elements must show a pointer/hand cursor.
- Wants compact status readouts next to controls (e.g. a `3/4` current-layer indicator below the slider).
- Clicking a package should set the visible-layer cutoff to that package's layer (e.g. click on layer 2 → show only layers 1–2).
- Expects a typecheck run after each change, with the result reported.

## Learned Workspace Facts

- Next.js 15 App Router, React 19, Three.js, Tailwind CSS v4, TypeScript; T3 scaffold with Bun as the lockfile manager.
- Verify with `npm run typecheck` (`tsc --noEmit`); `npm run check` also runs lint, and `npm run format:write` applies Prettier.
- Key files: `src/lib/robParser.ts` (.rob parsing and Z math), `src/components/RobViewer.tsx` (Three.js scene), `src/components/LayerSlider.tsx` (layer rail), `src/lib/storage.ts` (IndexedDB persistence), `src/app/page.tsx`.
- `.rob` layout: line 0 pallet dims, line 1 package dims with an optional 4th input-direction flag (`1` = packages arrive rotated 90°), line 2 unique layer count, line 3 total layer count, then one layer-order row per layer whose second column is the Zwischenlage flag, then per-layer coordinate blocks.
- Blank lines in `.rob` are positionally significant and must not be filtered out during parsing.
- Each coordinate line holds x, y, rotation (0/90/180/270), package count, and dx/dy encoding the blue-line side or corner; a multi-package line is a single grip, so all its boxes share the same `placeX`/`placeY`; clicking a box highlights the whole grip and shows place coords.
- Bottom-face Z (`layerZBottom`) is the sum of package heights below plus Zwischenlagen (3 mm each, `ZWISCHENLAGE_HEIGHT_MM`, matching the robot's `Dicke_ZwLagen`); robot place Z (`layerPlaceZ`) is bottom-face Z plus the current package height (top of the box); pallet height is excluded.
- Selection marker is the gripper OBJ+MTL under `public/models/gripper/` (Y-up CAD → scene Z-up); strip OBJ `l` edge lines for a solid look, but do not dispose shared MTL materials when removing those lines.
- Saved pallets keep their raw `.rob` text and are re-parsed on load so older entries pick up newer parser fields.
- Sample `.rob` files are not committed; they live in the user's local pallet-plan folders outside the repo.
