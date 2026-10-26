import { Effect, Schema } from "effect";

import { array } from "#/command/reply/Collections";
import { boolean, simpleText, unsigned } from "#/command/reply/Data";
import { status } from "#/command/reply/Scalars";
import { keyed, ordinary } from "#/commands/internal/Command";
import { Argument, parse, Integer } from "#/commands/internal/Input";
import { catalog } from "#/commands/streams/Catalog";
import { StreamPosition } from "#/commands/streams/Id";
import type { RedisArgument } from "#/RedisArgument";

const GroupId = Schema.Union([StreamPosition, Schema.Literal("$")]);
export type GroupStart = typeof GroupId.Type;
const Options = Schema.Struct({
  mkstream: Schema.optionalKey(Schema.Boolean),
  entriesRead: Schema.optionalKey(Integer.check(Schema.makeFilter((n) => n >= -1))),
});
export type GroupCreateOptions = typeof Options.Type;
export type GroupSetIdOptions = Omit<GroupCreateOptions, "mkstream">;

export const xgroupCreate = (
  key: RedisArgument,
  group: RedisArgument,
  id: GroupStart,
  options: GroupCreateOptions = {},
) =>
  keyed(
    catalog["XGROUP CREATE"],
    key,
    Effect.gen(function* () {
      const selected = yield* parse(Options, options);
      return [
        yield* parse(Argument, group),
        yield* parse(GroupId, id),
        ...(selected.mkstream ? ["MKSTREAM"] : []),
        ...(selected.entriesRead === undefined
          ? []
          : ["ENTRIESREAD", String(selected.entriesRead)]),
      ];
    }),
    status("OK"),
    "read-write",
  );

export const xgroupSetid = (
  key: RedisArgument,
  group: RedisArgument,
  id: GroupStart,
  options: GroupSetIdOptions = {},
) =>
  keyed(
    catalog["XGROUP SETID"],
    key,
    Effect.gen(function* () {
      const selected = yield* parse(
        Schema.Struct({ entriesRead: Options.fields.entriesRead }),
        options,
      );
      return [
        yield* parse(Argument, group),
        yield* parse(GroupId, id),
        ...(selected.entriesRead === undefined
          ? []
          : ["ENTRIESREAD", String(selected.entriesRead)]),
      ];
    }),
    status("OK"),
    "read-write",
  );

export const xgroupDestroy = (key: RedisArgument, group: RedisArgument) =>
  keyed(
    catalog["XGROUP DESTROY"],
    key,
    parse(Argument, group).pipe(Effect.map((token) => [token])),
    boolean,
    "read-write",
  );

export const xgroupCreateconsumer = (
  key: RedisArgument,
  group: RedisArgument,
  consumer: RedisArgument,
) =>
  keyed(
    catalog["XGROUP CREATECONSUMER"],
    key,
    Effect.all([parse(Argument, group), parse(Argument, consumer)]),
    boolean,
    "read-write",
  );

export const xgroupDelconsumer = (
  key: RedisArgument,
  group: RedisArgument,
  consumer: RedisArgument,
) =>
  keyed(
    catalog["XGROUP DELCONSUMER"],
    key,
    Effect.all([parse(Argument, group), parse(Argument, consumer)]),
    unsigned,
    "read-write",
  );

export const xgroupHelp = () =>
  ordinary(
    catalog["XGROUP HELP"],
    array(simpleText),
    Effect.succeed({ tokens: ["XGROUP", "HELP"], routing: { _tag: "Keyless" } }),
  );
