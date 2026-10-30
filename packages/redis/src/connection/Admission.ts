import { Deferred, Effect, Exit, Result } from "effect";
import type { Cause } from "effect";

import type { Limits } from "#/config/Limits";
import { completeReply } from "#/connection/Completion";
import { AdmissionError } from "#/errors/AdmissionError";
import type { ConnectionError } from "#/errors/ConnectionError";
import type { HandshakeError } from "#/errors/HandshakeError";
import type { ProfileError } from "#/errors/ProfileError";
import type { ProtocolError } from "#/errors/ProtocolError";
import { encodeCommandWithLimits } from "#/protocol/encode";
import type { RedisCommand } from "#/protocol/encode";
import { encodeBatchWithLimits } from "#/protocol/encodeBatch";
import { encodeGroups } from "#/protocol/encodeGroups";
import type { RespValue } from "#/protocol/RespValue";

export type ExecutionError =
  | AdmissionError
  | ConnectionError
  | HandshakeError
  | ProtocolError
  | ProfileError;

export interface Ticket {
  result: Deferred.Deferred<RespValue, ExecutionError> | undefined;
  outcome: Exit.Exit<RespValue, ExecutionError> | undefined;
  readonly bytes: number;
  readonly queuedAt: number;
  readonly deadlineMillis: number;
  timedOut: boolean;
  frame: Uint8Array | undefined;
  phase: "queued" | "writing" | "sent" | "done";
  replied: boolean;
  mayHaveBeenWritten: boolean;
  generation: number;
  cancel: (() => void) | undefined;
  writeGroup: symbol | undefined;
  cancelDeadline: (() => void) | undefined;
  batchIndex: number;
  onResult: ((exit: Exit.Exit<RespValue, ExecutionError>, ticket: Ticket) => void) | undefined;
}

/** Transitions are synchronous: counters and ownership change before any waiter is resumed. */
export class Admission {
  readonly tickets = new Set<Ticket>();
  drained = Deferred.makeUnsafe<void>();
  private retainedBytes = 0;
  private readonly slabs = new WeakMap<Ticket, { remaining: number; readonly bytes: number }>();
  queuedCommands = 0;
  queuedBytes = 0;
  inFlightCommands = 0;
  inFlightBytes = 0;

  admitted = 0;
  rejected = 0;
  replies = 0;
  cancellations = 0;
  timeouts = 0;
  unknownOutcomes = 0;
  queueWaitMillis = 0;

  readonly limits: Limits;

  constructor(limits: Limits) {
    this.limits = Object.freeze({ ...limits });
  }

  reserve(
    command: RedisCommand,
    queuedAt: number,
    timeoutMillis: number,
  ): Ticket | AdmissionError | ProtocolError {
    return this.reserveWith(queuedAt, timeoutMillis, (capacity) =>
      encodeCommandWithLimits(command, this.limits, capacity),
    );
  }

  reserveExchange(commands: ReadonlyArray<RedisCommand>, queuedAt: number, timeoutMillis: number) {
    return this.reserveWith(queuedAt, timeoutMillis, (capacity) =>
      encodeBatchWithLimits(commands, this.limits, capacity),
    );
  }

  reserveBatch(commands: ReadonlyArray<RedisCommand>, queuedAt: number, timeoutMillis: number) {
    const reject = (reason: AdmissionError["reason"]) => {
      this.rejected++;
      return new AdmissionError({ reason, delivery: "unsent" });
    };
    if (commands.length > this.limits.maxQueuedCommands - this.queuedCommands)
      return reject("count");

    const capacity = Math.min(
      this.limits.maxQueuedBytes - this.queuedBytes,
      this.limits.maxQueuedBytes + this.limits.maxInFlightBytes - this.retainedBytes,
    );
    const encoded = encodeGroups(
      commands,
      this.limits,
      capacity,
      this.limits.maxInFlightCommands,
      this.limits.maxInFlightBytes,
    );
    if (Result.isFailure(encoded)) {
      return encoded.failure.limit === "maxQueuedBytes"
        ? reject(
            encoded.failure.maximum === this.limits.maxInFlightBytes ||
              (this.queuedBytes === 0 && encoded.failure.maximum === capacity)
              ? "oversized"
              : "bytes",
          )
        : encoded.failure;
    }

    const tickets: Ticket[] = [];
    for (const frames of encoded.success) {
      const slab = {
        remaining: frames.length,
        bytes: frames.reduce((sum, frame) => sum + frame.length, 0),
      };
      this.retainedBytes += slab.bytes;
      const writeGroup = Symbol();
      for (const frame of frames) {
        const ticket = this.register(frame, queuedAt, timeoutMillis);
        ticket.writeGroup = writeGroup;
        this.slabs.set(ticket, slab);
        tickets.push(ticket);
      }
    }
    return tickets;
  }

  private reserveWith(
    queuedAt: number,
    timeoutMillis: number,
    encode: (capacity: number) => Result.Result<Uint8Array, ProtocolError>,
  ): Ticket | AdmissionError | ProtocolError {
    const reject = (reason: AdmissionError["reason"]) => {
      this.rejected++;
      return new AdmissionError({ reason, delivery: "unsent" });
    };

    if (this.queuedCommands >= this.limits.maxQueuedCommands) return reject("count");

    const capacity = Math.min(
      this.limits.maxQueuedBytes - this.queuedBytes,
      this.limits.maxInFlightBytes,
      this.limits.maxQueuedBytes + this.limits.maxInFlightBytes - this.retainedBytes,
    );
    if (capacity === 0) return reject("bytes");

    // The encoder measures before allocating; rejected work cannot allocate a full frame outside admission.
    const encoded = encode(capacity);

    if (Result.isFailure(encoded)) {
      if (encoded.failure.limit === "maxQueuedBytes")
        return reject(
          capacity === this.limits.maxInFlightBytes || this.queuedBytes === 0
            ? "oversized"
            : "bytes",
        );

      return encoded.failure;
    }

    const frame = encoded.success;
    this.retainedBytes += frame.length;
    return this.register(frame, queuedAt, timeoutMillis);
  }

  private register(frame: Uint8Array, queuedAt: number, timeoutMillis: number): Ticket {
    if (this.tickets.size === 0) this.drained = Deferred.makeUnsafe();

    const ticket: Ticket = {
      result: undefined,
      outcome: undefined,
      bytes: frame.length,
      frame,
      queuedAt,
      deadlineMillis: queuedAt + timeoutMillis,
      timedOut: false,
      phase: "queued",
      replied: false,
      mayHaveBeenWritten: false,
      generation: 0,
      cancel: undefined,
      writeGroup: undefined,
      cancelDeadline: undefined,
      batchIndex: 0,
      onResult: undefined,
    };

    this.tickets.add(ticket);
    this.queuedCommands++;
    this.queuedBytes += frame.length;
    this.admitted++;

    return ticket;
  }

  canWrite(ticket: Ticket) {
    return (
      this.inFlightCommands < this.limits.maxInFlightCommands &&
      ticket.bytes <= this.limits.maxInFlightBytes - this.inFlightBytes
    );
  }

  timeout(ticket: Ticket) {
    if (ticket.timedOut) return;
    ticket.timedOut = true;
    this.timeouts++;
  }

  begin(ticket: Ticket, now: number) {
    this.queuedCommands--;
    this.queuedBytes -= ticket.bytes;
    this.inFlightCommands++;
    this.inFlightBytes += ticket.bytes;
    this.queueWaitMillis += Math.max(0, now - ticket.queuedAt);
    ticket.phase = "writing";
    ticket.mayHaveBeenWritten = true;
  }

  release(ticket: Ticket) {
    if (ticket.phase === "done") return;
    this.clearDeadline(ticket);
    if (ticket.phase === "queued") {
      this.queuedCommands--;
      this.queuedBytes -= ticket.bytes;
    } else {
      this.inFlightCommands--;
      this.inFlightBytes -= ticket.bytes;
    }

    const slab = this.slabs.get(ticket);
    if (slab === undefined) this.retainedBytes -= ticket.bytes;
    else if (--slab.remaining === 0) this.retainedBytes -= slab.bytes;
    this.slabs.delete(ticket);

    ticket.phase = "done";
    ticket.frame = undefined;
    ticket.cancel = undefined;
    this.tickets.delete(ticket);
    if (this.tickets.size === 0) Deferred.doneUnsafe(this.drained, Effect.void);
  }

  succeed(ticket: Ticket, reply: RespValue) {
    ticket.replied = true;
    this.replies++;
    this.clearDeadline(ticket);

    // A reply may beat the write callback; release its bytes only after both complete.
    if (ticket.phase !== "writing") this.release(ticket);
    completeReply(ticket, Exit.succeed(reply));
  }

  fail(ticket: Ticket, error: ExecutionError) {
    this.release(ticket);
    this.notifyFailure(ticket, error);
  }

  /** Deadlines publish their exact failure before cancellation retires neighboring FIFO slots. */
  notifyFailure(ticket: Ticket, error: ExecutionError) {
    completeReply(ticket, Exit.fail(error));
  }

  die(ticket: Ticket, cause: Cause.Cause<never>) {
    this.release(ticket);
    completeReply(ticket, Exit.failCause(cause));
  }

  private clearDeadline(ticket: Ticket) {
    ticket.cancelDeadline?.();
    ticket.cancelDeadline = undefined;
  }
}
