import { Context, Effect, Redacted } from "effect";

import { simpleText } from "#/command/reply/Data";
import { undecorate } from "#/command/reply/Scalars";
import { HandshakeError } from "#/errors/HandshakeError";
import type { RespValue } from "#/protocol/RespValue";

export type ExpectedRole = "primary" | "replica";

/** Internal topology policy, captured when a connection owner is constructed. */
export const RoleExpectation = Context.Reference<ExpectedRole | undefined>(
  "@effect-kit/redis/connection/RoleExpectation",
  { defaultValue: () => undefined },
);

export const verifyRole = Effect.fnUntraced(function* (reply: RespValue, expected: ExpectedRole) {
  const value = undecorate(reply);
  if (value._tag === "SimpleError" || value._tag === "BlobError") {
    const denied = ["NOAUTH ", "NOPERM ", "WRONGPASS "].some(
      (prefix) =>
        value.value.length >= prefix.length &&
        value.value
          .subarray(0, prefix.length)
          .every((byte, index) => byte === prefix.charCodeAt(index)),
    );
    return yield* new HandshakeError({
      stage: "role",
      reason: denied ? "rejected" : "invalid-reply",
      delivery: "unsent",
      cause: Redacted.make(reply),
    });
  }
  const role =
    value._tag === "Array" && value.values[0] !== undefined
      ? yield* simpleText(value.values[0]).pipe(
          Effect.mapError(
            () =>
              new HandshakeError({ stage: "role", reason: "invalid-reply", delivery: "unsent" }),
          ),
        )
      : undefined;

  if (role !== "master" && role !== "slave")
    return yield* new HandshakeError({
      stage: "role",
      reason: "invalid-reply",
      delivery: "unsent",
      cause: Redacted.make(reply),
    });

  if (role !== (expected === "primary" ? "master" : "slave"))
    return yield* new HandshakeError({
      stage: "role",
      reason: "role-mismatch",
      delivery: "unsent",
    });

  // Validate the structural role receipt before trusting its first token.
  const valid =
    value._tag === "Array" &&
    (role === "master"
      ? value.values.length === 3 &&
        value.values[1]?._tag === "Integer" &&
        value.values[2]?._tag === "Array"
      : value.values.length === 5 &&
        value.values[2]?._tag === "Integer" &&
        value.values[4]?._tag === "Integer");
  if (!valid)
    return yield* new HandshakeError({
      stage: "role",
      reason: "invalid-reply",
      delivery: "unsent",
    });
});
