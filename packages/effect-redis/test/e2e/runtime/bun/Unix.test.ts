import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { bunTargets } from "#test/support/runtime/bun/Targets";
import { recordFixture } from "#test/support/servers/Evidence";
import { unixRuntimeSmoke } from "#test/support/servers/UnixRuntime";

it.live.each(bunTargets)(
  "BUN-UNIX: $fixture pinned Linux runtime uses compiled native client",
  (target) =>
    Effect.gen(function* () {
      const receipt = yield* unixRuntimeSmoke(target, "bun");

      expect(receipt).toMatchObject({
        bun: "1.4.4",
        platform: "linux",
        transport: "unix",
        engine: true,
      });
      yield* recordFixture(`bun-unix-${target.fixture}`, receipt);
    }),
);
