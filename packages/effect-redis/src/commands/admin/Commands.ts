import { Effect, Schema } from "effect";

import { array } from "#/command/reply/Collections";
import { members, simpleText, tuple, unsigned } from "#/command/reply/Data";
import { blob, text } from "#/command/reply/Scalars";
import { fields, help, lossless, nodeCommand } from "#/commands/admin/Build";
import { Argument, Arguments, parse } from "#/commands/internal/Input";
import type { RedisCommand } from "#/protocol/encode";

export const command = () => nodeCommand("COMMAND", array(lossless));
export const commandCount = () => nodeCommand("COMMAND COUNT", unsigned);
export const commandHelp = () => nodeCommand("COMMAND HELP", help);
export const commandInfo = (names: ReadonlyArray<string> = []) =>
  nodeCommand("COMMAND INFO", array(lossless), parse(Schema.Array(Schema.String), names));
export const commandDocs = (names: ReadonlyArray<string> = []) =>
  nodeCommand("COMMAND DOCS", fields, parse(Schema.Array(Schema.String), names));

export const commandGetKeys = (tokens: RedisCommand) =>
  nodeCommand("COMMAND GETKEYS", array(blob), parse(Arguments, tokens));

export const commandGetKeysAndFlags = (tokens: RedisCommand) =>
  nodeCommand(
    "COMMAND GETKEYSANDFLAGS",
    array(tuple(blob, members(simpleText))),
    parse(Arguments, tokens),
  );

const Filter = Schema.Struct({
  by: Schema.Literals(["MODULE", "ACLCAT", "PATTERN"]),
  value: Argument,
});
export type CommandListFilter = typeof Filter.Type;

export const commandList = (filter?: CommandListFilter) =>
  nodeCommand(
    "COMMAND LIST",
    array(text),
    parse(Schema.optional(Filter), filter).pipe(
      Effect.map((selected) =>
        selected === undefined ? [] : ["FILTERBY", selected.by, selected.value],
      ),
    ),
  );
