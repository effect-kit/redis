import type { Redacted } from "effect";

import type { GroupEntry, StreamEntry } from "#/commands/streams/Types";

export interface StreamMessage<A = StreamEntry> {
  readonly stream: Uint8Array;
  readonly entry: A;
}

export type GroupMessage = StreamMessage<GroupEntry>;

export type ProcessingOutcome<A, E> =
  // Explicit absent fields preserve the historically inferred shape and stabilize TS7 declaration emission.
  | {
      readonly _tag: "Processed";
      readonly message: GroupMessage;
      readonly result: A;
      readonly error?: never;
    }
  | {
      readonly _tag: "Handled";
      readonly message: GroupMessage;
      readonly result?: never;
      readonly error?: never;
    }
  | {
      readonly _tag: "Pending";
      readonly message: GroupMessage;
      readonly error: Redacted.Redacted<E>;
      readonly result?: never;
    };
