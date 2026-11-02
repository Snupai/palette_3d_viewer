import { describe, expect, it } from "vitest";
import {
  DEFAULT_EQUIPMENT_PROFILE_ID,
  DEFAULT_EQUIPMENT_PROFILE_VERSION,
  DEFAULT_PROFILE_GRIPPER_ID,
  DEFAULT_PROFILE_PALLET_STATION_ID,
  createDefaultEquipmentProfileResources,
  getDefaultEquipmentProfile,
  isDefaultProfileGripper,
  isDefaultProfileStation,
  resolveDefaultGripperPackageLimits,
  resolveSuctionRemainderPolicy,
  resolveAutomaticSuctionGroupLimit,
} from "~/domain/project/equipmentProfiles";
import { validateSuctionCompatibility } from "~/domain/robotics/compatibility";

describe("built-in default equipment profile", () => {
  it("retains the exact default gripper, station, and provenance", () => {
    const profile = getDefaultEquipmentProfile();

    expect(profile).toMatchObject({
      id: DEFAULT_EQUIPMENT_PROFILE_ID,
      version: DEFAULT_EQUIPMENT_PROFILE_VERSION,
      provenance: {
        status: "default-not-calibrated",
      },
      gripper: {
        id: DEFAULT_PROFILE_GRIPPER_ID,
        name: "schmalzgripper",
        externalId: "1",
        isDefault: true,
        maxPickupLengthMm: 450,
        tcpMm: { x: 0, y: 0, z: 0 },
        envelopeMm: {
          negativeX: 0,
          positiveX: 0,
          negativeY: 0,
          positiveY: 0,
        },
        inletOrientation: "lengthwise",
        allowedPlaceRotations: [0, 90, 180, 270],
        packageLimits: null,
        settings: { type: "suction", multipickSinglePlace: false },
      },
      palletStation: {
        id: DEFAULT_PROFILE_PALLET_STATION_ID,
        name: "Pallet place definition",
        externalId: "1",
        isDefault: true,
        palletOrigin: { x: "right", y: "bottom" },
        obstacleEnvelopeMm: {
          negativeX: 1_500,
          positiveX: 1_500,
          negativeY: 1_500,
          positiveY: 1_500,
        },
        tcpEnvelopeMm: {
          negativeX: 2_000,
          positiveX: 2_000,
          negativeY: 2_000,
          positiveY: 2_000,
        },
        allowedDirections: [
          "x-negative-y-positive",
          "x-negative-y-negative",
          "x-positive-y-positive",
          "x-positive-y-negative",
        ],
        preferredDirection: "x-negative-y-positive",
        robotCenterMm: { x: 0, y: 0 },
        robotRadiusMm: { min: 0, max: 0 },
        inletAlignment: "right",
      },
      stationReach: {
        status: "not-calibrated",
        sentinel: { min: 0, max: 0 },
      },
    });
  });

  it("returns independent project copies and stops matching after an edit", () => {
    const first = createDefaultEquipmentProfileResources();
    const second = createDefaultEquipmentProfileResources();

    first.grippers[0]!.tcpMm.x = 123;
    first.palletStations[0]!.tcpEnvelopeMm.positiveX = 123;

    expect(second.grippers[0]!.tcpMm.x).toBe(0);
    expect(second.palletStations[0]!.tcpEnvelopeMm.positiveX).toBe(2_000);
    expect(isDefaultProfileGripper(second.grippers[0]!)).toBe(true);
    expect(isDefaultProfileStation(second.palletStations[0]!)).toBe(true);
    expect(isDefaultProfileGripper(first.grippers[0]!)).toBe(false);
    expect(isDefaultProfileStation(first.palletStations[0]!)).toBe(false);
  });

  it("preserves orientation-specific package limits without flattening them", () => {
    const { grippers } = createDefaultEquipmentProfileResources();
    const gripper = grippers[0]!;

    expect(resolveDefaultGripperPackageLimits(gripper, "lengthwise")).toEqual({
      lengthMm: { min: 50, max: 500 },
      widthMm: { min: 50, max: 420 },
      heightMm: { min: 50, max: 400 },
    });
    const crosswiseLimits = resolveDefaultGripperPackageLimits(
      gripper,
      "crosswise",
    )!;
    expect(crosswiseLimits).toEqual({
      lengthMm: { min: 50, max: 500 },
      widthMm: { min: 50, max: 300 },
      heightMm: { min: 50, max: 400 },
    });

    const diagnostics = validateSuctionCompatibility(
      {
        shape: "cuboid",
        dimensionsMm: { length: 400, width: 350, height: 200 },
        weightKg: null,
        clearanceMm: 0,
        multiPickAllowed: false,
        inletOrientation: "crosswise",
        palletizingDirection: null,
        labelSidesAtPickup: [],
      },
      gripper,
      [],
      crosswiseLimits,
    );
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ code: "package-width-out-of-range" }),
    );
  });
});

it("scopes the default remainder policy to the verified profile and inlet", () => {
  const gripper = getDefaultEquipmentProfile().gripper;
  expect(resolveSuctionRemainderPolicy(gripper, "lengthwise")).toBe(
    "axis-ends",
  );
  expect(resolveSuctionRemainderPolicy(gripper, "crosswise")).toBe(
    "centered-singleton",
  );
  expect(
    resolveSuctionRemainderPolicy({ ...gripper, id: "custom" }, "lengthwise"),
  ).toBe("centered-singleton");
  expect(
    resolveSuctionRemainderPolicy(
      { ...gripper, maxPickupLengthMm: 500 },
      "lengthwise",
    ),
  ).toBe("centered-singleton");
  expect(resolveSuctionRemainderPolicy(null, "lengthwise")).toBe(
    "centered-singleton",
  );
});

it("derives the default automatic group limit from pickup length rather than a two-carton cap", () => {
  const gripper = getDefaultEquipmentProfile().gripper;
  const pkg = {
    dimensionsMm: { length: 147, width: 104, height: 139 },
    inletOrientation: "lengthwise" as const,
    multiPickAllowed: true,
  };
  expect(
    [135, 147, 148, 150, 151, 201, 250].map((length) =>
      resolveAutomaticSuctionGroupLimit(
        { ...pkg, dimensionsMm: { ...pkg.dimensionsMm, length } },
        gripper,
      ),
    ),
  ).toEqual([3, 3, 3, 3, 2, 2, 1]);
  expect(
    resolveAutomaticSuctionGroupLimit(
      { ...pkg, multiPickAllowed: false },
      gripper,
    ),
  ).toBe(1);
  expect(
    resolveAutomaticSuctionGroupLimit(
      { ...pkg, inletOrientation: "crosswise" },
      gripper,
    ),
  ).toBe(2);
  expect(resolveAutomaticSuctionGroupLimit(pkg, null)).toBe(2);
});
