import type { RawPalletSheet } from "~/domain/sheetExtraction/sheetSchema";

export type SheetDimensions3 = {
  length: number;
  width: number;
  height: number;
};
export type SheetDimensions2 = { length: number; width: number };

/** A sheet after normalization; `null` marks values that are missing or unusable. */
export type PalletSheet = {
  sheetType: string | null;
  productName: string | null;
  productNumber: string | null;
  cartonId: string | null;
  cartonMm: SheetDimensions3 | null;
  blockMm: SheetDimensions3 | null;
  palletMm: SheetDimensions2;
  loadSpaceHeightMm: number | null;
  totalHeightMm: number | null;
  cartonsPerLayer: number | null;
  layers: number | null;
  cartonsPerPallet: number | null;
  unitsPerCarton: number | null;
  cartonWeightKg: number | null;
  handwrittenNotes: string | null;
};

export type SheetIssueSeverity = "error" | "warning" | "info";

export type SheetField =
  | "productNumber"
  | "cartonMm"
  | "blockMm"
  | "palletMm"
  | "cartonsPerLayer"
  | "layers"
  | "cartonsPerPallet"
  | "handwrittenNotes";

export type SheetIssue = {
  severity: SheetIssueSeverity;
  field: SheetField;
  message: string;
};

export type ValidatedSheet = {
  sheet: PalletSheet;
  issues: SheetIssue[];
};

const DEFAULT_PALLET_MM: SheetDimensions2 = { length: 1200, width: 800 };
/** Largest carton side we accept; anything bigger is almost always a pallet or block value. */
const MAX_CARTON_SIDE_MM = 800;
/** Loads on the sheets overhang a pallet by far less than this per side. */
const MAX_OVERHANG_PER_SIDE_MM = 100;
/** Real blocks are bounding boxes of tightly packed layers; sheets fill ≥ 88 %. */
const MIN_BLOCK_FILL_ERROR = 0.75;
const MIN_BLOCK_FILL_WARNING = 0.85;
/** Rounding on the sheets plus a little carton tolerance. */
const SIDE_SUM_TOLERANCE_MM = 3;
/** Pallet deck heights seen on the sheets (EURO 144/145, some 150). */
const PALLET_DECK_HEIGHT_RANGE_MM = { min: 100, max: 200 } as const;

function positive(value: number | null): number | null {
  return value !== null && value > 0 ? value : null;
}

function positiveInteger(value: number | null): number | null {
  return value !== null && Number.isInteger(value) && value > 0 ? value : null;
}

function lengthFirst<T extends SheetDimensions2>(value: T): T {
  return value.length >= value.width
    ? value
    : { ...value, length: value.width, width: value.length };
}

/**
 * A block side is the extent of one row of cartons, so it must equal
 * a·length + b·width for whole a, b ≥ 0.
 */
export function isCartonSideSum(
  sideMm: number,
  cartonLengthMm: number,
  cartonWidthMm: number,
  toleranceMm = SIDE_SUM_TOLERANCE_MM,
): boolean {
  for (let a = 0; a * cartonLengthMm <= sideMm + toleranceMm; a += 1) {
    const rest = sideMm - a * cartonLengthMm;
    const b = Math.round(rest / cartonWidthMm);
    if (b >= 0 && Math.abs(rest - b * cartonWidthMm) <= toleranceMm)
      return true;
  }
  return false;
}

/** Internal article numbers: 483-00815, 1329-00003+4, 843-00007-10. */
const PRODUCT_NUMBER_PATTERN = /^\d{3,4}-\d{5}([+-]\d{1,2})?$/;
const CARTON_ID_PATTERN = /UK\s?\d{3,}(-\d+)*/i;

/**
 * The model sometimes glues the UK carton code onto the product number
 * ("1195-00027 UK02459") or pads an incomplete one ("813-......", "1292-UK02020").
 * The UK code moves to `cartonId`; an incomplete number is dropped.
 */
export function splitProductIdentifiers(
  productNumber: string | null,
  cartonId: string | null,
): { productNumber: string | null; cartonId: string | null } {
  let product = productNumber?.trim() ?? "";
  const trimmedCarton = cartonId?.trim() ?? "";
  let carton = trimmedCarton === "" ? null : trimmedCarton;
  const embedded = CARTON_ID_PATTERN.exec(product);
  if (embedded) {
    carton ??= embedded[0].replace(/\s/g, "").toUpperCase();
    product = product.replace(embedded[0], "");
  }
  product = product.replace(/\s+/g, "").replace(/[.\u2026]+$/, "");
  if (!/\d-\d/.test(product)) return { productNumber: null, cartonId: carton };
  return { productNumber: product, cartonId: carton };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Normalizes the model answer and checks it against the arithmetic every
 * palletizing sheet obeys. Errors mean the solver input would be wrong; the
 * user must fix them before generating.
 */
export function validatePalletSheet(raw: RawPalletSheet): ValidatedSheet {
  const issues: SheetIssue[] = [];
  const add = (
    severity: SheetIssueSeverity,
    field: SheetField,
    message: string,
  ) => issues.push({ severity, field, message });

  const cartonLength = positive(raw.cartonMm.length);
  const cartonWidth = positive(raw.cartonMm.width);
  const cartonHeight = positive(raw.cartonMm.height);
  let cartonMm: SheetDimensions3 | null =
    cartonLength !== null && cartonWidth !== null && cartonHeight !== null
      ? lengthFirst({
          length: cartonLength,
          width: cartonWidth,
          height: cartonHeight,
        })
      : null;
  if (cartonMm === null) {
    add("error", "cartonMm", "Carton dimensions are missing.");
  } else if (
    Math.max(cartonMm.length, cartonMm.width, cartonMm.height) >
    MAX_CARTON_SIDE_MM
  ) {
    add(
      "error",
      "cartonMm",
      `Carton ${format3(cartonMm)} mm is larger than a carton can be; this is probably a pallet or block value.`,
    );
    cartonMm = null;
  }

  const palletLength = positive(raw.palletMm.length);
  const palletWidth = positive(raw.palletMm.width);
  let palletMm: SheetDimensions2;
  if (palletLength === null || palletWidth === null) {
    palletMm = { ...DEFAULT_PALLET_MM };
    add(
      "info",
      "palletMm",
      "No pallet size found; assuming EURO 1200 × 800 mm.",
    );
  } else {
    palletMm = lengthFirst({ length: palletLength, width: palletWidth });
  }

  let cartonsPerLayer = positiveInteger(raw.cartonsPerLayer);
  let layers = positiveInteger(raw.layers);
  let cartonsPerPallet = positiveInteger(raw.cartonsPerPallet);
  if (
    cartonsPerLayer === null &&
    layers !== null &&
    cartonsPerPallet !== null
  ) {
    if (cartonsPerPallet % layers === 0) {
      cartonsPerLayer = cartonsPerPallet / layers;
      add(
        "info",
        "cartonsPerLayer",
        "Derived from cartons per pallet ÷ layers.",
      );
    }
  } else if (
    layers === null &&
    cartonsPerLayer !== null &&
    cartonsPerPallet !== null &&
    cartonsPerPallet % cartonsPerLayer === 0
  ) {
    layers = cartonsPerPallet / cartonsPerLayer;
    add(
      "info",
      "layers",
      "Derived from cartons per pallet ÷ cartons per layer.",
    );
  } else if (
    cartonsPerPallet === null &&
    cartonsPerLayer !== null &&
    layers !== null
  ) {
    cartonsPerPallet = cartonsPerLayer * layers;
    add("info", "cartonsPerPallet", "Derived from cartons per layer × layers.");
  }
  if (cartonsPerLayer === null) {
    add("error", "cartonsPerLayer", "Cartons per layer are missing.");
  }
  if (layers === null) add("error", "layers", "Number of layers is missing.");
  if (
    cartonsPerLayer !== null &&
    layers !== null &&
    cartonsPerPallet !== null &&
    cartonsPerLayer * layers !== cartonsPerPallet
  ) {
    add(
      "error",
      "cartonsPerPallet",
      `${cartonsPerLayer} per layer × ${layers} layers = ${cartonsPerLayer * layers}, but the sheet value read was ${cartonsPerPallet}.`,
    );
  }

  const blockLength = positive(raw.blockMm.length);
  const blockWidth = positive(raw.blockMm.width);
  let blockMm: SheetDimensions3 | null = null;
  if (blockLength === null || blockWidth === null) {
    add(
      "warning",
      "blockMm",
      "Block length/width missing; the plan is generated on the whole pallet.",
    );
  } else {
    const footprint = lengthFirst({ length: blockLength, width: blockWidth });
    blockMm = {
      ...footprint,
      height: resolveBlockHeight(
        positive(raw.blockMm.height),
        cartonMm,
        layers,
        add,
      ),
    };
    if (
      blockMm.length > palletMm.length + 2 * MAX_OVERHANG_PER_SIDE_MM ||
      blockMm.width > palletMm.width + 2 * MAX_OVERHANG_PER_SIDE_MM
    ) {
      add(
        "error",
        "blockMm",
        `Block ${blockMm.length} × ${blockMm.width} mm does not fit the ${palletMm.length} × ${palletMm.width} mm pallet.`,
      );
      blockMm = null;
    } else if (cartonMm && cartonsPerLayer !== null) {
      const fill =
        (cartonsPerLayer * cartonMm.length * cartonMm.width) /
        (blockMm.length * blockMm.width);
      if (fill > 1.005) {
        add(
          "error",
          "blockMm",
          `${cartonsPerLayer} cartons of ${cartonMm.length} × ${cartonMm.width} mm cannot fit in a ${blockMm.length} × ${blockMm.width} mm block (${Math.round(fill * 100)} % fill). Check carton size, block size, and count.`,
        );
      } else if (fill < MIN_BLOCK_FILL_ERROR) {
        add(
          "error",
          "blockMm",
          `Only ${Math.round(fill * 100)} % of the block would be filled; the carton may be the single product, or the count may be wrong.`,
        );
      } else if (fill < MIN_BLOCK_FILL_WARNING) {
        add(
          "warning",
          "blockMm",
          `Only ${Math.round(fill * 100)} % of the block would be filled; check carton size, block size, and count.`,
        );
      }
      for (const side of [blockMm.length, blockMm.width]) {
        if (!isCartonSideSum(side, cartonMm.length, cartonMm.width)) {
          add(
            "error",
            "blockMm",
            `Block side ${side} mm cannot be built from ${cartonMm.length} mm and ${cartonMm.width} mm carton sides; block or carton is probably misread.`,
          );
        }
      }
      if (
        Math.min(blockMm.length, blockMm.width) <
        Math.min(cartonMm.length, cartonMm.width)
      ) {
        add("error", "blockMm", "Block is narrower than a single carton.");
      }
    }
  }

  if (
    blockMm &&
    raw.loadSpaceHeightMm !== null &&
    raw.loadSpaceHeightMm > 0 &&
    blockMm.height > raw.loadSpaceHeightMm
  ) {
    add(
      "warning",
      "blockMm",
      `Block height ${blockMm.height} mm exceeds the load space height ${raw.loadSpaceHeightMm} mm.`,
    );
  }

  if (raw.handwrittenNotes) {
    add(
      "warning",
      "handwrittenNotes",
      `Handwritten note on the sheet: “${raw.handwrittenNotes}”. Check whether it overrides printed values.`,
    );
  }

  const identifiers = splitProductIdentifiers(raw.productNumber, raw.cartonId);
  if (identifiers.productNumber === null && raw.productNumber !== null) {
    add(
      "warning",
      "productNumber",
      `Product number “${raw.productNumber}” is incomplete; enter it by hand.`,
    );
  } else if (
    identifiers.productNumber !== null &&
    !PRODUCT_NUMBER_PATTERN.test(identifiers.productNumber)
  ) {
    add(
      "warning",
      "productNumber",
      `Product number “${identifiers.productNumber}” does not look like 123-45678; check it (handwriting is easy to misread).`,
    );
  }

  return {
    sheet: {
      sheetType: raw.sheetType,
      productName: raw.productName,
      productNumber: identifiers.productNumber,
      cartonId: identifiers.cartonId,
      cartonMm,
      blockMm,
      palletMm,
      loadSpaceHeightMm: positive(raw.loadSpaceHeightMm),
      totalHeightMm: positive(raw.totalHeightMm),
      cartonsPerLayer,
      layers,
      cartonsPerPallet,
      unitsPerCarton: positiveInteger(raw.unitsPerCarton),
      cartonWeightKg: positive(raw.cartonWeightKg),
      handwrittenNotes: raw.handwrittenNotes,
    },
    issues,
  };
}

/**
 * Block height must equal layers × carton height (plus a few mm of interlayers).
 * Some sheets only print the total height including the wooden pallet; that is
 * detected and corrected rather than flagged.
 */
function resolveBlockHeight(
  readHeight: number | null,
  cartonMm: SheetDimensions3 | null,
  layers: number | null,
  add: (
    severity: SheetIssueSeverity,
    field: SheetField,
    message: string,
  ) => void,
): number {
  const expected =
    cartonMm && layers !== null ? round1(cartonMm.height * layers) : null;
  if (expected === null) return readHeight ?? 0;
  if (readHeight === null) {
    add(
      "info",
      "blockMm",
      `Block height derived as ${layers} × ${cartonMm!.height} mm.`,
    );
    return expected;
  }
  // Sheets print exact multiples; allow ~3 mm interlayer per layer.
  const tolerance = expected * 0.005 + layers! * 3;
  const difference = readHeight - expected;
  if (Math.abs(difference) <= tolerance) return readHeight;
  if (Math.abs(readHeight - cartonMm!.height) <= 2) {
    // L'Oréal sheets print the height of a single layer in the "Lage" row.
    add(
      "info",
      "blockMm",
      `Height ${readHeight} mm is one layer; block height set to ${expected} mm.`,
    );
    return expected;
  }
  if (
    difference >= PALLET_DECK_HEIGHT_RANGE_MM.min &&
    difference <= PALLET_DECK_HEIGHT_RANGE_MM.max
  ) {
    add(
      "info",
      "blockMm",
      `Height ${readHeight} mm includes the pallet; block height set to ${expected} mm.`,
    );
    return expected;
  }
  add(
    "error",
    "blockMm",
    `Block height ${readHeight} mm does not match ${layers} layers × ${cartonMm!.height} mm = ${expected} mm.`,
  );
  return readHeight;
}

function format3(value: SheetDimensions3): string {
  return `${value.length} × ${value.width} × ${value.height}`;
}

export function countSheetErrors(issues: readonly SheetIssue[]): number {
  return issues.filter(({ severity }) => severity === "error").length;
}
