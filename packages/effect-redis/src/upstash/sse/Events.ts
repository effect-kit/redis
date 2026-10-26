import { Context } from "effect";

import type { makeSubscriptions } from "#/upstash/sse/Subscription";

/** HTTP event capability has its own lifetime and encoding contract, independent of native sessions. */
export class UpstashEvents extends Context.Service<
  UpstashEvents,
  ReturnType<typeof makeSubscriptions>
>()("@envoy1084/effect-redis/UpstashEvents") {}
