import { Schema } from "effect";

import { ProviderTestError } from "#test/support/providers/Failures";

declare const Deno: {
  readonly version: { readonly deno: string };
  readonly stdin: { readonly readable: ReadableStream<Uint8Array> };
  readonly stdout: { write(bytes: Uint8Array): Promise<number> };
  readonly stderr: { write(bytes: Uint8Array): Promise<number> };
  exitCode: number;
};

export const runtime = () => {
  if (typeof Deno !== "undefined") return { name: "deno", version: Deno.version.deno } as const;
  return typeof Bun === "undefined"
    ? ({ name: "node", version: process.versions.node } as const)
    : ({ name: "bun", version: Bun.version } as const);
};

export const readInput = async <A>(schema: Schema.Codec<A>) => {
  let text = "";
  if (typeof Deno === "undefined") {
    process.stdin.setEncoding("utf8");
    for await (const chunk of process.stdin) {
      text += String(chunk);
      if (text.length > 65536)
        throw new ProviderTestError({ stage: "input", reason: "Input limit" });
    }
  } else {
    const reader = Deno.stdin.readable.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    try {
      while (true) {
        // oxlint-disable-next-line no-await-in-loop -- Pull one chunk at a time under the input budget.
        const chunk = await reader.read();
        if (chunk.done) break;
        text += decoder.decode(chunk.value, { stream: true });
        if (text.length > 65536)
          throw new ProviderTestError({ stage: "input", reason: "Input limit" });
      }
      text += decoder.decode();
    } finally {
      reader.releaseLock();
    }
  }

  try {
    return Schema.decodeUnknownSync(schema)(JSON.parse(text));
  } catch {
    throw new ProviderTestError({ stage: "input", reason: "Invalid runtime input" });
  }
};

export const writeOutput = async (text: string, failed = false) => {
  if (typeof Deno === "undefined") {
    (failed ? process.stderr : process.stdout).write(text);
    if (failed) process.exitCode = 1;
    return;
  }

  const bytes = new TextEncoder().encode(text);
  const destination = failed ? Deno.stderr : Deno.stdout;
  let offset = 0;
  while (offset < bytes.length) {
    // oxlint-disable-next-line no-await-in-loop -- Native stdout writes may be partial and must remain ordered.
    offset += await destination.write(bytes.subarray(offset));
  }
  if (failed) Deno.exitCode = 1;
};
