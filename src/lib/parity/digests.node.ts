import { createHash } from "node:crypto";
import type { PalletData } from "~/domain/palletTypes";
import { semanticRobPlanFingerprint } from "~/lib/parityGoldenCase";

export function sha256ByteDigest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function sha256TextDigest(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function semanticRobDigest(data: PalletData): string {
  return sha256TextDigest(semanticRobPlanFingerprint(data));
}
