import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createCandidateGeometryId,
  createCandidateId,
  type CandidateIdentityInput,
} from "~/domain/solver/candidateIdentity";
import legacyGoldenCase from "~/lib/__fixtures__/anonymized-plan.golden.json";
import {
  aggregateParityResults,
  discoverParityCorpus,
  evaluateParityCase,
  loadBuiltInParityCorpus,
  runParityCorpus,
  type ParityCaseObservation,
} from "~/lib/parityCorpus";
import {
  parityCaseSchema,
  parityGoldenCaseSchema,
  type ParityCase,
} from "~/lib/parityGoldenCase";

function repositoryText(path: string): string {
  return readFileSync(resolve(process.cwd(), ...path.split("/")), "utf8");
}

function expectedObservation(parityCase: ParityCase): ParityCaseObservation {
  if (parityCase.schemaVersion === 1) {
    return {
      robText: repositoryText(
        `src/lib/__fixtures__/${parityCase.source.fixture}`,
      ),
    };
  }

  const metrics = Object.fromEntries(
    Object.entries(parityCase.expected.metrics ?? {}).flatMap(
      ([name, expectation]) =>
        expectation.value === undefined ? [] : [[name, expectation.value]],
    ),
  );
  const observation: ParityCaseObservation = {
    ...(parityCase.expected.candidates
      ? { candidates: parityCase.expected.candidates.value }
      : {}),
    ...(Object.keys(metrics).length > 0 ? { metrics } : {}),
  };

  if (parityCase.input.kind === "rob-import") {
    const artifactId = parityCase.input.artifactId;
    const artifact = parityCase.artifacts.find(({ id }) => id === artifactId);
    if (artifact?.availability === "repository" && artifact.path) {
      observation.robText = repositoryText(artifact.path);
    }
  }
  return observation;
}

function v2Case(
  corpus: ReturnType<typeof loadBuiltInParityCorpus>,
  id: string,
) {
  const parityCase = corpus.cases.find((candidate) => candidate.id === id);
  if (!parityCase || parityCase.schemaVersion !== 2) {
    throw new Error(`Missing v2 parity case ${id}.`);
  }
  return parityCase;
}

describe("parity corpus", () => {
  it("discovers all committed public cases without diagnostics", () => {
    const corpus = loadBuiltInParityCorpus();

    expect(corpus.diagnostics).toEqual([]);
    expect(corpus.cases.map(({ id }) => id)).toEqual([
      "anonymized-rob-import-baseline",
      "ap5006-1329-00004-observed",
      "synthetic-alternating-stack",
      "synthetic-identity-variants",
      "synthetic-square-grid",
    ]);
    expect(
      corpus.cases.filter(({ schemaVersion }) => schemaVersion === 1),
    ).toHaveLength(1);
    expect(
      corpus.cases.filter(
        (parityCase) =>
          parityCase.schemaVersion === 1 ||
          parityCase.provenance.kind === "synthetic" ||
          parityCase.provenance.kind === "anonymized",
      ),
    ).toHaveLength(4);
  });

  it("keeps the exact legacy schema and export compatible", () => {
    expect(parityGoldenCaseSchema.parse(legacyGoldenCase)).toEqual(
      legacyGoldenCase,
    );
    expect(parityCaseSchema.parse(legacyGoldenCase)).toEqual(legacyGoldenCase);

    const corpus = discoverParityCorpus([
      { source: "legacy.json", value: legacyGoldenCase },
    ]);
    expect(corpus.diagnostics).toEqual([]);
    expect(corpus.cases[0]).toEqual(legacyGoldenCase);
  });

  it("keeps machine candidate ids aligned with identity contract v1", () => {
    const corpus = loadBuiltInParityCorpus();
    const candidateCases = [
      v2Case(corpus, "synthetic-square-grid"),
      v2Case(corpus, "synthetic-identity-variants"),
    ];

    for (const parityCase of candidateCases) {
      for (const candidate of parityCase.expected.candidates?.value
        .candidates ?? []) {
        const input: CandidateIdentityInput = {
          placements: candidate.placements ?? [],
          ...(candidate.grips ? { grips: candidate.grips } : {}),
        };
        expect(createCandidateId(input)).toBe(candidate.id);
        expect(createCandidateGeometryId(input)).toBe(candidate.geometryId);
      }
    }
  });

  it("runs the corpus with public observations in Vitest", async () => {
    const corpus = loadBuiltInParityCorpus();
    const report = await runParityCorpus(corpus, expectedObservation);

    expect(report.summary.totalCases).toBe(5);
    expect(report.summary.mismatchCount).toBe(0);
    expect(report.summary.casesWithGoldenRegression).toBe(0);
    expect(report.summary.executionErrorCount).toBe(0);
    expect(report.scorecard.geometry.Golden).toBe(4);
    expect(report.scorecard.geometry.Observed).toBe(1);
    expect(report.scorecard.ranking.Golden).toBe(2);
    expect(report.scorecard.export.Open).toBe(3);
  });

  it("aggregates regressions by evidence status", () => {
    const corpus = loadBuiltInParityCorpus();
    const legacy = corpus.cases.find(
      ({ schemaVersion }) => schemaVersion === 1,
    );
    const square = v2Case(corpus, "synthetic-square-grid");
    if (!legacy) throw new Error("Missing legacy case.");

    const legacyResult = evaluateParityCase(
      legacy,
      expectedObservation(legacy),
    );
    const squareObservation = expectedObservation(square);
    const squareResult = evaluateParityCase(square, {
      ...squareObservation,
      metrics: {
        ...squareObservation.metrics,
        maximumPackageCount: 11,
      },
    });
    const report = aggregateParityResults([legacyResult, squareResult]);

    expect(report.summary).toMatchObject({
      totalCases: 2,
      completeCases: 2,
      casesWithGoldenRegression: 1,
      mismatchCount: 1,
      goldenMismatchCount: 1,
      observedMismatchCount: 0,
    });
    expect(report.mismatches).toEqual([
      {
        caseId: "synthetic-square-grid",
        evidenceStatus: "Golden",
        path: "metrics.maximumPackageCount",
        expected: 12,
        actual: 11,
      },
    ]);
  });

  it("reports exact candidate-order mismatch paths", () => {
    const corpus = loadBuiltInParityCorpus();
    const parityCase = v2Case(corpus, "synthetic-square-grid");
    const observation = expectedObservation(parityCase);
    const candidates = observation.candidates;
    if (!candidates?.orderedCandidateIds) {
      throw new Error("Synthetic candidate order is missing.");
    }

    const result = evaluateParityCase(parityCase, {
      ...observation,
      candidates: {
        ...candidates,
        orderedCandidateIds: [...candidates.orderedCandidateIds].reverse(),
      },
    });

    expect(result.mismatches).toEqual([
      {
        path: "candidates.orderedCandidateIds[0]",
        expected: "candidate-v1-15c499ae3be2e8d3",
        actual: "candidate-v1-d3075d18acf87a23",
      },
      {
        path: "candidates.orderedCandidateIds[1]",
        expected: "candidate-v1-d3075d18acf87a23",
        actual: "candidate-v1-15c499ae3be2e8d3",
      },
    ]);
  });

  it("diagnoses duplicate ids without hiding the first valid case", () => {
    const duplicate = {
      ...legacyGoldenCase,
      title: "Duplicate",
    };
    const corpus = discoverParityCorpus([
      { source: "first.json", value: legacyGoldenCase },
      { source: "second.json", value: duplicate },
    ]);

    expect(corpus.cases).toHaveLength(1);
    expect(corpus.diagnostics).toContainEqual({
      source: "second.json",
      code: "duplicate-case-id",
      path: ["id"],
      message:
        'case id "anonymized-rob-import-baseline" is already declared by first.json',
    });
  });
});
