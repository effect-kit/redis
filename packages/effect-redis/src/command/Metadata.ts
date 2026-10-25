import { Schema } from "effect";

export const CommandMetadata = Schema.Struct({
  name: Schema.String.check(
    Schema.isPattern(/^[A-Z][A-Z0-9._-]*(?: [A-Z][A-Z0-9._-]*)*$/),
    Schema.isMaxLength(128),
  ),
  family: Schema.NonEmptyString,
  execution: Schema.Literals([
    "ordinary",
    "blocking",
    "exclusive",
    "subscription",
    "diagnostic",
    "advanced",
  ]),
  replay: Schema.Literal("never"),
  provenance: Schema.NonEmptyArray(
    Schema.Struct({ source: Schema.NonEmptyString, revision: Schema.NonEmptyString }),
  ),
  scenarios: Schema.NonEmptyArray(Schema.NonEmptyString),
  availability: Schema.Array(Schema.NonEmptyString),
});
export type CommandMetadata = typeof CommandMetadata.Type;

export const Routing = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("Keyless") }),
  Schema.Struct({
    _tag: Schema.Literal("Keys"),
    keys: Schema.NonEmptyArray(
      Schema.Struct({
        // Index zero is the command token, never a routable key.
        index: Schema.Int.check(Schema.isGreaterThan(0)),
        access: Schema.Literals(["read", "write", "read-write"]),
      }),
    ),
  }),
  Schema.Struct({ _tag: Schema.Literal("Node"), node: Schema.NonEmptyString }),
]);
export type Routing = typeof Routing.Type;
