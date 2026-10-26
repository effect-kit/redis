import { Effect, Redacted } from "effect";
import type { Option } from "effect";

import type { ReplyDecoder } from "#/command/Command";
import { nullable, pairs, simpleText } from "#/command/reply/Data";
import { mismatch, undecorate } from "#/command/reply/Scalars";
import { fields } from "#/commands/admin/Build";
import type { RespValue } from "#/protocol/RespValue";

export interface SearchConfiguration {
  readonly name: string;
  readonly description: string;
  readonly value: Option.Option<string>;
}
export const configHelp: ReplyDecoder<Redacted.Redacted<ReadonlyArray<SearchConfiguration>>> = (
  reply,
) =>
  Effect.gen(function* () {
    const value = undecorate(reply);
    let entries: ReadonlyArray<readonly [string, ReadonlyArray<readonly [string, RespValue]>]>;
    if (value._tag === "Map") entries = yield* pairs(simpleText, fields)(value);
    else if (value._tag === "Array") {
      entries = yield* Effect.forEach(value.values, (entry) =>
        Effect.gen(function* () {
          const selected = undecorate(entry);
          if (selected._tag !== "Array" || selected.values.length !== 5)
            return yield* mismatch("array", reply);
          const [name, ...body] = selected.values;
          if (name === undefined) return yield* mismatch("array", reply);
          return [yield* simpleText(name), yield* fields({ _tag: "Array", values: body })] as const;
        }),
      );
    } else return yield* mismatch("array", reply);

    const result = yield* Effect.forEach(entries, ([name, report]) =>
      Effect.gen(function* () {
        const description = report.find(([key]) => key === "Description")?.[1];
        const configuredValue = report.find(([key]) => key === "Value")?.[1];
        if (description === undefined || configuredValue === undefined)
          return yield* mismatch("custom", reply);
        return {
          name,
          description: yield* simpleText(description),
          value: yield* nullable(simpleText)(configuredValue),
        };
      }),
    );
    return Redacted.make(result);
  });
