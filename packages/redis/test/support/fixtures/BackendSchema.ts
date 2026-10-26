import { Schema } from "effect";

const Name = Schema.NonEmptyString;
const Url = Schema.String.check(Schema.isPattern(/^https:\/\/[^\s]+$/));
const Commit = Schema.String.check(Schema.isPattern(/^[a-f0-9]{40}$/));

export const NativeFixture = Schema.Struct({
  id: Name,
  kind: Schema.Literals(["engine", "runtime"]),
  product: Name,
  version: Name,
  source: Schema.Struct({ repository: Url, commit: Schema.NullOr(Commit), refUrl: Url }),
  configuration: Name,
}).check(
  Schema.makeFilter((fixture) => fixture.kind === "runtime" || fixture.source.commit !== null),
);

export const NodeImage = Schema.Struct({
  version: Name,
  moduleList: Schema.optionalKey(Schema.Literal("unsupported")),
  architecture: Schema.optionalKey(Schema.Literals(["arm64", "x64"])),
  fixture: Name,
  image: Name,
  variant: Schema.optionalKey(Name),
  modules: Schema.optionalKey(Schema.Record(Name, Name)),
  digest: Schema.String.check(Schema.isPattern(/^sha256:[a-f0-9]{64}$/)),
});
