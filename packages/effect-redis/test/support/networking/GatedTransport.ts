import { Deferred, Effect, Layer } from "effect";

import type { TransportError } from "#/errors/TransportError";
import type { Transport } from "#/transport/Transport";
import type { TransportConnection } from "#/transport/Transport";

/** A fault boundary over real sockets: hold a received reply after one exact scheduler write. */
export const gatedTransport = Effect.fnUntraced(function* (
  tag: typeof Transport,
  trigger: Uint8Array,
  readFailure: TransportError,
) {
  const native = yield* tag;
  const arrived = yield* Deferred.make<void>();
  const release = yield* Deferred.make<void>();
  let held: TransportConnection | undefined;

  const layer = Layer.succeed(tag, {
    open: (config) =>
      native.open(config).pipe(
        Effect.map((physical) => {
          let armed = false;
          return {
            close: physical.close,
            write: (bytes: Uint8Array) =>
              Effect.sync(() => {
                if (
                  bytes.length === trigger.length &&
                  bytes.every((byte, index) => byte === trigger[index])
                )
                  armed = true;
              }).pipe(Effect.andThen(physical.write(bytes))),
            read: Effect.gen(function* () {
              const bytes = yield* physical.read;
              if (!armed || bytes === undefined) return bytes;
              held = physical;
              yield* Deferred.succeed(arrived, undefined);
              yield* Deferred.await(release);
              return yield* readFailure;
            }),
          };
        }),
      ),
  });
  const cut = Effect.gen(function* () {
    if (held === undefined)
      return yield* Effect.die("Reply gate has not received its target reply");
    yield* held.close;
    yield* Deferred.succeed(release, undefined);
  });

  return { layer, arrived: Deferred.await(arrived), cut };
});
