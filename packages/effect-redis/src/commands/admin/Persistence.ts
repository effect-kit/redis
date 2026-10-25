import { Effect, Schema } from "effect";

import { array } from "#/command/reply/Collections";
import { tuple, unsigned } from "#/command/reply/Data";
import { status } from "#/command/reply/Scalars";
import { lossless, nodeCommand, reportText } from "#/commands/admin/Build";
import { Argument, NonNegative, parse } from "#/commands/internal/Input";
import type { Integer } from "#/commands/internal/Input";
import { ScriptFlushMode } from "#/commands/scripting/Script";

export const dbsize = () => nodeCommand("DBSIZE", unsigned);
export const lastSave = () => nodeCommand("LASTSAVE", unsigned);
export const time = () => nodeCommand("TIME", tuple(unsigned, unsigned));
export const role = () => nodeCommand("ROLE", array(lossless));
export const save = () => nodeCommand("SAVE", status("OK"));
export const bgrewriteaof = () => nodeCommand("BGREWRITEAOF", reportText);
export const bgsave = (schedule = false) =>
  nodeCommand(
    "BGSAVE",
    reportText,
    parse(Schema.Boolean, schedule).pipe(Effect.map((selected) => (selected ? ["SCHEDULE"] : []))),
  );

const flush = (name: "FLUSHDB" | "FLUSHALL", mode?: ScriptFlushMode) =>
  nodeCommand(
    name,
    status("OK"),
    parse(Schema.optional(ScriptFlushMode), mode).pipe(
      Effect.map((selected) => (selected === undefined ? [] : [selected])),
    ),
  );
export const flushDb = (mode?: ScriptFlushMode) => flush("FLUSHDB", mode);
export const flushAll = (mode?: ScriptFlushMode) => flush("FLUSHALL", mode);

export const swapDb = (first: Integer, second: Integer) =>
  nodeCommand(
    "SWAPDB",
    status("OK"),
    parse(Schema.Tuple([NonNegative, NonNegative]), [first, second]).pipe(
      Effect.map((values) => values.map(String)),
    ),
  );

const Port = NonNegative.check(Schema.makeFilter((port) => port > 0 && port <= 65535));
const Replica = Schema.Union([
  Schema.Struct({ host: Argument, port: Port }),
  Schema.Literal("NO ONE"),
]);
export type ReplicaTarget = typeof Replica.Type;

export const replicaOf = (target: ReplicaTarget) =>
  nodeCommand(
    "REPLICAOF",
    reportText,
    parse(Replica, target).pipe(
      Effect.map((selected) =>
        selected === "NO ONE" ? ["NO", "ONE"] : [selected.host, String(selected.port)],
      ),
    ),
  );

/** The historical alias stays explicit for deployments which expose only that name. */
export const slaveOf = (target: ReplicaTarget) =>
  nodeCommand(
    "SLAVEOF",
    reportText,
    parse(Replica, target).pipe(
      Effect.map((selected) =>
        selected === "NO ONE" ? ["NO", "ONE"] : [selected.host, String(selected.port)],
      ),
    ),
  );

const Failover = Schema.Union([
  Schema.Struct({ abort: Schema.Literal(true) }),
  Schema.Struct({
    to: Schema.optionalKey(
      Schema.Struct({ host: Argument, port: Port, force: Schema.optionalKey(Schema.Boolean) }),
    ),
    timeoutMillis: Schema.optionalKey(NonNegative),
  }),
]);
export type FailoverOptions = typeof Failover.Type;

export const failover = (options: FailoverOptions = {}) =>
  nodeCommand(
    "FAILOVER",
    status("OK"),
    parse(Failover, options).pipe(
      Effect.map((selected) =>
        "abort" in selected
          ? ["ABORT"]
          : [
              ...(selected.to === undefined
                ? []
                : [
                    "TO",
                    selected.to.host,
                    String(selected.to.port),
                    ...(selected.to.force ? ["FORCE"] : []),
                  ]),
              ...(selected.timeoutMillis === undefined
                ? []
                : ["TIMEOUT", String(selected.timeoutMillis)]),
            ],
      ),
    ),
  );

const LolwutOptions = Schema.Struct({
  version: Schema.optionalKey(NonNegative),
  args: Schema.optionalKey(Schema.Array(NonNegative)),
});
export type LolwutOptions = typeof LolwutOptions.Type;

export const lolwut = (options: LolwutOptions = {}) =>
  nodeCommand(
    "LOLWUT",
    reportText,
    Effect.gen(function* () {
      const selected = yield* parse(LolwutOptions, options);

      return [
        ...(selected.version === undefined ? [] : ["VERSION", String(selected.version)]),
        ...(selected.args ?? []).map(String),
      ];
    }),
  );
