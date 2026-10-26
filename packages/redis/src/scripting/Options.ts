import { Effect, Schema } from "effect";

import { parse } from "#/commands/internal/Input";

export interface ScriptOptions {
  readonly maxConcurrentLoads?: number;
  readonly maxSnapshotBytes?: number;
  /** Server scope requires proven affinity to one physical server for every sharing lease. */
  readonly loadScope?: "connection" | "server";
}

const Options = Schema.Struct({
  maxConcurrentLoads: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65536 })).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(64)),
  ),
  maxSnapshotBytes: Schema.Int.check(
    Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  ).pipe(Schema.withDecodingDefaultKey(Effect.succeed(16 * 1024 * 1024))),
  loadScope: Schema.Literals(["connection", "server"]).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed("connection")),
  ),
});

export const decodeScriptOptions = (input: ScriptOptions) => parse(Options, input);
