import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import { Engine, Receipt } from "#test/support/conformance/Contract";
import type { Domain } from "#test/support/conformance/Contract";
import { runRuntimeProgram } from "#test/support/runtime/ChildProgram";
import { selectRuntime } from "#test/support/runtime/Selection";
import { dockerServer } from "#test/support/servers/DockerServer";
import { recordFixture } from "#test/support/servers/Evidence";
import {
  selectedEngine,
  serverTargets,
  runtimeImage,
  bunRuntimeImage,
  bunRuntimeRevision,
} from "#test/support/servers/Targets";

const selected = selectRuntime(process.env.EFFECT_REDIS_TEST_RUNTIME);
const runtimes: ReadonlyArray<"node" | "bun"> = selected === "all" ? ["node", "bun"] : [selected];
const cases = serverTargets
  .filter(
    (target) =>
      target.fixture === target.product &&
      (selectedEngine === "all" || selectedEngine === target.product),
  )
  .flatMap((target) =>
    ["resp2", "resp3"].flatMap((protocol) =>
      runtimes.map((runtime) => ({ target, protocol, runtime })),
    ),
  );

/** Every case owns its server, runtime process and mutable state; protocol/runtime outcomes remain separate. */
export const engineCases = (domain: Domain) => {
  it.live.each(cases)(
    `ENGINE-${domain}: $target.fixture $protocol $runtime reviewed semantics`,
    ({ target, protocol, runtime }) =>
      Effect.gen(function* () {
        const server = yield* dockerServer(target);
        const engine = Schema.decodeUnknownSync(Engine)(target.product);
        const output = yield* runRuntimeProgram({
          runtime,
          program: new URL("../../runners/conformance/main.ts", import.meta.url),
          timeout: 30_000,
          stage: `engine-${domain}`,
          input: JSON.stringify({
            engine,
            version: target.version,
            protocol,
            domain,
            config: { endpoint: { host: "127.0.0.1", port: server.port }, protocol },
          }),
        });
        const receipt = Schema.decodeUnknownSync(Receipt)(JSON.parse(output));
        expect(receipt).toMatchObject({
          runtime,
          engine,
          protocol,
          domain,
          version: target.version,
          runtimeVersion: runtime === "node" ? runtimeImage.version : bunRuntimeImage.version,
        });
        if (runtime === "bun") expect(receipt.runtimeRevision).toBe(bunRuntimeRevision);
        expect(new Set(receipt.observations.map((row) => row.id)).size).toBe(
          receipt.observations.length,
        );

        yield* recordFixture(`engine-${target.fixture}-${protocol}-${runtime}-${domain}`, {
          image: target.reference,
          build: server.build,
          configurationDigest: server.configurationDigest,
          receipt,
        });
      }),
    45_000,
  );
};
