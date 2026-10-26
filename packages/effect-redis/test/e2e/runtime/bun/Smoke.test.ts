import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { runBun } from "#test/support/runtime/bun/Process";
import { dockerServer } from "#test/support/servers/DockerServer";
import { recordFixture } from "#test/support/servers/Evidence";
import { selectedEngine, serverTargets } from "#test/support/servers/Targets";

const targets = serverTargets.filter(
  (target) => selectedEngine === "all" || selectedEngine === target.product,
);

it.live.each(targets)(
  "BUN-SMOKE: $fixture binary transport against pinned engine build",
  (target) =>
    Effect.gen(function* () {
      const server = yield* dockerServer(target);

      const receipt = yield* runBun({
        scenario: "smoke",
        config: { endpoint: { host: "127.0.0.1", port: server.port } },
      });

      expect(receipt.checks).toContain("binary-echo");
      yield* recordFixture(`bun-smoke-${target.fixture}`, {
        ...receipt,
        build: server.build,
        configurationDigest: server.configurationDigest,
      });
    }),
);
