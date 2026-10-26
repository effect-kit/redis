import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import { Engine, Receipt } from "#test/support/conformance/Contract";
import type { Domain } from "#test/support/conformance/Contract";
import { runLinux } from "#test/support/conformance/Linux";
import { caseId, casesFor } from "#test/support/conformance/Matrix";
import { runRuntimeProgram } from "#test/support/runtime/ChildProgram";
import { dockerServer, allocateServer } from "#test/support/servers/DockerServer";
import { recordFixture } from "#test/support/servers/Evidence";
import { fixtureNetwork } from "#test/support/servers/Network";
import { serverProfile } from "#test/support/servers/Profiles";
import { runtimeImage, bunRuntimeImage, bunRuntimeRevision } from "#test/support/servers/Targets";

/** Every case owns its server, runtime process and mutable state; protocol/runtime outcomes remain separate. */
export const engineCases = (domain: Domain, execution: "host" | "linux" = "host") => {
  const applicable = casesFor(domain, execution);
  if (applicable.length === 0) return;
  it.live.each(applicable)(
    `ENGINE-${domain}-${execution}: $target.fixture $protocol $runtime reviewed semantics`,
    ({ target, protocol, runtime }) =>
      Effect.gen(function* () {
        const network = execution === "linux" ? yield* fixtureNetwork : undefined;
        const server =
          domain === "garnet-lua"
            ? yield* (yield* allocateServer(target, {
                garnetLua: true,
                ...(network === undefined ? {} : { network, networkAlias: "backend" }),
              })).start
            : network === undefined
              ? yield* dockerServer(target)
              : yield* (yield* allocateServer(target, { network, networkAlias: "backend" })).start;
        const engine = Schema.decodeUnknownSync(Engine)(target.product);
        const input = {
          engine,
          version: target.version,
          protocol,
          domain,
          config: {
            endpoint:
              network === undefined
                ? { host: "127.0.0.1", port: server.port }
                : { host: "backend", port: serverProfile(target).port },
            protocol,
          },
        };
        const output =
          network === undefined
            ? yield* runRuntimeProgram({
                runtime,
                program: new URL("../../runners/conformance/main.ts", import.meta.url),
                timeout: 30_000,
                stage: `engine-${domain}`,
                input: JSON.stringify(input),
              })
            : yield* runLinux(runtime, network, input);
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
        expect(receipt.profile.id).toBe(engine);
        if (execution === "linux") expect(receipt.platform).toBe("linux");
        expect(new Set(receipt.observations.map((row) => row.id)).size).toBe(
          receipt.observations.length,
        );

        yield* recordFixture(caseId({ target, protocol, runtime, domain, execution }), {
          runId: process.env.EFFECT_REDIS_TEST_RUN_ID ?? "direct-vitest",
          image: target.reference,
          build: server.build,
          configurationDigest: server.configurationDigest,
          receipt,
        });
      }),
    75_000,
  );
};
