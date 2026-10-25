import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";

import { Commands, makeRedisScripts, makeRedisSessions, RedisScript, Reply } from "#/index";
import { layer } from "#/node";
import { atLeast, primaryCases } from "#test/support/commands/Backend";
import { bytes } from "#test/support/commands/CoreCase";
import { cryptoLayer } from "#test/support/commands/Crypto";
import { sessionBackend } from "#test/support/sessions/Backend";

it.live.each(primaryCases)(
  "SCRIPT: $target.fixture $protocol lifecycle, cache loss and no mutation replay",
  ({ target, protocol }) =>
    Effect.gen(function* () {
      const { redis, sessions, config, prefix } = yield* sessionBackend(target, protocol);
      const scripts = yield* makeRedisScripts(sessions);
      const script = yield* RedisScript.make({
        source: "return redis.call('INCR', KEYS[1])",
        decode: Reply.integer,
      }).pipe(Effect.provide(cryptoLayer));
      const key = `${prefix}:script`;

      expect(script.sha1).toMatch(/^[0-9a-f]{40}$/);
      yield* redis.scriptFlush();
      expect(yield* redis.scriptExists([script.sha1])).toEqual([false]);
      expect(yield* scripts.execute(script, { keys: [key] })).toBe(1n);
      expect(yield* scripts.execute(script, { keys: [key] })).toBe(2n);
      expect(yield* redis.scriptExists([script.sha1])).toEqual([true]);
      yield* redis.scriptFlush("SYNC");
      expect(yield* scripts.execute(script, { keys: [key] })).toBe(3n);

      const broken = yield* RedisScript.make({
        source: "redis.call('INCR', KEYS[1]); error('private failure')",
        decode: Reply.integer,
      }).pipe(Effect.provide(cryptoLayer));
      expect(yield* Effect.flip(scripts.execute(broken, { keys: [key] }))).toMatchObject({
        _tag: "ServerError",
        code: "ERR",
      });
      expect(yield* redis.get(key)).toEqual(Option.some("4"));

      expect(
        yield* redis.evalScript(
          "return ARGV[1]",
          { keys: [], args: [new Uint8Array([0, 255])] },
          Reply.blob,
        ),
      ).toEqual(new Uint8Array([0, 255]));
      expect(yield* redis.scriptHelp()).not.toHaveLength(0);
      expect(yield* Effect.flip(redis.scriptKill())).toMatchObject({ code: "NOTBUSY" });

      if (target.product === "valkey" && atLeast(target.version, "8.0.0"))
        expect(yield* redis.scriptShow(script.sha1)).toEqual(
          bytes("return redis.call('INCR', KEYS[1])"),
        );
      else
        expect(yield* Effect.flip(redis.scriptShow(script.sha1))).toMatchObject({
          _tag: "ServerError",
        });

      const read = yield* RedisScript.make({
        source: "return redis.call('GET', KEYS[1])",
        readOnly: true,
        decode: Reply.optional(Reply.text),
      }).pipe(Effect.provide(cryptoLayer));
      if (atLeast(target.version, "7.0.0")) {
        expect(yield* scripts.execute(read, { keys: [key] })).toEqual(Option.some("4"));
        expect(yield* redis.evalReadOnly("return 8", { keys: [] }, Reply.integer)).toBe(8n);
      } else
        expect(yield* Effect.flip(scripts.execute(read, { keys: [key] }))).toMatchObject({
          _tag: "ServerError",
        });

      // Recovery is explicit outside already-sent batches; a pipeline never replays its siblings.
      yield* redis.scriptFlush();
      const piped = yield* sessions.pipeline([
        Commands.evalSha(script.sha1, { keys: [key] }, Reply.integer),
        Commands.incr(key),
      ]);
      expect(piped[0]).toMatchObject({ _tag: "Failure", failure: { code: "NOSCRIPT" } });
      expect(yield* redis.get(key)).toEqual(Option.some("5"));

      const parallel = yield* makeRedisSessions(config, { maxSessionConnections: 4 }).pipe(
        Effect.provide(layer),
      );
      const coordinated = yield* makeRedisScripts(parallel);
      const raceKey = `${prefix}:concurrent`;
      const increments = yield* Effect.forEach(
        Array.from({ length: 10 }),
        () => coordinated.execute(script, { keys: [raceKey] }),
        { concurrency: 4 },
      );

      expect(increments.toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0))).toEqual([
        1n,
        2n,
        3n,
        4n,
        5n,
        6n,
        7n,
        8n,
        9n,
        10n,
      ]);
      expect(yield* redis.get(raceKey)).toEqual(Option.some("10"));
    }),
);

it.live.each(primaryCases)(
  "FUNCTION: $target.fixture $protocol explicit library lifecycle and option availability",
  ({ target, protocol }) =>
    Effect.gen(function* () {
      const { redis } = yield* sessionBackend(target, protocol);
      if (!atLeast(target.version, "7.0.0")) {
        expect(yield* Effect.flip(redis.functionList())).toMatchObject({ _tag: "ServerError" });
        return;
      }

      const code =
        "#!lua name=effect_phase10\nredis.register_function{function_name='effect_read', callback=function(keys,args) return args[1] end, flags={'no-writes'}}";
      expect(yield* redis.functionLoad(code)).toBe("effect_phase10");
      expect(yield* redis.functionLoad(code, true)).toBe("effect_phase10");
      expect(yield* redis.fcall("effect_read", { keys: [], args: ["value"] }, Reply.text)).toBe(
        "value",
      );
      expect(
        yield* redis.fcallReadOnly("effect_read", { keys: [], args: ["ro"] }, Reply.text),
      ).toBe("ro");
      expect(yield* redis.functionList({ libraryName: "effect_*", withCode: true })).toHaveLength(
        1,
      );
      expect(yield* redis.functionStats()).not.toHaveLength(0);
      const dump = yield* redis.functionDump();
      yield* redis.functionFlush("SYNC");
      expect(yield* redis.functionList()).toEqual([]);
      yield* redis.functionRestore(dump, "REPLACE");
      expect(yield* redis.functionList()).toHaveLength(1);
      yield* redis.functionDelete("effect_phase10");
      expect(yield* redis.functionList()).toEqual([]);
      expect(yield* redis.functionHelp()).not.toHaveLength(0);
      expect(yield* Effect.flip(redis.functionKill())).toMatchObject({ code: "NOTBUSY" });
    }),
);
