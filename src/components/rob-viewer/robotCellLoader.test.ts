import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Texture } from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BUNDLED_ROBOT_CELL } from "./bundledRobotCell";
import { loadBundledRobotCell, prepareRobotCell } from "./robotCellLoader";

const createCellScene = () => {
  const scene = new Group();
  const root = new Group();
  const fixed = new Group();
  const liftCarriage = new Group();
  root.name = BUNDLED_ROBOT_CELL.nodes.root;
  fixed.name = BUNDLED_ROBOT_CELL.nodes.fixed;
  liftCarriage.name = BUNDLED_ROBOT_CELL.nodes.liftCarriage;
  root.add(fixed, liftCarriage);
  scene.add(root);
  return { scene, root, fixed, liftCarriage };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("robot-cell loader", () => {
  it("validates, aligns, and detaches the configured hierarchy", () => {
    const { scene, root, fixed, liftCarriage } = createCellScene();

    const cell = prepareRobotCell(scene);

    expect(cell.root).toBe(root);
    expect(cell.fixed).toBe(fixed);
    expect(cell.liftCarriage).toBe(liftCarriage);
    expect(root.parent).toBeNull();
    expect(root.scale.toArray()).toEqual([1_000, 1_000, 1_000]);
    expect(root.rotation.x).toBeCloseTo(Math.PI / 2);
    expect(root.position.toArray()).toEqual([
      BUNDLED_ROBOT_CELL.sourceToViewer.translationMm.x,
      BUNDLED_ROBOT_CELL.sourceToViewer.translationMm.y,
      BUNDLED_ROBOT_CELL.sourceToViewer.translationMm.z,
    ]);
    expect(cell.setLiftCarriageMm(450)).toBe(450);
    expect(liftCarriage.position.y).toBeCloseTo(0.45);
    expect(cell.setLiftCarriageMm(1_200)).toBe(900);
    expect(liftCarriage.position.y).toBeCloseTo(0.9);
    expect(cell.setLiftCarriageMm(null)).toBe(0);
    expect(liftCarriage.position.y).toBe(0);
  });

  it("rejects a carriage that is not a direct root child", () => {
    const { scene, fixed, liftCarriage } = createCellScene();
    fixed.add(liftCarriage);

    expect(() => prepareRobotCell(scene)).toThrow(
      "must be direct children of the robot-cell root",
    );
  });

  it("disposes shared render resources exactly once", () => {
    const { scene, fixed, liftCarriage } = createCellScene();
    const geometry = new BoxGeometry();
    const texture = new Texture();
    const material = new MeshBasicMaterial({ map: texture });
    fixed.add(new Mesh(geometry, material));
    liftCarriage.add(new Mesh(geometry, material));
    const geometryDispose = vi.spyOn(geometry, "dispose");
    const materialDispose = vi.spyOn(material, "dispose");
    const textureDispose = vi.spyOn(texture, "dispose");

    const cell = prepareRobotCell(scene);
    cell.dispose();
    cell.dispose();

    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(materialDispose).toHaveBeenCalledTimes(1);
    expect(textureDispose).toHaveBeenCalledTimes(1);
  });

  it("honors cancellation after fetching and before parsing", async () => {
    const controller = new AbortController();
    let releaseBytes: (() => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        arrayBuffer: () =>
          new Promise<ArrayBuffer>((resolve) => {
            releaseBytes = () => resolve(new ArrayBuffer(0));
          }),
      }),
    );

    const loading = loadBundledRobotCell({ signal: controller.signal });
    await vi.waitFor(() => expect(releaseBytes).toBeTypeOf("function"));
    controller.abort();
    releaseBytes!();

    await expect(loading).rejects.toMatchObject({ name: "AbortError" });
  });
});
