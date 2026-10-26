import { Effect } from "effect";

import { nullable, unsigned } from "#/command/reply/Data";
import { status } from "#/command/reply/Scalars";
import { fields, help, reportText, nodeCommand } from "#/commands/admin/Build";
import { Argument, nonNegative, parse } from "#/commands/internal/Input";
import type { Integer } from "#/commands/internal/Input";
import type { RedisArgument } from "#/RedisArgument";

export const memoryDoctor = () => nodeCommand("MEMORY DOCTOR", reportText);

export const memoryHelp = () => nodeCommand("MEMORY HELP", help);

export const memoryMallocStats = () => nodeCommand("MEMORY MALLOC-STATS", reportText);

export const memoryPurge = () => nodeCommand("MEMORY PURGE", status("OK"));

export const memoryStats = () => nodeCommand("MEMORY STATS", fields);

export const memoryUsage = (key: RedisArgument, samples?: Integer) =>
  nodeCommand(
    "MEMORY USAGE",
    nullable(unsigned),
    Effect.gen(function* () {
      const selected = yield* parse(Argument, key);
      const tail = samples === undefined ? [] : ["SAMPLES", yield* nonNegative(samples)];

      return [selected, ...tail];
    }),
    { _tag: "Keys", keys: [{ index: 2, access: "read" }] },
  );
