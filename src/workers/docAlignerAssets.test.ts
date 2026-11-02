// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  createAssetLoader,
  DOCALIGNER_CACHE_NAME,
  DOCALIGNER_MODEL_URL,
  loadAssetBytes,
  ORT_WASM_URL,
  ORT_WEB_VERSION,
  pruneOldCaches,
  type AssetDeps,
  type FetchPriority,
} from "~/workers/docAlignerAssets";

const bytes = (...values: number[]) => new Uint8Array(values);

/** In-memory Cache API with the parts the loader uses. */
function fakeCaches(
  initial: Record<string, Record<string, Uint8Array<ArrayBuffer>>> = {},
) {
  const stores = new Map(
    Object.entries(initial).map(([name, entries]) => [
      name,
      new Map(Object.entries(entries)),
    ]),
  );
  const caches = {
    async open(name: string) {
      const store =
        stores.get(name) ?? new Map<string, Uint8Array<ArrayBuffer>>();
      stores.set(name, store);
      return {
        async match(url: string) {
          const hit = store.get(url);
          return hit ? new Response(hit) : undefined;
        },
        async put(url: string, response: Response) {
          store.set(url, new Uint8Array(await response.arrayBuffer()));
        },
      } as unknown as Cache;
    },
    async keys() {
      return [...stores.keys()];
    },
    async delete(name: string) {
      return stores.delete(name);
    },
  };
  return { caches, stores };
}

/** Network that serves fixed bytes per URL and records every request. */
function fakeNetwork(status = 200) {
  const requests: { url: string; priority: FetchPriority }[] = [];
  const fetch: AssetDeps["fetch"] = async (url, { priority }) => {
    requests.push({ url, priority });
    return new Response(url === ORT_WASM_URL ? bytes(9, 9) : bytes(1, 2, 3), {
      status,
    });
  };
  return { fetch, requests };
}

const asArray = (buffer: ArrayBuffer) => Array.from(new Uint8Array(buffer));

describe("loadAssetBytes", () => {
  it("serves a cached download without touching the network", async () => {
    const { caches } = fakeCaches({
      [DOCALIGNER_CACHE_NAME]: { [DOCALIGNER_MODEL_URL]: bytes(7, 7) },
    });
    const network = fakeNetwork();
    const model = await loadAssetBytes(DOCALIGNER_MODEL_URL, "low", {
      fetch: network.fetch,
      caches,
    });
    expect(asArray(model)).toEqual([7, 7]);
    expect(network.requests).toEqual([]);
  });

  it("downloads at the given priority and keeps the bytes", async () => {
    const { caches, stores } = fakeCaches();
    const network = fakeNetwork();
    const model = await loadAssetBytes(DOCALIGNER_MODEL_URL, "low", {
      fetch: network.fetch,
      caches,
    });
    expect(asArray(model)).toEqual([1, 2, 3]);
    expect(network.requests).toEqual([
      { url: DOCALIGNER_MODEL_URL, priority: "low" },
    ]);
    expect(
      Array.from(stores.get(DOCALIGNER_CACHE_NAME)!.get(DOCALIGNER_MODEL_URL)!),
    ).toEqual([1, 2, 3]);
  });

  it("falls back to the network when the cache cannot be opened", async () => {
    const network = fakeNetwork();
    const caches = {
      open: () => Promise.reject(new Error("private mode")),
      keys: () => Promise.resolve([]),
      delete: () => Promise.resolve(false),
    };
    const model = await loadAssetBytes(DOCALIGNER_MODEL_URL, "high", {
      fetch: network.fetch,
      caches,
    });
    expect(asArray(model)).toEqual([1, 2, 3]);
  });

  it("rejects a failed download and caches nothing", async () => {
    const { caches, stores } = fakeCaches();
    await expect(
      loadAssetBytes(DOCALIGNER_MODEL_URL, "low", {
        fetch: fakeNetwork(404).fetch,
        caches,
      }),
    ).rejects.toThrow(`Download of ${DOCALIGNER_MODEL_URL} failed (404)`);
    expect(stores.get(DOCALIGNER_CACHE_NAME)!.size).toBe(0);
  });
});

describe("createAssetLoader", () => {
  it("prefetches into the cache without holding the bytes", async () => {
    const { caches, stores } = fakeCaches();
    const network = fakeNetwork();
    await createAssetLoader({ fetch: network.fetch, caches }).prefetch();
    expect(network.requests).toEqual([
      { url: DOCALIGNER_MODEL_URL, priority: "low" },
      { url: ORT_WASM_URL, priority: "low" },
    ]);
    expect([...stores.get(DOCALIGNER_CACHE_NAME)!.keys()]).toEqual([
      DOCALIGNER_MODEL_URL,
      ORT_WASM_URL,
    ]);
  });

  it("does not download again when the cache already has both", async () => {
    const { caches } = fakeCaches({
      [DOCALIGNER_CACHE_NAME]: {
        [DOCALIGNER_MODEL_URL]: bytes(7),
        [ORT_WASM_URL]: bytes(8),
      },
    });
    const network = fakeNetwork();
    const loader = createAssetLoader({ fetch: network.fetch, caches });
    await loader.prefetch();
    const { model, wasm } = await loader.get();
    expect([asArray(model), asArray(wasm), network.requests]).toEqual([
      [7],
      [8],
      [],
    ]);
  });

  it("lets the camera wait for a prefetch still in flight instead of downloading again", async () => {
    const { caches } = fakeCaches();
    const network = fakeNetwork();
    const loader = createAssetLoader({ fetch: network.fetch, caches });
    void loader.prefetch();
    const { model, wasm } = await loader.get();
    expect([asArray(model), asArray(wasm)]).toEqual([
      [1, 2, 3],
      [9, 9],
    ]);
    expect(network.requests).toEqual([
      { url: DOCALIGNER_MODEL_URL, priority: "low" },
      { url: ORT_WASM_URL, priority: "low" },
    ]);
  });

  it("keeps prefetched bytes where there is no cache", async () => {
    const network = fakeNetwork();
    const loader = createAssetLoader({ fetch: network.fetch });
    await loader.prefetch();
    await loader.get();
    expect(network.requests.map(({ priority }) => priority)).toEqual([
      "low",
      "low",
    ]);
  });

  it("downloads at high priority when the camera opens without a prefetch", async () => {
    const network = fakeNetwork();
    await createAssetLoader({ fetch: network.fetch }).get();
    expect(network.requests.map(({ priority }) => priority)).toEqual([
      "high",
      "high",
    ]);
  });

  it("re-downloads only the file whose prefetch failed", async () => {
    const { caches } = fakeCaches();
    const network = fakeNetwork();
    let releaseWasm: (() => void) | undefined;
    const wasmHeld = new Promise<void>((resolve) => (releaseWasm = resolve));
    const loader = createAssetLoader({
      fetch: async (url, init) => {
        if (url === DOCALIGNER_MODEL_URL && init.priority === "low") {
          network.requests.push({ url, priority: init.priority });
          throw new Error("model request dropped");
        }
        if (url === ORT_WASM_URL) await wasmHeld;
        return network.fetch(url, init);
      },
      caches,
    });
    const prefetched = loader.prefetch();
    await expect(prefetched).rejects.toThrow("model request dropped");
    // The camera opens while the 28 MB runtime is still downloading.
    const forCamera = loader.get();
    releaseWasm?.();
    const { model, wasm } = await forCamera;
    expect([asArray(model), asArray(wasm)]).toEqual([
      [1, 2, 3],
      [9, 9],
    ]);
    // The runtime is fetched once (its low-priority prefetch, recorded when
    // it completes); only the failed model is fetched again.
    expect(network.requests).toEqual([
      { url: DOCALIGNER_MODEL_URL, priority: "low" },
      { url: ORT_WASM_URL, priority: "low" },
      { url: DOCALIGNER_MODEL_URL, priority: "high" },
    ]);
  });

  it("keeps a prefetched download that a full cache refused", async () => {
    const { caches } = fakeCaches();
    const network = fakeNetwork();
    const full = {
      ...caches,
      async open(name: string) {
        const cache = await caches.open(name);
        return {
          match: cache.match.bind(cache),
          put: () =>
            Promise.reject(new DOMException("quota", "QuotaExceededError")),
        } as unknown as Cache;
      },
    };
    const loader = createAssetLoader({ fetch: network.fetch, caches: full });
    await loader.prefetch();
    const { model, wasm } = await loader.get();
    expect([asArray(model), asArray(wasm)]).toEqual([
      [1, 2, 3],
      [9, 9],
    ]);
    expect(network.requests.map(({ priority }) => priority)).toEqual([
      "low",
      "low",
    ]);
  });

  it("tries again after a failed download", async () => {
    let fail = true;
    const { caches } = fakeCaches();
    const network = fakeNetwork();
    const loader = createAssetLoader({
      fetch: (url, init) =>
        fail ? Promise.reject(new Error("offline")) : network.fetch(url, init),
      caches,
    });
    await expect(loader.prefetch()).rejects.toThrow("offline");
    fail = false;
    await expect(loader.get()).resolves.toBeDefined();
    await expect(loader.prefetch()).resolves.toBeUndefined();
    expect(network.requests.map(({ priority }) => priority)).toEqual([
      "high",
      "high",
    ]);
  });
});

describe("pruneOldCaches", () => {
  it("drops earlier DocAligner caches and leaves others alone", async () => {
    const { caches, stores } = fakeCaches({
      "docaligner-lcnet100-00000000-ort-1.30.0": {},
      [DOCALIGNER_CACHE_NAME]: {},
      "something-else": {},
    });
    await pruneOldCaches({ fetch: fakeNetwork().fetch, caches });
    expect([...stores.keys()]).toEqual([
      DOCALIGNER_CACHE_NAME,
      "something-else",
    ]);
  });
});

describe("ORT_WEB_VERSION", () => {
  it("matches the installed onnxruntime-web, so a runtime update gets a new cache", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies["onnxruntime-web"]).toBe(ORT_WEB_VERSION);
  });
});
