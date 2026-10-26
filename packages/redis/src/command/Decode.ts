import { Effect, Redacted } from "effect";

import type { PreparedCommand } from "#/command/Command";
import { undecorate } from "#/command/reply/Scalars";
import type { ReplyError } from "#/errors/ReplyError";
import { ServerError } from "#/errors/ServerError";
import type { RespValue } from "#/protocol/RespValue";

// Only the bounded error code is public; server text can contain echoed keys or values.
const serverCode = (bytes: Uint8Array) => {
  let code = "";

  for (const byte of bytes.subarray(0, 65)) {
    if (byte === 32) return code.length > 0 ? code : "ERR";
    if (
      !((byte >= 65 && byte <= 90) || (byte >= 48 && byte <= 57) || byte === 95) ||
      code.length === 64
    )
      return "ERR";

    code += String.fromCharCode(byte);
  }

  return code || "ERR";
};

export const checkServerReply = (reply: RespValue): Effect.Effect<RespValue, ServerError> => {
  const value = undecorate(reply);
  return value._tag === "SimpleError" || value._tag === "BlobError"
    ? Effect.fail(
        new ServerError({
          delivery: "replied",
          code: serverCode(value.value),
          reply: Redacted.make(reply),
        }),
      )
    : Effect.succeed(reply);
};

export const decodeReply = <A, E, R>(
  command: PreparedCommand<A, E, R>,
  reply: RespValue,
): Effect.Effect<A, E | ServerError | ReplyError, R> =>
  (command.serverErrors === "fail" ? checkServerReply(reply) : Effect.succeed(reply)).pipe(
    Effect.flatMap(command.decode),
  );
