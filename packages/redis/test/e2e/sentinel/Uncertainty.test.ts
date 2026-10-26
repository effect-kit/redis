import { expect, it } from "@effect/vitest";
import { Effect, Fiber, Option, Redacted, Result } from "effect";

import { decodeReply } from "#/command/Decode";
import { simpleText } from "#/command/reply/Data";
import { Commands, makeRedisSentinel } from "#/index";
import { layer } from "#/node";
import { faultProxy } from "#test/support/networking/FaultProxy";
import { replyGate } from "#test/support/networking/ReplyGate";
import { awaitSentinel, sentinelFixture } from "#test/support/sentinel/Fixture";
import { currentSentinelCases } from "#test/support/sentinel/Targets";
import { recordFixture } from "#test/support/servers/Evidence";

it.live.each(currentSentinelCases.filter(({ protocol }) => protocol === "resp3"))(
  "SENTINEL: $target.fixture proven mutation survives reply loss without replay after actual promotion",
  ({ target }) =>
    Effect.gen(function* () {
      const fixture = yield* sentinelFixture(target, "resp3");
      yield* fixture.client.close;
      const primary = fixture.servers[0];
      const sentinel = fixture.servers[3];
      if (primary === undefined || sentinel === undefined)
        return yield* Effect.die("Missing fixture nodes");
      const proxy = yield* faultProxy(primary.port);
      const client = yield* makeRedisSentinel(fixture.config, {
        ...fixture.clientOptions,
        addressMap: (address, plane) =>
          plane === "data" && address.host === primary.address
            ? { host: "127.0.0.1", port: proxy.port }
            : fixture.addressMap(address, plane),
      }).pipe(Effect.provide(layer));
      yield* client.redis.ping();
      const arrival = yield* proxy.holdReplies;
      const mutation = yield* Effect.forkChild(
        Effect.result(client.redis.incr("uncertain-counter")),
      );
      yield* arrival;

      // The independent primary and both replicas prove execution while the caller's reply remains withheld.
      expect(
        yield* primary.request(["GET", "uncertain-counter"]).pipe(Effect.flatMap(simpleText)),
      ).toBe("1");
      for (const replica of fixture.servers.slice(1, 3))
        yield* awaitSentinel(
          replica.request(["GET", "uncertain-counter"]).pipe(
            Effect.flatMap(simpleText),
            Effect.flatMap((value) =>
              value === "1" ? Effect.void : Effect.fail(new Error("Replication pending")),
            ),
          ),
        );
      yield* proxy.cut;
      const outcome = yield* Fiber.join(mutation);
      expect(Result.isFailure(outcome) && outcome.failure).toMatchObject({
        _tag: "ConnectionError",
        delivery: "possibly-written",
      });
      yield* proxy.releaseReplies;

      yield* fixture.control(0, "kill");
      const address = yield* Commands.sentinelGetMasterAddrByName("cache").prepare;
      yield* awaitSentinel(
        sentinel.request(address.tokens).pipe(
          Effect.flatMap((reply) => decodeReply(address, reply)),
          Effect.flatMap((value) =>
            Option.isSome(value) && value.value.host !== primary.address
              ? Effect.void
              : Effect.fail(new Error("Promotion pending")),
          ),
        ),
      );
      expect(yield* client.redis.get("uncertain-counter")).toEqual(Option.some("1"));
      expect(yield* client.redis.get("uncertain-counter")).toEqual(Option.some("1"));

      yield* recordFixture(`sentinel-uncertainty-${target.fixture}`, {
        version: target.version,
        checks: [
          "independent-execution-proof",
          "replica-state-proof",
          "withheld-reply",
          "unknown-outcome",
          "actual-promotion",
          "no-replay",
        ],
      });
    }),
  90_000,
);

it.live.each(currentSentinelCases.filter(({ protocol }) => protocol === "resp3"))(
  "SENTINEL: $target.fixture lost EXEC retains indexed unknown evidence after proven server commit",
  ({ target }) =>
    Effect.gen(function* () {
      const fixture = yield* sentinelFixture(target, "resp3");
      yield* fixture.client.close;
      const gate = yield* replyGate(new TextEncoder().encode("*1\r\n$4\r\nEXEC\r\n")).pipe(
        Effect.provide(layer),
      );
      const client = yield* makeRedisSentinel(fixture.config, fixture.clientOptions).pipe(
        Effect.provide(gate.layer),
      );
      const committed = yield* Effect.forkChild(
        Effect.result(
          client.transaction([
            Commands.incr("exec-counter"),
            Commands.set("exec-other", "committed"),
          ] as const),
        ),
      );
      yield* gate.arrived;
      const primary = fixture.servers[0];
      if (primary === undefined) return yield* Effect.die("Missing independent primary oracle");

      expect(yield* primary.request(["GET", "exec-counter"]).pipe(Effect.flatMap(simpleText))).toBe(
        "1",
      );
      expect(yield* primary.request(["GET", "exec-other"]).pipe(Effect.flatMap(simpleText))).toBe(
        "committed",
      );
      yield* gate.cut;
      const result = yield* Fiber.join(committed);
      expect(result).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "BatchError", phase: "transaction-exec", execution: "unknown" },
      });
      if (result._tag === "Failure" && result.failure._tag === "BatchError")
        expect(Redacted.value(result.failure.outcomes)).toMatchObject([
          { _tag: "Unknown", index: 0 },
          { _tag: "Unknown", index: 1 },
        ]);
      expect(yield* client.redis.get("exec-counter")).toEqual(Option.some("1"));

      yield* recordFixture(`sentinel-exec-uncertainty-${target.fixture}`, {
        version: target.version,
        checks: [
          "actual-exec-commit",
          "independent-both-key-proof",
          "reply-withheld-after-socket-read",
          "indexed-unknown",
          "no-replay",
        ],
      });
    }),
  90_000,
);
