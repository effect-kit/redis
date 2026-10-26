import { Effect } from "effect";

import type { RedisExecutor } from "#/command/Executor";
import { unsigned } from "#/command/reply/Data";
import { status } from "#/command/reply/Scalars";
import { ordinary } from "#/commands/internal/Command";
import { Argument, Arguments, parse } from "#/commands/internal/Input";
import { metadata } from "#/commands/Metadata";
import type { RedisArgument } from "#/RedisArgument";

const info = (name: string) => ({
  ...metadata(`HIMPORT ${name}`, "hashes", ["HASH-IMPORT"], ["Redis since 8.10.0"]),
  execution: "exclusive" as const,
});

/** Fieldsets belong to the physical client; PREPARE and SET must share an exclusive lease. */
export const himportPrepare = (
  name: RedisArgument,
  fields: readonly [RedisArgument, ...RedisArgument[]],
) =>
  ordinary(
    info("PREPARE"),
    status("OK"),
    Effect.gen(function* () {
      const fieldset = yield* parse(Argument, name);
      const selected = yield* parse(Arguments, fields);

      return {
        tokens: ["HIMPORT", "PREPARE", fieldset, ...selected] as const,
        routing: { _tag: "Keyless" } as const,
      };
    }),
  );

export const himportSet = (
  key: RedisArgument,
  name: RedisArgument,
  values: readonly [RedisArgument, ...RedisArgument[]],
) =>
  ordinary(
    info("SET"),
    status("OK"),
    Effect.gen(function* () {
      const selectedKey = yield* parse(Argument, key);
      const fieldset = yield* parse(Argument, name);
      const selectedValues = yield* parse(Arguments, values);

      return {
        tokens: ["HIMPORT", "SET", selectedKey, fieldset, ...selectedValues] as const,
        routing: { _tag: "Keys", keys: [{ index: 2, access: "read-write" }] } as const,
      };
    }),
  );

export const himportDiscard = (name: RedisArgument) =>
  ordinary(
    info("DISCARD"),
    unsigned,
    parse(Argument, name).pipe(
      Effect.map((fieldset) => ({
        tokens: ["HIMPORT", "DISCARD", fieldset] as const,
        routing: { _tag: "Keyless" } as const,
      })),
    ),
  );

export const himportDiscardAll = () =>
  ordinary(
    info("DISCARDALL"),
    unsigned,
    Effect.succeed({ tokens: ["HIMPORT", "DISCARDALL"], routing: { _tag: "Keyless" } }),
  );

export const hashImportFamily = (executor: RedisExecutor) => ({
  himportPrepare: (...args: Parameters<typeof himportPrepare>) =>
    executor.execute(himportPrepare(...args)),
  himportSet: (...args: Parameters<typeof himportSet>) => executor.execute(himportSet(...args)),
  himportDiscard: (...args: Parameters<typeof himportDiscard>) =>
    executor.execute(himportDiscard(...args)),
  himportDiscardAll: () => executor.execute(himportDiscardAll()),
});
