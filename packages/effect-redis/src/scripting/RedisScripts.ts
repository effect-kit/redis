import { Context, Deferred, Effect, Layer, Redacted, Schema } from "effect";

import type { RedisError } from "#/command/Executor";
import { undecorate } from "#/command/reply/Scalars";
import { parse } from "#/commands/internal/Input";
import { invocation } from "#/commands/scripting/Invocation";
import type { ScriptArguments } from "#/commands/scripting/Invocation";
import { Invocation } from "#/commands/scripting/Invocation";
import { ReplyError } from "#/errors/ReplyError";
import type { ServerError } from "#/errors/ServerError";
import { SessionError } from "#/errors/SessionError";
import type { RespValue } from "#/protocol/RespValue";
import type { RedisScript } from "#/scripting/RedisScript";
import { RedisSessions } from "#/sessions/RedisSessions";
import type { RedisSessionsClient } from "#/sessions/RedisSessions";
import type { RedisSession } from "#/sessions/Session";

export interface ScriptOptions {
  readonly maxConcurrentLoads?: number;
}

const missingScript = (error: ServerError) => {
  if (error.code !== "NOSCRIPT") return false;
  const reply = undecorate(Redacted.value(error.reply) as RespValue);
  const messages = [
    "NOSCRIPT No matching script. Please use EVAL.",
    "NOSCRIPT No matching script.",
  ];

  return (
    (reply._tag === "SimpleError" || reply._tag === "BlobError") &&
    messages.some(
      (expected) =>
        reply.value.length === expected.length &&
        reply.value.every((byte, index) => byte === expected.charCodeAt(index)),
    )
  );
};

export const makeRedisScripts = Effect.fnUntraced(function* (
  sessions: RedisSessionsClient,
  options: ScriptOptions = {},
) {
  const { maxConcurrentLoads } = yield* parse(
    Schema.Struct({
      maxConcurrentLoads: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65536 })),
    }),
    { maxConcurrentLoads: options.maxConcurrentLoads ?? 64 },
  );
  // This coordinator belongs to one backend/DB identity, never a process-global cache.
  const loads = new Map<string, Deferred.Deferred<void, RedisError>>();

  const load = Effect.fnUntraced(function* <A, E, R>(
    session: RedisSession,
    script: RedisScript<A, E, R>,
  ) {
    const existing = loads.get(script.sha1);
    if (existing !== undefined) return yield* Deferred.await(existing);
    if (loads.size >= maxConcurrentLoads)
      return yield* new SessionError({ reason: "pool-full", delivery: "unsent" });

    const pending = Deferred.makeUnsafe<void, RedisError>();
    loads.set(script.sha1, pending);

    // A cancelled loader completes every waiter with the same Cause, then relinquishes ownership.
    return yield* session.scriptLoad(Redacted.value(script.source)).pipe(
      Effect.flatMap((digest) =>
        digest === script.sha1
          ? Effect.void
          : Effect.fail(
              new ReplyError({
                delivery: "replied",
                expected: "custom",
                actual: "BlobString",
                path: [],
              }),
            ),
      ),
      Effect.onExit((exit) =>
        Effect.sync(() => {
          loads.delete(script.sha1);
          Deferred.doneUnsafe(pending, exit);
        }),
      ),
    );
  });

  const execute = Effect.fnUntraced(function* <A, E, R>(
    script: RedisScript<A, E, R>,
    input: ScriptArguments,
  ) {
    const selected = yield* parse(Invocation, input);
    // Freeze caller-owned binary intent before waiting for a lease or a concurrent load.
    const snapshot = {
      keys: selected.keys.map((key) => (typeof key === "string" ? key : key.slice())),
      args: (selected.args ?? []).map((arg) => (typeof arg === "string" ? arg : arg.slice())),
    };

    const prepared = yield* invocation(
      script.readOnly ? "EVALSHA_RO" : "EVALSHA",
      script.sha1,
      snapshot,
      Effect.succeed,
    ).prepare;

    const reply = yield* sessions.withSession((session) => {
      const run = session.executePrepared(prepared);

      return run.pipe(
        Effect.catchTag("ServerError", (error) => {
          if (!missingScript(error)) return Effect.fail(error);

          // Definite rejection proves this call did not execute. A second rejection is returned as-is.
          return load(session, script).pipe(Effect.andThen(run));
        }),
      );
    });

    // Application decoder errors cannot authorize wire replay.
    return yield* script.decode(reply);
  });

  return { execute };
});

export type RedisScriptsClient = Effect.Success<ReturnType<typeof makeRedisScripts>>;

export class RedisScripts extends Context.Service<RedisScripts, RedisScriptsClient>()(
  "@envoy1084/effect-redis/RedisScripts",
) {
  static layer(options?: ScriptOptions) {
    return Layer.effect(
      RedisScripts,
      RedisSessions.pipe(Effect.flatMap((sessions) => makeRedisScripts(sessions, options))),
    );
  }
}
