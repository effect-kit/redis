# RESP codec

Phase 02 implements a runtime-neutral request encoder and incremental RESP decoder.
They perform no networking, negotiation, command routing or retries. Expected failures
are `ProtocolError` values in Effect `Result`; compose them with `Effect.fromResult`.

## Requests

`encodeCommand(command, limits?)` accepts a nonempty readonly tuple of RedisArgument
(string or Uint8Array) and returns Result<Uint8Array, ProtocolError>. It writes an
array of bulk strings and preserves token order, empty arguments and binary data.
Split multiword commands into tokens. Numeric options must already be strings;
objects/numbers are not implicitly converted or JSON-encoded.

String byte lengths match TextEncoder UTF-8, including replacement of isolated UTF-16
surrogates. Measurement checks budgets before encoding/allocating the final frame.
The output owns its bytes; changing a binary argument afterward cannot change it.

Encoder options reuse the relevant phase-01 settings: maxQueuedBytes limits the whole
encoded request including framing, maxBlobBytes limits one argument, and
maxAggregateEntries limits argument count. Defaults are 16 MiB, 64 MiB and 1,000,000.
The encoder does not acquire admission permits or prove server command availability.

## Incremental decoding

`makeRespDecoder(limits?)` returns Result<RespDecoder, ProtocolError>. Both codec
factories accept their relevant limits subset or a validated RedisConfig.limits
object; extra fields are ignored. Schema validates the selected numeric budgets.

- `feed(bytes)` copies an input chunk and returns Result<void, ProtocolError>.
- `next()` parses until one complete RespValue or returns undefined for incomplete/
  exhausted input. Repeated calls drain multiple coalesced values without creating
  an unbounded output array inside the decoder.
- `end()` marks EOF. Drain next() afterward: incomplete headers, payloads, aggregates
  or decorating attributes then fail UnexpectedEnd. Clean EOF repeatedly returns
  undefined. Feeding after EOF is a terminal InvalidState failure.
- `bufferedBytes` exposes conservative retained-wire accounting, described below.

A decoder has one sequential owner. Drain next() between feeds. A feed that exceeds
remaining byte capacity fails before copying: split large transport chunks to fit
`maxBufferedBytes - bufferedBytes`, draining between slices. The connection layer
must coordinate that admission, including a coalesced tail after a large reply.
There is no reset/recovery on a failed decoder; create a new one for a new connection.
Values emitted before a later malformed frame remain available to the caller.

```ts
import { Effect } from "effect";

import { makeRespDecoder } from "effect-redis";

const parseExample = Effect.gen(function* () {
  const decoder = yield* Effect.fromResult(makeRespDecoder());
  yield* Effect.fromResult(decoder.feed(new Uint8Array([58, 52, 50, 13, 10])));
  const reply = yield* Effect.fromResult(decoder.next()); // Integer: 42n
  decoder.end();
  yield* Effect.fromResult(decoder.next()); // clean EOF
  return reply;
});
```

## Supported grammar and ownership

All existing RespValue variants are decoded: simple/blob strings/errors, signed
64-bit integers, big numbers, doubles, booleans, RESP3 null and RESP2 null bulk/array
forms, verbatim strings, arrays, maps, sets, attributes and pushes.

Byte strings remain Uint8Array, including embedded CRLF/NUL/invalid UTF-8. Integers
and big numbers retain bigint precision. Doubles retain their validated wire token,
including -0, exponent notation, inf/-inf/nan and libc NaN spellings from Redis <7.2
(such as -nan, NAN and nan(payload)). A BOM is not stripped from numeric headers.
Optional text/numeric convenience decoding belongs above this codec.

Maps retain ordered pairs and duplicate/binary keys; sets retain their wire members.
Nested errors remain values. Verbatim strings preserve the three-byte format marker
and body separately, validating the separating colon without a format allowlist.

Attributes decorate the following value at any nesting level. Consecutive attributes
remain nested wrappers. Metadata itself does not complete an array child or a command
reply. Pushes are accepted only at the top level (possibly attribute-wrapped), and
must start with a simple/blob string type. Unknown push type strings are preserved.
Consumers must unwrap attributes when classifying a push. This phase does not own
pending-command slots or subscription delivery.

Streamed blob strings (`$?`, length-prefixed `;` chunks, `;0` terminator) and streamed
arrays/maps/sets (`*?`, `%?`, `~?`, `.` terminator) are implemented with the same limits.
Streamed maps require complete key/value pairs. Results use ordinary RespValue shapes;
chunk boundaries/fixed-versus-streamed spelling are not retained as semantic data.

Streamed attributes, pushes, blob errors and verbatim strings are not defined streamed
forms in the referenced RESP3 grammar and are rejected. Private replication/RDB
`$EOF` framing, inline request syntax and ad-hoc MONITOR line mode are outside this
codec. HELLO's ordinary RESP map reply is representable; negotiation is phase 04.

## Limits, copying and failures

- maxHeaderBytes counts the marker plus header content, excluding CRLF. Default 1024.
- maxBlobBytes bounds fixed payload lengths and cumulative streamed blob payloads;
  a verbatim payload includes its format/colon. Default 64 MiB.
- maxAggregateEntries bounds total child value slots across one top-level value,
  including nested containers and attribute metadata/decorated values. A map pair
  consumes two slots. Scalar roots consume none. Default 1,000,000.
- maxNestingDepth counts open aggregate/attribute frames, including empty containers.
  Default 128. Parsing/completion use explicit stacks rather than JS recursion.
- maxBufferedBytes counts queued input plus consumed wire bytes of the current
  unfinished top-level value. It includes framing and bytes represented by already
  completed children. Accounting resets only when a whole value is emitted. Default
  64 MiB + 1024. Long streamed framing may reach this budget before maxBlobBytes.

The byte budget is conservative logical wire retention, not a heap/RSS guarantee.
Independent count/depth bounds constrain object overhead. Input uses owned blocks
(up to 4 KiB) with amortized deque compaction and one reusable cleared spare block.
Headers and payloads grow in blocks without rescanning or repeated full concatenation.
Declarations do not preallocate payloads/element arrays. Completed byte payloads are
joined once into owned arrays; verbatim format/body separation adds bounded copying.
Tiny results never retain the caller's large backing input buffer. Completion may
transiently hold a constant number of payload copies plus block/object overhead;
phase 19 measures practical connection/process budgets.

All expected config/encode/decode failures use ProtocolError: stage, kind, absolute
consumed byte offset, and optional limit/maximum. Syntax errors identify the offending
header or terminator; truncated EOF identifies the consumed end position. Errors
retain no input, value, URL, argument or Schema issue tree. Unexpected implementation
defects propagate; they are not disguised as protocol errors.

After a protocol failure, feed/next return the same error and parser-owned queues,
partial values and builders are released. The eventual connection owner must retire
that physical generation; the decoder never scans ahead and guesses a new boundary.

## Evidence

The tracked [protocol profile](../../spec/protocol.json) owns 27 scenario definitions,
source references, streamed forms and explicit boundaries. The [phase report](../progress/reports/02-protocol.md)
records exact checks, corpus sizes and seeds. Codec passes do not certify servers.

`pnpm test` runs the independent fixtures, every-split/one-byte/truncated-prefix corpus,
malformed/limit/ownership regressions, Effect composition and three seeded properties.
`pnpm test:protocol:fuzz` builds and runs an external 15-second watchdog process with
20,000 deterministic mutation/random cases, 1,100,000 coalesced replies and a 65,536-byte
one-byte-delivery payload. CI runs both lanes. Rejections in fuzz statistics are
expected protocol failures, not failed tests. This is a finite corpus, not a performance
certification or proof over every possible input.

Sources: [Redis protocol reference](https://redis.io/docs/latest/develop/reference/protocol-spec/)
and [RESP3 specification](https://github.com/redis/redis-specifications/blob/master/protocol/RESP3.md).
