import { Effect } from "effect";

import type { RuntimeInput } from "#test/support/runtime/bun/Input";

export type TopologyInput = Extract<RuntimeInput, { scenario: "cluster" | "sentinel" }>;

export const addressMap =
  (input: TopologyInput) => (address: { readonly host: string; readonly port: number }) => {
    const mapped = input.addresses.find((candidate) => candidate.host === address.host);
    return mapped === undefined
      ? address
      : { host: "127.0.0.1", port: mapped.port, serverName: "localhost" };
  };

export const topologyBarrier = Effect.fnUntraced(function* (input: TopologyInput, stage: number) {
  for (const path of [`arrive/${stage}`, `continue/${stage}`]) {
    yield* Effect.tryPromise({
      try: async () => {
        const response = await fetch(`${input.barrier}/${path}`);
        if (response.status !== 204) throw new Error("Runtime barrier rejected");
      },
      catch: () => new Error("Runtime barrier failed"),
    });
  }
});
