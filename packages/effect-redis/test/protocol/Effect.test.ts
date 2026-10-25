import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { decodeRedisConfig, encodeCommand, makeRespDecoder } from "#/index";
import { bytes } from "#test/support/protocol/Decode";

it.effect("WIRE-09: validated configuration and codec Results compose into Effect", () =>
  Effect.gen(function* () {
    const config = yield* decodeRedisConfig({
      endpoint: { host: "localhost" },
      limits: { maxQueuedBytes: 1024 },
    });
    const frame = yield* Effect.fromResult(
      encodeCommand(["ECHO", new Uint8Array([255, 0])], config.limits),
    );
    const decoder = yield* Effect.fromResult(makeRespDecoder(config.limits));
    yield* Effect.fromResult(decoder.feed(frame));
    expect(yield* Effect.fromResult(decoder.next())).toEqual({
      _tag: "Array",
      values: [
        { _tag: "BlobString", value: bytes("ECHO") },
        { _tag: "BlobString", value: new Uint8Array([255, 0]) },
      ],
    });
  }),
);

it.effect("LIMIT-14: protocol errors remain recoverable through Effect.catchTag", () =>
  Effect.gen(function* () {
    const decoder = yield* Effect.fromResult(makeRespDecoder());
    yield* Effect.fromResult(decoder.feed(bytes(":bad\r\n")));
    const kind = yield* Effect.fromResult(decoder.next()).pipe(
      Effect.catchTag("ProtocolError", (error) => Effect.succeed(error.kind)),
    );
    expect(kind).toBe("InvalidNumber");
  }),
);
