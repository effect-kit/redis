import { Context, Effect, Exit, Scope } from "effect";
import type { Cause } from "effect";

import type { ConnectionOptions } from "#/connection/Options";
import { RedisConfigError } from "#/errors/RedisConfigError";
import type { EventError } from "#/events/Types";
import { makeEventWire } from "#/events/Wire";
import type { EventWire } from "#/events/Wire";
import type { RespValue } from "#/protocol/RespValue";
import type { RedisConfig } from "#/RedisConfig";
import { Transport } from "#/transport/Transport";

/** Captures services once, but credentials and byte workers belong to each physical generation. */
export const makeEventOwner = Effect.fnUntraced(function* <R>(
  config: RedisConfig,
  options: Pick<ConnectionOptions<R>, "credentials">,
  receive: (
    reply: RespValue,
    cost: number,
    generation: number,
  ) => Effect.Effect<boolean, EventError>,
  failed: (cause: Cause.Cause<EventError>, generation: number) => void,
  maxWaiters: number,
) {
  if (options.credentials !== undefined && config.credentials !== undefined)
    return yield* new RedisConfigError({
      field: "connection.credentials",
      reason: "Choose fixed credentials or an Effect credential source",
    });

  const transport = yield* Transport;
  const context = yield* Effect.context<R>();
  const parent = yield* Effect.scope;
  let resource: Scope.Closeable | undefined;
  let current: EventWire | undefined;
  let generation = 0;
  let poison: Cause.Cause<never> | undefined;

  const release = Effect.gen(function* () {
    if (resource === undefined) return;
    const closing = resource;
    resource = undefined;
    current = undefined;

    const exit = yield* Effect.exit(Scope.close(closing, Exit.void));
    if (Exit.isFailure(exit)) {
      poison = exit.cause;
      return yield* Effect.failCause(exit.cause);
    }
  });

  const open = Effect.gen(function* () {
    if (poison !== undefined) return yield* Effect.failCause(poison);
    if (current?.isReady()) return current;
    yield* release;

    const scope = yield* Scope.fork(parent);
    resource = scope;
    const id = ++generation;
    const credentials = options.credentials;
    const acquired = yield* Effect.exit(
      makeEventWire(
        config,
        id,
        credentials === undefined
          ? {}
          : {
              credentials: credentials.pipe(
                Effect.provideContext(Context.add(context, Scope.Scope, scope)),
              ),
            },
        (reply, cost) => receive(reply, cost, id),
        (cause) => failed(cause, id),
        maxWaiters,
      ).pipe(Scope.provide(scope), Effect.provideService(Transport, transport)),
    );

    if (Exit.isFailure(acquired)) {
      yield* release;
      return yield* Effect.failCause(acquired.cause);
    }

    current = acquired.value;
    return current;
  });

  yield* Effect.addFinalizer(() => release);

  return { open, release, current: () => current, generation: () => generation };
});

export type EventOwner = Effect.Success<ReturnType<typeof makeEventOwner>>;
