import { Effect } from "effect";

import { TransportError } from "#/errors/TransportError";

type Resume = (result: Effect.Effect<Uint8Array | undefined, TransportError>) => void;

/** Bun lends callback bytes; only owned copies may survive the callback. */
export const makeReader = (maximumBytes: number, resumeSocket: () => void) => {
  const chunks: Array<Uint8Array> = [];
  let retainedBytes = 0;
  let offset = 0;
  let reader: Resume | undefined;
  let ended = false;
  let failure: TransportError | undefined;

  const pump = () => {
    if (reader === undefined) return;

    const resume = reader;
    if (failure !== undefined) {
      reader = undefined;
      resume(Effect.fail(failure));
      return;
    }

    const chunk = chunks[0];
    if (chunk !== undefined) {
      const end = Math.min(offset + 64 * 1024, chunk.length);
      const owned = chunk.slice(offset, end);
      offset = end;

      if (offset === chunk.length) {
        chunks.shift();
        retainedBytes -= chunk.length;
        offset = 0;
      }

      reader = undefined;
      resume(Effect.succeed(owned));
    } else if (ended) {
      reader = undefined;
      resume(Effect.succeed(undefined));
    } else {
      resumeSocket();
    }
  };

  const fail = (error: TransportError) => {
    failure ??= error;
    chunks.length = 0;
    retainedBytes = 0;
    offset = 0;
    pump();
  };

  return {
    read: Effect.callback<Uint8Array | undefined, TransportError>((resume) => {
      if (reader !== undefined) {
        resume(Effect.fail(new TransportError({ stage: "read", reason: "unavailable" })));
        return;
      }

      reader = resume;
      pump();

      return Effect.sync(() => {
        if (reader === resume) reader = undefined;
      });
    }),

    receive: (bytes: Uint8Array) => {
      if (failure !== undefined || ended || bytes.length === 0) return;

      // pause() stops future reads, but already scheduled callbacks still need a budget.
      if (bytes.length > maximumBytes - retainedBytes || chunks.length === 128) {
        const error = new TransportError({ stage: "read", reason: "limit" });
        fail(error);
        return error;
      }

      chunks.push(new Uint8Array(bytes));
      retainedBytes += bytes.length;
      pump();
      return undefined;
    },

    end: () => {
      ended = true;
      pump();
    },

    fail,
  };
};
