import { expect, it } from "@effect/vitest";
import { Effect, Stream } from "effect";

import { decodeUpstashConfig } from "#/upstash/Config";
import { decodeEvents } from "#/upstash/sse/Decode";
import { httpConfig } from "#test/support/upstash/Controlled";

it.effect("Effect SSE framing preserves split UTF8, CRLF, comments, multiline data and IDs", () =>
  Effect.gen(function* () {
    const config = yield* decodeUpstashConfig(httpConfig);
    const bytes = new TextEncoder().encode(
      "\ufeff: heartbeat\r\nid: 4\r\nevent: message\r\ndata: héllo,one\r\ndata: two\r\n\r\n",
    );

    for (const size of [1, 2, 3, 7, bytes.length]) {
      const chunks: Array<Uint8Array> = [];
      for (let offset = 0; offset < bytes.length; offset += size)
        chunks.push(bytes.subarray(offset, offset + size));
      const events = yield* decodeEvents(Stream.fromIterable(chunks), config).pipe(
        Stream.runCollect,
      );

      expect(events).toMatchObject([{ id: "4", event: "message", data: "héllo,one\ntwo" }]);
    }
  }),
);

it.effect("SSE rejects oversized events, invalid or incomplete UTF8 and retry directives", () =>
  Effect.gen(function* () {
    const config = yield* decodeUpstashConfig({ ...httpConfig, maxEventBytes: 32 });
    for (const [bytes, reason] of [
      [new TextEncoder().encode(`data: ${"a".repeat(100)}\n\n`), "limit"],
      [new TextEncoder().encode(`id: ${"a".repeat(100)}\ndata: ok\n\n`), "limit"],
      [new Uint8Array([100, 97, 116, 97, 58, 255]), "encoding"],
      [new Uint8Array([226, 130]), "encoding"],
      [new TextEncoder().encode("retry: 100\n\n"), "gap"],
    ] as const) {
      const error = yield* Effect.flip(
        decodeEvents(Stream.make(bytes), config).pipe(Stream.runCollect),
      );
      expect(error).toMatchObject({ _tag: "UpstashError", stage: "stream", reason });
    }
  }),
);

it.effect(
  "many complete SSE events share a native chunk without consuming one pending-event budget",
  () =>
    Effect.gen(function* () {
      const config = yield* decodeUpstashConfig({ ...httpConfig, maxEventBytes: 32 });
      const chunk = new TextEncoder().encode("data: x\n\n".repeat(1000));
      const events = yield* decodeEvents(Stream.make(chunk), config).pipe(Stream.runCollect);

      expect(events).toHaveLength(1000);
    }),
);
