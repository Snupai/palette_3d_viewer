// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  createAdmissionGate,
  limitRequestBody,
  RequestBodyTooLargeError,
} from "./requestGuards";

function multipart(fields: Record<string, string | Blob>): Request {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  return new Request("http://localhost/api/sheet-extraction", {
    method: "POST",
    body: form,
  });
}

describe("limitRequestBody", () => {
  it("rejects a declared Content-Length above the limit before reading", () => {
    const request = new Request("http://localhost/x", {
      method: "POST",
      headers: { "content-length": "2048" },
      body: "ignored",
    });
    expect(() => limitRequestBody(request, 1024)).toThrow(
      RequestBodyTooLargeError,
    );
  });

  it("aborts multipart parsing once the streamed body exceeds the limit", async () => {
    const request = multipart({
      image: new Blob([new Uint8Array(1)], { type: "image/png" }),
      padding: "x".repeat(64 * 1024),
    });
    request.headers.delete("content-length");
    await expect(
      limitRequestBody(request, 16 * 1024).formData(),
    ).rejects.toBeInstanceOf(Error);
  });

  it("cancels a stalled multipart upload at its deadline", async () => {
    let cancelled = false;
    const request = new Request("http://localhost/upload", {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=test" },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("--test\r\n"));
        },
        cancel() {
          cancelled = true;
        },
      }),
      ...({ duplex: "half" } as object),
    });
    await expect(
      limitRequestBody(request, 1024, 10).formData(),
    ).rejects.toMatchObject({ name: "TimeoutError" });
    expect(cancelled).toBe(true);
  });

  it("passes a body within the limit through untouched", async () => {
    const request = multipart({
      image: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
    });
    const form = await limitRequestBody(request, 16 * 1024).formData();
    const image = form.get("image");
    expect(image instanceof File && image.size).toBe(3);
  });
});

describe("createAdmissionGate", () => {
  it("admits up to the limit and rejects the rest until a slot is released", () => {
    const gate = createAdmissionGate(2);
    const first = gate.tryAcquire();
    const second = gate.tryAcquire();
    expect(first && second).toBeTruthy();
    expect(gate.inFlight).toBe(2);
    expect(gate.tryAcquire()).toBeNull();
    first!();
    first!();
    expect(gate.inFlight).toBe(1);
    expect(gate.tryAcquire()).toBeTruthy();
    expect(gate.inFlight).toBe(2);
  });

  it("treats a non-positive limit as a single slot", () => {
    const gate = createAdmissionGate(0);
    expect(gate.tryAcquire()).toBeTruthy();
    expect(gate.tryAcquire()).toBeNull();
  });
});
