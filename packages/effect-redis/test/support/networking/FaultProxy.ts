import { createConnection } from "node:net";
import type { Socket } from "node:net";
import { Transform } from "node:stream";

import { Deferred, Effect } from "effect";

import { loopback } from "#test/support/networking/SocketServer";

/** Forwards bytes only; holding replies uses native readable backpressure. TLS can pass through unchanged. */
export const faultProxy = Effect.fnUntraced(function* (
  targetPort: number,
  options?: {
    readonly fragmentBytes?: number;
    readonly holdReplies?: boolean;
    readonly pauseRequests?: boolean;
  },
) {
  const upstreams = new Set<Socket>();
  const release = new Set<() => void>();
  const requests = new Set<() => void>();
  const firstPausedRequest = Deferred.makeUnsafe<void>();
  const firstReply = Deferred.makeUnsafe<void>();
  const failures: Array<Error> = [];

  yield* Effect.addFinalizer(() =>
    Effect.callback<void>((resume) => {
      if (upstreams.size === 0) {
        resume(Effect.void);
        return;
      }

      let pending = upstreams.size;
      for (const socket of upstreams) {
        socket.once("close", () => {
          if (--pending === 0) resume(Effect.void);
        });
        socket.destroy();
      }
    }),
  );

  let repliesReleased = !options?.holdReplies;
  let requestsReleased = !options?.pauseRequests;
  let heldReply: Deferred.Deferred<void> | undefined;
  const markRequest = () => Deferred.doneUnsafe(firstPausedRequest, Effect.void);
  const markReply = () => {
    Deferred.doneUnsafe(firstReply, Effect.void);
    if (heldReply !== undefined) Deferred.doneUnsafe(heldReply, Effect.void);
  };

  const peer = yield* loopback((client) => {
    const upstream = createConnection({ host: "127.0.0.1", port: targetPort });
    upstreams.add(upstream);
    upstream.once("close", () => {
      upstreams.delete(upstream);
      client.destroy();
    });
    upstream.on("error", (error) => {
      if (failures.length < 16) failures.push(error);
      client.destroy();
    });
    client.once("close", () => upstream.destroy());
    upstream.once("readable", markReply);

    const startRequests = () => {
      client.off("readable", markRequest);
      requests.delete(startRequests);
      client.pipe(upstream);
    };

    if (requestsReleased) startRequests();
    else {
      client.once("readable", markRequest);
      requests.add(startRequests);
    }

    const startReplies = () => {
      release.delete(startReplies);
      upstream.off("readable", markReply);
      const size = Math.max(1, options?.fragmentBytes ?? 65536);
      const split = new Transform({
        transform(bytes: Buffer, _encoding, callback) {
          Deferred.doneUnsafe(firstReply, Effect.void);
          const emit = () => {
            for (let offset = 0; offset < bytes.length; offset += size)
              this.push(bytes.subarray(offset, offset + size));
            callback();
          };
          if (repliesReleased) emit();
          else {
            markReply();
            const resume = () => {
              release.delete(resume);
              emit();
            };
            // Holding the transform callback applies native backpressure even if pipe resumes its source.
            release.add(resume);
            this.once("close", () => release.delete(resume));
          }
        },
      });
      upstream.pipe(split).pipe(client);
      client.once("close", () => split.destroy());
    };

    if (repliesReleased) startReplies();
    else release.add(startReplies);
    client.once("close", () => {
      requests.delete(startRequests);
      release.delete(startReplies);
    });
  });

  return {
    port: peer.port,
    firstReply: Deferred.await(firstReply),
    firstPausedRequest: Deferred.await(firstPausedRequest),
    failures,
    releaseReplies: Effect.sync(() => {
      repliesReleased = true;
      for (const start of release) start();
      for (const socket of upstreams) {
        socket.off("readable", markReply);
        socket.resume();
      }
    }),
    holdReplies: Effect.sync(() => {
      repliesReleased = false;
      heldReply = Deferred.makeUnsafe<void>();
      for (const socket of upstreams) {
        socket.pause();
        socket.once("readable", markReply);
        if (socket.readableLength > 0) markReply();
      }
      return Deferred.await(heldReply);
    }),
    resumeRequests: Effect.sync(() => {
      requestsReleased = true;
      for (const start of requests) start();
    }),
    cut: Effect.sync(() => {
      for (const socket of peer.sockets) socket.destroy();
      for (const socket of upstreams) socket.destroy();
    }),
  };
});
