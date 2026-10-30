import { randomUUID } from "node:crypto";

import { expect, it } from "@effect/vitest";
import { Effect, Option, Redacted } from "effect";

import { checkServerReply } from "#/command/Decode";
import { Commands, Redis, RedisProfiles, RedisSessions, decodeRedisConfig } from "#/index";
import { RedisNode, connect } from "#/node";
import { primaryCases } from "#test/support/commands/Backend";
import { bytes } from "#test/support/commands/CoreCase";
import { exchange } from "#test/support/networking/Exchange";
import { dockerServer } from "#test/support/servers/DockerServer";

it.live.each(primaryCases)(
  "PIPELINED-TX: $target.fixture $protocol commits siblings, aborts queue errors, and handles WATCH and ACL denial",
  ({ target, protocol: selectedProtocol }) =>
    Effect.gen(function* () {
      const protocol = selectedProtocol as "resp2" | "resp3";
      const server = yield* dockerServer(target);
      const endpoint = { host: "127.0.0.1", port: server.port };
      const oracle = yield* connect(yield* decodeRedisConfig({ endpoint }));
      const prefix = `pipelined:${randomUUID()}`;
      const counter = `${prefix}:counter`;
      const profile = target.product === "redis" ? RedisProfiles.redis() : RedisProfiles.valkey();

      yield* Effect.gen(function* () {
        const sessions = yield* RedisSessions;
        const redis = yield* Redis;
        yield* redis.set(counter, "0");

        expect(
          yield* sessions.transaction([
            Commands.incr(counter),
            Commands.lpop(counter),
            Commands.incr(counter),
          ]),
        ).toMatchObject({
          _tag: "Committed",
          results: [{ success: 1n }, { failure: { code: "WRONGTYPE" } }, { success: 2n }],
        });

        const rejected = yield* Effect.flip(
          sessions.transaction([
            Commands.incr(counter),
            Commands.raw(["INCR", counter, "extra"], {
              execution: "ordinary",
              routing: { _tag: "Keys", keys: [{ index: 1, access: "read-write" }] },
            }),
          ]),
        );
        expect(rejected).toMatchObject({
          _tag: "TransactionError",
          reason: "queue-rejected",
          execution: "not-executed",
        });
        expect(yield* redis.get(counter)).toEqual(Option.some("2"));

        expect(
          yield* sessions.watch([counter], (session) =>
            Effect.gen(function* () {
              yield* exchange(oracle, ["INCR", counter]);
              return yield* session.transaction([Commands.set(counter, "unexpected")]);
            }),
          ),
        ).toEqual({ _tag: "Conflict" });
        expect(yield* redis.get(counter)).toEqual(Option.some("3"));
        expect(yield* sessions.transaction([])).toEqual({ _tag: "Committed", results: [] });
      }).pipe(Effect.provide(RedisNode.layer({ endpoint, protocol, profile })));

      // Disposable ACL users exercise actual server abort behavior, not a scripted protocol peer.
      for (const denied of ["multi", "set", "exec"] as const) {
        const username = `${prefix}:${denied}`;
        const password = randomUUID();
        yield* exchange(oracle, [
          "ACL",
          "SETUSER",
          username,
          "reset",
          "on",
          `>${password}`,
          "~*",
          "+@all",
          `-${denied}`,
        ]).pipe(Effect.flatMap(checkServerReply));

        yield* Effect.gen(function* () {
          const sessions = yield* RedisSessions;
          const failure = yield* Effect.flip(
            sessions.transaction([
              Commands.incr(counter),
              Commands.set(`${prefix}:denied`, "value"),
            ]),
          );
          expect(failure).toMatchObject(
            denied === "multi"
              ? { _tag: "ServerError", code: "NOPERM" }
              : {
                  _tag: "TransactionError",
                  reason: denied === "set" ? "queue-rejected" : "exec-rejected",
                  execution: "not-executed",
                },
          );
          if (denied === "exec" && failure._tag === "TransactionError")
            expect(Redacted.value(failure.errors)).toMatchObject({ code: "EXECABORT" });
          yield* sessions.withSession((session) => session.ping());
        }).pipe(
          Effect.provide(
            RedisNode.layer({
              endpoint,
              protocol,
              profile,
              credentials: { username: Redacted.make(username), password: Redacted.make(password) },
            }),
          ),
        );

        expect(yield* exchange(oracle, ["GET", counter])).toEqual({
          _tag: "BlobString",
          value: bytes("3"),
        });
        yield* exchange(oracle, ["ACL", "DELUSER", username]).pipe(
          Effect.flatMap(checkServerReply),
        );
      }
    }),
);
