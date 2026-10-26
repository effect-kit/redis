import { Effect, Redacted, Schema } from "effect";

import { requiredSetting } from "#test/support/providers/Configuration";
import type { ProviderEnvironment } from "#test/support/providers/Configuration";
import { ProviderTestError } from "#test/support/providers/Failures";

const fail = (stage: string, status?: number) =>
  new ProviderTestError({
    stage,
    reason: status === undefined ? "Cloudflare request failed" : `Cloudflare HTTP ${status}`,
  });

export const cloudflareApi = (env: ProviderEnvironment) => {
  const account = Redacted.value(
    requiredSetting(env.CLOUDFLARE_ACCOUNT_ID, "CLOUDFLARE_ACCOUNT_ID"),
  );
  if (!/^[a-f0-9]{32}$/.test(account)) throw fail("cloudflare-config");
  const name = requiredSetting(env.EFFECT_REDIS_TEST_WORKER_NAME, "EFFECT_REDIS_TEST_WORKER_NAME");
  const root = `https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/${name}`;

  const request = (suffix: string, init: RequestInit = {}) =>
    Effect.tryPromise({
      try: async (signal) => {
        const response = await fetch(root + suffix, {
          ...init,
          signal,
          redirect: "error",
          headers: {
            authorization: `Bearer ${Redacted.value(requiredSetting(env.CLOUDFLARE_API_TOKEN, "CLOUDFLARE_API_TOKEN"))}`,
          },
        });
        if (!response.ok) {
          await response.body?.cancel();
          throw fail("cloudflare-api", response.status);
        }
        return response;
      },
      catch: (error) => (error instanceof ProviderTestError ? error : fail("cloudflare-api")),
    }).pipe(
      Effect.timeoutOrElse({
        duration: 30_000,
        orElse: () => Effect.fail(fail("cloudflare-timeout")),
      }),
    );

  const json = <A>(suffix: string, schema: Schema.Codec<A>, init?: RequestInit) =>
    request(suffix, init).pipe(
      Effect.flatMap((response) =>
        Effect.tryPromise({
          try: async () =>
            Schema.decodeUnknownSync(
              Schema.Struct({ success: Schema.Literal(true), result: schema }),
            )(await response.json()).result,
          catch: () => fail("cloudflare-response"),
        }),
      ),
    );

  return { request, json };
};
