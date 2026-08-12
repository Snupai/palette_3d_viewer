import { describe, expect, it } from "vitest";
import {
  areCandidatesGeometricallyEqual,
  candidateGeometryFingerprint,
  candidateIdentityFingerprint,
  CANDIDATE_GEOMETRY_EQUALITY_VERSION,
  CANDIDATE_IDENTITY_VERSION,
  createCandidateGeometryId,
  createCandidateId,
  haveSameCandidateIdentity,
  type CandidateIdentityInput,
} from "~/domain/solver/candidateIdentity";

function baseCandidate(): CandidateIdentityInput {
  return {
    placements: [
      {
        id: "placement-local-a",
        sequence: 0,
        positionMm: { x: 150, y: 100 },
        rotation: 0,
        labelSide: null,
        gripId: "grip-local-a",
      },
      {
        id: "placement-local-b",
        sequence: 1,
        positionMm: { x: 450, y: 100 },
        rotation: 0,
        labelSide: null,
        gripId: "grip-local-a",
      },
    ],
    grips: [
      {
        id: "grip-local-a",
        sequence: 0,
        pickX: 300,
        pickY: -100,
        pickRotation: 0,
        x: 300,
        y: 100,
        rotation: 0,
        numPackages: 2,
        dx: 0,
        dy: 0,
      },
    ],
  };
}

describe("candidate identity contracts", () => {
  it("ignores local ids and array order in both canonical contracts", () => {
    const original = baseCandidate();
    const renamedAndReordered: CandidateIdentityInput = {
      placements: [...original.placements]
        .reverse()
        .map((placement, index) => ({
          ...placement,
          id: `other-placement-${index}`,
          gripId: "other-grip-id",
        })),
      grips: original.grips?.map((grip) => ({
        ...grip,
        id: "other-grip-id",
      })),
    };

    expect(haveSameCandidateIdentity(original, renamedAndReordered)).toBe(true);
    expect(areCandidatesGeometricallyEqual(original, renamedAndReordered)).toBe(
      true,
    );
    expect(createCandidateId(original)).toBe(
      createCandidateId(renamedAndReordered),
    );
  });

  it("keeps orientation in geometric equality, including square-package cases", () => {
    const original = baseCandidate();
    const rotated: CandidateIdentityInput = {
      ...original,
      placements: original.placements.map((placement, index) =>
        index === 0 ? { ...placement, rotation: 90 } : placement,
      ),
    };

    expect(areCandidatesGeometricallyEqual(original, rotated)).toBe(false);
    expect(haveSameCandidateIdentity(original, rotated)).toBe(false);
  });

  it("ignores labels and grips only for geometric equality", () => {
    const original = baseCandidate();
    const changedLabel: CandidateIdentityInput = {
      ...original,
      placements: original.placements.map((placement, index) =>
        index === 0 ? { ...placement, labelSide: "top" } : placement,
      ),
    };
    const splitGrips: CandidateIdentityInput = {
      placements: original.placements.map((placement, index) => ({
        ...placement,
        gripId: `single-${index}`,
      })),
      grips: original.placements.map((placement, index) => ({
        id: `single-${index}`,
        sequence: index,
        pickX: 150,
        pickY: -100,
        pickRotation: 0,
        x: placement.positionMm.x,
        y: placement.positionMm.y,
        rotation: placement.rotation,
        numPackages: 1,
        dx: 0,
        dy: 0,
      })),
    };

    expect(areCandidatesGeometricallyEqual(original, changedLabel)).toBe(true);
    expect(areCandidatesGeometricallyEqual(original, splitGrips)).toBe(true);
    expect(haveSameCandidateIdentity(original, changedLabel)).toBe(false);
    expect(haveSameCandidateIdentity(original, splitGrips)).toBe(false);
  });

  it("treats unknown label and grip state differently from explicit none", () => {
    const explicitNone = baseCandidate();
    const unknown: CandidateIdentityInput = {
      placements: explicitNone.placements.map(
        ({ labelSide: _label, gripId: _grip, ...placement }) => placement,
      ),
    };

    expect(areCandidatesGeometricallyEqual(explicitNone, unknown)).toBe(true);
    expect(haveSameCandidateIdentity(explicitNone, unknown)).toBe(false);
  });

  it("embeds independent versions in fingerprints and compact ids", () => {
    const candidate = baseCandidate();

    expect(candidateIdentityFingerprint(candidate)).toMatch(
      new RegExp(`^candidate-v${CANDIDATE_IDENTITY_VERSION}:`),
    );
    expect(candidateGeometryFingerprint(candidate)).toMatch(
      new RegExp(`^geometry-v${CANDIDATE_GEOMETRY_EQUALITY_VERSION}:`),
    );
    expect(createCandidateId(candidate)).toMatch(
      new RegExp(`^candidate-v${CANDIDATE_IDENTITY_VERSION}-[0-9a-f]{16}$`),
    );
    expect(createCandidateGeometryId(candidate)).toMatch(
      new RegExp(
        `^geometry-v${CANDIDATE_GEOMETRY_EQUALITY_VERSION}-[0-9a-f]{16}$`,
      ),
    );
  });
});
