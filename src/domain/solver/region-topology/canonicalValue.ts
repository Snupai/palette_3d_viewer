function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalJsonValue);
  }
  if (typeof value !== "object" || value === null) return value;

  const record = value as Readonly<Record<string, unknown>>;
  return Object.fromEntries(
    Object.keys(record)
      .sort(compareStrings)
      .map((key) => [key, canonicalJsonValue(record[key])]),
  );
}

export function stableRegionTopologyValue(value: unknown): string {
  const serialized = JSON.stringify(canonicalJsonValue(value));
  if (serialized === undefined) {
    throw new TypeError("Region topology value is not JSON-serializable.");
  }
  return serialized;
}
