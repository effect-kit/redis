import { Effect } from "effect";

import { array } from "#/command/reply/Collections";
import { nullable, simpleText, unsigned } from "#/command/reply/Data";
import { fields } from "#/commands/admin/Build";
import { parse, Arguments } from "#/commands/internal/Input";
import { keyedVector } from "#/commands/internal/Vector";
import { moduleKeyed, moduleMetadata } from "#/commands/modules/Build";
import { moduleBoolean as boolean } from "#/commands/modules/Reply";
import { bloomInfoField } from "#/commands/probabilistic/bloom/InfoReply";
import type { RedisArgument } from "#/RedisArgument";

export const bfAdd = (key: RedisArgument, value: RedisArgument) =>
  moduleKeyed("probabilistic", "BF.ADD", key, boolean, Effect.succeed([value]), "read-write");
export const bfExists = (key: RedisArgument, value: RedisArgument) =>
  moduleKeyed("probabilistic", "BF.EXISTS", key, boolean, Effect.succeed([value]));

export const bfMadd = (key: RedisArgument, values: readonly [RedisArgument, ...RedisArgument[]]) =>
  keyedVector(
    moduleMetadata("probabilistic", "BF.MADD"),
    key,
    parse(Arguments, values),
    array(boolean),
    { access: "read-write" },
  );
export const bfMexists = (
  key: RedisArgument,
  values: readonly [RedisArgument, ...RedisArgument[]],
) =>
  keyedVector(
    moduleMetadata("probabilistic", "BF.MEXISTS"),
    key,
    parse(Arguments, values),
    array(boolean),
  );

export const bfInfo = (key: RedisArgument) => moduleKeyed("probabilistic", "BF.INFO", key, fields);

export const bfInfoExpansion = (key: RedisArgument) =>
  moduleKeyed(
    "probabilistic",
    "BF.INFO",
    key,
    bloomInfoField("Expansion rate", nullable(unsigned)),
    Effect.succeed(["EXPANSION"]),
  );

export const bfDebug = (key: RedisArgument) =>
  moduleKeyed("probabilistic", "BF.DEBUG", key, array(simpleText));
