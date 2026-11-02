/**
 * Downloads of the DocAligner model and the onnxruntime-web WebAssembly
 * binary. Both are kept in the Cache API, so a prefetch after app load and
 * every later camera open share one download; within a page, a prefetch and
 * the camera share the same in-flight request. Runs in the worker; the
 * browser APIs are passed in, so it is tested without a browser.
 */

export const DOCALIGNER_MODEL_URL =
  "/models/docaligner/lcnet100_h_e_bifpn_256_fp32.onnx";
export const ORT_WASM_URL = "/ort/ort-wasm-simd-threaded.jsep.wasm";

/** Keep in step with the `onnxruntime-web` version in package.json (tested). */
export const ORT_WEB_VERSION = "1.31.1";
/** Cache name; changes whenever the model or the runtime changes. */
export const DOCALIGNER_CACHE_NAME = `docaligner-lcnet100-f4117b78-ort-${ORT_WEB_VERSION}`;
const CACHE_PREFIX = "docaligner-";

export type FetchPriority = "low" | "high" | "auto";

export type AssetDeps = {
  fetch: (url: string, init: { priority: FetchPriority }) => Promise<Response>;
  /** `caches`, where available (secure contexts only). */
  caches?: Pick<CacheStorage, "open" | "keys" | "delete">;
};

export type DocAlignerAssets = { model: ArrayBuffer; wasm: ArrayBuffer };

/** Bytes of `url`: from the cache, else downloaded and stored. */
export async function loadAssetBytes(
  url: string,
  priority: FetchPriority,
  deps: AssetDeps,
): Promise<ArrayBuffer> {
  let cache: Cache | null = null;
  try {
    cache = (await deps.caches?.open(DOCALIGNER_CACHE_NAME)) ?? null;
    const hit = await cache?.match(url);
    if (hit?.ok) return await hit.arrayBuffer();
  } catch {
    // Cache unavailable or broken (private mode, quota): use the network.
    cache = null;
  }
  const response = await deps.fetch(url, { priority });
  if (!response.ok) {
    throw new Error(`Download of ${url} failed (${response.status})`);
  }
  if (cache) {
    try {
      await cache.put(url, response.clone());
    } catch {
      // Not cached this time; the download itself still counts.
    }
  }
  return response.arrayBuffer();
}

/** Drops caches of earlier model or runtime versions. */
export async function pruneOldCaches(deps: AssetDeps): Promise<void> {
  if (!deps.caches) return;
  const names = await deps.caches.keys();
  await Promise.all(
    names
      .filter(
        (name) =>
          name.startsWith(CACHE_PREFIX) && name !== DOCALIGNER_CACHE_NAME,
      )
      .map((name) => deps.caches!.delete(name)),
  );
}

/**
 * Makes sure `url` is in the cache without reading it into memory: a cache
 * hit costs nothing, a download streams straight into the cache. Returns
 * `"cached"` then; the downloaded bytes if the cache refused them (quota),
 * so they are not lost; `"no-cache"` where there is no usable cache.
 */
export async function ensureCached(
  url: string,
  priority: FetchPriority,
  deps: AssetDeps,
): Promise<"cached" | "no-cache" | ArrayBuffer> {
  let cache: Cache;
  try {
    if (!deps.caches) return "no-cache";
    cache = await deps.caches.open(DOCALIGNER_CACHE_NAME);
    if (await cache.match(url)) return "cached";
  } catch {
    return "no-cache";
  }
  const response = await deps.fetch(url, { priority });
  if (!response.ok) {
    throw new Error(`Download of ${url} failed (${response.status})`);
  }
  // Second reader for the case that the cache refuses the download.
  const copy = response.clone();
  try {
    await cache.put(url, response);
  } catch {
    return copy.arrayBuffer();
  }
  await copy.body?.cancel().catch(() => undefined);
  return "cached";
}

/**
 * Downloads shared by the background prefetch and the camera, tracked per
 * file, so one failed file never restarts the other.
 *
 * `prefetch` (low priority) only puts model and runtime into the cache, so a
 * page that never opens the camera holds nothing in memory. Without a usable
 * cache it keeps the bytes instead, as the only way to save the camera a
 * download. `get` (camera) waits for each file's prefetch still in flight,
 * then reads it from the cache, downloading at high priority only what is
 * missing or failed. A failed download is forgotten, so the next call tries
 * again.
 */
export function createAssetLoader(deps: AssetDeps) {
  const urls = [DOCALIGNER_MODEL_URL, ORT_WASM_URL] as const;
  /** Per file: null once cached, the bytes where the cache is missing or full. */
  const prefetches = new Map<string, Promise<ArrayBuffer | null>>();
  let loading: Promise<DocAlignerAssets> | null = null;
  const prune = () => {
    pruneOldCaches(deps).catch(() => undefined);
  };
  const prefetchOne = (url: string) => {
    let pending = prefetches.get(url);
    if (!pending) {
      pending = ensureCached(url, "low", deps).then(
        (result) =>
          result === "cached"
            ? null
            : result === "no-cache"
              ? loadAssetBytes(url, "low", deps)
              : result,
        (error: unknown) => {
          prefetches.delete(url);
          throw error;
        },
      );
      prefetches.set(url, pending);
    }
    return pending;
  };
  const getOne = async (url: string) => {
    const kept = await (prefetches.get(url) ?? Promise.resolve(null)).catch(
      () => null,
    );
    return kept ?? loadAssetBytes(url, "high", deps);
  };
  return {
    prefetch: () => Promise.all(urls.map(prefetchOne)).then(prune),
    get: () => {
      loading ??= Promise.all(urls.map(getOne)).then(
        ([model, wasm]) => {
          prune();
          return { model: model!, wasm: wasm! };
        },
        (error: unknown) => {
          loading = null;
          throw error;
        },
      );
      return loading;
    },
  };
}
