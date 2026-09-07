import type {
  NormalizedLayerSolverInput,
  NormalizedSolverConstraints,
} from "~/domain/solver/types";

export type TargetCountPolicy =
  | Readonly<{ kind: "exact"; count: number }>
  | Readonly<{
      kind: "explicit-descending-range";
      minimum: number;
      maximum: number;
    }>
  | Readonly<{ kind: "range"; minimum: number; maximum: number }>;

export type CountInterval = Readonly<{
  minimum: number;
  maximum: number;
}>;

export type TargetCountSearchPlan = Readonly<{
  policy: TargetCountPolicy;
  geometricUpperBound: number;
  searchCountsDescending: readonly number[];
  provenUnreachableRanges: readonly CountInterval[];
}>;

export type TargetCountPolicyNormalization =
  | Readonly<{ valid: true; policy: TargetCountPolicy }>
  | Readonly<{ valid: false; message: string }>;

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function invalidPolicy(message: string): TargetCountPolicyNormalization {
  return Object.freeze({ valid: false, message });
}

function normalizePolicyValue(value: TargetCountPolicy): TargetCountPolicy {
  if (value.kind === "exact") {
    return Object.freeze({ kind: "exact", count: value.count });
  }
  return Object.freeze({
    kind: value.kind,
    minimum: value.minimum,
    maximum: value.maximum,
  });
}

export function normalizeTargetCountPolicy(
  constraints: NormalizedSolverConstraints,
  requested?: TargetCountPolicy,
): TargetCountPolicyNormalization {
  if (typeof constraints !== "object" || constraints === null) {
    return invalidPolicy("Normalized solver constraints must be an object.");
  }

  const minimum = constraints.minimumPackageCount;
  const maximum = constraints.maximumPackageCount;
  const maxPlacements = constraints.maxPlacements;
  if (!isNonNegativeSafeInteger(minimum)) {
    return invalidPolicy(
      "constraints.minimumPackageCount must be a non-negative safe integer.",
    );
  }
  if (!isNonNegativeSafeInteger(maximum)) {
    return invalidPolicy(
      "constraints.maximumPackageCount must be a non-negative safe integer.",
    );
  }
  if (!isPositiveSafeInteger(maxPlacements)) {
    return invalidPolicy(
      "constraints.maxPlacements must be a positive safe integer.",
    );
  }
  if (minimum > maximum) {
    return invalidPolicy(
      "constraints.minimumPackageCount must not exceed constraints.maximumPackageCount.",
    );
  }
  if (maximum > maxPlacements) {
    return invalidPolicy(
      "constraints.maximumPackageCount must not exceed constraints.maxPlacements.",
    );
  }

  if (requested === undefined) {
    const policy: TargetCountPolicy =
      minimum === maximum
        ? { kind: "exact", count: minimum }
        : { kind: "range", minimum, maximum };
    return Object.freeze({ valid: true, policy: normalizePolicyValue(policy) });
  }
  if (typeof requested !== "object" || requested === null) {
    return invalidPolicy("Target count policy must be an object.");
  }

  if (requested.kind === "exact") {
    const count = requested.count;
    if (!isNonNegativeSafeInteger(count)) {
      return invalidPolicy(
        "Exact target count must be a non-negative safe integer.",
      );
    }
    if (count < minimum || count > maximum) {
      return invalidPolicy(
        "Exact target count must stay within the normalized package-count constraints.",
      );
    }
    return Object.freeze({
      valid: true,
      policy: Object.freeze({ kind: "exact", count }),
    });
  }

  if (
    requested.kind !== "range" &&
    requested.kind !== "explicit-descending-range"
  ) {
    return invalidPolicy("Unknown target count policy kind.");
  }

  const range = requested;
  if (
    !isNonNegativeSafeInteger(range.minimum) ||
    !isNonNegativeSafeInteger(range.maximum)
  ) {
    return invalidPolicy(
      "Target count range bounds must be non-negative safe integers.",
    );
  }
  if (range.minimum > range.maximum) {
    return invalidPolicy(
      "Target count range minimum must not exceed its maximum.",
    );
  }
  if (range.minimum < minimum || range.maximum > maximum) {
    return invalidPolicy(
      "Target count range must stay within the normalized package-count constraints.",
    );
  }

  return Object.freeze({
    valid: true,
    policy: Object.freeze({
      kind: range.kind,
      minimum: range.minimum,
      maximum: range.maximum,
    }),
  });
}

function normalizedFloor(value: number): number {
  const nearestInteger = Math.round(value);
  const tolerance = Math.max(1, Math.abs(value)) * Number.EPSILON * 8;
  return Math.floor(
    Math.abs(value - nearestInteger) <= tolerance ? nearestInteger : value,
  );
}

export function safeGeometricPackageUpperBound(
  input: NormalizedLayerSolverInput,
): number {
  if (typeof input !== "object" || input === null) return 0;

  const packageLength = input.package?.dimensionsMm?.length;
  const packageWidth = input.package?.dimensionsMm?.width;
  const clearance = input.package?.clearanceMm;
  const bounds = input.generationBoundsMm;
  const maxPlacements = input.constraints?.maxPlacements;
  const maximumPackageCount = input.constraints?.maximumPackageCount;
  if (
    typeof packageLength !== "number" ||
    !Number.isFinite(packageLength) ||
    packageLength <= 0 ||
    typeof packageWidth !== "number" ||
    !Number.isFinite(packageWidth) ||
    packageWidth <= 0 ||
    typeof clearance !== "number" ||
    !Number.isFinite(clearance) ||
    clearance < 0 ||
    !isPositiveSafeInteger(maxPlacements) ||
    !isNonNegativeSafeInteger(maximumPackageCount) ||
    maximumPackageCount > maxPlacements ||
    typeof bounds !== "object" ||
    bounds === null
  ) {
    return 0;
  }

  const frameLength = bounds.maxX - bounds.minX;
  const frameWidth = bounds.maxY - bounds.minY;
  if (
    !Number.isFinite(frameLength) ||
    frameLength <= 0 ||
    !Number.isFinite(frameWidth) ||
    frameWidth <= 0
  ) {
    return 0;
  }

  const configuredUpperBound = Math.min(maxPlacements, maximumPackageCount);
  if (configuredUpperBound === 0) return 0;

  const areaRatio = (frameLength / packageLength) * (frameWidth / packageWidth);
  if (areaRatio === Number.POSITIVE_INFINITY) return configuredUpperBound;
  if (!Number.isFinite(areaRatio) || areaRatio <= 0) return 0;

  return Math.min(configuredUpperBound, normalizedFloor(areaRatio));
}

function assertPolicy(policy: TargetCountPolicy): TargetCountPolicy {
  if (typeof policy !== "object" || policy === null) {
    throw new TypeError("Target count policy must be an object.");
  }
  if (policy.kind === "exact") {
    if (!isNonNegativeSafeInteger(policy.count)) {
      throw new RangeError(
        "Exact target count must be a non-negative safe integer.",
      );
    }
    return normalizePolicyValue(policy);
  }
  if (policy.kind !== "range" && policy.kind !== "explicit-descending-range") {
    throw new RangeError("Unknown target count policy kind.");
  }
  if (
    !isNonNegativeSafeInteger(policy.minimum) ||
    !isNonNegativeSafeInteger(policy.maximum)
  ) {
    throw new RangeError(
      "Target count range bounds must be non-negative safe integers.",
    );
  }
  if (policy.minimum > policy.maximum) {
    throw new RangeError(
      "Target count range minimum must not exceed its maximum.",
    );
  }
  return normalizePolicyValue(policy);
}

function policyInterval(policy: TargetCountPolicy): CountInterval {
  return policy.kind === "exact"
    ? { minimum: policy.count, maximum: policy.count }
    : { minimum: policy.minimum, maximum: policy.maximum };
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function sortedUniqueReachableCounts(countsInput: unknown): number[] {
  if (!isUnknownArray(countsInput)) {
    throw new TypeError("reachableCounts must be an array.");
  }
  const counts: number[] = [];
  for (const count of countsInput) {
    if (!isNonNegativeSafeInteger(count)) {
      throw new RangeError(
        "Every reachable target count must be a non-negative safe integer.",
      );
    }
    counts.push(count);
  }
  counts.sort((left, right) => left - right);
  return counts.filter(
    (count, index) => index === 0 || count !== counts[index - 1],
  );
}

function complementIntervals(
  interval: CountInterval,
  reachableAscending: readonly number[],
): readonly CountInterval[] {
  const unreachable: CountInterval[] = [];
  let cursor: number | null = interval.minimum;

  for (const count of reachableAscending) {
    if (count < interval.minimum) continue;
    if (count > interval.maximum || cursor === null) break;
    if (count > cursor) {
      unreachable.push(Object.freeze({ minimum: cursor, maximum: count - 1 }));
    }
    if (count === interval.maximum) {
      cursor = null;
      break;
    }
    cursor = count + 1;
  }

  if (cursor !== null && cursor <= interval.maximum) {
    unreachable.push(
      Object.freeze({ minimum: cursor, maximum: interval.maximum }),
    );
  }
  return Object.freeze(unreachable);
}

export function planTargetCounts(
  policyInput: TargetCountPolicy,
  geometricUpperBoundInput: number,
  reachableCountsInput: readonly number[],
): TargetCountSearchPlan {
  const policy = assertPolicy(policyInput);
  if (!isNonNegativeSafeInteger(geometricUpperBoundInput)) {
    throw new RangeError(
      "geometricUpperBound must be a non-negative safe integer.",
    );
  }
  const geometricUpperBound = geometricUpperBoundInput;
  const interval = policyInterval(policy);
  const reachableAscending = sortedUniqueReachableCounts(
    reachableCountsInput,
  ).filter(
    (count) =>
      count >= interval.minimum &&
      count <= interval.maximum &&
      count <= geometricUpperBound,
  );

  return Object.freeze({
    policy,
    geometricUpperBound,
    searchCountsDescending: Object.freeze(
      [...reachableAscending].sort((left, right) => right - left),
    ),
    provenUnreachableRanges: complementIntervals(interval, reachableAscending),
  });
}
