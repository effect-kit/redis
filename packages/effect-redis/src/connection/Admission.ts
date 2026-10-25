import { Deferred, Effect, Result } from "effect";
import type { Cause } from "effect";

import type { Limits } from "#/config/Limits";
import { AdmissionError } from "#/errors/AdmissionError";
import type { ConnectionError } from "#/errors/ConnectionError";
import type { HandshakeError } from "#/errors/HandshakeError";
import type { ProtocolError } from "#/errors/ProtocolError";
import { encodeCommand } from "#/protocol/encode";
import type { RedisCommand } from "#/protocol/encode";
import type { RespValue } from "#/protocol/RespValue";

export type ExecutionError = AdmissionError | ConnectionError | HandshakeError | ProtocolError;

export interface Ticket {
  readonly result: Deferred.Deferred<RespValue, ExecutionError>;
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
}

/** Transitions are synchronous: counters and ownership change before any waiter is resumed. */
export class Admission {
  readonly tickets = new Set<Ticket>();
  drained = Deferred.makeUnsafe<void>();
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

  constructor(readonly limits: Limits) {}

  reserve(
    command: RedisCommand,
    queuedAt: number,
    timeoutMillis: number,
  ): Ticket | AdmissionError | ProtocolError {
    const reject = (reason: AdmissionError["reason"]) => {
      this.rejected++;
      return new AdmissionError({ reason, delivery: "unsent" });
    };

    if (this.queuedCommands >= this.limits.maxQueuedCommands) return reject("count");

    const capacity = Math.min(
      this.limits.maxQueuedBytes - this.queuedBytes,
      this.limits.maxInFlightBytes,
    );
    if (capacity === 0) return reject("bytes");

    // The encoder measures before allocating; rejected work cannot allocate a full frame outside admission.
    const encoded = encodeCommand(command, { ...this.limits, maxQueuedBytes: capacity });

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
    if (this.tickets.size === 0) this.drained = Deferred.makeUnsafe();

    const ticket: Ticket = {
      result: Deferred.makeUnsafe(),
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
    if (ticket.phase === "queued") {
      this.queuedCommands--;
      this.queuedBytes -= ticket.bytes;
    } else {
      this.inFlightCommands--;
      this.inFlightBytes -= ticket.bytes;
    }

    ticket.phase = "done";
    ticket.frame = undefined;
    ticket.cancel = undefined;
    this.tickets.delete(ticket);
    if (this.tickets.size === 0) Deferred.doneUnsafe(this.drained, Effect.void);
  }

  succeed(ticket: Ticket, reply: RespValue) {
    ticket.replied = true;
    this.replies++;

    // A reply may beat the write callback; release its bytes only after both complete.
    if (ticket.phase !== "writing") this.release(ticket);
    Deferred.doneUnsafe(ticket.result, Effect.succeed(reply));
  }

  fail(ticket: Ticket, error: ExecutionError) {
    this.release(ticket);
    Deferred.doneUnsafe(ticket.result, Effect.fail(error));
  }

  die(ticket: Ticket, cause: Cause.Cause<never>) {
    this.release(ticket);
    Deferred.doneUnsafe(ticket.result, Effect.failCause(cause));
  }
}
