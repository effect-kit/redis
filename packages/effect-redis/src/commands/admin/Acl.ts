import { Effect, Redacted, Schema } from "effect";

import { array } from "#/command/reply/Collections";
import { nullable, simpleText, unsigned } from "#/command/reply/Data";
import { status, text } from "#/command/reply/Scalars";
import { fields, help, nodeCommand, sensitive } from "#/commands/admin/Build";
import { Argument, Arguments, parse, positive } from "#/commands/internal/Input";
import type { Integer } from "#/commands/internal/Input";
import type { RedisCommand } from "#/protocol/encode";
import type { RedisArgument } from "#/RedisArgument";

export const aclCat = (category?: RedisArgument) =>
  nodeCommand(
    "ACL CAT",
    array(text),
    parse(Schema.optional(Argument), category).pipe(
      Effect.map((value) => (value === undefined ? [] : [value])),
    ),
  );

export const aclDelUser = (users: readonly [RedisArgument, ...RedisArgument[]]) =>
  nodeCommand("ACL DELUSER", unsigned, parse(Arguments, users));

/** Rules may contain passwords. Unwrap them only when constructing the wire intent. */
export const aclSetUser = (
  user: RedisArgument,
  rules: Redacted.Redacted<ReadonlyArray<RedisArgument>>,
) =>
  nodeCommand(
    "ACL SETUSER",
    status("OK"),
    Effect.gen(function* () {
      const username = yield* parse(Argument, user);
      const selected = yield* parse(Schema.Redacted(Schema.Array(Argument)), rules);

      return [username, ...Redacted.value(selected)];
    }),
  );

export const aclGetUser = (user: RedisArgument) =>
  nodeCommand(
    "ACL GETUSER",
    sensitive(nullable(fields)),
    parse(Argument, user).pipe(Effect.map((value) => [value])),
  );

export const aclList = () => nodeCommand("ACL LIST", sensitive(array(text)));
export const aclUsers = () => nodeCommand("ACL USERS", array(text));
export const aclWhoAmI = () => nodeCommand("ACL WHOAMI", text);
export const aclDigest = () =>
  nodeCommand("ACL DIGEST", text, undefined, undefined, [
    "Valkey since 9.2.0; outside pinned source baseline",
  ]);
export const aclHelp = () => nodeCommand("ACL HELP", help);
export const aclLoad = () => nodeCommand("ACL LOAD", status("OK"));
export const aclSave = () => nodeCommand("ACL SAVE", status("OK"));

export const aclGenPass = (bits?: Integer) =>
  nodeCommand(
    "ACL GENPASS",
    sensitive(text),
    bits === undefined ? Effect.succeed([]) : positive(bits).pipe(Effect.map((value) => [value])),
  );

export const aclDryRun = (user: RedisArgument, command: RedisCommand) =>
  nodeCommand(
    "ACL DRYRUN",
    simpleText,
    Effect.all([parse(Argument, user), parse(Arguments, command)]).pipe(
      Effect.map(([username, args]) => [username, ...args]),
    ),
  );

export const aclLog = (count?: Integer) =>
  nodeCommand(
    "ACL LOG",
    sensitive(array(fields)),
    count === undefined ? Effect.succeed([]) : positive(count).pipe(Effect.map((value) => [value])),
  );

export const aclLogReset = () => nodeCommand("ACL LOG", status("OK"), Effect.succeed(["RESET"]));
