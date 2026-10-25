import { Effect } from "effect";

import { decodeRedisConfig, makeRedisTracking } from "#/index";
import type { TrackingRuntimeOptions } from "#/tracking/Options";
import { reconnecting, sent } from "#test/support/connection/Controlled";
import { acknowledgment } from "#test/support/subscriptions/Fixture";

export const trackingFixture = Effect.fnUntraced(function* (
  protocol: "resp2" | "resp3" = "resp3",
  options: TrackingRuntimeOptions = {},
) {
  const fixture = yield* reconnecting();
  const config = yield* decodeRedisConfig({ endpoint: { host: "localhost" }, protocol });
  const tracking = yield* makeRedisTracking(config, options).pipe(Effect.provide(fixture.layer));
  const [primary, secondary] = fixture.fixtures;
  if (primary === undefined || secondary === undefined)
    return yield* Effect.die("Missing tracking fixture sockets");

  const enable = Effect.gen(function* () {
    if (protocol === "resp3") yield* sent(primary, ["HELLO", "3"], "%1\r\n$5\r\nproto\r\n:3\r\n");
    else {
      yield* sent(secondary, ["CLIENT", "ID"], ":42\r\n");
      yield* sent(
        secondary,
        ["SUBSCRIBE", "__redis__:invalidate"],
        acknowledgment("subscribe", "__redis__:invalidate"),
      );
    }
    yield* sent(
      primary,
      [
        "CLIENT",
        "TRACKING",
        "ON",
        ...(protocol === "resp2" ? ["REDIRECT", "42"] : []),
        ...(options.tracking?.mode === "optin" ? ["OPTIN"] : []),
      ],
      "+OK\r\n",
    );
  });

  return { ...fixture, primary, secondary, config, tracking, enable };
});

export const invalidation = (key: string) =>
  `>2\r\n$10\r\ninvalidate\r\n*1\r\n$${key.length}\r\n${key}\r\n`;
