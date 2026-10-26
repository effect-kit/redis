import { Schema } from "effect";

import { HttpScenario, Prefix } from "#test/support/providers/Contract";

const Input = Schema.Struct({ scenario: HttpScenario, prefix: Prefix });

/** Bound chunked bodies during consumption; Content-Length alone is not an allocation limit. */
export const workerInput = async (
  request: Request,
): Promise<typeof Input.Type | "invalid" | "too-large"> => {
  if (Number(request.headers.get("content-length")) > 1024) return "too-large";
  if (request.body === null) return "invalid";

  const reader = request.body.getReader();
  const bytes = new Uint8Array(1024);
  let length = 0;
  try {
    while (true) {
      // oxlint-disable-next-line no-await-in-loop -- Sequential pulls enforce the retained-byte bound.
      const chunk = await reader.read();
      if (chunk.done) break;
      if (chunk.value.length > bytes.length - length) {
        // oxlint-disable-next-line no-await-in-loop -- Join cancellation before releasing the reader.
        await reader.cancel();
        return "too-large";
      }
      bytes.set(chunk.value, length);
      length += chunk.value.length;
    }

    return Schema.decodeUnknownSync(Input)(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length))),
    );
  } catch {
    return "invalid";
  } finally {
    reader.releaseLock();
  }
};
