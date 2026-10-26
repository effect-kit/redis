import { Effect } from "effect";

import { status } from "#/command/reply/Scalars";
import { nonNegative } from "#/commands/internal/Input";
import type { Integer } from "#/commands/internal/Input";
import { moduleKeyed } from "#/commands/modules/Build";
import { dumpChunk } from "#/commands/modules/Reply";
import type { RedisArgument } from "#/RedisArgument";

export const bfScandump = (key: RedisArgument, cursor: Integer) =>
  moduleKeyed(
    "probabilistic",
    "BF.SCANDUMP",
    key,
    dumpChunk,
    nonNegative(cursor).pipe(Effect.map((value) => [value])),
  );
export const bfLoadchunk = (key: RedisArgument, cursor: Integer, chunk: Uint8Array) =>
  moduleKeyed(
    "probabilistic",
    "BF.LOADCHUNK",
    key,
    status("OK"),
    nonNegative(cursor).pipe(Effect.map((value) => [value, chunk])),
    "write",
  );
