import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import {
  loadGripperModel,
  stripObjLineElements,
  type GripperAssetResponse,
  type GripperLoaderDependencies,
  type GripperMaterialLibrary,
} from "~/components/rob-viewer/gripperLoader";

const MTL_TEXT = `
newmtl test-material
Kd 0.8 0.8 0.8
`;

const OBJ_TEXT = `
o gripper
v 0 0 0
v 10 0 0
v 0 10 0
usemtl test-material
f 1 2 3
`;

function assetResponse(text: string, status = 200): GripperAssetResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
  };
}

function materialLibrary(
  material: THREE.Material,
  preload: () => void = () => undefined,
): GripperMaterialLibrary {
  return {
    preload,
    materials: { "test-material": material },
  };
}

function loadWith(
  dependencies: Partial<GripperLoaderDependencies>,
  signal = new AbortController().signal,
) {
  return loadGripperModel({
    basePath: "/models/gripper/",
    objFile: "gripper.obj",
    mtlFile: "gripper.mtl",
    signal,
    dependencies,
  });
}

describe("gripper loader lifecycle", () => {
  it("removes OBJ line elements without changing mesh records", () => {
    expect(stripObjLineElements("v 0 0 0\r\nl 1 2\r\nf 1 2 3\r\n")).toBe(
      "v 0 0 0\nf 1 2 3\n",
    );
  });

  it("returns an idempotently disposable model on success", async () => {
    const fetchAsset: GripperLoaderDependencies["fetchAsset"] = vi.fn(
      async (url: string) =>
        assetResponse(url.endsWith(".mtl") ? MTL_TEXT : OBJ_TEXT),
    );
    const loaded = await loadWith({ fetchAsset });
    let mesh: THREE.Mesh | null = null;
    loaded.model.traverse((child) => {
      if (!mesh && child instanceof THREE.Mesh) mesh = child;
    });
    expect(mesh).not.toBeNull();
    const geometryDispose = vi.spyOn(mesh!.geometry, "dispose");
    const material = Array.isArray(mesh!.material)
      ? mesh!.material[0]!
      : mesh!.material;
    const materialDispose = vi.spyOn(material, "dispose");

    loaded.dispose();
    loaded.dispose();

    expect(fetchAsset).toHaveBeenCalledTimes(2);
    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(materialDispose).toHaveBeenCalledTimes(1);
  });

  it("disposes preloaded materials after an OBJ HTTP failure", async () => {
    const material = new THREE.MeshBasicMaterial();
    const materialDispose = vi.spyOn(material, "dispose");
    const fetchAsset: GripperLoaderDependencies["fetchAsset"] = vi.fn(
      async (url: string) =>
        url.endsWith(".mtl") ? assetResponse(MTL_TEXT) : assetResponse("", 503),
    );

    await expect(
      loadWith({
        fetchAsset,
        parseMaterials: () => materialLibrary(material),
      }),
    ).rejects.toThrow("Failed to load gripper OBJ (503)");

    expect(materialDispose).toHaveBeenCalledTimes(1);
  });

  it("disposes preloaded materials after OBJ text reading fails", async () => {
    const material = new THREE.MeshBasicMaterial();
    const materialDispose = vi.spyOn(material, "dispose");
    const fetchAsset: GripperLoaderDependencies["fetchAsset"] = vi.fn(
      async (url: string) =>
        url.endsWith(".mtl")
          ? assetResponse(MTL_TEXT)
          : {
              ok: true,
              status: 200,
              text: async () => {
                throw new Error("OBJ text failure");
              },
            },
    );

    await expect(
      loadWith({
        fetchAsset,
        parseMaterials: () => materialLibrary(material),
      }),
    ).rejects.toThrow("OBJ text failure");

    expect(materialDispose).toHaveBeenCalledTimes(1);
  });

  it("disposes materials created before MTL preparation fails", async () => {
    const material = new THREE.MeshBasicMaterial();
    const materialDispose = vi.spyOn(material, "dispose");
    const library: GripperMaterialLibrary = {
      materials: {},
      preload: () => {
        library.materials["partial-material"] = material;
        throw new Error("MTL preload failure");
      },
    };

    await expect(
      loadWith({
        fetchAsset: async () => assetResponse(MTL_TEXT),
        parseMaterials: () => library,
      }),
    ).rejects.toThrow("MTL preload failure");

    expect(materialDispose).toHaveBeenCalledTimes(1);
  });

  it("disposes preloaded materials after OBJ parsing fails", async () => {
    const material = new THREE.MeshBasicMaterial();
    const materialDispose = vi.spyOn(material, "dispose");

    await expect(
      loadWith({
        fetchAsset: async (url: string) =>
          assetResponse(url.endsWith(".mtl") ? MTL_TEXT : OBJ_TEXT),
        parseMaterials: () => materialLibrary(material),
        parseObject: () => {
          throw new Error("OBJ parse failure");
        },
      }),
    ).rejects.toThrow("OBJ parse failure");

    expect(materialDispose).toHaveBeenCalledTimes(1);
  });

  it("disposes parsed object resources after preparation fails", async () => {
    const material = new THREE.MeshBasicMaterial();
    const geometry = new THREE.BufferGeometry();
    const object = new THREE.Group();
    object.add(new THREE.Mesh(geometry, material));
    const materialDispose = vi.spyOn(material, "dispose");
    const geometryDispose = vi.spyOn(geometry, "dispose");

    await expect(
      loadWith({
        fetchAsset: async (url: string) =>
          assetResponse(url.endsWith(".mtl") ? MTL_TEXT : OBJ_TEXT),
        parseMaterials: () => materialLibrary(material),
        parseObject: () => object,
        prepareObject: () => {
          throw new Error("Gripper preparation failure");
        },
      }),
    ).rejects.toThrow("Gripper preparation failure");

    expect(materialDispose).toHaveBeenCalledTimes(1);
    expect(geometryDispose).toHaveBeenCalledTimes(1);
  });

  it("disposes intermediate ownership when cancellation wins an OBJ fetch race", async () => {
    const controller = new AbortController();
    const material = new THREE.MeshBasicMaterial();
    const materialDispose = vi.spyOn(material, "dispose");
    let resolveObjResponse!: (response: GripperAssetResponse) => void;
    let notifyObjRequested!: () => void;
    const objRequested = new Promise<void>((resolve) => {
      notifyObjRequested = resolve;
    });
    const fetchAsset: GripperLoaderDependencies["fetchAsset"] = vi.fn(
      async (url: string) => {
        if (url.endsWith(".mtl")) return assetResponse(MTL_TEXT);
        notifyObjRequested();
        return new Promise<GripperAssetResponse>((resolve) => {
          resolveObjResponse = resolve;
        });
      },
    );
    const loadPromise = loadWith(
      {
        fetchAsset,
        parseMaterials: () => materialLibrary(material),
      },
      controller.signal,
    );

    await objRequested;
    controller.abort();
    const rejection = expect(loadPromise).rejects.toBe(
      controller.signal.reason,
    );
    resolveObjResponse(assetResponse(OBJ_TEXT));
    await rejection;
    controller.abort();

    expect(materialDispose).toHaveBeenCalledTimes(1);
  });
});
