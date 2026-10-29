import { expect, it } from "@effect/vitest";
import { Effect, Fiber, Option, Scope, Exit } from "effect";

import { batchTokens } from "#/command/Compiled";
import { snapshotBatch } from "#/command/Compiled";
import { makeExecutor } from "#/command/Executor";
import { Admission } from "#/connection/Admission";
import { ProfileError } from "#/errors/ProfileError";
import { Commands, fromPreparation, RedisKey } from "#/index";
import { ProfileCommandPolicy } from "#/profiles/Commands";
import { cachedGroups } from "#/protocol/CompiledFrames";
import { makeRedis, scopedRedis } from "#/Redis";
import { DecodeLabel, EncodeLabel, labelSchema } from "#test/support/commands/SchemaServices";
import { controlled, sent } from "#test/support/connection/Controlled";

it.effect("compiled plans prepare once, snapshot binary inputs, and can execute repeatedly", () =>
  Effect.gen(function* () {
    const { fixture, connection } = yield* controlled();
    const redis = makeRedis(makeExecutor(connection));
    // Buffer.slice() aliases its input; snapshots must also own Node Buffer arguments.
    const key = Buffer.from("original");
    let preparations = 0;
    const command = fromPreparation(
      Effect.suspend(() => {
        preparations++;
        return Commands.get(key).prepare;
      }),
    );
    const plan = yield* redis.compile([command, Commands.incr("counter")]);
    key.fill(0);
    for (let index = 0; index < 2; index++) {
      const running = yield* Effect.forkChild(plan.execute());
      yield* sent(fixture, ["GET", "original"]);
      yield* sent(fixture, ["INCR", "counter"], "$1\r\nx\r\n:2\r\n");
      expect(yield* Fiber.join(running)).toEqual([Option.some("x"), 2n]);
    }
    expect(preparations).toBe(1);
  }),
);

it.effect(
  "compiled decoders use the executing fiber's services, without capturing preparation services",
  () =>
    Effect.gen(function* () {
      const { fixture, connection } = yield* controlled();
      const redis = makeRedis(makeExecutor(connection));
      const labels = RedisKey.schemaText("labels", labelSchema);
      const plan = yield* redis
        .compile([Commands.setKey(labels, "v"), Commands.getKey(labels)])
        .pipe(Effect.provideService(EncodeLabel, { prefix: "encoded:" }));
      for (const prefix of ["first:", "second:"]) {
        const running = yield* Effect.forkChild(
          plan.execute().pipe(Effect.provideService(DecodeLabel, { prefix })),
        );
        yield* sent(fixture, ["SET", "labels", "encoded:v"]);
        yield* sent(fixture, ["GET", "labels"], "+OK\r\n$1\r\nx\r\n");
        expect(yield* Fiber.join(running)).toEqual([undefined, Option.some(`${prefix}x`)]);
      }
    }),
);

it.effect("compiled frames are reused only after fresh admission under the same limits", () =>
  Effect.gen(function* () {
    const { config } = yield* controlled();
    const prepared = yield* snapshotBatch([Commands.get("a"), Commands.incr("b")]);
    const tokens = batchTokens(prepared);
    const admission = new Admission(config.limits);
    const first = admission.reserveBatch(tokens, 0, 100);
    if (!Array.isArray(first)) return yield* Effect.die(first);
    const cached = cachedGroups(tokens, admission.limits);
    const originalBuffer = first[0]?.frame?.buffer;
    expect(cached?.[0]?.[0]?.buffer).toBe(originalBuffer);
    for (const ticket of first) admission.release(ticket);
    const second = admission.reserveBatch(tokens, 1000, 200);
    if (!Array.isArray(second)) return yield* Effect.die(second);
    expect(second[0]?.frame?.buffer).toBe(originalBuffer);
    expect(second[0]?.deadlineMillis).toBe(1200);
    const tighter = new Admission({ ...config.limits, maxQueuedBytes: 10 });
    expect(tighter.reserveBatch(tokens, 0, 100)).toMatchObject({ reason: "oversized" });
    expect(tighter.tickets.size).toBe(0);
  }),
);

it.effect(
  "a retained compiled plan fails after its owning client scope closes, including empty plans",
  () =>
    Effect.gen(function* () {
      const { connection } = yield* controlled();
      const owner = yield* Scope.make();
      const redis = yield* scopedRedis(makeExecutor(connection)).pipe(Scope.provide(owner));
      const plan = yield* redis.compile([]);
      yield* Scope.close(owner, Exit.void);
      expect(yield* Effect.flip(plan.execute())).toMatchObject({
        _tag: "ConnectionError",
        reason: "closed",
        delivery: "unsent",
      });
    }),
);

it.effect("cached plans recheck the captured deployment policy before each execution", () =>
  Effect.gen(function* () {
    let restricted = false;
    const { fixture, connection } = yield* controlled().pipe(
      Effect.provideService(ProfileCommandPolicy, () =>
        restricted
          ? new ProfileError({ delivery: "unsent", reason: "restricted-command" })
          : undefined,
      ),
    );
    const redis = makeRedis(makeExecutor(connection));
    const plan = yield* redis.compile([Commands.get("a")]);
    const first = yield* Effect.forkChild(plan.execute());
    yield* sent(fixture, ["GET", "a"], "$-1\r\n");
    expect(yield* Fiber.join(first)).toEqual([Option.none()]);
    restricted = true;
    const failure = yield* Effect.flip(plan.execute());
    expect(failure).toMatchObject({ _tag: "BatchError", execution: "not-executed" });
    expect(yield* connection.snapshot).toMatchObject({
      admitted: 1,
      inFlightCommands: 0,
      queuedCommands: 0,
    });
  }),
);
