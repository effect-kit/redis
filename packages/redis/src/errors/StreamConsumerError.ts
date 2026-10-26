import { Schema } from "effect";

export class StreamConsumerError extends Schema.TaggedError<StreamConsumerError>()(
  "StreamConsumerError",
  {
    reason: Schema.Literals([
      "tombstone",
      "acknowledgment-missing",
      "invalid-response",
      "invalid-policy",
    ]),
  },
) {}
