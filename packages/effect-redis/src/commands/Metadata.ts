import type { CommandMetadata } from "../command/Metadata.js";

export const metadata = (
  name: string,
  family: string,
  scenarios: readonly [string, ...string[]],
  availability: ReadonlyArray<string> = [],
): CommandMetadata => ({
  name,
  family,
  execution: "ordinary",
  replay: "never",
  scenarios,
  availability,
  provenance: [
    { source: "https://github.com/redis/redis/tree/8.10.2/src/commands", revision: "8.10.2" },
    { source: "https://github.com/valkey-io/valkey/tree/9.1.2/src/commands", revision: "9.1.2" },
  ],
});
