import { Effect, Result } from "effect";

import type { PreparedCommand } from "#/command/Command";
import { ClusterError } from "#/errors/ClusterError";
import { ConnectionError } from "#/errors/ConnectionError";
import type { ProtocolError } from "#/errors/ProtocolError";
import { encodeCommand } from "#/protocol/encode";
import type { RedisCommand } from "#/protocol/encode";
import type { RedisConfig } from "#/RedisConfig";

/** Own intent across discovery/redirect waits; charge encoded size before copying binary arguments. */
export const makeClusterAdmission = (
  config: RedisConfig,
  maximum: number,
  maxBytes: number,
  timeout: number,
) => {
  let count = 0;
  let bytes = 0;

  const run = <A, E, R, V, DE, DR>(
    input: PreparedCommand<V, DE, DR>,
    body: (prepared: PreparedCommand<V, DE, DR>, writing: () => void) => Effect.Effect<A, E, R>,
  ) =>
    Effect.acquireUseRelease(
      Effect.suspend<
        { size: number; command: PreparedCommand<V, DE, DR> },
        ClusterError | ProtocolError,
        never
      >(() => {
        if (count >= maximum || bytes >= maxBytes)
          return Effect.fail(new ClusterError({ reason: "capacity", delivery: "unsent" }));
        const encoded = encodeCommand(input.tokens, {
          ...config.limits,
          maxQueuedBytes: Math.min(config.limits.maxQueuedBytes, maxBytes - bytes),
        });
        if (Result.isFailure(encoded)) return Effect.fail(encoded.failure);
        const frame = encoded.success;
        count++;
        bytes += frame.length;
        const tokens = input.tokens.map((token) =>
          typeof token === "string" ? token : token.slice(),
        ) as unknown as RedisCommand;
        return Effect.succeed({ size: frame.length, command: { ...input, tokens } });
      }),
      ({ command }) => {
        let written = false;
        return Effect.suspend(() =>
          body(command, () => {
            written = true;
          }),
        ).pipe(
          Effect.timeoutOrElse({
            duration: timeout,
            orElse: () =>
              Effect.fail(
                new ConnectionError({
                  reason: "timeout",
                  delivery: written ? "possibly-written" : "unsent",
                  generation: 0,
                }),
              ),
          }),
        );
      },
      ({ size }) =>
        Effect.sync(() => {
          count--;
          bytes -= size;
        }),
    );

  return { run, snapshot: () => ({ count, bytes }) };
};
