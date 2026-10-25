import { Effect } from "effect";

import type { NodeRegistry } from "#/cluster/nodes/Registry";
import type { ClusterPolicy } from "#/cluster/Options";
import { makeClusterAdmission } from "#/cluster/routing/Admission";
import { redirect } from "#/cluster/routing/Redirect";
import { commandSlot, replicaEligible } from "#/cluster/routing/Route";
import type { Discovery } from "#/cluster/topology/Discovery";
import { addressIdentity, primaryForSlot } from "#/cluster/topology/Types";
import type { ClusterAddress } from "#/cluster/topology/Types";
import type { PreparedCommand } from "#/command/Command";
import { decodeReply, checkServerReply } from "#/command/Decode";
import type { RedisExecutor } from "#/command/Executor";
import type { RedisError } from "#/command/Executor";
import { status, undecorate } from "#/command/reply/Scalars";
import { checkOrdinary } from "#/connection/OrdinaryCommand";
import { ClusterError } from "#/errors/ClusterError";
import { UnsupportedCommandError } from "#/errors/UnsupportedCommandError";
import type { RespValue } from "#/protocol/RespValue";
import type { RedisConfig } from "#/RedisConfig";
import { checkAdvanced, isBlocking } from "#/sessions/controls/Guard";
import type { SessionWire } from "#/sessions/pool/Wire";

export type ClusterExchange = (
  wire: SessionWire,
  command: PreparedCommand<unknown, unknown, unknown>,
  target: { readonly address: ClusterAddress; readonly asking: boolean },
) => Effect.Effect<RespValue, RedisError>;

export const makeClusterRouter = (
  config: RedisConfig,
  registry: NodeRegistry,
  discovery: Discovery,
  policy: ClusterPolicy,
) => {
  const admission = makeClusterAdmission(
    config,
    policy.maxOperations,
    policy.maxRetainedBytes,
    policy.operationTimeoutMillis,
  );
  const moved = new Map<number, ClusterAddress>();
  let revision = 0;

  const route = Effect.fnUntraced(function* (
    command: PreparedCommand<unknown, unknown, unknown>,
    nodeId?: string,
    primaryOnly = false,
  ) {
    const topology = yield* discovery.ensure;
    if (revision !== topology.revision) {
      moved.clear();
      revision = topology.revision;
    }
    const targetId = nodeId ?? (command.routing._tag === "Node" ? command.routing.node : undefined);
    if (nodeId !== undefined && command.routing._tag === "Node" && command.routing.node !== nodeId)
      return yield* new ClusterError({ reason: "session-route", delivery: "unsent" });
    const slot = yield* commandSlot(command, targetId !== undefined);

    if (targetId !== undefined) {
      const target = topology.shards
        .flatMap((shard) => [shard.primary, ...shard.replicas])
        .find((node) => node.id === targetId);
      if (target === undefined)
        return yield* new ClusterError({ reason: "node-unavailable", delivery: "unsent" });
      return { address: target.address, slot, replica: target.role === "replica", explicit: true };
    }

    const shard = slot === undefined ? topology.shards[0] : primaryForSlot(topology, slot);
    if (shard === undefined)
      return yield* new ClusterError({ reason: "node-unavailable", delivery: "unsent" });
    const redirectedAddress = slot === undefined ? undefined : moved.get(slot);
    if (redirectedAddress !== undefined)
      return { address: redirectedAddress, slot, replica: false, explicit: false };
    const replica =
      !primaryOnly && policy.readPreference === "replica-preferred" && replicaEligible(command)
        ? shard.replicas[0]
        : undefined;
    return {
      address: (replica ?? shard.primary).address,
      slot,
      replica: replica !== undefined,
      explicit: false,
    };
  });

  const reply = <A, E, R>(
    input: PreparedCommand<A, E, R>,
    nodeId?: string,
    blocking = false,
    exchange?: ClusterExchange,
  ) =>
    admission.run(input, (command, writing) =>
      Effect.gen(function* () {
        const mode = command.metadata.execution;
        const explicit = nodeId !== undefined || command.routing._tag === "Node";
        if (
          blocking
            ? mode !== "blocking" || !isBlocking(command.tokens)
            : mode !== "ordinary" && !(explicit && (mode === "exclusive" || mode === "advanced"))
        )
          return yield* new UnsupportedCommandError({
            delivery: "unsent",
            reason: "execution-mode",
          });
        const forbidden =
          mode === "ordinary"
            ? checkOrdinary(command.tokens)
            : mode === "blocking"
              ? undefined
              : checkAdvanced(command.tokens);
        if (forbidden !== undefined) return yield* forbidden;

        let target = yield* route(command, nodeId, blocking);
        let asking = false;
        for (let attempt = 0; attempt <= policy.maxRedirects; attempt++) {
          const received = yield* registry
            .use(target.address, blocking ? "blocking" : "session", (wire) =>
              Effect.gen(function* () {
                // Exclusive leases fence both control adjacency and replica connection state.
                yield* wire
                  .execute([target.replica ? "READONLY" : "READWRITE"])
                  .pipe(Effect.flatMap(checkServerReply), Effect.flatMap(status("OK")));
                if (asking)
                  yield* wire
                    .execute(["ASKING"])
                    .pipe(Effect.flatMap(checkServerReply), Effect.flatMap(status("OK")));
                writing();
                const response =
                  exchange === undefined
                    ? wire.execute(command.tokens, command.replyTimeoutMillis)
                    : exchange(wire, command, { address: target.address, asking });
                return yield* response.pipe(
                  Effect.ensuring(
                    mode === "exclusive" || mode === "advanced"
                      ? Effect.sync(wire.retire)
                      : Effect.void,
                  ),
                );
              }),
            )
            .pipe(
              Effect.catchTag("ConnectionError", (error) => {
                discovery.stale(target.address);
                return discovery.invalidate.pipe(Effect.andThen(Effect.fail(error)));
              }),
            );
          const redirected = yield* redirect(received, target.address);
          const value = undecorate(received);
          if (
            (value._tag === "SimpleError" || value._tag === "BlobError") &&
            ["CLUSTERDOWN ", "READONLY "].some(
              (code) =>
                value.value.length >= code.length &&
                value.value
                  .subarray(0, code.length)
                  .every((byte, index) => byte === code.charCodeAt(index)),
            )
          ) {
            discovery.stale(target.address);
            yield* discovery.invalidate;
          }
          if (redirected === undefined || target.explicit) return received;
          if (target.slot === undefined || redirected.slot !== target.slot)
            return yield* new ClusterError({ reason: "invalid-redirect", delivery: "replied" });
          if (attempt === policy.maxRedirects)
            return yield* new ClusterError({
              reason: "redirect-limit",
              delivery: "replied",
              slot: redirected.slot,
            });

          asking = redirected.kind === "ASK";
          yield* discovery.invalidate;
          if (!asking) {
            moved.set(redirected.slot, redirected.address);
            // Refresh is a distinct read-only operation; failed refresh never replays the original command.
            yield* discovery.refresh;
          }
          target = {
            address: redirected.address,
            slot: redirected.slot,
            replica: false,
            explicit: false,
          };
        }
        return yield* new ClusterError({ reason: "redirect-limit", delivery: "replied" });
      }),
    );

  const executor = (nodeId?: string): RedisExecutor => ({
    executePrepared: (command) =>
      reply(command, nodeId).pipe(Effect.flatMap((response) => decodeReply(command, response))),
    execute: (command) =>
      command.prepare.pipe(
        Effect.flatMap((prepared) => executor(nodeId).executePrepared(prepared)),
      ),
  });

  return { executor, reply, route, admission, addressIdentity };
};

export type ClusterRouter = ReturnType<typeof makeClusterRouter>;
