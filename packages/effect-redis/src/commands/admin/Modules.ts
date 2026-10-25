import { Effect, Schema } from "effect";

import { array } from "#/command/reply/Collections";
import { status } from "#/command/reply/Scalars";
import { fields, help, nodeCommand } from "#/commands/admin/Build";
import { Argument, parse } from "#/commands/internal/Input";
import type { RedisArgument } from "#/RedisArgument";

export const moduleList = () => nodeCommand("MODULE LIST", helpModuleList);
export const moduleHelp = () => nodeCommand("MODULE HELP", help);

const helpModuleList = array(fields);

export const moduleLoad = (path: RedisArgument, args: ReadonlyArray<RedisArgument> = []) =>
  nodeCommand(
    "MODULE LOAD",
    status("OK"),
    Effect.all([parse(Argument, path), parse(Schema.Array(Argument), args)]).pipe(
      Effect.map(([file, values]) => [file, ...values]),
    ),
  );

const LoadOptions = Schema.Struct({
  config: Schema.optionalKey(Schema.Array(Schema.Tuple([Argument, Argument]))),
  args: Schema.optionalKey(Schema.Array(Argument)),
});
export type ModuleLoadOptions = typeof LoadOptions.Type;

export const moduleLoadEx = (path: RedisArgument, options: ModuleLoadOptions = {}) =>
  nodeCommand(
    "MODULE LOADEX",
    status("OK"),
    Effect.gen(function* () {
      const file = yield* parse(Argument, path);
      const selected = yield* parse(LoadOptions, options);

      return [
        file,
        ...(selected.config ?? []).flatMap(([name, value]) => ["CONFIG", name, value]),
        ...((selected.args?.length ?? 0) === 0 ? [] : ["ARGS", ...(selected.args ?? [])]),
      ];
    }),
  );

export const moduleUnload = (name: RedisArgument) =>
  nodeCommand(
    "MODULE UNLOAD",
    status("OK"),
    parse(Argument, name).pipe(Effect.map((selected) => [selected])),
  );
