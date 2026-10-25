import { Effect } from "effect";

import { boolean } from "#/command/reply/Data";
import { status } from "#/command/reply/Scalars";
import { keyed } from "#/commands/internal/Command";
import { positive } from "#/commands/internal/Input";
import type { Integer } from "#/commands/internal/Input";
import { catalog } from "#/commands/strings/Catalog";
import type { RedisArgument } from "#/RedisArgument";

export const setnx = (key: RedisArgument, value: RedisArgument) =>
  keyed(catalog.SETNX, key, Effect.succeed([value]), boolean, "write");

export const setex = (key: RedisArgument, seconds: Integer, value: RedisArgument) =>
  keyed(
    catalog.SETEX,
    key,
    positive(seconds).pipe(Effect.map((ttl) => [ttl, value])),
    status("OK"),
    "write",
  );

export const psetex = (key: RedisArgument, milliseconds: Integer, value: RedisArgument) =>
  keyed(
    catalog.PSETEX,
    key,
    positive(milliseconds).pipe(Effect.map((ttl) => [ttl, value])),
    status("OK"),
    "write",
  );
