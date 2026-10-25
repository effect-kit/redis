import { Effect, Redacted, Schema } from "effect";

import { Credentials } from "#/config/Endpoint";
import type { ReplyReader } from "#/connection/ReplyReader";
import { ConnectionError } from "#/errors/ConnectionError";
import { HandshakeError } from "#/errors/HandshakeError";
import { encodeCommand } from "#/protocol/encode";
import type { RedisCommand } from "#/protocol/encode";
import type { RespValue } from "#/protocol/RespValue";
import type { RedisConfig } from "#/RedisConfig";
import type { TransportConnection } from "#/transport/Transport";

export const undecorated = (reply: RespValue): RespValue =>
  reply._tag === "Attribute" ? undecorated(reply.value) : reply;

const text = (reply: RespValue) =>
  reply._tag === "SimpleString" ||
  reply._tag === "BlobString" ||
  reply._tag === "SimpleError" ||
  reply._tag === "BlobError"
    ? new TextDecoder().decode(reply.value)
    : undefined;

const rejected = (reply: RespValue) => reply._tag === "SimpleError" || reply._tag === "BlobError";

const failure = (stage: HandshakeError["stage"], reply: RespValue) =>
  new HandshakeError({
    delivery: "unsent",
    stage,
    reason: rejected(undecorated(reply)) ? "rejected" : "invalid-reply",
    cause: Redacted.make(reply),
  });

export const handshake = Effect.fnUntraced(function* <R = never>(
  transport: TransportConnection,
  reader: ReplyReader,
  config: RedisConfig,
  credentials: Effect.Effect<typeof Credentials.Type | undefined, HandshakeError, R>,
  push: (reply: RespValue, cost: number) => Effect.Effect<void, ConnectionError>,
  generation: number,
) {
  const exchange = Effect.fnUntraced(function* (command: RedisCommand) {
    yield* transport.write(yield* Effect.fromResult(encodeCommand(command, config.limits)));

    while (true) {
      const reply = yield* reader.next;
      if (reply === undefined)
        return yield* new ConnectionError({ reason: "closed", generation, delivery: "unsent" });

      if (undecorated(reply.value)._tag === "Push") {
        yield* push(reply.value, reply.wireBytes);
        continue;
      }

      return reply.value;
    }
  });

  const expectOk = Effect.fnUntraced(function* (
    stage: HandshakeError["stage"],
    command: RedisCommand,
  ) {
    const reply = yield* exchange(command);
    const scalar = undecorated(reply);

    if (scalar._tag !== "SimpleString" || text(scalar) !== "OK")
      return yield* failure(stage, reply);
  });

  const identity = yield* credentials;
  if (identity !== undefined) {
    yield* Schema.decodeUnknownEffect(Schema.toType(Credentials))(identity).pipe(
      Effect.mapError(
        (cause) =>
          new HandshakeError({
            delivery: "unsent",
            stage: "credentials",
            reason: "invalid-reply",
            cause: Redacted.make(cause),
          }),
      ),
    );

    yield* expectOk("auth", [
      "AUTH",
      ...(identity.username === undefined ? [] : [Redacted.value(identity.username)]),
      Redacted.value(identity.password),
    ]);
  }

  let protocol: "resp2" | "resp3" = "resp2";
  if (config.protocol !== "resp2") {
    const reply = yield* exchange(["HELLO", "3"]);
    const value = undecorated(reply);

    if (rejected(value)) {
      const message = text(value) ?? "";

      // Only these server rejections establish that HELLO/RESP3 is unsupported.
      const unsupported =
        /^NOPROTO unsupported protocol version$/i.test(message) ||
        /^ERR unknown command ['`"]?HELLO['`"]?(?:,.*)?$/i.test(message);

      if (config.protocol !== "auto" || !unsupported) return yield* failure("hello", reply);
    } else {
      if (value._tag !== "Map") return yield* failure("hello", reply);

      const negotiated = value.entries.find(([key]) => text(key) === "proto")?.[1];
      if (negotiated?._tag !== "Integer" || negotiated.value !== 3n)
        return yield* failure("hello", reply);

      protocol = "resp3";
    }
  }

  if (config.clientName !== undefined)
    yield* expectOk("name", ["CLIENT", "SETNAME", config.clientName]);
  if (config.database !== 0) yield* expectOk("database", ["SELECT", String(config.database)]);

  return protocol;
});
