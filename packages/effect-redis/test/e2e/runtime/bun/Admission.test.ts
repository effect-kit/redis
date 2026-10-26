import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { runBun } from "#test/support/runtime/bun/Process";
import { bunTargets } from "#test/support/runtime/bun/Targets";
import { dockerServer } from "#test/support/servers/DockerServer";

it.live.each(bunTargets)(
  "BUN-BUDGET: $fixture coalesced replies drain under a small protocol budget",
  (target) =>
    Effect.gen(function* () {
      const server = yield* dockerServer(target);

      const receipt = yield* runBun({
        scenario: "small-buffer",
        config: {
          endpoint: { host: "127.0.0.1", port: server.port },
          protocol: "resp2",
          limits: { maxHeaderBytes: 32, maxBlobBytes: 64, maxBufferedBytes: 128 },
        },
      });

      expect(receipt.checks).toContain("coalesced-native-replies");
    }),
);
