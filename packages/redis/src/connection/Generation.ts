import type { Fiber, Scope } from "effect";
import { Cause, Clock, Deferred, Effect, Exit, Queue, Redacted, Result } from "effect";

import type { Admission } from "#/connection/Admission";
import type { Ticket } from "#/connection/Admission";
import { makeDeadlines } from "#/connection/deadline/Coordinator";
import { undecorated } from "#/connection/Handshake";
import type { ConnectionPolicy } from "#/connection/Options";
import type { ReplyReader } from "#/connection/ReplyReader";
import { takeWriteGroup } from "#/connection/WriteGroup";
import { ConnectionError } from "#/errors/ConnectionError";
import type { RespValue } from "#/protocol/RespValue";
import type { TransportConnection } from "#/transport/Transport";

export interface PushReply {
  readonly generation: number;
  readonly value: RespValue;
}

export const makeGeneration = Effect.fnUntraced(function* (
  id: number,
  scope: Scope.Closeable,
  transport: TransportConnection,
  reader: ReplyReader,
  admission: Admission,
  policy: ConnectionPolicy,
  onRetire: () => void,
) {
  const wake = yield* Queue.make<void>({ capacity: 1, strategy: "dropping" });
  const pushes = yield* Queue.make<PushReply & { readonly cost: number }, ConnectionError>({
    capacity: policy.maxPushMessages,
    strategy: "dropping",
  });

  const retired = yield* Deferred.make<void>();
  const closed = yield* Deferred.make<void>();
  const queued: Array<Ticket> = [];
  const pending: Array<Ticket> = [];
  const owned = new Set<Ticket>();

  let ready = false;
  let stopped = false;
  let pushBytes = 0;
  let takePending = false;
  let failure: ConnectionError | undefined;
  let fatal: Cause.Cause<never> | undefined;
  let writerFiber: Fiber.Fiber<unknown, unknown> | undefined;
  let cancelWriteDeadline: (() => void) | undefined;

  const signal = () => {
    Queue.offerUnsafe(wake, undefined);
  };

  const retire = (
    reason: ConnectionError["reason"],
    cause?: unknown,
    defect?: Cause.Cause<never>,
  ) => {
    if (stopped) return;

    fatal = defect;
    stopped = true;
    cancelWriteDeadline?.();
    cancelWriteDeadline = undefined;
    onRetire();
    reader.dispose();
    ready = false;
    failure = new ConnectionError({
      reason,
      generation: id,
      delivery: "unsent",
      ...(cause === undefined ? {} : { cause: Redacted.make(cause) }),
    });

    const tickets = [...owned];
    owned.clear();
    queued.length = 0;
    pending.length = 0;

    for (const ticket of tickets) {
      const uncertain = !ticket.replied && ticket.phase !== "queued";
      if (uncertain) admission.unknownOutcomes++;
      if (defect !== undefined) admission.die(ticket, defect);
      else
        admission.fail(
          ticket,
          new ConnectionError({
            reason,
            generation: id,
            delivery: uncertain ? "possibly-written" : "unsent",
            ...(cause === undefined ? {} : { cause: Redacted.make(cause) }),
          }),
        );
    }

    Queue.failCauseUnsafe(pushes, defect ?? Cause.fail(failure));
    Queue.shutdownUnsafe(pushes);
    pushBytes = 0;
    Deferred.doneUnsafe(retired, Effect.void);
    signal();
  };

  const deadlines = yield* makeDeadlines(scope, 1, (cause) => retire("aborted", cause, cause));

  const push = (value: RespValue, wireBytes: number) =>
    Effect.sync(() => {
      // Wire bytes bound payload retention; decoder entry/depth limits also bound object overhead.
      const cost = wireBytes;
      if (
        stopped ||
        cost > policy.maxPushBytes - pushBytes ||
        !Queue.offerUnsafe(pushes, { generation: id, value, cost })
      ) {
        retire("push-overflow");
        return (
          failure ??
          new ConnectionError({ reason: "push-overflow", generation: id, delivery: "unsent" })
        );
      }

      pushBytes += cost;
      return undefined;
    }).pipe(Effect.flatMap((error) => (error === undefined ? Effect.void : Effect.fail(error))));

  const watch = <A, E>(effect: Effect.Effect<A, E>) =>
    effect.pipe(
      Effect.onExit((exit) =>
        Effect.sync(() => {
          if (Exit.isSuccess(exit) || stopped) return;

          if (Cause.hasDies(exit.cause)) {
            retire(
              "aborted",
              exit.cause,
              Cause.fromReasons(exit.cause.reasons.filter(Cause.isDieReason)),
            );
            return;
          }

          const error = Cause.findError(exit.cause);
          if (Result.isFailure(error)) {
            retire("aborted", undefined, error.failure);
            return;
          }

          const reason =
            error.success instanceof ConnectionError
              ? error.success.reason
              : typeof error.success === "object" &&
                  error.success !== null &&
                  "_tag" in error.success &&
                  error.success._tag === "ProtocolError"
                ? "protocol"
                : "transport";
          retire(reason, error.success);
        }),
      ),
      Effect.catchCause((cause) =>
        Cause.hasDies(cause) || Cause.hasInterrupts(cause) ? Effect.failCause(cause) : Effect.void,
      ),
    );

  const writer = watch(
    Effect.gen(function* () {
      while (true) {
        if (stopped) return;

        const now = yield* Clock.currentTimeMillis;
        const group = yield* Effect.sync(() =>
          ready ? takeWriteGroup(queued, pending, admission, now) : undefined,
        );

        if (group === undefined) {
          yield* Queue.take(wake);
          continue;
        }

        const cancelDeadline = deadlines.schedule(Math.max(1, group.deadlineMillis - now), () => {
          for (const ticket of group.tickets)
            if (ticket.deadlineMillis === group.deadlineMillis) admission.timeout(ticket);
          retire("timeout");
          // The synchronous timer callback must interrupt the scoped writer too:
          // retiring slots alone cannot cancel a native write whose replies already arrived.
          writerFiber?.interruptUnsafe();
        });
        cancelWriteDeadline = cancelDeadline;
        yield* transport.write(group.frame).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              cancelDeadline();
              if (cancelWriteDeadline === cancelDeadline) cancelWriteDeadline = undefined;
            }),
          ),
        );

        yield* Effect.sync(() => {
          for (const ticket of group.tickets) {
            if (ticket.phase === "done") continue;
            ticket.phase = "sent";
            ticket.frame = undefined;
            if (ticket.replied) {
              owned.delete(ticket);
              admission.release(ticket);
            }
          }
        });
      }
    }),
  );

  const read = watch(
    Effect.gen(function* () {
      let turns = 0;

      while (true) {
        if (stopped) return;

        const reply = yield* reader.next;
        if (reply === undefined) {
          retire("closed");
          return;
        }

        if (stopped) return;

        if (undecorated(reply.value)._tag === "Push") yield* push(reply.value, reply.wireBytes);
        else {
          const ticket = pending.shift();
          if (ticket === undefined) {
            retire("protocol");
            return;
          }
          if (ticket.phase !== "writing") owned.delete(ticket);
          admission.succeed(ticket, reply.value);
          signal();
        }

        if (++turns % 64 === 0) yield* Effect.yieldNow;
      }
    }),
  );

  const enqueue = (ticket: Ticket) => {
    if (!ready || stopped) {
      admission.fail(
        ticket,
        failure ??
          new ConnectionError({ reason: "unavailable", generation: id, delivery: "unsent" }),
      );
      return;
    }

    ticket.generation = id;
    ticket.cancel = () => {
      if (ticket.phase === "done" || ticket.replied) return;
      if (ticket.phase !== "queued") {
        // Removing a possibly-written slot would assign its reply to another caller.
        retire("aborted");
        return;
      }

      const index = queued.indexOf(ticket);
      if (index !== -1) queued.splice(index, 1);
      owned.delete(ticket);
      signal();
    };

    owned.add(ticket);
    queued.push(ticket);
    signal();
  };

  const takePush = Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      if (takePending)
        return yield* new ConnectionError({
          reason: "unavailable",
          delivery: "unsent",
          generation: id,
        });

      takePending = true;
      return yield* restore(Queue.take(pushes)).pipe(
        Effect.tap((reply) =>
          Effect.sync(() => {
            pushBytes = Math.max(0, pushBytes - reply.cost);
          }),
        ),
        Effect.map(({ generation, value }) => ({ generation, value })),
        Effect.ensuring(
          Effect.sync(() => {
            takePending = false;
          }),
        ),
      );
    }),
  );

  const start = Effect.gen(function* () {
    ready = true;
    yield* Effect.forkIn(read, scope);
    writerFiber = yield* Effect.forkIn(writer, scope);
  });

  return {
    id,
    scope,
    closed,
    retired,
    start,
    push,
    takePush,
    enqueue,
    retire,
    isReady: () => {
      // Credential rotation can settle native close before the reader fiber observes its wakeup.
      // Fence new admission synchronously; replacement still joins this generation's full cleanup.
      if (transport.isRetired?.() === true) retire("transport");
      return ready && !stopped;
    },
    failure: () => failure,
    fatal: () => fatal,
    pushBytes: () => pushBytes,
  };
});

export type Generation = Effect.Success<ReturnType<typeof makeGeneration>>;
