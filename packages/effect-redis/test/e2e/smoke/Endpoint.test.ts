import { readFile } from "node:fs/promises";

import { expect, it } from "@effect/vitest";
import { Effect, Redacted } from "effect";

import { connect } from "#/node";
import { decodeRedisConfig } from "#/RedisConfig";
import { exchange } from "#test/support/networking/Exchange";
import { readOnlySmoke } from "#test/support/networking/Smoke";
import { FixtureError } from "#test/support/servers/FixtureError";

it.live("explicit existing endpoint: connection-only AUTH and read-only PING/binary ECHO", () =>
  Effect.gen(function* () {
    const url = process.env.EFFECT_REDIS_TEST_URL;
    if (url === undefined) return yield* new FixtureError({ stage: "endpoint-url-required" });

    const caPath = process.env.EFFECT_REDIS_TEST_CA;
    const ca =
      caPath === undefined
        ? undefined
        : yield* Effect.tryPromise({
            try: () => readFile(caPath, "utf8"),
            catch: (cause) =>
              new FixtureError({ stage: "endpoint-ca", cause: Redacted.make(cause) }),
          });

    const config = yield* decodeRedisConfig({
      endpoint: { url, ...(ca === undefined ? {} : { tls: { ca } }) },
    });
    const connection = yield* connect(config);

    if (config.credentials !== undefined) {
      const { username, password } = config.credentials;
      const reply = yield* exchange(connection, [
        "AUTH",
        ...(username === undefined ? [] : [Redacted.value(username)]),
        Redacted.value(password),
      ]);

      // Never include a provider's reply or credentials in assertion output.
      expect(reply._tag === "SimpleString" && new TextDecoder().decode(reply.value) === "OK").toBe(
        true,
      );
    }

    yield* readOnlySmoke(connection);
  }),
);
