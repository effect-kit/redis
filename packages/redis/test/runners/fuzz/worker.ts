import { Result } from "effect";

import type * as Codec from "#/index";
import type * as Decoder from "#/protocol/decode/Decoder";
import type * as Limits from "#/protocol/limits";

// A source alias would bypass declaration/bundling regressions in the built codec.
const moduleUrl = new URL("../../../dist/index.js", import.meta.url).href;
const { makeRespDecoder, ProtocolError }: typeof Codec = await import(moduleUrl);
const owned = process.argv.includes("--owned");
const { makeOwnedRespDecoder }: typeof Decoder = await import(
  new URL("../../../dist/protocol/decode/Decoder.js", import.meta.url).href
);
const { decodeLimits }: typeof Limits = await import(
  new URL("../../../dist/protocol/limits.js", import.meta.url).href
);
const makeDecoder = (options?: Partial<Codec.RespDecodeLimits>) =>
  owned ? makeOwnedRespDecoder(Result.getOrThrow(decodeLimits(options))) : makeRespDecoder(options);

const seed = 20261025;
let randomState = seed;
const random = () => {
  randomState = (randomState * 48271) % 2147483647;
  return randomState;
};

const encoder = new TextEncoder();
const corpus = [
  "+OK\r\n",
  "$3\r\nhey\r\n",
  "*2\r\n:1\r\n:2\r\n",
  "|0\r\n>1\r\n+x\r\n",
  "$?\r\n;2\r\nhi\r\n;0\r\n",
  "%?\r\n+a\r\n:1\r\n.\r\n",
  "*99999999999999999999\r\n",
  "*?\r\n".repeat(24),
];

let rejections = 0;
let emitted = 0;
const cases = 20_000;

for (let index = 0; index < cases; index++) {
  let input: Uint8Array;
  if (index % 2 === 0) {
    input = encoder.encode(corpus[random() % corpus.length] ?? "");
    if (input.length > 0) input[random() % input.length] = random() % 256;
  } else input = Uint8Array.from({ length: random() % 128 }, () => random() % 256);

  const decoder = Result.getOrThrow(
    makeDecoder({
      maxHeaderBytes: 32,
      maxBlobBytes: 128,
      maxBufferedBytes: 512,
      maxAggregateEntries: 32,
      maxNestingDepth: 16,
    }),
  );

  let failed = false;
  const drain = () => {
    for (let step = 0; step <= input.length; step++) {
      const result = decoder.next();
      if (Result.isFailure(result)) {
        if (!(result.failure instanceof ProtocolError))
          throw new Error(`Untyped failure seed=${seed} case=${index}`);
        failed = true;
        rejections++;
        return;
      }
      if (result.success === undefined) return;
      emitted++;
    }
    throw new Error(`Unbounded output seed=${seed} case=${index}`);
  };

  let offset = 0;
  while (offset < input.length && !failed) {
    const width = 1 + (random() % 11);
    const fragment = input.subarray(offset, offset + width);
    const fed = decoder.feed(owned ? fragment.slice() : fragment);
    if (Result.isFailure(fed)) {
      failed = true;
      rejections++;
      break;
    }
    offset += width;
    drain();
  }

  if (!failed) {
    decoder.end();
    drain();
  }
  if (decoder.bufferedBytes !== 0)
    throw new Error(`Retained input after EOF seed=${seed} case=${index}`);
}

const coalescedValues = 1_100_000;
const coalesced = Result.getOrThrow(makeDecoder());
const wire = encoder.encode("+x\r\n".repeat(coalescedValues));
let count = 0;
for (let offset = 0; offset < wire.length; offset += owned ? 65536 : wire.length) {
  // Transferred native chunks must own bounded storage, including their backing allocation.
  Result.getOrThrow(coalesced.feed(owned ? wire.slice(offset, offset + 65536) : wire));
  while (Result.getOrThrow(coalesced.next()) !== undefined) count++;
}
coalesced.end();
if (Result.getOrThrow(coalesced.next()) !== undefined)
  throw new Error("Unexpected value after EOF");
if (count !== coalescedValues || coalesced.bufferedBytes !== 0)
  throw new Error("Coalesced corpus mismatch");

const fragmentedPayloadBytes = 65_536;
const fragmented = Result.getOrThrow(makeDecoder());
Result.getOrThrow(fragmented.feed(encoder.encode(`$${fragmentedPayloadBytes}\r\n`)));
const byte = new Uint8Array([255]);
for (let index = 0; index < fragmentedPayloadBytes; index++) {
  Result.getOrThrow(fragmented.feed(owned ? byte.slice() : byte));
  if (Result.getOrThrow(fragmented.next()) !== undefined)
    throw new Error("Premature blob completion");
}
Result.getOrThrow(fragmented.feed(encoder.encode("\r\n")));
fragmented.end();
const blob = Result.getOrThrow(fragmented.next());
if (
  blob?._tag !== "BlobString" ||
  blob.value.length !== fragmentedPayloadBytes ||
  blob.value.some((value) => value !== 255)
)
  throw new Error("Fragmented blob mismatch");
if (Result.getOrThrow(fragmented.next()) !== undefined || fragmented.bufferedBytes !== 0)
  throw new Error("Fragmented EOF mismatch");

process.stdout.write(
  `${JSON.stringify({ mode: owned ? "owned" : "public", seed, cases, rejections, emitted, coalescedValues, fragmentedPayloadBytes })}\n`,
);
