import assert from "node:assert/strict";

import { Duration, Effect, Fiber, Option } from "effect";

import type { Client } from "#test/runners/conformance/Client";
import { core } from "#test/runners/conformance/Runtime";

const bytes = (value: string) => new TextEncoder().encode(value);

export const blocking = Effect.fnUntraced(function* ({
  sessions,
  redis,
  prefix,
  check,
  record,
}: Client) {
  const C = core.Commands;
  const source = `${prefix}:blocking`;
  const destination = `${source}:destination`;
  const options = { blockFor: Duration.millis(25) };
  const binary = new Uint8Array([0, 255]);

  yield* check("blocking.timeout", C.blpop([source], options), Option.none());
  yield* redis.rpush(source, [binary, "b"]);
  yield* check("blocking.pop", C.blpop([source], options), Option.some([bytes(source), binary]));
  yield* check(
    "blocking.rpop",
    C.brpop([source], options),
    Option.some([bytes(source), bytes("b")]),
  );
  yield* redis.rpush(source, ["c"]);
  yield* check(
    "blocking.rotate",
    C.brpoplpush(source, destination, options),
    Option.some(bytes("c")),
  );
  // Use independent setup so an unavailable predecessor cannot make a supported pop block forever.
  yield* redis.rpush(`${source}:move`, ["d"]);
  yield* check(
    "blocking.move",
    C.blmove(`${source}:move`, destination, "LEFT", "RIGHT", options),
    Option.some(bytes("d")),
  );
  yield* redis.rpush(`${source}:multi`, ["e"]);
  yield* check(
    "blocking.mpop",
    C.blmpop([`${source}:multi`], "LEFT", options, 2),
    Option.some([bytes(`${source}:multi`), [bytes("e")]]),
  );
  yield* redis.rpush(`${source}:movem`, ["x", "y"]);
  yield* check(
    "blocking.movem",
    C.blmovem(`${source}:movem`, destination, "LEFT", "RIGHT", options, {
      selection: "EXACTLY",
      count: 2,
      ordering: "BULK",
    }),
    Option.some([bytes("x"), bytes("y")]),
  );

  const sorted = `${source}:sorted`;
  yield* redis.zadd(sorted, [
    [1, binary],
    [2, "b"],
  ]);
  yield* check(
    "blocking.zpopmin",
    C.bzpopmin([sorted], options),
    Option.some([bytes(sorted), binary, "1"]),
  );
  yield* check(
    "blocking.zpopmax",
    C.bzpopmax([sorted], options),
    Option.some([bytes(sorted), bytes("b"), "2"]),
  );
  yield* redis.zadd(sorted, [[1, "a"]]);
  yield* check(
    "blocking.zmpop",
    C.bzmpop([sorted], "MAX", options, 2),
    Option.some([bytes(sorted), [[bytes("a"), "1"]]]),
  );

  const waiting = `${source}:waiting`;
  const blocked = yield* Effect.forkChild(sessions.blpop([waiting], { blockFor: "forever" }));
  yield* redis.ping();
  yield* redis.rpush(waiting, [binary]);
  assert.deepEqual(yield* Fiber.join(blocked), Option.some([bytes(waiting), binary]));
  assert.equal((yield* sessions.snapshot).leased, 0);
  record("blocking.ordinary-progress-lease-release", "BLPOP");
});
