import { Schema } from "effect";

export class SubscriptionError extends Schema.TaggedError<SubscriptionError>()(
  "SubscriptionError",
  {
    reason: Schema.Literals([
      "closed",
      "overflow",
      "capacity",
      "concurrent-consumer",
      "delivery-gap",
      "invalid-frame",
      "acknowledgment",
      "tracking-lost",
      "unsupported-command",
    ]),
    generation: Schema.Number,
  },
) {}
