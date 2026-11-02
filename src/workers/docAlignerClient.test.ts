import { describe, expect, it } from "vitest";
import { DocAlignerClient } from "~/workers/docAlignerClient";
import type {
  DocAlignerRequest,
  DocAlignerResponse,
} from "~/workers/docAlignerProtocol";

/** Worker stand-in that records requests and can answer. */
function fakeWorker() {
  const sent: DocAlignerRequest["type"][] = [];
  const worker = {
    onmessage: null as
      | ((event: MessageEvent<DocAlignerResponse>) => void)
      | null,
    onerror: null as (() => void) | null,
    terminated: false,
    postMessage: (request: DocAlignerRequest) => sent.push(request.type),
    terminate() {
      worker.terminated = true;
    },
    reply: (response: DocAlignerResponse) =>
      worker.onmessage?.({
        data: response,
      } as MessageEvent<DocAlignerResponse>),
  };
  return { worker, sent };
}

const start = () => {
  const fake = fakeWorker();
  const client = new DocAlignerClient(() => fake.worker as unknown as Worker);
  return { client, ...fake };
};

describe("DocAlignerClient", () => {
  it("only downloads on prefetch, and the camera reuses that worker", () => {
    const { client, sent } = start();
    client.prefetch();
    client.prefetch();
    expect([client.status, sent]).toEqual(["idle", ["prefetch"]]);
    client.load();
    client.load();
    expect([client.status, sent]).toEqual(["loading", ["prefetch", "load"]]);
    client.prefetch();
    expect(sent).toEqual(["prefetch", "load"]);
  });

  it("is ready with its start-up timings once the worker has loaded", () => {
    const { client, worker } = start();
    client.load();
    worker.reply({
      type: "loaded",
      backend: "webgpu",
      downloadMs: 0,
      sessionMs: 400,
      warmupMs: 30,
    });
    expect([client.status, client.backend, client.loadTimings]).toEqual([
      "ready",
      "webgpu",
      { downloadMs: 0, sessionMs: 400, warmupMs: 30 },
    ]);
  });

  it("gives up and stops the worker when loading fails", () => {
    const { client, worker } = start();
    client.load();
    worker.reply({ type: "loadFailed", message: "offline" });
    expect([client.status, worker.terminated]).toEqual(["failed", true]);
  });
});
