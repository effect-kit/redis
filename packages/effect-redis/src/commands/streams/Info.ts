import { Effect } from "effect";

import { array } from "#/command/reply/Collections";
import { simpleText } from "#/command/reply/Data";
import { keyed, ordinary } from "#/commands/internal/Command";
import { Argument, NonNegative, parse } from "#/commands/internal/Input";
import type { Integer } from "#/commands/internal/Input";
import { catalog } from "#/commands/streams/Catalog";
import { consumerInfo, groupInfo, streamInfo, streamInfoFull } from "#/commands/streams/reply/Info";
import type { RedisArgument } from "#/RedisArgument";

export const xinfoStream = (key: RedisArgument) =>
  keyed(catalog["XINFO STREAM"], key, Effect.succeed([]), streamInfo);

export const xinfoStreamFull = (key: RedisArgument, count?: Integer) =>
  keyed(
    catalog["XINFO STREAM"],
    key,
    count === undefined
      ? Effect.succeed(["FULL"])
      : parse(NonNegative, count).pipe(Effect.map((n) => ["FULL", "COUNT", String(n)])),
    streamInfoFull,
  );

export const xinfoGroups = (key: RedisArgument) =>
  keyed(catalog["XINFO GROUPS"], key, Effect.succeed([]), array(groupInfo));

export const xinfoConsumers = (key: RedisArgument, group: RedisArgument) =>
  keyed(
    catalog["XINFO CONSUMERS"],
    key,
    parse(Argument, group).pipe(Effect.map((name) => [name])),
    array(consumerInfo),
  );

export const xinfoHelp = () =>
  ordinary(
    catalog["XINFO HELP"],
    array(simpleText),
    Effect.succeed({ tokens: ["XINFO", "HELP"], routing: { _tag: "Keyless" } }),
  );
