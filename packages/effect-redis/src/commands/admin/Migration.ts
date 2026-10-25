import { Effect, Redacted, Schema } from "effect";

import { fromPreparation } from "#/command/Command";
import type { ReplyDecoder } from "#/command/Command";
import { simpleText } from "#/command/reply/Data";
import { mismatch } from "#/command/reply/Scalars";
import { nodeCommand } from "#/commands/admin/Build";
import { keyIndexes } from "#/commands/internal/Command";
import { Argument, Arguments, NonNegative, Positive, parse } from "#/commands/internal/Input";
import type { RedisArgument } from "#/RedisArgument";

const Auth = Schema.Union([
  Schema.Struct({ password: Schema.Redacted(Argument) }),
  Schema.Struct({ username: Argument, password: Schema.Redacted(Argument) }),
]);
const Options = Schema.Struct({
  host: Argument,
  port: Positive.check(Schema.makeFilter((port) => port <= 65535)),
  database: NonNegative,
  timeoutMillis: Positive,
  copy: Schema.optionalKey(Schema.Boolean),
  replace: Schema.optionalKey(Schema.Boolean),
  auth: Schema.optionalKey(Auth),
});
export type MigrateOptions = typeof Options.Type;

const migrateReply: ReplyDecoder<"OK" | "NOKEY"> = (reply) =>
  simpleText(reply).pipe(
    Effect.flatMap((value) =>
      value === "OK" || value === "NOKEY"
        ? Effect.succeed(value)
        : Effect.fail(mismatch("status", reply)),
    ),
  );

/** Errors may follow a partial transfer. No retry, deletion or rollback is inferred. */
export const migrate = (
  keys: readonly [RedisArgument, ...RedisArgument[]],
  options: MigrateOptions,
) =>
  fromPreparation(
    Effect.gen(function* () {
      const selected = yield* parse(Options, options);
      const values = yield* parse(Arguments, keys);
      const authentication =
        selected.auth === undefined
          ? []
          : "username" in selected.auth
            ? ["AUTH2", selected.auth.username, Redacted.value(selected.auth.password)]
            : ["AUTH", Redacted.value(selected.auth.password)];
      const base = [
        selected.host,
        String(selected.port),
        "",
        String(selected.database),
        String(selected.timeoutMillis),
        ...(selected.copy ? ["COPY"] : []),
        ...(selected.replace ? ["REPLACE"] : []),
        ...authentication,
        "KEYS",
      ];
      const command = yield* nodeCommand(
        "MIGRATE",
        migrateReply,
        Effect.succeed([...base, ...values]),
        keyIndexes(
          values.map((_, index) => base.length + index + 1),
          "read-write",
        ),
      ).prepare;

      return command;
    }),
  );
