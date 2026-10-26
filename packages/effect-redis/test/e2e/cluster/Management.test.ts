import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { Commands } from "#/index";
import { atLeast, primaryCases } from "#test/support/commands/Backend";
import { recordFixture } from "#test/support/servers/Evidence";
import { sessionBackend } from "#test/support/sessions/Backend";

it.live.each(primaryCases)(
  "CLUSTER-CONTROL: $target.fixture $protocol owned node management and role guards",
  ({ target, protocol }) =>
    Effect.gen(function* () {
      const { sessions, server } = yield* sessionBackend(target, protocol, [
        "cluster-enabled yes",
        "cluster-config-file nodes.conf",
        "cluster-node-timeout 1000",
      ]);

      yield* sessions.withSession((session) =>
        Effect.gen(function* () {
          const id = yield* session.execute(Commands.clusterMyId());
          expect(yield* session.execute(Commands.clusterInfo())).toContain(
            "cluster_slots_assigned:0",
          );
          expect(yield* session.execute(Commands.clusterNodes())).toContain(id);
          yield* session.execute(Commands.clusterSetConfigEpoch(1));
          yield* session.execute(Commands.clusterAddSlots([0, 1]));
          expect(yield* session.execute(Commands.clusterInfo())).toContain(
            "cluster_slots_assigned:2",
          );
          yield* session.execute(Commands.clusterDelSlots([1]));
          expect(yield* session.execute(Commands.clusterInfo())).toContain(
            "cluster_slots_assigned:1",
          );

          if (atLeast(target.version, "7.0.0")) {
            yield* session.execute(Commands.clusterAddSlotRanges([[2, 3]]));
            expect(yield* session.execute(Commands.clusterInfo())).toContain(
              "cluster_slots_assigned:3",
            );
            yield* session.execute(Commands.clusterDelSlotRanges([[2, 3]]));
          } else {
            expect(
              yield* Effect.flip(session.execute(Commands.clusterAddSlotRanges([[2, 3]]))),
            ).toMatchObject({ _tag: "ServerError" });
            expect(
              yield* Effect.flip(session.execute(Commands.clusterDelSlotRanges([[2, 3]]))),
            ).toMatchObject({ _tag: "ServerError" });
          }
          yield* session.execute(Commands.clusterFlushSlots());
          expect(yield* session.execute(Commands.clusterSlots())).toEqual([]);

          // These guards are exercised on an owned lone primary; successful real failover has separate topology fixtures.
          yield* session.execute(Commands.clusterMeet("127.0.0.1", 6379));
          expect(yield* Effect.flip(session.execute(Commands.clusterReplicate(id)))).toMatchObject({
            _tag: "ServerError",
          });
          expect(yield* Effect.flip(session.execute(Commands.clusterForget(id)))).toMatchObject({
            _tag: "ServerError",
          });
          expect(yield* Effect.flip(session.execute(Commands.clusterFailover()))).toMatchObject({
            _tag: "ServerError",
          });
          yield* session.execute(Commands.clusterReset("SOFT"));
          yield* session.execute(Commands.clusterReset("HARD"));
          expect(yield* session.execute(Commands.clusterMyId())).not.toBe(id);
        }),
      );

      yield* recordFixture(`cluster-management-${target.fixture}-${protocol}`, {
        image: target.reference,
        build: server.build,
        configurationDigest: server.configurationDigest,
        checks: [
          "assign-remove-slots",
          "ranges-availability",
          "flush-empty-slots",
          "explicit-role-guards",
          "reset-identity",
        ],
      });
    }),
);
