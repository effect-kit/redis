import { Effect } from "effect";

import { keySlot } from "#/cluster/Slot";
import type { PreparedCommand } from "#/command/Command";
import { ClusterError } from "#/errors/ClusterError";
import type { RedisArgument } from "#/RedisArgument";

export const sameSlot = (keys: ReadonlyArray<RedisArgument>) =>
  Effect.suspend(() => {
    const first = keys[0];
    if (first === undefined) return Effect.succeed(undefined);
    const slot = keySlot(first);
    return keys.every((key) => keySlot(key) === slot)
      ? Effect.succeed(slot)
      : Effect.fail(new ClusterError({ delivery: "unsent", reason: "cross-slot" }));
  });

export const commandSlot = Effect.fnUntraced(function* (
  command: PreparedCommand<unknown, unknown, unknown>,
  explicitNode = false,
) {
  const routing = command.routing;
  // These operations alter database scope; key hashing alone cannot establish their semantics.
  if (["MOVE", "SWAPDB"].includes(command.metadata.name))
    return yield* new ClusterError({ delivery: "unsent", reason: "database" });
  if (
    command.metadata.name === "COPY" &&
    command.tokens.some((token, i) => i > 2 && token === "DB")
  )
    return yield* new ClusterError({ delivery: "unsent", reason: "database" });

  if (routing._tag === "Dynamic" && !explicitNode)
    return yield* new ClusterError({ delivery: "unsent", reason: "unresolved-keys" });
  if (routing._tag === "Node") return undefined;
  if (routing._tag === "Keys" || routing._tag === "Dynamic") {
    const keys: RedisArgument[] = [];
    for (const { index } of routing.keys) {
      const key = command.tokens[index];
      if (key === undefined)
        return yield* new ClusterError({ reason: "unresolved-keys", delivery: "unsent" });
      keys.push(key);
    }
    return yield* sameSlot(keys);
  }

  // Shard channels occupy slots but are deliberately not declared keyspace keys.
  if (command.metadata.name === "SPUBLISH") {
    const channel = command.tokens[1];
    if (channel === undefined)
      return yield* new ClusterError({ reason: "unresolved-keys", delivery: "unsent" });
    return keySlot(channel);
  }
  if (!explicitNode && !["PING", "ECHO", "PUBLISH"].includes(command.metadata.name))
    return yield* new ClusterError({ delivery: "unsent", reason: "explicit-target-required" });
  return undefined;
});

export const replicaEligible = (command: PreparedCommand<unknown, unknown, unknown>): boolean =>
  command.metadata.execution === "ordinary" &&
  command.routing._tag === "Keys" &&
  command.routing.keys.every((key) => key.access === "read") &&
  !["scripting", "pubsub"].includes(command.metadata.family);
