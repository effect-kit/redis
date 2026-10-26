import { expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";

import { Commands, PayloadCodec, StreamPayload } from "#/index";
import { bytes } from "#test/support/commands/CoreCase";

const payload = StreamPayload.field(
  "body",
  PayloadCodec.json(Schema.Struct({ name: Schema.String })),
);

it.effect(
  "STREAM-PAYLOAD: explicit Schema envelope encodes one field and preserves raw entry fields",
  () =>
    Effect.gen(function* () {
      const prepared = yield* Commands.xaddPayload("s", "*", payload, { name: "Ada" }).prepare;
      expect(prepared.tokens).toEqual(["XADD", "s", "*", bytes("body"), bytes('{"name":"Ada"}')]);
      const entry = {
        id: "1-0" as const,
        fields: [
          [bytes("metadata"), bytes("v")],
          [bytes("body"), bytes('{"name":"Ada"}')],
        ] as const,
      };
      expect(yield* payload.decode(entry)).toEqual({ name: "Ada" });
      expect(entry.fields).toHaveLength(2);
    }),
);

it.effect(
  "STREAM-PAYLOAD: missing, duplicate, malformed and tombstoned payloads fail explicitly",
  () =>
    Effect.gen(function* () {
      for (const fields of [
        [],
        [[bytes("body"), bytes("bad")]],
        [
          [bytes("body"), bytes("{}")],
          [bytes("body"), bytes("{}")],
        ],
      ] as const) {
        expect(yield* Effect.flip(payload.decode({ id: "1-0", fields }))).toMatchObject({
          _tag: "PayloadError",
          stage: "decode",
        });
      }
      expect(
        yield* Effect.flip(payload.decodeGroup({ id: "1-0", fields: Option.none() })),
      ).toMatchObject({ _tag: "PayloadError" });
    }),
);

it.effect("STREAM-PAYLOAD: prepared flags and codec field names survive caller mutation", () =>
  Effect.gen(function* () {
    const options = { trim: { by: "MAXLEN" as const, threshold: 1 } };
    const mutable = StreamPayload.field("body", {
      encode: () =>
        Effect.sync(() => {
          options.trim.threshold = 2;
          return bytes("v");
        }),
      decode: PayloadCodec.text.decode,
    });
    const prepared = yield* Commands.xaddPayload("s", "*", mutable, "v", options).prepare;
    expect(prepared.tokens).toEqual([
      "XADD",
      "s",
      "MAXLEN",
      "=",
      "1",
      "*",
      bytes("body"),
      bytes("v"),
    ]);
    const encoded = yield* mutable.encode("v");
    encoded[0][0][0] = 0;
    expect((yield* mutable.encode("v"))[0][0]).toEqual(bytes("body"));
  }),
);
