import { Effect, Schema } from "effect";

import type { CommandMetadata } from "#/command/Metadata";
import { unsigned } from "#/command/reply/Data";
import { status } from "#/command/reply/Scalars";
import { keyed } from "#/commands/internal/Command";
import { parse } from "#/commands/internal/Input";
import { moduleMetadata } from "#/commands/modules/Build";
import { moduleDouble } from "#/commands/modules/Reply";
import type { RedisArgument } from "#/RedisArgument";

const valkeyBloom = (name: string): CommandMetadata => ({
  ...moduleMetadata("probabilistic", name),
  provenance: [{ source: "https://github.com/valkey-io/valkey-bloom", revision: "1.0.1" }],
  availability: ["Valkey Bloom1.0.1 extension; absent from the pinned RedisBloom builds"],
});

/** Consumes opaque Valkey Bloom serialization, including its version byte. Redis DUMP/SCANDUMP are different formats. */
export const bfLoad = (key: RedisArgument, serialized: Uint8Array) =>
  keyed(
    valkeyBloom("BF.LOAD"),
    key,
    parse(Schema.Uint8Array, serialized).pipe(Effect.map((bytes) => [bytes])),
    status("OK"),
    "write",
  );

export const bfInfoErrorRate = (key: RedisArgument) =>
  keyed(valkeyBloom("BF.INFO"), key, Effect.succeed(["ERROR"]), moduleDouble);

export const bfInfoTightening = (key: RedisArgument) =>
  keyed(valkeyBloom("BF.INFO"), key, Effect.succeed(["TIGHTENING"]), moduleDouble);

export const bfInfoMaxScaledCapacity = (key: RedisArgument) =>
  keyed(valkeyBloom("BF.INFO"), key, Effect.succeed(["MAXSCALEDCAPACITY"]), unsigned);
