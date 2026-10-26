import { Redacted } from "effect";

import type { RedisError } from "#/command/Executor";
import type { RedisConfigError } from "#/errors/RedisConfigError";
import { SentinelError } from "#/errors/SentinelError";
import type { TransportError } from "#/errors/TransportError";

export const discoveryFailure = (
  plane: "sentinel" | "data",
  error: RedisError | RedisConfigError | TransportError,
): SentinelError =>
  error instanceof SentinelError
    ? error
    : new SentinelError({
        plane,
        delivery: "unsent",
        reason:
          error._tag === "HandshakeError" &&
          error.stage === "role" &&
          error.reason === "role-mismatch"
            ? "role-mismatch"
            : (error._tag === "HandshakeError" &&
                  (["auth", "credentials"].includes(error.stage) ||
                    (error.stage === "role" && error.reason === "rejected"))) ||
                (error._tag === "ServerError" &&
                  ["NOAUTH", "NOPERM", "WRONGPASS"].includes(error.code))
              ? "authentication"
              : error._tag === "ReplyError" || error._tag === "ProtocolError"
                ? "invalid-reply"
                : plane === "sentinel"
                  ? "unreachable"
                  : "data-unavailable",
        cause: Redacted.make(error),
      });
