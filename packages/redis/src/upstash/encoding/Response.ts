import { Effect, Result } from "effect";
import { Base64 } from "effect/encoding";

import { UpstashError } from "#/errors/UpstashError";
import { makeRespDecoder } from "#/protocol/decode/Decoder";
import type { RespValue } from "#/protocol/RespValue";
import type { UpstashSettings } from "#/upstash/Config";
import type { JsonValue } from "#/upstash/encoding/Json";
import { parseJson } from "#/upstash/encoding/Json";
import type { JsonReplyPolicy } from "#/upstash/encoding/Status";

const utf8 = new TextEncoder();
const malformed = () =>
  new UpstashError({ stage: "response", reason: "malformed", delivery: "unknown" });

const jsonReply = (value: JsonValue, ambiguous = false): RespValue => {
  if (value === null) return { _tag: "Null", kind: "bulk" };
  if (typeof value === "boolean") return { _tag: "Boolean", value };
  if (typeof value === "string") {
    if (value === "OK") {
      if (ambiguous)
        throw new UpstashError({ stage: "response", reason: "encoding", delivery: "replied" });
      return { _tag: "BlobString", value: utf8.encode(value) };
    }
    const decoded = Base64.decode(value);
    if (Result.isFailure(decoded) || Base64.encode(decoded.success) !== value) throw malformed();
    return { _tag: "BlobString", value: decoded.success };
  }
  if (Array.isArray(value))
    return { _tag: "Array", values: value.map((entry) => jsonReply(entry, ambiguous)) };
  if (value instanceof Map) {
    // The REST contract does not specify whether object keys participate in base64 encoding.
    throw new UpstashError({ stage: "response", reason: "encoding", delivery: "replied" });
  }
  if ("_tag" in value && value._tag === "NumberToken") {
    if (value.token.length > 1024)
      throw new UpstashError({ stage: "response", reason: "limit", delivery: "unknown" });
    // RESP2 integers are int64. Exponents/fractions retain their exact double token.
    if (/^-?(?:0|[1-9][0-9]*)$/.test(value.token)) {
      const integer = BigInt(value.token);
      if (integer < -9223372036854775808n || integer > 9223372036854775807n)
        return { _tag: "BigNumber", value: integer };
      return { _tag: "Integer", value: integer };
    }
    return { _tag: "Double", value: value.token };
  }
  throw malformed();
};

/** A provider envelope is distinct from a Redis value that happens to contain an error field. */
export const envelope = (value: JsonValue, policy?: JsonReplyPolicy): RespValue => {
  if (!(value instanceof Map) || value.size !== 1) throw malformed();
  if (value.has("result")) {
    const result = jsonReply(value.get("result") ?? null, policy?.ambiguous ?? true);
    if (policy?.status === true && result._tag === "BlobString")
      return { _tag: "SimpleString", value: result.value };
    return result;
  }
  const error = value.get("error");
  if (typeof error !== "string") throw malformed();
  return { _tag: "SimpleError", value: utf8.encode(error) };
};

export const responseJson = (bytes: Uint8Array, config: UpstashSettings) =>
  Effect.try({
    try: () => new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    catch: malformed,
  }).pipe(Effect.flatMap((text) => Effect.fromResult(parseJson(text, config))));

export const decodeJsonBatch = (value: JsonValue, policies: ReadonlyArray<JsonReplyPolicy>) =>
  Effect.try({
    try: () => {
      if (!Array.isArray(value)) throw malformed();
      return value.map((entry, index) => envelope(entry, policies[index]));
    },
    catch: (error) => {
      if (error instanceof UpstashError) return error;
      throw error;
    },
  });

export const decodeResp = (bytes: Uint8Array, count: number, config: UpstashSettings) =>
  Effect.gen(function* () {
    const decoder = yield* Effect.fromResult(
      makeRespDecoder({
        maxHeaderBytes: Math.min(65536, config.maxResponseBytes),
        maxBlobBytes: config.maxResponseBytes,
        maxBufferedBytes: config.maxResponseBytes,
        maxAggregateEntries: config.maxAggregateEntries,
        maxNestingDepth: config.maxNestingDepth,
      }),
    );
    yield* Effect.fromResult(decoder.feed(bytes));
    decoder.end();
    const replies: Array<RespValue> = [];
    while (true) {
      const reply = yield* Effect.fromResult(decoder.next());
      if (reply === undefined) break;
      if (replies.length === count) return yield* malformed();
      replies.push(reply);
    }

    if (replies.length !== count) return yield* malformed();
    return replies;
  }).pipe(Effect.mapError(malformed));

/** The REST pipeline wraps its command replies in one RESP array, including a one-command batch. */
export const decodeRespPipeline = (bytes: Uint8Array, count: number, config: UpstashSettings) =>
  decodeResp(bytes, 1, config).pipe(
    Effect.flatMap(([reply]) =>
      reply?._tag === "Array" && reply.values.length === count
        ? Effect.succeed(reply.values)
        : Effect.fail(malformed()),
    ),
  );
