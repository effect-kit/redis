import { Effect } from "effect";

import type { NodeRegistry } from "#/cluster/nodes/Registry";
import type { ClusterRouter } from "#/cluster/routing/Router";
import { makeClusterSessionValidation } from "#/cluster/sessions/Validation";
import { keySlot } from "#/cluster/Slot";
import type { Discovery } from "#/cluster/topology/Discovery";
import { addressIdentity, primaryForSlot } from "#/cluster/topology/Types";
import { checkServerReply } from "#/command/Decode";
import { status } from "#/command/reply/Scalars";
import { Argument, parse } from "#/commands/internal/Input";
import { ClusterError } from "#/errors/ClusterError";
import type { RedisArgument } from "#/RedisArgument";
import type { LeaseMode } from "#/sessions/pool/LeasePool";
import { makeSession } from "#/sessions/Session";
import type { RedisSession } from "#/sessions/Session";

export type ClusterTarget = { readonly key: RedisArgument } | { readonly node: string };

export const makeClusterSessions = (
  registry: NodeRegistry,
  discovery: Discovery,
  router: ClusterRouter,
  database: number,
) => {
  const use = <A, E, R>(
    target: ClusterTarget,
    mode: LeaseMode,
    body: (session: ReturnType<typeof makeSession>) => Effect.Effect<A, E, R>,
  ) =>
    Effect.gen(function* () {
      const topology = yield* discovery.ensure;
      const anchor = "key" in target ? keySlot(yield* parse(Argument, target.key)) : undefined;
      const node =
        "node" in target
          ? topology.shards
              .flatMap((shard) => [shard.primary, ...shard.replicas])
              .find((candidate) => candidate.id === target.node)
          : anchor === undefined
            ? undefined
            : primaryForSlot(topology, anchor)?.primary;
      if (node === undefined || node.role !== "primary")
        return yield* new ClusterError({ reason: "session-route", delivery: "unsent" });

      return yield* registry.use(node.address, mode, (wire) =>
        Effect.gen(function* () {
          yield* wire
            .execute(["READWRITE"])
            .pipe(Effect.flatMap(checkServerReply), Effect.flatMap(status("OK")));
          const session = makeSession(
            wire,
            registry.sessionPolicy,
            makeClusterSessionValidation(discovery, node.id, database, anchor),
          );
          return yield* Effect.suspend(() => body(session)).pipe(
            Effect.onExit(() => session.finish),
          );
        }),
      );
    });

  const withSession = <A, E, R>(
    target: ClusterTarget,
    body: (session: RedisSession) => Effect.Effect<A, E, R>,
  ) => use(target, "session", (session) => body(session.client));
  const withBlockingSession = <A, E, R>(
    target: ClusterTarget,
    body: (session: RedisSession) => Effect.Effect<A, E, R>,
  ) => use(target, "blocking", (session) => body(session.client));

  return { use, withSession, withBlockingSession, router, addressIdentity };
};
