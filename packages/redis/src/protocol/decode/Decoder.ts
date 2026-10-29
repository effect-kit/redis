import { Predicate, Result } from "effect";

import { failProtocol, ProtocolError } from "#/errors/ProtocolError";
import { completeAggregate } from "#/protocol/decode/aggregates";
import type { AggregateFrame } from "#/protocol/decode/aggregates";
import { ByteBuilder, ByteQueue } from "#/protocol/decode/buffers";
import { readLength, scalar } from "#/protocol/decode/scalars";
import { decodeLimits } from "#/protocol/limits";
import type { RespDecodeLimits } from "#/protocol/limits";
import type { RespValue } from "#/protocol/RespValue";

const maximumContiguousBlobBytes = 64 * 1024;

interface BlobFrame {
  readonly tag: "BlobString" | "BlobError" | "VerbatimString";
  readonly streamed: boolean;
  readonly bytes: ByteBuilder;
  remaining: number | undefined;
  terminator: number;
}

export interface RespDecoder {
  /** Copies input. Drain next() between feeds; overflow or misuse is terminal. */
  readonly feed: (bytes: Uint8Array) => Result.Result<void, ProtocolError>;
  /** One value per call; undefined means no complete value. Check again after end(). */
  readonly next: () => Result.Result<RespValue | undefined, ProtocolError>;
  /** Marks EOF; next() drains remaining values and reports any truncated frame. */
  readonly end: () => void;
  /** Queued plus consumed wire bytes of the current incomplete top-level value. */
  readonly bufferedBytes: number;
}

class Decoder implements RespDecoder {
  private readonly queue: ByteQueue;
  private readonly blockSize: number;
  private frames: Array<AggregateFrame> = [];
  private blob: BlobFrame | undefined;
  private marker: number | undefined;
  private line: ByteBuilder | undefined;
  private carriageReturn = false;
  private headerOffset = 0;
  private frameStart = 0;
  private elements = 0;
  private ended = false;
  private failure: ProtocolError | undefined;

  constructor(
    private readonly limits: RespDecodeLimits,
    private readonly ownedInput = false,
  ) {
    this.blockSize = Math.min(4096, limits.maxBufferedBytes);
    this.queue = new ByteQueue(this.blockSize);
  }

  get bufferedBytes(): number {
    return this.queue.size + this.queue.offset - this.frameStart;
  }

  feed(bytes: Uint8Array): Result.Result<void, ProtocolError> {
    if (this.failure !== undefined) return Result.fail(this.failure);

    if (!Predicate.isUint8Array(bytes))
      return this.retire(
        new ProtocolError({ stage: "decode", kind: "InvalidArguments", offset: this.queue.offset }),
      );

    if (this.ended)
      return this.retire(
        new ProtocolError({ stage: "decode", kind: "InvalidState", offset: this.queue.offset }),
      );

    if (bytes.length > this.limits.maxBufferedBytes - this.bufferedBytes) {
      return this.retire(
        new ProtocolError({
          stage: "decode",
          kind: "LimitExceeded",
          offset: this.queue.offset,
          limit: "maxBufferedBytes",
          maximum: this.limits.maxBufferedBytes,
        }),
      );
    }

    // Bound backing storage as well as the view. Public feeds always snapshot.
    if (
      this.ownedInput &&
      bytes.buffer.byteLength <= Math.min(maximumContiguousBlobBytes, this.limits.maxBufferedBytes)
    )
      this.queue.appendOwned(bytes);
    else this.queue.append(bytes);
    return Result.succeed(undefined);
  }

  end(): void {
    this.ended = true;
  }

  next(): Result.Result<RespValue | undefined, ProtocolError> {
    if (this.failure !== undefined) return Result.fail(this.failure);

    try {
      return Result.succeed(this.parse());
    } catch (error) {
      if (error instanceof ProtocolError) return this.retire(error);
      throw error;
    }
  }

  private retire(error: ProtocolError): Result.Result<never, ProtocolError> {
    this.failure = error;
    this.queue.clear();
    this.frames = [];
    this.blob = undefined;
    this.line = undefined;
    this.marker = undefined;
    this.frameStart = this.queue.offset;

    return Result.fail(error);
  }

  private parse(): RespValue | undefined {
    while (true) {
      if (this.blob?.remaining !== undefined) {
        const blob = this.blob;
        const remaining = this.blob.remaining;
        blob.remaining = remaining - this.queue.copyTo(blob.bytes, remaining);
        if (blob.remaining > 0) return this.incomplete();

        while (blob.terminator < 2) {
          const byte = this.queue.readByte();
          if (byte === undefined) return this.incomplete();
          if (byte !== (blob.terminator === 0 ? 13 : 10))
            failProtocol("InvalidTerminator", this.queue.offset - 1);
          blob.terminator++;
        }

        blob.remaining = undefined;
        blob.terminator = 0;
        if (!blob.streamed) {
          const value = this.finishBlob(blob);
          const completed = this.accept(value);
          if (completed !== undefined) return completed;
        }
        continue;
      }

      if (this.marker === undefined) {
        const marker = this.queue.readByte();
        if (marker === undefined) return this.incomplete();
        this.headerOffset = this.queue.offset - 1;
        if (!"+-:(_#,$!=*%~>|;.".includes(String.fromCharCode(marker)))
          failProtocol("InvalidType", this.headerOffset);
        if ((this.blob !== undefined) !== (marker === 59))
          failProtocol("InvalidType", this.headerOffset);
        if (marker !== 46 && marker !== 59 && this.frames.length > 0) {
          if (++this.elements > this.limits.maxAggregateEntries)
            failProtocol(
              "LimitExceeded",
              this.headerOffset,
              "maxAggregateEntries",
              this.limits.maxAggregateEntries,
            );
        }

        this.marker = marker;
        this.line = new ByteBuilder(Math.min(256, this.limits.maxHeaderBytes));
        this.carriageReturn = false;
      }

      const line = this.line;
      if (line === undefined) throw new Error("Header ownership invariant");

      let terminated = false;

      while (this.queue.size > 0) {
        const byte = this.queue.readByte();
        if (byte === undefined) throw new Error("Header queue invariant");
        if (this.carriageReturn) {
          if (byte !== 10) failProtocol("InvalidTerminator", this.queue.offset - 1);
          terminated = true;
          break;
        }

        if (byte === 10) failProtocol("InvalidTerminator", this.queue.offset - 1);
        if (byte === 13) this.carriageReturn = true;
        else {
          if (line.length + 2 > this.limits.maxHeaderBytes)
            failProtocol(
              "LimitExceeded",
              this.queue.offset - 1,
              "maxHeaderBytes",
              this.limits.maxHeaderBytes,
            );
          line.push(byte);
        }
      }

      if (!terminated) return this.incomplete();

      const marker = this.marker;
      const bytes = line.finish();
      this.marker = undefined;
      this.line = undefined;

      const value = this.header(marker, bytes);
      if (value !== undefined) {
        const completed = this.accept(value);
        if (completed !== undefined) return completed;
      }
    }
  }

  private incomplete(): undefined {
    if (
      this.ended &&
      (this.marker !== undefined || this.blob !== undefined || this.frames.length > 0)
    )
      failProtocol("UnexpectedEnd", this.queue.offset);

    return undefined;
  }

  private header(marker: number, bytes: Uint8Array): RespValue | undefined {
    // Dot closes a streamed aggregate; semicolon introduces a streamed blob chunk.
    if (marker === 46) {
      const frame = this.frames.at(-1);
      if (bytes.length !== 0 || frame === undefined || frame.expected !== undefined)
        return failProtocol("InvalidTerminator", this.headerOffset);
      this.frames.pop();
      return completeAggregate(frame);
    }

    if (marker === 59) {
      const blob = this.blob;
      if (blob === undefined) return failProtocol("InvalidType", this.headerOffset);
      const count = readLength(
        bytes,
        this.limits.maxBlobBytes - blob.bytes.length,
        this.headerOffset,
        "maxBlobBytes",
      );
      if (count === 0) return this.finishBlob(blob);
      blob.remaining = count;
      return undefined;
    }

    if (marker === 36 || marker === 33 || marker === 61) {
      if (marker === 36 && bytes.length === 2 && bytes[0] === 45 && bytes[1] === 49)
        return { _tag: "Null", kind: "bulk" };
      const streamed = marker === 36 && bytes.length === 1 && bytes[0] === 63;
      const count = streamed
        ? undefined
        : readLength(bytes, this.limits.maxBlobBytes, this.headerOffset, "maxBlobBytes");
      if (marker === 61 && count !== undefined && count < 4)
        return failProtocol("InvalidVerbatim", this.headerOffset);

      // Known bounded blobs can fill their final storage directly. Large announcements
      // retain incremental allocation, including declarations that cannot fit the wire budget.
      const contiguous =
        count !== undefined &&
        count <= maximumContiguousBlobBytes &&
        count + 2 <= this.limits.maxBufferedBytes - this.bufferedBytes;
      this.blob = {
        tag: marker === 36 ? "BlobString" : marker === 33 ? "BlobError" : "VerbatimString",
        streamed,
        bytes: new ByteBuilder(
          Math.max(1, contiguous ? count : Math.min(this.blockSize, count ?? this.blockSize)),
        ),
        remaining: count,
        terminator: 0,
      };
      return undefined;
    }

    if (marker === 42 || marker === 37 || marker === 126 || marker === 62 || marker === 124)
      return this.aggregate(marker, bytes);

    return scalar(marker, bytes, this.headerOffset);
  }

  private aggregate(marker: number, bytes: Uint8Array): RespValue | undefined {
    if (marker === 42 && bytes.length === 2 && bytes[0] === 45 && bytes[1] === 49)
      return { _tag: "Null", kind: "array" };
    if (this.frames.length + 1 > this.limits.maxNestingDepth)
      return failProtocol(
        "LimitExceeded",
        this.headerOffset,
        "maxNestingDepth",
        this.limits.maxNestingDepth,
      );

    // Pushes can carry attributes, but cannot occupy an ordinary aggregate reply slot.
    if (
      marker === 62 &&
      this.frames.some(
        (frame) => frame.tag !== "Attribute" || frame.values.length !== frame.metadataCount,
      )
    )
      return failProtocol("InvalidPush", this.headerOffset);

    const streamed =
      bytes.length === 1 && bytes[0] === 63 && (marker === 42 || marker === 37 || marker === 126);
    const count = streamed
      ? undefined
      : readLength(
          bytes,
          this.limits.maxAggregateEntries,
          this.headerOffset,
          "maxAggregateEntries",
        );
    const multiplier = marker === 37 || marker === 124 ? 2 : 1;
    const extra = marker === 124 ? 1 : 0;
    if (
      count !== undefined &&
      count > Math.floor((this.limits.maxAggregateEntries - this.elements - extra) / multiplier)
    )
      return failProtocol(
        "LimitExceeded",
        this.headerOffset,
        "maxAggregateEntries",
        this.limits.maxAggregateEntries,
      );

    const expected = count === undefined ? undefined : count * multiplier + extra;
    const frame: AggregateFrame = {
      tag:
        marker === 42
          ? "Array"
          : marker === 37
            ? "Map"
            : marker === 126
              ? "Set"
              : marker === 62
                ? "Push"
                : "Attribute",
      expected,
      metadataCount: count === undefined ? 0 : count * multiplier,
      values: [],
      offset: this.headerOffset,
    };

    if (expected === 0) return completeAggregate(frame);
    this.frames.push(frame);
    return undefined;
  }

  private finishBlob(blob: BlobFrame): RespValue {
    this.blob = undefined;
    const bytes = blob.bytes.finish();

    if (blob.tag === "VerbatimString") {
      if (bytes[3] !== 58) return failProtocol("InvalidVerbatim", this.headerOffset);
      return { _tag: "VerbatimString", format: bytes.slice(0, 3), value: bytes.slice(4) };
    }

    return { _tag: blob.tag, value: bytes };
  }

  private accept(incoming: RespValue): RespValue | undefined {
    let value = incoming;

    while (true) {
      const frame = this.frames.at(-1);
      if (frame === undefined) {
        this.frameStart = this.queue.offset;
        this.elements = 0;
        return value;
      }

      frame.values.push(value);
      if (frame.expected === undefined || frame.values.length < frame.expected) return undefined;

      this.frames.pop();
      value = completeAggregate(frame);
    }
  }
}

export const makeRespDecoder = (
  options?: Partial<RespDecodeLimits>,
): Result.Result<RespDecoder, ProtocolError> =>
  decodeLimits(options).pipe(Result.map((limits) => new Decoder(limits)));

/** Internal only: each feed transfers bounded native storage to this decoder. */
export const makeOwnedRespDecoder = (
  options: RespDecodeLimits,
): Result.Result<RespDecoder, ProtocolError> =>
  decodeLimits(options).pipe(Result.map((limits) => new Decoder(limits, true)));
