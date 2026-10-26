import { Effect, Option } from "effect";

import type { Client } from "#test/runners/conformance/Client";
import { core } from "#test/runners/conformance/Runtime";

const bytes = (value: string) => new TextEncoder().encode(value);

export const lists = Effect.fnUntraced(function* ({ redis, prefix, check, wrongType }: Client) {
  const C = core.Commands;
  const source = `${prefix}:list`;
  const destination = `${source}:destination`;

  yield* check("lists.missing", C.lpop(source), Option.none());
  yield* check("lists.missing-count", C.lpopCount(source, 2), Option.none());
  yield* check("lists.pushx", C.lpushx(source, ["missing"]), 0n);
  yield* check("lists.rpushx", C.rpushx(source, ["missing"]), 0n);
  yield* check("lists.rpush", C.rpush(source, ["a", "b", "a"]), 3n);
  yield* check("lists.lpush", C.lpush(source, ["zero"]), 4n);
  yield* check("lists.length", C.llen(source), 4n);
  yield* check("lists.index", C.lindex(source, -1), Option.some(bytes("a")));
  yield* check("lists.position", C.lpos(source, "a"), Option.some(1n));
  yield* check("lists.positions", C.lposCount(source, "a", 0), [1n, 3n]);
  yield* check("lists.insert", C.linsert(source, "AFTER", "b", "c"), 5n);
  yield* check("lists.set", C.lset(source, 0, "start"), undefined);
  yield* check("lists.remove", C.lrem(source, -1, "a"), 1n);
  yield* check("lists.trim", C.ltrim(source, 0, 2), undefined);
  yield* check("lists.range", C.lrange(source, 0, -1), [bytes("start"), bytes("a"), bytes("b")]);
  yield* check(
    "lists.move",
    C.lmove(source, destination, "RIGHT", "LEFT"),
    Option.some(bytes("b")),
  );
  yield* check("lists.rotate", C.rpoplpush(destination, source), Option.some(bytes("b")));
  yield* check(
    "lists.pop-count",
    C.lpopCount(source, 2),
    Option.some([bytes("b"), bytes("start")]),
  );
  yield* check("lists.rpop", C.rpop(source), Option.some(bytes("a")));

  yield* redis.rpush(source, ["x", "y"]);
  yield* check("lists.rpop-count", C.rpopCount(source, 2), Option.some([bytes("y"), bytes("x")]));
  yield* redis.rpush(source, ["a", "b"]);
  yield* check(
    "lists.mpop",
    C.lmpop([`${source}:missing`, source], "LEFT", 2),
    Option.some([bytes(source), [bytes("a"), bytes("b")]]),
  );

  const multi = `${source}:multi`;
  yield* redis.rpush(multi, ["first", "second"]);
  yield* check(
    "lists.movem",
    C.lmovem(multi, destination, "LEFT", "RIGHT", {
      selection: "COUNT",
      count: 2,
      ordering: "BULK",
    }),
    Option.some([bytes("first"), bytes("second")]),
  );

  yield* redis.set(`${source}:wrong`, "string");
  yield* wrongType("lists.wrong-type", C.llen(`${source}:wrong`));
});
