import { createEffectivePalletEnvelope } from "~/domain/geometry";
import type {
  RobCorpusScenario,
  SourceCharacterization,
} from "~/lib/parity/types";

export type ExtractRobCorpusScenarioOptions = {
  maxCandidatesPerGenerator: number;
};

function solverInput(
  source: SourceCharacterization,
  envelopeMm: NonNullable<RobCorpusScenario["inputSummary"]["envelopeMm"]>,
  options: ExtractRobCorpusScenarioOptions,
) {
  return {
    package: {
      shape: "cuboid",
      dimensionsMm: {
        length: source.encodedInput.packageDimensionsMm.length,
        width: source.encodedInput.packageDimensionsMm.width,
      },
      // Clearance is not encoded in .rob. The named scenarios choose zero.
      clearanceMm: 0,
    },
    envelopeMm,
    constraints: {
      // Gripper rotation restrictions are not encoded in .rob.
      allowedRotations: [0, 90, 180, 270] as const,
      maxCandidatesPerGenerator: options.maxCandidatesPerGenerator,
    },
  };
}

export function extractRobCorpusScenarios(
  source: SourceCharacterization,
  options: ExtractRobCorpusScenarioOptions,
): RobCorpusScenario[] {
  const pallet = source.encodedInput.palletDimensionsMm;
  const nominalEnvelope = pallet
    ? createEffectivePalletEnvelope({
        length: pallet.length,
        width: pallet.width,
      })
    : null;
  const observedEnvelope = source.observedEnvelopeMm;

  return [
    {
      id: "nominal-strict-v1",
      basis: "strict-policy",
      solverInput: nominalEnvelope
        ? solverInput(source, nominalEnvelope, options)
        : null,
      inputSummary: {
        clearanceMm: 0,
        allowedOverhangPolicyMm: {
          lengthPerSide: 0,
          widthPerSide: 0,
        },
        envelopeMm: nominalEnvelope,
        envelopeSource: "encoded-pallet",
        observationOnly: false,
        sourcePackageCountConstraintApplied: false,
        allowedRotationsSource: "unconstrained-because-gripper-not-encoded",
      },
      skipReason: nominalEnvelope
        ? null
        : "The .rob source does not encode pallet dimensions.",
    },
    {
      id: "observed-envelope-v1",
      basis: "source-observation",
      solverInput: observedEnvelope
        ? solverInput(source, observedEnvelope, options)
        : null,
      inputSummary: {
        clearanceMm: 0,
        // The measured source extent is never converted into overhang policy.
        allowedOverhangPolicyMm: null,
        envelopeMm: observedEnvelope,
        envelopeSource: "observed-source-extents",
        observationOnly: true,
        sourcePackageCountConstraintApplied: false,
        allowedRotationsSource: "unconstrained-because-gripper-not-encoded",
      },
      skipReason: observedEnvelope
        ? null
        : "The .rob source contains no package geometry to measure.",
    },
  ];
}
