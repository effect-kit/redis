import { Effect } from "effect";

import { controlledHttp } from "#test/support/upstash/Controlled";

export const controlledEvents = (initial: string) => {
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let aborted = false;
  let canceled = false;
  const fixture = controlledHttp((_request, signal) =>
    Effect.sync(() => {
      const body = new ReadableStream<Uint8Array>({
        start: (writer) => {
          controller = writer;
          writer.enqueue(new TextEncoder().encode(initial));
        },
        cancel: () => {
          canceled = true;
        },
      });
      signal.addEventListener(
        "abort",
        () => {
          aborted = true;
        },
        { once: true },
      );
      return new Response(body, {
        headers: { "content-type": "text/event-stream; charset=utf-8" },
      });
    }),
  );

  return {
    ...fixture,
    send: (text: string) => Effect.sync(() => controller?.enqueue(new TextEncoder().encode(text))),
    end: Effect.sync(() => controller?.close()),
    aborted: () => aborted,
    canceled: () => canceled,
  };
};
