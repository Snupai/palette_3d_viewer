// @vitest-environment node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { semanticRobDigest, sha256ByteDigest } from "~/lib/parity/digests.node";
import { parseRobText } from "~/lib/robParser";

describe(".rob corpus digests", () => {
  it("computes the standard SHA-256 byte digest", () => {
    expect(sha256ByteDigest(new TextEncoder().encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("distinguishes source bytes while grouping semantic LF/CRLF equivalents", async () => {
    const fixtureDirectory = resolve(
      process.cwd(),
      "src",
      "lib",
      "__fixtures__",
    );
    const [lfBytes, crlfBytes] = await Promise.all([
      readFile(resolve(fixtureDirectory, "anonymized-plan-lf.rob")),
      readFile(resolve(fixtureDirectory, "anonymized-plan-crlf.rob")),
    ]);

    expect(sha256ByteDigest(lfBytes)).not.toBe(sha256ByteDigest(crlfBytes));
    expect(semanticRobDigest(parseRobText(lfBytes.toString("utf8")))).toBe(
      semanticRobDigest(parseRobText(crlfBytes.toString("utf8"))),
    );
  });
});
