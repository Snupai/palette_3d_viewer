import type { Corner, Rotation, Side } from "~/domain/palletTypes";

/**
 * Version of the operational candidate identity contract.
 *
 * Increment this whenever canonicalization changes in a way that can change an
 * identity fingerprint or compact candidate id.
 */
export const CANDIDATE_IDENTITY_VERSION = 1 as const;

/**
 * Version of the narrower placement-geometry equality contract.
 *
 * This version is intentionally independent from candidate identity because a
 * future release may refine one without changing the other.
 */
export const CANDIDATE_GEOMETRY_EQUALITY_VERSION = 1 as const;

export type CandidateLabelSide = Side | Corner;

export type CandidateIdentityPlacement = {
  /** Local ids are deliberately excluded from all fingerprints. */
  id?: string;
  /** Known placement/cycle order. Omission means unknown, not zero. */
  sequence?: number;
  positionMm: { x: number; y: number };
  rotation: Rotation;
  /** Omission means unknown; null means explicitly no label side. */
  labelSide?: CandidateLabelSide | null;
  /** Omission means unknown; null means explicitly not assigned to a grip. */
  gripId?: string | null;
};

export type CandidateIdentityGrip = {
  /** Local ids are canonicalized through membership and are not fingerprints. */
  id: string;
  /** Known robot/grip order. Omission means unknown. */
  sequence?: number;
  pickX: number;
  pickY: number;
  pickRotation: Rotation;
  x: number;
  y: number;
  rotation: Rotation;
  numPackages: number;
  dx: number;
  dy: number;
};

export type CandidateIdentityInput = {
  placements: readonly CandidateIdentityPlacement[];
  /** Omission means grip definitions are unknown; [] means known to be empty. */
  grips?: readonly CandidateIdentityGrip[];
};

type Presence<T> =
  | { state: "unknown" }
  | { state: "none" }
  | { state: "known"; value: T };

const rotations = new Set<Rotation>([0, 90, 180, 270]);

function finiteNumber(value: number, field: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`${field} must be finite.`);
  }
  return Object.is(value, -0) ? 0 : value;
}

function rotation(value: Rotation, field: string): Rotation {
  if (!rotations.has(value)) {
    throw new Error(`${field} must be one of 0, 90, 180, or 270.`);
  }
  return value;
}

function optionalSequence(
  value: { sequence?: number },
  field: string,
): Presence<number> {
  if (!Object.hasOwn(value, "sequence")) return { state: "unknown" };
  if (!Number.isInteger(value.sequence) || (value.sequence ?? -1) < 0) {
    throw new Error(`${field} must be a non-negative integer when known.`);
  }
  return { state: "known", value: value.sequence! };
}

function optionalNullable<T extends string>(
  value: object,
  key: string,
): Presence<T> {
  const record = value as Record<string, unknown>;
  if (!Object.hasOwn(record, key)) return { state: "unknown" };
  const property = record[key];
  if (property === null) return { state: "none" };
  if (typeof property !== "string" || property.length === 0) {
    throw new Error(`${key} must be a non-empty string, null, or omitted.`);
  }
  return { state: "known", value: property as T };
}

function geometryValue(placement: CandidateIdentityPlacement) {
  return {
    x: finiteNumber(placement.positionMm.x, "placement.positionMm.x"),
    y: finiteNumber(placement.positionMm.y, "placement.positionMm.y"),
    rotation: rotation(placement.rotation, "placement.rotation"),
  };
}

function stableValue(value: unknown): string {
  return JSON.stringify(value);
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareStable(left: unknown, right: unknown): number {
  return compareStrings(stableValue(left), stableValue(right));
}

function canonicalGeometry(input: CandidateIdentityInput) {
  const placements = input.placements.map(geometryValue).sort(compareStable);

  for (let index = 1; index < placements.length; index += 1) {
    if (stableValue(placements[index - 1]) === stableValue(placements[index])) {
      throw new Error(
        "Candidate geometry contains duplicate placement coordinates and orientation.",
      );
    }
  }

  return placements;
}

function canonicalGrip(
  grip: CandidateIdentityGrip,
  memberGeometry: readonly string[],
) {
  if (!Number.isInteger(grip.numPackages) || grip.numPackages <= 0) {
    throw new Error("grip.numPackages must be a positive integer.");
  }
  return {
    members: [...memberGeometry].sort(compareStrings),
    sequence: optionalSequence(grip, "grip.sequence"),
    pick: {
      x: finiteNumber(grip.pickX, "grip.pickX"),
      y: finiteNumber(grip.pickY, "grip.pickY"),
      rotation: rotation(grip.pickRotation, "grip.pickRotation"),
    },
    place: {
      x: finiteNumber(grip.x, "grip.x"),
      y: finiteNumber(grip.y, "grip.y"),
      rotation: rotation(grip.rotation, "grip.rotation"),
    },
    numPackages: grip.numPackages,
    labelOffset: {
      x: finiteNumber(grip.dx, "grip.dx"),
      y: finiteNumber(grip.dy, "grip.dy"),
    },
  };
}

function canonicalIdentity(input: CandidateIdentityInput) {
  const geometryByPlacement = new Map<CandidateIdentityPlacement, string>();
  const geometryKeys = new Set<string>();
  for (const placement of input.placements) {
    const key = stableValue(geometryValue(placement));
    if (geometryKeys.has(key)) {
      throw new Error(
        "Candidate geometry contains duplicate placement coordinates and orientation.",
      );
    }
    geometryKeys.add(key);
    geometryByPlacement.set(placement, key);
  }

  const membersByGripId = new Map<string, string[]>();
  for (const placement of input.placements) {
    const grip = optionalNullable<string>(placement, "gripId");
    if (grip.state !== "known") continue;
    const members = membersByGripId.get(grip.value) ?? [];
    members.push(geometryByPlacement.get(placement)!);
    membersByGripId.set(grip.value, members);
  }

  const canonicalGripById = new Map<string, ReturnType<typeof canonicalGrip>>();
  if (input.grips !== undefined) {
    for (const grip of input.grips) {
      if (canonicalGripById.has(grip.id)) {
        throw new Error(`Duplicate grip id "${grip.id}".`);
      }
      canonicalGripById.set(
        grip.id,
        canonicalGrip(grip, membersByGripId.get(grip.id) ?? []),
      );
    }
  }

  const placements = input.placements
    .map((placement) => {
      const grip = optionalNullable<string>(placement, "gripId");
      const canonicalGripValue =
        grip.state !== "known"
          ? grip
          : canonicalGripById.has(grip.value)
            ? {
                state: "known" as const,
                value: canonicalGripById.get(grip.value)!,
              }
            : {
                state: "unresolved" as const,
                reference: grip.value,
              };

      return {
        geometry: geometryValue(placement),
        sequence: optionalSequence(placement, "placement.sequence"),
        label: optionalNullable<CandidateLabelSide>(placement, "labelSide"),
        grip: canonicalGripValue,
      };
    })
    .sort(compareStable);

  return {
    placements,
    gripDefinitions:
      input.grips === undefined
        ? ({ state: "unknown" } as const)
        : ({
            state: "known" as const,
            value: [...canonicalGripById.values()].sort(compareStable),
          } as const),
  };
}

/**
 * Canonical exact geometry. Orientation is retained even for square packages;
 * no tolerance, symmetry transform, or pallet-axis mirroring is applied.
 */
export function candidateGeometryFingerprint(
  input: CandidateIdentityInput,
): string {
  return `geometry-v${CANDIDATE_GEOMETRY_EQUALITY_VERSION}:${stableValue(
    canonicalGeometry(input),
  )}`;
}

/**
 * Canonical operational identity. In addition to exact geometry it preserves
 * known placement order, labels, grip partitions, pick/place data, and dx/dy.
 */
export function candidateIdentityFingerprint(
  input: CandidateIdentityInput,
): string {
  return `candidate-v${CANDIDATE_IDENTITY_VERSION}:${stableValue(
    canonicalIdentity(input),
  )}`;
}

function fnv1a64(value: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte);
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0");
}

/** Compact geometry id; compare the full fingerprint if a hash collision occurs. */
export function createCandidateGeometryId(
  input: CandidateIdentityInput,
): string {
  return `geometry-v${CANDIDATE_GEOMETRY_EQUALITY_VERSION}-${fnv1a64(
    candidateGeometryFingerprint(input),
  )}`;
}

/** Compact id for tables and fixtures; the full fingerprint remains canonical. */
export function createCandidateId(input: CandidateIdentityInput): string {
  return `candidate-v${CANDIDATE_IDENTITY_VERSION}-${fnv1a64(
    candidateIdentityFingerprint(input),
  )}`;
}

export function areCandidatesGeometricallyEqual(
  left: CandidateIdentityInput,
  right: CandidateIdentityInput,
): boolean {
  return (
    candidateGeometryFingerprint(left) === candidateGeometryFingerprint(right)
  );
}

export function haveSameCandidateIdentity(
  left: CandidateIdentityInput,
  right: CandidateIdentityInput,
): boolean {
  return (
    candidateIdentityFingerprint(left) === candidateIdentityFingerprint(right)
  );
}
