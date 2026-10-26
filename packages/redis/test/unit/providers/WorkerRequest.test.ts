import { expect, it } from "vitest";

import { workerInput } from "#test/runners/providers/WorkerRequest";

it("decodes only fixed scenarios and isolated key prefixes", async () => {
  const input = {
    scenario: "data",
    prefix: "effect-kit:providers:00000000-0000-0000-0000-000000000000:worker-data:",
  };
  expect(
    await workerInput(
      new Request("https://worker.example.test/test", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    ),
  ).toEqual(input);
  expect(
    await workerInput(
      new Request("https://worker.example.test/test", {
        method: "POST",
        body: '{"scenario":"arbitrary","prefix":"shared:"}',
      }),
    ),
  ).toBe("invalid");
});

it("cancels an oversized chunked body before consuming its unbounded tail", async () => {
  let cancelled = false;
  let pulls = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls++;
      controller.enqueue(new Uint8Array(600));
    },
    cancel() {
      cancelled = true;
    },
  });
  const request = new Request("https://worker.example.test/test", {
    method: "POST",
    body,
    duplex: "half",
  } as RequestInit);

  expect(await workerInput(request)).toBe("too-large");
  expect(cancelled).toBe(true);
  expect(pulls).toBeLessThanOrEqual(3);
});

it("rejects malformed UTF8 rather than repairing an untrusted request", async () => {
  expect(
    await workerInput(
      new Request("https://worker.example.test/test", {
        method: "POST",
        body: new Uint8Array([255]),
      }),
    ),
  ).toBe("invalid");
});
