import { Effect, Redacted, Schema } from "effect";

import { pairs } from "#/command/reply/Data";
import { blob, status } from "#/command/reply/Scalars";
import { help, nodeCommand, sensitive } from "#/commands/admin/Build";
import { Arguments, Pairs, parse } from "#/commands/internal/Input";
import type { RedisArgument } from "#/RedisArgument";

/** CONFIG can expose credentials; names and values stay binary and redacted by default. */
export const configGet = (patterns: readonly [RedisArgument, ...RedisArgument[]]) =>
  nodeCommand("CONFIG GET", sensitive(pairs(blob, blob)), parse(Arguments, patterns));

export const configSet = (
  entries: Redacted.Redacted<
    readonly [
      readonly [RedisArgument, RedisArgument],
      ...Array<readonly [RedisArgument, RedisArgument]>,
    ]
  >,
) =>
  nodeCommand(
    "CONFIG SET",
    status("OK"),
    parse(Schema.Redacted(Pairs), entries).pipe(
      Effect.map((selected) => Redacted.value(selected).flatMap(([name, value]) => [name, value])),
    ),
  );

export const configHelp = () => nodeCommand("CONFIG HELP", help);
export const configResetStat = () => nodeCommand("CONFIG RESETSTAT", status("OK"));
export const configRewrite = () => nodeCommand("CONFIG REWRITE", status("OK"));
