/**
 * MultiPack für Roboter plan search (`FUN_00bea380` and the `0xbe*` families).
 *
 * Coordinates are integer 0.1 mm. Delphi `div` truncates toward zero.
 * Package length is the side stored at EBP+0x2C before the swap, so a type-1
 * slot is length-along-X after the end-of-search 1↔2 flip.
 */

import type {
  MultiPackPackageDmm,
  FamilySlot,
  SlotType,
} from "~/domain/solver/multipack/families";
import type { MultiPackSolution } from "~/domain/solver/multipack/optimizer";

/** Low 18 bits, the value `FUN_00bea380`'s caller copies out of `0xce3428`. */
export const MULTIPACK_ENABLE_MASK = 0x3ffff;

/** `0xd28450`, initialized to 99. */
export const MULTIPACK_MAX_BLOCKS = 0x63;

const OUTPUT_CAP = 0x7d;
const SLOT_COUNT = 5;

export type PlanSearchInput = {
  paletteDmm: { x: number; y: number };
  package: MultiPackPackageDmm;
  clearanceDmm: number;
  overhangDmm?: { x: number; y: number };
  /**
   * `EinCountPS`. With `stopAtTarget`, this is the Optimize stop-and-trim
   * count. Without it, every family runs and the list is only sorted.
   */
  targetCount?: number;
  stopAtTarget?: boolean;
  /** Class-bit mask at EBP+0x14. Bit 0x10 gates `be8a48`; bit 0x80 gates `be811c`. */
  enableMask?: number;
  maxBlocks?: number;
};

type ScratchSlot = {
  origin: number;
  far: number;
  near: number;
  span: number;
  type: number;
  countA: number;
  countB: number;
  extraA: number;
  extraB: number;
  extraC: number;
  shape: number;
};

type Plan = {
  count: number;
  blocks: number;
  length: number;
  width: number;
  compactness: number;
  area: number;
  density: number;
  tie: number;
  klass: number;
  slots: ScratchSlot[];
};

function idiv(n: number, d: number): number {
  return d === 0 ? 0 : Math.trunc(n / d);
}

function asShort(n: number): number {
  const bits = n & 0xffff;
  return bits >= 0x8000 ? bits - 0x10000 : bits;
}

function emptySlot(): ScratchSlot {
  return {
    origin: 0,
    far: 0,
    near: 0,
    span: 0,
    type: 0,
    countA: 0,
    countB: 0,
    extraA: 0,
    extraB: 0,
    extraC: 0,
    shape: 0,
  };
}

function cloneSlot(slot: ScratchSlot): ScratchSlot {
  return { ...slot };
}

function emptyPlan(): Plan {
  return {
    count: 0,
    blocks: 0,
    length: 0,
    width: 0,
    compactness: 0,
    area: 0,
    density: 0,
    tie: 0,
    klass: 0,
    slots: Array.from({ length: SLOT_COUNT }, emptySlot),
  };
}

function clonePlan(plan: Plan): Plan {
  return { ...plan, slots: plan.slots.map(cloneSlot) };
}

/** `FUN_00be3030`: true when `candidate` should replace `champion`. */
function candidateBeats(champion: Plan, candidate: Plan): boolean {
  if (candidate.count !== champion.count) return candidate.count > champion.count;
  if (
    candidate.compactness === champion.compactness &&
    candidate.blocks !== champion.blocks
  ) {
    return champion.blocks > candidate.blocks;
  }
  if (candidate.compactness !== champion.compactness) {
    return candidate.compactness < champion.compactness;
  }
  if (candidate.area !== champion.area) return champion.area > candidate.area;
  if (candidate.tie !== champion.tie) return candidate.tie > champion.tie;
  if (candidate.blocks !== champion.blocks) return candidate.blocks < champion.blocks;
  return champion.density > candidate.density;
}

function maskAllows(mask: number, klass: number): boolean {
  if (klass > 0x1f) return true;
  return ((mask >>> (klass & 0x7f)) & 1) === 1;
}

function larger(a: number, b: number): number {
  return a > b ? a : b;
}

/** Loop variables shared by `be77d8`/`be7020` and their slot writers. */
type Pinwheel = {
  i: number;
  a1: number;
  j: number;
  b1: number;
  k: number;
  a2: number;
  m: number;
  b2: number;
};

/**
 * `FUN_0051d78c`: the longest run of `long` steps plus `short` fill that fits
 * each usable side, larger side first.
 */
function alignedSpans(
  usableX: number,
  usableY: number,
  short: number,
  long: number,
): { major: number; minor: number } {
  const unit = Math.min(short, long);
  const step = Math.max(short, long);
  const reach = (span: number): number => {
    let best = 0;
    for (let used = 0; used <= span; used += step) {
      const value = idiv(span - used, unit) * unit + used;
      if (value > best) best = value;
    }
    return best;
  };
  return {
    major: reach(Math.max(usableX, usableY)),
    minor: reach(Math.min(usableX, usableY)),
  };
}

/**
 * `FUN_0051d830`: package-count bound from the aligned area minus the larger
 * corner waste. The trailing float loop only re-checks residues that hold by
 * construction, so it runs once; the result is `Trunc`, stored as a word.
 */
function areaUpperBound(major: number, minor: number, long: number, short: number): number {
  const cornerWaste = (side: number): number => {
    const restA = major - idiv(major, side) * side;
    const restB = minor - idiv(minor, side) * side;
    return side >= restA + restB ? restA * restB : (side - restA) * (side - restB);
  };
  const waste = larger(cornerWaste(long), cornerWaste(short));
  return asShort(Math.trunc((major * minor - waste) / (long * short)));
}

/** Locals of `FUN_00be6688` that the `be647c` helpers read. */
type NestedFrame = {
  template: ScratchSlot;
  /** `F-0x14`: packages in the kombi block. */
  count: number;
  /** `F-0x1c` / `F-0x20`: block extent. */
  width: number;
  height: number;
  /** `F-0x10` / `F-0x0c`: aligned spans minus the block. */
  restX: number;
  restY: number;
};

/**
 * Near-square test of `be6688` for the two halves of a kombi block. The
 * second nest uses strict signs.
 */
function nestedPairFits(
  lead: number,
  side: number,
  long: number,
  short: number,
  strict: boolean,
): boolean {
  const close = (a: number, b: number): boolean =>
    (strict ? a > 0 && b > 0 : a >= 0 && b >= 0) &&
    ((a < long && b < long) || a < short || b < short);
  return close(lead, side) || close(-lead, -side);
}

type RemainderTable = { values: number[]; count: number };

function remainderTable(span: number, steps: number, step: number, unit: number): RemainderTable {
  const values: number[] = [];
  let consumed = 0;
  const last = asShort(steps);
  for (let i = 0; i <= last; i += 1) {
    values.push(asShort(idiv(span - consumed, unit)));
    consumed += step;
  }
  let count = last;
  if (count >= 0 && values[count] === 0) count -= 1;
  return { values, count };
}

function tableAt(table: RemainderTable, index: number): number {
  return table.values[index] ?? 0;
}

/**
 * Coverage added by one slot inside `FUN_00be3a4c`. Shape 15 replaces the
 * running total; the other shapes add to it. Returns null when the shape
 * contributes nothing.
 */
function slotCoverage(
  slot: ScratchSlot,
  sideC: number,
  side10: number,
): { value: number; replace: boolean } | null {
  const { countA, countB, extraA, extraB, extraC, shape } = slot;
  if (shape === 0) return null;
  if (extraA > 0) {
    let value =
      countB * side10 + extraC * sideC + extraA * countA * sideC + extraB * side10;
    if (shape === 3) value += extraA * countA * sideC + extraB * side10;
    if (shape === 9) value += countB * side10 + extraC * sideC;
    return { value, replace: false };
  }
  const alongC = countA * sideC;
  const along10 = countB * side10;
  switch (shape) {
    case 1:
    case 2:
    case 4:
    case 8:
      return { value: alongC + along10, replace: false };
    case 3:
    case 12:
      return { value: alongC * 2 + along10, replace: false };
    case 6:
    case 9:
      return { value: alongC + along10 * 2, replace: false };
    case 13:
      return { value: along10 * 2, replace: false };
    case 14:
      return { value: alongC * 2, replace: false };
    case 15:
      return { value: (alongC + along10) * 2, replace: true };
    case 16:
    case 17:
      return { value: alongC, replace: false };
    case 18:
    case 19:
      return { value: along10, replace: false };
    default:
      return null;
  }
}

class PlanSearch {
  readonly usableX: number;
  readonly usableY: number;
  readonly target: number;
  readonly stop: boolean;
  readonly mask: number;
  readonly maxBlocks: number;
  readonly clearance: number;
  readonly swapped: boolean;

  shortSide: number;
  longSide: number;
  xLong = 0;
  xShort = 0;
  yLong = 0;
  yShort = 0;
  tableX: RemainderTable = { values: [], count: -1 };
  tableY: RemainderTable = { values: [], count: -1 };
  /** Copies of `tableX[1]`, `tableX` count, `tableY[1]`, `tableY` count. */
  xEntry1 = 0;
  xTableCount = 0;
  yEntry1 = 0;
  yTableCount = 0;

  /**
   * `*ECX` / `*EBP+0x30` from `FUN_0051d78c`, kept on their own axes. The
   * original sorts them larger first, which only matches X/Y on landscape
   * palettes.
   */
  alignedX = 0;
  alignedY = 0;
  /** `*EBP+0x1C`, written by `FUN_0051d830`. */
  upperBound = 0;
  /** Real48 at frame `-0x170`, read by `FUN_00be647c`. */
  wasteLimit = 0;
  best = 0;
  floor = 0;
  fingerprint = false;
  fingerprintForce = false;
  remapShapes = false;
  alternateBuckets = false;
  tie = 0;

  private scratch: ScratchSlot[] = Array.from({ length: SLOT_COUNT }, emptySlot);
  private packageCount = 0;
  private blockCount = 1;
  private champion: Plan = emptyPlan();

  /** The record array at `EBP+0x24`: classes 0/1, and 2-4 in the second pass. */
  private direct: Plan[] = [];
  private readonly bands: Plan[] = [];
  private readonly triples: Plan[] = [];
  private readonly mids: Plan[] = [];
  private readonly pins: Plan[] = [];
  private readonly rest: Plan[] = [];

  constructor(input: PlanSearchInput, length: number, width: number) {
    const overhang = input.overhangDmm ?? { x: 0, y: 0 };
    this.clearance = input.clearanceDmm;
    this.usableX = input.paletteDmm.x + input.clearanceDmm + overhang.x;
    this.usableY = input.paletteDmm.y + input.clearanceDmm + overhang.y;
    this.target = input.targetCount ?? 1;
    this.stop = input.stopAtTarget ?? false;
    this.mask = input.enableMask ?? MULTIPACK_ENABLE_MASK;
    this.maxBlocks = input.maxBlocks ?? MULTIPACK_MAX_BLOCKS;
    const sideA = width + input.clearanceDmm;
    const sideB = length + input.clearanceDmm;
    this.swapped = sideB < sideA;
    this.shortSide = this.swapped ? sideB : sideA;
    this.longSide = this.swapped ? sideA : sideB;
  }

  run(): Plan[] {
    if (this.longSide <= 0 || this.shortSide <= 0) return [];
    const aligned = alignedSpans(this.usableX, this.usableY, this.shortSide, this.longSide);
    const landscape = this.usableX >= this.usableY;
    this.alignedX = landscape ? aligned.major : aligned.minor;
    this.alignedY = landscape ? aligned.minor : aligned.major;
    this.upperBound = areaUpperBound(aligned.major, aligned.minor, this.longSide, this.shortSide);
    this.xLong = idiv(this.usableX, this.longSide);
    this.xShort = idiv(this.usableX, this.shortSide);
    this.yLong = idiv(this.usableY, this.longSide);
    this.yShort = idiv(this.usableY, this.shortSide);
    this.buildRemainderTables();

    if (this.longSide === this.shortSide) {
      this.squareGrid();
    } else {
      this.uniformGrids();
      if (this.stopped()) return this.finish();
      if (!this.mixedFitsOneAxis() || this.longSide > this.usableY) return this.finish();
      this.floor = this.best - 0x0d;
      if (!(this.target <= 2 && this.stop)) this.twoBands();
      if (this.stopped()) return this.finish();
      this.floor = this.best - 3;
      if (!this.mixedFitsBothAxes()) return this.finish();
      if ((this.mask & 0x10) !== 0) {
        this.fingerprint = this.matchesFingerprint();
        this.steppedBands();
        if (this.fingerprint) {
          this.fingerprintForce = true;
          this.pinnedTwelve();
          this.fingerprintForce = false;
        }
        this.fingerprint = false;
        this.floor = this.best - 3;
      }
      this.threeRegions();
      if ((this.mask & 0x80) !== 0) {
        this.fourRegions();
        this.floor = this.best - 3;
      }
      this.floor = this.best - 3;
      if (this.hitTarget()) return this.finish();
      this.interlockQuads();
      if (this.hitTarget()) return this.finish();
      this.floor = this.best - 3;
      this.interlockStrips();
      if (this.hitTarget()) return this.finish();
      this.remapShapes = false;
      this.floor = this.best - 2;
      this.resetWasteLimit();
      if (this.shortSide * 2 + this.longSide <= this.usableX) this.nestedBlocks();
    }
    return this.finish();
  }

  private stopped(): boolean {
    return this.stop && this.best >= this.target;
  }

  private hitTarget(): boolean {
    return this.stop && this.best === this.target;
  }

  private mixedFitsOneAxis(): boolean {
    const sum = this.longSide + this.shortSide;
    if (sum <= this.usableX) return true;
    return sum <= this.usableY;
  }

  private mixedFitsBothAxes(): boolean {
    const sum = this.longSide + this.shortSide;
    return sum <= this.usableX && sum <= this.usableY;
  }

  private buildRemainderTables(): void {
    this.tableX = remainderTable(this.usableX, this.xLong, this.longSide, this.shortSide);
    this.tableY = remainderTable(this.usableY, this.yLong, this.longSide, this.shortSide);
    this.xEntry1 = tableAt(this.tableX, 1);
    this.xTableCount = this.tableX.count;
    this.yEntry1 = tableAt(this.tableY, 1);
    this.yTableCount = this.tableY.count;
  }

  private matchesFingerprint(): boolean {
    return (
      this.xLong === 3 &&
      tableAt(this.tableX, 0) === 6 &&
      tableAt(this.tableX, 1) === 4 &&
      tableAt(this.tableX, 2) === 2 &&
      tableAt(this.tableX, 3) === 0 &&
      this.yLong === 2 &&
      tableAt(this.tableY, 0) === 4 &&
      tableAt(this.tableY, 1) === 2 &&
      tableAt(this.tableY, 2) === 0
    );
  }

  private begin(count: number, blocks: number): void {
    this.packageCount = asShort(count) & 0xffff;
    this.blockCount = blocks;
    this.scratch = Array.from({ length: SLOT_COUNT }, emptySlot);
  }

  private fill(
    index: number,
    countA: number,
    countB: number,
    span: number,
    near: number,
    far: number,
    origin: number,
    type: number,
    shape: number,
  ): void {
    this.scratch[index] = {
      origin,
      far,
      near,
      span,
      type,
      countA: countA & 0xff,
      countB: countB & 0xff,
      extraA: 0,
      extraB: 0,
      extraC: 0,
      shape: shape & 0xff,
    };
  }

  private worth(count: number): boolean {
    return this.best < count || this.floor < count;
  }

  /**
   * `FUN_00be3a4c`. Every path ends at `0x00be3f6b`, which clears the tie
   * byte and the type bytes of the scored slots whether or not the record
   * was stored.
   */
  private accept(slotCount: number, klass: number): void {
    this.scoreAndStore(slotCount, klass);
    this.tie = 0;
    for (let i = 0; i < slotCount; i += 1) {
      const slot = this.scratch[i];
      if (slot) slot.type = 0;
    }
    const first = this.scratch[0];
    if (first) first.extraA = 0;
  }

  private scoreAndStore(slotCount: number, klass: number): void {
    let code = klass & 0xff;
    if (this.remapShapes) {
      const shifted = (code + 0xf6) & 0xff;
      if (shifted < 4) {
        if (code === 10) code = 0x0e;
        else if (code === 11) code = 0x0f;
        else if (code === 12) code = 0x10;
        else if (code === 13) code = 0x11;
      }
    }
    if (this.tie !== 0) {
      if (code === 5) code = 6;
      else if (code === 8) code = 9;
    }
    const count = this.packageCount;
    if (count <= this.champion.count && !maskAllows(this.mask, code)) return;
    if (this.blockCount > 5 && count < this.best) return;

    let length = 0;
    let width = 0;
    let density = 0;
    let coverage = 0;
    for (let i = 0; i < slotCount; i += 1) {
      const slot = this.scratch[i] ?? emptySlot();
      if (slot.far > length) length = slot.far;
      if (slot.span > width) width = slot.span;
      const boxes = slot.countA * slot.countB;
      density += boxes * boxes;
      if (slot.shape === 0) continue;
      const type1 = slot.type === 1;
      const sideC = type1 ? this.longSide : this.shortSide;
      const side10 = type1 ? this.shortSide : this.longSide;
      const piece = slotCoverage(slot, sideC, side10);
      if (!piece) continue;
      coverage = piece.replace ? piece.value : coverage + piece.value;
    }
    let compactness = (length * 2 + width * 2 - coverage) | 0;
    if (
      this.fingerprint &&
      this.crossedPenalty(slotCount)
    ) {
      compactness = -10015;
    }
    if (this.fingerprint && this.fingerprintForce) compactness = -10015;

    const plan: Plan = {
      count,
      blocks: this.blockCount,
      length,
      width,
      compactness,
      area: length * width,
      density,
      tie: this.tie & 0xff,
      klass: code,
      slots: this.scratch.map(cloneSlot),
    };
    if (candidateBeats(this.champion, plan)) this.champion = clonePlan(plan);
    if (!maskAllows(this.mask, code)) return;
    if (this.blockCount > this.maxBlocks) return;
    this.store(plan);
    if (count > this.best) {
      this.best = count;
      this.resetWasteLimit();
    }
  }

  /** Frame `-0x170`: aligned area minus `(best - 1)` packages, plus 100. */
  private resetWasteLimit(): void {
    this.wasteLimit =
      this.alignedX * this.alignedY -
      (this.best - 1) * this.longSide * this.shortSide +
      100;
  }

  /** Slot 0 and slot 2 counts that force compactness `0xFFFFD8F1`. */
  private crossedPenalty(slotCount: number): boolean {
    if (slotCount < 3) return false;
    const slot0 = this.scratch[0];
    const slot2 = this.scratch[2];
    if (!slot0 || !slot2) return false;
    const pair =
      slot0.countA === 1 &&
      slot0.countB === 2 &&
      slot2.countA === 1 &&
      slot2.countB === 2;
    const triple =
      slot0.countA === 3 &&
      slot0.countB === 1 &&
      slot2.countA === 3 &&
      slot2.countB === 1;
    return pair || triple;
  }

  private store(plan: Plan): void {
    const klass = plan.klass;
    if (klass <= 1) {
      this.storeDirect(plan);
      return;
    }
    if (klass >= 2 && klass <= 4 && this.alternateBuckets) {
      this.storeDirect(plan);
      return;
    }
    if (klass === 2) {
      this.storeBucket(this.bands, plan, 0x16);
      return;
    }
    if (klass === 3 || klass === 4) {
      this.storeBucket(this.triples, plan, 0x0f);
      return;
    }
    if (klass >= 5 && klass <= 9) {
      this.storeBucket(this.mids, plan, 0x23);
      return;
    }
    if (klass === 10) {
      this.storeBucket(this.pins, plan, 0x19);
      return;
    }
    this.storeBucket(this.rest, plan, 0x19);
  }

  private storeDirect(plan: Plan): void {
    if (this.direct.length < OUTPUT_CAP) {
      this.direct.push(clonePlan(plan));
      return;
    }
    const last = this.direct[this.direct.length - 1];
    if (last && plan.count > this.best) this.direct[this.direct.length - 1] = clonePlan(plan);
  }

  private storeBucket(bucket: Plan[], plan: Plan, cap: number): void {
    if (bucket.length < cap) {
      bucket.push(clonePlan(plan));
      return;
    }
    let replace = -1;
    for (let i = 0; i < bucket.length; i += 1) {
      const existing = bucket[i];
      if (existing && candidateBeats(existing, plan)) replace = i;
    }
    if (replace >= 0) {
      bucket[replace] = clonePlan(plan);
      this.floor = plan.count - 0x0c;
    }
  }

  private uniformGrids(): void {
    const across = this.xLong * this.yShort;
    if (across > 0) {
      this.begin(across, 1);
      this.fill(
        0,
        this.xLong,
        this.yShort,
        this.yShort * this.shortSide,
        0,
        this.xLong * this.longSide,
        0,
        1,
        0x0f,
      );
      this.accept(1, 1);
    }
    const along = this.xShort * this.yLong;
    if (along > 0) {
      this.begin(along, 1);
      this.fill(
        0,
        this.xShort,
        this.yLong,
        this.yLong * this.longSide,
        0,
        this.xShort * this.shortSide,
        0,
        2,
        0x0f,
      );
      this.accept(1, 1);
    }
  }

  private squareGrid(): void {
    const countX = idiv(this.usableX, this.longSide);
    const countY = idiv(this.usableY, this.longSide);
    const count = asShort(countX) * asShort(countY);
    if (count <= 0) return;
    this.begin(count, 1);
    this.fill(0, countX, countY, countY * this.longSide, 0, countX * this.longSide, 0, 1, 0x0f);
    this.accept(1, 0);
  }

  /** `FUN_00be9428`. */
  private twoBands(): void {
    const spanX = larger(this.xShort * this.shortSide, this.xLong * this.longSide);
    for (let row = 1; row <= this.tableY.count; row += 1) {
      const across = tableAt(this.tableY, row);
      const count = across * this.xLong + this.xShort * row;
      if (!this.worth(count)) continue;
      const band = this.longSide * row;
      this.begin(count, 2);
      this.fill(0, this.xShort, row, band, 0, spanX, 0, 2, 9);
      this.fill(1, this.xLong, across, across * this.shortSide + band, band, spanX, 0, 1, 6);
      this.accept(2, 2);
    }
    const spanY = larger(this.yLong * this.longSide, this.yShort * this.shortSide);
    for (let column = 1; column <= this.tableX.count; column += 1) {
      const across = tableAt(this.tableX, column);
      const count = across * this.yLong + this.yShort * column;
      if (!this.worth(count)) continue;
      const band = this.longSide * column;
      this.begin(count, 2);
      this.fill(0, column, this.yShort, spanY, 0, band, 0, 1, 3);
      this.fill(
        1,
        across,
        this.yLong,
        spanY,
        0,
        across * this.shortSide + band,
        band,
        2,
        0x0c,
      );
      this.accept(2, 2);
    }
  }

  /** `FUN_00be8a48`. */
  private steppedBands(): void {
    const spanX = larger(this.xShort * this.shortSide, this.xLong * this.longSide);
    for (let row = 1; row <= this.tableY.count; row += 1) {
      const across = tableAt(this.tableY, row);
      const count = across * this.xLong + this.xShort * row;
      if (!this.worth(count)) continue;
      if (row > 1) {
        const half = row >> 1;
        const farY = this.longSide * row + this.shortSide * across;
        for (let cut = 1; cut <= half; cut += 1) {
          const near = this.longSide * cut;
          this.begin(count, 3);
          this.fill(0, this.xShort, cut, near, 0, spanX, 0, 2, 9);
          this.fill(1, this.xLong, across, near + this.shortSide * across, near, spanX, 0, 1, 0x0d);
          this.fill(2, this.xShort, row - cut, farY, near + this.shortSide * across, spanX, 0, 2, 6);
          this.accept(3, 4);
        }
      }
      if (across > 1) {
        const half = across >> 1;
        const farY = across * this.shortSide + this.longSide * row;
        for (let cut = 1; cut <= half; cut += 1) {
          const near = this.shortSide * cut;
          this.begin(count, 3);
          this.fill(0, this.xLong, cut, near, 0, spanX, 0, 1, 9);
          this.fill(1, this.xShort, row, near + this.longSide * row, near, spanX, 0, 2, 0x0d);
          this.fill(2, this.xLong, across - cut, farY, near + this.longSide * row, spanX, 0, 1, 6);
          this.accept(3, 4);
        }
      }
    }
    const spanY = larger(this.yShort * this.shortSide, this.yLong * this.longSide);
    for (let column = 1; column <= this.tableX.count; column += 1) {
      const across = tableAt(this.tableX, column);
      const count = across * this.yLong + this.yShort * column;
      if (!this.worth(count)) continue;
      if (column > 1) {
        const half = column >> 1;
        const farX = this.longSide * column + this.shortSide * across;
        for (let cut = 1; cut <= half; cut += 1) {
          const near = this.longSide * cut;
          this.begin(count, 3);
          this.fill(0, cut, this.yShort, spanY, 0, near, 0, 1, 3);
          this.fill(1, across, this.yLong, spanY, 0, near + this.shortSide * across, near, 2, 0x0e);
          this.fill(2, column - cut, this.yShort, spanY, 0, farX, near + this.shortSide * across, 1, 0x0c);
          this.accept(3, 4);
        }
      }
      if (across > 1) {
        const half = across >> 1;
        const farX = across * this.shortSide + this.longSide * column;
        for (let cut = 1; cut <= half; cut += 1) {
          const near = this.shortSide * cut;
          this.begin(count, 3);
          this.fill(0, cut, this.yLong, spanY, 0, near, 0, 2, 3);
          this.fill(1, column, this.yShort, spanY, 0, near + this.longSide * column, near, 1, 0x0e);
          this.fill(2, across - cut, this.yLong, spanY, 0, farX, near + this.longSide * column, 2, 0x0c);
          this.accept(3, 4);
        }
      }
    }
  }

  /** `FUN_00be90f0`, only after the 3×6 / 2×4 remainder fingerprint. */
  private pinnedTwelve(): void {
    const short = this.shortSide;
    const long = this.longSide;
    let span = larger(long * 2 + short * 2, long * 3);
    let reach = larger(long + short * 2, short * 4);
    this.begin(0x0c, 5);
    this.fill(0, 3, 1, short, 0, span, 0, 1, 1);
    const halfReach = reach >> 1;
    if (long < short * 2) {
      const halfLong = long >> 1;
      this.fill(1, 1, 1, long - halfLong + halfReach, halfReach - halfLong, short, 0, 2, 1);
    } else {
      this.fill(1, 1, 1, reach - short, short, short, 0, 2, 1);
    }
    this.fill(2, 2, 2, reach - short, short, span - short, short, 1, 1);
    if (long < short * 2) {
      const halfLong = long >> 1;
      this.fill(
        3,
        1,
        1,
        halfReach + (long - halfLong),
        halfReach - halfLong,
        span,
        span - short,
        2,
        1,
      );
    } else {
      this.fill(3, 1, 1, reach - short, short, span, span - short, 2, 1);
    }
    this.fill(4, 3, 1, reach, reach - short, span, 0, 1, 1);
    this.accept(5, 8);

    span = larger(long * 2 + short * 2, short * 6);
    reach = larger(long * 2, long + short * 2);
    this.begin(0x0c, 5);
    this.fill(0, 1, 2, reach, 0, short, 0, 2, 1);
    this.fill(1, 2, 1, short, 0, span - short, short, 1, 1);
    const half = reach >> 1;
    if (short * 2 < long) {
      const halfLong = long >> 1;
      this.fill(2, 4, 1, half + (long - halfLong), half - halfLong, span - short, short, 2, 1);
    } else {
      this.fill(2, 4, 1, reach - short, short, span - short, short, 2, 1);
    }
    this.fill(3, 2, 1, reach, reach - short, span - short, short, 1, 1);
    this.fill(4, 1, 2, reach, 0, span, span - short, 2, 1);
    this.accept(5, 8);
  }

  /** `FUN_00be7c50`. */
  private threeRegions(): void {
    for (let column = 1; column <= this.xTableCount; column += 1) {
      const across = tableAt(this.tableX, column);
      for (let row = 1; row <= this.yEntry1; row += 1) {
        const deep = idiv(this.usableY - this.shortSide * row, this.longSide);
        if (deep >= this.yLong) continue;
        const count = column * row + this.xShort * deep + across * (this.yLong - deep);
        if (row !== tableAt(this.tableY, deep) || !this.worth(count)) continue;
        const band = this.longSide * column;
        const spanA = larger(
          this.shortSide * row + this.longSide * deep,
          this.yLong * this.longSide,
        );
        const spanB = larger(across * this.shortSide + band, this.xShort * this.shortSide);
        const spanC = larger(this.shortSide * row, (this.yLong - deep) * this.longSide);
        this.begin(count, 3);
        this.fill(0, column, row, spanC, 0, band, 0, 1, 1);
        this.fill(1, this.xShort, deep, spanA, spanC, spanB, 0, 2, 6);
        this.fill(2, across, this.yLong - deep, spanC, 0, spanB, band, 2, 8);
        this.accept(3, 3);
      }
    }
    let column = this.tableX.count === this.xLong ? tableAt(this.tableX, this.tableX.count) + 1 : 1;
    for (; column <= this.xEntry1; column += 1) {
      for (let row = 1; row <= this.yTableCount; row += 1) {
        const across = tableAt(this.tableY, row);
        const deep = idiv(this.usableX - this.shortSide * column, this.longSide);
        const count = column * row + this.yShort * deep + across * (this.xLong - deep);
        if (tableAt(this.tableX, deep) !== column || !this.worth(count)) continue;
        const spanA = larger(
          this.shortSide * column + this.longSide * deep,
          this.xLong * this.longSide,
        );
        const spanB = larger(across * this.shortSide + this.longSide * row, this.yShort * this.shortSide);
        const spanC = larger(this.shortSide * column, (this.xLong - deep) * this.longSide);
        this.begin(count, 3);
        this.fill(0, column, row, this.longSide * row, 0, spanC, 0, 2, 1);
        this.fill(1, this.xLong - deep, across, spanB, this.longSide * row, spanC, 0, 1, 2);
        this.fill(2, deep, this.yShort, spanB, 0, spanA, spanC, 1, 0x0c);
        this.accept(3, 3);
      }
    }
  }

  /**
   * `FUN_00be811c`. Four-slot layouts gated by enable-mask bit 0x80.
   * Each quadrant is the transpose of the one above it.
   */
  private fourRegions(): void {
    if (this.tableX.count > 1 && this.yLong > 1) {
      for (let band = 1; band <= this.yLong - 1; band += 1) {
        const across = tableAt(this.tableY, band);
        const tail = this.yLong - band;
        for (let lead = 1; lead <= this.tableX.count - 1; lead += 1) {
          const room = Math.min(lead, this.tableX.count - lead);
          for (let step = 1; step <= room; step += 1) {
            const rest = tableAt(this.tableX, step + lead);
            const count = this.xShort * band + (step + lead) * across + rest * tail;
            if (!this.worth(count)) continue;
            const pitch = this.longSide * band;
            const spanA = larger(
              this.xShort * this.shortSide,
              (step + lead) * this.longSide + this.shortSide * rest,
            );
            const spanB = larger(this.shortSide * across + pitch, this.longSide * tail + pitch);
            this.begin(count, 4);
            this.fill(0, this.xShort, band, pitch, 0, spanA, 0, 2, 9);
            this.fill(1, lead, across, spanB, pitch, this.longSide * lead, 0, 1, 2);
            this.fill(3, step, across, spanB, pitch, spanA, spanA - this.longSide * step, 1, 4);
            this.fill(
              2,
              rest,
              tail,
              spanB,
              pitch,
              spanA - this.longSide * step,
              this.longSide * lead,
              2,
              0x10,
            );
            this.accept(4, 7);
          }
        }
      }
    }
    if (tableAt(this.tableX, 1) > 1 && this.tableY.count > 0) {
      for (let band = 1; band <= this.tableY.count; band += 1) {
        const across = tableAt(this.tableY, band);
        const tail = this.yShort - across;
        let columns = this.tableX.count;
        if (tableAt(this.tableX, this.tableX.count) < 2) columns = this.tableX.count - 1;
        for (let lead = 1; lead <= columns; lead += 1) {
          const span = tableAt(this.tableX, lead);
          const half = span >> 1;
          for (let step = 1; step <= half; step += 1) {
            const rest = span - step;
            const count = this.xLong * across + (rest + step) * band + lead * tail;
            if (!this.worth(count)) continue;
            const pitch = this.shortSide * across;
            const spanA = larger(
              this.xLong * this.longSide,
              (rest + step) * this.shortSide + this.longSide * lead,
            );
            const spanB = larger(this.longSide * band + pitch, this.shortSide * tail + pitch);
            this.begin(count, 4);
            this.fill(0, this.xLong, across, pitch, 0, spanA, 0, 1, 9);
            this.fill(1, step, band, spanB, pitch, this.shortSide * step, 0, 2, 2);
            this.fill(3, rest, band, spanB, pitch, spanA, spanA - this.shortSide * rest, 2, 4);
            this.fill(
              2,
              lead,
              tail,
              spanB,
              pitch,
              spanA - this.shortSide * rest,
              this.shortSide * step,
              1,
              0x10,
            );
            this.accept(4, 7);
          }
        }
      }
    }
    if (this.tableY.count > 1 && this.xLong > 1) {
      for (let band = 1; band <= this.xLong - 1; band += 1) {
        const across = tableAt(this.tableX, band);
        const tail = this.xLong - band;
        for (let lead = 1; lead <= this.tableY.count - 1; lead += 1) {
          const room = Math.min(lead, this.tableY.count - lead);
          for (let step = 1; step <= room; step += 1) {
            const rest = tableAt(this.tableY, step + lead);
            const count = this.yShort * band + (step + lead) * across + tail * rest;
            if (!this.worth(count)) continue;
            const pitch = this.longSide * band;
            const spanA = larger(
              this.yShort * this.shortSide,
              (step + lead) * this.longSide + this.shortSide * rest,
            );
            const spanB = larger(this.shortSide * across + pitch, this.longSide * tail + pitch);
            this.begin(count, 4);
            this.fill(0, band, this.yShort, spanA, 0, pitch, 0, 1, 3);
            this.fill(1, across, lead, this.longSide * lead, 0, spanB, pitch, 2, 8);
            this.fill(3, across, step, spanA, spanA - this.longSide * step, spanB, pitch, 2, 4);
            this.fill(2, tail, rest, spanA - this.longSide * step, this.longSide * lead, spanB, pitch, 1, 0x13);
            this.accept(4, 7);
          }
        }
      }
    }
    if (tableAt(this.tableY, 1) > 1 && this.tableX.count > 0) {
      for (let band = 1; band <= this.tableX.count; band += 1) {
        const across = tableAt(this.tableX, band);
        const tail = this.xShort - across;
        let rows = this.tableY.count;
        if (tableAt(this.tableY, this.tableY.count) < 2) rows = this.tableY.count - 1;
        for (let lead = 1; lead <= rows; lead += 1) {
          const span = tableAt(this.tableY, lead);
          const half = span >> 1;
          for (let step = 1; step <= half; step += 1) {
            const rest = span - step;
            const count = this.yLong * across + (rest + step) * band + tail * lead;
            if (!this.worth(count)) continue;
            const pitch = this.shortSide * across;
            const spanA = larger(
              this.yLong * this.longSide,
              (rest + step) * this.shortSide + this.longSide * lead,
            );
            const spanB = larger(this.longSide * band + pitch, this.shortSide * tail + pitch);
            this.begin(count, 4);
            this.fill(0, across, this.yLong, spanA, 0, pitch, 0, 2, 3);
            this.fill(1, band, step, this.shortSide * step, 0, spanB, pitch, 1, 8);
            this.fill(3, band, rest, spanA, spanA - this.shortSide * rest, spanB, pitch, 1, 4);
            this.fill(
              2,
              tail,
              lead,
              spanA - this.shortSide * rest,
              this.shortSide * step,
              spanB,
              pitch,
              2,
              0x13,
            );
            this.accept(4, 7);
          }
        }
      }
    }
  }

  /**
   * `FUN_00be77d8`: four arms around a center (pinwheel), each arm a long
   * band plus the short remainder. A fifth center block is tried only while
   * the four-arm count is below the area bound; otherwise the four arms are
   * offered alone (class 5).
   */
  private interlockQuads(): void {
    const long = this.longSide;
    const short = this.shortSide;
    for (let i = 1; i <= this.tableX.count; i += 1) {
      const a1 = tableAt(this.tableX, i);
      for (let j = 1; j <= this.tableY.count; j += 1) {
        const b1 = tableAt(this.tableY, j);
        for (let k = i; k <= this.tableX.count; k += 1) {
          const a2 = tableAt(this.tableX, k);
          if (a2 + a1 > this.xShort) continue;
          for (let m = 1; m <= this.tableY.count; m += 1) {
            const b2 = tableAt(this.tableY, m);
            if (b2 > this.yShort - b1) continue;
            const pinwheel: Pinwheel = { i, a1, j, b1, k, a2, m, b2 };
            const base = a1 * m + i * b1 + a2 * j + k * b2;
            let placed = false;
            if (base < this.upperBound) {
              const roomX = this.usableX - short * (a1 + a2);
              const roomY = this.usableY - short * (b1 + b2);
              for (const type of [1, 2] as const) {
                const across = idiv(roomX, type === 1 ? long : short);
                const deep = idiv(roomY, type === 1 ? short : long);
                const total = base + across * deep;
                if (across * deep <= 0 || !this.worth(total)) continue;
                this.quadSlots(total, 5, pinwheel);
                placed = true;
                const x0 = short * a2;
                const x1 = x0 + (type === 1 ? long : short) * across;
                const y0 = short * b1;
                const y1 = y0 + (type === 1 ? short : long) * deep;
                this.fill(4, across, deep, y1, y0, x1, x0, type, 5);
                this.liftQuadEdges(x1, y1, a1, b2);
                this.accept(5, 8);
              }
            }
            if (this.worth(base) && !placed) {
              this.quadSlots(base, 4, pinwheel);
              this.accept(4, 5);
            }
          }
        }
      }
    }
  }

  /** `FUN_00be74c8`: the four pinwheel arms of `be77d8`. */
  private quadSlots(count: number, blocks: number, p: Pinwheel): void {
    const long = this.longSide;
    const short = this.shortSide;
    const leftTop = p.a2 * short;
    const bottom = p.b1 * short;
    const right = larger(
      larger(p.i * long + p.a1 * short, p.k * long + leftTop),
      (p.a1 + p.a2) * short,
    );
    const top = larger(
      larger(p.j * long + bottom, p.m * long + p.b2 * short),
      (p.b1 + p.b2) * short,
    );
    const midX = larger(p.i * long, leftTop);
    const midY = larger(bottom, p.m * long);
    this.begin(count, blocks);
    if (p.i === p.k && p.b1 === p.b2 && p.j === p.m && p.a1 === p.a2) this.tie = 1;
    this.fill(0, p.i, p.b1, bottom, 0, midX, 0, 1, 1);
    this.fill(1, p.a1, p.m, midY, 0, right, midX, 2, 8);
    this.fill(2, p.a2, p.j, top, bottom, leftTop, 0, 2, 2);
    this.fill(3, p.k, p.b2, top, midY, right, leftTop, 1, 4);
  }

  /** `FUN_00be7760`: push the right and top arms clear of the center block. */
  private liftQuadEdges(centerRight: number, centerTop: number, a1: number, b2: number): void {
    const [, slot1, slot2, slot3] = this.scratch as [ScratchSlot, ScratchSlot, ScratchSlot, ScratchSlot];
    if (slot3.near < centerTop) {
      slot3.near = centerTop;
      slot3.span = b2 * this.shortSide + centerTop;
      if (slot2.span < slot3.span) slot2.span = slot3.span;
    }
    if (slot1.origin < centerRight) {
      slot1.origin = centerRight;
      slot1.far = a1 * this.shortSide + centerRight;
      if (slot3.far < slot1.far) slot3.far = slot1.far;
    }
  }

  /**
   * `FUN_00be7020`: the pinwheel with the long counts as loop variables. Only
   * the arm pairs that would collide as plain bands are offered.
   */
  private interlockStrips(): void {
    if (this.xLong <= 1 || this.yLong <= 1) return;
    const long = this.longSide;
    const short = this.shortSide;
    for (let i = 1; i <= this.xLong - 1; i += 1) {
      const room = Math.min(this.xLong - i, i);
      const a1 = tableAt(this.tableX, i);
      for (let j = 1; j <= this.yLong - 1; j += 1) {
        const b1 = tableAt(this.tableY, j);
        for (let k = 1; k <= room; k += 1) {
          const a2 = tableAt(this.tableX, k);
          for (let m = 1; m <= this.yLong - j; m += 1) {
            const b2 = tableAt(this.tableY, m);
            if (b1 + b2 <= this.yShort && a1 + a2 <= this.xShort) continue;
            const pinwheel: Pinwheel = { i, a1, j, b1, k, a2, m, b2 };
            const base = a1 * m + i * b1 + a2 * j + k * b2;
            let placed = false;
            if (base < this.upperBound) {
              const roomX = this.usableX - long * (i + k);
              const roomY = this.usableY - long * (m + j);
              for (const type of [1, 2] as const) {
                const across = idiv(roomX, type === 1 ? long : short);
                const deep = idiv(roomY, type === 1 ? short : long);
                const total = base + across * deep;
                if (across * deep <= 0 || !this.worth(total)) continue;
                placed = true;
                this.stripSlots(total, 5, pinwheel);
                const x0 = long * i;
                const x1 = x0 + (type === 1 ? long : short) * across;
                const y0 = long * m;
                const y1 = y0 + (type === 1 ? short : long) * deep;
                this.fill(4, across, deep, y1, y0, x1, x0, type, 0);
                this.liftStripEdges(x1, y1, j, k);
                this.accept(5, 8);
              }
            }
            if (this.worth(base) && !placed) {
              this.stripSlots(base, 4, pinwheel);
              this.accept(4, 5);
            }
          }
        }
      }
    }
  }

  /** `FUN_00be6cec`: the four pinwheel arms of `be7020`. */
  private stripSlots(count: number, blocks: number, p: Pinwheel): void {
    const long = this.longSide;
    const short = this.shortSide;
    const leftBottom = p.i * long;
    const leftTop = p.a2 * short;
    const rightBottom = p.m * long;
    const bottom = p.b1 * short;
    const right = larger(
      larger(p.a1 * short + leftBottom, p.k * long + leftTop),
      p.k * long + leftBottom,
    );
    const top = larger(
      larger(p.j * long + bottom, p.b2 * short + rightBottom),
      p.j * long + rightBottom,
    );
    const midX = larger(leftBottom, leftTop);
    const midY = larger(bottom, rightBottom);
    this.begin(count, blocks);
    if (p.i === p.k && p.b1 === p.b2 && p.m === p.j && p.a1 === p.a2) this.tie = 1;
    this.fill(0, p.i, p.b1, bottom, 0, leftBottom, 0, 1, 1);
    this.fill(1, p.a1, p.m, rightBottom, 0, right, leftBottom, 2, 8);
    this.fill(2, p.a2, p.j, top, midY, midX, 0, 2, 2);
    this.fill(3, p.k, p.b2, top, rightBottom, right, midX, 1, 4);
  }

  /** `FUN_00be6fa0`. */
  private liftStripEdges(centerRight: number, centerTop: number, j: number, k: number): void {
    const [, slot1, slot2, slot3, slot4] = this.scratch as [
      ScratchSlot,
      ScratchSlot,
      ScratchSlot,
      ScratchSlot,
      ScratchSlot,
    ];
    if (slot2.near < centerTop) {
      slot2.near = centerTop;
      slot2.span = j * this.longSide + centerTop;
      if (slot3.span < slot2.span) slot3.span = slot2.span;
    }
    if (slot3.origin < centerRight) {
      slot3.origin = centerRight;
      slot3.far = k * this.longSide + centerRight;
      if (slot1.far < slot3.far) slot1.far = slot3.far;
    }
    if (slot2.far < slot4.far) slot2.far = slot4.far;
  }

  /**
   * `FUN_00be6688`: a kombi block (`extraA` steps of main rows plus rotated
   * teeth, drawn by `FUN_00a45ebc`) grown step by step, with the remaining
   * pallet filled by the `be647c` helpers. The first nest uses type 2 main
   * rows, the second type 1; repeated steps run with the class remap set.
   */
  private nestedBlocks(): void {
    const long = this.longSide;
    const short = this.shortSide;
    for (let d = 1; d <= this.tableY.count; d += 1) {
      for (let i = 1; i <= this.tableX.count; i += 1) {
        for (let rows = 1; rows <= tableAt(this.tableY, d); rows += 1) {
          for (let columns = 1; columns <= tableAt(this.tableX, i); columns += 1) {
            const lead = long * i - short * columns;
            const side = long * d - short * rows;
            if (!nestedPairFits(lead, side, long, short, false)) continue;
            const template: ScratchSlot = {
              ...emptySlot(),
              type: 2,
              countA: columns & 0xff,
              countB: d & 0xff,
              extraA: 1,
              extraB: i & 0xff,
              extraC: rows & 0xff,
              far: short * columns + long * i,
              span: long * d + short * rows,
              shape: 1,
            };
            let count = 2 * (columns * d + i * rows);
            let rest = this.offerNested(template, count, true);
            if (long * d > rest.y || short * columns > rest.x) continue;
            let stacked = d;
            for (;;) {
              stacked += d;
              count += i * rows + 2 * (template.extraA + 1) * columns * d;
              template.extraA = (template.extraA + 1) & 0xff;
              template.far = short * columns * template.extraA + long * i;
              template.span = long * stacked + short * rows;
              template.countB = stacked & 0xff;
              this.remapShapes = true;
              rest = this.offerNested(template, count, true);
              this.remapShapes = false;
              if (long * d > rest.y || short * columns > rest.x) break;
            }
          }
        }
      }
    }
    for (let d = 1; d <= this.tableY.count; d += 1) {
      for (let i = 1; i <= this.tableX.count; i += 1) {
        for (let rows = 1; rows <= tableAt(this.tableY, d); rows += 1) {
          for (let teeth = 1; teeth <= tableAt(this.tableX, i); teeth += 1) {
            const lead = short * teeth - long * i;
            const side = short * rows - long * d;
            if (!nestedPairFits(lead, side, long, short, true)) continue;
            const template: ScratchSlot = {
              ...emptySlot(),
              type: 1,
              countA: i & 0xff,
              countB: rows & 0xff,
              extraA: 1,
              extraB: teeth & 0xff,
              extraC: d & 0xff,
              far: long * i + short * teeth,
              span: short * rows + long * d,
              shape: 1,
            };
            let count = 2 * (i * rows + teeth * d);
            let rest = this.offerNested(template, count, false);
            if (short * rows > rest.y || long * i > rest.x) continue;
            let stacked = rows;
            for (;;) {
              stacked += rows;
              count += teeth * d + 2 * (template.extraA + 1) * i * rows;
              template.extraA = (template.extraA + 1) & 0xff;
              template.far = long * i * template.extraA + short * teeth;
              template.span = short * stacked + long * d;
              template.countB = stacked & 0xff;
              this.remapShapes = true;
              rest = this.offerNested(template, count, true);
              this.remapShapes = false;
              if (short * rows > rest.y || long * i > rest.x) break;
            }
          }
        }
      }
    }
  }

  /**
   * `FUN_00be647c`. Runs the fill helpers when the block wastes no more than
   * the frame limit; `sideStrips` is its `AL` argument.
   */
  private offerNested(
    template: ScratchSlot,
    count: number,
    sideStrips: boolean,
  ): { x: number; y: number } {
    const long = this.longSide;
    const short = this.shortSide;
    const frame: NestedFrame = {
      template,
      count,
      width: template.far,
      height: template.span,
      restX: this.alignedX - template.far,
      restY: this.alignedY - template.span,
    };
    const { restX, restY } = frame;
    const rest = { x: restX, y: restY };
    if (frame.width * frame.height - count * short * long > this.wasteLimit) return rest;
    if (sideStrips) {
      if (restX < short && short <= restY) this.stripAbove(frame, 1);
      if (restX < short && long <= restY) this.stripAbove(frame, 2);
      if (long <= restX && restY < short) this.stripRight(frame, 1);
      if (short <= restX && restY < short) this.stripRight(frame, 2);
    }
    if (short <= restY && short <= restX) {
      this.cornerAboveShort(frame);
      this.cornerRightShort(frame);
    }
    if (long <= restY && long <= restX) {
      this.cornerAboveLong(frame);
      this.cornerRightLong(frame);
      this.wrapAboveRight(frame);
    }
    if (long <= restY && short <= restX) this.wrapRightTop(frame);
    if (long <= restY && long <= restX) this.wrapRightBottom(frame);
    if (short <= restY && long <= restX) this.wrapAboveLeft(frame);
    if (short * 2 <= restY && short * 2 <= restX) this.ring(frame, 1);
    if (long * 2 <= restY && long * 2 <= restX) this.ring(frame, 2);
    return rest;
  }

  /** Copies the template into slot 0; the block count is `steps * 3 + extra`. */
  private startTemplate(count: number, extraBlocks: number, frame: NestedFrame): ScratchSlot {
    this.begin(count, ((frame.template.extraA & 0xff) * 3 + extraBlocks) & 0xffff);
    const slot0 = cloneSlot(frame.template);
    this.scratch[0] = slot0;
    return slot0;
  }

  /** `FUN_00be5374` (type 1) / `FUN_00be54f8` (type 2): one band above the block. */
  private stripAbove(frame: NestedFrame, type: 1 | 2): void {
    const unit = type === 1 ? this.shortSide : this.longSide;
    const across = type === 1 ? this.xLong : this.xShort;
    const pitch = type === 1 ? this.longSide : this.shortSide;
    const count = idiv(this.usableY - frame.height, unit) * across + frame.count;
    if (!this.worth(count)) return;
    this.startTemplate(count, 2, frame).shape = 9;
    const far = larger(across * pitch, frame.width);
    const rows = idiv(this.alignedY - frame.height, unit);
    this.fill(1, across, rows, rows * unit + frame.height, frame.height, far, 0, type, 6);
    this.accept(2, 10);
  }

  /** `FUN_00be567c` (type 1) / `FUN_00be5800` (type 2): one band right of the block. */
  private stripRight(frame: NestedFrame, type: 1 | 2): void {
    const unit = type === 1 ? this.longSide : this.shortSide;
    const down = type === 1 ? this.yShort : this.yLong;
    const pitch = type === 1 ? this.shortSide : this.longSide;
    const count = idiv(this.usableX - frame.width, unit) * down + frame.count;
    if (!this.worth(count)) return;
    this.startTemplate(count, 2, frame).shape = 3;
    const columns = idiv(this.alignedX - frame.width, unit);
    const span = larger(down * pitch, frame.height);
    this.fill(1, columns, down, span, 0, columns * unit + frame.width, frame.width, type, 0x0c);
    this.accept(2, 10);
  }

  /** `FUN_00be5984`: type 1 rows above, type 2 columns right of the block. */
  private cornerAboveShort(frame: NestedFrame): void {
    const long = this.longSide;
    const short = this.shortSide;
    const rows = idiv(frame.restY, short);
    const deep = idiv(this.alignedY - short * rows, long);
    const columns = idiv(frame.restX, short);
    const count = deep * columns + frame.count + this.xLong * rows;
    if (!this.worth(count)) return;
    this.startTemplate(count, 3, frame);
    const right = larger(columns * short + frame.width, this.xLong * long);
    const top = larger(frame.height, deep * long);
    this.fill(1, this.xLong, rows, top + short * rows, top, right, 0, 1, 6);
    this.fill(2, columns, deep, top, 0, right, frame.width, 2, 8);
    this.accept(3, 11);
  }

  /** `FUN_00be5c0c`: type 2 rows above, type 1 columns right of the block. */
  private cornerAboveLong(frame: NestedFrame): void {
    const long = this.longSide;
    const short = this.shortSide;
    const rows = idiv(frame.restY, long);
    const deep = idiv(this.alignedY - long * rows, short);
    const columns = idiv(frame.restX, long);
    const count = deep * columns + frame.count + this.xShort * rows;
    if (!this.worth(count)) return;
    this.startTemplate(count, 3, frame);
    const right = columns * long + frame.width;
    const far = larger(this.xShort * short, right);
    this.fill(1, this.xShort, rows, frame.height + long * rows, frame.height, far, 0, 2, 6);
    const top = larger(deep * short, frame.height);
    this.fill(2, columns, deep, top, 0, right, frame.width, 1, 8);
    const slot1 = this.scratch[1]!;
    if (slot1.near < top) {
      slot1.span = slot1.span - slot1.near + top;
      slot1.near = top;
    }
    this.accept(3, 11);
  }

  /** `FUN_00be5edc`: type 2 columns right, type 1 rows above the block. */
  private cornerRightShort(frame: NestedFrame): void {
    const long = this.longSide;
    const short = this.shortSide;
    const columns = idiv(frame.restX, short);
    const across = idiv(this.alignedX - short * columns, long);
    const count = across * idiv(frame.restY, short) + frame.count + this.yLong * columns;
    if (!this.worth(count)) return;
    this.startTemplate(count, 3, frame);
    const rows = idiv(this.alignedY - frame.height, short);
    const right = larger(across * long, frame.width);
    const top = rows * short + frame.height;
    const span = larger(this.yLong * long, top);
    this.fill(1, columns, this.yLong, span, 0, frame.width + short * columns, frame.width, 2, 0x0c);
    this.fill(2, across, rows, top, frame.height, right, 0, 1, 2);
    this.shiftRightOf(right);
    this.accept(3, 11);
  }

  /** `FUN_00be61ac`: type 1 columns right, type 2 rows above the block. */
  private cornerRightLong(frame: NestedFrame): void {
    const long = this.longSide;
    const short = this.shortSide;
    const columns = idiv(frame.restX, long);
    const across = idiv(this.alignedX - long * columns, short);
    const count = across * idiv(frame.restY, long) + frame.count + this.yShort * columns;
    if (!this.worth(count)) return;
    this.startTemplate(count, 3, frame);
    const rows = idiv(this.alignedY - frame.height, long);
    const right = larger(across * short, frame.width);
    const top = rows * long + frame.height;
    const span = larger(this.yShort * short, top);
    this.fill(1, columns, this.yShort, span, 0, frame.width + long * columns, frame.width, 1, 0x0c);
    this.fill(2, across, rows, top, frame.height, right, 0, 2, 2);
    this.shiftRightOf(right);
    this.accept(3, 11);
  }

  /** Moves slot 1 right so it starts at `edge` (`be5edc` / `be61ac` tail). */
  private shiftRightOf(edge: number): void {
    const slot1 = this.scratch[1]!;
    if (slot1.origin < edge) {
      slot1.far = slot1.far - slot1.origin + edge;
      slot1.origin = edge;
    }
  }

  /** `FUN_00be46f0`. */
  private wrapAboveRight(frame: NestedFrame): void {
    const long = this.longSide;
    const short = this.shortSide;
    const rows = idiv(frame.restY, short);
    const columns = idiv(frame.restX, long);
    const deep = idiv(this.alignedY - frame.height, long);
    const fill = idiv(this.alignedY - long * deep, short);
    const steps = idiv(frame.width, long);
    for (let lead = 1; lead <= steps; lead += 1) {
      const across = tableAt(this.tableX, lead);
      const count = frame.count + lead * rows + across * deep + columns * fill;
      if (!this.worth(count)) continue;
      this.startTemplate(count, 4, frame);
      const leadX = long * lead;
      const midX = larger(leadX, frame.width);
      const midY = larger(short * fill, frame.height);
      const band = long * deep;
      const top = larger(larger(short * fill + band, midY + band), frame.height + short * rows);
      this.fill(1, lead, rows, top, frame.height, leadX, 0, 1, 2);
      const right = larger(frame.width + long * columns, short * across + leadX);
      this.fill(2, columns, fill, midY, 0, right, midX, 1, 8);
      this.fill(3, across, deep, top, midY, right, this.scratch[1]!.far, 2, 4);
      this.accept(4, 12);
    }
  }

  /** `FUN_00be4a40`. */
  private wrapRightTop(frame: NestedFrame): void {
    const long = this.longSide;
    const short = this.shortSide;
    const rows = idiv(frame.restY, long);
    const columns = idiv(frame.restX, short);
    const teeth = idiv(short * columns, long) + 1;
    const across = tableAt(this.tableX, teeth);
    for (let band = idiv(frame.height - 1, long) + 1; band <= this.tableY.count; band += 1) {
      const fill = tableAt(this.tableY, band);
      const count = frame.count + across * rows + teeth * fill + columns * band;
      if (!this.worth(count)) continue;
      this.startTemplate(count, 4, frame);
      const leftX = short * across;
      const right = larger(
        larger(leftX + long * teeth, frame.width + short * columns),
        (across + columns) * short,
      );
      const top = larger(long * band + short * fill, frame.height + long * rows);
      const midY = larger(long * band, frame.height);
      const midX = larger(frame.width, leftX);
      this.fill(1, across, rows, top, frame.height, leftX, 0, 2, 2);
      this.fill(2, columns, band, midY, 0, right, midX, 2, 8);
      this.fill(3, teeth, fill, top, midY, right, leftX, 1, 4);
      this.accept(4, 12);
    }
  }

  /** `FUN_00be4d6c`. */
  private wrapRightBottom(frame: NestedFrame): void {
    const long = this.longSide;
    const short = this.shortSide;
    const rows = idiv(frame.restY, long);
    const columns = idiv(frame.restX, short);
    const teeth = idiv(this.alignedX - frame.width, long);
    const across = tableAt(this.tableX, teeth);
    const steps = idiv(frame.height, long);
    for (let band = 1; band <= steps; band += 1) {
      const fill = tableAt(this.tableY, band);
      const count = frame.count + across * rows + columns * band + teeth * fill;
      if (!this.worth(count)) continue;
      this.startTemplate(count, 4, frame);
      const bandY = long * band;
      const top = larger(frame.height + long * rows, bandY + short * fill);
      const midY = larger(frame.height, bandY);
      const midX = larger(frame.width, short * across);
      const right = larger(midX + long * teeth, frame.width + short * columns);
      this.fill(1, across, rows, top, midY, midX, 0, 2, 2);
      this.fill(2, columns, band, bandY, 0, right, frame.width, 2, 8);
      this.fill(3, teeth, fill, top, bandY, right, midX, 1, 4);
      this.accept(4, 12);
    }
  }

  /** `FUN_00be5064`. */
  private wrapAboveLeft(frame: NestedFrame): void {
    const long = this.longSide;
    const short = this.shortSide;
    const rows = idiv(frame.restY, short);
    const columns = idiv(frame.restX, long);
    const deep = idiv(short * rows, long) + 1;
    const fill = tableAt(this.tableY, deep);
    for (let lead = idiv(frame.width - 1, long) + 1; lead <= this.tableX.count; lead += 1) {
      const across = tableAt(this.tableX, lead);
      const count = frame.count + lead * rows + across * deep + columns * fill;
      if (!this.worth(count)) continue;
      this.startTemplate(count, 4, frame);
      const fillY = short * fill;
      const top = larger(frame.height + short * rows, fillY + long * deep);
      const midY = larger(frame.height, fillY);
      const midX = larger(frame.width, long * lead);
      const right = larger(midX + short * across, frame.width + long * columns);
      this.fill(1, lead, rows, top, midY, midX, 0, 1, 2);
      this.fill(2, columns, fill, fillY, 0, right, frame.width, 1, 8);
      this.fill(3, across, deep, top, fillY, right, midX, 2, 4);
      this.accept(4, 12);
    }
  }

  /**
   * `FUN_00be3fd4` (type 1 arms, short pitch) / `FUN_00be43a0` (type 2, long
   * pitch): four arms around the block, which moves into the middle.
   */
  private ring(frame: NestedFrame, type: 1 | 2): void {
    const pitch = type === 1 ? this.shortSide : this.longSide;
    const run = type === 1 ? this.longSide : this.shortSide;
    const crossType = type === 1 ? 2 : 1;
    const spanY = idiv(frame.restY, pitch);
    const spanX = idiv(frame.restX, pitch);
    const halfY = Math.trunc((spanY + 1) / 2);
    const halfX = Math.trunc((spanX + 1) / 2);
    const deepAt = (rows: number): number =>
      type === 1
        ? idiv(this.alignedY - pitch * rows, run)
        : tableAt(this.tableY, rows);
    const runAt = (columns: number): number =>
      type === 1
        ? idiv(this.alignedX - pitch * columns, run)
        : tableAt(this.tableX, columns);
    for (let bottom = 1; bottom <= halfY; bottom += 1) {
      const top = spanY - bottom;
      const leftDeep = deepAt(bottom);
      const rightDeep = deepAt(top);
      for (let left = 1; left <= halfX; left += 1) {
        const right = spanX - left;
        const bottomRun = runAt(right);
        const topRun = runAt(left);
        const count =
          frame.count + bottomRun * bottom + left * leftDeep + topRun * top + right * rightDeep;
        if (!this.worth(count)) continue;
        const slot0 = this.startTemplate(count, 5, frame);
        this.fill(1, bottomRun, bottom, pitch * bottom, 0, run * bottomRun, 0, type, 1);
        const bottomEdge = this.scratch[1]!.span;
        this.fill(2, left, leftDeep, bottomEdge + run * leftDeep, bottomEdge, pitch * left, 0, crossType, 2);
        const leftEdge = this.scratch[2]!.far;
        const topY = this.alignedY - pitch * top;
        this.fill(3, topRun, top, this.alignedY, topY, leftEdge + run * topRun, leftEdge, type, 4);
        const rightX = this.alignedX - pitch * right;
        this.fill(4, right, rightDeep, run * rightDeep, 0, this.alignedX, rightX, crossType, 8);
        slot0.shape = 0;
        slot0.origin = leftEdge;
        slot0.far = leftEdge + frame.width;
        slot0.near = bottomEdge;
        slot0.span = bottomEdge + frame.height;
        this.accept(5, 13);
      }
    }
  }

  private finish(): Plan[] {
    const plans = [
      ...this.direct,
      ...this.bands,
      ...this.triples,
      ...this.mids,
      ...this.pins,
      ...this.rest,
    ];
    for (let i = 0; i < plans.length - 1; i += 1) {
      let best = i;
      for (let j = i + 1; j < plans.length; j += 1) {
        const challenger = plans[j];
        const current = plans[best];
        if (challenger && current && candidateBeats(current, challenger)) best = j;
      }
      if (best !== i) {
        const swap = plans[i];
        plans[i] = plans[best]!;
        plans[best] = swap!;
      }
    }
    const trimmed = this.stop ? this.trimWithSecondPass(plans) : plans;
    for (const plan of trimmed) {
      plan.length -= this.clearance;
      plan.width -= this.clearance;
      for (const slot of plan.slots) {
        slot.far -= this.clearance;
        slot.span -= this.clearance;
        if (!this.swapped || slot.type === 0) continue;
        slot.type = slot.type === 1 ? 2 : 1;
      }
    }
    return trimmed;
  }

  /**
   * Exact-count trim of `FUN_00bea380`. Without a record of exactly the
   * target count, the second pass appends exact grids (`be97f4`) and trimmed
   * bands (`be9bf4`) to the kept records, unsorted, and trims again.
   */
  private trimWithSecondPass(sorted: Plan[]): Plan[] {
    const first = sorted[0];
    if (!first || first.count < this.target) return sorted;
    const kept = trimToTarget(sorted, this.target);
    if (kept.some((plan) => plan.count === this.target)) return kept;
    let bestGrid = 0;
    let bestBand = 0;
    for (const plan of kept) {
      if (plan.klass <= 1 && plan.count > bestGrid) bestGrid = plan.count;
      if (plan.klass === 2 && plan.count > bestBand) bestBand = plan.count;
    }
    this.direct = kept;
    this.alternateBuckets = true;
    if (this.target < bestGrid) this.exactGrids();
    if (this.target < bestBand && this.target > 2) this.trimmedBands();
    this.alternateBuckets = false;
    return trimToTarget(this.direct, this.target);
  }

  /**
   * `FUN_00be97f4`: grids of exactly the target count, then grids one row or
   * column short plus a centered partial row or column.
   */
  private exactGrids(): void {
    const long = this.longSide;
    const short = this.shortSide;
    const target = this.target;
    for (let i = 1; i <= this.xLong; i += 1) {
      for (let j = 1; j <= this.yShort; j += 1) {
        if (i * j !== target) continue;
        this.begin(target, 1);
        this.fill(0, i, j, short * j, 0, long * i, 0, 1, 0x0f);
        this.accept(1, 1);
      }
    }
    for (let i = 1; i <= this.xShort; i += 1) {
      for (let j = 1; j <= this.yLong; j += 1) {
        if (i * j !== target) continue;
        this.begin(target, 1);
        this.fill(0, i, j, long * j, 0, short * i, 0, 2, 0x0f);
        this.accept(1, 1);
      }
    }
    for (let i = 1; i <= this.xLong; i += 1) {
      for (let j = 1; j <= this.yShort; j += 1) {
        if (i * j <= target) continue;
        const extra = asShort(i * j - target);
        if (i <= extra) continue;
        const center = Math.trunc((extra * long) / 2);
        this.begin(target, 2);
        this.fill(0, i, j - 1, (j - 1) * short, 0, long * i, 0, 1, 0x0f);
        // The original pushes `j - S` as the near edge of the partial row
        // (0x00be9a59), not `(j - 1) * S`.
        this.fill(1, i - extra, 1, short * j, j - short, center + (i - extra) * long, center, 1, 0x0f);
        this.accept(2, 2);
        break;
      }
    }
    for (let i = 1; i <= this.xShort; i += 1) {
      for (let j = 1; j <= this.yLong; j += 1) {
        if (i * j <= target) continue;
        const extra = asShort(i * j - target);
        if (j <= extra) continue;
        const center = Math.trunc((extra * long) / 2);
        this.begin(target, 2);
        this.fill(0, i - 1, j, long * j, 0, (i - 1) * short, 0, 2, 0x0f);
        this.fill(1, 1, j - extra, center + (j - extra) * long, center, short * i, (i - 1) * short, 2, 0x0f);
        this.accept(2, 2);
        break;
      }
    }
  }

  /**
   * `FUN_00be9bf4`: two-band layouts whose last row or column is cut to the
   * target count and centered.
   */
  private trimmedBands(): void {
    const long = this.longSide;
    const short = this.shortSide;
    const target = this.target;
    const halfLong = Math.trunc(long / 2);
    const spanX = larger(this.xLong * long, this.xShort * short);
    for (let row = 1; row <= this.tableY.count; row += 1) {
      const across = tableAt(this.tableY, row);
      const total = across * this.xLong + this.xShort * row;
      const extra = total - target;
      const keep = this.xLong - extra;
      const x0 = Math.trunc(spanX / 2) - halfLong * keep;
      const x1 = keep * long + x0;
      if (target >= total || extra >= this.xLong) continue;
      const band = long * row;
      if (across === 1) {
        this.begin(target, 2);
        this.fill(0, this.xShort, row, band, 0, spanX, 0, 2, 9);
        this.fill(1, keep, 1, band + short, band, x1, x0, 1, 6);
        this.accept(2, 2);
      }
      if (across > 1) {
        const top = across * short + band;
        this.begin(target, 3);
        this.fill(0, this.xShort, row, band, 0, spanX, 0, 2, 9);
        this.fill(1, this.xLong, across - 1, top - short, band, spanX, 0, 1, 6);
        this.fill(2, keep, 1, top, top - short, x1, x0, 1, 6);
        this.accept(3, 3);
      }
    }
    const spanY = larger(this.yLong * long, this.yShort * short);
    for (let column = 1; column <= this.tableX.count; column += 1) {
      const across = tableAt(this.tableX, column);
      const total = across * this.yLong + this.yShort * column;
      const extra = total - target;
      const keep = this.yLong - extra;
      const y0 = Math.trunc(spanY / 2) - halfLong * keep;
      const y1 = keep * long + y0;
      if (target >= total || extra >= this.yLong || extra <= 0) continue;
      const band = long * column;
      if (across === 1) {
        this.begin(target, 2);
        this.fill(0, column, this.yShort, spanY, 0, band, 0, 1, 3);
        this.fill(1, 1, keep, y1, y0, band + short, band, 2, 0x0c);
        this.accept(2, 2);
      }
      if (across > 1) {
        const inner = short * (across - 1) + band;
        this.begin(target, 3);
        this.fill(0, column, this.yShort, spanY, 0, band, 0, 1, 3);
        this.fill(1, across - 1, this.yLong, spanY, 0, inner, band, 2, 0x0c);
        this.fill(2, 1, keep, y1, y0, band + short * across, inner, 2, 0x0c);
        this.accept(3, 3);
      }
    }
  }
}

function trimToTarget(plans: Plan[], target: number): Plan[] {
  let last = plans.length;
  for (let i = 0; i < plans.length; i += 1) {
    if ((plans[i]?.count ?? 0) >= target) last = i + 1;
  }
  let exact = 1;
  for (let i = 0; i < plans.length; i += 1) {
    if (plans[i]?.count === target) {
      exact = i + 1;
      break;
    }
  }
  if (exact > last) return plans.slice(0, last);
  return plans.slice(exact - 1, last);
}

function toSolution(
  plan: Plan,
  input: PlanSearchInput,
): MultiPackSolution {
  const slots: FamilySlot[] = [];
  for (const slot of plan.slots) {
    if (slot.type !== 1 && slot.type !== 2) continue;
    if (slot.extraA !== 0) {
      // The placer reads a nonzero `+0x13` as a kombi slot (`FUN_00a45ebc`);
      // `+0x16` is its direction character there.
      slots.push({
        kind: "kombi",
        type: slot.type,
        x0: slot.origin,
        x1: slot.far,
        y0: slot.near,
        y1: slot.span,
        columns: slot.countA,
        ratio: slot.countB,
        steps: slot.extraA,
        toothColumns: slot.extraB,
        toothRows: slot.extraC,
        descending: slot.shape === 0x64,
      });
      continue;
    }
    if (slot.countA === 0 || slot.countB === 0) continue;
    slots.push({
      kind: "simple",
      type: slot.type as SlotType,
      x0: slot.origin,
      x1: slot.far,
      y0: slot.near,
      y1: slot.span,
      countX: slot.countA,
      countY: slot.countB,
    });
  }
  return {
    paletteDmm: input.paletteDmm,
    blockDmm: { x: plan.length, y: plan.width },
    package: input.package,
    clearanceDmm: input.clearanceDmm,
    slots,
  };
}

export type SearchedMultiPackPlan = {
  variant: string;
  solution: MultiPackSolution;
};

export function searchMultiPackPlans(input: PlanSearchInput): SearchedMultiPackPlan[] {
  const plans = new PlanSearch(input, input.package.length, input.package.width).run();
  return plans.map((plan, index) => ({
    variant: `mp:${index}:c${plan.klass}:n${plan.count}:${plan.length}x${plan.width}`,
    solution: toSolution(plan, input),
  }));
}
