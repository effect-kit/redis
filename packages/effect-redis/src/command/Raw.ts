import { Effect } from "effect";

import { defineCommand } from "#/command/Command";
import type { CommandMetadata, Routing } from "#/command/Metadata";
import type { RedisCommand } from "#/protocol/encode";

export interface RawContract {
  readonly execution: CommandMetadata["execution"];
  readonly routing: Routing;
  readonly replyTimeoutMillis?: number | "forever";
}

/** Explicit single-reply intent; unknown commands remain possible without a brand allowlist. */
export const raw = (tokens: RedisCommand, contract: RawContract) =>
  defineCommand({
    metadata: {
      name: "RAW",
      family: "custom",
      execution: contract.execution,
      replay: "never",
      provenance: [{ source: "caller-declared", revision: "application-owned" }],
      scenarios: ["COMMAND-09"],
      availability: [],
    },
    tokens,
    routing: contract.routing,
    ...(contract.replyTimeoutMillis === undefined
      ? {}
      : { replyTimeoutMillis: contract.replyTimeoutMillis }),
    decode: Effect.succeed,
    serverErrors: "preserve",
  });
