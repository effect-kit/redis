import { Effect, Fiber } from "effect";

import type * as Physical from "#/transport/bun/Connection";
import { core, native, ensure, equalBytes } from "#test/runners/bun/Runtime";
import type { RuntimeInput } from "#test/support/runtime/bun/Input";

export const transport = Effect.fnUntraced(function* (
  input: Extract<RuntimeInput, { scenario: "transport" }>,
) {
  const config = yield* core.decodeRedisConfig(input.config);
  const checks: Array<string> = [];

  if (input.operation === "late-open") {
    const { makePhysical } = (yield* Effect.promise(
      () => import(new URL("../../../dist/transport/bun/Connection.js", import.meta.url).href),
    )) as typeof Physical;
    const endpoint = config.endpoint;
    ensure(endpoint._tag === "Tcp", "Late acquisition fixture requires TCP");
    const physical = yield* Effect.acquireRelease(
      Effect.sync(() => {
        const acquiring = makePhysical(65536, 65536, false);
        acquiring.start(
          () =>
            new Promise<Bun.Socket>((resolve, reject) => {
              // Delay only acquisition initiation; the eventual socket and callbacks are native Bun.
              setTimeout(() => {
                Bun.connect({
                  hostname: endpoint.host,
                  port: endpoint.port,
                  socket: acquiring.handlers,
                }).then(resolve, reject);
              }, 50);
            }),
        );
        return acquiring;
      }),
      (owned) => owned.close,
    );

    yield* physical.close;
    ensure(
      (yield* Effect.flip(physical.ready)).reason === "closed",
      "Late socket became ready after scope closure",
    );
    return ["late-open-terminated", "joined-acquisition"];
  }

  if (input.operation === "open-error") {
    const failure = yield* Effect.flip(Effect.scoped(native.connect(config)));
    ensure(
      failure._tag === "TransportError" && failure.stage === "open",
      "Expected acquisition failure",
    );
    return ["open-failure"];
  }

  if (input.operation === "open-cancel") {
    const opening = yield* Effect.scoped(native.connect(config)).pipe(Effect.forkChild);
    yield* Effect.sleep(30);
    yield* Fiber.interrupt(opening);
    return ["canceled-acquisition"];
  }

  if (input.operation === "churn") {
    yield* Effect.forEach(
      Array.from({ length: 64 }),
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const connection = yield* native.connect(config);
            yield* connection.write(new Uint8Array([1]));
            ensure(
              equalBytes(yield* connection.read, new Uint8Array([1])),
              "Churn exchange changed bytes",
            );
          }),
        ),
      { concurrency: 8 },
    );
    return ["64-scoped-connections", "concurrency-8"];
  }

  const connection = yield* native.connect(config);
  const payload = new Uint8Array(input.size ?? 65536);
  for (let index = 0; index < payload.length; index++) payload[index] = index % 251;

  if (input.operation === "echo") {
    yield* connection.write(payload);
    let offset = 0;
    while (offset < payload.length) {
      const chunk = yield* connection.read;
      ensure(chunk !== undefined && chunk.length <= 65536, "Invalid owned read chunk");
      ensure(
        equalBytes(chunk, payload.subarray(offset, offset + chunk.length)),
        "Binary echo changed bytes",
      );
      offset += chunk.length;
    }
    checks.push("binary-echo", "bounded-read-chunks");
  } else if (input.operation === "read") {
    let received = 0;
    while (true) {
      const chunk = yield* connection.read;
      if (chunk === undefined) break;
      ensure(chunk.length <= 65536, "Oversized read chunk");
      ensure(
        chunk.every((byte) => byte === 17),
        "Read bytes changed",
      );
      received += chunk.length;
    }
    ensure(received === payload.length, "Clean EOF discarded bytes");
    checks.push("owned-bytes", "drain-before-eof");
  } else if (input.operation === "write") {
    yield* connection.write(payload);
    ensure(
      equalBytes(yield* connection.read, new Uint8Array([1])),
      "Missing peer write acknowledgment",
    );
    checks.push("backpressured-write");
  } else if (input.operation === "cancel-read") {
    const reading = yield* connection.read.pipe(Effect.forkChild);
    yield* Effect.sleep(20);
    yield* Fiber.interrupt(reading);
    yield* connection.write(new Uint8Array([1]));
    ensure(
      equalBytes(yield* connection.read, new Uint8Array([1])),
      "Canceled read retained its waiter",
    );
    checks.push("canceled-read", "next-reader-ownership");
  } else {
    const writing = yield* connection.write(payload).pipe(Effect.forkChild);
    yield* Effect.sleep(20);
    yield* Fiber.interrupt(writing);
    const failure = yield* Effect.flip(connection.write(new Uint8Array([1])));
    ensure(failure.reason === "closed", "Canceled active write did not retire socket");
    checks.push("canceled-write", "retired-physical-socket");
  }

  yield* connection.close;
  yield* connection.close;
  return checks;
});
