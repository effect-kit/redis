// Compile-only public contracts; these are never executed by Vitest.
import { Effect } from "effect";
import type { Option, Stream } from "effect";

import { Commands, PayloadCodec, StreamPayload } from "#/index";
import type {
  ClaimPage,
  GroupEntry,
  GroupMessage,
  PayloadError,
  RedisClient,
  RedisSessionsClient,
  RedisStreamsClient,
  StreamEntry,
  StreamId,
  StreamInfo,
  StreamInfoFull,
} from "#/index";
import { DecodeLabel, EncodeLabel, labelSchema } from "#test/support/commands/SchemaServices";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;
declare const redis: RedisClient;
declare const sessions: RedisSessionsClient;
declare const streams: RedisStreamsClient;
declare const groupEntry: GroupEntry;
declare const entry: StreamEntry;

const plain = redis.xread([["s", "0"]]);
const grouped = redis.xreadgroup("g", "c", [["s", ">"]]);
const claimed = redis.xautoclaim("s", "g", "c", 0);
const ids = redis.xautoclaimIds("s", "g", "c", 0);
const info = redis.xinfoStream("s");
const full = redis.xinfoStreamFull("s");
const lazy = streams.read([["s", "$"]]);
const pending = streams.pending("s", "g", "c");
const recovery = streams.claim("s", "g", "c", 0);
const payload = StreamPayload.field("body", PayloadCodec.schemaText(labelSchema));
const encoded = Commands.xaddPayload("s", "*", payload, "value");
const saved = redis.xaddPayload("s", "*", payload, "value");
const decoded = payload.decode(entry);
const processing = streams.process("g", pending, (message) => payload.decodeGroup(message.entry));
const withPolicy = streams.process("g", pending, () => Effect.fail("application" as const), {
  onFailure: () => EncodeLabel.pipe(Effect.andThen(Effect.fail("policy" as const))),
});
const consumed = streams.consume("g", "c", ["s"], () => DecodeLabel.pipe(Effect.as(1)));
const emptyScan = redis.scanKeys();

export type StreamContracts = [
  Assert<
    Equal<
      Effect.Success<typeof plain>,
      Option.Option<
        ReadonlyArray<{ readonly key: Uint8Array; readonly entries: ReadonlyArray<StreamEntry> }>
      >
    >
  >,
  Assert<
    Equal<
      Option.Option.Value<Effect.Success<typeof grouped>>[number]["entries"][number],
      GroupEntry
    >
  >,
  Assert<Equal<Effect.Success<typeof claimed>, ClaimPage<Option.Option<GroupEntry>>>>,
  Assert<Equal<Effect.Success<typeof ids>, ClaimPage<StreamId>>>,
  Assert<Equal<Effect.Success<typeof info>, StreamInfo>>,
  Assert<Equal<Effect.Success<typeof full>, StreamInfoFull>>,
  Assert<Equal<Stream.Success<typeof lazy>["entry"], StreamEntry>>,
  Assert<Equal<Stream.Success<typeof pending>, GroupMessage>>,
  Assert<Equal<Stream.Success<typeof recovery>, ClaimPage<Option.Option<GroupEntry>>>>,
  Assert<Equal<Effect.Services<typeof encoded.prepare>, EncodeLabel>>,
  Assert<Equal<Effect.Services<typeof saved>, EncodeLabel>>,
  Assert<Equal<Effect.Services<typeof decoded>, DecodeLabel>>,
  Assert<Equal<Effect.Error<typeof decoded>, PayloadError>>,
  Assert<Equal<Stream.Services<typeof processing>, DecodeLabel>>,
  Assert<Equal<Stream.Services<typeof withPolicy>, EncodeLabel>>,
  Assert<Equal<Stream.Services<typeof consumed>, DecodeLabel>>,
  Assert<
    Equal<
      Extract<Stream.Error<typeof withPolicy>, "application" | "policy">,
      "application" | "policy"
    >
  >,
  Assert<
    Equal<Extract<Stream.Success<typeof processing>, { _tag: "Processed" }>["result"], string>
  >,
  Assert<Equal<Stream.Success<typeof emptyScan>, Uint8Array>>,
  Assert<Equal<Stream.Services<typeof lazy>, never>>,
];

// @ts-expect-error Ordinary Redis composition does not own a blocking read lease.
redis.xread([["s", "0"]], { block: { blockFor: "forever" } });
// @ts-expect-error Blocking methods require explicit server-wait policy.
sessions.xreadBlocking([["s", "0"]], {});
// @ts-expect-error Group IDs use > or an explicit pending position, never $.
redis.xreadgroup("g", "c", [["s", "$"]]);
// @ts-expect-error Continuous readers do not repeatedly request the latest-entry + selector.
streams.read([["s", "+"]]);
// @ts-expect-error Stream IDs are exact tokens rather than Number timestamps.
redis.xadd("s", 123, [["f", "v"]]);
// @ts-expect-error At least one source stream is required.
streams.read([]);
// @ts-expect-error NOACK is deliberately unavailable in processing helpers.
streams.consume("g", "c", ["s"], () => Effect.void, {}, { noAck: true });
// @ts-expect-error The payload codec owns the application input type.
redis.xaddPayload("s", "*", payload, 123);
// @ts-expect-error Raw stream fields are ordered pairs, not an object.
redis.xadd("s", "*", { field: "value" });
// @ts-expect-error JUSTID has a separately named result contract.
redis.xclaim("s", "g", "c", 0, ["1-0"], { justId: true });
// @ts-expect-error Group tombstones must pass through the explicit group decoder.
payload.decode(groupEntry);
