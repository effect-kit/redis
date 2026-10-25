import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { eventFrame } from "#/subscriptions/Frames";
import { array, blob, integer, missing } from "#test/support/commands/CoreCase";

it.effect.each([
  "subscribe",
  "unsubscribe",
  "psubscribe",
  "punsubscribe",
  "ssubscribe",
  "sunsubscribe",
])("PUSH: %s acknowledges a binary target without claiming a command slot", (kind) =>
  Effect.gen(function* () {
    const reply = array(blob(kind), blob("channel"), integer(2n));
    expect(yield* eventFrame(reply)).toMatchObject({ _tag: "Acknowledgment", kind, count: 2n });
    expect(
      yield* eventFrame({ _tag: "Push", values: [blob(kind), blob("channel"), integer(2n)] }),
    ).toMatchObject({
      _tag: "Acknowledgment",
      kind,
    });
  }),
);

it.effect("PUSH: channel, pattern and shard message variants retain their identities", () =>
  Effect.gen(function* () {
    expect(yield* eventFrame(array(blob("message"), blob("c"), blob("v")))).toMatchObject({
      _tag: "Message",
    });
    expect(
      yield* eventFrame(array(blob("pmessage"), blob("c*"), blob("c"), blob("v"))),
    ).toMatchObject({ _tag: "PatternMessage" });
    expect(yield* eventFrame(array(blob("smessage"), blob("c"), blob("v")))).toMatchObject({
      _tag: "ShardMessage",
    });
    expect(yield* Effect.flip(eventFrame(array(blob("message"), blob("c"))))).toMatchObject({
      _tag: "ReplyError",
    });
  }),
);

it.effect("TRACK: key invalidations differ from flush and ordinary Pub/Sub payloads", () =>
  Effect.gen(function* () {
    expect(
      yield* eventFrame({ _tag: "Push", values: [blob("invalidate"), array(blob("k"))] }),
    ).toMatchObject({ _tag: "Invalidate", keys: [new TextEncoder().encode("k")] });
    expect(
      yield* eventFrame(array(blob("message"), blob("__redis__:invalidate"), missing)),
    ).toMatchObject({ _tag: "Invalidate", keys: null });
    expect(
      yield* eventFrame(array(blob("message"), blob("__redis__:invalidate"), blob("ordinary"))),
    ).toMatchObject({ _tag: "Message" });
  }),
);

it.effect("PUSH: unknown RESP3 pushes remain lossless and ordinary arrays remain replies", () =>
  Effect.gen(function* () {
    const unknown = { _tag: "Push", values: [blob("future"), integer(9n)] } as const;

    expect(yield* eventFrame(unknown)).toEqual({ _tag: "UnknownPush", value: unknown });
    expect(yield* eventFrame(array(blob("future"), integer(9n)))).toBeUndefined();
  }),
);
