import { Effect, Result, Schema } from "effect";

import { CommandMetadata } from "#/command/Metadata";

const owned = new WeakSet<CommandMetadata>();
const validated = new WeakSet<CommandMetadata>();
const parse = Schema.decodeUnknownResult(CommandMetadata, { onExcessProperty: "error" });

/** Only library-owned, deeply immutable metadata can reuse validation across executions. */
export const immutableMetadata = (metadata: CommandMetadata): CommandMetadata => {
  const snapshot = Object.freeze({
    ...metadata,
    scenarios: Object.freeze([metadata.scenarios[0], ...metadata.scenarios.slice(1)] as const),
    availability: Object.freeze([...metadata.availability]),
    provenance: Object.freeze([
      Object.freeze({ ...metadata.provenance[0] }),
      ...metadata.provenance.slice(1).map((entry) => Object.freeze({ ...entry })),
    ] as const),
  });
  owned.add(snapshot);
  return snapshot;
};

export const parseMetadataResult = (metadata: CommandMetadata) => {
  if (validated.has(metadata)) return Result.succeed(metadata);

  return parse(metadata).pipe(
    Result.map((parsed) => {
      if (!owned.has(metadata)) return parsed;
      // Keep validation lazy. Caller-owned descriptors still validate and snapshot every preparation.
      validated.add(metadata);
      return metadata;
    }),
  );
};

export const parseMetadata = (metadata: CommandMetadata) =>
  Effect.suspend(() => Effect.fromResult(parseMetadataResult(metadata)));
