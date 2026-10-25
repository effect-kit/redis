import { Effect } from "effect";

import type { RedisCommand } from "../protocol/encode.js";
import { defineCommand } from "./Command.js";
import type { CommandMetadata, Routing } from "./Metadata.js";

export interface RawContract {
  readonly execution: CommandMetadata["execution"];
  readonly routing: Routing;
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
    decode: Effect.succeed,
    serverErrors: "preserve",
  });
