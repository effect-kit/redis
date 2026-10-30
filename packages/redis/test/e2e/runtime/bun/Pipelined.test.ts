import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { runBun } from "#test/support/runtime/bun/Process";
import { bunCases } from "#test/support/runtime/bun/Targets";
import { dockerServer } from "#test/support/servers/DockerServer";

it.live.each(bunCases)(
  "BUN-PIPELINED: $target.fixture $protocol uses profiled transactions and direct values",
  ({ target, protocol }) =>
    Effect.gen(function* () {
      const server = yield* dockerServer(target);
      const receipt = yield* runBun({
        scenario: "pipelined-transactions",
        engine: target.product === "redis" ? "redis" : "valkey",
        config: { endpoint: { host: "127.0.0.1", port: server.port }, protocol },
      });

      expect(receipt.checks).toEqual([
        "profiled-transaction",
        "queue-abort",
        "watch-conflict",
        "lease-reuse",
        "direct-values",
      ]);
    }),
);
