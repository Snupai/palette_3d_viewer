import type { CandidateLabelSide } from "~/domain/solver/candidateIdentity";
import type {
  ProjectEditorDiagnostic,
  ProjectEditorGroup,
} from "~/features/editor/editorModel";

/** Label side options as shown in the editor, in the order of the picker. */
export const labelSideOptions: ReadonlyArray<
  readonly [CandidateLabelSide | "", string]
> = [
  ["", "Keine Vorgabe"],
  ["top", "Oben"],
  ["right", "Rechts"],
  ["bottom", "Unten"],
  ["left", "Links"],
  ["top_right", "Oben rechts"],
  ["bottom_right", "Unten rechts"],
  ["bottom_left", "Unten links"],
  ["top_left", "Oben links"],
];

/** "1 Griff", "2 Griffe". */
export function countLabel(
  count: number,
  singular: string,
  plural: string,
): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** The part of a layer pattern the labels need. */
type PatternLike = {
  placements: readonly { id: string; sequence: number }[];
};

/** "#3" for the third placed package of a pattern, falling back to the id. */
export function packageLabel(
  pattern: PatternLike,
  placementId: string,
): string {
  const placement = pattern.placements.find(({ id }) => id === placementId);
  return placement ? `#${placement.sequence + 1}` : placementId;
}

/** "G2" for a grip, by its order in the current execution sequence. */
export function gripLabel(
  groups: readonly ProjectEditorGroup[],
  gripId: string,
): string {
  const group = groups.find(({ id }) => id === gripId);
  return group ? `G${group.orderIndex + 1}` : gripId;
}

/**
 * German text for a model diagnostic. The model keeps English messages for
 * tests and logs; the editor shows package and grip labels instead of ids.
 */
export function describeDiagnostic(
  diagnostic: ProjectEditorDiagnostic,
  pattern: PatternLike,
  groups: readonly ProjectEditorGroup[],
): string {
  const packages = (diagnostic.placementIds ?? []).map((id) =>
    packageLabel(pattern, id),
  );
  const grips = (diagnostic.gripIds ?? []).map((id) => gripLabel(groups, id));
  const grip = grips[0] ?? "?";
  switch (diagnostic.code) {
    case "missing-active-solution":
      return "Das Projekt hat keine aktive Lösung.";
    case "missing-pattern":
      return "Kein Muster gewählt.";
    case "missing-pallet":
      return "Dem Projekt fehlt die Palette.";
    case "placement-out-of-bounds":
      return `Paket ${packages[0] ?? "?"} ragt über die zulässige Ladefläche hinaus.`;
    case "placement-overlap":
      return `Pakete ${packages[0] ?? "?"} und ${packages[1] ?? "?"} überlappen sich oder unterschreiten den Paketabstand.`;
    case "placement-unassigned":
      return `Paket ${packages[0] ?? "?"} gehört zu keinem Griff.`;
    case "empty-group":
      return `Griff ${grip} enthält kein Paket.`;
    case "invalid-group-geometry":
      return `Griff ${grip}: ${geometryReason(diagnostic.message)}`;
    case "group-label-mismatch":
      return `Griff ${grip} mischt verschiedene Etikettseiten; das .rob-Format kann das nicht abbilden.`;
    case "group-order-omission":
      return "Die Reihenfolge muss jeden Griff genau einmal enthalten.";
    case "group-number-duplicate":
      return `Zwei Griffe tragen dieselbe Nummer (${grips.join(", ") || "?"}).`;
    case "invalid-order":
      return `Reihenfolge ungültig: ${diagnostic.message}`;
    case "invalid-project":
      return `Projekt ungültig: ${diagnostic.message}`;
  }
}

function geometryReason(message: string): string {
  const colon = message.indexOf(": ");
  return colon >= 0 ? message.slice(colon + 2) : message;
}
